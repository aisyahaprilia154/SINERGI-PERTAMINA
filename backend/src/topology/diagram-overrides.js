import { filterRemovedDiagramEdges } from '../../../shared/topology-edge-overrides.mjs'
import { withTopologyGraphRevision } from './topology-graph-revision.js'

export function applyDiagramOverrides(record) {
  if (!record?.topologyEdgeOverrides?.length || !record.topologyGraph) return record
  const graph = record.topologyGraph
  const edges = filterRemovedDiagramEdges(graph.edges, record.topologyEdgeOverrides)
  if (edges.length === graph.edges.length) return record
  const degreeByNode = Object.fromEntries(graph.nodes.map(node => [node.id, 0]))
  for (const edge of edges) {
    for (const id of [edge.sourceAssetId ?? edge.sourceNodeId, edge.targetAssetId ?? edge.targetNodeId]) {
      degreeByNode[id] = (degreeByNode[id] ?? 0) + 1
    }
  }
  return { ...record,
    relations: filterRemovedDiagramEdges(record.relations, record.topologyEdgeOverrides),
    confirmedRelations: filterRemovedDiagramEdges(record.confirmedRelations, record.topologyEdgeOverrides),
    topologyGraph: withTopologyGraphRevision({ ...graph, edges, components: [], degreeByNode,
      isolatedNodeIds: Object.keys(degreeByNode).filter(id => degreeByNode[id] === 0) }),
  }
}
