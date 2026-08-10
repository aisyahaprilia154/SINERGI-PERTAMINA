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

test('SVG renderer includes context, asset identity, legend, and schematic disclaimer', () => {
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
  assert.match(svg, /fill:#f8fafc/)
  assert.match(svg, /fill:#172231/)
  assert.match(svg, /diagram-edge-underlay/)
  assert.match(svg, /diagram-category-sections/)
  assert.match(svg, /class="node-ring"/)
  assert.match(svg, /10\.42\.3\.31/)
  assert.match(svg, /CCTV-GATE-01/)
  assert.match(svg, /CCTV Ring/)
  assert.match(svg, />JALUR</)
  assert.match(svg, /Diagram skematik mengikuti posisi relatif tampilan peta dan tidak menunjukkan skala geografis\./)
})

test('SVG renderer draws every selected node and confirmed edge without clipping', () => {
  const selectedGraph = {
    status: 'ready',
    mode: 'selected',
    title: 'Relasi JB-008-exp',
    anchorAssetId: 'focus',
    nodes: [
      { id: 'focus', name: 'JB-008-exp', type: 'Junction Box', category: 'cctv', isAnchor: true },
      { id: 'neighbor', name: 'JB-00X-exp', type: 'Junction Box', category: 'cctv', isAnchor: false },
    ],
    edges: [{
      id: 'focus-neighbor',
      sourceId: 'focus',
      targetId: 'neighbor',
      networkName: 'Relasi terkonfirmasi',
      networkColor: '#64748b',
    }],
  }
  const layout = calculateSchematicLayout(selectedGraph)
  const svg = renderSchematicSvg({
    graph: selectedGraph,
    layout,
    context: { branchName: 'Semarang', version: 'doc · 29 Jul 2026' },
    selectedAssetId: 'focus',
  })

  assert.equal((svg.match(/<g class="diagram-node(?: |\")/g) || []).length, 2)
  assert.equal((svg.match(/data-edge-id="focus-neighbor"/g) || []).length, 1)
  assert.match(svg, /JB-008-exp/)
  assert.match(svg, /JB-00X-exp/)
  assert.match(svg, />Junction Box</)
  assert.doesNotMatch(svg, />CCTV</)
})
