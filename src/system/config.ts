import { readFile, writeFile, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { resolve } from 'node:path'
import type { OrosConfig, McpServerConfig } from '../types/index.ts'

export const DEFAULT_CONFIG: OrosConfig = {
  models: {
    fast: 'gemma4:4b',
    planner: 'gemma4:26b',
    embeddings: 'nomic-embed-text'
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434'
  },
  runtime: {
    retryLimit: 3,
    screenshotWidth: 1280,
    screenshotQuality: 85,
    checkpointIntervalMs: 30000,
    memoryTopK: 5,
    historySummarizeEvery: 10,
    maxToolCallsPerTask: 100,
    repeatedFailureLimit: 3
  },
  mcpServers: {},
  preferences: {
    browser: 'chrome',
    editor: 'vscode',
    terminal: 'windows_terminal'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeServerConfig(value: unknown): McpServerConfig | undefined {
  if (!isRecord(value) || typeof value.command !== 'string' || !Array.isArray(value.args)) {
    return undefined
  }
  const env = isRecord(value.env) 
    ? Object.fromEntries(Object.entries(value.env).filter(([, v]) => typeof v === 'string')) as Record<string, string> | undefined 
    : undefined

  const config: McpServerConfig = {
    command: value.command,
    args: value.args.filter((arg): arg is string => typeof arg === 'string')
  }
  if (typeof value.cwd === 'string') config.cwd = value.cwd
  if (env) config.env = env
  return config
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function loadConfig(configPath: string = resolve(process.cwd(), 'oros.config.json')): Promise<OrosConfig> {
  if (!(await fileExists(configPath))) {
    return applyRuntimeOverrides(structuredClone(DEFAULT_CONFIG))
  }

  const raw = await readFile(configPath, 'utf8')
  const parsed = JSON.parse(raw) as Partial<OrosConfig>

  const merged: OrosConfig = {
    models: { ...DEFAULT_CONFIG.models, ...parsed.models },
    ollama: { ...DEFAULT_CONFIG.ollama, ...parsed.ollama },
    runtime: { ...DEFAULT_CONFIG.runtime, ...parsed.runtime },
    preferences: { ...DEFAULT_CONFIG.preferences, ...parsed.preferences },
    mcpServers: {}
  }

  if (isRecord(parsed.mcpServers)) {
    for (const [name, value] of Object.entries(parsed.mcpServers)) {
      const server = mergeServerConfig(value)
      if (server) {
        merged.mcpServers[name] = server
      }
    }
  }

  return applyRuntimeOverrides(merged)
}

function applyRuntimeOverrides(config: OrosConfig): OrosConfig {
  const client = (process.env.CLIENT || 'ollama').toLowerCase().trim()
  
  // Define prefix for environment variables based on client
  let prefix: string
  switch (client) {
    case 'openrouter':
      prefix = 'OPENROUTER'
      break
    case 'mistral':
      prefix = 'MISTRAL'
      break
    case 'ollama':
    default:
      prefix = 'OROS' // fallback for ollama and others
      break
  }

  const fastModel = process.env[`${prefix}_FAST_MODEL`] || config.models.fast
  const plannerModel = process.env[`${prefix}_PLANNER_MODEL`] || config.models.planner
  const embeddingsModel = process.env[`${prefix}_EMBEDDINGS_MODEL`] || config.models.embeddings

  const baseUrl = process.env.OROS_OLLAMA_URL || config.ollama?.baseUrl

  return {
    ...config,
    models: {
      fast: fastModel,
      planner: plannerModel,
      embeddings: embeddingsModel
    },
    ollama: {
      baseUrl: baseUrl
    },
  }
}

export async function saveConfig(config: OrosConfig, configPath: string = resolve(process.cwd(), 'oros.config.json')): Promise<void> {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}