import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { Tool as OllamaTool } from 'ollama'
import type { ActionResult, AgentState, NativeToolDefinition, NativeToolExecutionResult, ShellAction } from '../types/index.ts'
import { captureScreen } from '../perception/vision.ts'
import { GuiController } from '../action/gui-controller.ts'
import { runShellAction } from '../action/shell-runner.ts'
import type { McpHost } from '../mcp/mcp-host.ts'
import type { FirecrawlSearchTool } from './firecrawl-search.ts'
import type { Logger } from '../system/logger.ts'
import type { ContextManager } from '../memory/context-manager.ts'
import type { BrowserControl } from '../action/browser-controller.ts'
import { deploySubagent } from '../action/subagent-deployer.ts'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../system/config.ts'
import { UniversalClient } from '../llm/universal-client.ts'

export interface ToolExecutionContext {
  goal: string
  state: AgentState
  gui: GuiController
  browser: BrowserControl
  mcp: McpHost
  firecrawl: FirecrawlSearchTool
  client: UniversalClient
  logger: Logger
  contextManager: ContextManager
  fastModel: string
  workspaceRoot: string
}

export interface NativeToolRegistryOptions {
  shellRunner?: (action: ShellAction) => Promise<ActionResult>
}

export interface ToolCall {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function toPath(value: unknown): string {
  if (!isString(value) || !value.trim()) {
    throw new Error('Path is required')
  }
  return value.trim()
}

function resolvePath(target: string, workspaceRoot: string): string {
  if (target.startsWith('\\\\') || target.startsWith('/') || target.includes(':')) {
    return resolve(target)
  }
  return resolve(workspaceRoot, target)
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

function isProbablyTextFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase()
  return new Set([
    '.txt', '.md', '.markdown', '.json', '.jsonc', '.json5', '.js', '.mjs', '.cjs', '.ts', '.tsx',
    '.jsx', '.css', '.scss', '.html', '.htm', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf',
    '.csv', '.tsv', '.py', '.sh', '.ps1', '.bat', '.cmd', '.rb', '.go', '.rs', '.java', '.c',
    '.cc', '.cpp', '.h', '.hpp', '.cs', '.php', '.sql', '.env', '.log', '.properties'
  ]).has(extension) || extension === ''
}

function isIgnoredWorkspaceDir(dirName: string): boolean {
  return new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage']).has(dirName.toLowerCase())
}

async function collectTextFiles(root: string, maxDepth = 6, depth = 0, results: string[] = []): Promise<string[]> {
  if (depth > maxDepth) {
    return results
  }

  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = resolve(root, entry.name)
    if (entry.isDirectory()) {
      if (!isIgnoredWorkspaceDir(entry.name)) {
        await collectTextFiles(fullPath, maxDepth, depth + 1, results)
      }
      continue
    }

    if (entry.isFile() && isProbablyTextFile(fullPath)) {
      results.push(fullPath)
    }
  }

  return results
}

async function readSmallTextFile(filePath: string, maxBytes = 1_500_000): Promise<string | undefined> {
  const fileStat = await stat(filePath)
  if (fileStat.size > maxBytes) {
    return undefined
  }

  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return undefined
  }
}

function formatSearchHit(filePath: string, lineNumber: number, line: string): string {
  return `${filePath}:${lineNumber}: ${line.trim()}`
}

async function searchWorkspaceFiles(options: {
  root: string
  query: string
  regex?: RegExp
  limit: number
}): Promise<string> {
  const files = await collectTextFiles(options.root)
  const hits: string[] = []
  const needle = options.query.toLowerCase()

    for (const filePath of files) {
      const content = await readSmallTextFile(filePath)
      if (!content) {
        continue
      }

      const lines = content.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? ''
        if (options.regex) {
          options.regex.lastIndex = 0
        }
        const matched = options.regex ? options.regex.test(line) : line.toLowerCase().includes(needle)
        if (matched) {
          hits.push(formatSearchHit(filePath, index + 1, line))
          if (hits.length >= options.limit) {
            return hits.join('\n')
          }
      }
    }
  }

  return hits.length > 0 ? hits.join('\n') : 'No matches found.'
}

function buildAppSearchScript(query: string, limit: number): string {
  const escaped = escapePowerShellSingleQuoted(query)
  return [
    `$query = '${escaped}'`,
    `$limit = ${Math.max(1, Math.min(25, limit))}`,
    `$results = @()`,
    `try {`,
    `  $apps = @(Get-StartApps | Where-Object { $_.Name -like "*$query*" -or $_.AppID -like "*$query*" } | Select-Object -First $limit)`,
    `  foreach ($app in $apps) { $results += "start-app | $($app.Name) | $($app.AppID)" }`,
    `} catch { }`,
    `try {`,
    `  $commands = @(Get-Command -Name "*$query*" -ErrorAction SilentlyContinue | Select-Object -First $limit)`,
    `  foreach ($command in $commands) { $results += "command | $($command.Name) | $($command.Source)" }`,
    `} catch { }`,
    `if ($results.Count -eq 0) { "No apps or commands matched $query" } else { $results | Select-Object -Unique }`
  ].join('; ')
}

function buildAppOpenScript(query: string): string {
  const escaped = escapePowerShellSingleQuoted(query)
  return [
    `$query = '${escaped}'`,
    `if (Test-Path -LiteralPath $query) {`,
    `  $resolved = (Resolve-Path -LiteralPath $query).Path`,
    `  Start-Process -FilePath $resolved`,
    `  "Opened file path: $resolved"`,
    `  exit 0`,
    `}`,
    `$startApps = @(Get-StartApps | Where-Object { $_.Name -ieq $query -or $_.AppID -ieq $query -or $_.Name -like "*$query*" -or $_.AppID -like "*$query*" } | Select-Object -First 1)`,
    `if ($startApps.Count -gt 0) {`,
    `  $app = $startApps[0]`,
    `  Start-Process -FilePath "shell:AppsFolder\\$($app.AppID)"`,
    `  "Opened Start app: $($app.Name)"`,
    `  exit 0`,
    `}`,
    `$command = Get-Command -Name $query -ErrorAction SilentlyContinue`,
    `if (-not $command) { $command = Get-Command -Name "$query.exe" -ErrorAction SilentlyContinue }`,
    `if ($command) {`,
    `  $path = if ($command.Source) { $command.Source } else { $command.Path }`,
    `  if (-not $path) { $path = $command.Definition }`,
    `  Start-Process -FilePath $path`,
    `  "Opened command: $path"`,
    `  exit 0`,
    `}`,
    `throw "Could not resolve app or command: $query"`
  ].join('; ')
}

function runNodeCode(code: string, cwd: string, timeoutMs: number = 120000, env?: Record<string, string>): Promise<ActionResult> {
  const startedAt = new Date().toISOString()
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd,
      env: {
        ...process.env,
        ...env
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
        tool: 'code_execute',
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
        tool: 'code_execute',
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error)
      })
    })

    child.on('close', code => {
      clearTimeout(timeoutHandle)
      const result: ActionResult = {
        ok: code === 0,
        tool: 'code_execute',
        startedAt,
        finishedAt: new Date().toISOString(),
        stdout,
        stderr
      }
      if (code !== 0) {
        result.error = `process exited with code ${code ?? -1}`
      }
      resolve(result)
    })
  })
}

async function executeFileEdit(path: string, find: string, replace: string, workspaceRoot: string): Promise<{ before: string; after: string }> {
  const resolved = resolvePath(path, workspaceRoot)
  const before = await readFile(resolved, 'utf8')
  if (!before.includes(find)) {
    throw new Error(`Text not found in ${resolved}`)
  }
  const after = before.replace(find, replace)
  await writeFile(resolved, after, 'utf8')
  return { before, after }
}

export class NativeToolRegistry {
  private readonly tools: NativeToolDefinition[]
  private readonly shellRunner: (action: ShellAction) => Promise<ActionResult>

  constructor(options: NativeToolRegistryOptions = {}) {
    this.shellRunner = options.shellRunner || (async action => runShellAction(action))
    this.tools = [
      {
        type: 'function',
        function: {
          name: 'shell_execute',
          description: 'Run a shell command in PowerShell, cmd, or WSL.',
          parameters: {
            type: 'object',
            properties: {
              tool: { type: 'string', enum: ['powershell', 'cmd', 'wsl'] },
              command: { type: 'string', description: 'Shell command to execute.' },
              cwd: { type: 'string', description: 'Working directory for the command.' },
              timeout: { type: 'number', description: 'Timeout in milliseconds.' }
            },
            required: ['tool', 'command']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'app_search',
          description: 'Search installed apps and commands on the local Windows machine.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'App or command name to search for.' },
              limit: { type: 'number', description: 'Maximum results to return.' }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'app_open',
          description: 'Open a Windows app, executable, or file path.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'App name, executable, or file path.' }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'console_finalize',
          description: 'Call this tool to signal that the goal has been fully completed. It will clear the terminal and print the final answer cleanly.',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Final response to print.' },
              clear: { type: 'boolean', description: 'Clear the console before printing.', default: true }
            },
            required: ['text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'code_execute',
          description: 'Execute JavaScript code locally in Node.js.',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'JavaScript source code.' },
              cwd: { type: 'string', description: 'Working directory.' },
              timeout: { type: 'number', description: 'Timeout in milliseconds.' }
            },
            required: ['code']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'fs_read_file',
          description: 'Read a text file from disk.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'fs_write_file',
          description: 'Write a text file to disk, creating parent folders if needed.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              overwrite: { type: 'boolean', description: 'Overwrite existing content.' }
            },
            required: ['path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'fs_edit_file',
          description: 'Edit a text file by replacing a substring.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              find: { type: 'string' },
              replace: { type: 'string' }
            },
            required: ['path', 'find', 'replace']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'fs_delete_path',
          description: 'Delete a file or directory.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              recursive: { type: 'boolean' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'fs_list_dir',
          description: 'List the contents of a directory.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'workspace_search',
          description: 'Search workspace text files for a literal string.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              root: { type: 'string', description: 'Directory to search from. Defaults to the workspace root.' },
              limit: { type: 'number' }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'workspace_regex_search',
          description: 'Search workspace text files with a regular expression.',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              root: { type: 'string', description: 'Directory to search from. Defaults to the workspace root.' },
              flags: { type: 'string', description: 'Regex flags such as i or m.' },
              limit: { type: 'number' }
            },
            required: ['pattern']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_open',
          description: 'Open a URL in the default browser.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string' }
            },
            required: ['url']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_fetch',
          description: 'Fetch the text content of a URL.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string' }
            },
            required: ['url']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_click',
          description: 'Click a point in the active browser page.',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' }
            },
            required: ['x', 'y']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_type',
          description: 'Type text into the active browser page.',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' }
            },
            required: ['text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_press',
          description: 'Press one or more keys in the active browser page.',
          parameters: {
            type: 'object',
            properties: {
              keys: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['keys']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_screenshot',
          description: 'Capture the current browser page as an image.',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_close',
          description: 'Close the current browser session.',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'capture_screen',
          description: 'Capture the current screen for visual inspection.',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'gui_click',
          description: 'Click at screen coordinates.',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              button: { type: 'string', enum: ['left', 'right'] }
            },
            required: ['x', 'y']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'gui_type',
          description: 'Type text into the focused application.',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' }
            },
            required: ['text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'gui_keys',
          description: 'Press a keyboard shortcut or key sequence.',
          parameters: {
            type: 'object',
            properties: {
              keys: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['keys']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'gui_scroll',
          description: 'Scroll the focused window.',
          parameters: {
            type: 'object',
            properties: {
              amount: { type: 'number' }
            },
            required: ['amount']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'mcp_call',
          description: 'Call a tool exposed by an MCP server.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string' },
              tool: { type: 'string' },
              args: { type: 'object' }
            },
            required: ['server', 'tool']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web using Firecrawl.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              limit: { type: 'number' }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'deploy_subagent',
          description: 'Deploy a new sub-agent with a specific goal.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'summarize',
          description: 'Summarize recent text for the current goal.',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              goal: { type: 'string' }
            },
            required: ['text']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'memory_recall',
          description: 'Recall relevant memory for the current goal.',
          parameters: {
            type: 'object',
            properties: {
              goal: { type: 'string' }
            }
          }
        }
      }
    ]
  }

  list(): NativeToolDefinition[] {
    return this.tools
  }

  isDangerous(toolName: string, args: Record<string, unknown>): boolean {
    if (toolName === 'shell_execute' || toolName === 'code_execute' || toolName === 'fs_delete_path') {
      return true
    }
    if (toolName === 'fs_write_file' || toolName === 'fs_edit_file') {
      return Boolean(args.overwrite ?? true)
    }
    return false
  }

  async execute(toolCall: ToolCall, context: ToolExecutionContext): Promise<NativeToolExecutionResult> {
    const name = toolCall.function.name
    const args = toolCall.function.arguments || {}
    try {
      switch (name) {
        case 'shell_execute': {
          const tool = isString(args.tool) ? args.tool : 'powershell'
          const command = isString(args.command) ? args.command : ''
          const cwd = isString(args.cwd) ? args.cwd : undefined
          const timeout = typeof args.timeout === 'number' ? args.timeout : undefined
          if (!command) {
            throw new Error('shell_execute requires command')
          }
          const shellParams: { command: string; cwd?: string; timeout?: number } = { command }
          if (cwd) {
            shellParams.cwd = cwd
          }
          if (timeout) {
            shellParams.timeout = timeout
          }
          const result = await this.shellRunner({
            type: 'shell',
            tool: tool as 'powershell' | 'cmd' | 'wsl',
            params: shellParams
          })
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok
              ? (result.stdout || result.stderr || 'Completed shell command')
              : (result.stderr || result.error || 'Shell command failed'),
            metadata: { stdout: result.stdout, stderr: result.stderr }
          }
          if (!result.ok && result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'app_search': {
          const query = isString(args.query) ? args.query.trim() : ''
          const limit = typeof args.limit === 'number' ? args.limit : 10
          if (!query) {
            throw new Error('app_search requires query')
          }
          const result = await this.shellRunner({
            type: 'shell',
            tool: 'powershell',
            params: {
              command: buildAppSearchScript(query, limit),
              timeout: 30000
            }
          })
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.stdout || result.stderr || `Searched for ${query}`) : (result.stderr || result.error || 'App search failed'),
            metadata: { query, limit, stdout: result.stdout, stderr: result.stderr }
          }
          if (!result.ok && result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'app_open': {
          const query = isString(args.query) ? args.query.trim() : ''
          if (!query) {
            throw new Error('app_open requires query')
          }
          const result = await this.shellRunner({
            type: 'shell',
            tool: 'powershell',
            params: {
              command: buildAppOpenScript(query),
              timeout: 30000
            }
          })
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.stdout || `Opened ${query}`) : (result.stderr || result.error || 'App open failed'),
            metadata: { query, stdout: result.stdout, stderr: result.stderr }
          }
          if (!result.ok && result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'console_finalize': {
          const text = isString(args.text) ? args.text : ''
          const clear = args.clear !== false
          if (!text) {
            throw new Error('console_finalize requires text')
          }
          if (clear) {
            try {
              console.clear()
            } catch {
              process.stdout.write('\x1Bc')
            }
          }
          process.stdout.write(`${text.trim()}\n`)
          return {
            ok: true,
            tool: name,
            content: text.trim(),
            metadata: { clear }
          }
        }
        case 'code_execute': {
          const code = isString(args.code) ? args.code : ''
          const cwd = isString(args.cwd) ? args.cwd : context.workspaceRoot
          const timeout = typeof args.timeout === 'number' ? args.timeout : 120000
          if (!code) {
            throw new Error('code_execute requires code')
          }
          const result = await runNodeCode(code, cwd, timeout)
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.stdout || 'Code executed successfully') : (result.stderr || result.error || 'Code execution failed'),
            metadata: {
              stdout: result.stdout,
              stderr: result.stderr
            }
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'fs_read_file': {
          const path = resolvePath(toPath(args.path), context.workspaceRoot)
          const content = await readFile(path, 'utf8')
          return { ok: true, tool: name, content, metadata: { path } }
        }
        case 'fs_write_file': {
          const path = resolvePath(toPath(args.path), context.workspaceRoot)
          const content = isString(args.content) ? args.content : ''
          const overwrite = args.overwrite !== false
          if (!overwrite) {
            try {
              await readFile(path, 'utf8')
              throw new Error(`File already exists and overwrite is false: ${path}`)
            } catch (error) {
              if (!(error instanceof Error && error.message.includes('ENOENT'))) {
                throw error
              }
            }
          }
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, content, 'utf8')
          return { ok: true, tool: name, content: `Wrote ${content.length} characters to ${path}`, metadata: { path, length: content.length } }
        }
        case 'fs_edit_file': {
          const path = toPath(args.path)
          const find = isString(args.find) ? args.find : ''
          const replace = isString(args.replace) ? args.replace : ''
          if (!find) {
            throw new Error('fs_edit_file requires find')
          }
          const resolved = resolvePath(path, context.workspaceRoot)
          const { before, after } = await executeFileEdit(resolved, find, replace, context.workspaceRoot)
          return {
            ok: true,
            tool: name,
            content: `Updated ${resolved}`,
            metadata: {
              path: resolved,
              beforeLength: before.length,
              afterLength: after.length
            }
          }
        }
        case 'fs_delete_path': {
          const path = resolvePath(toPath(args.path), context.workspaceRoot)
          const recursive = Boolean(args.recursive)
          await rm(path, { recursive, force: true })
          return { ok: true, tool: name, content: `Deleted ${path}`, metadata: { path, recursive } }
        }
        case 'fs_list_dir': {
          const path = resolvePath(toPath(args.path), context.workspaceRoot)
          const entries = await readdir(path, { withFileTypes: true })
          const lines = entries.map(entry => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`)
          return { ok: true, tool: name, content: lines.join('\n'), metadata: { path, count: entries.length } }
        }
        case 'workspace_search': {
          const query = isString(args.query) ? args.query.trim() : ''
          const root = isString(args.root) ? resolvePath(args.root, context.workspaceRoot) : context.workspaceRoot
          const limit = typeof args.limit === 'number' ? args.limit : 20
          if (!query) {
            throw new Error('workspace_search requires query')
          }
          const content = await searchWorkspaceFiles({ root, query, limit })
          return { ok: true, tool: name, content, metadata: { root, query, limit } }
        }
        case 'workspace_regex_search': {
          const pattern = isString(args.pattern) ? args.pattern.trim() : ''
          const root = isString(args.root) ? resolvePath(args.root, context.workspaceRoot) : context.workspaceRoot
          const flags = isString(args.flags) ? args.flags : 'i'
          const limit = typeof args.limit === 'number' ? args.limit : 20
          if (!pattern) {
            throw new Error('workspace_regex_search requires pattern')
          }
          let regex: RegExp
          try {
            regex = new RegExp(pattern, flags)
          } catch (error) {
            throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`)
          }
          const content = await searchWorkspaceFiles({ root, query: pattern, regex, limit })
          return { ok: true, tool: name, content, metadata: { root, pattern, flags, limit } }
        }
        case 'browser_open': {
          const url = isString(args.url) ? args.url : ''
          if (!url) {
            throw new Error('browser_open requires url')
          }
          const result = await context.browser.open(url)
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.content || `Opened ${url}`) : result.error || 'Failed to open browser',
            metadata: result.snapshot ? { url, snapshot: result.snapshot } : { url }
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'browser_fetch': {
          const url = isString(args.url) ? args.url : ''
          if (!url) {
            throw new Error('browser_fetch requires url')
          }
          const result = await context.browser.open(url)
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.snapshot?.content || result.content) : (result.error || 'Failed to fetch page'),
            metadata: result.snapshot ? { url, snapshot: result.snapshot } : { url }
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'browser_click': {
          const x = typeof args.x === 'number' ? args.x : undefined
          const y = typeof args.y === 'number' ? args.y : undefined
          if (typeof x !== 'number' || typeof y !== 'number') {
            throw new Error('browser_click requires x and y')
          }
          const result = await context.browser.click(x, y)
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.content || `Clicked ${x},${y}`) : (result.error || 'Browser click failed')
          }
          if (result.snapshot) {
            execResult.metadata = { snapshot: result.snapshot }
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'browser_type': {
          const text = isString(args.text) ? args.text : ''
          if (!text) {
            throw new Error('browser_type requires text')
          }
          const result = await context.browser.type(text)
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.content || 'Typed text') : (result.error || 'Browser type failed')
          }
          if (result.snapshot) {
            execResult.metadata = { snapshot: result.snapshot }
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'browser_press': {
          const keys = Array.isArray(args.keys) ? args.keys.filter(isString) : []
          if (keys.length === 0) {
            throw new Error('browser_press requires keys')
          }
          const result = await context.browser.press(keys)
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.content || 'Pressed keys') : (result.error || 'Browser press failed')
          }
          if (result.snapshot) {
            execResult.metadata = { snapshot: result.snapshot }
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'browser_screenshot': {
          const result = await context.browser.screenshot()
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.content || 'Captured browser screenshot') : (result.error || 'Browser screenshot failed')
          }
          if (result.snapshot) {
            execResult.metadata = { snapshot: result.snapshot }
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'browser_close': {
          const result = await context.browser.close()
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? (result.content || 'Browser closed') : (result.error || 'Browser close failed')
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'capture_screen': {
          const snapshot = await captureScreen()
          return {
            ok: true,
            tool: name,
            content: `Captured screen ${snapshot.width}x${snapshot.height} (${snapshot.hash})`,
            metadata: {
              hash: snapshot.hash,
              width: snapshot.width,
              height: snapshot.height,
              imageBase64: snapshot.imageBase64
            }
          }
        }
        case 'gui_click': {
          const x = typeof args.x === 'number' ? args.x : undefined
          const y = typeof args.y === 'number' ? args.y : undefined
          if (typeof x !== 'number' || typeof y !== 'number') {
            throw new Error('gui_click requires x and y')
          }
          const result = await context.gui.execute({
            type: 'gui',
            tool: 'mouse_click',
            params: { x, y, button: (isString(args.button) ? args.button : 'left') as 'left' | 'right' }
          })
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? 'Clicked successfully' : result.error || 'Click failed'
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'gui_type': {
          const text = isString(args.text) ? args.text : ''
          if (!text) {
            throw new Error('gui_type requires text')
          }
          const result = await context.gui.execute({
            type: 'gui',
            tool: 'keyboard_type',
            params: { text }
          })
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? 'Typed text successfully' : result.error || 'Typing failed'
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'gui_keys': {
          const keys = Array.isArray(args.keys) ? args.keys.filter(isString) : []
          if (keys.length === 0) {
            throw new Error('gui_keys requires keys')
          }
          const result = await context.gui.execute({
            type: 'gui',
            tool: 'key_combo',
            params: { keys }
          })
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? 'Pressed keys successfully' : result.error || 'Key press failed'
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'gui_scroll': {
          const amount = typeof args.amount === 'number' ? args.amount : undefined
          if (typeof amount !== 'number') {
            throw new Error('gui_scroll requires amount')
          }
          const result = await context.gui.execute({
            type: 'gui',
            tool: 'scroll',
            params: { amount }
          })
          const execResult: NativeToolExecutionResult = {
            ok: result.ok,
            tool: name,
            content: result.ok ? 'Scrolled successfully' : result.error || 'Scroll failed'
          }
          if (result.error) {
            execResult.error = result.error
          }
          return execResult
        }
        case 'mcp_call': {
          const server = isString(args.server) ? args.server : ''
          const tool = isString(args.tool) ? args.tool : ''
          const mcpArgs = args.args && typeof args.args === 'object' && !Array.isArray(args.args) ? (args.args as Record<string, unknown>) : {}
          if (!server || !tool) {
            throw new Error('mcp_call requires server and tool')
          }
          const result = await context.mcp.callTool(server, tool, mcpArgs)
          return {
            ok: true,
            tool: name,
            content: typeof result === 'string' ? result : JSON.stringify(result),
            metadata: { server, tool }
          }
        }
        case 'web_search': {
          const query = isString(args.query) ? args.query : ''
          const limit = typeof args.limit === 'number' ? args.limit : 5
          if (!query) {
            throw new Error('web_search requires query')
          }
          const result = await context.firecrawl.search({ query, limit })
          return { ok: true, tool: name, content: result.text.slice(0, 12000), metadata: { query, limit } }
        }
        case 'deploy_subagent': {
          const query = isString(args.query) ? args.query : ''
          const limit = typeof args.limit === 'number' ? args.limit : 5
          if (!query) {
            throw new Error('deploy_subagent requires query')
          }
          const config = await loadConfig()
          const result = await deploySubagent(randomUUID(), { goal: query }, config)
          return { ok: true, tool: name, content: result, metadata: { query, limit } }
        }
        case 'summarize': {
          const text = isString(args.text) ? args.text : ''
          const goal = isString(args.goal) ? args.goal : context.goal
          if (!text) {
            throw new Error('summarize requires text')
          }
          const response = await context.client.generate({
            model: context.fastModel,
            messages: [
              {
                role: 'system',
                content: 'Summarize the provided text for an autonomous agent. Be concise and faithful.'
              },
              {
                role: 'user',
                content: `Goal: ${goal}\n\nText:\n${text.slice(0, 12000)}`
              }
            ]
          })
          return { ok: true, tool: name, content: response.text.trim(), metadata: { goal } }
        }
        case 'memory_recall': {
          const goal = isString(args.goal) ? args.goal : context.goal
          const memory = await context.contextManager.getRelevantContext(goal)
          return {
            ok: true,
            tool: name,
            content: memory.summary || 'No relevant memory found.',
            metadata: { count: memory.episodes.length }
          }
        }
        default:
          throw new Error(`Unknown tool: ${name}`)
      }
    } catch (error) {
      return {
        ok: false,
        tool: name,
        content: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export function toOllamaTools(
  tools: NativeToolDefinition[]
): NativeToolDefinition[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
    }
  }))
}