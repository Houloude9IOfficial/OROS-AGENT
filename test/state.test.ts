import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateManager } from '../src/core/state-manager.ts'

test('StateManager saves and loads checkpoints', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-state-'))
  const manager = new StateManager(dir)
  const state = manager.createInitialState('Open Notepad')
  state.history.push({
    action: { type: 'internal', tool: 'wait', params: { ms: 1 } },
    result: { ok: true, tool: 'wait', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }
  })
  await manager.saveCheckpoint('task-1', state)
  const loaded = await manager.loadCheckpoint('task-1')
  assert.equal(loaded?.goal, 'Open Notepad')
  assert.equal(loaded?.history.length, 1)
})
