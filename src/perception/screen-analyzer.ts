import type { ScreenAnalysis, ScreenSnapshot } from '../types/index.ts'
import { UniversalClient } from '../llm/universal-client.ts'

export function isVisionModel(modelName: string): boolean {
  const lower = modelName.toLowerCase()
  return (
    lower.includes('llava') ||
    lower.includes('bakllava') ||
    lower.includes('moondream') ||
    lower.includes('minicpm') ||
    lower.includes('paligemma') ||
    lower.includes('cogvlm') ||
    lower.includes('vl') ||
    lower.includes('vision')
  )
}

export class ScreenAnalyzer {
  private readonly client: UniversalClient

  constructor(client: UniversalClient) {
    this.client = client
  }

  async describe(snapshot: ScreenSnapshot, model: string): Promise<ScreenAnalysis> {
    if (!isVisionModel(model)) {
      return {
        description: 'Screen analysis unavailable (non-vision model selected).',
        visibleTitles: [],
        interactiveElements: [],
        confidence: 0
      }
    }

    try {
      const response = await this.client.generate({
        model,
        format: 'json',
        images: [snapshot.imageBase64],
        messages: [
          {
            role: 'system',
            content: 'Return JSON with description, visibleTitles, interactiveElements, and confidence.'
          },
          {
            role: 'user',
            content: 'Describe the current screen in a concise but useful way.'
          }
        ]
      })

      const parsed = JSON.parse(response.text) as Partial<ScreenAnalysis>
      return {
        description: typeof parsed.description === 'string' ? parsed.description : 'Unable to analyze screen.',
        visibleTitles: Array.isArray(parsed.visibleTitles) ? parsed.visibleTitles.filter((value): value is string => typeof value === 'string') : [],
        interactiveElements: Array.isArray(parsed.interactiveElements) ? parsed.interactiveElements.filter((value): value is string => typeof value === 'string') : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
      }
    } catch {
      return {
        description: 'Screen analysis unavailable. Falling back to deterministic metadata.',
        visibleTitles: [],
        interactiveElements: [],
        confidence: 0
      }
    }
  }
}
