import type { AgentState, NativeToolExecutionResult } from '../types/index.ts'
import { GuiController } from '../action/gui-controller.ts'
import type { McpHost } from '../mcp/mcp-host.ts'
import type { FirecrawlSearchTool } from '../tools/firecrawl-search.ts'
import type { Logger } from '../system/logger.ts'
import type { ContextManager } from '../memory/context-manager.ts'
import { NativeToolRegistry, type ToolCall, type ToolExecutionContext } from '../tools/native-tool-registry.ts'
import { PlaywrightBrowserController } from '../action/browser-controller.ts'
import { UniversalClient } from '../llm/universal-client.ts'

export interface ExecutorDependencies {
  gui: GuiController
  mcp: McpHost
  firecrawl: FirecrawlSearchTool
  client: UniversalClient
  logger: Logger
  contextManager: ContextManager
  fastModel: string
  workspaceRoot: string
  browser?: PlaywrightBrowserController
}

export class Executor {
  private readonly deps: ExecutorDependencies
  private readonly registry: NativeToolRegistry
  private readonly browser: PlaywrightBrowserController

  constructor(deps: ExecutorDependencies) {
    this.deps = deps
    this.registry = new NativeToolRegistry()
    this.browser = deps.browser || new PlaywrightBrowserController()
  }

  listTools() {
    return this.registry.list()
  }

  isDangerous(toolName: string, args: Record<string, unknown>): boolean {
    return this.registry.isDangerous(toolName, args)
  }

  async execute(toolCall: ToolCall, state: AgentState, goal: string): Promise<NativeToolExecutionResult> {
    const context: ToolExecutionContext = {
      goal,
      state,
      gui: this.deps.gui,
      browser: this.browser,
      mcp: this.deps.mcp,
      firecrawl: this.deps.firecrawl,
      client: this.deps.client,
      logger: this.deps.logger,
      contextManager: this.deps.contextManager,
      fastModel: this.deps.fastModel,
      workspaceRoot: this.deps.workspaceRoot
    }

    return await this.registry.execute(toolCall, context)
  }
}
