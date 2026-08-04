import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssetLabelIndex, deriveAssetDisplayName } from '../src/domain/asset-labels.js'

test('internal canonical ids never become a display label', () => {
  assert.equal(deriveAssetDisplayName({ id: 'asset-node:dv-123:src-long-hash', type: 'Junction box' }), 'Junction box')
})

test('duplicate short labels get deterministic suffixes within 18 characters', () => {
  const index = createAssetLabelIndex([
    { id: 'b', name: 'Camera Pintu Masuk Utama' },
    { id: 'a', name: 'Camera Pintu Masuk Utama' },
  ])
  assert.ok(index.get('a').shortLabel.length <= 18)
  assert.ok(index.get('b').shortLabel.endsWith(' 2'))
})
