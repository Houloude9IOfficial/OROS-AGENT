import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDataRoot } from '../src/system/paths.ts'
import { toolToAction, toolToLlmToolDefinition } from '../src/mcp/tool-adapter.ts'
import { resolveTemplatePath } from '../src/action/image-match.ts'
import { ScreenAnalyzer } from '../src/perception/screen-analyzer.ts'
import { OllamaClient } from '../src/llm/ollama-client.ts'

test('getDataRoot points at a writable temp location by default', () => {
  assert.match(getDataRoot(), /oros/i)
})

test('tool adapter maps registered MCP tools to actions and LLM definitions', () => {
  const tool = {
    name: 'list_directory',
    description: 'List a directory',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    server: 'filesystem'
  }
  const action = toolToAction(tool, { path: 'C:/temp' })
  const definition = toolToLlmToolDefinition(tool)

  assert.equal(action.type, 'mcp')
  assert.equal(definition.function.name, 'mcp_filesystem_list_directory')
})

test('resolveTemplatePath accepts explicit template paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oros-template-'))
  const file = join(dir, 'template.png')
  await writeFile(file, Buffer.from([1, 2, 3]))
  assert.equal(await resolveTemplatePath(file), file)
})

test('screen analyzer falls back cleanly when analysis fails', async () => {
  const analyzer = new ScreenAnalyzer({
    async generate() {
      throw new Error('offline')
    }
  } as unknown as OllamaClient)

  const analysis = await analyzer.describe({
    capturedAt: new Date().toISOString(),
    width: 1,
    height: 1,
    imageBase64: '',
    hash: 'hash',
    rawBuffer: Buffer.from([1])
  }, 'model')

  assert.equal(analysis.confidence, 0)
})
