import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Episode, MemoryQueryResult } from '../types/index.ts'

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length)
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0

  for (let index = 0; index < length; index += 1) {
    const l = left[index] || 0
    const r = right[index] || 0
    dot += l * r
    leftNorm += l * l
    rightNorm += r * r
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export class VectorStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async loadEpisodes(): Promise<Episode[]> {
    try {
      const content = await readFile(this.filePath, 'utf8')
      return JSON.parse(content) as Episode[]
    } catch {
      return []
    }
  }

  async saveEpisodes(episodes: Episode[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(episodes, null, 2)}\n`, 'utf8')
  }

  async addEpisode(episode: Episode): Promise<void> {
    const episodes = await this.loadEpisodes()
    episodes.push(episode)
    await this.saveEpisodes(episodes)
  }

  async search(queryEmbedding: number[], limit: number = 5): Promise<MemoryQueryResult[]> {
    const episodes = await this.loadEpisodes()
    return episodes
      .map(episode => ({
        episode,
        score: cosineSimilarity(queryEmbedding, episode.textEmbedding.length ? episode.textEmbedding : episode.screenshotEmbedding)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
  }
}
