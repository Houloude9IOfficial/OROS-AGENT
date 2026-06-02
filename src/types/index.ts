export type TaskComplexity = 'simple' | 'complex'

export interface RuntimeConfig {
  retryLimit: number
  screenshotWidth: number
  screenshotQuality: number
  checkpointIntervalMs: number
  memoryTopK: number
  historySummarizeEvery: number
  maxToolCallsPerTask: number
  repeatedFailureLimit: number
}

export interface OllamaModelConfig {
  fast: string
  planner: string
  embeddings: string
}

export interface OllamaConfig {
  baseUrl: string
}

export interface PreferencesConfig {
  browser: string
  editor: string
  terminal: string
}

export interface OrosConfig {
  models: OllamaModelConfig
  ollama: OllamaConfig
  runtime: RuntimeConfig
  mcpServers: Record<string, McpServerConfig>
  preferences: PreferencesConfig
}

export interface McpServerConfig {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface PlanTask {
  id: string
  description: string
  complexity: TaskComplexity
  dependencies: string[]
  verification: string
}

export interface TaskPlan {
  goal: string
  tasks: PlanTask[]
}

export interface GoalClassification {
  complexity: TaskComplexity
  reason: string
}

export interface ScreenSnapshot {
  capturedAt: string
  width: number
  height: number
  imageBase64: string
  hash: string
  rawBuffer: Buffer
}

export interface ScreenAnalysis {
  description: string
  visibleTitles: string[]
  interactiveElements: string[]
  confidence: number
}

export type GuiAction =
  | {
      type: 'gui'
      tool: 'mouse_click'
      params: { x: number; y: number; button?: 'left' | 'right' }
    }
  | {
      type: 'gui'
      tool: 'mouse_move'
      params: { x: number; y: number; duration?: number }
    }
  | {
      type: 'gui'
      tool: 'keyboard_type'
      params: { text: string }
    }
  | {
      type: 'gui'
      tool: 'key_combo'
      params: { keys: string[] }
    }
  | {
      type: 'gui'
      tool: 'scroll'
      params: { amount: number }
    }
  | {
      type: 'gui'
      tool: 'find_and_click'
      params: { imageQuery: string; button?: 'left' | 'right' }
    }

export interface ShellAction {
  type: 'shell'
  tool: 'powershell' | 'cmd' | 'wsl'
  params: {
    command: string
    cwd?: string
    timeout?: number
    env?: Record<string, string>
  }
}

export interface InternalAction {
  type: 'internal'
  tool: string
  params: Record<string, unknown>
}

export interface AgentHistoryEntry {
  action: Action
  result: ActionResult
  screenshotHash?: string
  preReflection?: string
  postReflection?: string
}

export interface McpAction {
  type: 'mcp'
  server: string
  tool: string
  args: Record<string, unknown>
}

export type Action = GuiAction | ShellAction | InternalAction | McpAction

export interface ActionResult {
  ok: boolean
  tool: string
  startedAt: string
  finishedAt: string
  stdout?: string
  stderr?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface Episode {
  id: string
  timestamp: number
  goal: string
  action: Action
  result: ActionResult
  screenshotEmbedding: number[]
  textEmbedding: number[]
  tags: string[]
  summary?: string
}

export interface Lesson {
  id: string
  createdAt: string
  goal: string
  summary: string
  evidence: string[]
}

export interface MemoryQueryResult {
  episode: Episode
  score: number
}

export interface AgentCheckpoint {
  goal: string
  history: AgentHistoryEntry[]
  plan?: TaskPlan
  currentTaskId?: string
  paused: boolean
  stopped: boolean
  updatedAt: string
}

export interface AgentState {
  goal: string
  history: AgentHistoryEntry[]
  plan?: TaskPlan
  currentTaskId?: string
  paused: boolean
  stopped: boolean
  waitingForUser: boolean
}

export interface LlmToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface LlmGenerateOptions {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  tools?: LlmToolDefinition[]
  format?: 'json'
  images?: string[]
  temperature?: number
}

export interface LlmGenerateResponse {
  text: string
  raw?: unknown
}

export interface NativeToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface NativeToolCall {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface NativeToolExecutionResult {
  ok: boolean
  tool: string
  content: string
  metadata?: Record<string, unknown>
  error?: string
}

export interface ToolMessage {
  role: 'tool'
  content: string
  tool_name: string
}

export interface AgentChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_calls?: NativeToolCall[]
  tool_name?: string
}

export interface ToolInvocation {
  tool: string
  args: Record<string, unknown>
}

export interface HotkeyEvent {
  type: 'pause' | 'resume' | 'stop'
  source: 'stdin' | 'global-hotkey'
}

export interface RegisteredTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  server?: string
}
