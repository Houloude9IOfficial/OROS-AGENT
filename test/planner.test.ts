import test from 'node:test'
import assert from 'node:assert/strict'
import { Planner } from '../src/core/planner.ts'

test('Planner falls back to a heuristic plan when Ollama is unavailable', async () => {
  const planner = new Planner('http://127.0.0.1:0', 'test-model')
  const plan = await planner.decompose('Organize Downloads folder')
  assert.equal(plan.goal, 'Organize Downloads folder')
  assert.ok(plan.tasks.length >= 1)
})

test('Planner research heuristic does not treat file-write goals as typing tasks', async () => {
  const planner = new Planner('http://127.0.0.1:0', 'test-model')
  const goal = "Search up only about Nvidia's latest release (yesterday). Then analyze it, summarize it and write it in a nvidia.txt and save it C:\\Users\\USER\\Documents\\VSCODE_Laptop\\OROS\\prompt_testing"
  const plan = await planner.decompose(goal)
  assert.ok(plan.tasks.length >= 3)
  assert.doesNotMatch(plan.tasks[0]?.description || '', /Enter the required text/i)
  assert.match(plan.tasks[0]?.description || '', /Search/i)
})
