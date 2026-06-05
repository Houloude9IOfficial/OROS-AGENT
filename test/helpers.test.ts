import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDataRoot } from '../src/system/paths.ts'
import { toolToAction, toolToLlmToolDefinition } from '../src/mcp/tool-adapter.ts'
import { resolveTemplatePath } from '../src/action/image-match.ts'

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