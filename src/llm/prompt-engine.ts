import type { Action, ActionResult, AgentHistoryEntry, LlmToolDefinition, ScreenAnalysis, TaskPlan } from '../types/index.ts'
import type { PreActionReflection } from '../core/reflection.ts'

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function buildSystemPrompt(params: {
  goal: string
  screen: ScreenAnalysis | undefined
  history: Array<{ action: Action; result: { ok: boolean; error?: string } }>
  memoryContext: string
  tools: LlmToolDefinition[]
}): string {
  const screenDescription = params.screen
    ? `${params.screen.description}\nTitles: ${params.screen.visibleTitles.join(', ')}\nInteractive: ${params.screen.interactiveElements.join(', ')}`
    : 'No screen analysis available.'

  return [
    'You are OROS, an autonomous Windows operator.',
    `Your primary objective is to achieve the user's goal by performing a single, logical action at a time.`,
    `You have access to a variety of tools, including GUI automation, shell commands, and internal functions.`,
    `When the goal involves interacting with an application (e.g., typing after opening Notepad), you should return a 'gui' action with 'type' tool.`,
    `Always consider the current screen state to determine the most appropriate next action.`,
    `If the goal is already complete, return {"type":"internal","tool":"finish","params":{}}.`,
    `Goal: ${params.goal}`,
    `Screen: ${screenDescription}`,
    `History: ${stringify(params.history.slice(-5))}`,
    `Memory: ${params.memoryContext}`,
    `Tools: ${stringify(params.tools)}`
  ].join('\n\n')
}

export function buildPlannerPrompt(goal: string): string {
  return [
    'You are OROS Planner. Decompose the goal into a directed acyclic graph of sub-tasks.',
    'Return only valid JSON matching { goal, tasks: [...] }.',
    `Goal: ${goal}`
  ].join('\n')
}

export function buildClassifierPrompt(goal: string): string {
  return [
    'You are a task classifier. Return only JSON matching { complexity, reason }.',
    `Goal: ${goal}`
  ].join('\n')
}



export function buildPreActionReflectionPrompt(context: {
  goal: string
  history: AgentHistoryEntry[]
  memoryContext: string
  planSummary?: string
}): string {
  const steps = context.history.slice(-8).map((entry, index) => {
    const tool = entry.action.type === 'internal' ? entry.action.tool : entry.action.type
    return `${index + 1}. ${tool} → ${entry.result.ok ? 'ok' : 'fail'}${entry.postReflection ? ` (${entry.postReflection.slice(0, 120)})` : ''}`
  })
  return [
    `Goal: ${context.goal}`,
    context.planSummary ? `Plan: ${context.planSummary}` : undefined,
    `Memory: ${context.memoryContext || 'none'}`,
    steps.length > 0 ? `History:\n${steps.join('\n')}` : 'History: none yet',
    'What has been accomplished? What is still required? What should the next action focus on?'
  ].filter(Boolean).join('\n\n')
}

export function buildPostActionReflectionPrompt(
  context: { goal: string; history: AgentHistoryEntry[]; planSummary?: string },
  action: Action,
  result: ActionResult,
  preReflection: PreActionReflection
): string {
  const actionJson = JSON.stringify(action)
  const resultText = result.ok
    ? (result.stdout || JSON.stringify(result.metadata || {})).slice(0, 800)
    : (result.error || 'unknown error')
  return [
    `Goal: ${context.goal}`,
    context.planSummary ? `Plan: ${context.planSummary}` : undefined,
    `Before action you thought: ${preReflection.thought}`,
    `Action taken: ${actionJson}`,
    `Result: ${result.ok ? 'success' : 'failure'}`,
    `Output: ${resultText}`,
    'Did this step advance the full goal? Is search+analysis+file-write complete if required? Should we continue or retry?'
  ].filter(Boolean).join('\n\n')
}

export function buildPlanSummary(plan: TaskPlan): string {
  return plan.tasks
    .map(task => `${task.id}. ${task.description} [${task.complexity}] deps=${task.dependencies.join(',') || 'none'} verify=${task.verification}`)
    .join('\n')
}
