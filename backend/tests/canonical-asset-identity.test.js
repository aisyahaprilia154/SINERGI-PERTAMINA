import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAssetIdentityMapFromRecord,
  buildCanonicalAssetIdentityMap,
  createAutomaticIdentityRegistry,
  createAssetIdentityResolver,
  hydrateIdentityRegistrySourceAliases,
} from '../src/domain/canonical-asset-identity.js'

test('canonical identity map keeps stable IDs canonical and exposes onboarding and legacy aliases', () => {
  const map = buildCanonicalAssetIdentityMap({
    datasetVersion: { id: 'dv-identity-test' },
    sourceFeatures: [{
      sourceFeatureId: 'feature-stable',
      sourceKmlId: 'placemark-stable',
      sourceFolderPath: '/FT Pengapon/CCTV',
      sourceName: 'Cam 01',
    }, {
      sourceFeatureId: 'feature-onboarding',
      sourceKmlId: 'placemark-onboarding',
      sourceFolderPath: '/FT Pengapon/CCTV',
      sourceName: 'Cam 02',
    }],
    classifiedObjects: [{
      sourceFeatureId: 'feature-stable',
      assetId: 'CAM-01',
    }, {
      sourceFeatureId: 'feature-onboarding',
      assetId: null,
    }],
  })

  const stable = map.items.find(({ sourceFeatureId }) => sourceFeatureId === 'feature-stable')
  const onboarding = map.items.find(({ sourceFeatureId }) => sourceFeatureId === 'feature-onboarding')
  const resolver = createAssetIdentityResolver(map)

  assert.equal(stable.canonicalAssetId, 'CAM-01')
  assert.equal(stable.identityStatus, 'stable')
  assert.equal(resolver.resolve('placemark-stable'), 'CAM-01')
  assert.equal(resolver.resolve(stable.legacyId), 'CAM-01')
  assert.match(onboarding.canonicalAssetId, /^onboarding-identity:/)
  assert.equal(onboarding.identityStatus, 'onboarding')
  assert.equal(resolver.resolve(onboarding.sourceFeatureId), onboarding.canonicalAssetId)
  assert.equal(resolver.resolve(onboarding.legacyId), onboarding.canonicalAssetId)
  assert.equal(map.validation.valid, true)
})

test('legacy records migrate folder/name IDs to onboarding canonical IDs without losing aliases', () => {
  const record = {
    datasetVersion: { id: 'dv-legacy' },
    assets: [{
      id: 'asset-node:dv-legacy:src-pengapon-cam-01',
      assetId: 'src:pengapon:cam-01',
      sourceFeatureId: 'feature-legacy',
      properties: {
        sourceIdentityMapping: {
          strategy: 'folder-path-name',
          legacyId: 'src:pengapon:cam-01',
        },
      },
    }],
    topologyInputBundle: {
      classifiedNodes: [{
        sourceFeatureId: 'feature-legacy',
        assetId: 'onboarding-identity:legacy-node',
      }],
      classifiedPaths: [],
    },
  }

  const map = buildAssetIdentityMapFromRecord(record)
  const item = map.items[0]
  const resolver = createAssetIdentityResolver(map)

  assert.equal(item.canonicalAssetId, 'onboarding-identity:legacy-node')
  assert.equal(item.stableAssetId, null)
  assert.equal(item.legacyId, 'src:pengapon:cam-01')
  assert.equal(resolver.resolve('src:pengapon:cam-01'), item.canonicalAssetId)
  assert.equal(resolver.resolve(record.assets[0].id), item.canonicalAssetId)
  assert.equal(map.validation.valid, true)
})

test('duplicate stable IDs invalidate the identity map instead of silently resolving an alias', () => {
  const map = buildCanonicalAssetIdentityMap({
    datasetVersion: { id: 'dv-duplicate' },
    sourceFeatures: [{ sourceFeatureId: 'feature-a', sourceName: 'A', sourceFolderPath: '/A' }, {
      sourceFeatureId: 'feature-b', sourceName: 'B', sourceFolderPath: '/B' }],
    classifiedObjects: [{ sourceFeatureId: 'feature-a', assetId: 'DUPLICATE' }, {
      sourceFeatureId: 'feature-b', assetId: 'DUPLICATE' }],
  })

  assert.equal(map.validation.valid, false)
  assert.deepEqual(map.validation.duplicateCanonicalIds, [{
    canonicalAssetId: 'DUPLICATE',
    count: 2,
  }])
  assert.equal(map.aliasToCanonicalAssetId.DUPLICATE, null)
})

test('automatic identity assigns deterministic internal IDs only to unique onboarding objects', () => {
  const base = {
    datasetVersion: { id: 'dv-auto', datasetId: 'dataset-1', branchId: 'semarang' },
    sourceFeatures: [{
      sourceFeatureId: 'feature-auto',
      sourceKmlId: 'placemark-auto',
      sourceIdentityKey: '/cctv|camera auto|placemark',
      sourceName: 'Camera Auto',
    }, {
      sourceFeatureId: 'feature-duplicate-a',
      sourceIdentityKey: '/cctv|duplicate|placemark',
      sourceName: 'Duplicate',
    }, {
      sourceFeatureId: 'feature-duplicate-b',
      sourceIdentityKey: '/cctv|duplicate|placemark',
      sourceName: 'Duplicate',
    }],
    classifiedObjects: [{
      sourceFeatureId: 'feature-auto',
      objectRole: 'device_node',
      identityResolutionStatus: 'onboarding_candidate',
    }, {
      sourceFeatureId: 'feature-duplicate-a',
      objectRole: 'device_node',
      identityResolutionStatus: 'onboarding_candidate',
    }, {
      sourceFeatureId: 'feature-duplicate-b',
      objectRole: 'device_node',
      identityResolutionStatus: 'onboarding_candidate',
    }],
  }
  const proposal = createAutomaticIdentityRegistry(base)
  const repeat = createAutomaticIdentityRegistry(base)

  assert.equal(proposal.assignments.length, 1)
  assert.equal(proposal.assignments[0].sourceFeatureId, 'feature-auto')
  assert.match(proposal.assignments[0].assetId, /^AUTO-/)
  assert.deepEqual(proposal.assignments, repeat.assignments)
  assert.deepEqual(proposal.skipped, [
    { sourceFeatureId: 'feature-duplicate-a', reason: 'ambiguous_source_key' },
    { sourceFeatureId: 'feature-duplicate-b', reason: 'ambiguous_source_key' },
  ])

  const map = buildCanonicalAssetIdentityMap({
    ...base,
    identityRegistry: proposal.identityRegistry,
  })
  const resolved = map.items.find(({ sourceFeatureId }) => sourceFeatureId === 'feature-auto')
  assert.equal(resolved.stableAssetId, proposal.assignments[0].assetId)
  assert.equal(resolved.identityResolutionStatus, 'stable_registry')

  const linked = createAutomaticIdentityRegistry({
    ...base,
    identityRegistry: [{
      registryId: 'identity-registry:known-source',
      datasetId: 'dataset-1',
      branchId: 'semarang',
      assetId: 'AUTO-KNOWN',
      sourceMatchType: 'source_kml_id',
      sourceMatchValue: 'placemark-auto',
      validFromDatasetVersionId: 'dv-old',
      status: 'active',
    }],
  })
  assert.equal(linked.assignments.length, 0)
  assert.equal(linked.linkedAssignments.length, 1)
  assert.ok(linked.linkedEntries.some((entry) => (
    entry.sourceMatchType === 'source_feature_id'
      && entry.sourceMatchValue === 'feature-auto'
      && entry.assetId === 'AUTO-KNOWN'
  )))
})

test('automatic identity backfills a stable source key from an existing source feature mapping', () => {
  const base = {
    datasetVersion: { id: 'dv-auto-backfill', datasetId: 'dataset-1', branchId: 'semarang' },
    sourceFeatures: [{
      sourceFeatureId: 'feature-existing',
      sourceKmlId: 'placemark-existing',
      sourceIdentityKey: '/cctv|camera existing|placemark',
      sourceFeatureKey: 'feature-key-existing',
      sourceName: 'Camera Existing',
    }],
    classifiedObjects: [{
      sourceFeatureId: 'feature-existing',
      objectRole: 'device_node',
      stableAssetId: 'AUTO-EXISTING',
      identityStatus: 'stable',
      identityResolutionStatus: 'stable_registry',
    }],
    identityRegistry: [{
      registryId: 'identity-registry:existing-feature',
      datasetId: 'dataset-1',
      branchId: 'semarang',
      assetId: 'AUTO-EXISTING',
      sourceMatchType: 'source_feature_id',
      sourceMatchValue: 'feature-existing',
      validFromDatasetVersionId: 'dv-old',
      status: 'active',
    }],
  }
  const proposal = createAutomaticIdentityRegistry(base)

  assert.equal(proposal.assignments.length, 0)
  assert.deepEqual(proposal.backfillAssignments, [{
    sourceFeatureId: 'feature-existing',
    action: 'assign',
    assetId: 'AUTO-EXISTING',
    reason: 'Identity registry source key dilengkapi otomatis dari mapping source_feature_id yang sudah stabil.',
    evidenceRefs: [
      'identity-source:source_kml_id:placemark-existing',
      'identity-source:source_feature_id:feature-existing',
    ],
  }])
  assert.ok(proposal.identityRegistry.some((entry) => (
    entry.assetId === 'AUTO-EXISTING'
      && entry.sourceMatchType === 'source_kml_id'
      && entry.sourceMatchValue === 'placemark-existing'
  )))

  const legacyHydration = hydrateIdentityRegistrySourceAliases({
    datasetVersion: base.datasetVersion,
    sourceFeatures: [{
      sourceFeatureId: 'feature-existing',
      sourceFolderPath: '/cctv',
      sourceName: 'Camera Existing',
    }],
    classifiedObjects: base.classifiedObjects,
    identityRegistry: base.identityRegistry,
  })
  assert.equal(
    legacyHydration.addedEntries[0].sourceMatchValue,
    '/cctv|camera existing|placemark',
  )
})
