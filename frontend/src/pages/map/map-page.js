import {
  adaptActiveAssetDetail,
  adaptActiveDatasetForMap,
  locationGroupFor,
} from '../../adapters/active-dataset-map-adapter.js'
import {
  loadActiveAssetDetail,
  loadActiveDataset,
  loadDatasetProjection,
} from '../../services/active-dataset-service.js'
import { renderAssetDetailDrawer } from './asset-detail-drawer.js'
import { createMapLibreSurface } from './maplibre-map.js'
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
import {
  emptyOperationalTopologyGraph,
  TOPOLOGY_NOT_READY_MESSAGE,
} from '../../domain/topology-readiness.js'

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

  const overlayResult = await Promise.allSettled([
    loadDatasetProjection({
      datasetVersionId: mapData.activeContext.datasetVersionId,
      projection: 'overlays',
    }),
  ])

  const {
    activeContext,
    assets: allAssets,
    diagramAssets: allDiagramAssets,
    geometries: allGeometries,
    exportAssets: allExportAssets,
    networks: allNetworks,
    topologyGraph: fullTopologyGraph,
    locationGroups,
    renderingSummary,
  } = mapData
  const topologyReadiness = mapData.topologyReadiness ?? {
    ready: false,
    message: TOPOLOGY_NOT_READY_MESSAGE,
  }
  const operationalTopologyGraph = topologyReadiness.ready
    ? fullTopologyGraph
    : emptyOperationalTopologyGraph(activeContext.datasetVersionId)
  const selectedArea = selectLocationGroup(window.location.search, locationGroups)
  const {
    assets,
    assetById,
    diagramAssets,
    geometries,
    exportAssets,
    networks,
    topologyGraph,
    counts,
  } = scopeMapData({
    selectedArea,
    assets: allAssets,
    diagramAssets: allDiagramAssets,
    geometries: allGeometries,
    exportAssets: allExportAssets,
    networks: allNetworks,
    topologyGraph: operationalTopologyGraph,
  })
  const hasRenderableData = geometries.length > 0
  const resolvedOverlays = (overlayResult[0].status === 'fulfilled'
    ? overlayResult[0].value.items ?? []
    : [])
    .filter((overlay) => (
      overlay.valid
      && overlay.resourceResolutionStatus === 'resolved'
      && overlay.resourceUrl
      && overlayMatchesArea(overlay, selectedArea)
    ))
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
    declutterEnabled: true,
    search: '',
    expandedNetworkIds: new Set(),
    dataStatus: 'loading',
    dataError: null,
  }

  container.innerHTML = `
    <div class="map-app">
      ${renderTopNavigation('map', {
        ...activeContext,
        area: selectedArea?.key,
      })}
      <main class="map-workspace">
        ${renderNetworkSidebar(activeContext, selection.selectedNetworkIds.size, counts, {
          locationGroups,
          selectedArea,
          topologyReadiness,
        })}
        ${renderNetworkMapCanvas(activeContext, {
          empty: !hasRenderableData,
          assetsWithoutGeometry: renderingSummary.assetsWithoutGeometry,
          selectedArea,
          counts,
          confirmedConnectionCount: topologyReadiness.ready ? topologyGraph.edges.length : 0,
          topologyReadiness,
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
  const basemapToggle = container.querySelector('.basemap-toggle')
  const basemapPicker = container.querySelector('.basemap-popover')
  const assetFinder = container.querySelector('.map-asset-finder')
  const assetSearch = assetFinder.querySelector('input')
  const assetResults = assetFinder.querySelector('.map-asset-results')
  const canvasApi = createMapLibreSurface(container.querySelector('#network-map'), {
    assets,
    networks,
    geometries,
    topologyGraph,
    overlays: resolvedOverlays,
    candidates: [],
    onSelectAsset: handleAssetSelect,
    onSelectNetwork: handleNetworkSelect,
    onBasemapStatus: updateBasemapStatus,
    onLayoutStatus: updateLayoutStatus,
  })

  function updateBasemapStatus(status, details = {}) {
    const element = container.querySelector('.basemap-availability')
    if (!element) return
    const statusElement = element.closest('.basemap-status')
    element.textContent = {
      available: 'tersedia',
      loading: details.retrying ? 'mencoba ulang' : 'memuat',
      unavailable: 'tidak tersedia · data lokal tetap aktif',
    }[status] ?? 'tidak diketahui'
    statusElement?.classList.toggle('loading', status === 'loading')
    statusElement?.classList.toggle('warning', status === 'unavailable')
    statusElement?.setAttribute('data-basemap-status', status)
    if (details.mode) updateBasemapModeLabel(details.mode)
    if (details.message) statusElement?.setAttribute('title', details.message)
    else statusElement?.removeAttribute('title')
  }

  function updateLayoutStatus(status) {
    const element = container.querySelector('.declutter-summary')
    if (!element) return
    if (!status.enabled) {
      element.textContent = 'koordinat asli'
      return
    }
    if (status.clusterCount) {
      element.textContent = `${status.clusterCount} kelompok · klik untuk buka`
      return
    }
    if (status.displacedAssetCount) {
      element.textContent = `${status.displacedAssetCount} disebar · koordinat tetap`
      return
    }
    element.textContent = 'adaptif · tidak bertumpuk'
  }

  function updateUrl(mode = 'push') {
    const query = new URLSearchParams(serializeMapUrlState(window.location.search, {
      selectedNetworkIds: selection.selectedNetworkIds,
      selectedAssetId: selection.selectedAssetId,
      traceFrom: state.traceFromId,
      traceTo: state.traceToId,
    }))
    if (selectedArea?.key) query.set('area', selectedArea.key)
    const nextUrl = `${window.location.pathname}?${query}${window.location.hash}`
    window.history[`${mode}State`](null, '', nextUrl)
    const topologyLink = container.querySelector('a[href="/topology"], a[href^="/topology?"]')
    if (topologyLink) {
      const topologyQuery = new URLSearchParams({
        datasetId: activeContext.datasetId,
        branchId: activeContext.branchId,
      })
      if (selection.selectedAssetId) topologyQuery.set('selectedAssetId', selection.selectedAssetId)
      if (state.traceFromId) topologyQuery.set('traceFrom', state.traceFromId)
      if (state.traceToId) topologyQuery.set('traceTo', state.traceToId)
      topologyLink.href = `/topology?${topologyQuery}`
    }
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
      topologyReady: topologyReadiness.ready,
      topologyMessage: topologyReadiness.message || TOPOLOGY_NOT_READY_MESSAGE,
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
      assetFinder.hidden = false
      return
    }
    closeAssetResults()
    assetFinder.hidden = true
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
    if (!topologyReadiness.ready) {
      state.traceStatus = 'error'
      state.traceError = topologyReadiness.message || TOPOLOGY_NOT_READY_MESSAGE
      updateUrl(historyMode)
      updateTraceBanner()
      renderDrawer()
      syncMap()
      return
    }
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
    if (!topologyReadiness.ready) {
      beginTracing(null, { historyMode })
      return
    }
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
    if (!topologyReadiness.ready) {
      state.traceStatus = 'error'
      state.traceError = topologyReadiness.message || TOPOLOGY_NOT_READY_MESSAGE
      updateTraceBanner()
      renderDrawer()
      return
    }
    const fullMapGraph = buildSchematicGraph({
      assets: diagramAssets,
      networks,
      topologyGraph,
      scope: 'full-map',
      topologyReady: topologyReadiness.ready,
    })
    const traceGraph = buildSchematicGraph({
      assets: diagramAssets,
      networks,
      topologyGraph,
      scope: 'trace',
      tracePath: state.traceStatus === 'active' ? state.tracePath : [],
      traceRelations: state.traceStatus === 'active' ? state.traceRelations : [],
      topologyReady: topologyReadiness.ready,
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
      topologyReady: topologyReadiness.ready,
      topologyMessage: topologyReadiness.message || TOPOLOGY_NOT_READY_MESSAGE,
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
    if (isOpen) closeBasemapPicker()
  }

  function closeBasemapPicker() {
    basemapPicker.hidden = true
    basemapToggle.setAttribute('aria-expanded', 'false')
  }

  function toggleBasemapPicker() {
    const isOpen = basemapPicker.hidden
    basemapPicker.hidden = !isOpen
    basemapToggle.setAttribute('aria-expanded', String(isOpen))
    if (isOpen && !legend.hidden) toggleLegend()
  }

  function updateBasemapModeLabel(mode) {
    const label = container.querySelector('.basemap-mode-label')
    if (label) label.textContent = mode === 'satellite' ? 'Citra + label' : 'Jalan & bangunan'
  }

  function configureBasemapPicker() {
    const capabilities = canvasApi.getBasemapCapabilities()
    basemapPicker.querySelectorAll('[data-basemap-mode]').forEach((button) => {
      const mode = button.dataset.basemapMode
      const available = Boolean(capabilities[mode])
      const active = mode === capabilities.mode
      button.disabled = !available
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
      button.querySelector('.basemap-option-check').textContent =
        active ? 'check_circle' : 'radio_button_unchecked'
    })
    const satelliteCopy = basemapPicker.querySelector('.satellite-option-copy')
    if (!capabilities.satellite) {
      satelliteCopy.textContent = 'Belum dikonfigurasi pada lingkungan ini'
    }
    updateBasemapModeLabel(capabilities.mode)
  }

  function selectBasemapMode(mode) {
    if (!canvasApi.setBasemapMode(mode)) return
    configureBasemapPicker()
    closeBasemapPicker()
  }

  function closeAssetResults() {
    assetResults.hidden = true
    assetSearch.setAttribute('aria-expanded', 'false')
  }

  function renderAssetResults(query) {
    const matches = findAssetMatches(assets, query)
    if (String(query).trim().length < 2) {
      closeAssetResults()
      return
    }
    assetResults.innerHTML = matches.length
      ? matches.map((asset) => `
          <button type="button" role="option" data-map-asset-id="${escapePageHtml(asset.id)}">
            <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
            <span>
              <strong>${escapePageHtml(asset.name || asset.id)}</strong>
              <small>${escapePageHtml(asset.id)} &middot; ${escapePageHtml(asset.location || asset.type || 'Lokasi pada peta')}</small>
            </span>
            <span class="material-symbols-outlined" aria-hidden="true">center_focus_strong</span>
          </button>
        `).join('')
      : `
          <p>
            <span class="material-symbols-outlined" aria-hidden="true">location_off</span>
            Aset tidak ditemukan pada area aktif.
          </p>
        `
    assetResults.hidden = false
    assetSearch.setAttribute('aria-expanded', 'true')
  }

  function selectAssetResult(assetId) {
    if (!assetById[assetId]) return
    assetSearch.value = assetById[assetId].name || assetId
    closeAssetResults()
    handleAssetSelect(assetId)
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

  function toggleDeclutter() {
    state.declutterEnabled = !state.declutterEnabled
    const button = container.querySelector('.declutter-toggle')
    button.setAttribute('aria-pressed', String(state.declutterEnabled))
    button.title = state.declutterEnabled
      ? 'Sebarkan marker yang berdekatan tanpa mengubah koordinat KML'
      : 'Tampilkan tata letak adaptif'
    canvasApi.setDeclutterEnabled(state.declutterEnabled)
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

    if (!topologyReadiness.ready) {
      state.traceFromId = urlState.traceFrom
      state.traceStatus = 'error'
      state.traceError = topologyReadiness.message || TOPOLOGY_NOT_READY_MESSAGE
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
  assetSearch.addEventListener('input', (event) => {
    renderAssetResults(event.target.value)
  })
  assetSearch.addEventListener('focus', () => {
    renderAssetResults(assetSearch.value)
  })
  assetSearch.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && !assetResults.hidden) {
      event.preventDefault()
      assetResults.querySelector('button')?.focus()
    }
    if (event.key === 'Escape') closeAssetResults()
  })
  assetResults.addEventListener('click', (event) => {
    const result = event.target.closest('[data-map-asset-id]')
    if (result) selectAssetResult(result.dataset.mapAssetId)
  })
  assetResults.addEventListener('keydown', (event) => {
    const result = event.target.closest('[data-map-asset-id]')
    if (!result) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const buttons = [...assetResults.querySelectorAll('[data-map-asset-id]')]
      const currentIndex = buttons.indexOf(result)
      const nextIndex = event.key === 'ArrowDown'
        ? Math.min(buttons.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1)
      buttons[nextIndex]?.focus()
    }
    if (event.key === 'Escape') {
      closeAssetResults()
      assetSearch.focus()
    }
  })
  container.querySelector('.search-control input').addEventListener('input', (event) => {
    state.search = event.target.value
    renderNetworkList()
  })
  container.querySelector('.area-selector select')?.addEventListener('change', (event) => {
    const nextArea = event.target.value
    if (!locationGroups.some(({ key }) => key === nextArea) || nextArea === selectedArea?.key) {
      return
    }
    const params = new URLSearchParams(window.location.search)
    params.set('area', nextArea)
    params.delete('selectedAssetId')
    params.delete('traceFrom')
    params.delete('traceTo')
    canvasApi.destroy()
    window.location.assign(`${window.location.pathname}?${params}${window.location.hash}`)
  })
  container.querySelector('.map-category-presets').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category-preset]')
    if (!button) return
    const preset = button.dataset.categoryPreset
    const selectedNetworkIds = preset === 'all'
      ? networks.map(({ id }) => id)
      : networks.filter((network) => networkMatchesPreset(network, preset))
        .map(({ id }) => id)
    selection.replace({
      selectedNetworkIds,
      selectedAssetId: selection.selectedAssetId,
    })
    container.querySelectorAll('[data-category-preset]').forEach((item) => {
      const active = item === button
      item.classList.toggle('active', active)
      item.setAttribute('aria-pressed', String(active))
    })
    updateUrl()
    renderNetworkList()
    syncMap()
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
  container.querySelector('.declutter-toggle').addEventListener('click', toggleDeclutter)
  container.querySelector('.cancel-trace').addEventListener('click', stopTracing)
  container.querySelector('.dim-toggle').addEventListener('click', toggleInactiveMode)
  container.querySelector('.zoom-in').addEventListener('click', canvasApi.zoomIn)
  container.querySelector('.zoom-out').addEventListener('click', canvasApi.zoomOut)
  container.querySelector('.zoom-reset').addEventListener('click', canvasApi.reset)
  basemapToggle.addEventListener('click', toggleBasemapPicker)
  basemapPicker.querySelector('.close-basemap-picker').addEventListener('click', closeBasemapPicker)
  basemapPicker.addEventListener('click', (event) => {
    const option = event.target.closest('[data-basemap-mode]')
    if (option && !option.disabled) selectBasemapMode(option.dataset.basemapMode)
  })
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
      assetSearch.focus()
    }
    if (event.key !== 'Escape') return
    if (!assetResults.hidden) closeAssetResults()
    else if (!basemapPicker.hidden) closeBasemapPicker()
    else if (!legend.hidden) toggleLegend()
    else if (state.traceStatus !== 'idle') stopTracing()
    else if (selection.selectedAssetId) closeAssetDrawer()
    else if (workspace.classList.contains('sidebar-open')) closeMobileSidebar()
  })

  configureBasemapPicker()
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

export function findAssetMatches(assets, query, limit = 8) {
  const normalizedQuery = String(query ?? '').trim().toLocaleLowerCase('id')
  if (normalizedQuery.length < 2) return []

  return assets
    .map((asset, index) => {
      const fields = [
        asset.id,
        asset.name,
        asset.location,
        asset.type,
        asset.category,
      ].map((value) => String(value ?? '').toLocaleLowerCase('id'))
      const exact = fields.some((value) => value === normalizedQuery)
      const startsWith = fields.some((value) => value.startsWith(normalizedQuery))
      const includes = fields.some((value) => value.includes(normalizedQuery))
      if (!includes) return null
      return {
        asset,
        index,
        score: exact ? 0 : startsWith ? 1 : 2,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (
      left.score - right.score
      || String(left.asset.name || left.asset.id).localeCompare(
        String(right.asset.name || right.asset.id),
        'id',
      )
      || left.index - right.index
    ))
    .slice(0, limit)
    .map(({ asset }) => asset)
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

export function selectLocationGroup(search, locationGroups = []) {
  const requested = new URLSearchParams(search).get('area')
  return locationGroups.find(({ key }) => key === requested) ?? locationGroups[0] ?? null
}

export function scopeMapData({
  selectedArea,
  assets,
  diagramAssets,
  geometries,
  exportAssets,
  networks,
  topologyGraph,
}) {
  const areaKey = selectedArea?.key
  const scopedAssets = areaKey
    ? assets.filter(({ locationGroupKey }) => locationGroupKey === areaKey)
    : [...assets]
  const scopedGeometries = areaKey
    ? geometries.filter(({ locationGroupKey }) => locationGroupKey === areaKey)
    : [...geometries]
  const scopedAssetIds = new Set(scopedAssets.map(({ id }) => id))
  const scopedGeometryIds = new Set(scopedGeometries.map(({ id }) => id))
  const scopedNetworks = networks.map((network) => {
    const nodeIds = network.nodeIds.filter((id) => scopedAssetIds.has(id))
    const geometryIds = network.geometryIds.filter((id) => scopedGeometryIds.has(id))
    const relations = (network.relations ?? []).filter((relation) => (
      scopedAssetIds.has(relation.sourceAssetId)
      && scopedAssetIds.has(relation.targetAssetId)
    ))
    const geometryAssetIds = scopedGeometries
      .filter(({ id }) => geometryIds.includes(id))
      .map(({ assetId }) => assetId)
      .filter(Boolean)
    const assetIds = [...new Set([...nodeIds, ...geometryAssetIds])]
    const networkGeometries = scopedGeometries.filter(({ id }) => geometryIds.includes(id))
    return {
      ...network,
      nodeIds,
      geometryIds,
      geometryAssetIds,
      assetIds,
      relations,
      relationIds: relations.map(({ id }) => id),
      edges: relations.map(({ sourceAssetId, targetAssetId }) => [sourceAssetId, targetAssetId]),
      assetCount: assetIds.length,
      nodeCount: nodeIds.length,
      lineCount: networkGeometries.filter(
        ({ geometryType }) => geometryType === 'line_string',
      ).length,
      polygonCount: networkGeometries.filter(
        ({ geometryType }) => geometryType === 'polygon',
      ).length,
      ...(selectedArea?.bounds ? { bounds: selectedArea.bounds } : {}),
    }
  }).filter((network) => network.nodeIds.length || network.geometryIds.length)
  const edges = (topologyGraph.edges ?? []).filter((edge) => {
    const sourceId = edge.sourceAssetId ?? edge.sourceNodeId
    const targetId = edge.targetAssetId ?? edge.targetNodeId
    return scopedAssetIds.has(sourceId) && scopedAssetIds.has(targetId)
  })
  const nodes = (topologyGraph.nodes ?? []).filter((node) => (
    scopedAssetIds.has(node.id) || scopedAssetIds.has(node.assetId)
  ))
  const scopedExportAssetIds = new Set([
    ...scopedAssetIds,
    ...scopedGeometries.map(({ assetId }) => assetId).filter(Boolean),
  ])
  return {
    assets: scopedAssets,
    assetById: Object.fromEntries(scopedAssets.map((asset) => [asset.id, asset])),
    diagramAssets: diagramAssets.filter((asset) => (
      asset.locationGroupKey === areaKey || !areaKey
    )),
    geometries: scopedGeometries,
    exportAssets: exportAssets.filter(({ id }) => scopedExportAssetIds.has(id)),
    networks: scopedNetworks,
    topologyGraph: { ...topologyGraph, nodes, edges },
    counts: {
      networkCount: scopedNetworks.length,
      layerCount: new Set([
        ...scopedAssets.map(({ layerId }) => layerId),
        ...scopedGeometries.map(({ layerId }) => layerId),
      ].filter(Boolean)).size,
      assetCount: scopedExportAssetIds.size,
      assetNodeCount: scopedAssets.length,
      pointCount: scopedGeometries.filter(({ geometryType }) => geometryType === 'point').length,
      lineCount: scopedGeometries.filter(
        ({ geometryType }) => geometryType === 'line_string',
      ).length,
      polygonCount: scopedGeometries.filter(
        ({ geometryType }) => geometryType === 'polygon',
      ).length,
      geometryCount: scopedGeometries.length,
    },
  }
}

function overlayMatchesArea(overlay, selectedArea) {
  if (!selectedArea) return true
  return locationGroupFor(overlay.sourceFolderPath).locationGroupKey === selectedArea.key
}

function networkMatchesPreset(network, preset) {
  const source = `${network.category ?? ''} ${network.type ?? ''} ${network.name ?? ''}`.toLowerCase()
  if (preset === 'cctv') return /cctv|camera|kamera|nvr|junction/.test(source)
  if (preset === 'fiber') return /fiber|fibre|\bfo\b|otb/.test(source)
  if (preset === 'lan') return /\blan\b|utp/.test(source)
  if (preset === 'infrastructure') {
    return /infrastructure|switch|server|router|rack|peripheral|printer|access point/.test(source)
  }
  return true
}

export function renderTopNavigation(activeView = 'map', context = null) {
  const contextParams = context?.datasetId
    ? new URLSearchParams({
      datasetId: context.datasetId,
      branchId: context.branchId,
    })
    : null
  if (contextParams && context.area) contextParams.set('area', context.area)
  const contextQuery = contextParams ? `?${contextParams}` : ''
  return `
    <header class="top-navigation">
      <a class="brand-lockup nav-brand" href="/" aria-label="SINERGI">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span><strong>SINERGI</strong><small>Asset Network</small></span>
      </a>
      <nav aria-label="Navigasi utama">
        <a href="/map${contextQuery}" class="${activeView === 'map' ? 'active' : ''}">
          <span class="material-symbols-outlined" aria-hidden="true">map</span>Peta Aset
        </a>
        <a href="/topology${contextQuery}" class="${activeView === 'topology' ? 'active' : ''}">
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>Topologi Cabang
        </a>
        <a href="/admin/topology-review${contextQuery}"
          class="${activeView === 'review' ? 'active' : ''}">
          <span class="material-symbols-outlined" aria-hidden="true">fact_check</span>
          Konfirmasi Koneksi
        </a>
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
