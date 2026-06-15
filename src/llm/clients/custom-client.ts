import type { AgentChatMessage, LlmGenerateOptions, LlmGenerateResponse, NativeToolCall } from '../../types/index.ts'

export type ChatResponse = {
  id: string
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
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
  tools?: any[]
  images?: string[]
  format?: 'json' | Record<string, unknown>
  temperature?: number
}

export class CustomClient {
  private readonly baseUrl: string
  private readonly apiKey: string | undefined
  private readonly timeoutMs: number
  private readonly controllers = new Set<AbortController>()

  constructor(baseUrl: string, apiKey?: string, timeoutMs: number = 3600000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.timeoutMs = timeoutMs
  }

  async ping(): Promise<{ success: boolean }> {
    try {
      // Standard health check or just try to reach the endpoint
      const response = await fetch(this.baseUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      })
      return { success: response.ok || response.status === 405 } // 405 Method Not Allowed is fine for HEAD on some APIs
    } catch (error) {
      throw new Error(`Custom API ping failed at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  abort(): void {
    for (const controller of this.controllers) {
      controller.abort(new Error('Custom API request aborted'))
    }
    this.controllers.clear()
  }

  private createSignal(): { signal: AbortSignal; controller: AbortController } {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)])
    this.controllers.add(controller)
    return { signal, controller }
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const { signal, controller } = this.createSignal()

    try {
      const messages = options.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? {
          tool_calls: m.tool_calls.map((tc, i) => ({
            id: `call_${i}`,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string' 
                ? tc.function.arguments 
                : JSON.stringify(tc.function.arguments)
            }
          }))
        } : {})
      }))

      const body: any = {
        model: options.model,
        messages,
        stream: false
      }

      if (options.temperature !== undefined) body.temperature = options.temperature
      if (options.tools) body.tools = options.tools
      if (options.format === 'json') {
        body.response_format = { type: 'json_object' }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`
      }

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No error body')
        throw new Error(`Custom API request failed with status ${response.status}: ${errorText}`)
      }

      return await response.json()
    } finally {
      this.controllers.delete(controller)
    }
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    const response = await this.chat({
      model: options.model,
      messages: options.messages as any,
      temperature: options.temperature,
      format: options.format as any
    })

    return {
      text: response.choices[0]?.message?.content || '',
      raw: response
    }
  }

  async embed(model: string, input: string): Promise<number[]> {
    throw new Error('Embeddings not implemented for CustomClient')
  }
}
