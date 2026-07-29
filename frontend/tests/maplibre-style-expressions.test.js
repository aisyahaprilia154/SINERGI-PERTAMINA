import assert from 'node:assert/strict'
import test from 'node:test'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import {
  assetPointRadiusExpression,
} from '../src/pages/map/maplibre-style-expressions.js'

test('asset point radius keeps zoom at the top-level MapLibre expression', () => {
  const style = {
    version: 8,
    sources: {
      points: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
    },
    layers: [{
      id: 'points',
      type: 'circle',
      source: 'points',
      paint: {
        'circle-radius': assetPointRadiusExpression(),
        'circle-color': '#1367d1',
      },
    }],
  }

  assert.deepEqual(validateStyleMin(style), [])
})
