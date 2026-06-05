import { OpenRouter } from '@openrouter/sdk'
import type { AgentChatMessage, LlmGenerateOptions, LlmGenerateResponse } from '../../types/index.ts'

// OpenAI-compatible tool type (what OpenRouter expects)
type OpenRouterTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type ChatMessage = {
  role: string
  content: string | ContentPart[] | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export type ChatResponse = {
  id: string
  model: string
  choices: Array<{
    index: number
    message: ChatMessage
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

type ChatOptions = {
  model: string
  messages: AgentChatMessage[]
  tools?: OpenRouterTool[]
  images?: string[]
  format?: 'json' | Record<string, unknown>
  temperature?: number
  think?: boolean | 'high' | 'medium' | 'low'
}

function toImageUrl(image: string): string {
  if (image.startsWith('data:') || image.startsWith('http')) return image
  return `data:image/jpeg;base64,${image}`
}

function buildReasoningParam(think: boolean | 'high' | 'medium' | 'low') {
  if (think === false) return { exclude: true }
  if (think === true) return { effort: 'high' as const }
  return { effort: think }
}

export class OpenRouterClient {
  private readonly client: OpenRouter
  private readonly timeoutMs: number
  private readonly controllers = new Set<AbortController>()
  private readonly apiKey: string

  constructor(apiKey: string, timeoutMs: number = 3600000) {
    this.apiKey = apiKey
    this.timeoutMs = timeoutMs
    this.client = new OpenRouter({ apiKey })
  }

  async ping(): Promise<{ success: boolean }> {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) {
      throw new Error(`OpenRouter ping failed with status ${response.status}: ${response.statusText}`)
    }
    return { success: true }
  }

  abort(): void {
    for (const controller of this.controllers) {
      controller.abort(new Error('OpenRouter request aborted'))
    }
    this.controllers.clear()
  }

  private createSignal(): { signal: AbortSignal; controller: AbortController } {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)])
    this.controllers.add(controller)
    return { signal, controller }
  }

  private buildMessages(agentMessages: AgentChatMessage[]): ChatMessage[] {
    return agentMessages.map(message => {
      const entry: ChatMessage = {
        role: message.role,
        content: message.content
      }

      if (message.images && message.images.length > 0) {
        entry.content = [
          { type: 'text', text: typeof message.content === 'string' ? message.content : '' },
          ...message.images.map(img => ({
            type: 'image_url' as const,
            image_url: { url: toImageUrl(img) }
          }))
        ]
      }

      if (message.tool_calls) {
        entry.tool_calls = message.tool_calls.map((call, i) => ({
          id: (call as { id?: string }).id ?? `call_${i}_${call.function.name}`,
          type: 'function' as const,
          function: {
            name: call.function.name,
            arguments: typeof call.function.arguments === 'string'
              ? call.function.arguments
              : JSON.stringify(call.function.arguments)
          }
        }))
      }

      if (message.tool_name) {
        entry.name = message.tool_name
      }

      return entry
    })
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const { signal, controller } = this.createSignal()

    try {
      const messages = this.buildMessages(options.messages)

      // Attach top-level images to the last user message
      if (options.images && options.images.length > 0) {
        const lastUser = [...messages].reverse().find(m => m.role === 'user')
        if (lastUser) {
          lastUser.content = [
            { type: 'text', text: typeof lastUser.content === 'string' ? lastUser.content : '' },
            ...options.images.map(img => ({
              type: 'image_url' as const,
              image_url: { url: toImageUrl(img) }
            }))
          ]
        }
      }

      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        stream: false
      }

      if (options.tools && options.tools.length > 0) {
        body.tools = options.tools
      }

      if (options.format !== undefined) {
        body.response_format = options.format === 'json'
          ? { type: 'json_object' }
          : { type: 'json_schema', json_schema: options.format }
      }

      if (typeof options.temperature === 'number') {
        body.temperature = options.temperature
      }

      if (options.think !== undefined) {
        body.reasoning = buildReasoningParam(options.think)
      }

      const result = await this.client.chat.send(
        body as Parameters<typeof this.client.chat.send>[0],
        { fetchOptions: { signal } }
      )

      return result as unknown as ChatResponse
    } finally {
      this.controllers.delete(controller)
    }
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    const { signal, controller } = this.createSignal()

    try {
      const messages = this.buildMessages(options.messages)

      if (options.images && options.images.length > 0) {
        const lastUser = [...messages].reverse().find(m => m.role === 'user')
        if (lastUser) {
          lastUser.content = [
            { type: 'text', text: typeof lastUser.content === 'string' ? lastUser.content : '' },
            ...options.images.map(img => ({
              type: 'image_url' as const,
              image_url: { url: toImageUrl(img) }
            }))
          ]
        }
      }

      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        stream: false
      }

      if (options.format !== undefined) {
        body.response_format = options.format === 'json'
          ? { type: 'json_object' }
          : { type: 'json_schema', json_schema: options.format }
      }

      if (typeof options.temperature === 'number') {
        body.temperature = options.temperature
      }

      const result = await this.client.chat.send(
        body as Parameters<typeof this.client.chat.send>[0],
        { fetchOptions: { signal } }
      )

      const response = result as unknown as ChatResponse
      return {
        text: (response.choices[0]?.message?.content as string) || '',
        raw: response
      }
    } finally {
      this.controllers.delete(controller)
    }
  }

    async embed(model: string, input: string): Promise<number[]> {
      const { signal, controller } = this.createSignal()
    
      try {
        const response = await this.client.embeddings.generate(
          {
            appTitle: 'OROS Agent',
            requestBody: {
              model,
              input
            }
          },
          { fetchOptions: { signal } }
        )
    
        if (typeof response === 'string') {
          throw new Error('Unexpected embeddings response')
        }
    
        const embedding = response.data?.[0]?.embedding
    
        if (!Array.isArray(embedding)) {
          throw new Error('OpenRouter embeddings response missing embedding array')
        }
    
        return embedding
      } finally {
        this.controllers.delete(controller)
      }
    }
}