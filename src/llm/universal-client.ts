import dotenv from 'dotenv';
dotenv.config();

import type { AgentChatMessage, LlmGenerateOptions, LlmGenerateResponse } from '../types/index.ts';

import { OpenRouterClient } from './clients/openrouter-client.ts';
import { OllamaClient } from './clients/ollama-client.ts';

const CLIENT = (process.env.CLIENT || 'ollama').toLowerCase().trim();

export class UniversalClient {
  private readonly client: OpenRouterClient | OllamaClient;
  private readonly clientType: string;

  constructor(timeoutMs: number = 3600000) {
    this.clientType = CLIENT;
    console.log(`[UniversalClient] Initializing with CLIENT=${CLIENT}`);

    if (this.clientType === 'openrouter') {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OPENROUTER_API_KEY is required when CLIENT=openrouter');
      this.client = new OpenRouterClient(apiKey, timeoutMs);
    } else if (this.clientType === 'ollama') {
      const baseUrl = process.env.OROS_OLLAMA_URL || 'http://127.0.0.1:11434';
      this.client = new OllamaClient(baseUrl, timeoutMs);
    } else {
      throw new Error(`Unsupported CLIENT: ${this.clientType}`);
    }
  }

  async ping() {
    return {
      success: (await this.client.ping()).success,
      client: this.clientType
    }
  }

  abort() {
    this.client.abort();
  }

  /**
   * Unified chat method - supports both direct call and wrapped { chatRequest }
   */
  async chat(input: any): Promise<any> {
    // Handle both calling styles
    let options = input?.chatRequest ?? input;

    if (!options || typeof options !== 'object' || !options.model) {
      throw new Error(`Invalid chat options received: ${JSON.stringify(Object.keys(input || {}))}`);
    }

    console.log(`[UniversalClient] chat() → ${this.clientType} | model: ${options.model}`);

    // Delegate to the real client
    return this.client.chat(options);
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    return this.client.generate(options);
  }

  async embed(model: string, input: string): Promise<number[]> {
    return this.client.embed(model, input);
  }

  getClientType() {
    return this.clientType;
  }
}