import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateSchematicLayout } from '../src/pages/map/schematic-layout.js'
import { renderSchematicSvg } from '../src/pages/map/schematic-svg.js'

const graph = {
  status: 'ready',
  mode: 'trace',
  title: 'Jalur koneksi CCTV',
  anchorAssetId: 'cam',
  nodes: [
    {
      id: 'cam',
      name: 'CCTV-GATE-01',
      shortName: 'CCTV-GATE-01',
      type: 'CCTV',
      category: 'cctv',
      location: 'Gerbang',
      ip: '10.42.3.31',
      status: 'Online',
      isAnchor: true,
      isConnector: false,
    },
    {
      id: 'jb',
      name: 'JB-CCTV-01',
      shortName: 'JB-CCTV-01',
      type: 'Junction box',
      category: 'cctv',
      location: 'Koridor',
      ip: '',
      status: 'Online',
      isAnchor: false,
      isConnector: true,
    },
  ],
  edges: [{
    id: 'cctv:cam:jb',
    sourceId: 'cam',
    targetId: 'jb',
    networkName: 'CCTV Ring',
    networkColor: '#9698f4',
    networkType: 'CCTV',
  }],
}

test('SVG renderer includes context, safe labels, confirmed edges, and schematic disclaimer', () => {
  const layout = calculateSchematicLayout(graph)
  const svg = renderSchematicSvg({
    graph,
    layout,
    context: {
      branchName: 'Kantor Cabang Semarang',
      version: 'v12',
    },
    selectedAssetId: 'cam',
  })

  assert.match(svg, /<svg/)
  assert.match(svg, /Jalur koneksi CCTV/)
  assert.match(svg, /Kantor Cabang Semarang/)
  assert.match(svg, /Dataset v12/)
  assert.match(svg, /data-asset-id="cam"/)
  assert.match(svg, /class="diagram-bg"/)
  assert.match(svg, /fill:#fff/)
  assert.match(svg, /fill:#172231/)
  assert.match(svg, /diagram-edge-underlay/)
  assert.match(svg, /class="node-card"/)
  assert.match(svg, /CCTV-GATE-01/)
  assert.match(svg, /CCTV Ring/)
  assert.match(svg, /confirmed/)
  assert.match(svg, /Diagram bersifat skematik dan tidak merepresentasikan skala geografis\./)
})
