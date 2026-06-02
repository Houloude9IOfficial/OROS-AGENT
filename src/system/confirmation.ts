import inquirer from 'inquirer'

export type ConfirmationDecision = 'allow' | 'deny'

export interface ConfirmationRequest {
  toolName: string
  summary: string
  arguments: Record<string, unknown>
}

export interface ConfirmationGateOptions {
  prompt?: (request: ConfirmationRequest) => Promise<boolean>
}

export class SessionConfirmationGate {
  private readonly decisions = new Map<string, ConfirmationDecision>()
  private readonly prompt: (request: ConfirmationRequest) => Promise<boolean>

  constructor(options: ConfirmationGateOptions = {}) {
    this.prompt = options.prompt || this.defaultPrompt
  }

  async allow(request: ConfirmationRequest): Promise<boolean> {
    const cached = this.decisions.get(request.toolName)
    if (cached) {
      return cached === 'allow'
    }

    const allowed = await this.prompt(request)
    this.decisions.set(request.toolName, allowed ? 'allow' : 'deny')
    return allowed
  }

  clear(): void {
    this.decisions.clear()
  }

  private async defaultPrompt(request: ConfirmationRequest): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return false
    }

    const { allowed } = await inquirer.prompt<{ allowed: boolean }>([
      {
        type: 'confirm',
        name: 'allowed',
        message: [
          `Allow "${request.toolName}" for this session?`,
          request.summary,
          JSON.stringify(request.arguments, null, 2)
        ].join('\n'),
        default: false
      }
    ])

    return Boolean(allowed)
  }
}
