import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAssetReferenceIndex,
  inferSpatialMountingRelations,
  mergeMountingRelations,
  mountingRelationsFromAssetProjection,
  mountedChildrenForPole,
} from '../src/domain/pole-groups.js'

test('mounting projection merges map and detail relations into one complete pole list', () => {
  const assets = [
    {
      id: 'pole-18',
      canonicalAssetId: 'AUTO-POLE-18',
      identityAliases: { legacy: ['src:tiang:t-018'] },
    },
    {
      id: 'jb-18',
      canonicalAssetId: 'AUTO-JB-18',
      identityAliases: { legacy: ['src:jb:jb-18.1-wp'] },
    },
    {
      id: 'cam-18',
      canonicalAssetId: 'AUTO-CAM-18',
      identityAliases: { legacy: ['src:cctv:c-018'] },
    },
  ]
  const references = createAssetReferenceIndex(assets)
  const relations = mergeMountingRelations([
    [{
      relationId: 'map-jb',
      sourceAssetId: 'AUTO-JB-18',
      targetAssetId: 'AUTO-POLE-18',
      relationType: 'mounted_on',
    }],
    [{
      relationId: 'detail-jb-duplicate',
      sourceAssetId: 'src:jb:jb-18.1-wp',
      targetAssetId: 'src:tiang:t-018',
      relationType: 'mounted_on',
    }, {
      relationId: 'detail-camera',
      sourceAssetId: 'src:cctv:c-018',
      targetAssetId: 'AUTO-POLE-18',
      relationType: 'mounted_on',
    }],
  ], references)

  assert.deepEqual(mountedChildrenForPole(relations, 'pole-18'), ['jb-18', 'cam-18'])
  assert.equal(relations.length, 2)
})

test('mounting projection ignores rejected relations and unrelated network edges', () => {
  const relations = mergeMountingRelations([[{
      sourceAssetId: 'cam-01',
      targetAssetId: 'pole-01',
      relationType: 'mounted_on',
      verificationStatus: 'rejected',
    }, {
      sourceAssetId: 'jb-01',
      targetAssetId: 'pole-01',
      relationType: 'connected_to',
    }, {
      sourceAssetId: 'cam-02',
      targetAssetId: 'pole-01',
      relationType: 'mounted_on',
      verificationStatus: 'confirmed',
    }]])

  assert.deepEqual(mountedChildrenForPole(relations, 'pole-01'), ['cam-02'])
})

test('mounting projection keeps legacy installed-asset fields as a defensive fallback', () => {
  const index = createAssetReferenceIndex([
    { id: 'pole-18', stableAssetId: 'stable-pole-18' },
    { id: 'jb-18', stableAssetId: 'stable-jb-18' },
    { id: 'cam-18', stableAssetId: 'stable-cam-18' },
  ])
  const projected = mountingRelationsFromAssetProjection({
    id: 'stable-pole-18',
    mountedAssetIds: ['stable-jb-18', 'stable-cam-18'],
  }, index)

  assert.deepEqual(mountedChildrenForPole(projected, 'pole-18'), ['jb-18', 'cam-18'])
})

test('spatial mounting inference captures nearby JB and outdoor cameras without adding network edges', () => {
  const assets = [
    {
      id: 'pole-11',
      name: 'T-011',
      type: 'Rekomendasi',
      category: 'Infrastructure',
      locationGroupKey: 'pengapon',
      sourceFolderPath: '/RJBT/FT PENGAPON/TIANG/Rekomendasi',
      coordinate: [110, -7],
    },
    {
      id: 'jb-11',
      name: 'JB-011-exp',
      type: 'Junction box',
      category: 'CCTV',
      locationGroupKey: 'pengapon',
      coordinate: [110.00004, -7],
    },
    {
      id: 'camera-38',
      name: 'C-038',
      type: 'CCTV',
      category: 'CCTV',
      locationGroupKey: 'pengapon',
      sourceFolderPath: '/RJBT/FT PENGAPON/CCTV/Outdoor Fix Bullet',
      coordinate: [110.00008, -7],
    },
    {
      id: 'camera-indoor',
      name: 'C-023-Fix Dome',
      type: 'CCTV',
      category: 'CCTV',
      locationGroupKey: 'pengapon',
      sourceFolderPath: '/RJBT/FT PENGAPON/CCTV/Indoor Fix Dome',
      coordinate: [110.00003, -7],
    },
    {
      id: 'camera-far',
      name: 'C-044',
      type: 'CCTV',
      category: 'CCTV',
      locationGroupKey: 'pengapon',
      sourceFolderPath: '/RJBT/FT PENGAPON/CCTV/Outdoor Fix Bullet',
      coordinate: [110.0003, -7],
    },
  ]

  const inferred = inferSpatialMountingRelations({ assets })

  assert.deepEqual(inferred.map(({ sourceAssetId, targetAssetId }) => (
    [sourceAssetId, targetAssetId]
  )), [
    ['camera-38', 'pole-11'],
    ['jb-11', 'pole-11'],
  ])
  assert.equal(inferred.every((relation) => relation.relationType === 'mounted_on'), true)
  assert.equal(inferred.every((relation) => relation.provenance === 'spatial_inference'), true)
})

test('spatial mounting inference leaves ambiguous pole candidates unresolved', () => {
  const inferred = inferSpatialMountingRelations({
    assets: [
      {
        id: 'pole-a',
        name: 'T-001',
        type: 'Tiang',
        locationGroupKey: 'pengapon',
        coordinate: [110, -7],
      },
      {
        id: 'pole-b',
        name: 'T-002',
        type: 'Tiang',
        locationGroupKey: 'pengapon',
        coordinate: [110.00001, -7],
      },
      {
        id: 'camera-ambiguous',
        name: 'C-099',
        type: 'CCTV',
        category: 'CCTV',
        locationGroupKey: 'pengapon',
        coordinate: [110.000005, -7],
      },
    ],
  })

  assert.deepEqual(inferred, [])
})
