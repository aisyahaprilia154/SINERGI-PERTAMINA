export function parseMapUrlState(search, { networkIds, assetIds, defaultNetworkIds = [] }) {
  const params = new URLSearchParams(search)
  const validNetworkIds = new Set(networkIds)
  const validAssetIds = new Set(assetIds)
  const selectedNetworkIds = params.has('selectedNetworkIds')
    ? params.get('selectedNetworkIds').split(',').filter((id) => validNetworkIds.has(id))
    : defaultNetworkIds.filter((id) => validNetworkIds.has(id))
  const requestedAssetId = params.get('selectedAssetId')
  const requestedTraceFrom = params.get('traceFrom')
  const requestedTraceTo = params.get('traceTo')

  return {
    selectedNetworkIds,
    selectedAssetId: validAssetIds.has(requestedAssetId) ? requestedAssetId : null,
    traceFrom: validAssetIds.has(requestedTraceFrom) ? requestedTraceFrom : null,
    traceTo: validAssetIds.has(requestedTraceTo) ? requestedTraceTo : null,
  }
}

export function serializeMapUrlState(
  search,
  { selectedNetworkIds, selectedAssetId, traceFrom = null, traceTo = null },
) {
  const params = new URLSearchParams(search)
  params.set('selectedNetworkIds', [...selectedNetworkIds].join(','))

  if (selectedAssetId) params.set('selectedAssetId', selectedAssetId)
  else params.delete('selectedAssetId')

  if (traceFrom) params.set('traceFrom', traceFrom)
  else params.delete('traceFrom')

  if (traceFrom && traceTo) params.set('traceTo', traceTo)
  else params.delete('traceTo')

  return params.toString()
}

export function createNetworkSelectionState({
  networkIds,
  assetIds,
  initialSelectedNetworkIds = [],
  initialSelectedAssetId = null,
}) {
  const validNetworkIds = new Set(networkIds)
  const validAssetIds = new Set(assetIds)
  let selectedNetworkIds = sanitizeIds(initialSelectedNetworkIds, validNetworkIds)
  let selectedAssetId = validAssetIds.has(initialSelectedAssetId) ? initialSelectedAssetId : null

  return {
    get selectedNetworkIds() {
      return new Set(selectedNetworkIds)
    },
    get selectedAssetId() {
      return selectedAssetId
    },
    toggleNetwork(networkId) {
      if (!validNetworkIds.has(networkId)) return
      if (selectedNetworkIds.has(networkId)) selectedNetworkIds.delete(networkId)
      else selectedNetworkIds.add(networkId)
    },
    showAllNetworks() {
      selectedNetworkIds = new Set(validNetworkIds)
    },
    hideAllNetworks() {
      selectedNetworkIds.clear()
    },
    selectOnlyNetwork(networkId) {
      selectedNetworkIds = validNetworkIds.has(networkId) ? new Set([networkId]) : new Set()
    },
    selectAsset(assetId) {
      selectedAssetId = validAssetIds.has(assetId) ? assetId : null
    },
    replace(nextState) {
      selectedNetworkIds = sanitizeIds(nextState.selectedNetworkIds, validNetworkIds)
      selectedAssetId = validAssetIds.has(nextState.selectedAssetId) ? nextState.selectedAssetId : null
    },
  }
}

function sanitizeIds(ids, validIds) {
  return new Set([...ids].filter((id) => validIds.has(id)))
}
