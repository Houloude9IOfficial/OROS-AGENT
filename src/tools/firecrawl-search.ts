import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import Firecrawl from 'firecrawl'

interface WebSearchOptions {
  query: string
  outputPath: string
  limit?: number
}

function summarizeItem(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') {
    return undefined
  }
  const record = item as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title : undefined
  const url = typeof record.url === 'string' ? record.url : undefined
  const description = typeof record.description === 'string'
    ? record.description
    : (typeof record.snippet === 'string' ? record.snippet : undefined)
  if (!title && !url && !description) {
    return undefined
  }
  return [
    title ? `Title: ${title}` : undefined,
    url ? `URL: ${url}` : undefined,
    description ? `Summary: ${description}` : undefined
  ].filter(Boolean).join('\n')
}

function collectResults(data: { web?: unknown[]; news?: unknown[] }): string[] {
  const lines: string[] = []
  for (const item of data.news || []) {
    const summary = summarizeItem(item)
    if (summary) {
      lines.push(summary)
    }
  }
  for (const item of data.web || []) {
    const summary = summarizeItem(item)
    if (summary) {
      lines.push(summary)
    }
  }
  return lines
}

export class FirecrawlSearchTool {
  private readonly client: Firecrawl | undefined

  constructor(apiKey: string | undefined) {
    const trimmed = apiKey?.trim()
    this.client = trimmed ? new Firecrawl({ apiKey: trimmed }) : undefined
  }

  async search(options: Pick<WebSearchOptions, 'query' | 'limit'>): Promise<{ text: string; resultCount: number }> {
    if (!this.client) {
      throw new Error('FIRECRAWL_API_KEY is not configured')
    }
    const result = await this.client.search(options.query, {
      limit: options.limit || 5,
      sources: ['news', 'web']
    })
    const lines = collectResults(result)
    const text = [
      `Query: ${options.query}`,
      `Generated At: ${new Date().toISOString()}`,
      '',
      ...(lines.length > 0 ? lines : ['No matching results found.'])
    ].join('\n\n')
    return { text, resultCount: lines.length }
  }

  async searchAndSave(options: WebSearchOptions): Promise<{ outputPath: string; resultCount: number }> {
    const { text, resultCount } = await this.search(options)
    await mkdir(dirname(options.outputPath), { recursive: true })
    await writeFile(options.outputPath, text, 'utf8')
    return { outputPath: options.outputPath, resultCount }
  }
}
