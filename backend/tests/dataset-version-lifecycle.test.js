import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  compareDatasetVersions,
  DatasetVersionLifecycleService,
} from '../src/import/dataset-version-lifecycle-service.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'

test('comparison classifies new, updated, unchanged, and removed assets deterministically', () => {
  const active = {
    datasetVersion: { id: 'active-v1' },
    assets: [
      asset('node-a-old', 'A', 'Switch A'),
      asset('node-b-old', 'B', 'Switch B'),
      asset('node-d-old', 'D', 'Removed device'),
    ],
    geometries: [
      point('geometry-a-old', 'node-a-old', 110, -7),
      point('geometry-b-old', 'node-b-old', 111, -7),
      point('geometry-d-old', 'node-d-old', 112, -7),
    ],
  }
  const candidate = {
    assets: [
      asset('node-a-new', 'A', 'Switch A'),
      asset('node-b-new', 'B', 'Switch B Updated'),
      asset('node-c-new', 'C', 'New device'),
    ],
    geometries: [
      point('geometry-a-new', 'node-a-new', 110, -7),
      point('geometry-b-new', 'node-b-new', 111, -7),
      point('geometry-c-new', 'node-c-new', 113, -7),
    ],
  }

  const comparison = compareDatasetVersions(candidate, active)
  assert.deepEqual(
    Object.fromEntries(comparison.assetChanges.map(({ assetId, status }) => [assetId, status])),
    {
      A: 'unchanged',
      B: 'updated',
      C: 'new',
    },
  )
  assert.equal(comparison.removedAssets[0].asset.assetId, 'D')
  assert.deepEqual(comparison.summary, {
    newAssets: 1,
    updatedAssets: 1,
    unchangedAssets: 1,
    removedAssets: 1,
  })
})

test('atomic activation archives the previous version and publishes one shared pointer', async () => {
  const cacheEvents = []
  const fixture = await createLifecycleFixture({
    activeDatasetCache: {
      async invalidate(context) {
        cacheEvents.push(context)
      },
    },
  })
  try {
    await fixture.repository.create(versionRecord('version-old', 'active'))
    await fixture.repository.create(versionRecord('version-new', 'valid'))

    const result = await fixture.service.activate('version-new', 'admin-1', {
      expectedActiveVersionId: 'version-old',
      correlationId: 'activation-correlation-test',
    })
    const active = await fixture.service.getActiveDataset({
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
    })
    const mapView = await fixture.service.getActiveMapDataset({
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
    })
    const assetDetail = await fixture.service.getActiveAssetDetail({
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
      assetId: 'ASSET-version-new',
    })
    const records = await fixture.repository.list()

    assert.equal(result.activePointer.datasetVersionId, 'version-new')
    assert.equal(result.archivedDatasetVersion.id, 'version-old')
    assert.equal(active.datasetVersion.id, 'version-new')
    assert.equal(active.activePointer.revision, result.activePointer.revision)
    assert.deepEqual(cacheEvents, [{
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
      revision: result.activePointer.revision,
    }])
    assert.equal(active.assets[0].datasetVersionId, 'version-new')
    assert.equal(mapView.mapView, true)
    assert.equal(mapView.activePointer.revision, result.activePointer.revision)
    assert.equal(mapView.assets[0].assetId, 'ASSET-version-new')
    assert.equal(mapView.assets[0].sourceFeatureId, 'source-feature-version-new')
    assert.equal(Object.hasOwn(mapView.assets[0], 'properties'), false)
    assert.deepEqual(mapView.geometries[0].coordinates, [110, -7])
    assert.equal(mapView.geometries[0].sourceGeometryId, 'source-geometry-version-new')
    assert.equal(mapView.geometries[0].sourceFeatureId, 'source-feature-version-new')
    assert.deepEqual(assetDetail.asset.properties, {
      sourceFeatureId: 'source-feature-version-new',
    })
    assert.deepEqual(
      records.filter(({ datasetVersion }) => datasetVersion.status === 'active')
        .map(({ datasetVersion }) => datasetVersion.id),
      ['version-new'],
    )
    assert.equal(
      records.find(({ datasetVersion }) => datasetVersion.id === 'version-old')
        .datasetVersion.status,
      'archived',
    )
    assert.ok(fixture.auditEntries.some((entry) => (
      entry.event === 'dataset_version.activated'
      && entry.details.previousVersionId === 'version-old'
      && entry.details.newVersionId === 'version-new'
      && entry.details.result === 'committed'
      && entry.correlationId === 'activation-correlation-test'
    )))
  } finally {
    await fixture.close()
  }
})

test('rollback reactivates the previous archived version and publishes a new pointer', async () => {
  const fixture = await createLifecycleFixture()
  try {
    await fixture.repository.create(versionRecord('version-old', 'active'))
    await fixture.repository.create(versionRecord('version-new', 'valid'))
    await fixture.service.activate('version-new', 'admin-1', {
      expectedActiveVersionId: 'version-old',
    })

    const result = await fixture.service.rollbackToPrevious(
      'dataset-semarang',
      'semarang',
      'operator-rollback',
      { expectedActiveVersionId: 'version-new' },
    )
    const active = await fixture.repository.resolveActiveVersion({
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
    })
    const oldVersion = await fixture.repository.get('version-old')
    const newVersion = await fixture.repository.get('version-new')

    assert.equal(result.operation, 'rollback')
    assert.equal(result.datasetVersion.id, 'version-old')
    assert.equal(result.activePointer.datasetVersionId, 'version-old')
    assert.equal(result.activePointer.previousVersionId, 'version-new')
    assert.equal(active.record.datasetVersion.id, 'version-old')
    assert.equal(oldVersion.datasetVersion.status, 'active')
    assert.equal(newVersion.datasetVersion.status, 'archived')
    assert.ok(fixture.auditEntries.some((entry) => (
      entry.event === 'dataset_version.rolled_back'
      && entry.details.previousVersionId === 'version-new'
      && entry.details.newVersionId === 'version-old'
      && entry.details.operation === 'rollback'
      && entry.details.result === 'committed'
    )))
  } finally {
    await fixture.close()
  }
})

test('active map migrates legacy asset and topology IDs into one canonical identity', async () => {
  const fixture = await createLifecycleFixture()
  try {
    const record = versionRecord('version-identity', 'active')
    record.assets[0] = {
      ...record.assets[0],
      assetId: 'src:pengapon:cam-01',
      properties: {
        sourceFeatureId: 'source-feature-identity',
        sourceIdentityMapping: {
          strategy: 'folder-path-name',
          legacyId: 'src:pengapon:cam-01',
        },
      },
    }
    record.geometries[0].sourceFeatureId = 'source-feature-identity'
    record.topologyInputBundle = {
      classifiedNodes: [{
        sourceFeatureId: 'source-feature-identity',
        assetId: 'onboarding-identity:cam-01',
      }],
      classifiedPaths: [],
    }
    record.topologyGraph = {
      nodes: [{
        id: 'onboarding-identity:cam-01',
        sourceFeatureId: 'source-feature-identity',
      }],
      edges: [],
    }
    record.confirmedRelations = [{
      relationId: 'relation-path-continuation',
      relationType: 'path-continuation',
      verificationStatus: 'confirmed',
      sourceAssetId: 'onboarding-identity:cam-01',
      targetAssetId: 'onboarding-identity:cam-02',
    }]
    record.topologySummary = {
      candidateCount: 0,
      confirmedEdgeCount: 1,
    }
    record.readiness = {
      mapReadiness: 'ready',
      inventoryReadiness: 'not_ready',
      topologyReadiness: 'not_ready',
    }
    record.topologyReadiness = { topologyReadiness: 'not_ready' }
    await fixture.repository.create(record)

    const mapView = await fixture.service.getActiveMapDataset({
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
    })

    assert.equal(mapView.assets[0].assetId, 'src:pengapon:cam-01')
    assert.equal(mapView.assets[0].canonicalAssetId, 'onboarding-identity:cam-01')
    assert.equal(mapView.assets[0].legacyAssetId, 'src:pengapon:cam-01')
    assert.equal(mapView.topologyGraph.nodes[0].id, 'onboarding-identity:cam-01')
    assert.equal(mapView.topologyIdentity.unresolvedNodeCount, 0)
    assert.equal(mapView.topologySummary.confirmedEdgeCount, 0)
    assert.equal(mapView.topologySummary.confirmedRelationCount, 1)
    assert.equal(mapView.topologySummary.confirmedPathContinuationCount, 1)
    assert.equal(mapView.readinessContract.topologyReady, 'not_ready')
  } finally {
    await fixture.close()
  }
})

test('automatic identity assignment persists source feature mapping and is idempotent', async () => {
  const fixture = await createLifecycleFixture()
  try {
    const record = versionRecord('version-auto-identity', 'valid')
    const sourceFeatureId = 'source-feature-auto'
    record.sourceFeatures = [{
      sourceFeatureId,
      datasetVersionId: record.datasetVersion.id,
      sourceName: 'Asset Auto',
      sourceFeatureKey: 'feature-key-auto',
      sourceElementType: 'Placemark',
      sourceFolderPath: '/root',
      sourceName: 'Asset Auto',
    }]
    record.classifiedObjects = [{
      sourceFeatureId,
      objectRole: 'device_node',
      assetId: 'onboarding-identity:auto',
      identityStatus: 'onboarding',
      identityResolutionStatus: 'onboarding_candidate',
      assetName: 'Asset Auto',
      sourceStatus: 'active',
    }]
    record.assetIdentityRegistry = []
    record.identityRegistry = []
    record.sourceGeometries = []
    record.sourceOverlays = []
    record.parserCoverage = {}
    record.canonicalParser = { explicitRelationEvidence: [] }
    record.topologyInputBundle = {
      classifiedNodes: [{
        sourceFeatureId,
        assetId: 'onboarding-identity:auto',
      }],
      classifiedPaths: [],
    }
    record.topologyGraph = null
    record.topologyReadiness = null
    await fixture.repository.create(record)

    const first = await fixture.service.autoAssignUniqueIdentityAssignments(
      record.datasetVersion.id,
    )
    const updated = await fixture.repository.get(record.datasetVersion.id)
    const assetId = updated.classifiedObjects[0].stableAssetId
    const activeMappings = updated.assetIdentityRegistry.filter((entry) => (
      entry.assetId === assetId && entry.status === 'active'
    ))

    assert.equal(first.state, 'updated')
    assert.equal(first.automaticIdentity.generatedCount, 1)
    assert.match(assetId, /^AUTO-[A-F0-9]{24}$/)
    assert.deepEqual(
      activeMappings.map(({ sourceMatchType, sourceMatchValue }) => [
        sourceMatchType,
        sourceMatchValue,
      ]).sort(),
      [
        ['source_feature_id', sourceFeatureId],
        ['source_feature_key', '/root|asset auto|placemark'],
      ],
    )

    const second = await fixture.service.autoAssignUniqueIdentityAssignments(
      record.datasetVersion.id,
    )
    assert.equal(second.state, 'no_changes')
    assert.equal(second.automaticIdentity.generatedCount, 0)
  } finally {
    await fixture.close()
  }
})

test('concurrent activation is locked and cannot publish two active versions', async () => {
  let enterCommit
  let releaseCommit
  const commitEntered = new Promise((resolve) => { enterCommit = resolve })
  const commitGate = new Promise((resolve) => { releaseCommit = resolve })
  const fixture = await createLifecycleFixture({
    activationHooks: {
      async beforePointerCommit({ newVersionId }) {
        if (newVersionId !== 'version-a') return
        enterCommit()
        await commitGate
      },
    },
  })
  try {
    await fixture.repository.create(versionRecord('version-old', 'active'))
    await fixture.repository.create(versionRecord('version-a', 'valid'))
    await fixture.repository.create(versionRecord('version-b', 'valid'))

    const firstActivation = fixture.service.activate('version-a', 'admin-a', {
      expectedActiveVersionId: 'version-old',
    })
    await commitEntered
    const visibleDuringTransaction = await fixture.service.getActiveDataset({
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
    })
    assert.equal(visibleDuringTransaction.datasetVersion.id, 'version-old')
    await assert.rejects(
      fixture.service.activate('version-b', 'admin-b', {
        expectedActiveVersionId: 'version-old',
      }),
      (error) => error.code === 'activation_in_progress' && error.statusCode === 409,
    )
    releaseCommit()
    await firstActivation

    const active = await fixture.repository.resolveActiveVersion({
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
    })
    const records = await fixture.repository.list()
    assert.equal(active.record.datasetVersion.id, 'version-a')
    assert.equal(
      records.filter(({ datasetVersion }) => datasetVersion.status === 'active').length,
      1,
    )
    assert.equal(
      records.find(({ datasetVersion }) => datasetVersion.id === 'version-b')
        .datasetVersion.status,
      'valid',
    )
  } finally {
    releaseCommit?.()
    await fixture.close()
  }
})

test('failure before pointer commit rolls every version back and records audit failure', async () => {
  const cacheEvents = []
  const fixture = await createLifecycleFixture({
    activationHooks: {
      async beforePointerCommit() {
        throw Object.assign(new Error('Injected commit failure'), {
          code: 'injected_commit_failure',
        })
      },
    },
    activeDatasetCache: {
      async invalidate(context) {
        cacheEvents.push(context)
      },
    },
  })
  try {
    await fixture.repository.create(versionRecord('version-old', 'active'))
    await fixture.repository.create(versionRecord('version-new', 'valid'))

    await assert.rejects(
      fixture.service.activate('version-new', 'admin-rollback', {
        expectedActiveVersionId: 'version-old',
      }),
      (error) => error.code === 'injected_commit_failure',
    )

    const active = await fixture.repository.resolveActiveVersion({
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
    })
    const previous = await fixture.repository.get('version-old')
    const target = await fixture.repository.get('version-new')
    assert.equal(active.record.datasetVersion.id, 'version-old')
    assert.equal(previous.datasetVersion.status, 'active')
    assert.equal(target.datasetVersion.status, 'valid')
    assert.deepEqual(cacheEvents, [])
    assert.ok(fixture.auditEntries.some((entry) => (
      entry.event === 'dataset_version.activation_failed'
      && entry.outcome === 'failed'
      && entry.details.previousVersionId === 'version-old'
      && entry.details.result === 'rolled_back'
    )))
  } finally {
    await fixture.close()
  }
})

test('validation is re-checked inside the activation lock', async () => {
  const fixture = await createLifecycleFixture()
  try {
    await fixture.repository.create(versionRecord('version-old', 'active'))
    await fixture.repository.create(versionRecord('version-new', 'valid'))
    await fixture.repository.update('version-new', (record) => ({
      ...record,
      datasetVersion: {
        ...record.datasetVersion,
        validationStatus: 'invalid',
      },
      validation: {
        ...record.validation,
        status: 'invalid',
        canActivate: false,
        summary: {
          ...record.validation.summary,
          errors: 1,
          blocking: 1,
        },
      },
      issues: [{
        id: 'blocking-issue',
        severity: 'error',
        issueCode: 'COORDINATE_INVALID',
        message: 'Invalid coordinate.',
        canActivate: false,
      }],
    }))

    await assert.rejects(
      fixture.service.activate('version-new', 'admin-1', {
        expectedActiveVersionId: 'version-old',
      }),
      (error) => error.code === 'dataset_version_not_activatable',
    )
    assert.equal(
      (await fixture.repository.resolveActiveVersion({
        datasetId: 'dataset-semarang',
      })).record.datasetVersion.id,
      'version-old',
    )
    assert.equal(
      (await fixture.repository.get('version-new')).datasetVersion.status,
      'valid',
    )
  } finally {
    await fixture.close()
  }
})

test('stale activation request is rejected after active pointer changes', async () => {
  const fixture = await createLifecycleFixture()
  try {
    await fixture.repository.create(versionRecord('version-old', 'active'))
    await fixture.repository.create(versionRecord('version-a', 'valid'))
    await fixture.repository.create(versionRecord('version-b', 'valid'))
    await fixture.service.activate('version-a', 'admin-a', {
      expectedActiveVersionId: 'version-old',
    })

    await assert.rejects(
      fixture.service.activate('version-b', 'admin-b', {
        expectedActiveVersionId: 'version-old',
      }),
      (error) => (
        error.code === 'stale_activation_request'
        && error.details.currentActiveVersionId === 'version-a'
      ),
    )
    const active = await fixture.repository.resolveActiveVersion({
      datasetId: 'dataset-semarang',
    })
    assert.equal(active.record.datasetVersion.id, 'version-a')
    assert.equal(
      (await fixture.repository.get('version-b')).datasetVersion.status,
      'valid',
    )

    const next = await fixture.service.activate('version-b', 'admin-b', {
      expectedActiveVersionId: 'version-a',
    })
    assert.equal(next.activePointer.previousVersionId, 'version-a')
    assert.equal(
      (await fixture.repository.resolveActiveVersion({
        datasetId: 'dataset-semarang',
      })).record.datasetVersion.id,
      'version-b',
    )
    assert.equal(
      (await fixture.repository.get('version-a')).datasetVersion.status,
      'archived',
    )
  } finally {
    await fixture.close()
  }
})

function asset(id, assetId, name) {
  return {
    id,
    assetId,
    name,
    category: 'Infrastructure',
    type: 'Switch',
    branchId: 'semarang',
    properties: {},
  }
}

function point(id, assetNodeId, longitude, latitude) {
  return {
    id,
    assetNodeId,
    geometryType: 'point',
    coordinates: [longitude, latitude],
  }
}

function versionRecord(id, status) {
  return {
    datasetVersion: {
      id,
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
      versionName: id,
      validationStatus: 'valid',
      publicationStatus: status === 'active' ? 'published' : 'unpublished',
      status,
      summary: {
        totalAssets: 1,
        errors: 0,
        warnings: 0,
      },
    },
    validation: {
      status: 'valid',
      canActivate: true,
      summary: {
        errors: 0,
        warnings: 0,
        blocking: 0,
      },
    },
    issues: [],
    layers: [{
      id: `layer-${id}`,
      datasetVersionId: id,
      name: 'Infrastructure',
    }],
    assets: [{
      id: `node-${id}`,
      datasetVersionId: id,
      layerId: `layer-${id}`,
      assetId: `ASSET-${id}`,
      name: id,
      category: 'Infrastructure',
      type: 'Switch',
      branchId: 'semarang',
      properties: { sourceFeatureId: `source-feature-${id}` },
    }],
    geometries: [{
      id: `geometry-${id}`,
      assetNodeId: `node-${id}`,
      sourceGeometryId: `source-geometry-${id}`,
      sourceFeatureId: `source-feature-${id}`,
      geometryType: 'point',
      coordinates: [110, -7],
    }],
    relations: [],
  }
}

async function createLifecycleFixture({
  activationHooks = {},
  activeDatasetCache = null,
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sinergi-activation-'))
  const repository = new JsonDatasetVersionRepository(directory, {
    activationHooks,
  })
  const auditEntries = []
  const auditLog = {
    async record(event, entry) {
      auditEntries.push({ event, ...structuredClone(entry) })
    },
  }
  return {
    directory,
    repository,
    auditEntries,
    service: new DatasetVersionLifecycleService({
      repository,
      auditLog,
      activeDatasetCache,
      clock: () => new Date('2026-07-28T05:00:00.000Z'),
    }),
    async close() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}
