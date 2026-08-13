import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateSafePngScale } from '../src/pages/map/schematic-export.js'

test('PNG export keeps normal diagrams at requested quality', () => {
  assert.equal(calculateSafePngScale({ width: 1200, height: 800 }), 2)
})

test('PNG export scales a large full graph without clipping or exceeding canvas limits', () => {
  const scale = calculateSafePngScale({ width: 12000, height: 6000 })
  assert.ok(scale < 1)
  assert.ok(12000 * scale <= 8192)
  assert.ok(12000 * scale * 6000 * scale <= 40_000_000)
})
