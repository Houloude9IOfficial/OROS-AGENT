import { createInterface } from 'node:readline'
import type { HotkeyEvent } from '../types/index.ts'

export type HotkeyHandler = (event: HotkeyEvent) => void | Promise<void>

export class HotkeyListener {
  private readonly stopSignals = new Set<() => void>()
  private stdinInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY
  })
  private readonly handler: HotkeyHandler

  constructor(handler: HotkeyHandler) {
    this.handler = handler
  }

  async start(): Promise<() => void> {
    try {
      const module = await import('node-global-key-listener')
      const Listener = module.GlobalKeyboardListener as new () => {
        addListener: (callback: (event: { name?: string; state?: string }) => void) => () => void
      }
      const listener = new Listener()
      const unsubscribe = listener.addListener(event => {
        const key = (event.name || '').toLowerCase()
        if (key === 'pause') {
          void this.handler({ type: 'pause', source: 'global-hotkey' })
        }
        if (key === 'end') {
          void this.handler({ type: 'stop', source: 'global-hotkey' })
        }
      })
      this.stopSignals.add(unsubscribe)
    } catch {
      this.stdinInterface.on('line', line => {
        const command = line.trim().toLowerCase()
        if (command === 'pause') {
          void this.handler({ type: 'pause', source: 'stdin' })
        }
        if (command === 'resume') {
          void this.handler({ type: 'resume', source: 'stdin' })
        }
        if (command === 'stop') {
          void this.handler({ type: 'stop', source: 'stdin' })
        }
      })
    }

    return () => {
      for (const dispose of this.stopSignals) {
        dispose()
      }
      this.stopSignals.clear()
      this.stdinInterface.close()
    }
  }
}
