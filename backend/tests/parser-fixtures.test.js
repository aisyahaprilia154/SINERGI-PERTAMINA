import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { adaptKmlImportResult } from '../../frontend/src/adapters/kml-import-adapter.js'
import {
  DEFAULT_FOLDER_MAPPINGS,
  DEFAULT_METADATA_ALIASES,
  DEFAULT_RELATION_MAPPINGS,
} from '../src/config.js'
import { parseKmlFile } from '../src/import/kml-parser.js'

const fixtureDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
)
const parserOptions = {
  maxKmlSize: 1024 * 1024,
  folderMappings: DEFAULT_FOLDER_MAPPINGS,
}

test('Point fixture preserves longitude-latitude-altitude order and sanitizes description', async () => {
  const parserOutput = await parseFixture('point.kml')
  const placemark = parserOutput.placemarks[0]

  assert.deepEqual(placemark.geometry.coordinates, [110.4167, -6.9667, 12])
  assert.equal(placemark.geometry.altitudeMode, 'absolute')
  assert.equal(placemark.properties.description, 'Gerbang Utama')
  assert.match(placemark.properties.sourceDescription, /<script>/)
})

test('LineString fixture preserves coordinate sequence and validates minimum length', async () => {
  const parserOutput = await parseFixture('line-string.kml')
  const line = parserOutput.folders[0].placemarks[0].geometry

  assert.equal(parserOutput.folders[0].category, 'Fiber Optic')
  assert.deepEqual(line.coordinates, [
    [110.1, -6.1],
    [110.2, -6.2],
    [110.3, -6.3],
  ])
  assert.equal(line.altitudeMode, 'clampToGround')
  assert.equal(parserOutput.issues.some((issue) => issue.issueCode === 'line_too_short'), false)
})

test('Polygon fixture closes rings deterministically and records each normalization', async () => {
  const parserOutput = await parseFixture('polygon.kml')
  const polygon = parserOutput.placemarks[0].geometry

  assert.deepEqual(polygon.coordinates[0][0], polygon.coordinates[0].at(-1))
  assert.deepEqual(polygon.coordinates[1][0], polygon.coordinates[1].at(-1))
  assert.equal(
    parserOutput.issues.filter((issue) => issue.issueCode === 'polygon_ring_closed').length,
    2,
  )
  assert.ok(parserOutput.issues
    .filter((issue) => issue.issueCode === 'polygon_ring_closed')
    .every((issue) => issue.severity === 'information' && issue.canActivate === true))
})

test('MultiGeometry fixture keeps child geometry identity and coordinates separate', async () => {
  const parserOutput = await parseFixture('multi-geometry.kml')
  const multi = parserOutput.placemarks[0].geometry

  assert.equal(multi.type, 'MultiGeometry')
  assert.deepEqual(multi.geometries.map((geometry) => geometry.type), ['Point', 'LineString'])
  assert.deepEqual(multi.geometries[0].coordinates, [110, -7])
  assert.deepEqual(multi.geometries[1].coordinates, [[110, -7], [111, -7]])
})

test('nested Folder fixture preserves hierarchy, maps known names, and warns for unmapped names', async () => {
  const parserOutput = await parseFixture('nested-folder.kml')
  const root = parserOutput.folders[0]
  const nested = root.children[0]

  assert.equal(root.sourceFolderPath, '/Jaringan Cabang')
  assert.equal(root.category, 'unmapped')
  assert.equal(nested.sourceFolderPath, '/Jaringan Cabang/Titik CCTV')
  assert.equal(nested.category, 'CCTV')
  assert.ok(parserOutput.issues.some((issue) => (
    issue.issueCode === 'unmapped_folder'
    && issue.sourceFolderPath === '/Jaringan Cabang'
  )))
})

test('folder category mapping can be overridden without dropping unmatched folders', async () => {
  const parserOutput = await parseKmlFile(
    path.join(fixtureDirectory, 'nested-folder.kml'),
    {
      ...parserOptions,
      folderMappings: [{
        category: 'Custom Network',
        aliases: ['Jaringan Cabang'],
      }],
    },
  )

  assert.equal(parserOutput.folders[0].category, 'Custom Network')
  assert.equal(parserOutput.folders[0].children[0].category, 'unmapped')
  assert.ok(parserOutput.issues.some((issue) => (
    issue.issueCode === 'unmapped_folder'
    && issue.sourceFolderPath === '/Jaringan Cabang/Titik CCTV'
  )))
})

test('ExtendedData fixture maps aliases while preserving original keys, values, and mapping trail', async () => {
  const parserOutput = await parseFixture('extended-data.kml')
  const result = adapt(parserOutput)
  const asset = result.assets[0]

  assert.equal(asset.assetId, 'SW-01')
  assert.equal(asset.name, 'Switch Core')
  assert.equal(asset.location, 'Ruang Server')
  assert.equal(asset.properties.semanticMetadata.hostname, 'sw-core-01')
  assert.equal(asset.properties.semanticMetadata.ipAddress, '10.42.0.1')
  assert.ok(asset.properties.metadataMapping.some((mapping) => (
    mapping.targetField === 'assetId'
    && mapping.sourceKey === 'kode_aset'
    && mapping.originalValue === 'SW-01'
  )))
  assert.ok(asset.properties.sourceExtendedData.data.some((entry) => (
    entry.name === 'IP Address'
    && entry.value === '10.42.0.1'
    && entry.sourceElement === 'SimpleData'
  )))
})

test('Style and StyleMap fixture retains source diagnostics without applying them to map semantics', async () => {
  const parserOutput = await parseFixture('style-map.kml')
  const result = adapt(parserOutput)

  assert.equal(parserOutput.styles[0].id, 'asset-normal')
  assert.equal(parserOutput.styles[0].iconStyle.iconHref, 'icons/camera.png')
  assert.equal(parserOutput.styles[0].lineStyle.width, 3)
  assert.equal(parserOutput.styles[0].polyStyle.fill, true)
  assert.equal(parserOutput.styleMaps[0].id, 'asset-map')
  assert.deepEqual(parserOutput.styleMaps[0].pairs[0], {
    key: 'normal',
    styleUrl: '#asset-normal',
  })
  assert.equal(result.assets[0].properties.sourceStyleId, 'asset-map')
  assert.equal(result.sourceStyles.styles[0].sourceStyle['@_id'], 'asset-normal')
  assert.equal('color' in result.assets[0], false)
})

test('duplicate Asset ID fixture becomes a blocking issue without inventing a replacement ID', async () => {
  const result = adapt(await parseFixture('duplicate-id.kml'))

  assert.deepEqual(result.assets.map((asset) => asset.assetId), ['DUP-01'])
  assert.equal(result.datasetVersion.status, 'invalid')
  assert.ok(result.issues.some((issue) => (
    issue.issueCode === 'duplicate_asset_id' && issue.canActivate === false
  )))
})

test('invalid coordinate fixture records range issue and does not emit a usable geometry', async () => {
  const parserOutput = await parseFixture('invalid-coordinate.kml')
  const result = adapt(parserOutput)

  assert.ok(parserOutput.issues.some((issue) => (
    issue.issueCode === 'invalid_coordinate'
    && issue.message.includes('longitude')
  )))
  assert.equal(result.geometries.length, 0)
  assert.equal(result.datasetVersion.status, 'invalid')
  assert.equal(
    result.assets[0].properties.invalidSourceGeometry.sourceCoordinates,
    '181,-95',
  )
})

test('unresolved explicit metadata relation follows configured severity and never creates a dangling relation', async () => {
  const parserOutput = await parseFixture('unresolved-relation.kml')
  const warningResult = adapt(parserOutput)
  const errorResult = adapt(parserOutput, [{
    mode: 'owner-target',
    targetField: 'connectedTo',
    relationType: 'connected-to',
    unresolvedSeverity: 'error',
  }])

  assert.deepEqual(warningResult.relations, [])
  assert.ok(warningResult.issues.some((issue) => (
    issue.issueCode === 'unknown_relation_reference'
    && issue.severity === 'warning'
    && issue.canActivate === true
  )))
  assert.equal(warningResult.datasetVersion.status, 'valid')
  assert.deepEqual(errorResult.relations, [])
  assert.equal(errorResult.datasetVersion.status, 'invalid')
})

test('explicit source-target-relation metadata creates only a documented relation', () => {
  const result = adapt({
    placemarks: [
      {
        name: 'Switch A',
        extendedData: {
          data: [
            { name: 'asset_id', value: 'SW-A' },
            { name: 'source_asset_id', value: 'SW-A' },
            { name: 'target_asset_id', value: 'SW-B' },
            { name: 'relation_type', value: 'uplink-to' },
          ],
        },
        geometry: { type: 'Point', coordinates: [110, -7] },
      },
      {
        name: 'Switch B',
        extendedData: { data: [{ name: 'asset_id', value: 'SW-B' }] },
        geometry: { type: 'Point', coordinates: [111, -7] },
      },
    ],
  })

  assert.equal(result.relations.length, 1)
  assert.deepEqual(
    [
      result.relations[0].sourceAssetId,
      result.relations[0].targetAssetId,
      result.relations[0].relationType,
    ],
    ['SW-A', 'SW-B', 'uplink-to'],
  )
  assert.match(result.relations[0].sourceMetadataKey, /sourceAssetId/)
})

test('metadata alias configuration can map a source-specific key and records the alias used', () => {
  const parserOutput = {
    placemarks: [{
      name: 'Legacy Asset',
      extendedData: {
        data: [
          { name: 'Legacy Code', value: 'LEGACY-01' },
          { name: 'Device Host', value: 'legacy-host' },
        ],
      },
      geometry: { type: 'Point', coordinates: [110, -7] },
    }],
  }
  const result = adaptKmlImportResult({
    parserOutput,
    datasetVersion: baseDatasetVersion(),
    mapping: {
      metadataAliases: {
        ...DEFAULT_METADATA_ALIASES,
        assetId: ['Legacy Code'],
        hostname: ['Device Host'],
      },
      relationMappings: [],
    },
  })

  assert.equal(result.assets[0].assetId, 'LEGACY-01')
  assert.equal(result.assets[0].properties.semanticMetadata.hostname, 'legacy-host')
  assert.ok(result.assets[0].properties.metadataMapping.some((mapping) => (
    mapping.targetField === 'assetId' && mapping.sourceKey === 'Legacy Code'
  )))
})

async function parseFixture(filename) {
  return parseKmlFile(path.join(fixtureDirectory, filename), parserOptions)
}

function adapt(parserOutput, relationMappings = DEFAULT_RELATION_MAPPINGS) {
  return adaptKmlImportResult({
    parserOutput,
    datasetVersion: baseDatasetVersion(),
    mapping: {
      metadataAliases: DEFAULT_METADATA_ALIASES,
      relationMappings,
    },
  })
}

function baseDatasetVersion() {
  return {
    id: 'dataset-version-fixture',
    datasetId: 'dataset-semarang',
    branchId: 'semarang',
    versionName: 'Fixture',
    sourceFilename: 'fixture.kml',
    sourceMimeType: 'application/vnd.google-earth.kml+xml',
    sourceSize: 1024,
    checksum: 'sha256:fixture',
    sourceStorageKey: 'source-files/fixture/source.kml',
    importedBy: 'test-admin',
    importedAt: '2026-07-27T10:00:00.000Z',
    validationStatus: 'pending',
    publicationStatus: 'unpublished',
    status: 'draft',
  }
}
