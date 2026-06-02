import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getDataRoot } from './paths.ts'

export interface ConsentRecord {
  accepted: boolean
  acceptedAt: string
  source: 'env' | 'command'
}

function consentFilePath(): string {
  return resolve(getDataRoot(), 'consent.json')
}

export async function hasAcceptedRisks(): Promise<boolean> {
  try {
    const raw = await readFile(consentFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as ConsentRecord
    return parsed.accepted === true
  } catch {
    return false
  }
}

export function envAcceptedRisks(): boolean {
  const explicit = process.env.OROS_ACCEPT_RISKS || process.env.npm_config_i_understand_the_risks || ''
  const normalized = explicit.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }

  const rawArgv = process.env.npm_config_argv
  if (!rawArgv) {
    return false
  }

  try {
    const parsed = JSON.parse(rawArgv) as { original?: unknown; cooked?: unknown }
    const allArgs = [...toStringArray(parsed.original), ...toStringArray(parsed.cooked)]
    return allArgs.some(argument => argument === '--i-understand-the-risks' || argument === '--accept-risks')
  } catch {
    return false
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export async function saveAcceptedRisks(source: 'env' | 'command' = 'command'): Promise<void> {
  const filePath = consentFilePath()
  await mkdir(resolve(getDataRoot()), { recursive: true })
  const record: ConsentRecord = {
    accepted: true,
    acceptedAt: new Date().toISOString(),
    source
  }
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

export async function ensureAcceptedRisks(): Promise<boolean> {
  if (await hasAcceptedRisks()) {
    return true
  }
  if (envAcceptedRisks()) {
    await saveAcceptedRisks('env')
    return true
  }
  return false
}

export function consentHelpLine(): string {
  return 'Risks not yet accepted.'
}
