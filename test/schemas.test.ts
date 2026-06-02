import test from 'node:test'
import assert from 'node:assert/strict'
import { isAction, isGuiAction, isMcpAction, isShellAction } from '../src/action/schemas.ts'

test('action validators accept supported action shapes', () => {
  assert.equal(
    isGuiAction({ type: 'gui', tool: 'keyboard_type', params: { text: 'Hello' } }),
    true
  )
  assert.equal(
    isShellAction({ type: 'shell', tool: 'powershell', params: { command: 'dir' } }),
    true
  )
  assert.equal(
    isMcpAction({ type: 'mcp', server: 'filesystem', tool: 'list', args: {} }),
    true
  )
  assert.equal(
    isAction({ type: 'internal', tool: 'wait', params: { ms: 1 } }),
    true
  )
})
