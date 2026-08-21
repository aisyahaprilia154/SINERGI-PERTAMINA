import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPathTopologyModel } from '../src/domain/path-topology-model.js'
import { createPathTopologyLayout } from '../src/pages/topology/path-topology-layout.js'
import { renderPathTopologySvg } from '../src/pages/topology/path-topology-renderer.js'

test('path renderer follows the reference composition and keeps all routes orthogonal', () => {
  const assets = [
    { id: 'core', name: 'JB RACK SERVER', type: 'Core server' },
    { id: 'pole', name: 'T-001', type: 'Tiang' },
    { id: 'jb', name: 'JB-001', type: 'Junction Box' },
    { id: 'cam', name: 'C-001', type: 'CCTV' },
  ]
  const model = buildPathTopologyModel({
    area: { key: 'pengapon', name: 'FT PENGAPON · SEMARANG' },
    assets,
    graph: {
      nodes: assets.map(({ id, type }) => ({ id, assetId: id, assetType: type })),
      edges: [{ id: 'e1', sourceAssetId: 'core', targetAssetId: 'pole', verificationStatus: 'confirmed' }],
    },
    mountingRelations: [
      { relationType: 'mounted_on', verificationStatus: 'confirmed', sourceAssetId: 'jb', targetAssetId: 'pole' },
      { relationType: 'mounted_on', verificationStatus: 'confirmed', sourceAssetId: 'cam', targetAssetId: 'pole' },
    ],
    unresolved: [{ sourceEndpointId: 'unresolved-1', sourcePathAssetId: 'path-1' }],
  })
  const layout = createPathTopologyLayout(model)
  const svg = renderPathTopologySvg(layout)

  assert.match(svg, /Diagram Topologi · FT PENGAPON/)
  assert.match(svg, /JALUR 01/)
  assert.match(svg, /JB EXTENDED · PERALATAN AKSES/)
  assert.match(svg, /PERANGKAT TERHUBUNG TANPA TIANG/)
  assert.match(svg, /ENDPOINT YANG BELUM TERPASANG/)
  assert.match(svg, /LAN · biru/)
  assert.match(svg, /Fiber optic · hijau/)
  layout.edges.forEach(({ points }) => points.slice(1).forEach((point, index) => {
    const previous = points[index]
    assert.ok(point.x === previous.x || point.y === previous.y)
  }))
  const rectangles = [
    layout.core,
    ...layout.lanes.flatMap(({ blocks }) => blocks),
    ...layout.extendedSection.blocks,
    ...layout.connectedSection.assets,
    ...layout.uninstalledSection.endpoints,
  ].filter(Boolean)
  rectangles.forEach((left, index) => rectangles.slice(index + 1).forEach((right) => {
    assert.equal(overlaps(left, right), false, `${left.id} overlaps ${right.id}`)
  }))
})

function overlaps(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y
}
