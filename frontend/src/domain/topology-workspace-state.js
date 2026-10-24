// URL values take precedence over optional per-dataset area storage.
export function createTopologyWorkspaceState({mapData,search="",storedArea=null,compact=false}) {
  const query = new URLSearchParams(search)
  const validAreaKeys = new Set(mapData.locationGroups.map(({ key }) => key))
  const requestedArea = query.get('area')
  const preferredArea = requestedArea === 'all' || validAreaKeys.has(requestedArea)
    ? requestedArea
    : storedArea === 'all' || validAreaKeys.has(storedArea)
      ? storedArea
      : 'all'
  const selectedArea = preferredArea === 'all' || validAreaKeys.has(preferredArea)
    ? preferredArea === 'all' ? null : preferredArea
    : null
  const selectedAssetFromUrl = query.get('selectedAssetId') || query.get('assetId')

  const state = {
    area: selectedArea,
    selectedAssetId: selectedAssetFromUrl || null,
    selectedEdgeId: null,
    selectedMountingGroupId: null,
    selectedFamilies: new Set(),
    search: '',
    labelMode: 'auto',
    showMountingPhysical: true,
    zoom: 1,
    sidebarCollapsed: compact,
    exportOpen: false,
    actionsOpen: false,
    legendOpen: false,
    inspectorOpen: Boolean(selectedAssetFromUrl),
    searchResults: [],
    relationSearch: '',
    mutationBusy: false,
    frameComposerOpen: false,
    pendingFrameId: null,
    frameNames: Object.fromEntries(Object.entries(mapData.topologyFrameNames ?? {}).map(([id, name]) => [id.startsWith('pole-group:')||id.startsWith('excluded-mounting:')?id:`pole-group:${id}`, name])),
    changes: [],
    saveError: '',
    toastTimer: null,
  }

  return state
}
