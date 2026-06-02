import test from 'node:test'
import assert from 'node:assert/strict'
import { captureScreen, canCaptureScreen } from '../src/perception/vision.ts'

test('captureScreen returns a usable snapshot buffer', async () => {
  const snapshot = await captureScreen(640, 80)
  assert.equal(snapshot.width, 640)
  assert.ok(snapshot.rawBuffer.length > 0)
})

test('canCaptureScreen resolves to a boolean', async () => {
  const value = await canCaptureScreen()
  assert.equal(typeof value, 'boolean')
})
