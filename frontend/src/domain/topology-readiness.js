export const TOPOLOGY_NOT_READY_MESSAGE =
  'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.'

export function resolveTopologyReadiness({
  topologyReadiness = null,
  readiness = null,
  readinessContract = null,
  topologyGraph = null,
} = {}) {
  const status = readinessContract?.topologyReady
    ?? topologyReadiness?.topologyReadiness
    ?? readiness?.topologyReadiness
    ?? null
  const graphEdgeCount = Array.isArray(topologyGraph?.edges)
    ? topologyGraph.edges.length
    : 0
  const graphAvailable = graphEdgeCount > 0
  const normalizedStatus = status === true
    ? 'ready'
    : status === false
      ? 'not_ready'
      : status
  const ready = normalizedStatus === null
    ? graphAvailable
    : normalizedStatus === 'ready' && graphAvailable
  return {
    status: ready ? 'ready' : 'not_ready',
    declaredStatus: normalizedStatus,
    graphAvailable,
    graphEdgeCount,
    ready,
    message: ready ? null : TOPOLOGY_NOT_READY_MESSAGE,
  }
}

export function emptyOperationalTopologyGraph(datasetVersionId = null) {
  return {
    datasetVersionId,
    nodes: [],
    edges: [],
    components: [],
    degreeByNode: {},
    isolatedNodeIds: [],
  }
}
