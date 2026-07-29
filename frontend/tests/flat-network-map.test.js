import assert from 'node:assert/strict'
import test from 'node:test'
import { renderFlatNetworkSvg } from '../src/pages/map/flat-network-map.js'

test('flat network map renders clickable assets, physical cables, and candidate links', () => {
  const assets = [{
    id: 'camera-1',
    name: 'CAM-01',
    type: 'CCTV',
    x: .25,
    y: .4,
    networkIds: ['network:cctv'],
  }]
  const cable = {
    id: 'cable-geometry-1',
    assetId: 'cable-1',
    geometryType: 'line_string',
    category: 'LAN',
    coordinates: [[110, -7], [110.1, -7.1]],
    displayCoordinates: [{ x: .25, y: .4 }, { x: .7, y: .65 }],
  }
  const networks = [{
    id: 'network:cctv',
    name: 'Jaringan CCTV',
    type: 'CCTV',
    color: '#55aaff',
    geometryIds: ['cable-geometry-1'],
  }]
  const svg = renderFlatNetworkSvg({
    assets,
    diagramAssets: [...assets, { id: 'cable-1', name: 'UTP-01', type: 'LAN' }],
    networks,
    geometries: [cable],
    candidates: [{
      candidateId: 'candidate-1',
      candidateStatus: 'candidate',
      score: .91,
      sourceCoordinate: [110, -7],
      targetCoordinate: [110.1, -7.1],
    }],
    state: {
      selectedNetworkIds: new Set(['network:cctv']),
      selectedAssetId: null,
      traceNodeIds: [],
      connectedNodeIds: [],
      dimOthers: true,
      highlightedNetworkId: null,
      zoom: 1,
      panX: 0,
      panY: 0,
    },
  })

  assert.match(svg, /data-flat-asset="camera-1"/)
  assert.match(svg, /data-flat-network="network:cctv"/)
  assert.match(svg, /data-flat-candidate="candidate-1"/)
  assert.match(svg, /UTP-01/)
  assert.match(svg, /CAM-01/)
})
