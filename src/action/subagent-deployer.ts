import { createLogger } from '../system/logger.ts'
import { UniversalClient } from '../llm/universal-client.ts'
import type { OrosConfig } from '../types/index.ts'
import { Executor } from '../core/executor.ts'
import { ContextManager } from '../memory/context-manager.ts'
import { Embedder } from '../memory/embedder.ts'
import { McpHost } from '../mcp/mcp-host.ts'
import { VectorStore } from '../memory/vector-store.ts'
import { StructuredStore } from '../memory/structured-store.ts'
import { captureScreen } from '../perception/vision.ts'
import { GuiController } from '../action/gui-controller.ts'
import { FirecrawlSearchTool } from '../tools/firecrawl-search.ts'
import { toOllamaTools, type ToolCall } from '../tools/native-tool-registry.ts'
import { SessionConfirmationGate } from '../system/confirmation.ts'
import { resolve } from 'path/win32'
import { buildSubAgentPrompt } from '../llm/prompt-engine.ts'
import { getDataRoot } from '../system/paths.ts'
import { classifyTask } from '../core/task-classifier.ts'
import { selectModel } from '../llm/model-router.ts'

async function GetModel(goal: string, userConfig: OrosConfig) {
    const complexity = classifyTask(goal)
    const model = selectModel(goal, complexity.complexity, userConfig.models.fast, userConfig.models.planner)
    return model
}

const logger = createLogger()

interface SubAgentConfig {
    goal: string
}

export async function deploySubagent(
    agentId: string,
    subagentConfig: SubAgentConfig,
    userConfig: OrosConfig,
    memoryContext: string = ''
): Promise<string> {
    if (!subagentConfig.goal?.trim()) {
        logger.error(`Subagent ${agentId} has no goal configured`)
        throw new Error(`Subagent ${agentId} has no goal configured`)
    }

    try {


        logger.info(
            `Deploying subagent ${agentId} with goal "${subagentConfig.goal}"`
        )

        const client = new UniversalClient(3600000, process.env)
        const dataRoot = getDataRoot()
        
        const executor = new Executor({
              gui: new GuiController(),
              mcp: new McpHost(userConfig.mcpServers),
              firecrawl: new FirecrawlSearchTool(process.env.FIRECRAWL_API_KEY),
              client: client,
              logger: logger,
              contextManager: new ContextManager(new VectorStore(resolve(dataRoot, 'memory', 'vector', 'episodes.json')), new Embedder(client, userConfig.models.embeddings), new StructuredStore(resolve(dataRoot, 'memory', 'structured')), userConfig.runtime.memoryTopK),
              fastModel: userConfig.models.fast,
              workspaceRoot: process.cwd()
            })

        const tools = executor.listTools()
        const toolNames = tools.map(tool => tool.function.name)
        const prompt = buildSubAgentPrompt(subagentConfig.goal, tools, memoryContext)

        logger.success(
            `Subagent ${agentId} prompt is ready. Starting execution.`
        )

        const response = await client.generate({
            tools: toOllamaTools(tools),
            model: await GetModel(subagentConfig.goal, userConfig),
            messages: [
                {
                    role: 'system',
                    content: 'You are a specialized sub-agent working under a main AI agent.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ]
        })

        logger.success(
            `Subagent ${agentId} completed successfully`
        )

        return response.text
    } catch (error) {
        logger.error(
            `Subagent ${agentId} encountered an error during execution`,
            {
                error: (error as Error).message
            }
        )

        return (error as Error).message
    }
}