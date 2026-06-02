import test from 'node:test'
import assert from 'node:assert/strict'
import { runShellAction } from '../src/action/shell-runner.ts'

test('runShellAction executes a simple command', async () => {
  const result = await runShellAction({
    type: 'shell',
    tool: 'cmd',
    params: {
      command: 'echo hello'
    }
  })

  assert.equal(result.ok, true)
  assert.match(result.stdout || '', /hello/i)
})
