const fs = require('fs');

const agentFile = 'src/core/agent.ts';
let content = fs.readFileSync(agentFile, 'utf8');

// 1. Update buildSystemPrompt
content = content.replace(
  "'If the task is complete, respond with a short completion message and no tool calls.',",
  "'When you have fully completed the task, you MUST call the console_finalize tool to declare completion. Do not stop until you call it.',\n    'Think step by step before acting if needed.',"
);

// 2. Remove heuristics functions
const heuristicsRegex = /function isResearchGoal.*?function historyOutput/s;
content = content.replace(heuristicsRegex, 'function historyOutput');

// 3. Remove buildFallbackToolCall
const fallbackRegex = /function buildFallbackToolCall.*?function buildFinalConsoleText/s;
content = content.replace(fallbackRegex, 'function buildFinalConsoleText');

// 4. Update the toolLoop method
const toolLoopStart = 'private async toolLoop(state: AgentState, goal: string, taskId: string): Promise<void> {';
const verifyGoalCompletionStart = 'private async verifyGoalCompletion(';

const newToolLoop = `  private async toolLoop(state: AgentState, goal: string, taskId: string): Promise<void> {
    const tools = this.executor.listTools()
    const toolNames = tools.map(tool => tool.function.name)
    const maxSteps = this.deps.config.runtime.maxToolCallsPerTask || Agent.DEFAULT_MAX_STEPS
    let consecutiveFailures = 0
    let lastFailureKey: string | undefined

    const executeToolCall = async (toolCall: ToolCall, messages: AgentChatMessage[]): Promise<NativeToolExecutionResult> => {
      const shouldConfirm = this.executor.isDangerous(toolCall.function.name, toolCall.function.arguments)

      if (shouldConfirm && !this.approvedToolCategories.has(toolCall.function.name)) {
        const approved = await this.confirmationGate.allow({
          toolName: toolCall.function.name,
          summary: 'This action can modify files, execute code, or otherwise change the local system.',
          arguments: toolCall.function.arguments
        })
        if (!approved) {
          state.waitingForUser = true
          this.deps.logger.warn('Dangerous tool denied by user', { tool: toolCall.function.name })
          return { ok: false, tool: toolCall.function.name, content: '', error: 'Tool denied by user' }
        }
        this.approvedToolCategories.add(toolCall.function.name)
      }

      const historyAction = { type: 'internal' as const, tool: toolCall.function.name, params: toolCall.function.arguments || {} }
      const result = await this.executor.execute(toolCall, state, goal)
      const actionResult: ActionResult = {
        ok: result.ok,
        tool: result.tool,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        ...(result.ok && result.content ? { stdout: result.content } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(result.metadata ? { metadata: result.metadata } : {})
      }

      state.history.push({ action: historyAction, result: actionResult })
      messages.push({ role: 'tool', tool_name: toolCall.function.name, content: result.content || result.error || 'ok' })
      await this.persistEpisode(goal, state, result.content || result.error || '', toolCall.function.name)
      return result
    }

    for (let step = state.history.length; step < maxSteps; step += 1) {
      await this.waitForControl()
      if (this.stopped || state.waitingForUser) {
        return
      }

      const snapshot = await captureScreen(this.deps.config.runtime.screenshotWidth, this.deps.config.runtime.screenshotQuality).catch(() => undefined)
      const screenAnalysis = snapshot && isVisionModel(this.deps.config.models.fast)
        ? await this.analyzer.describe(snapshot, this.deps.config.models.fast).catch(() => undefined)
        : undefined
      const memoryContext = await this.deps.contextManager.getRelevantContext(goal)
      const systemPrompt = buildSystemPrompt(
        goal,
        memoryContext.summary,
        screenAnalysis ? \`\${screenAnalysis.description} Titles=\${screenAnalysis.visibleTitles.join(', ')} Interactive=\${screenAnalysis.interactiveElements.join(', ')}\` : 'unavailable',
        toolNames
      )

      const plannerIsVision = isVisionModel(this.deps.config.models.planner)
      const messages: AgentChatMessage[] = [
        { role: 'system' as const, content: systemPrompt },
        ...this.buildConversation(state, goal),
        createUserMessage(
          goal,
          screenAnalysis ? { description: screenAnalysis.description } : undefined,
          undefined,
          snapshot && plannerIsVision ? { imageBase64: snapshot.imageBase64 } : undefined
        )
      ]

      let response
      try {
        response = await this.ollama.chat({
          model: this.deps.config.models.planner,
          messages,
          tools: toOllamaTools(tools),
          think: undefined // Let the model use thinking if it supports it natively
        })
      } catch (error) {
        this.deps.logger.warn('Ollama chat failed; pausing run', { error: error instanceof Error ? error.message : String(error) })
        state.waitingForUser = true
        await this.deps.stateManager.saveCheckpoint(taskId, state)
        return
      }

      const assistantMessage = response.message
      const toolCalls = assistantMessage.tool_calls || []

      // Add assistant message to context
      messages.push({
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      })

      if (toolCalls.length === 0) {
        // Model didn't call any tools. Ask it to use a tool or finish.
        this.deps.logger.info('Model returned no tool calls; prompting to continue or finish', { goal })
        
        messages.push({
            role: 'user',
            content: 'You did not call any tools. If the task is incomplete, please call the next appropriate tool. If the task is fully completed, you MUST call the console_finalize tool to finish.'
        })

        try {
            response = await this.ollama.chat({
              model: this.deps.config.models.planner,
              messages,
              tools: toOllamaTools(tools),
              think: undefined
            })
            
            const nextToolCalls = response.message.tool_calls || []
            if (nextToolCalls.length === 0) {
                this.deps.logger.warn('Model refused to call tools even after prompting. Waiting for user.', { goal })
                state.waitingForUser = true
                await this.deps.stateManager.saveCheckpoint(taskId, state)
                return
            }
            
            // Execute the newly produced tool calls
            for (const toolCall of nextToolCalls) {
                const result = await executeToolCall(toolCall, messages)
                if (toolCall.function.name === 'console_finalize') {
                  this.deps.logger.success('Agent finished task successfully via console_finalize.')
                  state.stopped = true
                  this.stopped = true
                  return
                }
            }
        } catch (error) {
            this.deps.logger.warn('Ollama chat failed on follow-up; pausing run', { error: error instanceof Error ? error.message : String(error) })
            state.waitingForUser = true
            await this.deps.stateManager.saveCheckpoint(taskId, state)
            return
        }
      } else {
          for (const toolCall of toolCalls) {
            const key = toolKey(toolCall)
            const result = await executeToolCall(toolCall, messages)

            if (result.ok) {
              consecutiveFailures = 0
              lastFailureKey = undefined
            } else if (lastFailureKey === key) {
              consecutiveFailures += 1
            } else {
              consecutiveFailures = 1
              lastFailureKey = key
            }

            if (toolCall.function.name === 'console_finalize') {
                this.deps.logger.success('Agent finished task successfully via console_finalize.')
                state.stopped = true
                this.stopped = true
                return
            }

            if (consecutiveFailures >= this.deps.config.runtime.repeatedFailureLimit) {
              state.waitingForUser = true
              this.deps.logger.warn('Repeated failures reached safety threshold', { goal, tool: toolCall.function.name })
              return
            }
          }
      }

      await this.deps.stateManager.saveCheckpoint(taskId, state)
      if (state.stopped || state.waitingForUser || this.stopped) {
        return
      }
    }

    state.waitingForUser = true
    this.deps.logger.warn('Tool loop reached maximum steps', { goal, maxSteps: this.deps.config.runtime.maxToolCallsPerTask })
  }

`;

const startIdx = content.indexOf(toolLoopStart);
const endIdx = content.indexOf('private buildConversation');
const before = content.substring(0, startIdx);
const after = content.substring(endIdx);

content = before + newToolLoop + after;

fs.writeFileSync(agentFile, content, 'utf8');
console.log('Successfully updated ' + agentFile);
