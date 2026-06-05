import type { AgentChatMessage, LlmGenerateOptions, LlmGenerateResponse } from '../types/index.ts'

// Import both clients
import { OpenRouterClient } from './clients/openrouter-client.ts'
import { OllamaClient } from './clients/ollama-client.ts'

// Re-export types that might be needed
export type { ChatResponse } from './clients/openrouter-client.ts'

// Determine client type from env (falls back to 'ollama' if not set)
const CLIENT = (process.env.CLIENT || 'ollama').toLowerCase().trim()

export class UniversalClient {
  private readonly client: OpenRouterClient | OllamaClient
  private readonly clientType: string

  constructor(timeoutMs: number = 3600000) {
    this.clientType = CLIENT

    if (this.clientType === 'openrouter') {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY is required when CLIENT=openrouter')
      }
      this.client = new OpenRouterClient(apiKey, timeoutMs)
    } else if (this.clientType === 'ollama') {
      const baseUrl = process.env.OROS_OLLAMA_URL || 'http://127.0.0.1:11434'
      this.client = new OllamaClient(baseUrl, timeoutMs)
    } else {
      throw new Error(`Unsupported CLIENT: ${this.clientType}. Supported: 'ollama' or 'openrouter'`)
    }
  }

  async ping(): Promise<{ success: boolean }> {
    return this.client.ping()
  }

  abort(): void {
    this.client.abort()
  }

  async chat(options: any): Promise<any> {
    // @ts-ignore - both clients have compatible chat method signatures for runtime
    return this.client.chat(options)
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    // @ts-ignore - both implement generate
    return this.client.generate(options)
  }

  async embed(model: string, input: string): Promise<number[]> {
    // @ts-ignore - both implement embed
    return this.client.embed(model, input)
  }

  getClientType(): string {
    return this.clientType
  }
}