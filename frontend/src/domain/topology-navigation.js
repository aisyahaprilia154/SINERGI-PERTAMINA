export function buildTopologyDiagramHref({
  context,
  area = null,
  selectedAssetId = null,
  traceFrom = null,
  traceTo = null,
} = {}) {
  const params = new URLSearchParams({
    datasetId: context.datasetId,
    branchId: context.branchId,
    view: 'diagram',
  })
  if (area) params.set('area', area)
  if (selectedAssetId) params.set('selectedAssetId', selectedAssetId)
  if (traceFrom) params.set('traceFrom', traceFrom)
  if (traceFrom && traceTo) params.set('traceTo', traceTo)
  return `/topology?${params}`
}
