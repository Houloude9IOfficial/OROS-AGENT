import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const CANDIDATES = [
  process.env.OROS_PYTHON,
  process.env.CODEX_BUNDLED_PYTHON,
  'C:\\Users\\USER\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe',
  'python.exe',
  'python',
  'py'
].filter((value): value is string => typeof value === 'string' && value.length > 0)

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function resolvePythonExecutable(): Promise<string | undefined> {
  for (const candidate of CANDIDATES) {
    if (candidate.includes('\\') && (await exists(candidate))) {
      return candidate
    }
    if (!candidate.includes('\\')) {
      return candidate
    }
  }
  return undefined
}

export async function runPythonScript(script: string, args: string[] = [], input?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const executable = await resolvePythonExecutable()
  if (!executable) {
    throw new Error('No Python executable found for screenshot or GUI automation fallback')
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, ['-c', script, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      resolve({
        stdout,
        stderr,
        code: code ?? -1
      })
    })

    if (typeof input === 'string') {
      child.stdin.write(input)
    }
    child.stdin.end()
  })
}
