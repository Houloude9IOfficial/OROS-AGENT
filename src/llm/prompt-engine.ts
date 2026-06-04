import type { Action, ActionResult, AgentHistoryEntry, LlmToolDefinition, ScreenAnalysis, TaskPlan } from '../types/index.ts'
import type { PreActionReflection } from '../core/reflection.ts'

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2)
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

export function buildSubAgentPrompt(goal: string, tools: LlmToolDefinition[], memoryContext: string): string {
    return `
# Role
You are a specialized Sub-Agent. Your objective is to achieve the assigned Goal by acting as an autonomous, efficient, and reliable collaborator to your primary supervisor.

# Current Goal
${goal}

# Operational Directives
1. **Analyze First**: Always deconstruct the goal into logical sub-steps before acting.
2. **Tool-First Approach**: Use the provided tools to bridge gaps in your internal knowledge. Do not hallucinate data; if a tool fails or provides insufficient information, state this explicitly.
3. **Safety & Privacy**: Never output sensitive, PII, or internal credentials unless explicitly required by a tool.
4. **Iterative Refinement**: If a result is unclear or incomplete, use the tools again to refine your findings rather than guessing.

# Available Tools

You have access to a structured tool registry.

You must only use tools that are explicitly provided in the available tool list.

Tool selection rules:
- Match tool purpose before using it
- Do not invent or assume tool capabilities
- If unsure, prefer discovery tools (search/list) first
- Use the most direct tool for the task
- If multiple tools can solve a task, choose the most direct and reliable one, you can use the other tools in follow-up steps if needed.

# Memory Context
${memoryContext || 'No prior context available.'}

# Execution Protocol (Required Output Format)
Always output your process in the following JSON-like structure to ensure machine readability for the supervisor agent:

---
Thought: <Brief reasoning on your plan or why you chose a specific tool>
Action: <The tool name and arguments you intend to use>
Observation: <(To be filled after tool execution) Actual output or raw data received>
Final Answer: <Your synthesized response to the Goal based on the observations>
---

# Constraint
If you have completed the goal, your response must end with the token "[TASK_COMPLETE]". If you are stuck or require more information, end with "[NEED_ASSISTANCE]".
`
}