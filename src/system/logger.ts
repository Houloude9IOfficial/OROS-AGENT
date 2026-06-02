import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { getDataRoot } from './paths.ts'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, details?: Record<string, unknown>): void
  info(message: string, details?: Record<string, unknown>): void
  warn(message: string, details?: Record<string, unknown>): void
  error(message: string, details?: Record<string, unknown>): void
}

function serialize(level: LogLevel, message: string, details?: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(details ? { details } : {})
  }) + '\n'
}

export function createLogger(logFile?: string): Logger {
  const resolvedLogFile = logFile || resolve(getDataRoot(), 'logs', `oros_${new Date().toISOString().slice(0, 10)}.log`)

  async function write(level: LogLevel, message: string, details?: Record<string, unknown>): Promise<void> {
    try {
      const directory = dirname(resolvedLogFile)
      await mkdir(directory, { recursive: true })
      await appendFile(resolvedLogFile, serialize(level, message, details), 'utf8')
    } catch {
      // File logging is best-effort. Console output still happens below.
    }
    const line = `[${level.toUpperCase()}] ${message}`
    if (level === 'error') {
      console.error(line, details || '')
      return
    }
    if (level === 'warn') {
      console.warn(line, details || '')
      return
    }
    if (level === 'debug') {
      console.debug(line, details || '')
      return
    }
    console.log(line, details || '')
  }

  return {
    debug: (message, details) => {
      void write('debug', message, details)
    },
    info: (message, details) => {
      void write('info', message, details)
    },
    warn: (message, details) => {
      void write('warn', message, details)
    },
    error: (message, details) => {
      void write('error', message, details)
    }
  }
}
