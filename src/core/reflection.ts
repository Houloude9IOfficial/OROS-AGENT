import type { Action, ActionResult } from '../types/index.ts'
import {
  buildPostActionReflectionPrompt,
  buildPreActionReflectionPrompt
} from '../llm/prompt-engine.ts'
import { UniversalClient } from '../llm/universal-client.ts'

export interface ReflectionContext {
  goal: string
  history: Array<{
    action: Action
    result: ActionResult
    preReflection?: string
    postReflection?: string
  }>
  memoryContext: string
  planSummary?: string
}

export interface PreActionReflection {
  thought: string
  nextStepFocus: string
  blockers: string[]
}

export interface PostActionReflection {
  thought: string
  progressPercent: number
  goalMet: boolean
  shouldContinue: boolean
  retrySuggested: boolean
}

function parsePreReflection(text: string): PreActionReflection | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (typeof parsed.thought !== 'string') {
      return undefined
    }
    return {
      thought: parsed.thought,
      nextStepFocus: typeof parsed.nextStepFocus === 'string' ? parsed.nextStepFocus : '',
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers.filter((value): value is string => typeof value === 'string')
        : []
    }
  } catch {
    return undefined
  }
}

function parsePostReflection(text: string): PostActionReflection | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (typeof parsed.thought !== 'string') {
      return undefined
    }
    const progressPercent = typeof parsed.progressPercent === 'number'
      ? Math.min(100, Math.max(0, parsed.progressPercent))
      : 0
    return {
      thought: parsed.thought,
      progressPercent,
      goalMet: parsed.goalMet === true,
      shouldContinue: parsed.shouldContinue !== false,
      retrySuggested: parsed.retrySuggested === true
    }
  } catch {
    return undefined
  }
}

function heuristicPreReflection(context: ReflectionContext): PreActionReflection {
  const step = context.history.length + 1
  const last = context.history[context.history.length - 1]
  const lastTool = last?.action.type === 'internal' ? last.action.tool : last?.action.type
  return {
    thought: `Step ${step}: Re-evaluating progress toward the goal before choosing the next action.`,
    nextStepFocus: lastTool
      ? `Previous step used ${lastTool}; determine what is still missing from the goal.`
      : 'Start by identifying the first concrete action toward the goal.',
    blockers: last && !last.result.ok ? ['Last action failed'] : []
  }
}

function heuristicPostReflection(
  context: ReflectionContext,
  action: Action,
  result: ActionResult
): PostActionReflection {
  const lower = context.goal.toLowerCase()
  const needsFile = /\.txt\b/i.test(context.goal) || /save\s+it/i.test(lower)
  const needsSearch = /search\s+up|search\s+online|research|analyze|summarize/i.test(lower)
  const wroteFile = context.history.some(item => {
    if (!item.result.ok) {
      return false
    }
    if (item.action.type === 'internal' && item.action.tool === 'write_file') {
      return true
    }
    if (item.action.type === 'internal' && item.action.tool === 'web_search' && item.action.params.outputPath) {
      return true
    }
    if (item.action.type === 'shell' && /set-content/i.test(item.action.params.command)) {
      return true
    }
    return false
  })
  const searched = context.history.some(item =>
    item.result.ok &&
    item.action.type === 'internal' &&
    item.action.tool === 'web_search'
  )
  const summarized = context.history.some(item =>
    item.result.ok &&
    item.action.type === 'internal' &&
    item.action.tool === 'summarize'
  )

  let progressPercent = 10
  if (searched) {
    progressPercent = 40
  }
  if (summarized) {
    progressPercent = 70
  }
  if (wroteFile) {
    progressPercent = 95
  }

  const goalMet = result.ok && (
    action.type === 'internal' && action.tool === 'finish'
      ? wroteFile || (!needsFile && !needsSearch)
      : wroteFile && (!needsSearch || (searched && summarized))
  )

  if (needsSearch && needsFile) {
    return {
      thought: result.ok
        ? `Completed ${action.type === 'internal' ? action.tool : action.type}; assess whether search, analysis, and file output are all done.`
        : 'Last action failed; retry or change approach.',
      progressPercent,
      goalMet,
      shouldContinue: !goalMet,
      retrySuggested: !result.ok
    }
  }

  return {
    thought: result.ok ? 'Action succeeded; check if the overall goal is fully satisfied.' : 'Action failed.',
    progressPercent: result.ok ? Math.max(progressPercent, 50) : progressPercent,
    goalMet: result.ok && action.type === 'internal' && action.tool === 'finish',
    shouldContinue: !result.ok || !(action.type === 'internal' && action.tool === 'finish'),
    retrySuggested: !result.ok
  }
}

export class ReflectionEngine {
  private readonly client: UniversalClient
  private readonly model: string


  constructor(baseUrl: string, model: string) {
    this.client = new UniversalClient(1800000, process.env)
    this.model = model
  }

  async reflectBefore(context: ReflectionContext): Promise<PreActionReflection> {
    try {
      const response = await this.client.generate({
        model: this.model,
        format: 'json',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: [
              'You are OROS reflection. Before each action, think step-by-step about what was done, what remains, and what to do next.',
              'Return JSON: { "thought": string, "nextStepFocus": string, "blockers": string[] }',
              'Do not choose an action; only analyze and plan.'
            ].join('\n')
          },
          { role: 'user', content: buildPreActionReflectionPrompt(context) }
        ]
      })
      return parsePreReflection(response.text) || heuristicPreReflection(context)
    } catch {
      return heuristicPreReflection(context)
    }
  }

  async reflectAfter(
    context: ReflectionContext,
    action: Action,
    result: ActionResult,
    preReflection: PreActionReflection
  ): Promise<PostActionReflection> {
    try {
      const response = await this.client.generate({
        model: this.model,
        format: 'json',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: [
              'You are OROS reflection. After each action, evaluate whether the user goal is truly complete.',
              'Return JSON: { "thought": string, "progressPercent": number, "goalMet": boolean, "shouldContinue": boolean, "retrySuggested": boolean }',
              'Set goalMet true only when every part of the goal is satisfied (e.g. search + analyze + save file).',
              'Raw search dumps without analysis do NOT mean goalMet.'
            ].join('\n')
          },
          {
            role: 'user',
            content: buildPostActionReflectionPrompt(context, action, result, preReflection)
          }
        ]
      })
      return parsePostReflection(response.text) || heuristicPostReflection(context, action, result)
    } catch {
      return heuristicPostReflection(context, action, result)
    }
  }
}

export function formatPreReflection(reflection: PreActionReflection): string {
  const blockers = reflection.blockers.length > 0 ? ` Blockers: ${reflection.blockers.join('; ')}` : ''
  return `${reflection.thought} Focus: ${reflection.nextStepFocus}.${blockers}`
}

export function formatPostReflection(reflection: PostActionReflection): string {
  return `${reflection.thought} Progress: ${reflection.progressPercent}%. Goal met: ${reflection.goalMet}. Continue: ${reflection.shouldContinue}.`
}
