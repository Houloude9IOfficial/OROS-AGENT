import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runPythonScript } from '../src/system/python.ts'
import { findTemplateOnImage } from '../src/action/image-match.ts'

test('findTemplateOnImage locates a template inside a synthetic screenshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-match-'))
  const screenPath = join(dir, 'screen.png')
  const templatePath = join(dir, 'template.png')

  await runPythonScript(`
from PIL import Image, ImageDraw
import sys

screen_path = sys.argv[1]
template_path = sys.argv[2]

screen = Image.new('RGB', (80, 80), color='white')
draw = ImageDraw.Draw(screen)
draw.rectangle((20, 30, 39, 49), fill='black')
screen.save(screen_path)

template = Image.new('RGB', (20, 20), color='black')
template.save(template_path)
`, [screenPath, templatePath])

  const match = await findTemplateOnImage(screenPath, templatePath)
  assert.ok(match)
  assert.equal(match?.x, 20)
  assert.equal(match?.y, 30)
})
