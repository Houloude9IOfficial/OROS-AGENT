import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { getDataRoot } from './paths.ts'
import chalk from 'chalk'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success' | 'other'

export interface Logger {
  debug(message: string, details?: Record<string, unknown>): void
  info(message: string, details?: Record<string, unknown>): void
  warn(message: string, details?: Record<string, unknown>): void
  error(message: string, details?: Record<string, unknown>): void
  success(message: string, details?: Record<string, unknown>): void
  other(message: string, details?: Record<string, unknown>): void
}

export interface LogColorMap {
  debug: any
  info: any
  warn: any
  error: any
  success: any
}

const logColorMap: LogColorMap = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
  success: chalk.green
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
      // ignore file errors
    }
  
    const line = `[${level.toUpperCase()}] ${message}`
    const detailStr = details ? JSON.stringify(details) : ''
  
    if (level === 'error') {
      console.error(chalk.red(line), detailStr)
      return
    }
  
    if (level === 'warn') {
      console.warn(chalk.yellow(line), detailStr)
      return
    }
  
    if (level === 'debug') {
      console.debug(chalk.gray(line), detailStr)
      return
    }

    if (level === 'success') {
      console.log(chalk.green(line), detailStr)
      return
    }

    if (level === 'other') {
      console.log(line, detailStr)
      return
    }
    console.log(chalk.blue(line), detailStr)
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
    },
    success: (message: string, details?: Record<string, unknown>) => {
      void write('success', message, details)
    },

    other: (message: string, details?: Record<string, unknown>) => {
      void write('other', message, details)
    }
  }
}
