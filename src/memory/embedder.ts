import { createHash } from 'node:crypto'
import { UniversalClient } from '../llm/universal-client.ts'

function hashEmbedding(text: string, dimensions: number = 64): number[] {
  const hash = createHash('sha256').update(text).digest()
  const vector = new Array<number>(dimensions).fill(0)

  for (let index = 0; index < dimensions; index += 1) {
    vector[index] = (hash[index % hash.length]! / 255) * 2 - 1
  }

  return vector
}

export class Embedder {
  private readonly client: UniversalClient
  private readonly model: string

  constructor(client: UniversalClient, model: string) {
    this.client = client
    this.model = model
  }

  async embed(text: string): Promise<number[]> {
    try {
      return await this.client.embed(this.model, text)
    } catch {
      return hashEmbedding(text)
    }
  }
}
