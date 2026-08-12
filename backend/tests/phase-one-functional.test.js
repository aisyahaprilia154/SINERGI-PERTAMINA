import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildCanonicalAssetIdentityMap,
} from '../src/domain/canonical-asset-identity.js'
import {
  compareCanonicalDatasetVersions,
  paginateDatasetDiff,
} from '../src/domain/dataset-version-diff.js'
import {
  buildReadinessContract,
} from '../src/domain/publication-contract.js'
import { DatasetVersionLifecycleService } from '../src/import/dataset-version-lifecycle-service.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'

test('Fase 1 readiness separates map-only from operational topology', () => {
  const readiness = buildReadinessContract({
    datasetVersion: {
      id: 'dv-readiness',
      branchId: 'semarang',
      validationStatus: 'valid',
      importedAt: '2026-08-12T00:00:00.000Z',
    },
    parserCoverage: {
      sourceElementCounts: { Placemark: 1 },
      parsedElementCounts: { Placemark: 1 },
      unpreservedPlacemarkCount: 0,
      unpreservedOverlayCount: 0,
    },
    sourceFeatures: [{
      sourceFeatureId: 'sf-1',
      sourceElementType: 'Placemark',
      sourceName: 'Camera Gate',
    }],
    sourceGeometries: [{
      geometryId: 'sg-1',
      sourceFeatureId: 'sf-1',
      geometryType: 'Point',
      coordinates: [110, -7],
      valid: true,
    }],
    classifiedObjects: [{
      sourceFeatureId: 'sf-1',
      objectRole: 'device_node',
      networkFamily: 'cctv',
      assetType: 'cctv_fixed',
      category: 'cctv',
      sourceStatus: 'active',
      assetName: 'Camera Gate',
      siteId: 'semarang',
      identityResolutionStatus: 'onboarding_candidate',
    }],
    issues: [{
      issueCode: 'missing_stable_asset_id',
      severity: 'warning',
      readinessDimension: 'inventory',
      blockingProfiles: ['operational_topology'],
      message: 'Review identity diperlukan.',
    }],
  })

  assert.equal(readiness.schemaVersion, '2.0.0')
  assert.equal(readiness.map.status, 'ready')
  assert.equal(readiness.inventory.status, 'not_ready')
  assert.deepEqual(readiness.publishableProfiles, ['map_only'])
  assert.equal(readiness.policyVersion, 'publication-policy:1')
  assert.equal(readiness.evaluatedAt, '2026-08-12T00:00:00.000Z')
})

test('Fase 1 identity registry resolves exact source KML ID and never treats onboarding as stable', () => {
  const map = buildCanonicalAssetIdentityMap({
    datasetVersion: { id: 'dv-identity', datasetId: 'ds-1', branchId: 'semarang' },
    sourceFeatures: [{
      sourceFeatureId: 'sf-1',
      sourceKmlId: 'placemark-camera-1',
      sourceFeatureKey: 'camera-key',
      sourceFolderPath: '/CCTV',
      sourceName: 'Camera Gate',
    }],
    classifiedObjects: [{
      sourceFeatureId: 'sf-1',
      objectRole: 'device_node',
      assetName: 'Camera Gate',
    }],
    identityRegistry: [{
      registryId: 'registry-1',
      assetId: 'CAM-01',
      sourceMatchType: 'source_kml_id',
      sourceMatchValue: 'placemark-camera-1',
      status: 'active',
    }],
  })

  assert.equal(map.items[0].stableAssetId, 'CAM-01')
  assert.equal(map.items[0].identityResolutionStatus, 'stable_registry')
  assert.equal(map.items[0].sourceMatchType, 'source_kml_id')

  const onboarding = buildCanonicalAssetIdentityMap({
    datasetVersion: { id: 'dv-identity-2' },
    sourceFeatures: [{ sourceFeatureId: 'sf-2', sourceName: 'Unassigned' }],
    classifiedObjects: [{ sourceFeatureId: 'sf-2', objectRole: 'device_node' }],
  }).items[0]
  assert.equal(onboarding.stableAssetId, null)
  assert.equal(onboarding.identityResolutionStatus, 'onboarding_candidate')
})

test('Fase 1 diff exposes high-risk removal and bound pagination cursor', () => {
  const active = canonicalRecord('dv-active', [{
    sourceFeatureId: 'sf-old',
    stableAssetId: 'CAM-OLD',
    assetName: 'Old camera',
    objectRole: 'device_node',
    networkFamily: 'cctv',
    assetType: 'cctv_fixed',
    category: 'cctv',
    siteId: 'semarang',
  }])
  const candidate = canonicalRecord('dv-candidate', [])
  const comparison = compareCanonicalDatasetVersions(candidate, active)
  assert.equal(comparison.summary.byType.asset_removed, 1)
  assert.equal(comparison.summary.byRisk.high, 1)
  assert.equal(comparison.summary.requiresBreakingChangeConfirmation, true)
  const page = paginateDatasetDiff(comparison, { risk: 'high', limit: 1 })
  assert.equal(page.items[0].changeType, 'asset_removed')
  assert.equal(page.nextCursor, null)
})

test('Fase 1 JSON activation requires high-risk confirmation and stores publication profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-phase-one-'))
  const auditEntries = []
  const repository = new JsonDatasetVersionRepository(root)
  const service = new DatasetVersionLifecycleService({
    repository,
    auditLog: {
      async record(event, entry) {
        const value = { id: `audit-${auditEntries.length + 1}`, event, ...entry }
        auditEntries.push(value)
        return value
      },
    },
    clock: () => new Date('2026-08-12T00:00:00.000Z'),
  })
  try {
    await repository.create(activationRecord('dv-active', 'active', [{
      sourceFeatureId: 'sf-old',
      stableAssetId: 'CAM-OLD',
      assetName: 'Old camera',
      objectRole: 'device_node',
    }]))
    await repository.create(activationRecord('dv-candidate', 'valid', []))
    const candidate = await repository.get('dv-candidate')

    await assert.rejects(
      service.activate('dv-candidate', 'admin-1', {
        publicationProfile: 'map_only',
        expectedActiveVersionId: 'dv-active',
        expectedRecordRevision: candidate.recordRevision,
      }),
      (error) => error.code === 'breaking_change_confirmation_required',
    )
    assert.equal(
      (await repository.resolveActiveVersion({ datasetId: 'ds-1', branchId: 'semarang' }))
        .record.datasetVersion.id,
      'dv-active',
    )

    const result = await service.activate('dv-candidate', 'admin-1', {
      publicationProfile: 'map_only',
      confirmBreakingChanges: true,
      expectedActiveVersionId: 'dv-active',
      expectedRecordRevision: candidate.recordRevision,
    })
    assert.equal(result.publicationProfile, 'map_only')
    assert.equal(result.capabilities.trace, false)
    assert.equal(result.datasetVersion.publicationProfile, 'map_only')
    assert.ok(auditEntries.some(({ event }) => event === 'dataset_version.activated'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function canonicalRecord(id, classifiedObjects) {
  return {
    datasetVersion: {
      id,
      datasetId: 'ds-1',
      branchId: 'semarang',
      status: 'valid',
      validationStatus: 'valid',
    },
    classifiedObjects,
    sourceFeatures: classifiedObjects.map((object) => ({
      sourceFeatureId: object.sourceFeatureId,
      sourceElementType: 'Placemark',
      sourceName: object.assetName,
    })),
    sourceGeometries: [],
    sourceOverlays: [],
    assets: [],
    geometries: [],
    relations: [],
  }
}

function activationRecord(id, status, objects) {
  const record = canonicalRecord(id, objects)
  return {
    ...record,
    datasetVersion: {
      ...record.datasetVersion,
      status,
      publicationStatus: status === 'active' ? 'published' : 'unpublished',
      versionName: id,
    },
    validation: { status: 'valid', canActivate: true, summary: {} },
    issues: [],
  }
}
