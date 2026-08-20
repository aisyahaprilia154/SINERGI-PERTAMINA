import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachClustersToPoleGroups,
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
    isPole: true,
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
  assert.deepEqual(layout.markers[0].representativePole, {
    id: 'T-04',
    label: 'T-04',
  })
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
  const poleMarker = assetMarkers.find(({ id }) => id === 'T-04')

  assert.equal(assetMarkers.length, 3)
  assert.equal(poleMarker?.isPole, true)
  assert.equal(poleMarker?.kind, 'asset')
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

test('large dense groups stay compact and peel out only the selected asset', () => {
  const manyAssets = Array.from({ length: 30 }, (_, index) => ({
    ...denseAssets[index % denseAssets.length],
    id: `ASSET-${index + 1}`,
    label: `ASSET-${index + 1}`,
    point: {
      x: 200 + (index % 5),
      y: 200 + (index % 4),
    },
    selected: index === 0,
  }))
  const layout = buildAdaptiveAssetLayout(manyAssets, {
    zoom: 18,
    viewport: { width: 800, height: 600 },
  })
  const assetMarkers = layout.markers.filter(({ kind }) => kind === 'asset')
  const clusters = layout.markers.filter(({ kind }) => kind === 'cluster')

  assert.equal(assetMarkers.length, 1)
  assert.equal(assetMarkers[0].id, 'ASSET-1')
  assert.equal(assetMarkers[0].showLabel, true)
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].count, 29)
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

test('number-only cluster is absorbed by its nearby named pole marker', () => {
  const marker = {
    key: 'cluster:CAM-01|JB-01',
    kind: 'cluster',
    point: { x: 240, y: 210 },
    count: 2,
    representativePole: null,
  }
  const poleGroup = {
    group: { id: 'pole-group:T-04' },
    point: { x: 203, y: 194 },
  }

  const result = attachClustersToPoleGroups([marker], [poleGroup])

  assert.equal(result.clusterGroupIds.get(marker.key), poleGroup.group.id)
  assert.equal(result.nearbyAssetCounts.get(poleGroup.group.id), 2)
})

test('cluster that already contains a pole keeps that pole as its representation', () => {
  const marker = {
    key: 'cluster:T-04|CAM-01',
    kind: 'cluster',
    point: { x: 203, y: 194 },
    count: 2,
    representativePole: { id: 'T-04', label: 'T-04' },
  }
  const result = attachClustersToPoleGroups([marker], [{
    group: { id: 'pole-group:T-99' },
    point: { x: 205, y: 195 },
  }])

  assert.equal(result.clusterGroupIds.has(marker.key), false)
  assert.equal(result.nearbyAssetCounts.size, 0)
})
