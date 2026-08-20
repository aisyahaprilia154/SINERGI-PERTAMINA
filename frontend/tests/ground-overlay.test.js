import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groundOverlayCoordinates,
  shouldRenderGroundOverlayFootprint,
} from '../src/domain/ground-overlay.js'

test('LatLonBox uses MapLibre image-source corner order', () => {
  assert.deepEqual(groundOverlayCoordinates({
    latLonBox: { west: 110, south: -7, east: 111, north: -6 },
  }), [
    [110, -6],
    [111, -6],
    [111, -7],
    [110, -7],
  ])
})

test('gx:LatLonQuad is converted from KML lower-left to MapLibre upper-left order', () => {
  assert.deepEqual(groundOverlayCoordinates({
    latLonQuad: {
      coordinates: [[110, -7], [111, -7], [111, -6], [110, -6]],
    },
  }), [
    [110, -6],
    [111, -6],
    [111, -7],
    [110, -7],
  ])
})

test('LatLonBox rotation preserves its geographic center', () => {
  const coordinates = groundOverlayCoordinates({
    rotation: 15,
    latLonBox: { west: 110, south: -7, east: 111, north: -6 },
  })
  const center = [
    coordinates.reduce((sum, [longitude]) => sum + longitude, 0) / 4,
    coordinates.reduce((sum, [, latitude]) => sum + latitude, 0) / 4,
  ]
  assert.ok(Math.abs(center[0] - 110.5) < 1e-10)
  assert.ok(Math.abs(center[1] + 6.5) < 1e-10)
})

test('resolved overlay image does not receive a duplicate rectangular footprint', () => {
  assert.equal(shouldRenderGroundOverlayFootprint({ resourceUrl: '/overlay.png' }), false)
  assert.equal(shouldRenderGroundOverlayFootprint({ resourceUrl: '' }), true)
})
