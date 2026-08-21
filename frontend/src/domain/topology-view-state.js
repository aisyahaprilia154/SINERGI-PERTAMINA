export const TOPOLOGY_GROUPING_MODES = Object.freeze([
  'component',
  'network',
  'building',
  'folder',
])

export const TOPOLOGY_LABEL_MODES = Object.freeze(['auto', 'all', 'off'])
export const TOPOLOGY_VIEW_MODES = Object.freeze(['diagram', 'spatial'])

export function parseTopologyViewState(search, {
  assetIds = [],
  candidateIds = [],
} = {}) {
  const params = new URLSearchParams(search)
  const validAssets = new Set(assetIds)
  const validCandidates = new Set(candidateIds)
  const grouping = params.get('grouping')
  const labelMode = params.get('labels')
  const view = params.get('view')
  return {
    view: TOPOLOGY_VIEW_MODES.includes(view) ? view : 'diagram',
    area: params.get('area') || null,
    selectedAssetId: validAssets.has(params.get('selectedAssetId'))
      ? params.get('selectedAssetId')
      : null,
    reviewCandidateId: validCandidates.has(params.get('reviewCandidateId'))
      ? params.get('reviewCandidateId')
      : null,
    groupingMode: TOPOLOGY_GROUPING_MODES.includes(grouping) ? grouping : 'component',
    labelMode: TOPOLOGY_LABEL_MODES.includes(labelMode) ? labelMode : 'auto',
    selectedCategories: splitParam(params.get('categories')),
    search: params.get('q') ?? '',
    focusOnly: params.get('focus') === 'neighbors',
    traceFrom: validAssets.has(params.get('traceFrom')) ? params.get('traceFrom') : null,
    traceTo: validAssets.has(params.get('traceTo')) ? params.get('traceTo') : null,
  }
}

export function serializeTopologyViewState(search, state) {
  const params = new URLSearchParams(search)
  setOrDelete(params, 'view', state.view && state.view !== 'diagram' ? state.view : null)
  setOrDelete(params, 'area', state.area)
  setOrDelete(params, 'selectedAssetId', state.selectedAssetId)
  setOrDelete(params, 'reviewCandidateId', state.reviewCandidateId)
  setOrDelete(params, 'grouping', state.groupingMode)
  setOrDelete(params, 'labels', state.labelMode)
  setOrDelete(params, 'categories', [...(state.selectedCategories ?? [])].join(','))
  setOrDelete(params, 'q', state.search)
  setOrDelete(params, 'focus', state.focusOnly ? 'neighbors' : null)
  setOrDelete(params, 'traceFrom', state.traceFrom)
  setOrDelete(params, 'traceTo', state.traceFrom && state.traceTo ? state.traceTo : null)
  return params.toString()
}

function splitParam(value) {
  return new Set(String(value ?? '').split(',').filter(Boolean))
}

function setOrDelete(params, key, value) {
  if (value) params.set(key, value)
  else params.delete(key)
}
