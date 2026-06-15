import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../src/system/config.ts'

test('loadConfig merges defaults and file values', async () => {
  const oldFast = process.env.OROS_FAST_MODEL
  const oldPlanner = process.env.OROS_PLANNER_MODEL
  const oldEmbeddings = process.env.OROS_EMBEDDINGS_MODEL
  delete process.env.OROS_FAST_MODEL
  delete process.env.OROS_PLANNER_MODEL
  delete process.env.OROS_EMBEDDINGS_MODEL
  
  const dir = await mkdtemp(join(tmpdir(), 'oros-config-'))
  const file = join(dir, 'oros.config.json')
  await saveConfig({
    ...DEFAULT_CONFIG,
    models: { ...DEFAULT_CONFIG.models, fast: 'test-fast' }
  }, file)

  try {
    const config = await loadConfig(file)
    assert.equal(config.models.fast, 'test-fast')
    assert.equal(config.models.planner, DEFAULT_CONFIG.models.planner)
  } finally {
    process.env.OROS_FAST_MODEL = oldFast
    process.env.OROS_PLANNER_MODEL = oldPlanner
    process.env.OROS_EMBEDDINGS_MODEL = oldEmbeddings
  }
})

test('loadConfig honors environment overrides', async () => {
  const old = process.env.OROS_FAST_MODEL
  process.env.OROS_FAST_MODEL = 'env-fast'
  const config = await loadConfig()
  assert.equal(config.models.fast, 'env-fast')
  process.env.OROS_FAST_MODEL = old
})
