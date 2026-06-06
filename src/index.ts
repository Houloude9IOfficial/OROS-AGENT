import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { loadConfig, saveConfig } from './system/config.ts'
import { createLogger } from './system/logger.ts'
import { StateManager } from './core/state-manager.ts'
import { VectorStore } from './memory/vector-store.ts'
import { StructuredStore } from './memory/structured-store.ts'
import { UniversalClient } from './llm/universal-client.ts'
import { Embedder } from './memory/embedder.ts'
import { ContextManager } from './memory/context-manager.ts'
import { McpHost } from './mcp/mcp-host.ts'
import { Agent } from './core/agent.ts'
import { HotkeyListener } from './system/hotkey-listener.ts'
import { captureScreen } from './perception/vision.ts'
import { classifyTask } from './core/task-classifier.ts'
import { Planner } from './core/planner.ts'
import { buildPlanSummary } from './llm/prompt-engine.ts'
import { getDataRoot } from './system/paths.ts'
import { consentHelpLine, ensureAcceptedRisks, saveAcceptedRisks } from './system/consent.ts'
import { runUI } from './cli/ui.ts'

dotenv.config()

function parseArgs(argv: string[]): { command: string; goal?: string; riskAck: boolean; taskId?: string; configPath?: string } {
  const [command = 'help', ...rest] = argv
  let goal: string | undefined
  let riskAck = false
  let taskId: string | undefined
  let configPath: string | undefined

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]
    if (value === '--i-understand-the-risks') {
      riskAck = true
      continue
    }
    if (value === '--accept-risks') {
      riskAck = true
      continue
    }
    if (value === '--task-id') {
      taskId = rest[index + 1]
      index += 1
      continue
    }
    if (value === '--config') {
      configPath = rest[index + 1]
      index += 1
      continue
    }
    if (!goal) {
      goal = value
    }
  }

  const result: { command: string; goal?: string; riskAck: boolean; taskId?: string; configPath?: string } = {
    command,
    riskAck
  }
  if (goal) result.goal = goal
  if (taskId) result.taskId = taskId
  if (configPath) result.configPath = configPath
  return result
}

async function runDoctor(configPath: string | undefined): Promise<void> {
  const config = await loadConfig(configPath)
  const logger = createLogger()
  logger.info('Loaded configuration', { config })

  const universalClient = new UniversalClient(10000, process.env)
  const planner = new Planner(config.ollama.baseUrl, config.models.planner)
  const dataRoot = getDataRoot()
  const structuredStore = new StructuredStore(resolve(dataRoot, 'memory', 'structured'))
  const vectorStore = new VectorStore(resolve(dataRoot, 'memory', 'vector', 'episodes.json'))
  const embedder = new Embedder(universalClient, config.models.embeddings)

  const results = {
    classification: classifyTask('Open Notepad and type Hello'),
    plan: await planner.decompose('Organize Downloads'),
    structuredMemory: await structuredStore.read('user_preferences.yaml', { browser: 'chrome' }),
    screenCapture: await captureScreen().then(value => ({ ok: true, hash: value.hash })).catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) })),
    embeddingLength: (await embedder.embed('doctor check')).length,
    vectorStorePath: resolve(dataRoot, 'memory', 'vector', 'episodes.json')
  }

  console.log(JSON.stringify(results, null, 2))
}

async function runAgent(command: 'run' | 'resume', goal: string | undefined, taskId: string | undefined, riskAck: boolean, configPath: string | undefined): Promise<void> {
  if (!riskAck) {
    const accepted = await ensureAcceptedRisks()
    if (!accepted) {
      console.log(consentHelpLine())
      return
    }
  } else {
    await saveAcceptedRisks('command')
  }

  if (command === 'run' && !goal) {
    throw new Error('A goal is required for run')
  }

  const config = await loadConfig(configPath)
  const logger = createLogger()
  const stateManager = new StateManager()
  const universalClient = new UniversalClient(3600000, process.env)
  const embedder = new Embedder(universalClient, config.models.embeddings)
  const dataRoot = getDataRoot()
  const vectorStore = new VectorStore(resolve(dataRoot, 'memory', 'vector', 'episodes.json'))
  const structuredStore = new StructuredStore(resolve(dataRoot, 'memory', 'structured'))
  const contextManager = new ContextManager(vectorStore, embedder, structuredStore, config.runtime.memoryTopK)
  const mcp = new McpHost(config.mcpServers)
  await mcp.initialize().catch(error => {
    logger.warn('MCP initialization failed; continuing without tools', {
      error: error instanceof Error ? error.message : String(error)
    })
  })

  const agent = new Agent({
    config,
    logger,
    stateManager,
    contextManager,
    embedder,
    mcp
  })

  const hotkeys = new HotkeyListener(event => {
    logger.info('Hotkey event received', { ...event })
    if (event.type === 'pause') {
      if (agent.isPaused()) {
        agent.resumeControl()
      } else {
        agent.pause()
      }
    }
    if (event.type === 'resume') {
      agent.resumeControl()
    }
    if (event.type === 'stop') {
      agent.stop()
    }
  })
  const dispose = await hotkeys.start()

  try {
    if (command === 'resume') {
      if (!taskId) {
        throw new Error('task id required for resume')
      }
      const resumed = await agent.resume(taskId)
      console.log(JSON.stringify({ resumed: Boolean(resumed), taskId }, null, 2))
      return
    }

    const state = await agent.run(goal as string, taskId)
    console.log(JSON.stringify({ goal: state.goal, stopped: state.stopped, paused: state.paused, history: state.history.length }, null, 2))
  } finally {
    dispose()
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))

  switch (parsed.command) {
    case 'run':
    case 'resume':
      await runAgent(parsed.command, parsed.goal, parsed.taskId, parsed.riskAck, parsed.configPath)
      return
    case 'doctor':
      await runDoctor(parsed.configPath)
      return
    case 'config': {
      const config = await loadConfig(parsed.configPath)
      console.log(JSON.stringify(config, null, 2))
      return
    }
    case 'save-config': {
      const config = await loadConfig(parsed.configPath)
      await saveConfig(config, parsed.configPath)
      console.log('Configuration saved.')
      return
    }
    case 'accept-risks':
      await saveAcceptedRisks('command')
      console.log('Risk acceptance saved. Future runs can proceed without re-accepting.')
      return
    case 'ui': {
      const config = await loadConfig(parsed.configPath)
      const logger = createLogger()
    
      const stateManager = new StateManager()
    
      const universalClient = new UniversalClient(3600000, process.env)
      const embedder = new Embedder(universalClient, config.models.embeddings)
    
      const dataRoot = getDataRoot()
    
      const vectorStore = new VectorStore(
        resolve(dataRoot, 'memory', 'vector', 'episodes.json')
      )
    
      const structuredStore = new StructuredStore(
        resolve(dataRoot, 'memory', 'structured')
      )
    
      const contextManager = new ContextManager(
        vectorStore,
        embedder,
        structuredStore,
        config.runtime.memoryTopK
      )
    
      const mcp = new McpHost(config.mcpServers)
    
      await mcp.initialize().catch(() => {})
    
      const agent = new Agent({
        config,
        logger,
        stateManager,
        contextManager,
        embedder,
        mcp
      })
    
      await runUI({ agent })
      return
    }
    case 'help':
      if (!(await ensureAcceptedRisks())) {
        console.log(consentHelpLine())
      }
      console.log('Usage:')
      console.log('  npm run doctor')
      console.log('  npm run start -- config')
      return
    default:
      if (!(await ensureAcceptedRisks())) {
        console.log(consentHelpLine())
      }
      console.log('Usage:')
      console.log('  npm run doctor')
      console.log('  npm run start -- config')
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
