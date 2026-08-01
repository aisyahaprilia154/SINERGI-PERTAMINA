import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachCandidateMapGeometryIds,
  candidateLocationKey,
  countCandidatesForLocation,
  createReviewLocationIndex,
  filterCandidatesByLocation,
  selectReviewLocationGroup,
} from '../src/domain/topology-review-location.js'

const locationGroups = [
  {
    key: 'ft-pengapon-semarang',
    name: 'FT PENGAPON - SEMARANG',
    bounds: [110.40, -7.00, 110.50, -6.90],
  },
  {
    key: 'ft-rewulu',
    name: 'FT REWULU',
    bounds: [110.20, -7.90, 110.30, -7.80],
  },
]

const locationIndex = createReviewLocationIndex({
  locationGroups,
  assets: [
    { id: 'SR_C_031', locationGroupKey: 'ft-pengapon-semarang' },
    { id: 'RW_C_010', locationGroupKey: 'ft-rewulu' },
  ],
  geometries: [
    {
      id: 'geometry:pengapon:part:1',
      sourceGeometryId: 'geometry:pengapon',
      locationGroupKey: 'ft-pengapon-semarang',
    },
    {
      id: 'geometry:rewulu',
      sourceGeometryId: 'geometry:rewulu',
      locationGroupKey: 'ft-rewulu',
    },
  ],
})

const candidates = [
  {
    candidateId: 'candidate-pengapon-geometry',
    sourceGeometryIds: ['geometry:pengapon'],
  },
  {
    candidateId: 'candidate-pengapon-coordinate',
    sourceCoordinate: [110.45, -6.95],
  },
  {
    candidateId: 'candidate-rewulu',
    targetAssetId: 'RW_C_010',
  },
]

test('review candidate resolves to its operational site from geometry, asset, or coordinate', () => {
  assert.equal(candidateLocationKey({
    candidateId: 'candidate-source-folder',
    sourceLocationKey: 'ft-pengapon-semarang',
  }, locationIndex), 'ft-pengapon-semarang')
  assert.equal(
    candidateLocationKey(candidates[0], locationIndex),
    'ft-pengapon-semarang',
  )
  assert.equal(
    candidateLocationKey(candidates[1], locationIndex),
    'ft-pengapon-semarang',
  )
  assert.equal(candidateLocationKey(candidates[2], locationIndex), 'ft-rewulu')
})

test('selected candidate receives the exact physical path geometry ids used by the map', () => {
  const [candidate] = attachCandidateMapGeometryIds([
    {
      candidateId: 'candidate-route',
      sourcePathAssetId: 'path-source',
      targetPathAssetId: 'path-target',
    },
  ], [
    { id: 'map-line-source', sourceGeometryId: 'raw-source', assetId: 'path-source' },
    { id: 'map-line-target', sourceGeometryId: 'raw-target', assetId: 'path-target' },
    { id: 'map-line-other', sourceGeometryId: 'raw-other', assetId: 'path-other' },
  ])

  assert.deepEqual(candidate.mapGeometryIds, [
    'map-line-source',
    'raw-source',
    'map-line-target',
    'raw-target',
  ])
})

test('site selection filters both the review queue and its displayed counts', () => {
  const pengapon = filterCandidatesByLocation(
    candidates,
    'ft-pengapon-semarang',
    locationIndex,
  )

  assert.deepEqual(
    pengapon.map(({ candidateId }) => candidateId),
    ['candidate-pengapon-geometry', 'candidate-pengapon-coordinate'],
  )
  assert.equal(
    countCandidatesForLocation(candidates, 'ft-rewulu', locationIndex),
    1,
  )
})

test('explicit area wins, otherwise the selected candidate chooses Pengapon instead of branch code', () => {
  assert.equal(selectReviewLocationGroup({
    requestedKey: 'ft-rewulu',
    locationGroups,
    candidate: candidates[0],
    candidates,
    locationIndex,
    branchId: 'semarang',
  }).key, 'ft-rewulu')

  assert.equal(selectReviewLocationGroup({
    locationGroups,
    candidate: candidates[0],
    candidates,
    locationIndex,
    branchId: 'semarang',
  }).key, 'ft-pengapon-semarang')
})

test('site with the most review work is the safe fallback when no candidate is selected', () => {
  assert.equal(selectReviewLocationGroup({
    locationGroups,
    candidates,
    locationIndex,
    branchId: 'regional-jawa',
  }).key, 'ft-pengapon-semarang')
})

test('internal Semarang branch code defaults to the operational Pengapon site', () => {
  assert.equal(selectReviewLocationGroup({
    locationGroups,
    candidates: [candidates[2], candidates[2]],
    locationIndex,
    branchId: 'semarang',
  }).key, 'ft-pengapon-semarang')
})
