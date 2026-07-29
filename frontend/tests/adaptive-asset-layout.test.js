import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAdaptiveAssetLayout,
  groupNearbyItems,
} from '../src/pages/map/adaptive-asset-layout.js'

const denseAssets = [
  {
    id: 'CAM-01',
    label: 'CAM-01',
    type: 'CCTV',
    coordinate: [109.7627059, -7.7152771],
    point: { x: 200, y: 200 },
    active: true,
    color: '#6f6de8',
  },
  {
    id: 'JB-01',
    label: 'JB-01',
    type: 'Junction box',
    coordinate: [109.7627153, -7.7152763],
    point: { x: 207, y: 202 },
    active: true,
    isCoreNode: true,
    color: '#6f6de8',
  },
  {
    id: 'T-04',
    label: 'T-04',
    type: 'Tiang',
    coordinate: [109.7627063, -7.7152711],
    point: { x: 203, y: 194 },
    active: true,
    color: '#c58722',
  },
]

test('far zoom combines dense KML points into a clickable aggregate', () => {
  const layout = buildAdaptiveAssetLayout(denseAssets, {
    zoom: 15,
    viewport: { width: 800, height: 600 },
  })

  assert.equal(layout.markers.length, 1)
  assert.equal(layout.markers[0].kind, 'cluster')
  assert.equal(layout.markers[0].count, 3)
  assert.deepEqual(new Set(layout.markers[0].memberIds), new Set(['CAM-01', 'JB-01', 'T-04']))
  assert.equal(layout.summary.clusteredAssetCount, 3)
  assert.equal(layout.leaders.length, 0)
})

test('close zoom spreads dense assets while keeping leaders on canonical coordinates', () => {
  const layout = buildAdaptiveAssetLayout(denseAssets, {
    zoom: 18,
    viewport: { width: 800, height: 600 },
  })
  const assetMarkers = layout.markers.filter(({ kind }) => kind === 'asset')
  const displayPositions = assetMarkers.map(({ point }) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)

  assert.equal(assetMarkers.length, 3)
  assert.equal(new Set(displayPositions).size, 3)
  assert.equal(layout.leaders.length, 3)
  assert.deepEqual(
    layout.leaders.find(({ assetId }) => assetId === 'JB-01').from,
    { x: 207, y: 202 },
  )
  assert.equal(layout.summary.displacedAssetCount, 3)
})

test('selected asset expands its cluster and keeps its identity label visible', () => {
  const selected = denseAssets.map((asset) => ({
    ...asset,
    selected: asset.id === 'CAM-01',
  }))
  const layout = buildAdaptiveAssetLayout(selected, {
    zoom: 15,
    viewport: { width: 800, height: 600 },
  })

  assert.equal(layout.markers.every(({ kind }) => kind === 'asset'), true)
  assert.equal(layout.markers.find(({ id }) => id === 'CAM-01').showLabel, true)
  assert.equal(layout.leaders.length, 3)
})

test('turning adaptive layout off keeps every marker at its exact projected point', () => {
  const layout = buildAdaptiveAssetLayout(denseAssets, {
    zoom: 18,
    viewport: { width: 800, height: 600 },
    enabled: false,
  })

  assert.equal(layout.leaders.length, 0)
  layout.markers.forEach((marker) => {
    assert.deepEqual(marker.point, denseAssets.find(({ id }) => id === marker.id).point)
  })
})

test('spatial grouping joins nearby assets without merging a distant site', () => {
  const groups = groupNearbyItems([
    ...denseAssets,
    {
      id: 'REMOTE-01',
      point: { x: 600, y: 500 },
    },
  ], 30)

  assert.deepEqual(groups.map((group) => group.length).sort((a, b) => a - b), [1, 3])
})

test('spatial grouping does not chain adjacent points into one oversized cluster', () => {
  const groups = groupNearbyItems([
    { id: 'A', point: { x: 0, y: 0 } },
    { id: 'B', point: { x: 25, y: 0 } },
    { id: 'C', point: { x: 50, y: 0 } },
  ], 30)

  assert.deepEqual(groups.map((group) => group.length).sort((a, b) => a - b), [1, 2])
})
