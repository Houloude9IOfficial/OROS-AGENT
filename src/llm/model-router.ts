import type { TaskComplexity } from '../types/index.ts'

function taskNeedsVision(task: string): boolean {
  const lower = task.toLowerCase()
  return [
    'screen',
    'click',
    'button',
    'window',
    'ui',
    'notepad',
    'browser',
    'chrome',
    'settings',
    'image',
    'find'
  ].some(keyword => lower.includes(keyword))
}

export function selectModel(task: string, complexity: TaskComplexity, fastModel: string, plannerModel: string): string {
  if (complexity === 'simple') {
    return fastModel
  }

  if (taskNeedsVision(task)) {
    return plannerModel
  }

  return plannerModel
}
