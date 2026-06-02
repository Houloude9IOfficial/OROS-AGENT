import { spawn } from 'node:child_process'
import type { ActionResult, ShellAction } from '../types/index.ts'

export interface ShellRunOptions {
  defaultTimeoutMs?: number
}

function commandForTool(action: ShellAction): { file: string; args: string[] } {
  switch (action.tool) {
    case 'cmd':
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', action.params.command] }
    case 'wsl':
      return { file: 'wsl.exe', args: ['bash', '-lc', action.params.command] }
    case 'powershell':
    default:
      return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', action.params.command] }
  }
}

export async function runShellAction(action: ShellAction, options: ShellRunOptions = {}): Promise<ActionResult> {
  const startedAt = new Date().toISOString()
  const { file, args } = commandForTool(action)
  const timeoutMs = action.params.timeout ?? options.defaultTimeoutMs ?? 120000

  return await new Promise<ActionResult>(resolve => {
    const child = spawn(file, args, {
      cwd: action.params.cwd,
      env: {
        ...process.env,
        ...action.params.env
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    const timeoutHandle = setTimeout(() => {
      child.kill()
      resolve({
        ok: false,
        tool: action.tool,
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim(),
        error: 'timeout'
      })
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', error => {
      clearTimeout(timeoutHandle)
      resolve({
        ok: false,
        tool: action.tool,
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout,
        stderr,
        error: error.message
      })
    })

    child.on('close', code => {
      clearTimeout(timeoutHandle)
      resolve({
        ok: code === 0,
        tool: action.tool,
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout,
        stderr,
        error: code === 0 ? undefined : `process exited with code ${code ?? -1}`
      })
    })
  })
}
