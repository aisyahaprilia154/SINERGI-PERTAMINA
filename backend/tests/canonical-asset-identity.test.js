import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAssetIdentityMapFromRecord,
  buildCanonicalAssetIdentityMap,
  createAssetIdentityResolver,
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
