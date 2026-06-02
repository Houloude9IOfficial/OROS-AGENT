import { spawn } from 'node:child_process'
import type { McpServerConfig } from '../types/index.ts'

export interface RunningServer {
  name: string
  process: ReturnType<typeof spawn>
}

export class ServerRegistry {
  private readonly servers: Record<string, McpServerConfig>

  constructor(servers: Record<string, McpServerConfig>) {
    this.servers = servers
  }

  list(): Array<{ name: string; config: McpServerConfig }> {
    return Object.entries(this.servers).map(([name, config]) => ({ name, config }))
  }

  spawn(name: string): RunningServer {
    const config = this.servers[name]
    if (!config) {
      throw new Error(`Unknown MCP server: ${name}`)
    }

    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      env: {
        ...process.env,
        ...config.env
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    return {
      name,
      process: child
    }
  }
}
