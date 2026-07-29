import assert from 'node:assert/strict'
import test from 'node:test'
import {
  renderTopologySvg,
  topologyNeighborList,
} from '../src/pages/topology/topology-renderer.js'

const viewModel = {
  nodes: [{
    id: 'A',
    name: 'Core A',
    type: 'Core switch',
    category: 'infrastructure',
    degree: 1,
  }, {
    id: 'B',
    name: 'Camera B',
    type: 'CCTV',
    category: 'cctv',
    degree: 1,
  }],
  edges: [{ id: 'edge-1', sourceId: 'A', targetId: 'B' }],
}

test('topology renderer exposes keyboard nodes and orthogonal edge sections', () => {
  const svg = renderTopologySvg({
    width: 420,
    height: 220,
    nodes: [{
      ...viewModel.nodes[0],
      x: 20,
      y: 50,
      width: 156,
      height: 70,
      selected: true,
    }, {
      ...viewModel.nodes[1],
      x: 240,
      y: 50,
      width: 156,
      height: 70,
    }],
    edges: [{
      ...viewModel.edges[0],
      sections: [{
        startPoint: { x: 176, y: 85 },
        bendPoints: [{ x: 208, y: 85 }, { x: 208, y: 85 }],
        endPoint: { x: 240, y: 85 },
      }],
    }],
  }, { labelMode: 'all' })

  assert.match(svg, /role="button"/)
  assert.match(svg, /data-node-id="A"/)
  assert.match(svg, /M 176 85 L 208 85 L 208 85 L 240 85/)
  assert.match(svg, /class="topology-node selected"/)
})

test('accessible topology neighbor list follows confirmed view edges', () => {
  const neighbors = topologyNeighborList(viewModel, 'A')
  assert.deepEqual(neighbors.map(({ id }) => id), ['B'])
})
