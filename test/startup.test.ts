import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('running the app with no args prints usage instead of starting doctor mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-startup-'))
  const result = spawnSync(process.execPath, ['src/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, OROS_DATA_DIR: dir },
    encoding: 'utf8'
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /npm run doctor/)
  assert.match(result.stdout, /Risks not yet accepted\./)
})

test('accept-risks command saves consent for later runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-startup-'))
  const result = spawnSync(process.execPath, ['src/index.ts', 'accept-risks'], {
    cwd: process.cwd(),
    env: { ...process.env, OROS_DATA_DIR: dir },
    encoding: 'utf8'
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Risk acceptance saved/i)
})
