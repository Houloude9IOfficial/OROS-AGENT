import { Ollama } from 'ollama'
import type { ChatResponse, Message, Tool as OllamaTool } from 'ollama'
import type {
  AgentChatMessage,
  LlmGenerateOptions,
  LlmGenerateResponse
} from '../types/index.ts'

type ChatOptions = {
  model: string
  messages: AgentChatMessage[]
  tools?: OllamaTool[]
  images?: string[]
  format?: 'json' | Record<string, unknown>
  temperature?: number
  think?: boolean | 'high' | 'medium' | 'low'
  keep_alive?: string | number
}

function createTimeoutFetch(timeoutMs: number, activeControllers: Set<AbortController>): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController()
    activeControllers.add(controller)

    const timeoutHandle = setTimeout(() => controller.abort(new Error(`Ollama request timed out after ${timeoutMs}ms`)), timeoutMs)

    try {
      if (init?.signal) {
        if (init.signal.aborted) {
          controller.abort(init.signal.reason)
        } else {
          init.signal.addEventListener('abort', () => controller.abort(init.signal?.reason), { once: true })
        }
      }

      return await fetch(input, {
        ...init,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeoutHandle)
      activeControllers.delete(controller)
    }
  }
}

export class OllamaClient {
  private readonly client: Ollama
  private readonly timeoutMs: number
  private readonly controllers = new Set<AbortController>()
  private readonly baseUrl: string

  constructor(baseUrl: string, timeoutMs: number = 180000) {
    this.timeoutMs = timeoutMs
    this.baseUrl = baseUrl
    this.client = new Ollama({
      host: baseUrl,
      fetch: createTimeoutFetch(timeoutMs, this.controllers)
    })
  }

  async ping(): Promise<{ success: boolean }> {
    const response = await fetch(`${this.baseUrl}`, { signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) {
      throw new Error(`Ollama ping failed with status ${response.status}: ${response.statusText}`)
    } else {
      return {
        success: true
      }
    }
  }

  abort(): void {
    for (const controller of this.controllers) {
      controller.abort(new Error('Ollama request aborted'))
    }
    this.controllers.clear()
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const request: Parameters<Ollama['chat']>[0] = {
      model: options.model,
      messages: options.messages.map(message => {
        const entry: Message = {
          role: message.role,
          content: message.content
        }
        if (message.images && message.images.length > 0) {
          entry.images = message.images
        }
        if (message.tool_calls) {
          entry.tool_calls = message.tool_calls.map(call => ({
            function: {
              name: call.function.name,
              arguments: call.function.arguments
            }
          }))
        }
        if (message.tool_name) {
          entry.tool_name = message.tool_name
        }
        return entry
      }),
      stream: false
    }

    if (options.tools && options.tools.length > 0) {
      request.tools = options.tools
    }
    if (options.format !== undefined) {
      request.format = options.format
    }
    if (options.think !== undefined) {
      request.think = options.think
    }
    if (options.keep_alive !== undefined) {
      request.keep_alive = options.keep_alive
    }
    if (typeof options.temperature === 'number') {
      request.options = { temperature: options.temperature }
    }

    return await this.client.chat(request)
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    const request: Parameters<Ollama['chat']>[0] = {
      model: options.model,
      messages: options.messages.map(message => {
        const entry: Message = {
          role: message.role,
          content: message.content
        }
        if (message.role === 'user' && options.images && options.images.length > 0) {
          entry.images = options.images
        }
        return entry
      }),
      stream: false
    }

    if (options.format !== undefined) {
      request.format = options.format === 'json' ? 'json' : options.format
    }
    if (typeof options.temperature === 'number') {
      request.options = { temperature: options.temperature }
    }
    request.think = false

    const response = await this.client.chat(request)

    return {
      text: response.message?.content || '',
      raw: response
    }
  }

  async embed(model: string, input: string): Promise<number[]> {
    const response = await this.client.embeddings({
      model,
      prompt: input
    })
    if (!Array.isArray(response.embedding)) {
      throw new Error('Ollama embeddings response missing embedding array')
    }
    return response.embedding
  }
}
