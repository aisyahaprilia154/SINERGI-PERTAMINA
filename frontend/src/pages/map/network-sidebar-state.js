export function parseMapUrlState(
  search,
  { networkIds, assetIds, assetAliases = {}, defaultNetworkIds = [] },
) {
  const params = new URLSearchParams(search)
  const validNetworkIds = new Set(networkIds)
  const validAssetIds = new Set(assetIds)
  const selectedNetworkIds = params.has('selectedNetworkIds')
    ? params.get('selectedNetworkIds').split(',').filter((id) => validNetworkIds.has(id))
    : defaultNetworkIds.filter((id) => validNetworkIds.has(id))
  const requestedAssetId = params.get('selectedAssetId')
  const resolvedAssetId = assetAliases instanceof Map
    ? assetAliases.get(requestedAssetId) ?? requestedAssetId
    : assetAliases[requestedAssetId] ?? requestedAssetId
  const requestedTraceFrom = params.get('traceFrom')
  const requestedTraceTo = params.get('traceTo')

  return {
    datasetId: safeUrlValue(params.get('datasetId')),
    branchId: safeUrlValue(params.get('branchId')),
    siteId: safeUrlValue(params.get('siteId')),
    selectedNetworkIds,
    selectedAssetId: validAssetIds.has(resolvedAssetId) ? resolvedAssetId : null,
    traceFrom: validAssetIds.has(requestedTraceFrom) ? requestedTraceFrom : null,
    traceTo: validAssetIds.has(requestedTraceTo) ? requestedTraceTo : null,
    networkFamily: parseUrlList(params, 'networkFamily'),
    category: parseUrlList(params, 'category'),
    assetType: parseUrlList(params, 'assetType'),
    topologyStatus: parseUrlList(params, 'topologyStatus'),
  }
}

export function serializeMapUrlState(
  search,
  {
    datasetId,
    branchId,
    siteId,
    selectedNetworkIds,
    selectedAssetId,
    traceFrom = null,
    traceTo = null,
    networkFamily = [],
    category = [],
    assetType = [],
    topologyStatus = [],
  },
) {
  const params = new URLSearchParams(search)
  setOptionalUrlValue(params, 'datasetId', datasetId)
  setOptionalUrlValue(params, 'branchId', branchId)
  setOptionalUrlValue(params, 'siteId', siteId)
  params.set('selectedNetworkIds', [...selectedNetworkIds].join(','))

  if (selectedAssetId) params.set('selectedAssetId', selectedAssetId)
  else params.delete('selectedAssetId')

  if (traceFrom) params.set('traceFrom', traceFrom)
  else params.delete('traceFrom')

  if (traceFrom && traceTo) params.set('traceTo', traceTo)
  else params.delete('traceTo')

  setUrlList(params, 'networkFamily', networkFamily)
  setUrlList(params, 'category', category)
  setUrlList(params, 'assetType', assetType)
  setUrlList(params, 'topologyStatus', topologyStatus)

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

function parseUrlList(params, key) {
  return [...new Set(params.getAll(key)
    .flatMap((value) => value.split(','))
    .map(safeUrlValue)
    .filter(Boolean))]
}

function setUrlList(params, key, values) {
  const normalized = [...new Set((Array.isArray(values) ? values : [])
    .map(safeUrlValue)
    .filter(Boolean))]
  if (normalized.length) params.set(key, normalized.join(','))
  else params.delete(key)
}

function setOptionalUrlValue(params, key, value) {
  const normalized = safeUrlValue(value)
  if (normalized) params.set(key, normalized)
  else if (value !== undefined) params.delete(key)
}

function safeUrlValue(value) {
  const normalized = String(value ?? '').normalize('NFKC').trim()
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) return null
  return normalized
}
