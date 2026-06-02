import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { AgentCheckpoint, AgentState } from '../types/index.ts'
import { getDataRoot } from '../system/paths.ts'

export class StateManager {
  private readonly rootDir: string

  constructor(rootDir: string = resolve(getDataRoot(), 'state')) {
    this.rootDir = rootDir
  }

  private checkpointPath(taskId: string): string {
    return resolve(this.rootDir, 'checkpoints', `${taskId}.json`)
  }

  async saveCheckpoint(taskId: string, state: AgentState): Promise<void> {
    const filePath = this.checkpointPath(taskId)
    await mkdir(dirname(filePath), { recursive: true })
    const checkpoint: AgentCheckpoint = {
      goal: state.goal,
      history: state.history,
      plan: state.plan,
      currentTaskId: state.currentTaskId,
      paused: state.paused,
      stopped: state.stopped,
      updatedAt: new Date().toISOString()
    }
    await writeFile(filePath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8')
  }

  async loadCheckpoint(taskId: string): Promise<AgentCheckpoint | undefined> {
    try {
      const content = await readFile(this.checkpointPath(taskId), 'utf8')
      return JSON.parse(content) as AgentCheckpoint
    } catch {
      return undefined
    }
  }

  async clearCheckpoint(taskId: string): Promise<void> {
    try {
      await unlink(this.checkpointPath(taskId))
    } catch {
      // no-op
    }
  }

  createInitialState(goal: string, plan?: AgentCheckpoint['plan']): AgentState {
    return {
      goal,
      history: [],
      plan,
      paused: false,
      stopped: false,
      waitingForUser: false
    }
  }
}
