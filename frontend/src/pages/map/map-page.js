import {
  adaptActiveAssetDetail,
  adaptActiveDatasetForMap,
  locationGroupFor,
} from '../../adapters/active-dataset-map-adapter.js'
import {
  loadActiveAssetDetail,
  loadActiveDataset,
  loadDatasetProjection,
  loadTopologyProjection,
  traceTopology,
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
    topologySummary: datasetTopologySummary,
    locationGroups,
    renderingSummary,
  } = mapData
  const topologyReadiness = mapData.topologyReadiness ?? {
    ready: false,
    traceAvailable: false,
    diagramAvailable: false,
    message: TOPOLOGY_NOT_READY_MESSAGE,
  }
  const globalTraceAvailable = topologyReadiness.traceAvailable
    ?? topologyReadiness.ready
    ?? false
  const globalDiagramAvailable = topologyReadiness.diagramAvailable
    ?? topologyReadiness.ready
    ?? false
  const operationalTopologyGraph = globalTraceAvailable
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
  const traceAvailable = globalTraceAvailable && topologyGraph.edges.length > 0
  const diagramAvailable = globalDiagramAvailable && assets.length > 0
  const topologySummary = summarizeMapTopology({
    assets,
    topologyGraph,
    datasetTopologySummary,
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
    traceResult: null,
    traceGraphRevision: topologyGraph.graphRevision ?? null,
    assetDetailStatus: 'ready',
    assetDetailError: null,
    showAdditionalMetadata: false,
    dimOthers: true,
    search: '',
    expandedNetworkIds: new Set(),
    focusedNetworkId: null,
    dataStatus: 'loading',
    dataError: null,
  }
  let traceRequestId = 0

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
          topologySummary,
        })}
        ${renderNetworkMapCanvas(activeContext, {
          empty: !hasRenderableData,
          assetsWithoutGeometry: renderingSummary.assetsWithoutGeometry,
          selectedArea,
          counts,
          confirmedConnectionCount: traceAvailable ? topologyGraph.edges.length : 0,
          topologySummary,
          selectedAssetId: initialUrlState.selectedAssetId,
          topologyReadiness,
        })}
      </main>
    </div>
  `
  bindUserAccountMenu()

  const workspace = container.querySelector('.map-workspace')
  const sidebar = container.querySelector('.network-sidebar')
  const networkList = container.querySelector('.network-list')
  const drawer = container.querySelector('.asset-drawer')
  const sidebarToggle = container.querySelector('.sidebar-collapse')
  const sidebarReopen = container.querySelector('.open-sidebar')
  const mobileMapTabs = [...container.querySelectorAll('[data-mobile-map-tab]')]
  const areaSelect = container.querySelector('.area-selector select')
  const legendToggle = container.querySelector('.legend-toggle')
  const legend = container.querySelector('.legend-popover')
  const basemapToggle = container.querySelector('.basemap-toggle')
  const basemapPicker = container.querySelector('.basemap-popover')
  const assetSearch = container.querySelector('.search-control input')
  const assetResults = container.querySelector('.sidebar-asset-search-results')
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
    const mapStage = container.querySelector('.map-stage')
    if (!mapStage) return
    mapStage.dataset.visibleLabels = String(status.visibleLabelCount || 0)
    mapStage.dataset.displacedAssets = String(status.displacedAssetCount || 0)
    mapStage.dataset.markerClusters = String(status.clusterCount || 0)
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
      focusedNetworkId: state.focusedNetworkId,
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
      traceGeometryIds: state.traceRelations.flatMap((relation) => (
        relation.sourceGeometryIds ?? []
      )),
      connectedNodeIds,
      dimOthers: state.dimOthers,
    })
    syncToolbarState(connectedNodeIds.length)
  }

  function syncToolbarState(connectedCount = 0) {
    const traceButton = container.querySelector('.trace-toggle')
    const selectedAsset = assetById[selection.selectedAssetId]
    traceButton.disabled = !traceAvailable
    traceButton.setAttribute('aria-disabled', String(!traceAvailable))
    traceButton.title = !traceAvailable
      ? topologyReadiness.traceMessage || topologyReadiness.message || TOPOLOGY_NOT_READY_MESSAGE
      : selectedAsset && connectedCount > 0
        ? `Telusuri koneksi dari ${selectedAsset.name || selectedAsset.id}`
        : 'Klik lalu pilih aset awal pada peta.'

    const diagramButton = container.querySelector('.diagram-toggle')
    diagramButton.disabled = !diagramAvailable
    diagramButton.setAttribute('aria-disabled', String(!diagramAvailable))
    diagramButton.title = diagramAvailable
      ? 'Buka Diagram Topologi 2D dari graph terkonfirmasi.'
      : topologyReadiness.message || topologyReadiness.traceMessage || TOPOLOGY_NOT_READY_MESSAGE
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
    const reviewQuery = new URLSearchParams({
      datasetId: activeContext.datasetId,
      branchId: activeContext.branchId,
      selectedAssetId: asset.id,
    })
    if (selectedArea?.key) reviewQuery.set('area', selectedArea.key)
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
      traceAvailable,
      diagramAvailable,
      topologySummary,
      reviewUrl: topologyReadiness.capabilities?.reviewTopology
        ? `/admin/topology-review?${reviewQuery}`
        : null,
      topologyMessage: topologyReadiness.traceMessage
        || topologyReadiness.message
        || TOPOLOGY_NOT_READY_MESSAGE,
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
      toggleNetworkFocus(networkId)
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
      sourceAssetId: state.traceResult?.sourceAssetId ?? state.traceFromId,
      targetAssetId: state.traceResult?.targetAssetId ?? state.traceToId,
      graphRevision: state.traceResult?.graphRevision ?? state.traceGraphRevision,
      hopCount: state.traceResult?.hopCount ?? null,
      totalLengthMeters: state.traceResult?.totalLengthMeters ?? null,
      networkFamily: state.traceResult?.networkFamily ?? null,
      verifiedAt: state.traceResult?.verifiedAt ?? null,
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
    closeAssetResults()
    banner.hidden = false
    const step = banner.querySelector('.trace-step')
    const title = banner.querySelector('strong')
    const description = banner.querySelector('.trace-step + div span')
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
    state.traceResult = null
    state.traceGraphRevision = topologyGraph.graphRevision ?? null
  }

  async function beginTracing(startId = null, { historyMode = 'push' } = {}) {
    const requestId = ++traceRequestId
    resetTraceState()
    if (!traceAvailable) {
      state.traceStatus = 'error'
      state.traceError = topologyReadiness.traceMessage
        || topologyReadiness.message
        || TOPOLOGY_NOT_READY_MESSAGE
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
      state.traceError = 'Aset ini belum terdaftar sebagai node topology.'
      updateUrl(historyMode)
      updateTraceBanner()
      renderDrawer()
      syncMap()
      return
    }
    state.traceFromId = startId
    state.tracePath = [startId]
    state.traceStatus = 'loading'
    state.traceError = null
    state.traceGraphRevision = topologyGraph.graphRevision ?? null
    updateUrl(historyMode)
    updateTraceBanner()
    renderDrawer()
    syncMap()

    try {
      // The active dataset can be regenerated while this page remains open.
      // Refresh the authoritative graph revision before tracing so a stale
      // local projection cannot falsely report that an asset has no links.
      const latestGraph = await loadTopologyProjection({
        datasetVersionId: activeContext.datasetVersionId,
        projection: 'graph',
      })
      state.traceGraphRevision = latestGraph.graph?.graphRevision
        ?? latestGraph.graphRevision
        ?? state.traceGraphRevision
      const result = await traceTopology({
        datasetVersionId: activeContext.datasetVersionId,
        sourceAssetId: startId,
        graphRevision: state.traceGraphRevision,
        direction: 'both',
        scopeAssetIds: validIds.assetIds,
      })
      if (requestId !== traceRequestId) return
      state.traceResult = result
      state.traceGraphRevision = result.graphRevision || state.traceGraphRevision
      if (result.status === 'destinations' && result.destinations?.length) {
        state.traceCandidates = result.destinations
          .filter(({ assetId }) => assetById[assetId])
          .sort((left, right) => left.distance - right.distance
            || assetById[left.assetId].name.localeCompare(assetById[right.assetId].name, 'id'))
        state.traceStatus = state.traceCandidates.length ? 'choosing' : 'error'
        state.traceError = state.traceCandidates.length
          ? null
          : 'Target berada di luar area peta yang sedang dipilih.'
      } else {
        state.traceStatus = 'error'
        state.traceCandidates = []
        state.traceError = result.message || 'Belum ada koneksi terkonfirmasi dari aset ini.'
      }
    } catch (error) {
      if (requestId !== traceRequestId) return
      state.traceStatus = 'error'
      state.traceError = traceErrorMessage(error)
      state.traceCandidates = []
    }
    updateUrl(historyMode)
    updateTraceBanner()
    renderDrawer()
    syncMap()
  }

  function toggleNetworkFocus(networkId) {
    if (!networks.some(({ id }) => id === networkId)) return
    state.focusedNetworkId = state.focusedNetworkId === networkId ? null : networkId
    canvasApi.setFocusedNetworkId(state.focusedNetworkId)
    renderNetworkList()
    if (state.focusedNetworkId) canvasApi.focusNetworkBounds(state.focusedNetworkId)
  }

  async function runTraceTo(targetId, { historyMode = 'push' } = {}) {
    if (!traceAvailable) {
      beginTracing(null, { historyMode })
      return
    }
    if (!state.traceFromId) {
      beginTracing(selection.selectedAssetId)
      return
    }

    const requestId = ++traceRequestId
    state.traceToId = targetId
    state.traceStatus = 'loading'
    state.traceError = null
    state.traceResult = null
    updateTraceBanner()
    renderDrawer()
    syncMap()

    try {
      const result = await traceTopology({
        datasetVersionId: activeContext.datasetVersionId,
        sourceAssetId: state.traceFromId,
        targetAssetId: targetId,
        graphRevision: topologyGraph.graphRevision,
        direction: 'both',
        scopeAssetIds: validIds.assetIds,
      })
      if (requestId !== traceRequestId) return
      state.traceResult = result
      state.traceGraphRevision = result.graphRevision || state.traceGraphRevision
      if (result.status === 'found' && result.nodeIds?.length > 1) {
        state.traceStatus = 'active'
        state.tracePath = result.nodeIds.filter((assetId) => assetById[assetId])
        state.traceRelations = toUiTraceRelations(result.edges)
        state.traceExplanation = result.explanation
        state.traceError = null
        updateUrl(historyMode)
        canvasApi.focusAssetBounds(state.tracePath)
      } else {
        state.traceStatus = 'error'
        state.tracePath = state.traceFromId ? [state.traceFromId] : []
        state.traceRelations = []
        state.traceExplanation = null
        state.traceError = result.message || 'Tujuan tracing tidak dapat digunakan.'
        updateUrl(historyMode)
      }
    } catch (error) {
      if (requestId !== traceRequestId) return
      state.traceStatus = 'error'
      state.tracePath = state.traceFromId ? [state.traceFromId] : []
      state.traceRelations = []
      state.traceExplanation = null
      state.traceResult = null
      state.traceError = traceErrorMessage(error)
      updateUrl(historyMode)
    }
    updateTraceBanner()
    renderDrawer()
    syncMap()
  }

  function stopTracing() {
    traceRequestId += 1
    resetTraceState()
    updateUrl()
    updateTraceBanner()
    syncMap()
    renderDrawer()
  }

  function openSchematic() {
    if (!diagramAvailable) {
      state.traceStatus = 'error'
      state.traceError = topologyReadiness.message
        || topologyReadiness.traceMessage
        || TOPOLOGY_NOT_READY_MESSAGE
      updateTraceBanner()
      renderDrawer()
      return
    }
    const allAssetsGraph = buildSchematicGraph({
      assets: diagramAssets,
      networks,
      topologyGraph,
      scope: 'all-assets',
      topologyReady: topologyReadiness.ready,
    })
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
    const selectedAssetGraph = buildSchematicGraph({
      assets,
      networks,
      topologyGraph,
      focusedAssetId: selection.selectedAssetId,
      scope: 'selected',
      topologyReady: topologyReadiness.ready,
    })
    openSchematicDialog({
      diagrams: {
        'all-assets': {
          graph: allAssetsGraph,
          layout: calculateSchematicLayout(allAssetsGraph, { preserveMapOrientation: true }),
        },
        'full-map': {
          graph: fullMapGraph,
          layout: calculateSchematicLayout(fullMapGraph, { preserveMapOrientation: true }),
        },
        trace: {
          graph: traceGraph,
          layout: calculateSchematicLayout(traceGraph, { preserveMapOrientation: true }),
        },
        selected: {
          graph: selectedAssetGraph,
          layout: calculateSchematicLayout(selectedAssetGraph),
        },
      },
      activeContext,
      selectedAssetId: selection.selectedAssetId,
      initialMode: state.traceStatus === 'active'
        ? 'trace'
        : selection.selectedAssetId
          ? 'selected'
          : 'all-assets',
      onSelectAsset: selectAssetFromDiagram,
    })
  }

  function traceErrorMessage(error) {
    if (error?.code === 'topology_graph_stale') {
      return 'Dataset atau graph berubah. Muat ulang peta untuk menggunakan versi terbaru.'
    }
    if (error?.code === 'topology_graph_invalid') {
      return 'Tracing dihentikan karena confirmed graph tidak valid.'
    }
    return error?.message || 'Layanan tracing tidak dapat digunakan.'
  }

  function toUiTraceRelations(edges = []) {
    return edges.map((edge) => ({
      ...edge,
      id: edge.edgeId || edge.id,
      sourceGeometryId: edge.sourceGeometryIds?.[0] || edge.sourceGeometryId,
      sourceGeometryIds: edge.sourceGeometryIds ?? [],
      relationStatus: edge.verificationStatus || 'confirmed',
      networkId: edge.networkId || null,
    }))
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
      topologyReady: diagramAvailable,
      topologyMessage: topologyReadiness.message
        || topologyReadiness.traceMessage
        || TOPOLOGY_NOT_READY_MESSAGE,
    })
  }

  function selectAssetFromDiagram(assetId) {
    handleAssetSelect(assetId)
  }

  function setMobileMapTab(tab) {
    mobileMapTabs.forEach((button) => {
      const active = button.dataset.mobileMapTab === tab
      button.classList.toggle('active', active)
      if (active) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    })
  }

  function openMobileSidebar(mode = 'layers') {
    workspace.classList.add('sidebar-open')
    workspace.dataset.mobilePanel = mode
    setMobileMapTab(mode === 'assets' ? 'assets' : 'layers')
    sidebarReopen.setAttribute('aria-expanded', 'true')
    invalidateMapAfterPanelChange(sidebar)
    if (mode === 'assets') window.requestAnimationFrame(() => assetSearch.focus())
  }

  function closeMobileSidebar() {
    workspace.classList.remove('sidebar-open')
    delete workspace.dataset.mobilePanel
    setMobileMapTab('map')
    sidebarReopen.setAttribute('aria-expanded', 'false')
    invalidateMapAfterPanelChange(sidebar)
  }

  function closeDesktopSidebar() {
    workspace.classList.add('sidebar-collapsed')
    sidebarToggle.setAttribute('aria-expanded', 'false')
    sidebarReopen.setAttribute('aria-expanded', 'false')
    invalidateMapAfterPanelChange(sidebar)
  }

  function reopenDesktopSidebar() {
    workspace.classList.remove('sidebar-collapsed')
    sidebarToggle.setAttribute('aria-expanded', 'true')
    sidebarReopen.setAttribute('aria-expanded', 'false')
    invalidateMapAfterPanelChange(sidebar)
  }

  function openSidebar() {
    if (window.matchMedia('(max-width: 960px)').matches) openMobileSidebar()
    else reopenDesktopSidebar()
  }

  function setAreaSelectorExpanded(expanded) {
    areaSelect?.setAttribute('aria-expanded', String(expanded))
    areaSelect?.closest('.area-selector-control')?.classList.toggle('is-open', expanded)
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
              <strong title="${escapePageHtml(displayAssetName(asset))}">${escapePageHtml(displayAssetName(asset))}</strong>
              <small title="${escapePageHtml(asset.location || 'Lokasi tidak tersedia')}">
                ${escapePageHtml(asset.type || 'Jenis aset belum tersedia')} &middot; ${escapePageHtml(asset.location || 'Lokasi belum tersedia')}
              </small>
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
    assetSearch.value = displayAssetName(assetById[assetId])
    state.search = assetSearch.value
    closeAssetResults()
    renderNetworkList()
    handleAssetSelect(assetId)
  }

  function refreshDeclutter() {
    canvasApi.setDeclutterEnabled(true)
    canvasApi.invalidateSize?.()
    container.querySelector('.map-more-menu')?.removeAttribute('open')
  }

  function beginToolbarTracing() {
    const selectedAssetId = selection.selectedAssetId
    const selectedHasRelations = selectedAssetId
      && getConnectedAssets(relationGraph, selectedAssetId).length > 0
    beginTracing(selectedHasRelations ? selectedAssetId : null)
  }

  async function restoreStateFromUrl() {
    const urlState = parseMapUrlState(window.location.search, validIds)
    selection.replace(urlState)
    await restoreTraceState(urlState)
    renderNetworkList()
    renderDrawer()
    syncMap()
  }

  async function restoreTraceState(urlState) {
    if (!urlState.traceFrom) {
      traceRequestId += 1
      resetTraceState()
      updateTraceBanner()
      return
    }
    await beginTracing(urlState.traceFrom, { historyMode: 'replace' })
    if (urlState.traceTo && state.traceStatus === 'choosing') {
      await runTraceTo(urlState.traceTo, { historyMode: 'replace' })
    }
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
      toggleNetworkFocus(focusButton.dataset.networkFocus)
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
    state.search = event.target.value
    renderNetworkList()
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
  areaSelect?.addEventListener('pointerdown', () => setAreaSelectorExpanded(true))
  areaSelect?.addEventListener('blur', () => setAreaSelectorExpanded(false))
  areaSelect?.addEventListener('keydown', (event) => {
    if ((event.altKey && event.key === 'ArrowDown') || event.key === ' ') {
      setAreaSelectorExpanded(true)
    }
    if (event.key === 'Escape' || event.key === 'Tab') setAreaSelectorExpanded(false)
  })
  areaSelect?.addEventListener('change', (event) => {
    setAreaSelectorExpanded(false)
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
  container.querySelectorAll('.export-toggle').forEach((button) => button.addEventListener('click', () => {
    openDataTransfer('export')
    container.querySelector('.map-more-menu')?.removeAttribute('open')
  }))
  container.querySelector('.import-toggle')?.addEventListener('click', () => {
    openDataTransfer('import')
    container.querySelector('.map-more-menu')?.removeAttribute('open')
  })
  container.querySelector('.manage-dataset-toggle').addEventListener('click', () => {
    openDataTransfer('import')
    container.querySelector('.map-more-menu')?.removeAttribute('open')
  })
  container.querySelector('.trace-toggle').addEventListener('click', beginToolbarTracing)
  container.querySelector('.diagram-toggle').addEventListener('click', openSchematic)
  container.querySelector('.declutter-toggle').addEventListener('click', refreshDeclutter)
  container.querySelector('.cancel-trace').addEventListener('click', stopTracing)
  container.querySelector('.zoom-in').addEventListener('click', canvasApi.zoomIn)
  container.querySelector('.zoom-out').addEventListener('click', canvasApi.zoomOut)
  container.querySelector('.zoom-reset').addEventListener('click', canvasApi.reset)
  basemapToggle.addEventListener('click', toggleBasemapPicker)
  basemapPicker.querySelector('.close-basemap-picker').addEventListener('click', closeBasemapPicker)
  basemapPicker.addEventListener('click', (event) => {
    const option = event.target.closest('[data-basemap-mode]')
    if (option && !option.disabled) selectBasemapMode(option.dataset.basemapMode)
  })
  sidebarReopen.addEventListener('click', openSidebar)
  mobileMapTabs.forEach((button) => button.addEventListener('click', () => {
    const tab = button.dataset.mobileMapTab
    if (tab === 'map') closeMobileSidebar()
    else openMobileSidebar(tab)
  }))
  container.querySelector('.close-sidebar').addEventListener('click', closeMobileSidebar)
  sidebarToggle.addEventListener('click', closeDesktopSidebar)
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
  void restoreStateFromUrl()
  updateUrl('replace')
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
  bindUserAccountMenu()
}

let userAccountMenuInteractionsBound = false

export function bindUserAccountMenu() {
  if (userAccountMenuInteractionsBound || typeof document === 'undefined') return
  userAccountMenuInteractionsBound = true

  document.addEventListener('click', (event) => {
    const target = event.target
    const trigger = target?.closest?.('[data-user-account-trigger]')
    if (trigger) {
      const menu = trigger.closest('[data-user-account-menu]')
      if (!menu) return

      const wasOpen = trigger.getAttribute('aria-expanded') === 'true'
      closeUserAccountMenus()
      if (!wasOpen) openUserAccountMenu(menu)
      return
    }

    if (target?.closest?.('[data-user-account-item]')) {
      closeUserAccountMenus()
      return
    }

    if (!target?.closest?.('[data-user-account-menu]')) closeUserAccountMenus()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    const openMenu = document.querySelector('[data-user-account-menu].is-open')
    if (!openMenu) return

    event.preventDefault()
    closeUserAccountMenus()
    openMenu.querySelector('[data-user-account-trigger]')?.focus()
  })
}

function openUserAccountMenu(menu) {
  const trigger = menu.querySelector('[data-user-account-trigger]')
  const dropdown = menu.querySelector('[data-user-account-dropdown]')
  if (!trigger || !dropdown) return

  menu.classList.add('is-open')
  trigger.setAttribute('aria-expanded', 'true')
  dropdown.hidden = false
}

function closeUserAccountMenus() {
  document.querySelectorAll('[data-user-account-menu].is-open').forEach((menu) => {
    menu.classList.remove('is-open')
    menu.querySelector('[data-user-account-trigger]')?.setAttribute('aria-expanded', 'false')
    const dropdown = menu.querySelector('[data-user-account-dropdown]')
    if (dropdown) dropdown.hidden = true
  })
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
        asset.hostname,
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

export function displayAssetName(asset) {
  return String(asset?.name || '').trim() || 'Aset tanpa nama'
}

export function summarizeMapTopology({
  assets = [],
  topologyGraph = {},
  datasetTopologySummary = {},
} = {}) {
  const connectedAssetIds = new Set((topologyGraph.edges ?? []).flatMap((edge) => [
    edge.sourceAssetId ?? edge.sourceNodeId,
    edge.targetAssetId ?? edge.targetNodeId,
  ].filter(Boolean)))
  return {
    confirmedConnectionCount: (topologyGraph.edges ?? []).length,
    pendingConnectionCount: Number(datasetTopologySummary.candidateCount || 0)
      + Number(datasetTopologySummary.ambiguousCount || 0),
    isolatedAssetCount: assets.filter(({ id }) => !connectedAssetIds.has(id)).length,
    pendingScope: 'dataset',
  }
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
  const edges = (topologyGraph.edges ?? []).filter((edge) => {
    const sourceId = edge.sourceAssetId ?? edge.sourceNodeId
    const targetId = edge.targetAssetId ?? edge.targetNodeId
    return scopedAssetIds.has(sourceId) && scopedAssetIds.has(targetId)
  })
  const degreeByNode = Object.fromEntries([...scopedAssetIds].map((assetId) => [assetId, 0]))
  edges.forEach((edge) => {
    const sourceId = edge.sourceAssetId ?? edge.sourceNodeId
    const targetId = edge.targetAssetId ?? edge.targetNodeId
    degreeByNode[sourceId] = (degreeByNode[sourceId] ?? 0) + 1
    degreeByNode[targetId] = (degreeByNode[targetId] ?? 0) + 1
  })
  const isolatedNodeIds = [...scopedAssetIds].filter((assetId) => !degreeByNode[assetId])
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
    const relationAssetIds = new Set(relations.flatMap(({ sourceAssetId, targetAssetId }) => (
      [sourceAssetId, targetAssetId]
    )))
    return {
      ...network,
      nodeIds,
      geometryIds,
      geometryAssetIds,
      assetIds,
      relations,
      relationIds: relations.map(({ id }) => id),
      edges: relations.map(({ sourceAssetId, targetAssetId }) => [sourceAssetId, targetAssetId]),
      confirmedConnectionCount: relations.length,
      isolatedAssetCount: nodeIds.filter((assetId) => !relationAssetIds.has(assetId)).length,
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
    topologyGraph: {
      ...topologyGraph,
      nodes,
      edges,
      degreeByNode,
      isolatedNodeIds,
    },
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
        <div class="user-account-menu" data-user-account-menu>
          <button class="user-menu" data-user-account-trigger type="button"
            aria-label="Menu akun SSC ICT" aria-haspopup="menu" aria-expanded="false"
            aria-controls="user-account-dropdown">
            <span class="user-menu-avatar" aria-hidden="true">SI</span>
            <span class="user-menu-identity"><strong>SSC ICT</strong><small>Administrator</small></span>
            <span class="material-symbols-outlined user-menu-chevron" aria-hidden="true">expand_more</span>
          </button>
          <div class="user-menu-dropdown" data-user-account-dropdown id="user-account-dropdown"
            role="menu" aria-label="Menu akun" hidden>
            <div class="user-menu-dropdown-items">
              <button class="user-menu-dropdown-item" data-user-account-item type="button" role="menuitem">
                <span class="material-symbols-outlined" aria-hidden="true">person</span>
                <span>Profil Saya</span>
              </button>
              <button class="user-menu-dropdown-item" data-user-account-item type="button" role="menuitem">
                <span class="material-symbols-outlined" aria-hidden="true">settings</span>
                <span>Pengaturan Akun</span>
              </button>
            </div>
            <div class="user-menu-dropdown-divider" role="presentation"></div>
            <div class="user-menu-dropdown-items user-menu-dropdown-items-last">
              <button class="user-menu-dropdown-item" data-user-account-item type="button" role="menuitem">
                <span class="material-symbols-outlined" aria-hidden="true">logout</span>
                <span>Keluar</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  `
}
