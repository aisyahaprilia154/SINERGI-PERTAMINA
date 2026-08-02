import assert from 'node:assert/strict'
import test from 'node:test'
import { geometryIntersectsGeographicBounds } from '../src/pages/map/geographic-bounds.js'

test('Leaflet viewport scope includes points and paths crossing geographic bounds', () => {
  const bounds = {
    west: 110,
    east: 111,
    south: -7.5,
    north: -6.5,
  }

  assert.equal(geometryIntersectsGeographicBounds(
    [[109.5, -7], [111.5, -7]],
    bounds,
  ), true)
  assert.equal(geometryIntersectsGeographicBounds(
    [[108, -8], [109, -8]],
    bounds,
  ), false)
  assert.equal(geometryIntersectsGeographicBounds(
    [110.4, -7.1],
    bounds,
  ), true)
})
