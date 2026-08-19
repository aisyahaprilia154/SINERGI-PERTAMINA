export const TOPOLOGY_NOT_READY_MESSAGE =
  'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.'

export const TOPOLOGY_PARTIAL_READY_MESSAGE =
  'Topologi sebagian siap. Tracing hanya tersedia pada komponen terverifikasi.'

export const TOPOLOGY_GRAPH_INVALID_MESSAGE =
  'Tracing dihentikan karena confirmed graph tidak valid.'

export const TOPOLOGY_NO_DEVICE_EDGE_MESSAGE =
  'Belum ada jalur perangkat terkonfirmasi yang menghubungkan dua aset. Lengkapi endpoint kabel terlebih dahulu.'

export function resolveTopologyReadiness({
  topologyReadiness = null,
  readiness = null,
  readinessContract = null,
  topologyGraph = null,
  validation = null,
} = {}) {
  const status = readinessContract?.topologyReady
    ?? topologyReadiness?.topologyReadiness
    ?? readiness?.topologyReadiness
    ?? null
  const graphEdgeCount = Array.isArray(topologyGraph?.edges)
    ? topologyGraph.edges.length
    : 0
  const graphAvailable = graphEdgeCount > 0
  const validationErrorCount = Number(
    readinessContract?.validation?.errorCount
      ?? validation?.summary?.errors
      ?? 0,
  )
  const graphValid = validationErrorCount === 0
  const normalizedStatus = status === true
    ? 'ready'
    : status === false
      ? 'not_ready'
      : status
  const publicationReady = normalizedStatus === null
    ? graphAvailable && graphValid
    : normalizedStatus === 'ready' && graphAvailable && graphValid
  const declaredTopologyStatus = readinessContract?.topologyStatus
    ?? topologyReadiness?.topologyStatus
    ?? null
  const noConfirmedDeviceEdge = readinessContract?.blockers?.some(({ code }) => (
    code === 'no_confirmed_device_edge'
  )) || topologyReadiness?.blockingReasons?.includes('no_confirmed_device_edge')
  const capabilities = {
    viewTopology: readinessContract?.capabilities?.viewTopology ?? graphAvailable,
    reviewTopology: readinessContract?.capabilities?.reviewTopology ?? false,
    editAssetMounting: readinessContract?.capabilities?.editAssetMounting ?? false,
    trace: readinessContract?.capabilities?.trace ?? (graphAvailable && graphValid),
    diagram: readinessContract?.capabilities?.diagram ?? (graphAvailable && graphValid),
    autoConfirm: readinessContract?.capabilities?.autoConfirm ?? false,
  }
  const traceAvailable = capabilities.trace === true && graphValid
  const diagramAvailable = capabilities.diagram === true && graphValid
  const derivedStatus = !graphValid
    ? 'invalid'
    : publicationReady
      ? 'ready'
      : traceAvailable
        ? 'partial_ready'
        : declaredTopologyStatus || 'review_required'
  const traceMessage = !graphValid
    ? TOPOLOGY_GRAPH_INVALID_MESSAGE
    : traceAvailable
      ? null
      : noConfirmedDeviceEdge
        ? TOPOLOGY_NO_DEVICE_EDGE_MESSAGE
      : TOPOLOGY_NOT_READY_MESSAGE
  return {
    status: derivedStatus,
    declaredStatus: normalizedStatus,
    declaredTopologyStatus,
    graphAvailable,
    graphEdgeCount,
    graphRevision: topologyGraph?.graphRevision ?? readinessContract?.graphRevision ?? null,
    graphValid,
    validationErrorCount,
    ready: publicationReady,
    traceAvailable,
    diagramAvailable,
    capabilities,
    message: traceAvailable && !publicationReady
      ? TOPOLOGY_PARTIAL_READY_MESSAGE
      : traceMessage,
    traceMessage,
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
    graphRevision: null,
  }
}
