import {adaptActiveDatasetForTopology} from '../adapters/active-dataset-map-adapter.js'
import {loadActiveDataset,loadTopologyProjection,loadTopologyRoots} from './active-dataset-service.js'

export async function loadTopologyDocument(requested,{signal}={}) {
    const payload = await loadActiveDataset({ ...requested, view: 'topology', signal })
    signal?.throwIfAborted()
    const mapData = adaptActiveDatasetForTopology(payload)
    mapData.recordRevision = payload.recordRevision
    mapData.topologyFrameNames = payload.topologyFrameNames ?? {}
    mapData.topologyFrameAssignments = payload.topologyFrameAssignments ?? {}
    mapData.topologyFrames = payload.topologyFrames ?? {}
    mapData.nodePositions = payload.nodePositions ?? {}

    const datasetVersionId = mapData.activeContext.datasetVersionId
    let graph = mapData.topologyGraph ?? { nodes: [], edges: [] }
    if (!hasGraph(graph)) {
      const graphPayload = await loadTopologyProjection({
        datasetVersionId,datasetId:mapData.activeContext.datasetId,
        projection: 'graph', signal,
      }).catch(() => null)
      signal?.throwIfAborted()
      graph = graphFromPayload(graphPayload, graph)
    }

    const rootsPayload = Array.isArray(payload.topologyRoots)
      ? { roots: payload.topologyRoots }
      : graph.graphRevision
      ? await loadTopologyRoots({
        datasetVersionId,datasetId:mapData.activeContext.datasetId,
        graphRevision: graph.graphRevision, signal,
      }).catch(() => null)
      : null

    signal?.throwIfAborted()
    return {mapData,graph,roots:rootsPayload?.roots ?? rootsPayload?.items ?? []}
}

function graphFromPayload(payload, fallback) {
  const graph = payload?.graph ?? payload
  return hasGraph(graph) ? graph : fallback
}

function hasGraph(graph) {
  return Array.isArray(graph?.nodes) && Array.isArray(graph?.edges)
    && (graph.nodes.length > 0 || graph.edges.length > 0)
}
