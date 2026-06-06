import type { OrosConfig, PlanTask, TaskPlan } from '../types/index.ts'
import { buildPlannerPrompt } from '../llm/prompt-engine.ts'
import { UniversalClient } from '../llm/universal-client.ts'

function safeParsePlan(text: string, goal: string): TaskPlan | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<TaskPlan>
    if (!parsed || typeof parsed.goal !== 'string' || !Array.isArray(parsed.tasks)) {
      return undefined
    }

    const tasks = parsed.tasks
      .map(task => {
        if (!task || typeof task !== 'object') {
          return undefined
        }
        const candidate = task as PlanTask
        if (
          typeof candidate.id !== 'string' ||
          typeof candidate.description !== 'string' ||
          (candidate.complexity !== 'simple' && candidate.complexity !== 'complex') ||
          !Array.isArray(candidate.dependencies) ||
          typeof candidate.verification !== 'string'
        ) {
          return undefined
        }

        return {
          id: candidate.id,
          description: candidate.description,
          complexity: candidate.complexity,
          dependencies: candidate.dependencies.filter((value): value is string => typeof value === 'string'),
          verification: candidate.verification
        }
      })
      .filter((value): value is PlanTask => Boolean(value))

    if (tasks.length === 0) {
      return undefined
    }

    return {
      goal: parsed.goal,
      tasks
    }
  } catch {
    return undefined
  }
}

function isResearchGoal(lower: string): boolean {
  const researchWords = ['search up', 'search online', 'analyze', 'summarize', 'research', 'find out']
  const fileWords = ['.txt', 'write it', 'save it', 'save in']
  const hasResearch = researchWords.some(word => lower.includes(word))
  const hasFile = fileWords.some(word => lower.includes(word))
  return hasResearch && (hasFile || lower.includes('analyze') || lower.includes('summarize'))
}

function heuristicPlan(goal: string): TaskPlan {
  const lower = goal.toLowerCase()
  const tasks: PlanTask[] = []

  if (isResearchGoal(lower)) {
    return {
      goal,
      tasks: [
        {
          id: '1',
          description: `Search for information required by: ${goal}`,
          complexity: 'simple',
          dependencies: [],
          verification: 'Search results are available in agent history.'
        },
        {
          id: '2',
          description: `Analyze and summarize the findings for: ${goal}`,
          complexity: 'complex',
          dependencies: ['1'],
          verification: 'A written summary exists in agent history.'
        },
        {
          id: '3',
          description: `Write the summary to the file path specified in: ${goal}`,
          complexity: 'simple',
          dependencies: ['2'],
          verification: 'The output file exists with summarized content.'
        },
        {
          id: '4',
          description: `Verify the saved file satisfies: ${goal}`,
          complexity: 'simple',
          dependencies: ['3'],
          verification: 'The file content matches the user request.'
        }
      ]
    }
  }

  if (lower.includes('open')) {
    tasks.push({
      id: '1',
      description: `Open the target application needed to satisfy: ${goal}`,
      complexity: 'simple',
      dependencies: [],
      verification: 'The application window is visible and focused.'
    })
  }

  if (lower.includes('type') || (lower.includes('write') && !isResearchGoal(lower))) {
    tasks.push({
      id: String(tasks.length + 1),
      description: `Enter the required text for: ${goal}`,
      complexity: 'simple',
      dependencies: tasks.length ? ['1'] : [],
      verification: 'The target text appears in the active editor or field.'
    })
  }

  if (lower.includes('organize') || lower.includes('build') || lower.includes('configure') || lower.includes('install')) {
    tasks.push(
      {
        id: String(tasks.length + 1),
        description: `Inspect the current state relevant to: ${goal}`,
        complexity: 'simple',
        dependencies: [],
        verification: 'The current state has been observed.'
      },
      {
        id: String(tasks.length + 2),
        description: `Perform the main workflow for: ${goal}`,
        complexity: 'complex',
        dependencies: tasks.length ? ['1'] : [],
        verification: 'The requested workflow has been executed.'
      },
      {
        id: String(tasks.length + 3),
        description: `Verify the outcome of: ${goal}`,
        complexity: 'simple',
        dependencies: [String(tasks.length + 2)],
        verification: 'The result matches the requested outcome.'
      }
    )
  }

  if (tasks.length === 0) {
    tasks.push({
      id: '1',
      description: goal,
      complexity: 'simple',
      dependencies: [],
      verification: 'The requested goal has been satisfied.'
    })
  }

  return { goal, tasks }
}

export class Planner {
  private readonly client: UniversalClient
  private readonly baseUrl: string
  private readonly model: string

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl
    this.model = model
    this.client = new UniversalClient(1800000, process.env)
  }

  async decompose(goal: string): Promise<TaskPlan> {
    try {
      const response = await this.client.generate({
        model: this.model,
        format: 'json',
        messages: [
          { role: 'system', content: 'Return only valid JSON matching the planner schema.' },
          { role: 'user', content: buildPlannerPrompt(goal) }
        ]
      })

      return safeParsePlan(response.text, goal) || heuristicPlan(goal)
    } catch {
      return heuristicPlan(goal)
    }
  }
}
