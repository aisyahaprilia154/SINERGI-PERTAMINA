import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateSchematicLayout } from '../src/pages/map/schematic-layout.js'
import {
  createSchematicExportFilename,
  createSchematicMultiPageArchive,
  serializeSchematicSvgMarkup,
  validateStandaloneSvgMarkup,
} from '../src/pages/map/schematic-export.js'
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
    relationSource: 'explicit',
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
      exportedAt: '2026-07-29T08:00:00.000Z',
    },
    selectedAssetId: 'cam',
  })

  assert.match(svg, /<svg/)
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /<style>/)
  assert.match(svg, /Jalur koneksi CCTV/)
  assert.match(svg, /Kantor Cabang Semarang/)
  assert.match(svg, /Dataset v12/)
  assert.match(svg, /data-asset-id="cam"/)
  assert.match(svg, /class="diagram-bg"/)
  assert.match(svg, /fill:#f8fafc/)
  assert.match(svg, /fill:#172231/)
  assert.match(svg, /diagram-edge-underlay/)
  assert.match(svg, /class="node-ring"/)
  assert.match(svg, /10\.42\.3\.31/)
  assert.match(svg, /CCTV-GATE-01/)
  assert.match(svg, /CCTV Ring/)
  assert.match(svg, />JALUR</)
  assert.match(svg, /1 koneksi/)
  assert.match(svg, /Diexport 2026-07-29 08:00:00 UTC/)
  assert.match(svg, /Diagram skematik\. Posisi aset telah disederhanakan dan tidak menunjukkan skala geografis\./)
  assert.doesNotMatch(svg, /<foreignObject/i)
})

test('overview SVG renders aggregate counts and drill-down targets without asset labels', () => {
  const overviewGraph = {
    status: 'ready',
    mode: 'overview',
    title: 'Overview jaringan',
    representedAssetCount: 449,
    nodes: [{
      id: 'group:network:cctv',
      name: 'CCTV',
      shortName: '320 aset',
      type: 'CCTV',
      category: 'cctv',
      location: '12 layer',
      isGroup: true,
      isConnector: true,
      isAnchor: true,
      memberCount: 320,
      detailScopeKey: 'network:network:cctv',
    }],
    edges: [],
  }
  const layout = calculateSchematicLayout(overviewGraph)
  const svg = renderSchematicSvg({
    graph: overviewGraph,
    layout,
    context: {
      branchName: 'Kantor Cabang Semarang',
      version: 'v12',
    },
  })

  assert.match(svg, /1 kelompok · 449 aset/)
  assert.match(svg, /data-detail-scope="network:network:cctv"/)
  assert.match(svg, />CCTV</)
  assert.match(svg, />320 aset · 0 koneksi · 0 line</)
  assert.match(svg, /0 tanpa relasi · 0 komponen/)
  assert.doesNotMatch(svg, /data-asset-id=/)
})

test('virtual junction uses a small non-inventory SVG symbol', () => {
  const virtualGraph = {
    ...graph,
    mode: 'network',
    nodes: [
      graph.nodes[0],
      {
        id: 'virtual-junction:fixture',
        name: 'Junction topologi internal',
        type: 'Virtual junction',
        category: 'infrastructure',
        isVirtual: true,
        isConnector: true,
      },
      graph.nodes[1],
    ],
    edges: [
      {
        ...graph.edges[0],
        id: 'edge-virtual-a',
        targetId: 'virtual-junction:fixture',
        relationSource: 'inferred_intersection',
      },
      {
        ...graph.edges[0],
        id: 'edge-virtual-b',
        sourceId: 'virtual-junction:fixture',
        targetId: 'jb',
        relationSource: 'inferred_intersection',
      },
    ],
  }
  const layout = calculateSchematicLayout(virtualGraph)
  const svg = renderSchematicSvg({
    graph: virtualGraph,
    layout,
    context: { branchName: 'Pengapon', version: 'doc' },
  })

  assert.match(svg, /data-virtual-junction-id="virtual-junction:fixture"/)
  assert.match(svg, /class="virtual-junction"/)
  assert.match(svg, /2 aset \+ 1 junction internal/)
  assert.match(svg, /2 aset dan 1 junction internal/)
  assert.doesNotMatch(svg, /data-asset-id="virtual-junction:fixture"/)
  assert.match(svg, /diagram-edge\s+inferred/)
})

test('pending KMZ topology is labelled as a candidate instead of a confirmed relation', () => {
  const pendingGraph = {
    ...graph,
    mode: 'network',
    edges: [{
      ...graph.edges[0],
      relationSource: 'inferred_point_on_line',
      relationStatus: 'inferred_pending',
    }],
  }
  const svg = renderSchematicSvg({
    graph: pendingGraph,
    layout: calculateSchematicLayout(pendingGraph),
    context: { siteScopeName: 'Pengapon', version: 'doc' },
  })

  assert.match(svg, /Kandidat relasi dari geometri, menunggu konfirmasi Administrator/)
  assert.doesNotMatch(svg, /Relasi terkonfirmasi dari geometri/)
})

test('multi-page SVG export is one ZIP containing overview, standalone pages, and indexes', async () => {
  const layout = calculateSchematicLayout(graph)
  const context = {
    branchName: 'Kantor Cabang Semarang',
    version: 'v12',
    exportedAt: '2026-07-29T08:00:00.000Z',
  }
  const svg = renderSchematicSvg({ graph, layout, context })
  const archive = await createSchematicMultiPageArchive({
    pages: [{
      title: graph.title,
      nodeCount: graph.nodes.length,
      connectionCount: graph.edges.length,
      svg,
    }],
    overviewSvg: svg,
    context,
    format: 'svg',
    scope: 'Jalur tracing aktif',
  })
  const text = new TextDecoder().decode(await archive.arrayBuffer())

  assert.equal(archive.type, 'application/zip')
  assert.match(text, /overview\.svg/)
  assert.match(text, /pages\/diagram-01\.svg/)
  assert.match(text, /index\.json/)
  assert.match(text, /index\.html/)
  assert.match(text, /Jalur tracing aktif/)
  assert.match(text, /"site": "Kantor Cabang Semarang"/)
  assert.match(text, /"nodeCount": 2/)
  assert.match(text, /"edgeCount": 1/)
  assert.match(text, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
})

test('standalone SVG keeps internal style, viewBox, text, and escaped special characters', () => {
  const specialGraph = {
    ...graph,
    title: 'CCTV & <Core> "Pengapon"',
  }
  const layout = calculateSchematicLayout(specialGraph)
  const svg = renderSchematicSvg({
    graph: specialGraph,
    layout,
    context: {
      siteScopeName: 'Pengapon & Area',
      branchId: 'semarang',
      version: 'v2.4.0',
      exportedAt: '2026-07-29T08:00:00.000Z',
    },
  })
  const standalone = serializeSchematicSvgMarkup(svg)

  assert.equal(validateStandaloneSvgMarkup(standalone), standalone)
  assert.match(standalone, /^<\?xml/)
  assert.match(standalone, /viewBox="0 0 \d+ \d+"/)
  assert.match(standalone, /<style>/)
  assert.match(standalone, /<text/)
  assert.match(standalone, /CCTV &amp; &lt;Core&gt; &quot;Pengapon&quot;/)
  assert.doesNotMatch(standalone, /<link|@import|foreignObject/i)
})

test('standalone SVG rejects external resources and filenames are deterministic', () => {
  assert.throws(() => validateStandaloneSvgMarkup(`<?xml version="1.0"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <style>@import url(https://example.test/style.css);</style>
      <text>Unsafe</text>
    </svg>`), /resource eksternal/)
  assert.equal(createSchematicExportFilename({
    siteName: 'Pengapon',
    scope: 'CCTV Trace',
    version: 'v2.4.0',
    exportedAt: '2026-07-29T08:00:00.000Z',
  }), 'SINERGI_Pengapon_CCTV-Trace_v2.4.0_2026-07-29')
})

test('multi-page archive refuses an individual page above 100 nodes', async () => {
  await assert.rejects(createSchematicMultiPageArchive({
    pages: [{
      title: 'Terlalu besar',
      nodeCount: 101,
      connectionCount: 100,
      svg: '<svg/>',
    }],
  }), /lebih dari 100 node/)
})
