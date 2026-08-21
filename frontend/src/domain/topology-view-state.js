export const TOPOLOGY_GROUPING_MODES = Object.freeze([
  'component',
  'network',
  'building',
  'folder',
])

export const TOPOLOGY_LABEL_MODES = Object.freeze(['auto', 'all', 'off'])

export function parseTopologyViewState(search, {
  assetIds = [],
  candidateIds = [],
  edgeIds = [],
  areaKeys = [],
  networkFamilies = [],
} = {}) {
  const params = new URLSearchParams(search)
  const validAssets = new Set(assetIds)
  const validCandidates = new Set(candidateIds)
  const validEdges = new Set(edgeIds)
  const validAreas = new Set(areaKeys)
  const validFamilies = new Set(networkFamilies)
  const grouping = params.get('grouping')
  const labelMode = params.get('labels')
  const requestedArea = params.get('area')
  const requestedFamilies = splitParam(params.get('networkFamily') ?? params.get('networks'))
  return {
    selectedAssetId: validAssets.has(params.get('selectedAssetId'))
      ? params.get('selectedAssetId')
      : null,
    reviewCandidateId: validCandidates.has(params.get('reviewCandidateId'))
      ? params.get('reviewCandidateId')
      : null,
    selectedEdgeId: validEdges.has(params.get('selectedEdgeId'))
      ? params.get('selectedEdgeId')
      : null,
    area: validAreas.has(requestedArea) ? requestedArea : null,
    selectedFamilies: new Set([...requestedFamilies].filter((family) => (
      !validFamilies.size || validFamilies.has(family)
    ))),
    groupingMode: TOPOLOGY_GROUPING_MODES.includes(grouping) ? grouping : 'component',
    labelMode: TOPOLOGY_LABEL_MODES.includes(labelMode) ? labelMode : 'auto',
    selectedCategories: splitParam(params.get('categories')),
    search: params.get('q') ?? '',
    focusOnly: params.get('focus') === 'neighbors',
    traceFrom: validAssets.has(params.get('traceFrom')) ? params.get('traceFrom') : null,
    traceTo: validAssets.has(params.get('traceTo')) ? params.get('traceTo') : null,
    hideFiltered: params.get('hideFiltered') === 'true',
    adminLayers: params.get('layers') === 'admin',
    showMountingPhysical: params.get('mounting') !== 'off',
  }
}

export function serializeTopologyViewState(search, state) {
  const params = new URLSearchParams(search)
  setOrDelete(params, 'selectedAssetId', state.selectedAssetId)
  setOrDelete(params, 'reviewCandidateId', state.reviewCandidateId)
  setOrDelete(params, 'selectedEdgeId', state.selectedEdgeId)
  setOrDelete(params, 'area', state.area)
  setOrDelete(params, 'grouping', state.groupingMode)
  setOrDelete(params, 'labels', state.labelMode)
  setOrDelete(params, 'categories', [...(state.selectedCategories ?? [])].join(','))
  setOrDelete(params, 'q', state.search)
  setOrDelete(params, 'focus', state.focusOnly ? 'neighbors' : null)
  setOrDelete(params, 'traceFrom', state.traceFrom)
  setOrDelete(params, 'traceTo', state.traceFrom && state.traceTo ? state.traceTo : null)
  setOrDelete(params, 'networkFamily', [...(state.selectedFamilies ?? [])].join(','))
  setOrDelete(params, 'hideFiltered', state.hideFiltered ? 'true' : null)
  setOrDelete(params, 'layers', state.adminLayers ? 'admin' : null)
  setOrDelete(params, 'mounting', state.showMountingPhysical === false ? 'off' : null)
  return params.toString()
}

function splitParam(value) {
  return new Set(String(value ?? '').split(',').filter(Boolean))
}

function setOrDelete(params, key, value) {
  if (value) params.set(key, value)
  else params.delete(key)
}
