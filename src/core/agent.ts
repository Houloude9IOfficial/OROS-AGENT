import { randomUUID } from 'node:crypto'
import type { Action, ActionResult, AgentChatMessage, AgentState, NativeToolExecutionResult, OrosConfig } from '../types/index.ts'

type HistoryToolResult = ActionResult
import { ScreenAnalyzer, isVisionModel } from '../perception/screen-analyzer.ts'
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContextManager } from '../memory/context-manager.ts'
import type { Logger } from '../system/logger.ts'
import type { StateManager } from './state-manager.ts'
import type { Embedder } from '../memory/embedder.ts'
import type { McpHost } from '../mcp/mcp-host.ts'
import { captureScreen } from '../perception/vision.ts'
import { GuiController } from '../action/gui-controller.ts'
import { FirecrawlSearchTool } from '../tools/firecrawl-search.ts'
import { Executor } from './executor.ts'
import { toOllamaTools, type ToolCall } from '../tools/native-tool-registry.ts'
import { SessionConfirmationGate } from '../system/confirmation.ts'
import { UniversalClient } from '../llm/universal-client.ts'

interface AgentDependencies {
  config: OrosConfig
  logger: Logger
  stateManager: StateManager
  contextManager: ContextManager
  embedder: Embedder
  mcp: McpHost
}

function buildSystemPrompt(
  goal: string,
  memoryContext: string,
  screenSummary: string,
  tools: string[]
): string {
  return `
# OROS Autonomous Agent System Prompt

## 1. Role
You are **OROS**, a local-first autonomous AI agent running on Windows.

You are designed to complete user-defined goals end-to-end by planning actions and using available tools.

You are not a chatbot. You are an execution agent focused on completing tasks.

## 2. Primary Objective
Your objective is to fully accomplish the given goal:

Goal:
${goal}

You must continue working until the goal is fully completed or you determine it is impossible.

## 3. Context
- Memory context (may contain helpful prior information):
${memoryContext || "none"}

- Current screen state summary:
${screenSummary || "no screen analysis available"}

## 4. Tool System

You have access to a structured tool registry.

You must only use tools that are explicitly provided in the available tool list.

Tool selection rules:
- Match tool purpose before using it
- Do not invent or assume tool capabilities
- If unsure, prefer discovery tools (search/list) first
- Use the most direct tool for the task
- If multiple tools can solve a task, choose the most direct and reliable one, you can use the other tools in follow-up steps if needed.

## 5. Execution Principles
- Break tasks into small, verifiable steps.
- Prefer the simplest action that moves the task forward.
- Always verify the result of an action before continuing.
- Maintain forward progress; avoid repetition without new information.
- Adapt strategy immediately if a tool fails or produces unexpected output.

## 6. Multi-Agent / Subagent System (Optional)

If the subagent deployment tool (deploy_subagent) is available, you may use it ONLY when the task meets at least one of the following conditions:

- The goal contains multiple independent subtasks that can be solved in parallel
- The problem requires different reasoning perspectives or specialized approaches
- A single linear workflow is inefficient or likely to fail
- The task is complex and benefits from decomposition

### Subagent Usage Rules
- Each subagent must have a clearly scoped sub-goal
- Do not create subagents for simple or single-step tasks
- Prefer one primary agent unless decomposition clearly improves performance
- Avoid overlapping responsibilities between subagents
- Combine and verify subagent outputs before finalizing results

### Workflow Pattern
1. Decompose the main goal into subtasks (only if needed)
2. Assign each subtask to a subagent with a specific objective
3. Collect results from each subagent
4. Resolve conflicts or inconsistencies between outputs
5. Synthesize a final unified answer or action plan

## 7. Tool Usage Guidelines
- Use tools only when they directly help achieve the goal.
- Prefer discovery tools before action tools (e.g., search before open).
- If multiple tools can solve a task, choose the most direct and reliable one.
- Do not assume tool results; always base next steps on observed outputs.

## 8. Core Tools Behavior
- app_search: find installed applications or executables
- app_open: launch applications or open files
- workspace_search: search for text content in workspace
- workspace_regex_search: advanced pattern search
- console_finalize: final step only, used to output completion result

## 9. Completion Rule (Critical)
When and only when the goal is fully completed:
- Call console_finalize exactly once
- Do not continue reasoning or tool use after finalization
- Ensure the final output is clean and complete

## 10. Failure Handling
If a tool fails or returns unexpected output:
- Identify the cause of failure
- Adjust your approach
- Try an alternative tool or query
- If repeated failures occur, simplify the approach
- If still blocked, explain the issue clearly and request guidance

## 11. Safety and Constraints
- Do not perform actions unrelated to the goal
- Do not access or modify system data beyond what is necessary
- Do not expose sensitive, personal, or private information
- Do not fabricate results from tools
- If a request cannot be completed safely or technically, stop and explain why

## 12. Reasoning Style
- Think step-by-step internally before acting
- Keep actions minimal and efficient
- Favor correctness over speed
- Always prefer observable evidence over assumptions

---
`.trim()
}


function safeJsonParse(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function historyOutput(result: HistoryToolResult): string {
  if (result.ok) {
    if ('stdout' in result && typeof result.stdout === 'string' && result.stdout) {
      return result.stdout
    }
    if ('metadata' in result && result.metadata) {
      const cleanMetadata = { ...result.metadata }
      if (cleanMetadata.snapshot && typeof cleanMetadata.snapshot === 'object') {
        const snap = { ...cleanMetadata.snapshot as Record<string, unknown> }
        delete snap.imageBase64
        cleanMetadata.snapshot = snap
      }
      delete cleanMetadata.imageBase64
      return JSON.stringify(cleanMetadata)
    }
    return 'ok'
  } else {
    if ('error' in result && typeof result.error === 'string' && result.error) {
      return result.error
    }
    if ('stderr' in result && typeof result.stderr === 'string' && result.stderr) {
      return result.stderr
    }
    if ('stdout' in result && typeof result.stdout === 'string' && result.stdout) {
      return result.stdout
    }
    if ('metadata' in result && result.metadata) {
      const cleanMetadata = { ...result.metadata }
      if (cleanMetadata.snapshot && typeof cleanMetadata.snapshot === 'object') {
        const snap = { ...cleanMetadata.snapshot as Record<string, unknown> }
        delete snap.imageBase64
        cleanMetadata.snapshot = snap
      }
      delete cleanMetadata.imageBase64
      return JSON.stringify(cleanMetadata)
    }
    return 'failed'
  }
}

function toolKey(call: ToolCall): string {
  return `${call.function.name}:${JSON.stringify(call.function.arguments || {})}`
}

function messageFromHistoryEntry(entry: { action: Action; result: HistoryToolResult }): AgentChatMessage[] {
  const toolName = entry.action.type === 'internal' ? entry.action.tool : entry.action.type
  const argumentsObject = entry.action.type === 'shell'
    ? entry.action.params
    : entry.action.type === 'gui'
      ? entry.action.params
      : entry.action.type === 'mcp'
        ? entry.action.args
        : entry.action.params

  const assistantMessage: AgentChatMessage = {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        function: {
          name: toolName,
          arguments: argumentsObject
        }
      }
    ]
  }
  const toolMessage: AgentChatMessage = {
    role: 'tool',
    tool_name: toolName,
    content: historyOutput(entry.result)
  }

  return [assistantMessage, toolMessage]
}

function createUserMessage(goal: string, screenAnalysis: { description: string } | undefined, continuationHint: string | undefined, snapshot: { imageBase64: string } | undefined): AgentChatMessage {
  const message: AgentChatMessage = {
    role: 'user',
    content: [
      `Current goal: ${goal}`,
      screenAnalysis ? `Screen analysis: ${screenAnalysis.description}` : 'Screen analysis unavailable.',
      continuationHint ? `Continuation hint: ${continuationHint}` : undefined,
      'Use tools to continue the task. Only finish once the goal is satisfied.'
    ].filter((value): value is string => typeof value === 'string').join('\n')
  }

  if (snapshot) {
    message.images = [snapshot.imageBase64]
  }

  return message
}

function buildFinalConsoleText(goal: string, assistantContent: string): string {
  const trimmed = assistantContent.trim()
  if (trimmed) {
    return trimmed
  }
  return `Completed: ${goal}`
}

export class Agent {
  private static readonly DEFAULT_MAX_STEPS = 100
  private readonly client: UniversalClient
  private readonly analyzer: ScreenAnalyzer
  private readonly executor: Executor
  private readonly confirmationGate: SessionConfirmationGate
  private readonly deps: AgentDependencies
  private currentState: AgentState | undefined
  private paused = false
  private stopped = false
  private resumeWaiter: (() => void) | undefined
  private readonly approvedToolCategories = new Set<string>()

  constructor(deps: AgentDependencies) {
    this.deps = deps
    this.client = new UniversalClient(3600000, process.env)
    this.analyzer = new ScreenAnalyzer(this.client)
    this.confirmationGate = new SessionConfirmationGate()
    this.executor = new Executor({
      gui: new GuiController(),
      mcp: deps.mcp,
      firecrawl: new FirecrawlSearchTool(process.env.FIRECRAWL_API_KEY),
      client: this.client,
      logger: deps.logger,
      contextManager: deps.contextManager,
      fastModel: deps.config.models.fast,
      workspaceRoot: process.cwd()
    })
  }

  async run(goal: string, taskId: string = randomUUID()): Promise<AgentState> {
    const state = this.deps.stateManager.createInitialState(goal)
    this.currentState = state
    this.paused = false
    this.stopped = false
    this.approvedToolCategories.clear()
    this.deps.logger.info('Checking Provider connection...')
    try {
      const ping = await this.client.ping()
      if (!ping.success) {
        throw new Error('Provider ping did not return success')
      }
      this.deps.logger.success(`${ping.client} connection successful`)
    } catch (error) {
      this.deps.logger.error(`Provider connection failed`)
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.deps.logger.error(`Error: ${errorMessage}`)

      throw new Error(`Provider connection failed: ${errorMessage}`)
    }

    state.currentTaskId = taskId
    this.deps.logger.info('Agent starting', { goal, taskId, model: this.deps.config.models.planner })

    try {
      await this.toolLoop(state, goal, taskId)
      await this.deps.stateManager.saveCheckpoint(taskId, state)
      return state
    } finally {
      this.currentState = undefined
    }
  }

  async resume(taskId: string): Promise<AgentState | undefined> {
    const checkpoint = await this.deps.stateManager.loadCheckpoint(taskId)
    if (!checkpoint) {
      return undefined
    }

    const state: AgentState = {
      goal: checkpoint.goal,
      history: checkpoint.history,
      paused: checkpoint.paused,
      stopped: checkpoint.stopped,
      waitingForUser: false
    }

    if (checkpoint.currentTaskId) {
      state.currentTaskId = checkpoint.currentTaskId
    }
    if (checkpoint.plan) {
      state.plan = checkpoint.plan
    }

    this.currentState = state
    this.stopped = false
    this.paused = false

    try {
      await this.toolLoop(state, state.goal, taskId)
      await this.deps.stateManager.saveCheckpoint(taskId, state)
      return state
    } finally {
      this.currentState = undefined
    }
  }

    private async toolLoop(state: AgentState, goal: string, taskId: string): Promise<void> {
    const tools = this.executor.listTools()
    const toolNames = tools.map(tool => tool.function.name)
    const maxSteps = this.deps.config.runtime.maxToolCallsPerTask || Agent.DEFAULT_MAX_STEPS
    let consecutiveFailures = 0
    let lastFailureKey: string | undefined

    const executeToolCall = async (toolCall: ToolCall, messages: AgentChatMessage[]): Promise<NativeToolExecutionResult> => {
      const shouldConfirm = this.executor.isDangerous(toolCall.function.name, toolCall.function.arguments)

      if (shouldConfirm && !this.approvedToolCategories.has(toolCall.function.name)) {
        const approved = await this.confirmationGate.allow({
          toolName: toolCall.function.name,
          summary: 'This action can modify files, execute code, or otherwise change the local system.',
          arguments: toolCall.function.arguments
        })
        if (!approved) {
          state.waitingForUser = true
          this.deps.logger.warn('Dangerous tool denied by user', { tool: toolCall.function.name })
          return { ok: false, tool: toolCall.function.name, content: '', error: 'Tool denied by user' }
        }
        this.approvedToolCategories.add(toolCall.function.name)
      }

      const historyAction = { type: 'internal' as const, tool: toolCall.function.name, params: toolCall.function.arguments || {} }
      const result = await this.executor.execute(toolCall, state, goal)
      const actionResult: ActionResult = {
        ok: result.ok,
        tool: result.tool,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        ...(result.ok && result.content ? { stdout: result.content } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(result.metadata ? { metadata: result.metadata } : {})
      }

      state.history.push({ action: historyAction, result: actionResult })
      messages.push({ role: 'tool', tool_name: toolCall.function.name, content: result.content || result.error || 'ok' })
      await this.persistEpisode(goal, state, result.content || result.error || '', toolCall.function.name)
      return result
    }

    for (let step = state.history.length; step < maxSteps; step += 1) {
      await this.waitForControl()
      if (this.stopped || state.waitingForUser) {
        return
      }

      const snapshot = await captureScreen(this.deps.config.runtime.screenshotWidth, this.deps.config.runtime.screenshotQuality).catch(() => undefined)
      const screenAnalysis = snapshot && isVisionModel(this.deps.config.models.fast)
        ? await this.analyzer.describe(snapshot, this.deps.config.models.fast).catch(() => undefined)
        : undefined
      const memoryContext = await this.deps.contextManager.getRelevantContext(goal)
      const systemPrompt = buildSystemPrompt(
        goal,
        memoryContext.summary,
        screenAnalysis ? `${screenAnalysis.description} Titles=${screenAnalysis.visibleTitles.join(', ')} Interactive=${screenAnalysis.interactiveElements.join(', ')}` : 'unavailable',
        toolNames
      )

      const plannerIsVision = isVisionModel(this.deps.config.models.planner)
      const messages: AgentChatMessage[] = [
        { role: 'system' as const, content: systemPrompt },
        ...this.buildConversation(state, goal),
        createUserMessage(
          goal,
          screenAnalysis ? { description: screenAnalysis.description } : undefined,
          undefined,
          snapshot && plannerIsVision ? { imageBase64: snapshot.imageBase64 } : undefined
        )
      ]

      let response
      try {
        response = await this.client.chat({
          model: this.deps.config.models.planner,
          messages,
          tools: toOllamaTools(tools)
        });
      } catch (error) {
        this.deps.logger.warn('Chat failed; pausing run', { error: error instanceof Error ? error.message : String(error) })
        state.waitingForUser = true
        await this.deps.stateManager.saveCheckpoint(taskId, state)
        return
      }

      const assistantMessage = response.message
      const toolCalls = assistantMessage.tool_calls || []

      // Add assistant message to context
      const assistantMsg: AgentChatMessage = {
        role: 'assistant',
        content: assistantMessage.content || ''
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls
      }
      messages.push(assistantMsg)

      if (toolCalls.length === 0) {
        // Model didn't call any tools. Ask it to use a tool or finish.
        this.deps.logger.info('Model returned no tool calls; prompting to continue or finish', { goal })
        
        messages.push({
            role: 'user',
            content: 'You did not call any tools. If the task is incomplete, please call the next appropriate tool. If the task is fully completed, you MUST call the console_finalize tool to finish.'
        })

        try {
            response = await this.client.chat({
              model: this.deps.config.models.planner,
              messages,
              tools: toOllamaTools(tools)
            });
            
            const nextToolCalls = response.message.tool_calls || []
            if (nextToolCalls.length === 0) {
                this.deps.logger.warn('Model refused to call tools even after prompting. Waiting for user.', { goal })
                state.waitingForUser = true
                await this.deps.stateManager.saveCheckpoint(taskId, state)
                return
            }
            
            // Execute the newly produced tool calls
            for (const toolCall of nextToolCalls) {
                const result = await executeToolCall(toolCall, messages)
                if (toolCall.function.name === 'console_finalize') {
                  this.deps.logger.success('Agent finished task successfully via console_finalize.')
                  state.stopped = true
                  this.stopped = true
                  return
                }
            }
        } catch (error) {
            this.deps.logger.warn('Chat failed on follow-up; pausing run', { error: error instanceof Error ? error.message : String(error) })
            state.waitingForUser = true
            await this.deps.stateManager.saveCheckpoint(taskId, state)
            return
        }
      } else {
          for (const toolCall of toolCalls) {
            const key = toolKey(toolCall)
            const result = await executeToolCall(toolCall, messages)

            if (result.ok) {
              consecutiveFailures = 0
              lastFailureKey = undefined
            } else if (lastFailureKey === key) {
              consecutiveFailures += 1
            } else {
              consecutiveFailures = 1
              lastFailureKey = key
            }

            if (toolCall.function.name === 'console_finalize') {
                this.deps.logger.success('Agent finished task successfully via console_finalize.')
                state.stopped = true
                this.stopped = true
                return
            }

            if (consecutiveFailures >= this.deps.config.runtime.repeatedFailureLimit) {
              state.waitingForUser = true
              this.deps.logger.warn('Repeated failures reached safety threshold', { goal, tool: toolCall.function.name })
              return
            }
          }
      }

      await this.deps.stateManager.saveCheckpoint(taskId, state)
      if (state.stopped || state.waitingForUser || this.stopped) {
        return
      }
    }

    state.waitingForUser = true
    this.deps.logger.warn('Tool loop reached maximum steps', { goal, maxSteps: this.deps.config.runtime.maxToolCallsPerTask })
  }

private buildConversation(state: AgentState, goal: string): AgentChatMessage[] {
    const messages: AgentChatMessage[] = [
      {
        role: 'user',
        content: `Goal: ${goal}`
      }
    ]

    for (const entry of state.history.slice(-25)) {
      messages.push(...messageFromHistoryEntry(entry))
    }

    return messages as AgentChatMessage[]
  }

  private async persistEpisode(goal: string, state: AgentState, text: string, toolName: string): Promise<void> {
    try {
      const episode = {
        id: randomUUID(),
        timestamp: Date.now(),
        goal,
        action: {
          type: 'internal' as const,
          tool: toolName,
          params: {}
        },
        result: {
          ok: true,
          tool: toolName,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          stdout: text
        },
        screenshotEmbedding: [] as number[],
        textEmbedding: await this.deps.embedder.embed(`${goal}\n${text}`),
        tags: [toolName]
      }
      await this.deps.contextManager.storeEpisode(episode)
    } catch (error) {
      this.deps.logger.warn('Skipping episode write', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  pause(): void {
    this.paused = true
    if (this.currentState) {
      this.currentState.paused = true
    }
  }

  resumeControl(): void {
    this.paused = false
    if (this.currentState) {
      this.currentState.paused = false
    }
    this.resumeWaiter?.()
    this.resumeWaiter = undefined
  }

  stop(): void {
    this.stopped = true
    if (this.currentState) {
      this.currentState.stopped = true
    }
    this.resumeWaiter?.()
    this.resumeWaiter = undefined
  }

  isPaused(): boolean {
    return this.paused
  }

  isStopped(): boolean {
    return this.stopped
  }

  private async waitForControl(): Promise<void> {
    if (!this.paused || this.stopped) {
      return
    }
    await new Promise<void>(resolve => {
      this.resumeWaiter = resolve
    })
  }
}
