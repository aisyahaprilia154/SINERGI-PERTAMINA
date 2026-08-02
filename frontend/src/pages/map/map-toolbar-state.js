import {
  evaluateRelationReadiness,
  isUserConfirmedRelation,
} from '../../domain/relation-readiness.js'

export function deriveMapToolbarAvailability({
  selectedAssetId = null,
  selectedNetworkIds = [],
  topologyGraph = null,
  traceStatus = 'idle',
  traceRelations = [],
  isAdministrator = false,
} = {}) {
  const assetReadiness = selectedAssetId
    ? evaluateRelationReadiness({ topologyGraph, assetId: selectedAssetId })
    : null
  const selectedScopeReadiness = evaluateRelationReadiness({
    topologyGraph,
    networkIds: selectedNetworkIds,
  })
  const activeTraceHasEdge = traceStatus === 'result'
    && traceRelations.some(isUserConfirmedRelation)
  const traceEnabled = assetReadiness?.canTrace === true
  const diagramEnabled = activeTraceHasEdge
    || assetReadiness?.canCreateDiagram === true
    || selectedScopeReadiness.canCreateDiagram
    || (isAdministrator && (
      Number(assetReadiness?.pendingEdgeCount) > 0
      || Number(selectedScopeReadiness.pendingEdgeCount) > 0
    ))
  const diagramPreviewOnly = diagramEnabled
    && !activeTraceHasEdge
    && assetReadiness?.canCreateDiagram !== true
    && !selectedScopeReadiness.canCreateDiagram

  return {
    traceEnabled,
    traceReason: traceEnabled
      ? ''
      : selectedAssetId
        ? 'Relasi aset belum tersedia.'
        : 'Pilih satu aset untuk memulai tracing.',
    diagramEnabled,
    diagramPreviewOnly,
    diagramReason: diagramEnabled
      ? ''
      : selectedScopeReadiness.reason
        || 'Scope belum mempunyai relasi terkonfirmasi untuk diagram.',
    assetReadiness,
    selectedScopeReadiness,
  }
}

export function findSelectedLineOnlyNetworks(networks = [], selectedNetworkIds = []) {
  const selected = new Set(selectedNetworkIds)
  return networks.filter((network) => (
    selected.has(network.id)
    && Number(network.lineCount) > 0
    && Number(network.nodeCount) === 0
  ))
}
