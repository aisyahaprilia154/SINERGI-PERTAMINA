import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pageUrl = new URL('../src/pages/topology/topology-page.js', import.meta.url)

test('topology route renders the Stitch-inspired data-driven workspace', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /topology-stitch-app/)
  assert.match(source, /renderTopologyDiagramSvg/)
  assert.match(source, /loadActiveDataset/)
  assert.match(source, /selectedAssetId/)
  assert.match(source, /localStorage\.getItem/)
  assert.match(source, /overview: state\.area === null/)
  assert.doesNotMatch(source, /topology-reset-page/)
})
