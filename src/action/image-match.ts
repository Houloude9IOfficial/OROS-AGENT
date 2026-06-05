import { access, mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { runPythonScript } from '../system/python.ts'

export interface TemplateMatchResult {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function resolveTemplatePath(imageQuery: string): Promise<string> {
  if (imageQuery.includes('\\') || imageQuery.includes('/')) {
    return resolve(process.cwd(), imageQuery)
  }
  const candidates = [
    resolve(process.cwd(), 'assets', 'templates', imageQuery),
    resolve(process.cwd(), 'assets', 'templates', `${imageQuery}.png`),
    resolve(process.cwd(), 'assets', 'templates', `${imageQuery}.jpg`),
    resolve(process.cwd(), 'assets', 'templates', `${imageQuery}.jpeg`)
  ]
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate
    }
  }
  return candidates[0]!
}

export async function findTemplateOnImage(screenPath: string, templatePath: string): Promise<TemplateMatchResult | undefined> {
  const script = `
import json
import sys
from PIL import Image

screen_path = sys.argv[1]
template_path = sys.argv[2]
threshold = float(sys.argv[3])

screen = Image.open(screen_path).convert('L')
template = Image.open(template_path).convert('L')
sw, sh = screen.size
tw, th = template.size

if tw > sw or th > sh:
    print(json.dumps({'found': False}))
    sys.exit(0)

screen_pixels = screen.load()
template_pixels = template.load()
best = None
best_score = -1.0

for y in range(0, sh - th + 1):
    for x in range(0, sw - tw + 1):
        diff = 0
        for ty in range(th):
            for tx in range(tw):
                diff += abs(screen_pixels[x + tx, y + ty] - template_pixels[tx, ty])
        max_diff = 255 * tw * th
        score = 1.0 - (diff / max_diff)
        if score > best_score:
            best_score = score
            best = (x, y)
        if best_score >= threshold and diff == 0:
            break
    if best_score >= threshold and best_score == 1.0:
        break

if best is None or best_score < threshold:
    print(json.dumps({'found': False, 'score': best_score}))
    sys.exit(0)

print(json.dumps({'found': True, 'x': best[0], 'y': best[1], 'width': tw, 'height': th, 'confidence': best_score}))
`
  const result = await runPythonScript(script, [screenPath, templatePath, '0.92'])
  const parsed = JSON.parse(result.stdout || '{}') as { found?: boolean; x?: number; y?: number; width?: number; height?: number; confidence?: number }
  if (!parsed.found) {
    return undefined
  }
  return {
    x: parsed.x || 0,
    y: parsed.y || 0,
    width: parsed.width || 0,
    height: parsed.height || 0,
    confidence: parsed.confidence || 0
  }
}

export async function saveBufferAsImage(buffer: Buffer, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, buffer)
}

export async function findTemplateInCurrentScreen(screenBuffer: Buffer, templatePath: string): Promise<TemplateMatchResult | undefined> {
  const screenPath = resolve(tmpdir(), `oros-screen-match-${Date.now()}.jpg`)
  try {
    await saveBufferAsImage(screenBuffer, screenPath)
    return await findTemplateOnImage(screenPath, templatePath)
  } finally {
    try {
      await unlink(screenPath)
    } catch {
      // best effort
    }
  }
}
