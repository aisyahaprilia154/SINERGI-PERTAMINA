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

test('SVG renderer uses the preloaded source icon from the KMZ style when available', () => {
  const iconUrl = '/api/dataset-versions/version-1/source-resources/resource-camera'
  const iconGraph = {
    status: 'ready',
    mode: 'selected',
    title: 'Relasi kamera',
    anchorAssetId: 'cam',
    nodes: [{
      id: 'cam',
      name: 'C-001',
      type: 'CCTV',
      category: 'cctv',
      sourceIconUrl: iconUrl,
      isAnchor: true,
    }],
    edges: [],
  }
  const layout = calculateSchematicLayout(iconGraph)
  const svg = renderSchematicSvg({
    graph: iconGraph,
    layout,
    context: { branchName: 'Semarang', version: 'v14' },
    sourceIconDataByUrl: new Map([[iconUrl, 'data:image/png;base64,Y2FtZXJh']]),
  })

  assert.match(svg, /class="node-source-icon"/)
  assert.match(svg, /data:image\/png;base64,Y2FtZXJh/)
})

test('SVG renderer draws a neutral physical mounting group around its assets', () => {
  const groupedGraph = {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: 'pole',
        name: 'Tiang-01',
        shortName: 'Tiang-01',
        type: 'Tiang',
        category: 'infrastructure',
        location: 'Gerbang',
        isAnchor: false,
        isConnector: false,
      },
    ],
    poleGroups: [{
      id: 'pole-group:pole',
      poleAssetId: 'pole',
      pole: { id: 'pole', name: 'Tiang-01' },
      assetIds: ['pole', 'cam'],
    }],
  }
  const layout = calculateSchematicLayout(groupedGraph)
  const svg = renderSchematicSvg({
    graph: groupedGraph,
    layout,
    context: { branchName: 'Semarang', version: 'v14' },
  })

  assert.match(svg, /diagram-pole-groups/)
  assert.match(svg, /data-pole-group-id="pole-group:pole"/)
  assert.match(svg, /Tiang-01/)
  assert.match(svg, /relasi pemasangan fisik/)
})

test('SVG renderer can collapse a physical group and reroute its visible edge endpoint', () => {
  const groupedGraph = {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: 'pole',
        name: 'Tiang-01',
        shortName: 'Tiang-01',
        type: 'Tiang',
        category: 'infrastructure',
        location: 'Gerbang',
        isAnchor: false,
        isConnector: false,
      },
    ],
    poleGroups: [{
      id: 'pole-group:pole',
      poleAssetId: 'pole',
      pole: { id: 'pole', name: 'Tiang-01' },
      assetIds: ['pole', 'cam'],
    }],
  }
  const layout = calculateSchematicLayout(groupedGraph)
  const svg = renderSchematicSvg({
    graph: groupedGraph,
    layout,
    context: { branchName: 'Semarang', version: 'v14' },
    collapsedPoleGroupIds: new Set(['pole-group:pole']),
  })

  assert.match(svg, /data-pole-group-toggle="pole-group:pole"/)
  assert.match(svg, /aria-expanded="false"/)
  assert.doesNotMatch(svg, /data-asset-id="cam"/)
  assert.match(svg, /data-edge-id="cctv:cam:jb"/)
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

test('all-assets SVG renders every asset on one canvas with evidence status', () => {
  const allAssetsGraph = {
    status: 'ready',
    mode: 'all-assets',
    title: 'Seluruh aset',
    anchorAssetId: 'jb-1',
    relationCount: 1,
    nodes: [
      { id: 'jb-1', name: 'JB-001', type: 'Junction Box', category: 'cctv', resolutionStatus: 'confirmed' },
      { id: 'cam-1', name: 'C-001', type: 'CCTV', category: 'cctv', resolutionStatus: 'confirmed' },
      { id: 'recommendation-1', name: 'T-001', type: 'Rekomendasi', category: 'infrastructure', resolutionStatus: 'review' },
      { id: 'fo-recommendation-1', name: 'FO-001', type: 'FO Rekomendasi', category: 'fiber-optic', resolutionStatus: 'unresolved' },
    ],
    edges: [{
      id: 'jb-cam',
      sourceId: 'jb-1',
      targetId: 'cam-1',
      networkName: 'CCTV',
      networkColor: '#9698f4',
      relationStatus: 'confirmed',
    }],
  }
  const layout = calculateSchematicLayout(allAssetsGraph)
  const svg = renderSchematicSvg({
    graph: allAssetsGraph,
    layout,
    context: { branchName: 'Semarang', version: 'v13' },
  })

  assert.match(svg, /Seluruh aset · 4/)
  assert.match(svg, /100% tercakup/)
  assert.match(svg, /2 aset terhubung · 2 aset tanpa relasi · 1 komponen/)
  assert.match(svg, /KOMPONEN TERHUBUNG/)
  assert.match(svg, /ASET TANPA RELASI/)
  assert.match(svg, /Rekomendasi/)
  assert.match(svg, /FO Rekomendasi/)
  assert.match(svg, /resolution-review/)
  assert.match(svg, /resolution-unresolved/)
  assert.equal((svg.match(/class="diagram-node compact/g) || []).length, 2)
})
