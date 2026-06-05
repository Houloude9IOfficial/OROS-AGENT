import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseStructured(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    const data: Record<string, unknown> = {}
    let currentKey: string | undefined
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) {
        continue
      }
      if (line.includes(':') && !line.startsWith('-')) {
        const [key, ...rest] = line.split(':')
        if (key) {
          currentKey = key.trim()
          const value = rest.join(':').trim()
          data[currentKey] = value ? value : []
        }
        continue
      }
      if (line.startsWith('-') && currentKey) {
        const item = line.slice(1).trim()
        const list = Array.isArray(data[currentKey]) ? (data[currentKey] as string[]) : []
        list.push(item)
        data[currentKey] = list
      }
    }
    return data
  }
}

export class StructuredStore {
  private readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  private pathFor(name: string): string {
    return resolve(this.rootDir, name)
  }

  async read<T>(name: string, fallback: T): Promise<T> {
    try {
      const content = await readFile(this.pathFor(name), 'utf8')
      return parseStructured(content) as T
    } catch {
      return fallback
    }
  }

  async write(name: string, value: unknown): Promise<void> {
    const filePath = this.pathFor(name)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  async updateObject(name: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const existing = await this.read<Record<string, unknown>>(name, {})
    const next = { ...existing, ...patch }
    await this.write(name, next)
    return next
  }

  async appendListItem(name: string, key: string, value: unknown): Promise<Record<string, unknown>> {
    const existing = await this.read<Record<string, unknown>>(name, {})
    const list = Array.isArray(existing[key]) ? [...(existing[key] as unknown[])] : []
    list.push(value)
    const next = { ...existing, [key]: list }
    await this.write(name, next)
    return next
  }
}
