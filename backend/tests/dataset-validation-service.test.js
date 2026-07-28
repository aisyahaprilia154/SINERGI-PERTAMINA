import assert from 'node:assert/strict'
import test from 'node:test'
import { DatasetVersionValidationService } from '../src/import/dataset-validation-service.js'

test('non-blocking warnings and normalization information keep a version activatable', () => {
  const service = new DatasetVersionValidationService()
  const result = service.validate({
    result: createResult({
      assets: [
        createAsset({
          category: 'unmapped',
          type: 'unknown',
          properties: {
            sourceDescription: '<b>Core switch</b>',
            description: 'Core switch',
            metadataMapping: [{
              targetField: 'assetId',
              sourceKey: 'Asset ID',
              originalValue: 'SW-01',
              normalizedValue: 'SW-01',
            }],
            semanticMetadata: { assetId: 'SW-01' },
          },
        }),
      ],
      geometries: [createPointGeometry()],
      relations: [
        createRelation({ id: 'relation-1' }),
        createRelation({ id: 'relation-2' }),
      ],
    }),
    parserOutput: createParserOutput(),
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
    expectedBranchId: 'semarang',
  })

  assert.equal(result.validation.status, 'valid')
  assert.equal(result.validation.canActivate, true)
  assert.equal(result.datasetVersion.status, 'valid')
  assert.equal(result.datasetVersion.publicationStatus, 'unpublished')
  assert.ok(result.issues.some((issue) => (
    issue.issueCode === 'CATEGORY_UNMAPPED'
    && issue.severity === 'warning'
    && issue.canActivate === true
  )))
  assert.ok(result.issues.some((issue) => issue.issueCode === 'RELATION_SELF_REFERENCE'))
  assert.ok(result.issues.some((issue) => issue.issueCode === 'RELATION_DUPLICATE'))
  assert.ok(result.issues.some((issue) => issue.issueCode === 'RELATION_CYCLE_DETECTED'))
  assert.ok(result.issues.some((issue) => issue.issueCode === 'METADATA_ALIAS_APPLIED'))
  assert.ok(result.issues.some((issue) => issue.issueCode === 'DESCRIPTION_SANITIZED'))
  assert.equal(result.validation.integrity.activeVersionUnchanged, true)
  assert.equal(result.validation.integrity.userVisible, false)
})

test('blocking validation covers structure, geometry, relation, metadata, and version integrity', () => {
  const service = new DatasetVersionValidationService({
    requireAssetName: true,
    requiredMetadataFields: ['hostname'],
  })
  const result = service.validate({
    result: createResult({
      datasetVersion: {
        status: 'active',
        publicationStatus: 'published',
        activatedBy: 'admin-2',
        activatedAt: '2026-07-28T01:00:00.000Z',
        sourceMimeType: 'application/zip',
        sourceSize: 60 * 1024 * 1024,
      },
      assets: [
        createAsset({
          name: 'Placemark 1',
          properties: {
            sourceNameMissing: true,
            semanticMetadata: {},
            metadataMapping: [],
          },
        }),
      ],
      geometries: [
        createPointGeometry({ coordinates: [181, -7] }),
      ],
      relations: [
        createRelation({
          id: 'relation-unresolved',
          datasetVersionId: 'different-version',
          targetAssetId: 'MISSING-01',
        }),
      ],
      issues: [{
        id: 'legacy-unresolved',
        datasetVersionId: 'dv-1',
        severity: 'warning',
        issueCode: 'unknown_relation_reference',
        message: 'Target relation tidak tersedia.',
        assetId: 'MISSING-01',
        canActivate: true,
      }],
    }),
    parserOutput: createParserOutput({
      structure: {
        hasKmlRoot: true,
        documentCount: 0,
        folderCount: 0,
        placemarkCount: 1,
      },
    }),
    sourceSelection: { selectedKmlPath: 'doc.kml', resources: [] },
    expectedBranchId: 'semarang',
  })

  assert.equal(result.validation.status, 'invalid')
  assert.equal(result.validation.canActivate, false)
  assert.equal(result.datasetVersion.status, 'invalid')
  assert.equal(result.datasetVersion.publicationStatus, 'unpublished')
  for (const code of [
    'FILE_INVALID_TYPE',
    'FILE_TOO_LARGE',
    'KML_DOCUMENT_MISSING',
    'ASSET_NAME_MISSING',
    'METADATA_REQUIRED_MISSING',
    'COORDINATE_INVALID',
    'RELATION_TARGET_NOT_FOUND',
    'RELATION_VERSION_MISMATCH',
    'ACTIVE_VERSION_MUTATION_ATTEMPT',
    'PARTIAL_VERSION_PUBLICATION_ATTEMPT',
  ]) {
    assert.ok(result.issues.some((issue) => (
      issue.issueCode === code
      && issue.severity === 'error'
      && issue.canActivate === false
    )), `Issue blocking ${code} tidak tersedia.`)
  }
})

test('validation result exposes stable facets and map focus references', () => {
  const service = new DatasetVersionValidationService()
  const result = service.validate({
    result: createResult({
      assets: [createAsset({ category: 'unmapped' })],
      geometries: [createPointGeometry()],
    }),
    parserOutput: createParserOutput(),
    sourceSelection: { selectedKmlPath: 'network.kml', resources: [] },
    expectedBranchId: 'semarang',
  })

  const categoryIssue = result.issues.find((issue) => issue.issueCode === 'CATEGORY_UNMAPPED')
  assert.equal(categoryIssue.scope, 'asset')
  assert.equal(categoryIssue.focus.assetId, 'SW-01')
  assert.equal(categoryIssue.focus.layerId, 'layer-1')
  assert.equal(result.validation.facets.issueCode.CATEGORY_UNMAPPED >= 1, true)
  assert.equal(
    result.validation.summary.total,
    result.validation.summary.errors
      + result.validation.summary.warnings
      + result.validation.summary.information,
  )
})

test('parser or archive failure becomes a blocking result without publishing partial data', () => {
  const service = new DatasetVersionValidationService()
  const failed = service.createFailure({
    record: createResult({
      assets: [],
      geometries: [],
      relations: [],
    }),
    error: {
      code: 'invalid_kml_xml',
      message: 'Dokumen KML bukan XML yang valid.',
      expose: true,
      details: { line: 4, column: 12 },
    },
  })

  assert.equal(failed.datasetVersion.status, 'invalid')
  assert.equal(failed.datasetVersion.validationStatus, 'invalid')
  assert.equal(failed.datasetVersion.publicationStatus, 'unpublished')
  assert.equal(failed.validation.canActivate, false)
  assert.equal(failed.validation.integrity.userVisible, false)
  assert.ok(failed.issues.some((issue) => (
    issue.issueCode === 'KML_XML_INVALID'
    && issue.scope === 'file'
    && issue.canActivate === false
    && issue.details.line === 4
  )))

  const archiveFailure = service.createFailure({
    record: createResult({ assets: [], geometries: [], relations: [] }),
    error: {
      code: 'corrupt_kmz',
      message: 'Archive KMZ rusak.',
      expose: true,
    },
  })
  assert.ok(archiveFailure.issues.some((issue) => (
    issue.issueCode === 'KMZ_ARCHIVE_INVALID'
    && issue.canActivate === false
  )))
})

function createResult({
  datasetVersion = {},
  assets = [createAsset()],
  geometries = [createPointGeometry()],
  relations = [],
  issues = [],
} = {}) {
  return {
    contractVersion: '1.0.0',
    datasetVersion: {
      id: 'dv-1',
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
      versionName: 'Import fixture',
      sourceFilename: 'network.kml',
      sourceMimeType: 'application/vnd.google-earth.kml+xml',
      sourceSize: 1024,
      checksum: `sha256:${'a'.repeat(64)}`,
      sourceStorageKey: 'source-files/dv-1/source.kml',
      importedBy: 'admin-1',
      importedAt: '2026-07-28T00:00:00.000Z',
      validationStatus: 'pending',
      publicationStatus: 'unpublished',
      status: 'processing',
      summary: {
        totalFolders: 1,
        totalPlacemarks: assets.length,
        totalAssets: assets.length,
        totalPoints: geometries.length,
        totalLines: 0,
        totalPolygons: 0,
        totalRelations: relations.length,
        newAssets: 0,
        updatedAssets: 0,
        unchangedAssets: 0,
        removedAssets: 0,
        errors: 0,
        warnings: 0,
      },
      ...datasetVersion,
    },
    layers: [{
      id: 'layer-1',
      datasetVersionId: 'dv-1',
      sourceFolderPath: '/Infrastructure',
      name: 'Infrastructure',
      category: 'Infrastructure',
      displayOrder: 0,
      defaultVisible: true,
    }],
    assets,
    geometries,
    relations,
    issues,
  }
}

function createAsset(overrides = {}) {
  return {
    id: 'asset-node-1',
    datasetVersionId: 'dv-1',
    layerId: 'layer-1',
    assetId: 'SW-01',
    name: 'Core Switch',
    category: 'Infrastructure',
    type: 'Switch',
    branchId: 'semarang',
    properties: {
      semanticMetadata: { assetId: 'SW-01' },
      metadataMapping: [],
    },
    ...overrides,
  }
}

function createPointGeometry(overrides = {}) {
  return {
    id: 'geometry-1',
    assetNodeId: 'asset-node-1',
    geometryType: 'point',
    coordinates: [110.4, -6.9],
    sourceGeometry: {
      type: 'Point',
      coordinates: [110.4, -6.9],
    },
    ...overrides,
  }
}

function createRelation(overrides = {}) {
  return {
    id: 'relation-1',
    datasetVersionId: 'dv-1',
    sourceAssetId: 'SW-01',
    targetAssetId: 'SW-01',
    relationType: 'connected-to',
    ...overrides,
  }
}

function createParserOutput(overrides = {}) {
  return {
    folders: [],
    placemarks: [{}],
    issues: [],
    unsupportedElements: [],
    structure: {
      hasKmlRoot: true,
      documentCount: 1,
      folderCount: 1,
      placemarkCount: 1,
    },
    ...overrides,
  }
}
