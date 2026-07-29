import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { extractKmzArchive } from '../../backend/src/import/kmz-extractor.js'
import { parseKmlText } from '../../backend/src/import/kml-parser.js'
import {
  createActiveDatasetExport,
  serializeActiveDatasetKml,
} from '../src/pages/map/active-dataset-kml-export.js'

const activeContext = {
  branchId: 'semarang',
  branchName: 'Kantor Cabang Semarang',
  datasetVersionId: 'dv-active',
  version: 'v12',
}

const assets = [{
  id: 'NODE-01',
  name: 'Switch <Core>',
  category: 'Infrastructure',
  type: 'Switch',
  location: '<b>Gedung A</b>',
  datasetVersionId: 'dv-active',
  properties: {
    extendedData: {
      hostname: 'sw-core-01',
      description: '<script>alert(1)</script> Ruang core',
    },
  },
  geometry: [{
    geometryType: 'point',
    coordinates: [110.42, -6.99, 5],
  }],
}, {
  id: 'LINE-01',
  name: 'Backbone FO',
  category: 'Fiber Optic',
  type: 'Fiber Optic',
  datasetVersionId: 'dv-active',
  geometry: [{
    geometryType: 'line_string',
    coordinates: [[110.42, -6.99], [110.43, -7]],
  }],
}, {
  id: 'AREA-01',
  name: 'Area CCTV',
  category: 'CCTV',
  type: 'Coverage',
  datasetVersionId: 'dv-active',
  geometry: [{
    geometryType: 'polygon',
    coordinates: [[
      [110.42, -6.99],
      [110.43, -6.99],
      [110.43, -7],
      [110.42, -6.99],
    ]],
  }],
}]

const relations = [{
  sourceNodeId: 'NODE-01',
  targetNodeId: 'LINE-01',
  relationType: 'uplink',
  relationSource: 'explicit',
  metadata: { port: 'Gi0/1' },
}]

test('KML export round-trips Point, LineString, Polygon, IDs, coordinates, and relation metadata', () => {
  const kml = serializeActiveDatasetKml({ activeContext, assets, relations })
  const parsed = parseKmlText(kml)

  assert.equal(parsed.placemarks.length, 3)
  assert.deepEqual(
    parsed.placemarks.map(({ geometry }) => geometry.type),
    ['Point', 'LineString', 'Polygon'],
  )
  assert.deepEqual(parsed.placemarks[0].geometry.coordinates, [110.42, -6.99, 5])
  const metadata = Object.fromEntries(
    parsed.placemarks[0].extendedData.data.map(({ name, value }) => [name, value]),
  )
  assert.equal(metadata.asset_id, 'NODE-01')
  assert.equal(metadata.connected_to, 'LINE-01')
  assert.equal(metadata.relation_type, 'uplink')
  assert.doesNotMatch(kml, /<script>/i)
  assert.doesNotMatch(kml, /-6\.99,110\.42/)
})

test('KMZ export contains a valid doc.kml with the same round-trip contract', async () => {
  const exported = createActiveDatasetExport(
    { activeContext, assets, relations },
    'Dataset Semarang',
    'kmz',
  )
  const bytes = new Uint8Array(await exported.blob.arrayBuffer())
  const entry = readStoredZipEntry(bytes)

  assert.equal(exported.filename, 'Dataset-Semarang.kmz')
  assert.equal(exported.blob.type, 'application/vnd.google-earth.kmz')
  assert.equal(entry.name, 'doc.kml')
  const parsed = parseKmlText(new TextDecoder().decode(entry.data))
  assert.equal(parsed.placemarks.length, 3)
  assert.equal(parsed.placemarks[1].geometry.type, 'LineString')

  const workspace = await mkdtemp(path.join(os.tmpdir(), 'sinergi-export-roundtrip-'))
  try {
    const archivePath = path.join(workspace, 'dataset.kmz')
    const extractionPath = path.join(workspace, 'extracted')
    await writeFile(archivePath, bytes)
    const extraction = await extractKmzArchive(archivePath, extractionPath, {
      maxArchiveEntries: 10,
      maxExtractedSize: 1024 * 1024,
      maxCompressionRatio: 100,
    })
    assert.equal(extraction.kmlFiles[0].relativePath, 'doc.kml')
    const extracted = parseKmlText(await readFile(extraction.kmlFiles[0].absolutePath, 'utf8'))
    assert.equal(extracted.placemarks.length, 3)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('export refuses records from another dataset version', () => {
  const kml = serializeActiveDatasetKml({
    activeContext,
    assets: [...assets, {
      ...assets[0],
      id: 'OTHER-01',
      datasetVersionId: 'dv-other',
    }],
  })
  assert.doesNotMatch(kml, /OTHER-01/)
})

test('contextual prototype export rejects a site or branch outside Pengapon Semarang', () => {
  assert.throws(() => serializeActiveDatasetKml({
    activeContext: {
      ...activeContext,
      branchId: 'yogyakarta',
      siteScopeId: 'yia',
      siteScopeName: 'YIA',
    },
    assets,
  }), /hanya tersedia untuk site Pengapon/)
})

test('Pengapon round-trip keeps scope, folder layer, metadata, relation, and MultiGeometry', () => {
  const scopedContext = {
    ...activeContext,
    siteScopeId: 'pengapon',
    siteScopeName: 'Pengapon',
  }
  const layers = [{
    id: 'layer-pengapon',
    name: 'FT PENGAPON',
    sourceFolderPath: '/RJBT/FT PENGAPON/',
    defaultVisible: true,
    siteScopeId: 'pengapon',
  }, {
    id: 'layer-cctv',
    parentLayerId: 'layer-pengapon',
    name: 'CCTV & Security',
    sourceFolderPath: '/RJBT/FT PENGAPON/CCTV & Security/',
    defaultVisible: true,
    siteScopeId: 'pengapon',
  }]
  const scopedAssets = [{
    ...assets[0],
    id: 'PENGAPON-POINT',
    assetId: 'SW-PNG-01',
    layerId: 'layer-cctv',
    siteScopeId: 'pengapon',
    properties: {
      extendedData: {
        hostname: 'sw-png-01',
        description: '<b>Core & utama</b>',
      },
    },
  }, {
    id: 'PENGAPON-MULTI',
    assetId: 'CCTV-PNG-01',
    name: 'CCTV Multi',
    sourceName: 'CCTV Multi',
    category: 'CCTV',
    type: 'CCTV',
    datasetVersionId: 'dv-active',
    layerId: 'layer-cctv',
    siteScopeId: 'pengapon',
    properties: { extendedData: { status: 'active' } },
    geometry: [{
      id: 'multi-geometry:part:1',
      sourceGeometryId: 'multi-geometry',
      geometryType: 'point',
      coordinates: [110.421, -6.991, 7],
      sourceGeometry: {
        type: 'MultiGeometry',
        coordinates: [{
          type: 'Point',
          coordinates: [110.421, -6.991, 7],
        }],
      },
    }],
  }, {
    ...assets[0],
    id: 'REWULU-POINT',
    assetId: 'SW-RWL-01',
    siteScopeId: 'rewulu',
  }]
  const scopedRelations = [{
    sourceNodeId: 'PENGAPON-POINT',
    targetNodeId: 'PENGAPON-MULTI',
    relationType: 'connected_to',
    relationSource: 'explicit',
  }, {
    sourceNodeId: 'PENGAPON-POINT',
    targetNodeId: 'REWULU-POINT',
    relationType: 'connected_to',
    relationSource: 'explicit',
  }]
  const kml = serializeActiveDatasetKml({
    activeContext: scopedContext,
    assets: scopedAssets,
    layers,
    relations: scopedRelations,
    scopeLabel: 'Seluruh Pengapon',
  })
  const parsed = parseKmlText(kml)
  const parsedPlacemarks = collectFolderPlacemarks(parsed.folders)

  assert.equal(parsedPlacemarks.length, 2)
  assert.deepEqual(
    parsedPlacemarks.map(({ geometry }) => geometry.type),
    ['Point', 'MultiGeometry'],
  )
  assert.deepEqual(
    parsedPlacemarks[1].geometry.geometries[0].coordinates,
    [110.421, -6.991, 7],
  )
  assert.match(
    parsedPlacemarks[0].sourceFolderPath,
    /FT PENGAPON\/CCTV &(?:amp;)? Security/,
  )
  const metadata = Object.fromEntries(
    parsedPlacemarks[0].extendedData.data.map(({ name, value }) => [name, value]),
  )
  assert.equal(metadata.asset_id, 'SW-PNG-01')
  assert.equal(metadata.hostname, 'sw-png-01')
  assert.equal(metadata.sinergi_layer_id, 'layer-cctv')
  assert.equal(metadata.connected_to, 'PENGAPON-MULTI')
  assert.doesNotMatch(kml, /REWULU-POINT|SW-RWL-01/)
  assert.doesNotMatch(kml, /<b>|<script/i)
})

function collectFolderPlacemarks(folders) {
  return (folders ?? []).flatMap((folder) => [
    ...(folder.placemarks ?? []),
    ...collectFolderPlacemarks(folder.children ?? folder.folders),
  ])
}

function readStoredZipEntry(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(0, true), 0x04034b50)
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const size = view.getUint32(18, true)
  const nameStart = 30
  const dataStart = nameStart + nameLength + extraLength
  return {
    name: new TextDecoder().decode(bytes.slice(nameStart, dataStart)),
    data: bytes.slice(dataStart, dataStart + size),
  }
}
