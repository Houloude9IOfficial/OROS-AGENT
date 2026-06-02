import { createHash } from 'node:crypto'

export interface DiffResult {
  changed: boolean
  similarity: number
  currentHash: string
}

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function compareBuffers(previous: Buffer | undefined, current: Buffer): DiffResult {
  if (!previous) {
    return {
      changed: true,
      similarity: 0,
      currentHash: hashBuffer(current)
    }
  }

  const previousHash = hashBuffer(previous)
  const currentHash = hashBuffer(current)
  if (previousHash === currentHash) {
    return { changed: false, similarity: 1, currentHash }
  }

  const length = Math.max(previous.length, current.length)
  let same = 0
  for (let index = 0; index < length; index += 1) {
    if (previous[index] === current[index]) {
      same += 1
    }
  }

  return {
    changed: true,
    similarity: length === 0 ? 1 : same / length,
    currentHash
  }
}
