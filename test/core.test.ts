import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyTask } from '../src/core/task-classifier.ts'
import { selectModel } from '../src/llm/model-router.ts'
import { compareBuffers } from '../src/perception/diff-engine.ts'
import { normalizeAction } from '../src/action/schemas.ts'

test('classifyTask identifies simple and complex goals', () => {
  assert.equal(classifyTask('Open Notepad').complexity, 'simple')
  assert.equal(classifyTask('Organize Downloads folder').complexity, 'complex')
})

test('selectModel chooses fast model for simple tasks and planner for complex ones', () => {
  assert.equal(selectModel('Open Notepad', 'simple', 'fast-model', 'planner-model'), 'fast-model')
  assert.equal(selectModel('Organize downloads', 'complex', 'fast-model', 'planner-model'), 'planner-model')
})

test('compareBuffers detects identical and changed buffers', () => {
  const first = Buffer.from('abc')
  const second = Buffer.from('abc')
  const third = Buffer.from('abd')

  assert.equal(compareBuffers(first, second).changed, false)
  assert.equal(compareBuffers(first, third).changed, true)
})

test('normalizeAction rounds click coordinates', () => {
  const action = normalizeAction({
    type: 'gui',
    tool: 'mouse_click',
    params: { x: 10.4, y: 20.6 }
  })
  assert.equal(action.params.x, 10)
  assert.equal(action.params.y, 21)
})
