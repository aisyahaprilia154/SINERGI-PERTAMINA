import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { projectFacilityRecord } from '../src/topology/facility-record-projection.js'
import { adaptActiveDatasetForTopology } from '../../frontend/src/adapters/active-dataset-map-adapter.js'
import { buildTopologyDiagramModel } from '../../frontend/src/domain/topology-diagram-model.js'
import { buildPoleGroups } from '../../frontend/src/domain/pole-groups.js'
import { auditTopologyDiagram } from '../../frontend/src/domain/topology-diagram-audit.js'
import { calculateTopologyDiagramLayout } from '../../frontend/src/pages/topology/topology-diagram-layout.js'

const input = process.argv[2]
if (!input) {
  process.stderr.write('Usage: node scripts/audit-topology-diagram.mjs <dataset-version.json>\n')
  process.exitCode = 2
} else {
  const stored = JSON.parse(await readFile(resolve(input), 'utf8'))
  const record = projectFacilityRecord(stored)
  const storedPairs = new Set((stored.topologyGraph?.edges ?? []).map(edge =>
    [edge.sourceAssetId ?? edge.sourceNodeId, edge.targetAssetId ?? edge.targetNodeId]
      .sort().join('\u0000')))
  const projectionIssues = (record.topologyGraph?.edges ?? []).flatMap(edge => {
    const pair = [edge.sourceAssetId ?? edge.sourceNodeId,
      edge.targetAssetId ?? edge.targetNodeId].sort().join('\u0000')
    return storedPairs.has(pair) ? [] : [{ code: 'projected_edge_not_stored',
      edgeId: edge.id ?? null, sourceAssetId: edge.sourceAssetId ?? edge.sourceNodeId,
      targetAssetId: edge.targetAssetId ?? edge.targetNodeId }]
  })
  const storedMounts = new Set((stored.mountingRelations ?? []).map(item =>
    `${item.sourceAssetId}\u0000${item.targetAssetId}`))
  projectionIssues.push(...(record.mountingRelations ?? []).flatMap(item =>
    storedMounts.has(`${item.sourceAssetId}\u0000${item.targetAssetId}`)
      ? [] : [{ code: 'projected_mounting_not_stored',
        assetId: item.sourceAssetId, poleAssetId: item.targetAssetId }]))
  const payload = { ...record, datasetVersion: record.datasetVersion }
  const data = adaptActiveDatasetForTopology(payload)
  const poleGroups = buildPoleGroups({ assets: data.assets,
    mountingRelations: data.mountingRelations })
  const areas = data.locationGroups.map(item => item.key)
  const reports = areas.map(area => {
    const model = buildTopologyDiagramModel({ assets: data.assets,
      graph: data.topologyGraph, mountingRelations: data.mountingRelations,
      poleGroups, locationGroups: data.locationGroups, area,
      branchId: record.datasetVersion.branchId,
      datasetVersionId: record.datasetVersion.id })
    const layout = calculateTopologyDiagramLayout(model, {
      layoutStyle: 'central-backbone', overview: false,
      frameAssignments: data.topologyFrameAssignments,
      customFrames: data.topologyFrames,
    })
    return { area, ...auditTopologyDiagram({ model, layout,
      mountingRelations: data.mountingRelations }) }
  })
  process.stdout.write(`${JSON.stringify({ datasetVersionId: record.datasetVersion.id,
    projectionIssues, reports }, null, 2)}\n`)
}
