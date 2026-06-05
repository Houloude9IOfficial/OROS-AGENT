import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../src/system/logger.ts'
import { Planner } from '../src/core/planner.ts'
import { StructuredStore } from '../src/memory/structured-store.ts'
import { StateManager } from '../src/core/state-manager.ts'
import { VectorStore } from '../src/memory/vector-store.ts'
import { Embedder } from '../src/memory/embedder.ts'
import { ContextManager } from '../src/memory/context-manager.ts'
import { buildPlanSummary } from '../src/llm/prompt-engine.ts'
import { UniversalClient } from '../src/llm/universal-client.ts'

function mockFetchOnce(handler: (url: string, init: RequestInit) => Promise<unknown>): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const payload = await handler(url, init || {})
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

test('OllamaClient generate and embed work against a mocked fetch implementation', async () => {
  const restore = mockFetchOnce(async url => {
    if (url.endsWith('/api/chat')) {
      return { message: { content: 'hello from ollama' } }
    }
    if (url.endsWith('/api/embeddings')) {
      return { embedding: [0.1, 0.2, 0.3] }
    }
    return {}
  })

  try {
    const client = new UniversalClient(1800000)
    const generated = await client.generate({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Say hello' }]
    })
    const embedding = await client.embed('test-embed', 'hello')

    assert.equal(generated.text, 'hello from ollama')
    assert.deepEqual(embedding, [0.1, 0.2, 0.3])
  } finally {
    restore()
  }
})

test('Planner parses JSON plans returned by Ollama', async () => {
  const restore = mockFetchOnce(async url => {
    if (url.endsWith('/api/chat')) {
      return {
        message: {
          content: JSON.stringify({
            goal: 'Open Notepad',
            tasks: [
              {
                id: '1',
                description: 'Open Notepad',
                complexity: 'simple',
                dependencies: [],
                verification: 'Notepad is visible'
              }
            ]
          })
        }
      }
    }
    return {}
  })

  try {
    const planner = new Planner('http://localhost:11434', 'planner-model')
    const plan = await planner.decompose('Open Notepad')
    assert.equal(plan.tasks[0]?.description, 'Open Notepad')
  } finally {
    restore()
  }
})

test('StructuredStore appendListItem keeps JSON compatible storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-structured-append-'))
  const store = new StructuredStore(dir)
  await store.appendListItem('project_contexts.yaml', 'projects', { name: 'oros' })
  const loaded = await store.read<Record<string, unknown>>('project_contexts.yaml', {})
  assert.ok(Array.isArray(loaded.projects))
  assert.equal((loaded.projects as Array<{ name: string }>)[0]?.name, 'oros')
})

test('StateManager can clear checkpoints after a task finishes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-state-clear-'))
  const manager = new StateManager(dir)
  const state = manager.createInitialState('Open Notepad')
  await manager.saveCheckpoint('task-2', state)
  await manager.clearCheckpoint('task-2')
  const loaded = await manager.loadCheckpoint('task-2')
  assert.equal(loaded, undefined)
})

test('createLogger writes best-effort output without crashing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-logger-'))
  const logFile = join(dir, 'oros.log')
  const logger = createLogger(logFile)
  logger.info('hello', { ok: true })
  await new Promise(resolve => setTimeout(resolve, 50))
  const content = await readFile(logFile, 'utf8')
  assert.match(content, /hello/)
})

test('buildPlanSummary formats plan tasks', () => {
  const summary = buildPlanSummary({
    goal: 'Open Notepad',
    tasks: [
      {
        id: '1',
        description: 'Open Notepad',
        complexity: 'simple',
        dependencies: [],
        verification: 'Notepad is open'
      }
    ]
  })

  assert.match(summary, /Open Notepad/)
})

test('ContextManager compacts recent history into a lesson', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-context-'))
  const vectorStore = new VectorStore(join(dir, 'episodes.json'))
  const structuredStore = new StructuredStore(dir)
  const embedder = new Embedder(new UniversalClient(1800000), 'embed-model')
  const contextManager = new ContextManager(vectorStore, embedder, structuredStore, 5)
  const lesson = await contextManager.compactHistory('Open Notepad', [
    {
      action: { type: 'internal', tool: 'wait', params: {} },
      result: { ok: true, tool: 'wait', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), stdout: 'done' }
    }
  ])

  assert.match(lesson.summary, /Open Notepad/)
  const stored = await structuredStore.read<Record<string, unknown>>('lessons_learned.json', {})
  assert.ok(Array.isArray(stored.lessons))
})
