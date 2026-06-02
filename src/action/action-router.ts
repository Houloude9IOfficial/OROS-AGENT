import type { Action, McpAction } from '../types/index.ts'
import type { RegisteredTool } from '../types/index.ts'

export type ActionRoute = 'gui' | 'shell' | 'internal' | 'mcp'

export function routeAction(action: Action): ActionRoute {
  return action.type
}

export function inferMcpAction(tool: RegisteredTool, serverName: string, args: Record<string, unknown>): McpAction {
  return {
    type: 'mcp',
    server: serverName,
    tool: tool.name,
    args
  }
}
