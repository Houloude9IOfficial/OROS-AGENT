import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import type { ScreenSnapshot } from '../types/index.ts'
import { hashBuffer } from './diff-engine.ts'
import { runPythonScript } from '../system/python.ts'

export async function captureScreen(width: number = 1280, quality: number = 85): Promise<ScreenSnapshot> {
  const filePath = resolve(tmpdir(), `oros-screen-${Date.now()}.jpg`)
  try {
    const script = `
import json
import sys
from pathlib import Path
from PIL import Image, ImageGrab, ImageDraw

output = Path(sys.argv[1])
target_width = int(sys.argv[2])
quality = int(sys.argv[3])

try:
    image = ImageGrab.grab()
except Exception:
    image = Image.new('RGB', (target_width, max(1, round(target_width * 9 / 16))), color=(24, 24, 24))
    draw = ImageDraw.Draw(image)
    draw.text((32, 32), 'OROS screen capture fallback', fill=(220, 220, 220))

if image.width <= 0 or image.height <= 0:
    image = Image.new('RGB', (target_width, max(1, round(target_width * 9 / 16))), color=(24, 24, 24))

target_height = max(1, round((image.height * target_width) / image.width))
resized = image.resize((target_width, target_height), Image.Resampling.LANCZOS)
resized.save(output, format='JPEG', quality=quality, optimize=True)
print(json.dumps({'width': target_width, 'height': target_height}))
`
    const result = await runPythonScript(script, [filePath, String(width), String(quality)])
    const dims = JSON.parse(result.stdout.trim() || '{}') as { width?: number; height?: number }
    const rawBuffer = await readFile(filePath)
    return {
      capturedAt: new Date().toISOString(),
      width: typeof dims.width === 'number' ? dims.width : width,
      height: typeof dims.height === 'number' ? dims.height : 0,
      imageBase64: rawBuffer.toString('base64'),
      hash: hashBuffer(rawBuffer),
      rawBuffer
    }
  } finally {
    try {
      await unlink(filePath)
    } catch {
      // best effort cleanup
    }
  }
}

export async function saveRawScreenshot(buffer: Buffer, outputPath: string): Promise<void> {
  await writeFile(outputPath, buffer)
}

export async function canCaptureScreen(): Promise<boolean> {
  return await captureScreen(800, 80)
    .then(() => true)
    .catch(() => false)
}
