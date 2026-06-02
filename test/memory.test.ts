import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StructuredStore } from '../src/memory/structured-store.ts'
import { VectorStore } from '../src/memory/vector-store.ts'

test('StructuredStore persists JSON compatible data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-structured-'))
  const store = new StructuredStore(dir)
  await store.write('user_preferences.yaml', { browser: 'chrome', theme: 'light' })
  const loaded = await store.read('user_preferences.yaml', {})
  assert.equal((loaded as Record<string, string>).browser, 'chrome')
})

test('VectorStore ranks closer embeddings higher', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-vector-'))
  const store = new VectorStore(join(dir, 'episodes.json'))
  await store.addEpisode({
    id: '1',
    timestamp: Date.now(),
    goal: 'alpha',
    action: { type: 'internal', tool: 'wait', params: {} },
    result: { ok: true, tool: 'wait', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
    screenshotEmbedding: [1, 0, 0],
    textEmbedding: [1, 0, 0],
    tags: ['alpha']
  })
  await store.addEpisode({
    id: '2',
    timestamp: Date.now(),
    goal: 'beta',
    action: { type: 'internal', tool: 'wait', params: {} },
    result: { ok: true, tool: 'wait', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
    screenshotEmbedding: [0, 1, 0],
    textEmbedding: [0, 1, 0],
    tags: ['beta']
  })

  const results = await store.search([1, 0, 0], 2)
  assert.equal(results[0]?.episode.goal, 'alpha')
})
