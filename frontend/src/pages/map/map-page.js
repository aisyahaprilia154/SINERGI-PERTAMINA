import {
  adaptActiveAssetDetail,
  adaptActiveDatasetForMap,
} from '../../adapters/active-dataset-map-adapter.js'
import {
  loadActiveAssetDetail,
  loadActiveDataset,
} from '../../services/active-dataset-service.js'
import { renderAssetDetailDrawer } from './asset-detail-drawer.js'
import { createMapCanvas } from './map-canvas.js'
import { renderNetworkMapCanvas } from './map-surface.js'
import { renderNetworkList as renderNetworkSidebarList, renderNetworkSidebar } from './network-sidebar.js'
import {
  createNetworkSelectionState,
  parseMapUrlState,
  serializeMapUrlState,
} from './network-sidebar-state.js'
import {
  buildExplicitRelationGraph,
  findReachableDestinations,
  findTracePath,
  getConnectedAssets,
} from './network-tracing.js'
import { openSchematicDialog } from './diagram-dialog.js'
import { openMapDataTransferDialog } from './map-data-transfer-dialog.js'
import { buildSchematicGraph } from './schematic-graph.js'
import { calculateSchematicLayout } from './schematic-layout.js'

export async function renderMapPage(container) {
  document.title = 'Peta Jaringan — SINERGI'
  document.body.className = 'map-body'

  const requestedContext = readRequestedDatasetContext()
  renderDatasetState(container, {
    icon: 'progress_activity',
    title: 'Memuat dataset aktif',
    message: 'Aset, geometri, dan relasi sedang dibaca dari versi aktif yang sama.',
    loading: true,
  })

  let mapData
  try {
    const payload = await loadActiveDataset(requestedContext)
    mapData = adaptActiveDatasetForMap(payload)
    window.sessionStorage.setItem('sinergiActiveDatasetId', mapData.activeContext.datasetId)
    window.sessionStorage.setItem('sinergiActiveBranchId', mapData.activeContext.branchId)
  } catch (error) {
    renderDatasetState(container, {
      icon: 'error',
      title: 'Dataset aktif tidak dapat dimuat',
      message: error.message,
      retry: true,
      allowImport: true,
    })
    container.querySelector('.retry-active-dataset')?.addEventListener('click', () => {
      renderMapPage(container)
    })
    container.querySelector('.open-empty-map-import')?.addEventListener('click', () => {
      openMapDataTransferDialog({
        activeContext: {
          ...requestedContext,
          branchName: formatContextName(requestedContext.branchId),
          datasetVersionId: null,
          version: 'Belum ada dataset aktif',
        },
        initialMode: 'import',
        onActivated: () => window.location.reload(),
      })
    })
    return
  }

  const {
    activeContext,
    assetById,
    assets,
    geometries,
    exportAssets,
    networks,
    topologyGraph,
    hasRenderableData,
    renderingSummary,
    counts,
  } = mapData
  const defaultNetworkIds = networks
    .filter((network) => network.isDefaultVisible)
    .map((network) => network.id)
  if (!defaultNetworkIds.length && networks[0]) defaultNetworkIds.push(networks[0].id)

  const validIds = {
    networkIds: networks.map((network) => network.id),
    assetIds: assets.map((asset) => asset.id),
    defaultNetworkIds,
  }
  const initialUrlState = parseMapUrlState(window.location.search, validIds)
  const selection = createNetworkSelectionState({
    networkIds: validIds.networkIds,
    assetIds: validIds.assetIds,
    initialSelectedNetworkIds: initialUrlState.selectedNetworkIds,
    initialSelectedAssetId: initialUrlState.selectedAssetId,
  })
  const relationGraph = buildExplicitRelationGraph({
    networks,
    assetIds: validIds.assetIds,
    topologyGraph,
  })
  const assetDetailCache = new Map()
  let assetDetailRequest = 0
  const state = {
    traceStatus: 'idle',
    traceFromId: null,
    traceToId: null,
    tracePath: [],
    traceRelations: [],
    traceCandidates: [],
    traceError: null,
    traceExplanation: null,
    assetDetailStatus: 'ready',
    assetDetailError: null,
    showAdditionalMetadata: false,
    dimOthers: true,
    search: '',
    expandedNetworkIds: new Set(),
    dataStatus: 'loading',
    dataError: null,
  }

  container.innerHTML = `
    <div class="map-app">
      ${renderTopNavigation()}
      <main class="map-workspace">
        ${renderNetworkSidebar(activeContext, selection.selectedNetworkIds.size, counts)}
        ${renderNetworkMapCanvas(activeContext, {
          empty: !hasRenderableData,
          assetsWithoutGeometry: renderingSummary.assetsWithoutGeometry,
        })}
      </main>
    </div>
  `

  const workspace = container.querySelector('.map-workspace')
  const sidebar = container.querySelector('.network-sidebar')
  const networkList = container.querySelector('.network-list')
  const drawer = container.querySelector('.asset-drawer')
  const sidebarToggle = container.querySelector('.sidebar-collapse')
  const mobileSidebarToggle = container.querySelector('.open-sidebar')
  const legendToggle = container.querySelector('.legend-toggle')
  const legend = container.querySelector('.legend-popover')
  const canvasApi = createMapCanvas(container.querySelector('#network-map'), {
    assets,
    networks,
    geometries,
    onSelectAsset: handleAssetSelect,
    onSelectNetwork: handleNetworkSelect,
  })

  function updateUrl(mode = 'push') {
    const query = serializeMapUrlState(window.location.search, {
      selectedNetworkIds: selection.selectedNetworkIds,
      selectedAssetId: selection.selectedAssetId,
      traceFrom: state.traceFromId,
      traceTo: state.traceToId,
    })
    const nextUrl = `${window.location.pathname}?${query}${window.location.hash}`
    window.history[`${mode}State`](null, '', nextUrl)
  }

  function invalidateMapAfterPanelChange(panel) {
    window.requestAnimationFrame(canvasApi.invalidateSize)
    panel?.addEventListener('transitionend', canvasApi.invalidateSize, { once: true })
  }

  function renderNetworkList() {
    canvasApi.setHighlightedNetworkId(null)
    networkList.setAttribute('aria-busy', String(state.dataStatus === 'loading'))
    networkList.innerHTML = renderNetworkSidebarList({
      status: state.dataStatus,
      errorMessage: state.dataError,
      networks,
      assets,
      selectedNetworkIds: selection.selectedNetworkIds,
      expandedNetworkIds: state.expandedNetworkIds,
      search: state.search,
    })
    container.querySelector('.selected-count').textContent = selection.selectedNetworkIds.size
  }

  function loadSidebarData() {
    state.dataStatus = 'loading'
    state.dataError = null
    renderNetworkList()

    window.requestAnimationFrame(() => {
      try {
        if (!Array.isArray(networks) || !Array.isArray(assets)) {
          throw new Error('Format dataset aktif tidak dapat dibaca.')
        }
        state.dataStatus = 'ready'
      } catch (error) {
        state.dataStatus = 'error'
        state.dataError = error.message
      }
      renderNetworkList()
    })
  }

  function syncMap() {
    const connectedNodeIds = selection.selectedAssetId
      ? getConnectedAssets(relationGraph, selection.selectedAssetId)
        .map(({ targetAssetId }) => targetAssetId)
      : []
    canvasApi.setState({
      selectedNetworkIds: selection.selectedNetworkIds,
      selectedAssetId: selection.selectedAssetId,
      traceNodeIds: state.tracePath,
      connectedNodeIds,
      dimOthers: state.dimOthers,
    })
  }

  function toggleNetwork(networkId) {
    selection.toggleNetwork(networkId)
    updateUrl()
    renderNetworkList()
    syncMap()
  }

  function handleNetworkSelect(networkId) {
    if (selection.selectedNetworkIds.has(networkId)) return
    selection.toggleNetwork(networkId)
    updateUrl()
    renderNetworkList()
    syncMap()
  }

  function handleAssetSelect(assetId) {
    const previousAssetId = selection.selectedAssetId
    selection.selectAsset(assetId)
    state.assetDetailStatus = assetDetailCache.has(assetId) ? 'ready' : 'loading'
    state.assetDetailError = assetById[assetId] ? null : 'Aset tidak ditemukan pada dataset aktif.'
    state.showAdditionalMetadata = false
    if (selection.selectedAssetId !== previousAssetId) updateUrl()
    renderDrawer()
    syncMap()
    if (assetById[assetId] && !assetDetailCache.has(assetId)) {
      loadAssetDetail(assetId)
    }

    if (state.traceStatus === 'selecting-start') {
      beginTracing(assetId)
      return
    }
    if (state.traceStatus === 'choosing' && state.traceFromId !== assetId) {
      runTraceTo(assetId)
      return
    }

  }

  function closeAssetDrawer() {
    selection.selectAsset(null)
    updateUrl()
    renderDrawer()
    syncMap()
  }

  function renderDrawer() {
    const mapAsset = assetById[selection.selectedAssetId]
    if (!mapAsset) {
      drawer.classList.remove('open')
      drawer.setAttribute('aria-hidden', 'true')
      workspace.classList.remove('drawer-open')
      drawer.innerHTML = ''
      invalidateMapAfterPanelChange(drawer)
      return
    }
    const asset = assetDetailCache.get(mapAsset.id) ?? mapAsset

    const assetNetworks = networks.filter((network) => network.nodeIds.includes(asset.id))
    const connectedAssets = getConnectedAssets(relationGraph, asset.id)
      .map((relation) => ({
        asset: assetById[relation.targetAssetId],
        network: networks.find((network) => network.id === relation.networkId),
      }))
      .filter((item) => item.asset)
    drawer.innerHTML = renderAssetDetailDrawer({
      status: state.assetDetailStatus,
      errorMessage: state.assetDetailError,
      asset,
      assetNetworks,
      connectedAssets,
      activeContext,
      showAdditionalMetadata: state.showAdditionalMetadata,
      trace: getDrawerTraceState(),
    })
    drawer.classList.add('open')
    drawer.setAttribute('aria-hidden', 'false')
    workspace.classList.add('drawer-open')
    invalidateMapAfterPanelChange(drawer)

    drawer.querySelector('.close-drawer')?.addEventListener('click', closeAssetDrawer)
    drawer.querySelector('.trace-from')?.addEventListener('click', () => beginTracing(asset.id))
    drawer.querySelector('.stop-tracing')?.addEventListener('click', stopTracing)
    drawer.querySelector('.open-asset-detail')?.addEventListener('click', () => {
      state.showAdditionalMetadata = !state.showAdditionalMetadata
      renderDrawer()
      if (state.showAdditionalMetadata) {
        drawer.querySelector('.additional-metadata')?.scrollIntoView({ block: 'nearest' })
      }
    })
    drawer.querySelector('.retry-asset-detail')?.addEventListener('click', () => {
      loadAssetDetail(selection.selectedAssetId, { force: true })
    })
    drawer.querySelectorAll('[data-trace-target]').forEach((button) => {
      button.addEventListener('click', () => runTraceTo(button.dataset.traceTarget))
    })
    drawer.querySelectorAll('[data-connected-asset]').forEach((button) => {
      button.addEventListener('click', () => handleAssetSelect(button.dataset.connectedAsset))
    })
    drawer.querySelectorAll('[data-focus-network]').forEach((button) => button.addEventListener('click', () => {
      const networkId = button.dataset.focusNetwork
      canvasApi.focusNetworkBounds(networkId)
    }))
    drawer.querySelector('.open-schematic')?.addEventListener('click', openSchematic)
  }

  async function loadAssetDetail(assetId, { force = false } = {}) {
    const mapAsset = assetById[assetId]
    if (!mapAsset) return
    if (!force && assetDetailCache.has(assetId)) {
      state.assetDetailStatus = 'ready'
      state.assetDetailError = null
      renderDrawer()
      return
    }
    const requestId = ++assetDetailRequest
    state.assetDetailStatus = 'loading'
    state.assetDetailError = null
    renderDrawer()
    try {
      const detailPayload = await loadActiveAssetDetail({
        datasetId: activeContext.datasetId,
        branchId: activeContext.branchId,
        assetId,
      })
      if (detailPayload.activePointer?.revision !== activeContext.activePointerRevision) {
        throw new Error(
          'Dataset aktif berubah saat detail dimuat. Muat ulang peta untuk menggunakan versi terbaru.',
        )
      }
      assetDetailCache.set(assetId, adaptActiveAssetDetail(detailPayload, mapAsset))
      if (requestId !== assetDetailRequest || selection.selectedAssetId !== assetId) return
      state.assetDetailStatus = 'ready'
      state.assetDetailError = null
    } catch (error) {
      if (requestId !== assetDetailRequest || selection.selectedAssetId !== assetId) return
      state.assetDetailStatus = 'error'
      state.assetDetailError = error.message
    }
    renderDrawer()
  }

  function getDrawerTraceState() {
    return {
      status: state.traceStatus,
      error: state.traceError,
      explanation: state.traceExplanation,
      candidates: state.traceCandidates.map((candidate) => ({
        asset: assetById[candidate.assetId],
        distance: candidate.distance,
      })).filter((candidate) => candidate.asset),
      pathAssets: state.tracePath.map((assetId) => assetById[assetId]).filter(Boolean),
      relations: state.traceRelations.map((relation) => ({
        ...relation,
        networkName: networks.find((network) => network.id === relation.networkId)?.shortName
          || networks.find((network) => network.id === relation.networkId)?.name,
      })),
    }
  }

  function updateTraceBanner() {
    const banner = container.querySelector('.trace-banner')
    if (state.traceStatus === 'idle') {
      banner.hidden = true
      return
    }
    banner.hidden = false
    const step = banner.querySelector('.trace-step')
    const title = banner.querySelector('strong')
    const description = banner.querySelector('div span')
    if (state.traceStatus === 'selecting-start') {
      step.textContent = '1'
      title.textContent = 'Pilih titik awal'
      description.textContent = 'Klik aset pada peta untuk memulai tracing.'
    } else if (state.traceStatus === 'choosing') {
      step.textContent = '2'
      title.textContent = 'Pilih titik tujuan'
      description.textContent = `Titik awal: ${assetById[state.traceFromId]?.name || state.traceFromId}.`
    } else if (state.traceStatus === 'loading') {
      step.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">progress_activity</span>'
      title.textContent = 'Menyusun jalur'
      description.textContent = 'Membaca graph topologi terkonfirmasi pada dataset aktif.'
    } else if (state.traceStatus === 'active') {
      step.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">check</span>'
      title.textContent = 'Jalur koneksi ditampilkan'
      description.textContent = `${state.tracePath.length} aset pada jalur topologi terkonfirmasi.`
    } else if (state.traceStatus === 'error') {
      step.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">priority_high</span>'
      title.textContent = 'Tracing tidak dapat diselesaikan'
      description.textContent = state.traceError || 'Relasi tujuan tidak tersedia.'
    }
  }

  function resetTraceState() {
    state.traceStatus = 'idle'
    state.traceFromId = null
    state.traceToId = null
    state.tracePath = []
    state.traceRelations = []
    state.traceCandidates = []
    state.traceError = null
    state.traceExplanation = null
  }

  function beginTracing(startId = null, { historyMode = 'push' } = {}) {
    resetTraceState()
    if (!startId) {
      state.traceStatus = 'selecting-start'
      updateUrl(historyMode)
      updateTraceBanner()
      renderDrawer()
      syncMap()
      return
    }

    if (!assetById[startId]) {
      state.traceStatus = 'error'
      state.traceError = 'Aset awal tidak tersedia pada dataset aktif.'
      updateUrl(historyMode)
      updateTraceBanner()
      renderDrawer()
      syncMap()
      return
    }

    state.traceFromId = startId
    state.tracePath = [startId]
    state.traceCandidates = findReachableDestinations(relationGraph, startId)
      .sort((left, right) => left.distance - right.distance
        || assetById[left.assetId].name.localeCompare(assetById[right.assetId].name, 'id'))

    if (!state.traceCandidates.length) {
      state.traceStatus = 'error'
      state.traceError = 'Tidak ada tujuan yang dapat dicapai melalui topologi terkonfirmasi dari aset ini.'
    } else {
      state.traceStatus = 'choosing'
    }
    updateUrl(historyMode)
    updateTraceBanner()
    renderDrawer()
    syncMap()
  }

  function runTraceTo(targetId, { historyMode = 'push', defer = true } = {}) {
    if (!state.traceFromId) {
      beginTracing(selection.selectedAssetId)
      return
    }

    state.traceToId = targetId
    state.traceStatus = 'loading'
    state.traceError = null
    updateTraceBanner()
    renderDrawer()
    syncMap()

    const finishTraversal = () => {
      const result = findTracePath(relationGraph, state.traceFromId, targetId)
      if (result.status === 'found' && result.assetIds.length > 1) {
        state.traceStatus = 'active'
        state.tracePath = result.assetIds
        state.traceRelations = result.relations
        state.traceExplanation = result.explanation
        state.traceError = null
        updateUrl(historyMode)
        canvasApi.focusAssetBounds(result.assetIds)
      } else {
        state.traceStatus = 'error'
        state.tracePath = state.traceFromId ? [state.traceFromId] : []
        state.traceRelations = []
        state.traceExplanation = null
        state.traceError = result.message || 'Tujuan tracing tidak dapat digunakan.'
        updateUrl(historyMode)
      }
      updateTraceBanner()
      renderDrawer()
      syncMap()
    }

    if (defer) window.requestAnimationFrame(finishTraversal)
    else finishTraversal()
  }

  function stopTracing() {
    resetTraceState()
    updateUrl()
    updateTraceBanner()
    syncMap()
    renderDrawer()
  }

  function openSchematic() {
    const fullMapGraph = buildSchematicGraph({
      assets,
      networks,
      topologyGraph,
      scope: 'full-map',
    })
    const traceGraph = buildSchematicGraph({
      assets,
      networks,
      topologyGraph,
      scope: 'trace',
      tracePath: state.traceStatus === 'active' ? state.tracePath : [],
      traceRelations: state.traceStatus === 'active' ? state.traceRelations : [],
    })
    openSchematicDialog({
      diagrams: {
        'full-map': {
          graph: fullMapGraph,
          layout: calculateSchematicLayout(fullMapGraph, { preserveMapOrientation: true }),
        },
        trace: {
          graph: traceGraph,
          layout: calculateSchematicLayout(traceGraph, { preserveMapOrientation: true }),
        },
      },
      activeContext,
      selectedAssetId: selection.selectedAssetId,
      onSelectAsset: selectAssetFromDiagram,
    })
  }

  function openDataTransfer(initialMode = 'import') {
    openMapDataTransferDialog({
      activeContext,
      assets: exportAssets,
      networks,
      selectedNetworkIds: selection.selectedNetworkIds,
      initialMode,
      onActivated: () => window.location.reload(),
      onOpenDiagram: openSchematic,
    })
  }

  function selectAssetFromDiagram(assetId) {
    handleAssetSelect(assetId)
  }

  function openMobileSidebar() {
    workspace.classList.add('sidebar-open')
    mobileSidebarToggle.setAttribute('aria-expanded', 'true')
    invalidateMapAfterPanelChange(sidebar)
  }

  function closeMobileSidebar() {
    workspace.classList.remove('sidebar-open')
    mobileSidebarToggle.setAttribute('aria-expanded', 'false')
    invalidateMapAfterPanelChange(sidebar)
  }

  function toggleDesktopSidebar() {
    const isCollapsed = workspace.classList.toggle('sidebar-collapsed')
    sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed))
    sidebarToggle.setAttribute('aria-label', isCollapsed ? 'Buka daftar jaringan' : 'Ciutkan daftar jaringan')
    sidebarToggle.querySelector('.material-symbols-outlined').textContent =
      isCollapsed ? 'left_panel_open' : 'left_panel_close'
    invalidateMapAfterPanelChange(sidebar)
  }

  function toggleLegend() {
    const isOpen = legend.hidden
    legend.hidden = !isOpen
    legendToggle.setAttribute('aria-expanded', String(isOpen))
    legendToggle.setAttribute('aria-label', isOpen ? 'Sembunyikan legenda' : 'Tampilkan legenda')
  }

  function syncInactiveModeControls() {
    const dimInactive = !state.dimOthers
    container.querySelectorAll('.dim-toggle, .inactive-mode-toggle').forEach((button) => {
      button.setAttribute('aria-pressed', String(dimInactive))
    })
  }

  function toggleInactiveMode() {
    state.dimOthers = !state.dimOthers
    syncInactiveModeControls()
    syncMap()
  }

  function restoreStateFromUrl() {
    const urlState = parseMapUrlState(window.location.search, validIds)
    selection.replace(urlState)
    restoreTraceState(urlState)
    renderNetworkList()
    renderDrawer()
    syncMap()
  }

  function restoreTraceState(urlState) {
    resetTraceState()
    if (!urlState.traceFrom) {
      updateTraceBanner()
      return
    }

    state.traceFromId = urlState.traceFrom
    if (urlState.traceTo) {
      state.traceToId = urlState.traceTo
      const result = findTracePath(relationGraph, urlState.traceFrom, urlState.traceTo)
      if (result.status === 'found' && result.assetIds.length > 1) {
        state.traceStatus = 'active'
        state.tracePath = result.assetIds
        state.traceRelations = result.relations
        state.traceExplanation = result.explanation
        window.requestAnimationFrame(() => canvasApi.focusAssetBounds(result.assetIds))
      } else {
        state.traceStatus = 'error'
        state.tracePath = [urlState.traceFrom]
        state.traceError = result.message || 'Jalur tracing pada URL tidak tersedia.'
      }
    } else {
      state.tracePath = [urlState.traceFrom]
      state.traceCandidates = findReachableDestinations(relationGraph, urlState.traceFrom)
      state.traceStatus = state.traceCandidates.length ? 'choosing' : 'error'
      if (!state.traceCandidates.length) {
        state.traceError = 'Tidak ada tujuan yang dapat dicapai melalui topologi terkonfirmasi dari aset ini.'
      }
    }
    updateTraceBanner()
  }

  networkList.addEventListener('click', (event) => {
    const retryButton = event.target.closest('.retry-networks')
    if (retryButton) {
      loadSidebarData()
      return
    }

    const selectButton = event.target.closest('[data-network-select]')
    if (selectButton) {
      toggleNetwork(selectButton.dataset.networkSelect)
      return
    }

    const focusButton = event.target.closest('[data-network-focus]')
    if (focusButton) {
      canvasApi.focusNetworkBounds(focusButton.dataset.networkFocus)
      return
    }

    const expandButton = event.target.closest('[data-network-expand]')
    if (expandButton) {
      const networkId = expandButton.dataset.networkExpand
      if (state.expandedNetworkIds.has(networkId)) state.expandedNetworkIds.delete(networkId)
      else state.expandedNetworkIds.add(networkId)
      renderNetworkList()
    }
  })
  networkList.addEventListener('pointerover', (event) => {
    const item = event.target.closest('.network-item')
    if (!item || item.contains(event.relatedTarget)) return
    canvasApi.setHighlightedNetworkId(item.dataset.networkId)
  })
  networkList.addEventListener('pointerout', (event) => {
    const item = event.target.closest('.network-item')
    if (!item || item.contains(event.relatedTarget)) return
    canvasApi.setHighlightedNetworkId(null)
  })
  container.querySelector('.search-control input').addEventListener('input', (event) => {
    state.search = event.target.value
    renderNetworkList()
  })
  container.querySelector('.show-all-networks').addEventListener('click', () => {
    selection.showAllNetworks()
    updateUrl()
    renderNetworkList()
    syncMap()
  })
  container.querySelector('.hide-all-networks').addEventListener('click', () => {
    selection.hideAllNetworks()
    updateUrl()
    renderNetworkList()
    syncMap()
  })
  container.querySelector('.inactive-mode-toggle').addEventListener('click', toggleInactiveMode)
  container.querySelector('.data-transfer-toggle').addEventListener('click', () => {
    openDataTransfer('import')
  })
  container.querySelector('.trace-toggle').addEventListener('click', () => beginTracing(selection.selectedAssetId))
  container.querySelector('.diagram-toggle').addEventListener('click', openSchematic)
  container.querySelector('.cancel-trace').addEventListener('click', stopTracing)
  container.querySelector('.dim-toggle').addEventListener('click', toggleInactiveMode)
  container.querySelector('.zoom-in').addEventListener('click', canvasApi.zoomIn)
  container.querySelector('.zoom-out').addEventListener('click', canvasApi.zoomOut)
  container.querySelector('.zoom-reset').addEventListener('click', canvasApi.reset)
  container.querySelector('.open-sidebar').addEventListener('click', openMobileSidebar)
  container.querySelector('.close-sidebar').addEventListener('click', closeMobileSidebar)
  container.querySelector('.sidebar-collapse').addEventListener('click', toggleDesktopSidebar)
  container.querySelector('.legend-toggle').addEventListener('click', toggleLegend)
  container.querySelector('.mobile-panel-backdrop').addEventListener('click', () => {
    if (workspace.classList.contains('drawer-open')) closeAssetDrawer()
    else closeMobileSidebar()
  })
  window.addEventListener('popstate', restoreStateFromUrl)
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      container.querySelector('.search-control input').focus()
    }
    if (event.key !== 'Escape') return
    if (state.traceStatus !== 'idle') stopTracing()
    else if (selection.selectedAssetId) closeAssetDrawer()
    else if (workspace.classList.contains('sidebar-open')) closeMobileSidebar()
    else if (!legend.hidden) toggleLegend()
  })

  restoreTraceState(initialUrlState)
  updateUrl('replace')
  syncInactiveModeControls()
  loadSidebarData()
  if (selection.selectedAssetId) loadAssetDetail(selection.selectedAssetId)
  else renderDrawer()
  syncMap()
}

function readRequestedDatasetContext() {
  const query = new URLSearchParams(window.location.search)
  return {
    datasetId: query.get('datasetId')
      || window.sessionStorage.getItem('sinergiActiveDatasetId')
      || 'dataset-semarang',
    branchId: query.get('branchId')
      || window.sessionStorage.getItem('sinergiActiveBranchId')
      || 'semarang',
  }
}

function renderDatasetState(container, {
  icon,
  title,
  message,
  loading = false,
  retry = false,
  allowImport = false,
}) {
  container.innerHTML = `
    <div class="map-app">
      ${renderTopNavigation()}
      <main class="map-data-state${loading ? ' is-loading' : ' is-error'}"
        aria-live="polite" aria-busy="${loading}">
        <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
        <h1>${escapePageHtml(title)}</h1>
        <p>${escapePageHtml(message)}</p>
        ${retry ? `
          <div>
            <button class="button button-primary retry-active-dataset" type="button">
              Coba lagi
            </button>
            ${allowImport ? `
              <button class="button button-secondary open-empty-map-import" type="button">
                <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
                Import KML/KMZ
              </button>
            ` : ''}
          </div>
        ` : ''}
      </main>
    </div>
  `
}

function escapePageHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatContextName(value) {
  return String(value ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function renderTopNavigation() {
  return `
    <header class="top-navigation">
      <a class="brand-lockup nav-brand" href="/" aria-label="SINERGI">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span><strong>SINERGI</strong><small>Asset Network</small></span>
      </a>
      <nav aria-label="Navigasi utama">
        <a href="#ringkasan"><span class="material-symbols-outlined" aria-hidden="true">space_dashboard</span>Ringkasan</a>
        <a href="/map" class="active"><span class="material-symbols-outlined" aria-hidden="true">map</span>Peta jaringan</a>
        <a href="#inventaris"><span class="material-symbols-outlined" aria-hidden="true">inventory_2</span>Inventaris aset</a>
      </nav>
      <div class="nav-actions">
        <button class="icon-button" type="button" aria-label="Bantuan">
          <span class="material-symbols-outlined" aria-hidden="true">help</span>
        </button>
        <button class="icon-button notification-button" type="button" aria-label="Notifikasi">
          <span class="material-symbols-outlined" aria-hidden="true">notifications</span><i></i>
        </button>
        <button class="user-menu" type="button" aria-label="Profil SSC ICT Administrator">
          <span>SI</span>
          <div><strong>SSC ICT</strong><small>Administrator</small></div>
          <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
        </button>
      </div>
    </header>
  `
}
