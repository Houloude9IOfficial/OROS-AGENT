import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActionPrompt, buildSystemPrompt } from '../src/llm/prompt-engine.ts'

test('prompt builder includes goal, history, and tool descriptions', () => {
  const prompt = buildSystemPrompt({
    goal: 'Open Notepad',
    screen: {
      description: 'Notepad is open.',
      visibleTitles: ['Notepad'],
      interactiveElements: ['menu bar'],
      confidence: 1
    },
    history: [],
    memoryContext: 'remember chrome',
    tools: []
  })

  assert.match(prompt, /Open Notepad/)
  assert.match(prompt, /Notepad is open/)
  assert.match(prompt, /remember chrome/)
})

test('action prompt requests a single JSON action', () => {
  const prompt = buildActionPrompt({ goal: 'Open Notepad' })
  assert.match(prompt, /one JSON action/)
})
