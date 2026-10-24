// UI-independent selection and search navigation; rendering/focus are callbacks.
export function createTopologySelection({state,mapData,getModel,getLayout,persistArea,rebuild,renderGraph,renderInspector,renderTopologySidebar,updatePanelState,syncUrl,focusAssetCard,focusMountingGroup}) {
  function selectSearchResult(result) {
    const model=getModel(),layout=getLayout()
    if (!result) return
    const targetAssetId = result.assetId ?? result.id
    const targetAsset = model.nodeById.get(targetAssetId)
      ?? mapData.assets.find((asset) => asset.id === targetAssetId)
    const targetArea = targetAsset?.areaKey ?? targetAsset?.locationGroupKey
    const shouldDrillIntoArea = layout?.mode === 'area-overview'
      && targetArea
      && targetArea !== state.area

    state.search = ''
    state.searchResults = []
    if (shouldDrillIntoArea) {
      state.area = targetArea
      persistArea(state.area)
      if (result.kind === 'mounting') {
        state.selectedMountingGroupId = result.id
        state.selectedAssetId = null
        state.selectedEdgeId = null
      } else if (result.kind === 'edge') {
        state.selectedEdgeId = result.id
        state.selectedAssetId = null
        state.selectedMountingGroupId = null
      } else {
        state.selectedAssetId = result.id
        state.selectedEdgeId = null
        state.selectedMountingGroupId = null
      }
      rebuild()
    }

    if (result.kind === 'edge') {
      selectEdge(result.id)
      if (result.assetId) focusAssetCard(result.assetId)
    } else if (result.kind === 'mounting') {
      selectMountingGroup(result.id)
      focusMountingGroup(result.id)
    } else {
      selectAsset(result.id, { focus: true })
    }
    renderTopologySidebar()
    updatePanelState()
  }

  function selectAsset(assetId, { focus = false } = {}) {
    const model=getModel()
    if (!assetId || !model.nodeById.has(assetId)) return
    if (state.selectedAssetId !== assetId) state.relationSearch = ''
    state.selectedAssetId = assetId
    state.selectedEdgeId = null
    state.selectedMountingGroupId = null
    state.inspectorOpen = true
    renderGraph()
    renderInspector()
    updatePanelState()
    syncUrl()
    if (focus) focusAssetCard(assetId)
  }

  function selectEdge(edgeId) {
    const model=getModel()
    if (!edgeId || !model.edgeById.has(edgeId)) return
    state.selectedEdgeId = edgeId
    state.selectedAssetId = null
    state.selectedMountingGroupId = null
    state.inspectorOpen = true
    renderGraph()
    renderInspector()
    updatePanelState()
  }

  function selectMountingGroup(groupId) {
    const layout=getLayout()
    const box = layout?.mountingBoxes?.find(({ id }) => id === groupId)
    if (!box || !['confirmed', 'empty', 'excluded'].includes(box.kind)) return
    state.selectedMountingGroupId = box.id
    state.selectedAssetId = null
    state.selectedEdgeId = null
    state.inspectorOpen = false
    renderGraph()
    updatePanelState()
  }

  function clearSelection() {
    if (!state.selectedAssetId && !state.selectedEdgeId && !state.selectedMountingGroupId) return
    state.selectedAssetId = null
    state.selectedEdgeId = null
    state.selectedMountingGroupId = null
    state.inspectorOpen = false
    renderGraph()
    renderInspector()
    updatePanelState()
    syncUrl()
  }

  return {selectSearchResult,selectAsset,selectEdge,selectMountingGroup,clearSelection}
}
