import {branchNameForFacility} from '../domain/facility-branch.js'
import {assetIconUrl} from '../domain/asset-icon.js'
import {renderTopologyDiagramSvg} from '../pages/topology/topology-diagram-svg.js'

// Owns only the dedicated SVG frame; UI panels remain the caller's responsibility.
export function createTopologyGraphRenderer({frame,getSnapshot,sourceIconLoader,scope,syncGraphSurface,renderOverviewLabels,onIconsReady,isDragging}) {
  let disposed=false
  function renderGraph() {
    if(disposed||scope.disposed)return
    const {model,layout,state,mapData,activeContext}=getSnapshot()
    if (!frame) return
    if (!model || model.status !== 'ready' || !layout || layout.status !== 'ready') {
      frame.innerHTML = `<div class="topology-stitch-empty">
        <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
        <strong>${escapeHtml(model?.message ?? 'Belum ada data topology untuk area ini.')}</strong>
        <span>Pilih area lain atau periksa dataset aktif.</span>
      </div>`
      frame.style.width = '100%'
      frame.style.height = '100%'
      frame.style.transform = 'none'
      syncGraphSurface()
      return
    }
    const sourceIconPreload = sourceIconLoader.preload(
      layout.nodes.map((node) => (
        assetIconUrl(node)
      )),
    )
    if (sourceIconPreload) {
      void sourceIconPreload.then(() => {
        if (!disposed && !scope.disposed && frame.isConnected && !isDragging()) {
          renderGraph()
          onIconsReady()
        }
      })
    }
    const displayBranchName = branchNameForFacility(
      mapData.locationGroups.find(({ key }) => key === state.area),
      activeContext.branchName,
    )
    const svg = renderTopologyDiagramSvg({
      model,
      layout,
      context: {
        ...activeContext,
        branchName: displayBranchName,
        datasetId: activeContext.datasetId,
        datasetVersionId: activeContext.datasetVersionId,
        areaKey: state.area,
      },
      selectedAssetId: state.selectedAssetId,
      selectedEdgeId: state.selectedEdgeId,
      selectedMountingGroupId: state.selectedMountingGroupId,
      labelMode: state.labelMode,
      showMountingPhysical: state.showMountingPhysical,
      zoom: state.zoom,
      renderMode: 'interactive',
      sourceIconDataByUrl: sourceIconLoader.dataByUrl,
      mountingLabelById: state.frameNames,
    })
    frame.innerHTML = svg
    frame.style.width = `${layout.width}px`
    frame.style.height = `${layout.height}px`
    frame.style.transform = `scale(${state.zoom})`
    syncGraphSurface()
    renderOverviewLabels()
  }

  const dispose=()=>{disposed=true}
  scope.own(dispose)
  return {render:renderGraph,dispose}
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]))
}
