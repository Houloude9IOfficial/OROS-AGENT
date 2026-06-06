import { Mistral } from '@mistralai/mistralai'
import type { AgentChatMessage, LlmGenerateOptions, LlmGenerateResponse } from '../../types/index.ts'

type MistralTool = {
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
  tools?: MistralTool[]
  images?: string[]
  format?: 'json' | Record<string, unknown>
  temperature?: number
  think?: boolean | 'high' | 'medium' | 'low'
}

function toImageUrl(image: string): string {
  if (image.startsWith('data:') || image.startsWith('http')) return image
  return `data:image/jpeg;base64,${image}`
}

export class MistralClient {
  private readonly client: Mistral
  private readonly timeoutMs: number
  private readonly controllers = new Set<AbortController>()
  private readonly apiKey: string

  constructor(apiKey: string, timeoutMs: number = 3600000) {
    this.apiKey = apiKey
    this.timeoutMs = timeoutMs
    this.client = new Mistral({ apiKey })
  }

  async ping(): Promise<{ success: boolean }> {
    try {
      await this.client.chat.complete({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1,
      })
      return { success: true }
    } catch (error: any) {
      throw new Error(`Mistral ping failed: ${error.message || error}`)
    }
  }

  abort(): void {
    for (const controller of this.controllers) {
      controller.abort(new Error('Mistral request aborted'))
    }
    this.controllers.clear()
  }

  private createSignal(): { signal: AbortSignal; controller: AbortController } {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)])
    this.controllers.add(controller)
    return { signal, controller }
  }

  /** Strong normalization - this is critical for preventing the tool_calls crash */
  private normalizeResponse(raw: any): ChatResponse {
    const response = { ...raw } as ChatResponse

    if (!response.choices || !Array.isArray(response.choices)) {
      response.choices = []
    }

    response.choices = response.choices.map((choice: any) => {
      let message = choice?.message || {}

      // === TOOL CALLS NORMALIZATION (main crash source) ===
      if (!message.tool_calls || !Array.isArray(message.tool_calls)) {
        message.tool_calls = []
      }

      // Handle possible camelCase from Mistral SDK
      if ((message as any).toolCalls && Array.isArray((message as any).toolCalls)) {
        message.tool_calls = (message as any).toolCalls
      }

      // Ensure content is always defined when no tool calls
      if (message.content === undefined && message.tool_calls.length === 0) {
        message.content = ''
      }

      return {
        ...choice,
        message,
        finish_reason: choice.finishReason ?? choice.finish_reason ?? null
      }
    })

    return response
  }

  private buildMessages(agentMessages: AgentChatMessage[]): any[] {
    return agentMessages.map((message) => {
      const entry: any = { role: message.role }

      // Safe images handling (fixes TS errors)
      const hasImages = Boolean(message.images?.length)

      if (hasImages) {
        const textContent = typeof message.content === 'string' ? message.content : ''
        entry.content = [
          { type: 'text', text: textContent },
          ...message.images!.map((img: string) => ({
            type: 'image_url',
            image_url: { url: toImageUrl(img) }
          }))
        ]
      } else {
        entry.content = message.content ?? ''
      }

      // Tool calls from previous messages
      if (message.tool_calls?.length) {
        entry.tool_calls = message.tool_calls
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
      let messages = this.buildMessages(options.messages)

      // Attach top-level images to last user message
      if (options.images?.length) {
        const lastUser = [...messages].reverse().find(m => m.role === 'user')
        if (lastUser) {
          const text = typeof lastUser.content === 'string' ? lastUser.content : ''
          lastUser.content = [
            { type: 'text', text },
            ...options.images.map(img => ({
              type: 'image_url',
              image_url: { url: toImageUrl(img) }
            }))
          ]
        }
      }

      const body: any = {
        model: options.model,
        messages,
      }

      if (options.tools?.length) body.tools = options.tools
      if (options.format) {
        body.responseFormat = options.format === 'json'
          ? { type: 'json_object' }
          : { type: 'json_schema', json_schema: options.format }
      }
      if (typeof options.temperature === 'number') {
        body.temperature = options.temperature
      }

      const rawResult = await this.client.chat.complete(body, { signal })
      return this.normalizeResponse(rawResult)
    } finally {
      this.controllers.delete(controller)
    }
  }

    async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
      const response = await this.chat(options as any);
      return {
        text: (response.choices[0]?.message?.content as string) || '',
        raw: response
      };
    }

  async embed(model: string, input: string): Promise<number[]> {
    const { signal, controller } = this.createSignal()
    try {
      const response = await this.client.embeddings.create({
        model,
        inputs: [input],
      }, { signal })

      const embedding = response.data?.[0]?.embedding
      if (!Array.isArray(embedding)) {
        throw new Error('Mistral embeddings response missing embedding array')
      }
      return embedding
    } finally {
      this.controllers.delete(controller)
    }
  }
}