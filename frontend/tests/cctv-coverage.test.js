import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isCctvCoverageOverlay,
  isCctvCoverageGeometry,
  shouldRenderCctvCoverageOverlay,
  shouldRenderMapGeometry,
} from '../src/pages/map/cctv-coverage.js'

const cameraAssets = new Map([
  ['C-001', { name: 'C-001', type: 'CCTV' }],
])

test('CCTV view and pandang source paths are recognized as coverage geometry', () => {
  assert.equal(isCctvCoverageGeometry({
    assetId: 'C-001',
    geometryType: 'polygon',
    sourceFolderPath: '/RJBT/FT Pengapon/CCTV/View',
  }, cameraAssets), true)
  assert.equal(isCctvCoverageGeometry({
    assetId: 'C-001',
    geometryType: 'line_string',
    sourceFolderPath: '/RJBT/FT Pengapon/Kamera/Pandang Timur',
  }, cameraAssets), true)
})

test('coverage toggle hides only CCTV coverage and keeps ordinary geometry visible', () => {
  const coverage = {
    assetId: 'C-001',
    geometryType: 'polygon',
    sourceFolderPath: '/RJBT/CCTV/View',
  }
  const point = { ...coverage, geometryType: 'point' }
  const cable = {
    assetId: 'C-001',
    geometryType: 'line_string',
    sourceFolderPath: '/RJBT/CCTV/Backbone',
  }

  assert.equal(shouldRenderMapGeometry(coverage, cameraAssets, false), false)
  assert.equal(shouldRenderMapGeometry(point, cameraAssets, false), true)
  assert.equal(shouldRenderMapGeometry(cable, cameraAssets, false), true)
  assert.equal(shouldRenderMapGeometry(coverage, cameraAssets, true), true)
})

test('unrelated view geometry is not hidden by CCTV coverage toggle', () => {
  const geometry = {
    assetId: 'C-001',
    geometryType: 'polygon',
    sourceFolderPath: '/RJBT/Infrastructure/View Area',
  }

  assert.equal(isCctvCoverageGeometry(geometry, cameraAssets), false)
  assert.equal(shouldRenderMapGeometry(geometry, cameraAssets, false), true)
})

test('KMZ CCTV/View GroundOverlay is recognized as camera direction coverage', () => {
  const overlay = {
    name: 'C-04',
    sourceFolderPath: '/RJBT/FT PENGAPON - SEMARANG/CCTV/VIEW CCTV',
    iconHref: 'files/CCTV 60 degree S1.png',
    latLonBox: { north: -6.9, south: -6.91, east: 110.4, west: 110.39 },
  }

  assert.equal(isCctvCoverageOverlay(overlay), true)
  assert.equal(shouldRenderCctvCoverageOverlay(overlay, true), true)
  assert.equal(shouldRenderCctvCoverageOverlay(overlay, false), false)
  assert.equal(shouldRenderCctvCoverageOverlay({
    ...overlay,
    sourceFolderPath: '/RJBT/FT PENGAPON - SEMARANG/CCTV/TITIK CCTV',
  }, false), true)
})
