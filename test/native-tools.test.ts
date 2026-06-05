import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeToolRegistry } from '../src/tools/native-tool-registry.ts'
import { SessionConfirmationGate } from '../src/system/confirmation.ts'
import { PlaywrightBrowserController } from '../src/action/browser-controller.ts'
import { UniversalClient } from '../src/llm/universal-client.ts'

test('OllamaClient chat forwards tool definitions and returns tool calls', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    requests.push({ url, body })
    return new Response(JSON.stringify({
      model: 'test',
      created_at: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'fs_write_file',
              arguments: { path: 'hello.txt', content: 'hi' }
            }
          }
        ]
      },
      done: true,
      done_reason: 'stop',
      total_duration: 1,
      load_duration: 1,
      prompt_eval_count: 1,
      prompt_eval_duration: 1,
      eval_count: 1,
      eval_duration: 1
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch

  try {
    const client = new UniversalClient(1800000)
    const response = await client.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'write file' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'fs_write_file',
            description: 'Write a file',
            parameters: {}
          }
        }
      ]
    })

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url.endsWith('/api/chat'), true)
    assert.equal(Array.isArray(requests[0]?.body.tools), true)
    assert.equal(response.message.tool_calls?.[0]?.function.name, 'fs_write_file')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('SessionConfirmationGate caches a session approval decision', async () => {
  let promptCount = 0
  const gate = new SessionConfirmationGate({
    prompt: async () => {
      promptCount += 1
      return true
    }
  })

  const first = await gate.allow({
    toolName: 'shell_execute',
    summary: 'Runs code',
    arguments: { command: 'dir' }
  })
  const second = await gate.allow({
    toolName: 'shell_execute',
    summary: 'Runs code again',
    arguments: { command: 'echo hi' }
  })

  assert.equal(first, true)
  assert.equal(second, true)
  assert.equal(promptCount, 1)
})

test('NativeToolRegistry edits files and refuses missing replacements', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-native-tools-'))
  const filePath = join(dir, 'notes.txt')
  await writeFile(filePath, 'alpha beta', 'utf8')

  const registry = new NativeToolRegistry()
  const client = new UniversalClient(1800000)
  const editResult = await registry.execute({
    function: {
      name: 'fs_edit_file',
      arguments: { path: filePath, find: 'beta', replace: 'gamma' }
    }
  }, {
    goal: 'edit',
    state: { goal: 'edit', history: [], paused: false, stopped: false, waitingForUser: false },
    client,
    gui: { execute: async () => ({ ok: true, tool: 'gui', startedAt: '', finishedAt: '' }) } as any,
    browser: {
      async open() { return { ok: false, content: '', error: 'unused' } },
      async content() { return { ok: false, content: '', error: 'unused' } },
      async click() { return { ok: false, content: '', error: 'unused' } },
      async type() { return { ok: false, content: '', error: 'unused' } },
      async press() { return { ok: false, content: '', error: 'unused' } },
      async screenshot() { return { ok: false, content: '', error: 'unused' } },
      async close() { return { ok: false, content: '', error: 'unused' } }
    } as any,
    mcp: { async callTool() { return {} } } as any,
    firecrawl: { async search() { return { text: '' } } } as any,
    logger: { debug() {}, info() {}, warn() {}, error() {}, success() {}, other() {} },
    contextManager: { async getRelevantContext() { return { summary: '', episodes: [] } } } as any,
    fastModel: 'test',
    workspaceRoot: dir
  })

  assert.equal(editResult.ok, true)
  assert.match(await readFile(filePath, 'utf8'), /gamma/)

  const failedEdit = await registry.execute({
    function: {
      name: 'fs_edit_file',
      arguments: { path: filePath, find: 'missing', replace: 'noop' }
    }
  }, {
    goal: 'edit',
    state: { goal: 'edit', history: [], paused: false, stopped: false, waitingForUser: false },
    client,
    gui: { execute: async () => ({ ok: true, tool: 'gui', startedAt: '', finishedAt: '' }) } as any,
    browser: {
      async open() { return { ok: false, content: '', error: 'unused' } },
      async content() { return { ok: false, content: '', error: 'unused' } },
      async click() { return { ok: false, content: '', error: 'unused' } },
      async type() { return { ok: false, content: '', error: 'unused' } },
      async press() { return { ok: false, content: '', error: 'unused' } },
      async screenshot() { return { ok: false, content: '', error: 'unused' } },
      async close() { return { ok: false, content: '', error: 'unused' } }
    } as any,
    mcp: { async callTool() { return {} } } as any,
    firecrawl: { async search() { return { text: '' } } } as any,
    logger: { debug() {}, info() {}, warn() {}, error() {}, success() {}, other() {} },
    contextManager: { async getRelevantContext() { return { summary: '', episodes: [] } } } as any,
    fastModel: 'test',
    workspaceRoot: dir
  })

  assert.equal(failedEdit.ok, false)
  assert.match(failedEdit.error || '', /Text not found/i)
})

test('NativeToolRegistry can drive browser tools through the controller', async () => {
  const calls: string[] = []
  const browser = {
    async open(url: string) {
      calls.push(`open:${url}`)
      return {
        ok: true,
        content: 'browser page',
        snapshot: {
          url,
          title: 'Example',
          content: 'Example page',
          imageBase64: 'aGVsbG8='
        }
      }
    },
    async content() {
      calls.push('content')
      return { ok: true, content: 'browser page' }
    },
    async click(x: number, y: number) {
      calls.push(`click:${x},${y}`)
      return { ok: true, content: 'clicked' }
    },
    async type(text: string) {
      calls.push(`type:${text}`)
      return { ok: true, content: 'typed' }
    },
    async press(keys: string[]) {
      calls.push(`press:${keys.join('+')}`)
      return { ok: true, content: 'pressed' }
    },
    async screenshot() {
      calls.push('screenshot')
      return {
        ok: true,
        content: 'screenshot',
        snapshot: {
          url: 'https://example.com',
          title: 'Example',
          content: 'Example page',
          imageBase64: 'aGVsbG8='
        }
      }
    },
    async close() {
      calls.push('close')
      return { ok: true, content: 'closed' }
    }
  }

  const registry = new NativeToolRegistry()
  const client = new UniversalClient(1800000)
  const baseContext = {
    goal: 'browser',
    state: { goal: 'browser', history: [], paused: false, stopped: false, waitingForUser: false },
    client,
    gui: { execute: async () => ({ ok: true, tool: 'gui', startedAt: '', finishedAt: '' }) } as any,
    browser: browser as any,
    mcp: { async callTool() { return {} } } as any,
    firecrawl: { async search() { return { text: '' } } } as any,
    logger: { debug() {}, info() {}, warn() {}, error() {}, success() {}, other() {} },
    contextManager: { async getRelevantContext() { return { summary: '', episodes: [] } } } as any,
    fastModel: 'test',
    workspaceRoot: process.cwd()
  }

  const open = await registry.execute({ function: { name: 'browser_open', arguments: { url: 'https://example.com' } } }, baseContext)
  const click = await registry.execute({ function: { name: 'browser_click', arguments: { x: 10, y: 20 } } }, baseContext)
  const type = await registry.execute({ function: { name: 'browser_type', arguments: { text: 'hello' } } }, baseContext)
  const press = await registry.execute({ function: { name: 'browser_press', arguments: { keys: ['Enter'] } } }, baseContext)
  const shot = await registry.execute({ function: { name: 'browser_screenshot', arguments: {} } }, baseContext)
  const close = await registry.execute({ function: { name: 'browser_close', arguments: {} } }, baseContext)

  assert.equal(open.ok, true)
  assert.equal(click.ok, true)
  assert.equal(type.ok, true)
  assert.equal(press.ok, true)
  assert.equal(shot.ok, true)
  assert.equal(close.ok, true)
  assert.deepEqual(calls, [
    'open:https://example.com',
    'click:10,20',
    'type:hello',
    'press:Enter',
    'screenshot',
    'close'
  ])
})

test('NativeToolRegistry can search and open apps via the shell runner', async () => {
  const commands: string[] = []
  const registry = new NativeToolRegistry({
    shellRunner: async action => {
      commands.push(action.params.command)
      if (action.params.command.includes('Get-StartApps')) {
        return {
          ok: true,
          tool: action.tool,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          stdout: [
            'start-app\tNotepad\tMicrosoft.WindowsNotepad_8wekyb3d8bbwe!App',
            'command\tnotepad.exe\tC:\\Windows\\System32\\notepad.exe'
          ].join('\n')
        }
      }
      return {
        ok: true,
        tool: action.tool,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        stdout: 'Opened Notepad'
      }
    }
  })

  const client = new UniversalClient(1800000)
  const context = {
    goal: 'search apps',
    state: { goal: 'search apps', history: [], paused: false, stopped: false, waitingForUser: false },
    client,
    gui: { execute: async () => ({ ok: true, tool: 'gui', startedAt: '', finishedAt: '' }) } as any,
    browser: {
      async open() { return { ok: false, content: '', error: 'unused' } },
      async content() { return { ok: false, content: '', error: 'unused' } },
      async click() { return { ok: false, content: '', error: 'unused' } },
      async type() { return { ok: false, content: '', error: 'unused' } },
      async press() { return { ok: false, content: '', error: 'unused' } },
      async screenshot() { return { ok: false, content: '', error: 'unused' } },
      async close() { return { ok: false, content: '', error: 'unused' } }
    } as any,
    mcp: { async callTool() { return {} } } as any,
    firecrawl: { async search() { return { text: '' } } } as any,
    logger: { debug() {}, info() {}, warn() {}, error() {}, success() {}, other() {} },
    contextManager: { async getRelevantContext() { return { summary: '', episodes: [] } } } as any,
    fastModel: 'test',
    workspaceRoot: process.cwd()
  }

  const search = await registry.execute({
    function: {
      name: 'app_search',
      arguments: { query: 'notepad', limit: 5 }
    }
  }, context)

  const open = await registry.execute({
    function: {
      name: 'app_open',
      arguments: { query: 'notepad' }
    }
  }, context)

  assert.equal(search.ok, true)
  assert.match(search.content, /Notepad/i)
  assert.equal(open.ok, true)
  assert.ok(commands.some(command => command.includes('Get-StartApps')))
  assert.ok(commands.some(command => command.includes('Start-Process')))
})

test('NativeToolRegistry can search the workspace with literal and regex queries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-workspace-search-'))
  const nested = join(dir, 'docs')
  await mkdir(nested, { recursive: true })
  await writeFile(join(dir, 'notes.txt'), 'hello world\nsecond line\n', 'utf8')
  await writeFile(join(nested, 'deep.md'), 'alpha beta\ngamma hello\n', 'utf8')

  const registry = new NativeToolRegistry()
  const client = new UniversalClient(1800000)
  const baseContext = {
    goal: 'search files',
    state: { goal: 'search files', history: [], paused: false, stopped: false, waitingForUser: false },
    client,
    gui: { execute: async () => ({ ok: true, tool: 'gui', startedAt: '', finishedAt: '' }) } as any,
    browser: {
      async open() { return { ok: false, content: '', error: 'unused' } },
      async content() { return { ok: false, content: '', error: 'unused' } },
      async click() { return { ok: false, content: '', error: 'unused' } },
      async type() { return { ok: false, content: '', error: 'unused' } },
      async press() { return { ok: false, content: '', error: 'unused' } },
      async screenshot() { return { ok: false, content: '', error: 'unused' } },
      async close() { return { ok: false, content: '', error: 'unused' } }
    } as any,
    mcp: { async callTool() { return {} } } as any,
    firecrawl: { async search() { return { text: '' } } } as any,
    logger: { debug() {}, info() {}, warn() {}, error() {}, success() {}, other() {} },
    contextManager: { async getRelevantContext() { return { summary: '', episodes: [] } } } as any,
    fastModel: 'test',
    workspaceRoot: dir
  }

  const literal = await registry.execute({
    function: {
      name: 'workspace_search',
      arguments: { query: 'hello', root: dir, limit: 10 }
    }
  }, baseContext)

  const regex = await registry.execute({
    function: {
      name: 'workspace_regex_search',
      arguments: { pattern: 'hello\\s+world', flags: 'i', root: dir, limit: 10 }
    }
  }, baseContext)

  assert.equal(literal.ok, true)
  assert.match(literal.content, /notes\.txt:1/i)
  assert.match(literal.content, /deep\.md:2/i)
  assert.equal(regex.ok, true)
  assert.match(regex.content, /hello world/i)
})

test('NativeToolRegistry can clear the console and print a final response', async () => {
  const writes: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  const originalClear = console.clear
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString())
    return true
  }) as typeof process.stdout.write
  console.clear = () => {
    writes.push('[clear]')
  }

  try {
    const registry = new NativeToolRegistry()
    const client = new UniversalClient(1800000)
    const result = await registry.execute({
      function: {
        name: 'console_finalize',
        arguments: { text: 'Final summary', clear: true }
      }
    }, {
      goal: 'finalize',
      state: { goal: 'finalize', history: [], paused: false, stopped: false, waitingForUser: false },
      client,
      gui: { execute: async () => ({ ok: true, tool: 'gui', startedAt: '', finishedAt: '' }) } as any,
      browser: {
        async open() { return { ok: false, content: '', error: 'unused' } },
        async content() { return { ok: false, content: '', error: 'unused' } },
        async click() { return { ok: false, content: '', error: 'unused' } },
        async type() { return { ok: false, content: '', error: 'unused' } },
        async press() { return { ok: false, content: '', error: 'unused' } },
        async screenshot() { return { ok: false, content: '', error: 'unused' } },
        async close() { return { ok: false, content: '', error: 'unused' } }
      } as any,
      mcp: { async callTool() { return {} } } as any,
      firecrawl: { async search() { return { text: '' } } } as any,
      logger: { debug() {}, info() {}, warn() {}, error() {}, success() {}, other() {} },
      contextManager: { async getRelevantContext() { return { summary: '', episodes: [] } } } as any,
      fastModel: 'test',
      workspaceRoot: process.cwd()
    })

    assert.equal(result.ok, true)
    assert.ok(writes.some(entry => entry.includes('[clear]')))
    assert.ok(writes.some(entry => entry.includes('Final summary')))
  } finally {
    process.stdout.write = originalWrite
    console.clear = originalClear
  }
})

test('PlaywrightBrowserController can reuse an injected browser and capture snapshots', async () => {
  const events: string[] = []
  const page = {
    isClosed() { return false },
    async goto(url: string) { events.push(`goto:${url}`) },
    async title() { return 'Injected Page' },
    url() { return 'https://example.com' },
    async evaluate() { return 'Hello from the page' },
    async screenshot() { return Buffer.from('mock-image') },
    mouse: {
      async click(x: number, y: number) { events.push(`click:${x},${y}`) }
    },
    keyboard: {
      async type(text: string) { events.push(`type:${text}`) },
      async press(key: string) { events.push(`press:${key}`) }
    },
    async close() { events.push('page-close') }
  }
  const context = {
    async newPage() {
      events.push('new-page')
      return page
    },
    async close() { events.push('context-close') }
  }
  const browser = {
    async newContext() {
      events.push('new-context')
      return context
    },
    async close() { events.push('browser-close') }
  }

  const controller = new PlaywrightBrowserController({
    launcher: async () => browser as any
  })

  const open = await controller.open('https://example.com')
  const click = await controller.click(5, 6)
  const type = await controller.type('abc')
  const press = await controller.press(['Enter'])
  const shot = await controller.screenshot()
  const close = await controller.close()

  assert.equal(open.ok, true)
  assert.equal(open.snapshot?.title, 'Injected Page')
  assert.equal(click.ok, true)
  assert.equal(type.ok, true)
  assert.equal(press.ok, true)
  assert.equal(shot.ok, true)
  assert.equal(close.ok, true)
  assert.deepEqual(events, [
    'new-context',
    'new-page',
    'goto:https://example.com',
    'click:5,6',
    'type:abc',
    'press:Enter',
    'page-close',
    'context-close',
    'browser-close'
  ])
})
