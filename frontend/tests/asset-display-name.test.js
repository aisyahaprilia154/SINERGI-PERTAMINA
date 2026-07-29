import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  deriveAssetDisplayName,
  deriveAssetShortLabel,
  getAssetRenderLabels,
  normalizeAssetDisplayFields,
  resolveDuplicateShortLabels,
  sanitizeSourceAssetName,
  stripGeneratedSourcePrefix,
} from '../src/domain/asset-display-name.js'

test('internal src identifier is retained as stableId but never becomes the UI label', () => {
  const stableId = 'src:rjbt-ft-pengapon-semarang-cctv-titik-cctv:c-014'
  const normalized = normalizeAssetDisplayFields(generatedAsset({
    assetId: stableId,
    name: 'C-014',
    type: 'CCTV',
  }))

  assert.equal(normalized.stableId, stableId)
  assert.equal(normalized.assetId, null)
  assert.equal(normalized.sourceName, 'C-014')
  assert.equal(normalized.displayName, 'C-014')
  assert.equal(normalized.shortLabel, 'C-014')
  assert.doesNotMatch(normalized.shortLabel, /src:|rjbt|pengapon/i)
})

test('source name containing the complete folder path is cleaned without changing its source value', () => {
  const sourceName = '/RJBT/FT PENGAPON - SEMARANG/CCTV/TITIK CCTV/Camera Fix Dome/CCTV-014.kml'
  const asset = generatedAsset({
    assetId: 'src:rjbt-ft-pengapon-semarang-cctv:cctv-014',
    name: sourceName,
    type: 'CCTV',
  })
  const snapshot = structuredClone(asset)
  const normalized = normalizeAssetDisplayFields(asset)

  assert.equal(sanitizeSourceAssetName(sourceName), 'CCTV-014')
  assert.equal(normalized.sourceName, sourceName)
  assert.equal(normalized.displayName, 'CCTV-014')
  assert.deepEqual(asset, snapshot)
})

test('official Asset ID remains separate and has priority for the short label', () => {
  const normalized = normalizeAssetDisplayFields({
    id: 'asset-node-1',
    assetId: 'SW-CORE-01',
    name: 'Core Switch Gedung Administrasi',
    type: 'Core switch',
    properties: {},
  })

  assert.equal(normalized.stableId, 'SW-CORE-01')
  assert.equal(normalized.assetId, 'SW-CORE-01')
  assert.equal(normalized.shortLabel, 'SW-CORE-01')
  assert.equal(normalized.displayName, 'SW-CORE-01 · Core Switch Gedung Administrasi')
})

test('missing official Asset ID derives a readable CCTV label from a long name', () => {
  const asset = generatedAsset({
    assetId: 'src:rjbt-ft-pengapon-semarang:camera-outdoor-014',
    name: 'Camera Outdoor Fix Bullet CCTV-014 Area Gerbang Utama',
    type: 'Outdoor CCTV',
  })

  assert.equal(deriveAssetShortLabel(asset), 'CCTV-014')
  assert.equal(
    deriveAssetDisplayName(asset),
    'Camera Outdoor Fix Bullet CCTV-014 Area Gerbang Utama',
  )
})

test('long Junction Box name removes a safe technical suffix and extracts its code', () => {
  const asset = generatedAsset({
    assetId: 'src:rjbt-ft-pengapon-semarang-junction-box:jb-002',
    name: '/RJBT/FT PENGAPON - SEMARANG/JUNCTION BOX/JB-002.-exp',
    type: 'Junction box',
  })

  assert.equal(sanitizeSourceAssetName(asset.name), 'JB-002')
  assert.equal(deriveAssetShortLabel(asset), 'JB-002')
  assert.equal(stripGeneratedSourcePrefix(asset.assetId), 'jb-002')
})

test('duplicate short labels receive deterministic suffixes without changing identifiers', () => {
  const assets = [
    normalizeAssetDisplayFields(generatedAsset({
      id: 'node-z',
      assetId: 'src:site-z:jb-002',
      name: 'JB-002',
      type: 'Junction box',
    })),
    normalizeAssetDisplayFields(generatedAsset({
      id: 'node-a',
      assetId: 'src:site-a:jb-002',
      name: 'JB-002',
      type: 'Junction box',
    })),
  ]
  const original = structuredClone(assets)
  const first = resolveDuplicateShortLabels(assets)
  const second = resolveDuplicateShortLabels([...assets].reverse())
  const firstById = Object.fromEntries(first.map((asset) => [asset.stableId, asset.shortLabel]))
  const secondById = Object.fromEntries(second.map((asset) => [asset.stableId, asset.shortLabel]))

  assert.equal(firstById['src:site-a:jb-002'], 'JB-002 · A')
  assert.equal(firstById['src:site-z:jb-002'], 'JB-002 · B')
  assert.deepEqual(firstById, secondById)
  assert.deepEqual(assets, original)
})

test('render labels enforce map and diagram limits while preserving full values', () => {
  const asset = normalizeAssetDisplayFields(generatedAsset({
    assetId: 'src:rjbt-ft-pengapon-semarang:cctv-very-long-name-014',
    name: 'CCTV-014 Kamera Gerbang Administrasi Utama',
    type: 'CCTV',
  }))
  const labels = getAssetRenderLabels(asset, { shortMax: 18, displayMax: 30 })

  assert.ok(labels.shortLabel.length <= 18)
  assert.ok(labels.displayName.length <= 30)
  assert.equal(labels.fullDisplayName, asset.displayName)
  assert.equal(labels.fullShortLabel, asset.shortLabel)
})

test('map and schematic SVG import the same centralized render-label utility', async () => {
  const [mapSource, schematicSource] = await Promise.all([
    readFile(new URL('../src/pages/map/map-canvas.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/map/schematic-svg.js', import.meta.url), 'utf8'),
  ])

  assert.match(mapSource, /getAssetRenderLabels/)
  assert.match(schematicSource, /getAssetRenderLabels/)
  assert.doesNotMatch(mapSource, /focused\s*\?\s*node\.asset\.id/)
  assert.doesNotMatch(schematicSource, /identityLabel\s*=\s*node\.isGroup\s*\?\s*node\.name\s*:\s*node\.id/)
})

function generatedAsset({
  id = 'asset-node-generated',
  assetId,
  name,
  type,
}) {
  return {
    id,
    assetId,
    name,
    type,
    category: type,
    properties: {
      sourceIdentityMapping: {
        strategy: 'folder-path-name',
        sourceFolderPath: '/RJBT/FT PENGAPON - SEMARANG',
        sourcePlacemarkName: name,
      },
    },
  }
}
