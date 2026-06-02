import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envAcceptedRisks, ensureAcceptedRisks, saveAcceptedRisks } from '../src/system/consent.ts'

test('envAcceptedRisks reads npm config style env vars', () => {
  const original = process.env.npm_config_i_understand_the_risks
  const originalArgv = process.env.npm_config_argv
  try {
    process.env.npm_config_i_understand_the_risks = 'true'
    assert.equal(envAcceptedRisks(), true)
    process.env.npm_config_i_understand_the_risks = ''
    process.env.npm_config_argv = JSON.stringify({
      original: ['run', 'start', '--', 'run', 'goal', '--i-understand-the-risks'],
      cooked: ['run', 'start', '--', 'run', 'goal']
    })
    assert.equal(envAcceptedRisks(), true)
  } finally {
    process.env.npm_config_i_understand_the_risks = original
    process.env.npm_config_argv = originalArgv
  }
})

test('ensureAcceptedRisks persists acceptance in temp storage', async () => {
  const original = process.env.OROS_DATA_DIR
  const dir = await mkdtemp(join(tmpdir(), 'oros-consent-'))
  process.env.OROS_DATA_DIR = dir

  await saveAcceptedRisks('command')
  assert.equal(await ensureAcceptedRisks(), true)

  process.env.OROS_DATA_DIR = original
})
