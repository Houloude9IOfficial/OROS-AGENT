import type { GoalClassification } from '../types/index.ts'

function scoreComplexity(goal: string): number {
  const lower = goal.toLowerCase()
  const complexityKeywords = [
    'organize',
    'build',
    'deploy',
    'migrate',
    'analyze',
    'download',
    'install',
    'configure',
    'compare',
    'resume',
    'sync',
    'update',
    'create',
    'export'
  ]
  const simpleKeywords = ['open', 'close', 'type', 'click', 'screenshot', 'take a screenshot']

  let score = 0
  for (const keyword of complexityKeywords) {
    if (lower.includes(keyword)) {
      score += 1
    }
  }
  for (const keyword of simpleKeywords) {
    if (lower.includes(keyword)) {
      score -= 1
    }
  }
  if (lower.split(/\s+/).length > 8) {
    score += 1
  }
  return score
}

export function classifyTask(goal: string): GoalClassification {
  const score = scoreComplexity(goal)
  return {
    complexity: score >= 2 ? 'complex' : 'simple',
    reason: score >= 2 ? 'The goal contains multi-step or cross-app language.' : 'The goal is short and looks deterministic.'
  }
}
