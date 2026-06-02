import type { Action, GuiAction, InternalAction, McpAction, ShellAction } from '../types/index.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function isGuiAction(action: unknown): action is GuiAction {
  if (!isRecord(action) || action.type !== 'gui' || typeof action.tool !== 'string' || !isRecord(action.params)) {
    return false
  }

  switch (action.tool) {
    case 'mouse_click':
      return typeof action.params.x === 'number' && typeof action.params.y === 'number'
    case 'mouse_move':
      return typeof action.params.x === 'number' && typeof action.params.y === 'number'
    case 'keyboard_type':
      return typeof action.params.text === 'string'
    case 'key_combo':
      return isStringArray(action.params.keys)
    case 'scroll':
      return typeof action.params.amount === 'number'
    case 'find_and_click':
      return typeof action.params.imageQuery === 'string'
    default:
      return false
  }
}

export function isShellAction(action: unknown): action is ShellAction {
  return isRecord(action) && action.type === 'shell' && typeof action.tool === 'string' && isRecord(action.params) && typeof action.params.command === 'string'
}

export function isInternalAction(action: unknown): action is InternalAction {
  return isRecord(action) && action.type === 'internal' && typeof action.tool === 'string' && isRecord(action.params)
}

export function isMcpAction(action: unknown): action is McpAction {
  return isRecord(action) && action.type === 'mcp' && typeof action.server === 'string' && typeof action.tool === 'string' && isRecord(action.args)
}

export function isAction(action: unknown): action is Action {
  return isGuiAction(action) || isShellAction(action) || isInternalAction(action) || isMcpAction(action)
}

export function normalizeAction(action: unknown): Action {
  if (!isAction(action)) {
    throw new Error('Invalid action payload')
  }

  if (action.type === 'gui' && action.tool === 'mouse_click') {
    return {
      ...action,
      params: {
        button: action.params.button || 'left',
        x: Math.round(action.params.x),
        y: Math.round(action.params.y)
      }
    }
  }

  return action
}
