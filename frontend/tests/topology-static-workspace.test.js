import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pageUrl = new URL('../src/pages/topology/topology-page.js', import.meta.url)

test('topology workspace keeps the generated hierarchy fixed', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /Layout terkunci/)
  assert.match(source, /Diagram Topologi statis/)
  assert.match(source, /requestAnimationFrame\(fitGraph\)/)
  assert.doesNotMatch(source, /manualPositions/)
  assert.doesNotMatch(source, /bindNodeDragTargets/)
  assert.doesNotMatch(source, /addEventListener\('pointermove'/)
  assert.doesNotMatch(source, /data-reset-layout/)
})
