import assert from 'node:assert/strict'
import test from 'node:test'
import { auditTopologyDiagram } from '../src/domain/topology-diagram-audit.js'

test('diagram audit reports visual lines and pole members absent from stored relations', () => {
  const model = { edges: [{ id: 'stored', sourceId: 'jb-11', targetId: 'jb-11.1' }] }
  const layout = {
    edges: [{ id: 'visual', sourceId: 'jb-11', targetId: 'camera' }],
    nodes: [{ id: 'jb-11' }, { id: 'jb-11.1' }],
    mountingBoxes: [{ id: 'pole-group:t-2', hostId: 't-2',
      nodeIds: ['jb-11', 'jb-11.1'] }],
  }
  const report = auditTopologyDiagram({ model, layout, mountingRelations: [
    { sourceAssetId: 'jb-11', targetAssetId: 't-2' },
    { sourceAssetId: 'jb-11.1', targetAssetId: 't-1' },
  ] })
  assert.deepEqual(report.issues.map(issue => issue.code), [
    'visual_edge_without_relation', 'relation_not_drawn', 'pole_frame_without_mounting',
    'mounting_not_in_pole_frame',
  ])
  assert.equal(report.issues[2].assetId, 'jb-11.1')
})
