import type { AgentChatMessage, LlmGenerateOptions, LlmGenerateResponse } from '../types/index.ts';
import { OpenRouterClient } from './clients/openrouter-client.ts';
import { OllamaClient } from './clients/ollama-client.ts';
import { MistralClient } from './clients/mistral-client.ts';
import { CustomClient } from './clients/custom-client.ts';

export class UniversalClient {
  private readonly client: OpenRouterClient | OllamaClient | MistralClient | CustomClient;
  private readonly clientType: string;
  private readonly processEnv: NodeJS.ProcessEnv;

  constructor(timeoutMs: number = 3600000, env: NodeJS.ProcessEnv = process.env) {
    this.processEnv = env;
    this.clientType = (this.processEnv?.CLIENT || 'ollama').toLowerCase().trim();
    
    console.log(`[UniversalClient] Initializing with CLIENT=${this.clientType}`);

    if (this.clientType === 'openrouter') {
      const apiKey = this.processEnv.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OPENROUTER_API_KEY is required when CLIENT=openrouter');
      this.client = new OpenRouterClient(apiKey, timeoutMs);
    } else if (this.clientType === 'ollama') {
      const baseUrl = this.processEnv.OROS_OLLAMA_URL || 'http://127.0.0.1:11434';
      this.client = new OllamaClient(baseUrl, timeoutMs);
    } else if (this.clientType === 'mistral') {
      const apiKey = this.processEnv.MISTRAL_API_KEY;
      if (!apiKey) throw new Error('MISTRAL_API_KEY is required when CLIENT=mistral');
      this.client = new MistralClient(apiKey, timeoutMs);
    } else if (this.clientType === 'custom') {
      const baseUrl = this.processEnv.CUSTOM_API_URL || 'http://127.0.0.1:31415/v1/chat/completions';
      const apiKey = this.processEnv.CUSTOM_API_KEY;
      this.client = new CustomClient(baseUrl, apiKey, timeoutMs);
    } else {
      throw new Error(`Unsupported CLIENT: ${this.clientType}`);
    }
  }

  async ping() {
    return {
      success: (await this.client.ping()).success,
      client: this.clientType
    };
  }

  abort() {
    this.client.abort();
  }

  async chat(input: any): Promise<any> {
    let options = input?.chatRequest ?? input;
    if (!options || typeof options !== 'object' || !options.model) {
      throw new Error(`Invalid chat options received: ${JSON.stringify(Object.keys(input || {}))}`);
    }

    console.log(`[UniversalClient] chat() → ${this.clientType} | model: ${options.model}`);

    let rawResponse;
    try {
      rawResponse = await this.client.chat(options);
    } catch (err) {
      console.error('[UniversalClient] chat() failed:', err);
      throw err;
    }

    // Ultra-safe normalization
    return this.normalizeResponse(rawResponse);
  }

  private normalizeResponse(raw: any): any {
    if (!raw?.choices) {
      console.warn('[UniversalClient] normalizeResponse: Invalid response shape, returning safe fallback');
      return {
        id: 'fallback',
        model: 'unknown',
        choices: [{
          index: 0,
          message: { 
            role: 'assistant', 
            content: '', 
            tool_calls: [] 
          },
          finish_reason: null
        }]
      };
    }

    const response = { ...raw };

    response.choices = (response.choices || []).map((choice: any, idx: number) => {
      let message = choice?.message;

      if (!message || typeof message !== 'object') {
        message = { role: 'assistant', content: '', tool_calls: [] };
      }

      // FORCE tool_calls to be array
      if (!message.tool_calls || !Array.isArray(message.tool_calls)) {
        message.tool_calls = [];
      }

      // Handle camelCase
      if ((message as any).toolCalls?.length) {
        message.tool_calls = (message as any).toolCalls;
      }

      if (message.content === undefined && message.tool_calls.length === 0) {
        message.content = '';
      }

      return {
        ...choice,
        message,
        finish_reason: choice.finishReason ?? choice.finish_reason ?? null,
        index: choice.index ?? idx
      };
    });

    return response;
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    const res = await this.client.generate(options);
    // Also normalize generate responses
    if (res.raw) {
      res.raw = this.normalizeResponse(res.raw);
    }
    return res;
  }

  async embed(model: string, input: string): Promise<number[]> {
    return this.client.embed(model, input);
  }

  getClientType() {
    return this.clientType;
  }
}