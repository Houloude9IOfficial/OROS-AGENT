import type { Episode, MemoryQueryResult, AgentHistoryEntry } from '../types/index.ts'
import type { VectorStore } from './vector-store.ts'
import type { Embedder } from './embedder.ts'
import type { StructuredStore } from './structured-store.ts'
import type { Lesson } from '../types/index.ts'

export class ContextManager {
  private readonly vectorStore: VectorStore
  private readonly embedder: Embedder
  private readonly structuredStore: StructuredStore
  private readonly memoryTopK: number

  constructor(vectorStore: VectorStore, embedder: Embedder, structuredStore: StructuredStore, memoryTopK: number) {
    this.vectorStore = vectorStore
    this.embedder = embedder
    this.structuredStore = structuredStore
    this.memoryTopK = memoryTopK
  }

  async getRelevantContext(goal: string): Promise<{ summary: string; episodes: MemoryQueryResult[] }> {
    const queryEmbedding = await this.embedder.embed(goal)
    const episodes = await this.vectorStore.search(queryEmbedding, this.memoryTopK)
    const summary = episodes
      .map(result => {
        const episode = result.episode
        return `${episode.goal}: ${episode.summary || episode.result.stdout || episode.result.error || episode.action.type}`
      })
      .join('\n')

    return {
      summary,
      episodes
    }
  }

  async storeEpisode(episode: Episode): Promise<void> {
    await this.vectorStore.addEpisode(episode)
  }

  async compactHistory(goal: string, history: AgentHistoryEntry[]): Promise<Lesson> {
    const evidence = history.slice(-5).map(entry => {
      const outcome = entry.result.ok ? entry.result.stdout || 'success' : entry.result.error || 'failed'
      const tool = entry.action.type === 'internal' ? entry.action.tool : entry.action.type
      return `${entry.action.type}:${tool} -> ${outcome}`
    })
    const summary = `Recent progress on ${goal}: ${evidence.join('; ')}`
    const lesson: Lesson = {
      id: `lesson-${Date.now()}`,
      createdAt: new Date().toISOString(),
      goal,
      summary,
      evidence
    }
    await this.structuredStore.appendListItem('lessons_learned.json', 'lessons', lesson)
    return lesson
  }
}
