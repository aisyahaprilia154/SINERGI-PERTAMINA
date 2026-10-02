import { buildAssetIdentityMapFromRecord, createAssetIdentityResolver } from './canonical-asset-identity.js'
import { projectFacilityRecord } from '../topology/facility-record-projection.js'
import { withTopologyGraphRevision } from '../topology/topology-graph-revision.js'
import { filterConflictingCameraEdges } from '../topology/device-edge-policy.js'
import { MOUNTING_RELATION_TYPE } from '../topology/mounting-relations.js'
import { FACILITY_CORRECTION_VERSION } from '../../../shared/facility-corrections.mjs'

export const ACTIVE_TOPOLOGY_PROJECTION_VERSION = 'active-topology/1:' + FACILITY_CORRECTION_VERSION

// Canonicalize, correct and hash while materializing the database read model.
// Reads can reuse this verified graph without hashing the engine archive again.
export function prepareActiveTopologyRecord(record) {
  const { activeTopologyProjection, ...source } = record
  const projected = projectFacilityRecord(source)
  const topology = normalizeTopologyGraph(projected, buildAssetIdentityMapFromRecord(projected))
  return { ...projected, topologyGraph: topology.graph,
    activeTopologyProjection: { version: ACTIVE_TOPOLOGY_PROJECTION_VERSION, identity: topology.identity } }
}

export function normalizeTopologyGraph(record, identityMap) {
  if (record.activeTopologyProjection?.version === ACTIVE_TOPOLOGY_PROJECTION_VERSION) {
    return { graph: record.topologyGraph, identity: record.activeTopologyProjection.identity }
  }
  const resolver = createAssetIdentityResolver(identityMap)
  const sourceGraph = record.topologyGraph ?? {
    datasetVersionId: record.datasetVersion?.id,
    nodes: (record.assets ?? []).map((asset) => ({
      id: asset.canonicalAssetId ?? asset.assetId ?? asset.id,
      assetId: asset.canonicalAssetId ?? asset.assetId ?? asset.id,
      sourceFeatureId: asset.sourceFeatureId ?? asset.properties?.sourceFeatureId,
    })),
    edges: (record.confirmedRelations ?? []).map((relation) => ({
      ...relation,
      sourceNodeId: relation.sourceAssetId,
      targetNodeId: relation.targetAssetId,
    })),
    components: [],
    degreeByNode: {},
    isolatedNodeIds: [],
  }
  const unresolvedNodes = []
  const nodes = []
  const canonicalNodeIds = new Set()
  const originalNodeToCanonical = new Map()
  ;(sourceGraph.nodes ?? []).forEach((node) => {
    const originalId = node.canonicalAssetId ?? node.assetId ?? node.id
    const canonicalAssetId = resolver.resolve(originalId)
    if (!canonicalAssetId) {
      unresolvedNodes.push(originalId ?? null)
      return
    }
    if (canonicalNodeIds.has(canonicalAssetId)) {
      unresolvedNodes.push(originalId)
      return
    }
    canonicalNodeIds.add(canonicalAssetId)
    originalNodeToCanonical.set(originalId, canonicalAssetId)
    nodes.push({
      ...node,
      id: canonicalAssetId,
      canonicalAssetId,
      assetId: canonicalAssetId,
      sourceNodeId: originalId,
    })
  })

  const unresolvedEdges = []
  let edges = []
  ;(sourceGraph.edges ?? []).forEach((edge) => {
    if (edge?.relationType === MOUNTING_RELATION_TYPE) return
    const originalSource = edge.sourceAssetId ?? edge.sourceNodeId
    const originalTarget = edge.targetAssetId ?? edge.targetNodeId
    const sourceAssetId = resolver.resolve(originalSource)
      ?? originalNodeToCanonical.get(originalSource)
    const targetAssetId = resolver.resolve(originalTarget)
      ?? originalNodeToCanonical.get(originalTarget)
    if (!sourceAssetId || !targetAssetId
      || !canonicalNodeIds.has(sourceAssetId)
      || !canonicalNodeIds.has(targetAssetId)
      || sourceAssetId === targetAssetId) {
      unresolvedEdges.push({
        edgeId: edge.id ?? null,
        sourceAssetId: originalSource ?? null,
        targetAssetId: originalTarget ?? null,
      })
      return
    }
    edges.push({
      ...edge,
      sourceAssetId,
      targetAssetId,
      sourceNodeId: sourceAssetId,
      targetNodeId: targetAssetId,
      canonicalSourceAssetId: sourceAssetId,
      canonicalTargetAssetId: targetAssetId,
    })
  })
  edges = filterConflictingCameraEdges(edges, nodes).edges

  const degreeByNode = Object.fromEntries(nodes.map(({ id }) => [id, 0]))
  edges.forEach((edge) => {
    degreeByNode[edge.sourceAssetId] += 1
    degreeByNode[edge.targetAssetId] += 1
  })
  const components = normalizeComponents(
    sourceGraph.components,
    resolver,
    canonicalNodeIds,
    edges,
  )
  const graph = withTopologyGraphRevision({
      ...sourceGraph,
      datasetVersionId: record.datasetVersion?.id ?? sourceGraph.datasetVersionId,
      nodes,
      edges,
      components,
      degreeByNode,
      isolatedNodeIds: nodes
        .filter(({ id }) => degreeByNode[id] === 0)
        .map(({ id }) => id)
        .sort(),
    })
  return {
    graph,
    identity: {
      version: identityMap.version,
      migratedFromLegacyRecord: identityMap.migratedFromLegacyRecord === true,
      sourceNodeCount: (sourceGraph.nodes ?? []).length,
      resolvedNodeCount: nodes.length,
      unresolvedNodeCount: unresolvedNodes.length,
      sourceEdgeCount: (sourceGraph.edges ?? []).length,
      resolvedEdgeCount: edges.length,
      unresolvedEdgeCount: unresolvedEdges.length,
      unresolvedNodes: unresolvedNodes.slice(0, 25),
      unresolvedEdges: unresolvedEdges.slice(0, 25),
    },
  }
}

function normalizeComponents(sourceComponents, resolver, canonicalNodeIds, edges) {
  const components = (sourceComponents ?? []).map((component, index) => ({
    ...structuredClone(component),
    componentId: component.componentId ?? component.id ?? `component:${index + 1}`,
    nodeIds: [...new Set((component.nodeIds ?? [])
      .map((id) => resolver.resolve(id))
      .filter((id) => canonicalNodeIds.has(id)))].sort(),
    edgeIds: (component.edgeIds ?? [])
      .filter((edgeId) => edges.some((edge) => edge.id === edgeId))
      .sort(),
  })).filter(({ nodeIds }) => nodeIds.length)
  if (components.length) return components
  return connectedComponents(canonicalNodeIds, edges)
}

function connectedComponents(nodeIds, edges) {
  const adjacency = new Map([...nodeIds].map((id) => [id, []]))
  edges.forEach((edge) => {
    adjacency.get(edge.sourceAssetId)?.push(edge.targetAssetId)
    adjacency.get(edge.targetAssetId)?.push(edge.sourceAssetId)
  })
  const visited = new Set()
  const components = []
  ;[...nodeIds].sort().forEach((start) => {
    if (visited.has(start)) return
    const queue = [start]
    const componentNodes = []
    const componentNodeSet = new Set()
    while (queue.length) {
      const current = queue.shift()
      if (visited.has(current)) continue
      visited.add(current)
      componentNodeSet.add(current)
      componentNodes.push(current)
      ;(adjacency.get(current) ?? []).forEach((next) => {
        if (!visited.has(next)) queue.push(next)
      })
    }
    components.push({
      componentId: `component:${components.length + 1}`,
      nodeIds: componentNodes.sort(),
      edgeIds: edges.filter((edge) => (
        componentNodeSet.has(edge.sourceAssetId)
          && componentNodeSet.has(edge.targetAssetId)
      )).map(({ id }) => id).filter(Boolean).sort(),
    })
  })
  return components
}
