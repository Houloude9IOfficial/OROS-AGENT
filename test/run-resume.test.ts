import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { StateManager } from '../src/core/state-manager.ts'

function makeEnv(dataDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OROS_DATA_DIR: dataDir,
    OROS_ACCEPT_RISKS: '1',
    OROS_OLLAMA_URL: 'http://127.0.0.1:0'
  }
}

test('run smoke test completes and prints a JSON summary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-run-'))
  const result = spawnSync(process.execPath, ['src/index.ts', 'run', 'Take a screenshot'], {
    cwd: process.cwd(),
    env: makeEnv(dir),
    encoding: 'utf8'
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /"goal":\s*"Take a screenshot"/)
  assert.match(result.stdout, /"history":\s*\d+/)
})

test('resume integration test continues from a saved checkpoint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-resume-'))
  const stateManager = new StateManager(join(dir, 'state'))
  await stateManager.saveCheckpoint('resume-test', {
    goal: 'Take a screenshot',
    history: [],
    paused: false,
    stopped: false,
    waitingForUser: false
  })

  const result = spawnSync(process.execPath, ['src/index.ts', 'resume', '--task-id', 'resume-test'], {
    cwd: process.cwd(),
    env: makeEnv(dir),
    encoding: 'utf8'
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /"resumed":\s*true/)
})
