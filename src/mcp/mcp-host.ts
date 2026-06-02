import { spawn } from 'node:child_process'
import type { RegisteredTool } from '../types/index.ts'
import { ServerRegistry } from './server-registry.ts'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: number
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

class JsonRpcClient {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private buffer = Buffer.alloc(0)
  private readonly process: ReturnType<typeof spawn>

  constructor(process: ReturnType<typeof spawn>) {
    this.process = process
    process.stdout.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
      this.consume()
    })
    process.stderr.on('data', chunk => {
      const text = chunk.toString().trim()
      if (text) {
        console.error(`[MCP ${process.pid}] ${text}`)
      }
    })
    process.on('exit', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error('MCP process exited'))
      }
      this.pending.clear()
    })
  }

  private consume(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }
      const headerText = this.buffer.slice(0, headerEnd).toString('utf8')
      const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i)
      if (!contentLengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const contentLength = Number(contentLengthMatch[1])
      const messageStart = headerEnd + 4
      if (this.buffer.length < messageStart + contentLength) {
        return
      }
      const payload = this.buffer.slice(messageStart, messageStart + contentLength).toString('utf8')
      this.buffer = this.buffer.slice(messageStart + contentLength)
      if (!payload) {
        continue
      }
      const message = JSON.parse(payload) as JsonRpcResponse
      const pending = this.pending.get(message.id)
      if (!pending) {
        continue
      }
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message))
        continue
      }
      pending.resolve(message.result)
    }
  }

  async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })

    const body = JSON.stringify(payload)
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
    return await promise
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const payload = {
      jsonrpc: '2.0' as const,
      method,
      params
    }
    const body = JSON.stringify(payload)
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
  }
}

export class McpHost {
  private readonly registry: ServerRegistry
  private readonly clients = new Map<string, JsonRpcClient>()
  private readonly tools = new Map<string, RegisteredTool>()

  constructor(servers: Record<string, { command: string; args: string[]; cwd?: string; env?: Record<string, string> }>) {
    this.registry = new ServerRegistry(servers)
  }

  async initialize(): Promise<void> {
    for (const { name } of this.registry.list()) {
      const running = this.registry.spawn(name)
      const client = new JsonRpcClient(running.process)
      this.clients.set(name, client)
      await client.request('initialize', {
        clientInfo: { name: 'oros', version: '1.0.0' },
        capabilities: {}
      })
      client.notify('notifications/initialized', {})
      const response = await client.request<{ tools?: McpToolInfo[] }>('tools/list')
      for (const tool of response.tools || []) {
        this.tools.set(`${name}:${tool.name}`, {
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || {},
          server: name
        })
      }
    }
  }

  listTools(): RegisteredTool[] {
    return [...this.tools.values()]
  }

  async callTool(server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.clients.get(server)
    if (!client) {
      throw new Error(`MCP server not initialized: ${server}`)
    }

    return await client.request('tools/call', {
      name: tool,
      arguments: args
    })
  }
}
