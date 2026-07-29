import assert from 'node:assert/strict'
import test from 'node:test'
import {
  renderSpatialTopologySvg,
} from '../src/pages/topology/topology-renderer.js'
import {
  createSpatialTopologyLayout,
} from '../src/pages/topology/topology-spatial-layout.js'

const sourceFeatures = [{
  sourceFeatureId: 'feature-a',
  sourceName: 'Core Switch',
  sourceFolderPath: '/Network/LAN/Devices',
}, {
  sourceFeatureId: 'feature-b',
  sourceName: 'Access Switch',
  sourceFolderPath: '/Network/LAN/Devices',
}, {
  sourceFeatureId: 'feature-line',
  sourceName: 'LAN Backbone',
  sourceFolderPath: '/Network/LAN/Cable',
}]

const sourceGeometries = [{
  geometryId: 'point-a',
  sourceFeatureId: 'feature-a',
  geometryType: 'Point',
  coordinates: [110, -7],
  valid: true,
}, {
  geometryId: 'point-b',
  sourceFeatureId: 'feature-b',
  geometryType: 'Point',
  coordinates: [110.01, -7.005],
  valid: true,
}, {
  geometryId: 'line-a',
  sourceFeatureId: 'feature-line',
  geometryType: 'LineString',
  coordinates: [[110, -7], [110.005, -7.002], [110.01, -7.005]],
  valid: true,
}]

const graph = {
  nodes: [{
    id: 'node-a',
    sourceFeatureId: 'feature-a',
    networkFamily: 'lan',
    assetType: 'core switch',
  }, {
    id: 'node-b',
    sourceFeatureId: 'feature-b',
    networkFamily: 'lan',
    assetType: 'access switch',
  }],
  edges: [{
    id: 'edge-a',
    sourceAssetId: 'node-a',
    targetAssetId: 'node-b',
    sourceGeometryIds: ['line-a'],
    verificationStatus: 'confirmed',
  }],
  degreeByNode: { 'node-a': 1, 'node-b': 1 },
}

const candidates = [{
  candidateId: 'candidate-a',
  sourceFeatureId: 'feature-line',
  targetFeatureId: 'feature-b',
  sourcePathAssetId: 'path-a',
  targetAssetId: 'node-b',
  sourceCoordinate: [110, -7],
  targetCoordinate: [110.01, -7.005],
  candidateStatus: 'candidate',
  networkFamily: 'lan',
  score: 0.91,
}]

test('spatial topology keeps source vertices and node positions on one Mercator projection', () => {
  const originalCoordinates = structuredClone(sourceGeometries[2].coordinates)
  const layout = createSpatialTopologyLayout({
    sourceFeatures,
    sourceGeometries,
    graph,
    candidates,
    unresolved: [{
      sourceEndpointId: 'endpoint-open',
      sourceGeometryId: 'line-a',
      sourcePathAssetId: 'path-a',
      coordinate: [110.005, -7.002],
      reason: 'no_eligible_candidate',
    }],
  })

  assert.deepEqual(sourceGeometries[2].coordinates, originalCoordinates)
  assert.equal(layout.paths[0].confirmed, true)
  assert.equal(layout.paths[0].points.length, 3)
  assert.equal(layout.paths[0].points[0].x, layout.nodes[0].x)
  assert.equal(layout.paths[0].points[0].y, layout.nodes[0].y)
  assert.equal(layout.paths[0].points.at(-1).x, layout.nodes[1].x)
  assert.equal(layout.paths[0].points.at(-1).y, layout.nodes[1].y)
  assert.equal(layout.candidates[0].source.x, layout.nodes[0].x)
  assert.equal(layout.candidates[0].target.y, layout.nodes[1].y)
  assert.equal(layout.unresolved.length, 1)
})

test('spatial renderer distinguishes source lines, review candidates, and unresolved endpoints', () => {
  const layout = createSpatialTopologyLayout({
    sourceFeatures,
    sourceGeometries,
    graph,
    candidates,
    unresolved: [{
      sourceEndpointId: 'endpoint-open',
      sourceGeometryId: 'line-a',
      sourcePathAssetId: 'path-a',
      coordinate: [110.005, -7.002],
      reason: 'no_eligible_candidate',
    }],
  })
  const svg = renderSpatialTopologySvg(layout, {
    labelMode: 'all',
    showCandidates: true,
    showUnresolved: true,
  })

  assert.match(svg, /data-source-path-id="line-a"/)
  assert.match(svg, /data-node-id="node-a"/)
  assert.match(svg, /data-candidate-id="candidate-a"/)
  assert.match(svg, /data-unresolved-id="endpoint-open"/)
  assert.match(svg, /source-path-casing\{stroke:#07111c;stroke-width:7\}/)
  assert.match(svg, /candidate-line\{stroke-width:2\.5;stroke-dasharray:7 5\}/)
  assert.match(svg, /posisi tidak diubah/)
})
