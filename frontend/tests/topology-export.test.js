import assert from 'node:assert/strict'
import test from 'node:test'
import { getPngDimensions } from '../src/pages/map/topology-export.js'

test('PNG dimensions support 1x, 2x, and 4x deterministically', () => {
  assert.deepEqual(getPngDimensions({ width: 800, height: 450 }, 1), { width: 800, height: 450, scale: 1 })
  assert.deepEqual(getPngDimensions({ width: 800, height: 450 }, 2), { width: 1600, height: 900, scale: 2 })
  assert.deepEqual(getPngDimensions({ width: 800, height: 450 }, 4), { width: 3200, height: 1800, scale: 4 })
})
