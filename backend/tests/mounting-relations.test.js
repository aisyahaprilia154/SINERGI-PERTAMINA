import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateMountingArtifacts,
  MOUNTING_RELATION_TYPE,
} from '../src/topology/mounting-relations.js'

function topologyBundle(nodes, datasetVersionId = 'dataset-version-1') {
  return {
    datasetVersion: { id: datasetVersionId, branchId: 'branch-1' },
    site: 'site-1',
    classifiedNodes: nodes.map(({
      id,
      type,
      coordinate,
      siteId = 'site-1',
      branchId = 'branch-1',
      sourceFolderPath = '/RJBT/Pengapon/Tiang',
      canonicalAssetType = type,
      canonicalCategory = 'Infrastructure',
      identityAliases = {},
      sourceName = id,
    }) => ({
      canonicalAssetId: id,
      assetType: type,
      canonicalAssetType,
      canonicalCategory,
      sourceName,
      siteId,
      branchId,
      sourceFolderPath,
      identityAliases,
      geometryIds: [`geometry-${id}`],
    })),
    geometries: nodes.map(({ id, coordinate }) => ({
      geometryId: `geometry-${id}`,
      geometryType: 'Point',
      valid: true,
      coordinates: coordinate,
    })),
  }
}

test('mounting inference assigns one unique nearest pole without adding a network edge', () => {
  const result = generateMountingArtifacts(topologyBundle([
    { id: 'pole-1', type: 'Tiang CCTV', coordinate: [110, -7] },
    { id: 'cctv-1', type: 'CCTV', coordinate: [110.000005, -7] },
    { id: 'pole-far', type: 'Tiang', coordinate: [110.00005, -7] },
    { id: 'switch-1', type: 'Switch', coordinate: [110.000005, -7] },
  ]))

  assert.equal(result.relations.length, 1)
  assert.equal(result.relations[0].relationType, MOUNTING_RELATION_TYPE)
  assert.equal(result.relations[0].relationKind, 'installation_attachment')
  assert.equal(result.relations[0].sourceAssetId, 'cctv-1')
  assert.equal(result.relations[0].targetAssetId, 'pole-1')
  assert.equal(result.relations[0].provenance, 'spatial_inference')
  assert.equal(result.candidates.length, 0)
  assert.deepEqual(result.options.map(({ targetAssetId }) => targetAssetId), [
    'pole-1',
    'pole-far',
  ])
  assert.equal(result.summary.relationCount, 1)
  assert.equal(result.summary.optionCount, 2)
})

test('mounting inference leaves an ambiguous asset unresolved when two poles are too close', () => {
  const result = generateMountingArtifacts(topologyBundle([
    { id: 'pole-a', type: 'Tiang', coordinate: [110, -7] },
    { id: 'pole-b', type: 'Pole CCTV', coordinate: [110.00001, -7] },
    { id: 'cctv-1', type: 'CCTV', coordinate: [110.000005, -7] },
  ]))

  assert.equal(result.relations.length, 0)
  assert.deepEqual(result.candidates.map(({ targetAssetId }) => targetAssetId), ['pole-a', 'pole-b'])
  assert.deepEqual(result.options.map(({ targetAssetId }) => targetAssetId), ['pole-a', 'pole-b'])
  assert.equal(result.summary.ambiguousAssetCount, 1)
})

test('mounting inference consistently includes nearby CCTV and junction boxes on a pole', () => {
  const result = generateMountingArtifacts(topologyBundle([
    { id: 'pole-18', type: 'Tiang', sourceName: 'T-018', coordinate: [110, -7] },
    { id: 'camera-18', type: 'CCTV', sourceName: 'C-018', coordinate: [110.00003, -7] },
    { id: 'jb-18', type: 'Junction Box', sourceName: 'JB-18.1-WP', coordinate: [110.000005, -7] },
  ]))

  assert.deepEqual(result.relations.map(({ sourceAssetId, targetAssetId }) => (
    [sourceAssetId, targetAssetId]
  )).sort(), [
    ['camera-18', 'pole-18'],
    ['jb-18', 'pole-18'],
  ].sort())
  assert.equal(result.summary.searchRadiusMeters, 5)
})

test('matching asset number bridges a bounded KMZ offset without capturing an unrelated pole', () => {
  const result = generateMountingArtifacts(topologyBundle([
    { id: 'pole-13', type: 'Tiang', sourceName: 'T-013', coordinate: [110, -7] },
    { id: 'jb-13', type: 'Junction Box', sourceName: 'JB-013', coordinate: [110.00008, -7] },
    { id: 'camera-unrelated', type: 'CCTV', sourceName: 'C-099', coordinate: [110.00008, -7] },
  ]))

  assert.equal(result.relations.length, 1)
  assert.equal(result.relations[0].sourceAssetId, 'jb-13')
  assert.equal(result.relations[0].targetAssetId, 'pole-13')
  assert.equal(result.relations[0].evidence[0].ruleId, 'mounting.matching-asset-number')
  assert.equal(result.summary.identityRadiusMeters, 10)
})

test('mounting inference uses distance ratio when coordinate uncertainty exceeds the absolute delta', () => {
  const result = generateMountingArtifacts(topologyBundle([
    { id: 'pole-near', type: 'Tiang', coordinate: [110.0000072, -7] },
    { id: 'pole-second', type: 'Tiang', coordinate: [110.0000108, -7] },
    { id: 'cctv-1', type: 'CCTV', coordinate: [110, -7] },
  ]), {
    config: {
      mountingAmbiguityDeltaMeters: 0.35,
      mountingAmbiguityRatio: 1.5,
    },
  })

  assert.equal(result.relations.length, 0)
  assert.deepEqual(result.candidates.map(({ targetAssetId }) => targetAssetId), [
    'pole-near',
    'pole-second',
  ])
  assert.equal(result.summary.ambiguityRatio, 1.5)
})

test('manual mounting override wins across regeneration and detach suppresses automatic inference', () => {
  const bundle = topologyBundle([
    { id: 'pole-near', type: 'Tiang', coordinate: [110, -7] },
    { id: 'pole-selected', type: 'Tiang', coordinate: [110.000015, -7] },
    { id: 'cctv-1', type: 'CCTV', coordinate: [110.000004, -7] },
  ])
  const assigned = generateMountingArtifacts(bundle, {
    previousOverrides: [{
      assetId: 'cctv-1',
      targetAssetId: 'pole-selected',
      actorId: 'admin-1',
      reason: 'Koreksi lapangan',
      updatedAt: '2026-08-19T01:00:00.000Z',
    }],
  })

  assert.equal(assigned.relations.length, 1)
  assert.equal(assigned.relations[0].targetAssetId, 'pole-selected')
  assert.equal(assigned.relations[0].provenance, 'manual_admin')
  assert.deepEqual(assigned.options.map(({ targetAssetId }) => targetAssetId), [
    'pole-near',
    'pole-selected',
  ])

  const detached = generateMountingArtifacts(bundle, {
    previousOverrides: [{
      assetId: 'cctv-1',
      action: 'detach',
      targetAssetId: null,
      actorId: 'admin-1',
    }],
  })

  assert.equal(detached.relations.length, 0)
  assert.equal(detached.candidates.length, 0)
  assert.equal(detached.overrides[0].action, 'detach')
})

test('manual picker exposes same-facility poles beyond automatic radius', () => {
  const result = generateMountingArtifacts(topologyBundle([
    {
      id: 'pole-near',
      type: 'Tiang',
      coordinate: [110, -7],
      sourceFolderPath: '/RJBT/Pengapon/Tiang',
    },
    {
      id: 'pole-manual',
      type: 'Tiang',
      coordinate: [110.0001, -7],
      sourceFolderPath: '/RJBT/Pengapon/Tiang',
    },
    {
      id: 'cctv-1',
      type: 'CCTV',
      coordinate: [110.000005, -7],
      sourceFolderPath: '/RJBT/Pengapon/CCTV',
    },
  ], 'dataset-version-radius'), {
    config: {
      mountingSearchRadiusMeters: 2,
      mountingOptionRadiusMeters: 20,
    },
  })

  assert.equal(result.relations.length, 1)
  assert.equal(result.relations[0].targetAssetId, 'pole-near')
  assert.deepEqual(result.options.map(({ targetAssetId }) => targetAssetId), [
    'pole-near',
    'pole-manual',
  ])
  assert.equal(result.summary.optionRadiusMeters, 20)
})

test('facility scope prevents cross-facility mounting while keeping branch and site equal', () => {
  const result = generateMountingArtifacts(topologyBundle([
    {
      id: 'pole-pengapon',
      type: 'Tiang',
      coordinate: [110, -7],
      sourceFolderPath: '/RJBT/Pengapon/Tiang',
    },
    {
      id: 'cctv-pengapon',
      type: 'CCTV',
      coordinate: [110.000005, -7],
      sourceFolderPath: '/RJBT/Pengapon/CCTV',
    },
    {
      id: 'pole-rewulu',
      type: 'Tiang',
      coordinate: [110.00001, -7],
      sourceFolderPath: '/RJBT/Rewulu/Tiang',
    },
    {
      id: 'cctv-rewulu',
      type: 'CCTV',
      coordinate: [110.000015, -7],
      sourceFolderPath: '/RJBT/Rewulu/CCTV',
    },
  ], 'dataset-version-facility'))

  assert.deepEqual(result.relations.map(({ sourceAssetId, targetAssetId }) => (
    [sourceAssetId, targetAssetId]
  )), [
    ['cctv-pengapon', 'pole-pengapon'],
    ['cctv-rewulu', 'pole-rewulu'],
  ])
})

test('canonical classification wins over folder names when recognizing poles', () => {
  const result = generateMountingArtifacts(topologyBundle([
    {
      id: 'pole-1',
      type: 'Tiang',
      coordinate: [110, -7],
      sourceFolderPath: '/RJBT/Pengapon/Tiang',
    },
    {
      id: 'camera-in-pole-folder',
      type: 'CCTV',
      coordinate: [110.000005, -7],
      sourceFolderPath: '/RJBT/Pengapon/TIANG',
      sourceName: 'Camera Gate',
    },
  ], 'dataset-version-classification'))

  assert.equal(result.summary.poleCount, 1)
  assert.equal(result.summary.mountableAssetCount, 1)
  assert.equal(result.relations[0].sourceAssetId, 'camera-in-pole-folder')
})

test('manual assignment follows canonical identity aliases across the next import', () => {
  const datasetVersionId = 'dataset-version-identity'
  const firstImport = topologyBundle([
    {
      id: 'pole-old',
      type: 'Tiang',
      coordinate: [110, -7],
      sourceFolderPath: '/RJBT/Pengapon/Tiang',
    },
    {
      id: 'cctv-old',
      type: 'CCTV',
      coordinate: [110.00002, -7],
      sourceFolderPath: '/RJBT/Pengapon/CCTV',
    },
  ], datasetVersionId)
  const secondImport = topologyBundle([
    {
      id: 'pole-canonical',
      type: 'Tiang',
      coordinate: [110, -7],
      sourceFolderPath: '/RJBT/Pengapon/Tiang',
      identityAliases: { legacy: ['pole-old'] },
    },
    {
      id: 'cctv-canonical',
      type: 'CCTV',
      coordinate: [110.00002, -7],
      sourceFolderPath: '/RJBT/Pengapon/CCTV',
      identityAliases: { legacy: ['cctv-old'] },
    },
  ], datasetVersionId)

  const first = generateMountingArtifacts(firstImport, {
    previousOverrides: [{
      assetId: 'cctv-old',
      targetAssetId: 'pole-old',
      actorId: 'admin-1',
      updatedAt: '2026-08-19T01:00:00.000Z',
    }],
  })
  const second = generateMountingArtifacts(secondImport, {
    previousOverrides: first.overrides,
  })

  assert.equal(second.relations.length, 1)
  assert.equal(second.relations[0].sourceAssetId, 'cctv-canonical')
  assert.equal(second.relations[0].targetAssetId, 'pole-canonical')
  assert.equal(second.relations[0].provenance, 'manual_admin')
})
