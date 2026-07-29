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
import { buildScopedGraph, segmentSchematicGraph } from './schematic-graph.js'
import { calculateSchematicLayout } from './schematic-layout.js'
import { resolveSiteScope } from '../../domain/site-scope.js'
import {
  calculateMapSafeArea,
  createTracingState,
  getTraceInstruction,
  isTracingSelectionState,
  reduceTracingState,
} from './map-tools-state.js'

export async function renderMapPage(container) {
  container.__sinergiMapCleanup?.()
  container.__sinergiMapCleanup = null
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
    mapData = adaptActiveDatasetForMap(payload, {
      siteScopeId: requestedContext.siteScopeId,
    })
    window.sessionStorage.setItem('sinergiActiveDatasetId', mapData.activeContext.datasetId)
    window.sessionStorage.setItem('sinergiActiveBranchId', mapData.activeContext.branchId)
    window.sessionStorage.setItem('sinergiActiveSiteScopeId', mapData.activeContext.siteScopeId)
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
          branchName: resolveSiteScope(requestedContext.siteScopeId).displayName,
          siteScopeName: resolveSiteScope(requestedContext.siteScopeId).displayName,
          datasetVersionId: null,
          version: 'Belum ada dataset aktif',
        },
        initialMode: 'import',
        onActivated: () => renderMapPage(container),
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
    layers,
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
  let traceRequestId = 0
  const state = {
    trace: createTracingState(),
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
  const mapStage = container.querySelector('.map-stage')
  const contextPill = container.querySelector('.map-context-pill')
  const floatingTop = container.querySelector('.map-floating-top')
  const floatingBottom = container.querySelector('.map-floating-bottom')
  let currentGeographicViewportBounds = null
  const canvasApi = createMapCanvas(container.querySelector('#network-map'), {
    assets,
    networks,
    geometries,
    onSelectAsset: handleAssetSelect,
    onSelectNetwork: handleNetworkSelect,
    onViewportChange: (bounds) => {
      currentGeographicViewportBounds = bounds
    },
  })
  const topologyNodeIds = new Set(
    (topologyGraph?.nodes || []).map((node) => node.id || node.assetId),
  )
  const validTraceNodeIds = topologyNodeIds.size
    ? topologyNodeIds
    : new Set(relationGraph.keys())
  const traceToggle = container.querySelector('.trace-toggle')
  if (!validTraceNodeIds.size) {
    traceToggle.disabled = true
    traceToggle.title = 'Tracing belum tersedia karena graph topologi kosong.'
    traceToggle.setAttribute('aria-description', traceToggle.title)
  }

  function updateUrl(mode = 'push') {
    const query = serializeMapUrlState(window.location.search, {
      selectedNetworkIds: selection.selectedNetworkIds,
      selectedAssetId: selection.selectedAssetId,
      traceFrom: state.trace.fromId,
      traceTo: state.trace.toId,
      siteScopeId: activeContext.siteScopeId,
    })
    const nextUrl = `${window.location.pathname}?${query}${window.location.hash}`
    window.history[`${mode}State`](null, '', nextUrl)
  }

  function invalidateMapAfterPanelChange(panel) {
    window.requestAnimationFrame(canvasApi.invalidateSize)
    window.requestAnimationFrame(updateMapSafeArea)
    panel?.addEventListener('transitionend', () => {
      canvasApi.invalidateSize()
      updateMapSafeArea()
    }, { once: true })
  }

  function updateMapSafeArea() {
    if (!mapStage?.isConnected) return
    const compactPanels = window.matchMedia('(max-width: 960px)').matches
    const safeArea = calculateMapSafeArea({
      stageRect: mapStage.getBoundingClientRect(),
      contextRect: contextPill?.getBoundingClientRect(),
      toolbarRect: floatingTop?.getBoundingClientRect(),
      bottomToolsRect: floatingBottom?.getBoundingClientRect(),
      sidebarRect: sidebar?.getBoundingClientRect(),
      drawerRect: drawer?.getBoundingClientRect(),
      sidebarOpen: compactPanels && workspace.classList.contains('sidebar-open'),
      drawerOpen: workspace.classList.contains('drawer-open'),
      compactPanels,
    })
    for (const [name, value] of Object.entries(safeArea)) {
      mapStage.style.setProperty(`--map-safe-${name}`, `${Math.round(value)}px`)
    }
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
    const allSelected = networks.length > 0
      && selection.selectedNetworkIds.size === networks.length
    setDisabledReason(
      container.querySelector('.show-all-networks'),
      allSelected,
      'Semua jaringan sudah ditampilkan.',
    )
    setDisabledReason(
      container.querySelector('.hide-all-networks'),
      selection.selectedNetworkIds.size === 0,
      'Semua jaringan sudah disembunyikan.',
    )
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
      traceNodeIds: [
        ...new Set([
          ...state.trace.path,
          state.trace.fromId,
          state.trace.toId,
        ].filter(Boolean)),
      ],
      connectedNodeIds,
      dimOthers: state.dimOthers,
      selectableAssetIds: isTracingSelectionState(state.trace.status)
        ? validTraceNodeIds
        : null,
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
    if (isTracingSelectionState(state.trace.status) && !validTraceNodeIds.has(assetId)) return
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

    if (state.trace.status === 'selecting_start') {
      beginTracing(assetId)
      return
    }
    if (state.trace.status === 'selecting_end' && state.trace.fromId !== assetId) {
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
    drawer.querySelector('.open-schematic')?.addEventListener('click', () => {
      openSchematic('focus-depth-1')
    })
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
      status: state.trace.status,
      error: state.trace.error,
      explanation: state.trace.explanation,
      candidates: state.trace.candidates.map((candidate) => ({
        asset: assetById[candidate.assetId],
        distance: candidate.distance,
      })).filter((candidate) => candidate.asset),
      pathAssets: state.trace.path.map((assetId) => assetById[assetId]).filter(Boolean),
      relations: state.trace.relations.map((relation) => ({
        ...relation,
        networkName: networks.find((network) => network.id === relation.networkId)?.shortName
          || networks.find((network) => network.id === relation.networkId)?.name,
      })),
    }
  }

  function updateTraceBanner() {
    const banner = container.querySelector('.trace-banner')
    const instruction = getTraceInstruction(state.trace)
    if (!instruction) {
      banner.hidden = true
      banner.removeAttribute('data-trace-state')
      return
    }
    banner.hidden = false
    banner.dataset.traceState = state.trace.status
    const step = banner.querySelector('.trace-step')
    step.innerHTML = instruction.icon
      ? `<span class="material-symbols-outlined" aria-hidden="true">${instruction.icon}</span>`
      : instruction.step
    banner.querySelector('strong').textContent = instruction.title
    banner.querySelector('.trace-description').textContent = instruction.description
    updateMapSafeArea()
  }

  function beginTracing(startId = null, { historyMode = 'push' } = {}) {
    traceRequestId += 1
    state.trace = reduceTracingState(state.trace, { type: 'reset' })
    if (!startId) {
      state.trace = reduceTracingState(state.trace, { type: 'select-start' })
      updateUrl(historyMode)
      updateTraceBanner()
      renderDrawer()
      syncMap()
      return
    }

    if (!assetById[startId] || !validTraceNodeIds.has(startId)) {
      state.trace = reduceTracingState(state.trace, {
        type: 'error',
        message: 'Aset awal tidak tersedia pada graph topologi Pengapon.',
      })
      updateUrl(historyMode)
      updateTraceBanner()
      renderDrawer()
      syncMap()
      return
    }

    const candidates = findReachableDestinations(relationGraph, startId)
      .filter((candidate) => validTraceNodeIds.has(candidate.assetId))
      .sort((left, right) => left.distance - right.distance
        || assetById[left.assetId].displayName.localeCompare(
          assetById[right.assetId].displayName,
          'id',
        ))
    state.trace = reduceTracingState(state.trace, {
      type: 'start-selected',
      assetId: startId,
      candidates,
    })
    updateUrl(historyMode)
    updateTraceBanner()
    renderDrawer()
    syncMap()
  }

  function runTraceTo(targetId, { historyMode = 'push', defer = true } = {}) {
    if (!state.trace.fromId) {
      beginTracing(selection.selectedAssetId)
      return
    }
    if (!validTraceNodeIds.has(targetId)) return

    state.trace = reduceTracingState(state.trace, {
      type: 'calculate',
      assetId: targetId,
    })
    updateUrl(historyMode)
    updateTraceBanner()
    renderDrawer()
    syncMap()

    const requestId = ++traceRequestId
    const finishTraversal = () => {
      if (requestId !== traceRequestId) return
      const result = findTracePath(relationGraph, state.trace.fromId, targetId)
      if (result.status === 'found' && result.assetIds.length > 1) {
        state.trace = reduceTracingState(state.trace, {
          type: 'result',
          path: result.assetIds,
          relations: result.relations,
          explanation: result.explanation,
        })
        updateUrl(historyMode)
        canvasApi.focusAssetBounds(result.assetIds)
      } else {
        state.trace = reduceTracingState(state.trace, {
          type: result.status === 'unreachable' ? 'no-path' : 'error',
          message: result.message || 'Tujuan tracing tidak dapat digunakan.',
        })
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
    traceRequestId += 1
    state.trace = reduceTracingState(state.trace, { type: 'reset' })
    updateUrl()
    updateTraceBanner()
    syncMap()
    renderDrawer()
  }

  function openSchematic(preferredScope = 'full-map') {
    const viewportBounds = canvasApi.getGeographicViewportBounds()
      || currentGeographicViewportBounds
    const activeLayerIds = new Set([
      ...assets.map(({ layerId }) => layerId),
      ...geometries.map(({ layerId }) => layerId),
    ].filter(Boolean))
    const availableLayers = layers.filter(({ id }) => activeLayerIds.has(id))
    const scopeOptions = [
      { key: 'overview-pengapon', label: 'Overview Pengapon' },
      { key: 'current-viewport', label: 'Area peta saat ini' },
      ...(state.trace.status === 'result' ? [
        { key: 'active-trace', label: 'Jalur tracing aktif' },
      ] : []),
      ...(selection.selectedAssetId ? [
        { key: 'focused-asset-depth-1', label: 'Aset fokus · depth 1' },
        { key: 'focused-asset-depth-2', label: 'Aset fokus · depth 2' },
      ] : []),
      ...networks.filter(({ nodeCount, lineCount }) => (
        nodeCount > 0 || lineCount > 0
      )).map((network) => ({
        key: `network:${network.id}`,
        label: `${network.shortName || network.name} · ${network.nodeCount} node · ${network.lineCount} line`,
        group: 'Jaringan',
      })),
      ...availableLayers.map((layer) => ({
        key: `layer:${layer.id}`,
        label: `Layer · ${layer.name}`,
        title: layer.sourceFolderPath,
        group: 'Area / layer',
      })),
      { key: 'multi-page', label: 'Export beberapa halaman' },
    ]
    const diagramCache = new Map()
    const createDiagram = (graph) => ({
      graph,
      layout: calculateSchematicLayout(graph, schematicLayoutOptions(graph)),
    })
    const diagramFactory = (scopeKey) => {
      if (diagramCache.has(scopeKey)) return diagramCache.get(scopeKey)
      let diagram
      if (scopeKey === 'multi-page') {
        const completeGraph = buildScopedGraph({
          assets,
          networks,
          geometries,
          topologyGraph,
          scope: 'full-map',
          compactMaxNodes: Number.POSITIVE_INFINITY,
        })
        const segmented = segmentSchematicGraph(completeGraph)
        diagram = {
          ...segmented,
          pages: segmented.pages.map((graph) => createDiagram(graph)),
        }
      } else {
        let graph
        if (scopeKey === 'active-trace') {
          graph = buildScopedGraph({
            assets,
            networks,
            geometries,
            topologyGraph,
            scope: 'active-trace',
            tracePath: state.trace.status === 'result' ? state.trace.path : [],
            traceRelations: state.trace.status === 'result' ? state.trace.relations : [],
          })
        } else if (scopeKey === 'overview-pengapon') {
          graph = buildScopedGraph({
            assets,
            networks,
            geometries,
            topologyGraph,
            scope: 'overview-pengapon',
          })
        } else if (scopeKey === 'current-viewport') {
          graph = buildScopedGraph({
            assets,
            networks,
            geometries,
            topologyGraph,
            scope: 'current-viewport',
            viewportBounds,
          })
        } else if (scopeKey.startsWith('focused-asset-depth-')) {
          graph = buildScopedGraph({
            assets,
            networks,
            geometries,
            topologyGraph,
            scope: scopeKey,
            focusedAssetId: selection.selectedAssetId,
            focusDepth: Number(scopeKey.at(-1)),
          })
        } else if (scopeKey.startsWith('network:')) {
          graph = buildScopedGraph({
            assets,
            networks,
            geometries,
            topologyGraph,
            scope: 'selected-network',
            selectedNetworkIds: [scopeKey.slice('network:'.length)],
          })
        } else if (scopeKey.startsWith('layer:')) {
          graph = buildScopedGraph({
            assets,
            networks,
            geometries,
            topologyGraph,
            scope: 'selected-layer',
            selectedLayerIds: [scopeKey.slice('layer:'.length)],
          })
        } else {
          graph = buildScopedGraph({
            assets,
            networks,
            geometries,
            topologyGraph,
            scope: 'overview-pengapon',
          })
        }
        diagram = createDiagram(graph)
      }
      diagramCache.set(scopeKey, diagram)
      return diagram
    }
    const initialMode = state.trace.status === 'result'
      ? 'active-trace'
      : preferredScope === 'focus-depth-1' && selection.selectedAssetId
        ? 'focused-asset-depth-1'
        : 'overview-pengapon'
    openSchematicDialog({
      diagramFactory,
      scopeOptions,
      initialMode,
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
      layers,
      topologyGraph,
      selectedNetworkIds: selection.selectedNetworkIds,
      selectedAssetId: selection.selectedAssetId,
      tracePath: state.trace.status === 'result' ? state.trace.path : [],
      visibleAssetIds: canvasApi.getVisibleAssetIds(),
      visibleGeometryIds: canvasApi.getVisibleGeometryIds(),
      initialMode,
      onActivated: () => renderMapPage(container),
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
    container.querySelectorAll('.dim-toggle, .inactive-mode-toggle').forEach((button) => {
      button.setAttribute('aria-pressed', String(state.dimOthers))
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
    state.trace = reduceTracingState(state.trace, { type: 'reset' })
    if (!urlState.traceFrom) {
      updateTraceBanner()
      return
    }

    if (!validTraceNodeIds.has(urlState.traceFrom)) {
      state.trace = reduceTracingState(state.trace, {
        type: 'error',
        message: 'Titik awal pada URL tidak tersedia pada graph topologi Pengapon.',
      })
      updateTraceBanner()
      return
    }

    if (urlState.traceTo) {
      state.trace = reduceTracingState(state.trace, {
        type: 'start-selected',
        assetId: urlState.traceFrom,
        candidates: findReachableDestinations(relationGraph, urlState.traceFrom),
      })
      state.trace = reduceTracingState(state.trace, {
        type: 'calculate',
        assetId: urlState.traceTo,
      })
      const result = findTracePath(relationGraph, urlState.traceFrom, urlState.traceTo)
      if (result.status === 'found' && result.assetIds.length > 1) {
        state.trace = reduceTracingState(state.trace, {
          type: 'result',
          path: result.assetIds,
          relations: result.relations,
          explanation: result.explanation,
        })
        window.requestAnimationFrame(() => canvasApi.focusAssetBounds(result.assetIds))
      } else {
        state.trace = reduceTracingState(state.trace, {
          type: result.status === 'unreachable' ? 'no-path' : 'error',
          message: result.message || 'Jalur tracing pada URL tidak tersedia.',
        })
      }
    } else {
      state.trace = reduceTracingState(state.trace, {
        type: 'start-selected',
        assetId: urlState.traceFrom,
        candidates: findReachableDestinations(relationGraph, urlState.traceFrom),
      })
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
  container.querySelector('.diagram-toggle').addEventListener('click', () => {
    openSchematic('full-map')
  })
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
  const handleDocumentKeydown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      container.querySelector('.search-control input').focus()
    }
    if (event.key !== 'Escape') return
    if (state.trace.status !== 'idle') stopTracing()
    else if (selection.selectedAssetId) closeAssetDrawer()
    else if (workspace.classList.contains('sidebar-open')) closeMobileSidebar()
    else if (!legend.hidden) toggleLegend()
  }
  const safeAreaObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(updateMapSafeArea)
    : null
  ;[mapStage, contextPill, floatingTop, floatingBottom, sidebar, drawer]
    .filter(Boolean)
    .forEach((element) => safeAreaObserver?.observe(element))
  window.addEventListener('resize', updateMapSafeArea)
  window.addEventListener('popstate', restoreStateFromUrl)
  document.addEventListener('keydown', handleDocumentKeydown)
  container.__sinergiMapCleanup = () => {
    safeAreaObserver?.disconnect()
    canvasApi.destroy()
    window.removeEventListener('resize', updateMapSafeArea)
    window.removeEventListener('popstate', restoreStateFromUrl)
    document.removeEventListener('keydown', handleDocumentKeydown)
  }

  restoreTraceState(initialUrlState)
  updateUrl('replace')
  syncInactiveModeControls()
  loadSidebarData()
  if (selection.selectedAssetId) loadAssetDetail(selection.selectedAssetId)
  else renderDrawer()
  syncMap()
  updateMapSafeArea()
}

function readRequestedDatasetContext() {
  const query = new URLSearchParams(window.location.search)
  const siteScope = resolveSiteScope(
    query.get('siteScopeId')
      || window.sessionStorage.getItem('sinergiActiveSiteScopeId'),
  )
  return {
    datasetId: query.get('datasetId')
      || window.sessionStorage.getItem('sinergiActiveDatasetId')
      || 'dataset-semarang',
    branchId: query.get('branchId')
      || window.sessionStorage.getItem('sinergiActiveBranchId')
      || 'semarang',
    siteScopeId: siteScope.id,
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

function schematicLayoutOptions(graph) {
  const compact = graph.layoutDensity === 'compact'
  return {
    ...(compact ? {
      nodeWidth: 104,
      nodeHeight: 54,
      columnGap: 44,
      rowGap: 22,
    } : {}),
  }
}

function setDisabledReason(button, disabled, reason) {
  if (!button) return
  button.disabled = disabled
  if (disabled) {
    button.title = reason
    button.setAttribute('aria-description', reason)
  } else {
    button.removeAttribute('title')
    button.removeAttribute('aria-description')
  }
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
