import type { RegisteredTool } from '../types/index.ts'
import type { Action, LlmToolDefinition } from '../types/index.ts'

export function toolToAction(tool: RegisteredTool, args: Record<string, unknown>): Action {
  if (tool.server) {
    return {
      type: 'mcp',
      server: tool.server,
      tool: tool.name,
      args
    }
  }

  throw new Error(`Tool ${tool.name} is not attached to a server`)
}

export function toolToLlmToolDefinition(tool: RegisteredTool): LlmToolDefinition {
  return {
    type: 'function',
    function: {
      name: `mcp_${tool.server || 'server'}_${tool.name}`,
      description: tool.description || `MCP tool ${tool.name}`,
      parameters: tool.inputSchema
    }
  }
}
