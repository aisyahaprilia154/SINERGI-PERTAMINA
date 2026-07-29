import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptKmlImportResult } from '../src/adapters/kml-import-adapter.js'
import {
  isAssetGeometry,
  isAssetLayer,
  isAssetNode,
  isAssetRelation,
  isDatasetVersion,
  isImportIssue,
  validateKmlImportResult,
} from '../src/domain/kml-import-contract.js'

function datasetVersion(overrides = {}) {
  return {
    id: 'dataset-version-13',
    datasetId: 'dataset-semarang',
    branchId: 'semarang',
    versionName: 'Versi 13',
    versionNote: 'Import dari sumber resmi.',
    officialSourceConfirmed: true,
    sourceFilename: 'sinergi-semarang-v13.kml',
    sourceMimeType: 'application/vnd.google-earth.kml+xml',
    sourceSize: 2048,
    checksum: 'sha256:52c17d6f',
    sourceStorageKey: 'sources/semarang/dataset-version-13/original.kml',
    importedBy: 'user-admin',
    importedAt: '2026-07-27T10:00:00.000Z',
    validationStatus: 'pending',
    publicationStatus: 'unpublished',
    status: 'draft',
    ...overrides,
  }
}

function folderWithPlacemark(placemark, folder = {}) {
  return {
    folders: [{
      id: 'folder-network',
      name: 'Jaringan',
      category: 'infrastructure',
      placemarks: [placemark],
      ...folder,
    }],
  }
}

test('normalizes Point while preserving altitude and source geometry', () => {
  const sourceGeometry = {
    type: 'Point',
    coordinates: [110.4167, -6.9667, 12],
    altitudeMode: 'absolute',
  }
  const parserOutput = folderWithPlacemark({
    id: 'pm-otb-01',
    name: 'OTB MDF',
    extendedData: { assetId: 'OTB-SMG-01', type: 'OTB' },
    geometry: sourceGeometry,
  })
  const snapshot = structuredClone(parserOutput)

  const result = adaptKmlImportResult({
    parserOutput,
    datasetVersion: datasetVersion(),
  })

  assert.deepEqual(parserOutput, snapshot)
  assert.equal(result.datasetVersion.versionNote, 'Import dari sumber resmi.')
  assert.equal(result.datasetVersion.officialSourceConfirmed, true)
  assert.equal(result.geometries[0].geometryType, 'point')
  assert.deepEqual(result.geometries[0].coordinates, [110.4167, -6.9667, 12])
  assert.deepEqual(result.geometries[0].sourceGeometry, sourceGeometry)
  assert.equal(result.geometries[0].altitudeMode, 'absolute')
  assert.deepEqual(result.geometries[0].bounds, [110.4167, -6.9667, 110.4167, -6.9667])
  assert.equal(result.datasetVersion.summary.totalPoints, 1)
  assert.equal(validateKmlImportResult(result).valid, true)
})

test('normalizes LineString without changing coordinate order', () => {
  const coordinates = [
    [110.41, -6.96, 5],
    [110.42, -6.97, 6],
    [110.43, -6.98, 7],
  ]
  const result = adaptKmlImportResult({
    parserOutput: folderWithPlacemark({
      id: 'pm-cable-01',
      name: 'Backbone FO',
      extendedData: { assetId: 'FO-SMG-01', type: 'Fiber optic' },
      geometry: { type: 'LineString', coordinates },
    }),
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.geometries[0].geometryType, 'line_string')
  assert.deepEqual(result.geometries[0].coordinates, coordinates)
  assert.deepEqual(result.geometries[0].bounds, [110.41, -6.98, 110.43, -6.96])
  assert.equal(result.datasetVersion.summary.totalLines, 1)
})

test('normalizes Polygon with outer and inner rings intact', () => {
  const coordinates = [
    [
      [110, -7],
      [111, -7],
      [111, -6],
      [110, -7],
    ],
    [
      [110.2, -6.9],
      [110.4, -6.9],
      [110.3, -6.7],
      [110.2, -6.9],
    ],
  ]
  const result = adaptKmlImportResult({
    parserOutput: folderWithPlacemark({
      id: 'pm-area-01',
      name: 'Area Operasi',
      extendedData: { assetId: 'AREA-SMG-01', type: 'Area' },
      geometry: { type: 'Polygon', coordinates },
    }),
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.geometries[0].geometryType, 'polygon')
  assert.deepEqual(result.geometries[0].coordinates, coordinates)
  assert.equal(result.geometries[0].coordinates.length, 2)
  assert.equal(result.datasetVersion.summary.totalPolygons, 1)
})

test('normalizes ExtendedData and preserves its original parser representation', () => {
  const extendedData = {
    data: [
      { name: 'ASSET_ID', value: 'SW-SMG-01' },
      { name: 'type', value: 'Core switch' },
      { name: 'ipAddress', value: '10.42.0.1' },
      { name: 'location', value: 'Ruang Server' },
    ],
  }
  const result = adaptKmlImportResult({
    parserOutput: folderWithPlacemark({
      id: 'pm-switch-01',
      name: 'Switch Core',
      extendedData,
      geometry: { type: 'Point', coordinates: [110, -7] },
    }),
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.assets[0].assetId, 'SW-SMG-01')
  assert.equal(result.assets[0].type, 'Core switch')
  assert.equal(result.assets[0].location, 'Ruang Server')
  assert.equal(result.assets[0].properties.extendedData.ipAddress, '10.42.0.1')
  assert.deepEqual(result.assets[0].properties.sourceExtendedData, extendedData)
})

test('records duplicate Asset ID as a blocking issue without mutating placemarks', () => {
  const parserOutput = {
    placemarks: [
      {
        id: 'pm-1',
        name: 'Camera 1',
        extendedData: { assetId: 'CCTV-01' },
        geometry: { type: 'Point', coordinates: [110, -7] },
      },
      {
        id: 'pm-2',
        name: 'Camera 2',
        extendedData: { assetId: 'CCTV-01' },
        geometry: { type: 'Point', coordinates: [111, -7] },
      },
    ],
  }
  const snapshot = structuredClone(parserOutput)
  const result = adaptKmlImportResult({
    parserOutput,
    datasetVersion: datasetVersion(),
  })

  assert.deepEqual(parserOutput, snapshot)
  assert.equal(result.assets.length, 1)
  assert.equal(result.datasetVersion.status, 'invalid')
  assert.ok(result.issues.some(
    (issue) => issue.issueCode === 'duplicate_asset_id' && issue.canActivate === false,
  ))
})

test('records placemark without Asset ID and keeps it out of normalized assets', () => {
  const result = adaptKmlImportResult({
    parserOutput: folderWithPlacemark({
      id: 'pm-without-id',
      name: 'Placemark tanpa ID',
      geometry: { type: 'Point', coordinates: [110, -7] },
    }),
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.assets.length, 0)
  assert.equal(result.datasetVersion.summary.totalPlacemarks, 1)
  assert.equal(result.datasetVersion.summary.errors, 1)
  assert.ok(result.issues.some((issue) => issue.issueCode === 'missing_asset_id'))
})

test('uses an explicit folder-path and Placemark-name fallback when configured', () => {
  const parserOutput = {
    folders: [{
      name: 'CCTV',
      category: 'CCTV',
      children: [{
        name: 'Camera Fix Dome Indoor',
        category: 'unmapped',
        placemarks: [{
          name: 'Cam-05',
          geometry: { type: 'Point', coordinates: [110, -7] },
        }],
      }],
    }],
  }
  const snapshot = structuredClone(parserOutput)
  const result = adaptKmlImportResult({
    parserOutput,
    datasetVersion: datasetVersion(),
    mapping: { sourceIdentityFallback: 'folder-path-name' },
  })

  assert.deepEqual(parserOutput, snapshot)
  assert.equal(
    result.assets[0].assetId,
    'src:cctv-camera-fix-dome-indoor:cam-05',
  )
  assert.equal(result.assets[0].category, 'CCTV')
  assert.equal(result.assets[0].type, 'Camera Fix Dome Indoor')
  assert.equal(
    result.assets[0].properties.sourceIdentityMapping.strategy,
    'folder-path-name',
  )
  assert.ok(result.issues.some(
    (issue) => issue.issueCode === 'source_identity_fallback_applied'
      && issue.canActivate === true,
  ))
  assert.equal(result.datasetVersion.summary.errors, 0)
})

test('source identity fallback distinguishes duplicate names by source order', () => {
  const result = adaptKmlImportResult({
    parserOutput: {
      folders: [{
        name: 'UTP',
        category: 'LAN',
        placemarks: [{
          name: 'SR_C-031',
          geometry: {
            type: 'LineString',
            coordinates: [[110, -7], [110.1, -7.1]],
          },
        }, {
          name: 'SR_C-031',
          geometry: {
            type: 'LineString',
            coordinates: [[110, -7], [110.2, -7.2]],
          },
        }],
      }],
    },
    datasetVersion: datasetVersion(),
    mapping: { sourceIdentityFallback: 'folder-path-name' },
  })

  assert.deepEqual(result.assets.map(({ assetId }) => assetId), [
    'src:utp:sr-c-031:1',
    'src:utp:sr-c-031:2',
  ])
  assert.equal(result.datasetVersion.summary.errors, 0)
  assert.equal(result.datasetVersion.summary.warnings, 2)
})

test('keeps only explicit valid relation references from the same dataset version', () => {
  const parserOutput = {
    placemarks: [
      {
        id: 'pm-switch',
        name: 'Switch',
        extendedData: { assetId: 'SW-01' },
        geometry: { type: 'Point', coordinates: [110, -7] },
      },
      {
        id: 'pm-server',
        name: 'Server',
        extendedData: { assetId: 'SRV-01' },
        geometry: { type: 'Point', coordinates: [111, -7] },
      },
    ],
    relations: [
      {
        id: 'relation-valid',
        sourceAssetId: 'pm-switch',
        targetAssetId: 'SRV-01',
        relationType: 'connected-to',
        sourceMetadataKey: 'connectedAssetId',
      },
      {
        id: 'relation-broken',
        sourceAssetId: 'SW-01',
        targetAssetId: 'UNKNOWN-01',
        relationType: 'connected-to',
      },
    ],
  }
  const result = adaptKmlImportResult({
    parserOutput,
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.relations.length, 1)
  assert.deepEqual(
    [result.relations[0].sourceAssetId, result.relations[0].targetAssetId],
    ['SW-01', 'SRV-01'],
  )
  assert.ok(result.issues.some((issue) => issue.issueCode === 'unknown_relation_reference'))
  assert.equal(result.datasetVersion.summary.totalRelations, 1)
})

test('builds nested AssetLayer hierarchy with stable source folder paths', () => {
  const result = adaptKmlImportResult({
    parserOutput: {
      folders: [{
        id: 'folder-cctv',
        name: 'CCTV',
        category: 'cctv',
        children: [{
          id: 'folder-area-a',
          name: 'Area A',
          category: 'cctv',
          placemarks: [{
            id: 'pm-cctv-01',
            name: 'Camera Gate',
            extendedData: { assetId: 'CCTV-01', type: 'CCTV' },
            geometry: { type: 'Point', coordinates: [110, -7] },
          }],
        }],
      }],
    },
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.layers.length, 2)
  assert.equal(result.layers[0].sourceFolderPath, '/CCTV')
  assert.equal(result.layers[1].sourceFolderPath, '/CCTV/Area A')
  assert.equal(result.layers[1].parentLayerId, result.layers[0].id)
  assert.equal(result.assets[0].layerId, result.layers[1].id)
  assert.equal(result.datasetVersion.summary.totalFolders, 2)
})

test('does not create an AssetLayer for a folder with no objects in its subtree', () => {
  const result = adaptKmlImportResult({
    parserOutput: {
      folders: [{
        name: 'Folder kosong',
        category: 'unmapped',
        placemarks: [],
        children: [],
      }, {
        name: 'CCTV',
        category: 'CCTV',
        placemarks: [{
          name: 'Camera 01',
          extendedData: { assetId: 'CAM-01' },
          geometry: { type: 'Point', coordinates: [110, -7] },
        }],
      }],
    },
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.datasetVersion.summary.totalFolders, 2)
  assert.equal(result.layers.length, 1)
  assert.equal(result.layers[0].name, 'CCTV')
  assert.equal(result.assets.length, 1)
})

test('nested layer visibility is inherited without dropping source assets', () => {
  const result = adaptKmlImportResult({
    parserOutput: {
      folders: [{
        name: 'CCTV',
        category: 'CCTV',
        visibility: false,
        children: [{
          name: 'Camera',
          category: 'CCTV',
          visibility: true,
          placemarks: [{
            name: 'Camera hidden by parent',
            extendedData: { assetId: 'CAM-HIDDEN' },
            properties: { visibility: true },
            geometry: { type: 'Point', coordinates: [110, -7] },
          }],
        }],
      }],
    },
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.layers.length, 2)
  assert.equal(result.layers[0].defaultVisible, false)
  assert.equal(result.layers[1].defaultVisible, false)
  assert.equal(result.assets.length, 1)
  assert.equal(result.geometries.length, 1)
})

test('one MultiGeometry Placemark remains one owner asset and one persisted geometry', () => {
  const result = adaptKmlImportResult({
    parserOutput: folderWithPlacemark({
      name: 'Mixed source object',
      extendedData: { assetId: 'MIXED-01' },
      geometry: {
        type: 'MultiGeometry',
        geometries: [{
          type: 'Point',
          coordinates: [110, -7],
        }, {
          type: 'LineString',
          coordinates: [[110, -7], [110.1, -7.1]],
        }],
      },
    }),
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.assets.length, 1)
  assert.equal(result.geometries.length, 1)
  assert.equal(result.geometries[0].geometryType, 'multi_geometry')
  assert.equal(result.geometries[0].coordinates.length, 2)
  assert.equal(result.datasetVersion.summary.totalAssets, 1)
  assert.equal(result.datasetVersion.summary.totalPoints, 1)
  assert.equal(result.datasetVersion.summary.totalLines, 1)
})

test('creates relations from ExtendedData only when an explicit mapping rule is supplied', () => {
  const parserOutput = {
    placemarks: [
      {
        name: 'Camera',
        extendedData: { assetId: 'CCTV-01', connectedTo: 'SW-01' },
        geometry: { type: 'Point', coordinates: [110, -7] },
      },
      {
        name: 'Switch',
        extendedData: { assetId: 'SW-01' },
        geometry: { type: 'Point', coordinates: [111, -7] },
      },
    ],
  }
  const withoutMapping = adaptKmlImportResult({
    parserOutput,
    datasetVersion: datasetVersion(),
  })
  const withMapping = adaptKmlImportResult({
    parserOutput,
    datasetVersion: datasetVersion(),
    mapping: {
      relationMappings: [{
        targetKey: 'connectedTo',
        relationType: 'connected-to',
      }],
    },
  })

  assert.deepEqual(withoutMapping.relations, [])
  assert.equal(withMapping.relations.length, 1)
  assert.equal(withMapping.relations[0].sourceMetadataKey, 'connectedTo')
})

test('keeps endpoint topology reviewable without changing source LineString', () => {
  const parserOutput = {
    folders: [{
      name: 'LAN',
      category: 'LAN',
      placemarks: [{
        name: 'Switch A',
        extendedData: { assetId: 'SW-A' },
        type: 'Switch',
        geometry: { type: 'Point', coordinates: [110, -7] },
      }, {
        name: 'Access Point B',
        extendedData: { assetId: 'AP-B' },
        type: 'Access Point',
        geometry: { type: 'Point', coordinates: [110.001, -7] },
      }, {
        name: 'LAN cable',
        extendedData: { assetId: 'LAN-01' },
        type: 'LAN cable',
        geometry: {
          type: 'LineString',
          coordinates: [[110, -7], [110.001, -7]],
        },
      }],
    }],
  }
  const snapshot = structuredClone(parserOutput)

  const result = adaptKmlImportResult({
    parserOutput,
    datasetVersion: datasetVersion(),
  })

  assert.deepEqual(parserOutput, snapshot)
  assert.equal(result.relations.length, 0)
  assert.equal(result.topologyGraph.edges.length, 0)
  assert.equal(result.topologyGraph.spatialCandidates.length, 1)
  assert.equal(result.topologyGraph.spatialCandidates[0].candidateStatus, 'candidate')
  assert.equal(
    result.topologyGraph.spatialCandidates[0].sourceGeometryId,
    result.geometries[2].id,
  )
})

test('ambiguous topology candidates become ImportIssue diagnostics, not confirmed edges', () => {
  const result = adaptKmlImportResult({
    parserOutput: {
      folders: [{
        name: 'LAN',
        category: 'LAN',
        placemarks: [{
          name: 'Switch A',
          extendedData: { assetId: 'SW-A' },
          type: 'Switch',
          geometry: { type: 'Point', coordinates: [110.00001, -7] },
        }, {
          name: 'Switch B',
          extendedData: { assetId: 'SW-B' },
          type: 'Switch',
          geometry: { type: 'Point', coordinates: [109.99999, -7] },
        }, {
          name: 'Access Point end',
          extendedData: { assetId: 'AP-END' },
          type: 'Access Point',
          geometry: { type: 'Point', coordinates: [110.001, -7] },
        }, {
          name: 'LAN cable',
          extendedData: { assetId: 'LAN-01' },
          type: 'LAN cable',
          geometry: {
            type: 'LineString',
            coordinates: [[110, -7], [110.001, -7]],
          },
        }],
      }],
    },
    datasetVersion: datasetVersion(),
  })

  assert.equal(result.relations.length, 0)
  assert.equal(result.topologyGraph.ambiguousConnections.length, 1)
  assert.ok(result.issues.some(
    ({ issueCode }) => issueCode === 'topology_connection_ambiguous',
  ))
})

test('records unsupported KML elements instead of ignoring them silently', () => {
  const result = adaptKmlImportResult({
    parserOutput: {
      placemarks: [{
        name: 'OTB',
        extendedData: { assetId: 'OTB-01' },
        geometry: { type: 'Point', coordinates: [110, -7] },
      }],
      unsupportedElements: [{
        name: 'gx:Track',
        sourcePlacemarkName: 'OTB',
      }],
    },
    datasetVersion: datasetVersion(),
  })

  assert.ok(result.issues.some((issue) => (
    issue.issueCode === 'unsupported_kml_element'
    && issue.message.includes('gx:Track')
  )))
  assert.equal(result.datasetVersion.summary.warnings, 1)
})

test('runtime guards recognize every normalized contract collection', () => {
  const result = adaptKmlImportResult({
    parserOutput: {
      placemarks: [
        {
          name: 'A',
          extendedData: { assetId: 'A' },
          geometry: { type: 'Point', coordinates: [110, -7] },
        },
        {
          name: 'B',
          extendedData: { assetId: 'B' },
          geometry: { type: 'Point', coordinates: [111, -7] },
        },
      ],
      relations: [{
        sourceAssetId: 'A',
        targetAssetId: 'B',
        relationType: 'connected-to',
      }],
    },
    datasetVersion: datasetVersion(),
  })

  assert.ok(isDatasetVersion(result.datasetVersion))
  assert.ok(result.layers.every(isAssetLayer))
  assert.ok(result.assets.every(isAssetNode))
  assert.ok(result.geometries.every(isAssetGeometry))
  assert.ok(result.relations.every(isAssetRelation))
  assert.ok(result.issues.every(isImportIssue))
  assert.equal(validateKmlImportResult(result).valid, true)
})
