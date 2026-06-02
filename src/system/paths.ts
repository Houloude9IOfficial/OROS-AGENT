import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

export function getDataRoot(): string {
  return resolve(process.env.OROS_DATA_DIR || resolve(tmpdir(), 'oros'))
}
