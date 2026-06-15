import test from 'node:test'
import assert from 'node:assert/strict'
import { Agent } from '../src/core/agent.ts'
import { DEFAULT_CONFIG } from '../src/system/config.ts'

function createAgent(overrides: Record<string, unknown> = {}): Agent {
  return new Agent({
    config: DEFAULT_CONFIG,
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      success() {}
    },
    stateManager: {
      createInitialState(goal: string) {
        return { goal, history: [], paused: false, stopped: false, waitingForUser: false }
      },
      async saveCheckpoint() {},
      async loadCheckpoint() { return undefined },
      async clearCheckpoint() {}
    } as any,
    contextManager: {
      async getRelevantContext() { return { summary: '', episodes: [] } },
      async storeEpisode() {},
      async compactHistory() { return { id: 'lesson', createdAt: new Date().toISOString(), goal: 'g', summary: '', evidence: [] } }
    } as any,
    embedder: { async embed() { return [] } } as any,
    mcp: { async initialize() {}, listTools() { return [] }, async callTool() { return {} } } as any
  } as any)
}

test('Agent pause, resume, and stop toggles its control state', () => {
  const agent = createAgent()

  agent.pause()
  assert.equal(agent.isPaused(), true)
  agent.resumeControl()
  assert.equal(agent.isPaused(), false)
  agent.stop()
  assert.equal(agent.isStopped(), true)
})

test('Agent executes tool calls and stops on a final response', async () => {
  const agent = createAgent()
  const chatCalls: unknown[] = []
  const executedCalls: unknown[] = []

  ;(agent as any).client = {
    async ping() {
      return { success: true, client: 'ollama' }
    },
    async chat(request: any) {
      chatCalls.push(request)
      if (chatCalls.length === 1) {
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    function: {
                      name: 'fs_write_file',
                      arguments: { path: 'temp/agent-control.txt', content: 'hello' }
                    }
                  }
                ]
              }
            }
          ]
        }
      }
      if (chatCalls.length === 2) {
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I will now finish.',
                tool_calls: []
              }
            }
          ]
        }
      }
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Task complete',
              tool_calls: [
                {
                  function: {
                    name: 'console_finalize',
                    arguments: { complete: true, reason: 'Goal achieved' }
                  }
                }
              ]
            }
          }
        ]
      }
    }
  }

  ;(agent as any).analyzer = {
    async describe() {
      return {
        description: 'Mock screen',
        visibleTitles: [],
        interactiveElements: [],
        confidence: 1
      }
    }
  }

  ;(agent as any).executor = {
    listTools() {
      return [
        {
          type: 'function',
          function: {
            name: 'fs_write_file',
            description: 'Write a file',
            parameters: {}
          }
        }
      ]
    },
    isDangerous() {
      return false
    },
    async execute(toolCall: { function: { name: string; arguments: Record<string, unknown> } }) {
      executedCalls.push(toolCall)
      return {
        ok: true,
        tool: toolCall.function.name,
        content: 'wrote file'
      }
    }
  }

  const state = await agent.run('Write a file')
  assert.equal(chatCalls.length, 3)
  assert.equal(executedCalls.length, 2)
  assert.equal((executedCalls[0] as any).function.name, 'fs_write_file')
  assert.equal((executedCalls[1] as any).function.name, 'console_finalize')
  assert.equal(state.stopped, true)
  assert.equal(state.history.length >= 2, true)
})

test('Agent falls back to open-app and typing tools when the model omits tool calls', async () => {
  const agent = createAgent()
  const chatCalls: unknown[] = []
  const executedCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = []

  ;(agent as any).client = {
    async ping() {
      return { success: true, client: 'ollama' }
    },
    async chat(request: any) {
      chatCalls.push(request)
      if (chatCalls.length === 1) {
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I will open notepad',
                tool_calls: []
              }
            }
          ]
        }
      }
      if (chatCalls.length === 2) {
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I will type "hello"',
                tool_calls: []
              }
            }
          ]
        }
      }
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Finished',
              tool_calls: [
                {
                  function: {
                    name: 'console_finalize',
                    arguments: { complete: true }
                  }
                }
              ]
            }
          }
        ]
      }
    }
  }

  ;(agent as any).analyzer = {
    async describe() {
      return {
        description: 'Mock screen',
        visibleTitles: [],
        interactiveElements: [],
        confidence: 1
      }
    }
  }

  ;(agent as any).executor = {
    listTools() {
      return [
        {
          type: 'function',
          function: {
            name: 'app_open',
            description: 'Open an app',
            parameters: {}
          }
        },
        {
          type: 'function',
          function: {
            name: 'gui_type',
            description: 'Type text',
            parameters: {}
          }
        }
      ]
    },
    isDangerous() {
      return false
    },
    async execute(toolCall: { function: { name: string; arguments: Record<string, unknown> } }) {
      executedCalls.push(toolCall)
      if (toolCall.function.name === 'app_open') {
        return {
          ok: true,
          tool: toolCall.function.name,
          content: 'Opened Notepad'
        }
      }
      return {
        ok: true,
        tool: toolCall.function.name,
        content: 'Typed hello'
      }
    }
  }

  const state = await agent.run('Open the notepad, and write hello. Do not save and do not quit.')
  assert.equal(chatCalls.length, 3)
  assert.deepEqual(executedCalls.map(call => call.function.name), ['app_open', 'gui_type', 'console_finalize'])
  assert.equal(state.stopped, true)
  assert.equal(state.history.some(entry => entry.action.type === 'internal' && entry.action.tool === 'console_finalize'), true)
})
