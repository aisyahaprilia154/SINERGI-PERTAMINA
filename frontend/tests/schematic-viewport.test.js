import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_ASSET_FIT_MIN_ZOOM,
  calculateSchematicFitScale,
  MIN_SCHEMATIC_ZOOM,
} from '../src/pages/map/schematic-viewport.js'

test('fit scale keeps small diagrams within the available viewport', () => {
  assert.equal(calculateSchematicFitScale({
    viewBoxWidth: 640,
    viewBoxHeight: 420,
    viewportWidth: 1200,
    viewportHeight: 700,
  }), 1)
})

test('fit scale respects the available canvas for medium diagrams', () => {
  assert.equal(calculateSchematicFitScale({
    viewBoxWidth: 1600,
    viewBoxHeight: 900,
    viewportWidth: 1200,
    viewportHeight: 700,
  }), 1168 / 1600)
})

test('fit scale preserves a readable minimum for large diagrams', () => {
  assert.equal(calculateSchematicFitScale({
    viewBoxWidth: 5200,
    viewBoxHeight: 3600,
    viewportWidth: 1200,
    viewportHeight: 700,
  }), MIN_SCHEMATIC_ZOOM)
})

test('full asset fit uses canvas width and keeps the long diagram scrollable', () => {
  assert.equal(calculateSchematicFitScale({
    viewBoxWidth: 1600,
    viewBoxHeight: 3600,
    viewportWidth: 1200,
    viewportHeight: 700,
    minZoom: ALL_ASSET_FIT_MIN_ZOOM,
    preferWidth: true,
  }), 1168 / 1600)
})
