import { adaptActiveDatasetForTopology } from '../../adapters/active-dataset-map-adapter.js'
import {
  buildTopologyDiagramModel,
  getTopologyDiagramSearchResults,
  networkFamilyColor,
  networkFamilyLabel,
} from '../../domain/topology-diagram-model.js'
import { poleGroupForAsset } from '../../domain/pole-groups.js'
import {
  loadActiveDataset,
  loadTopologyProjection,
  loadTopologyRoots,
} from '../../services/active-dataset-service.js'
import { downloadSchematicPng, downloadSchematicSvg } from '../map/schematic-export.js'
import { bindUserAccountMenu, renderTopNavigation } from '../map/map-page.js'
import { calculateTopologyDiagramLayout } from './topology-diagram-layout.js'
import { renderTopologyDiagramSvg } from './topology-diagram-svg.js'
import {
  anchoredZoomScrollPosition,
  computeFitZoom,
  computeReadableZoom,
  zoomSurfaceMetrics,
} from './topology-viewport.js'

const DEFAULT_DATASET_ID = 'dataset-semarang'
const DEFAULT_BRANCH_ID = 'semarang'
const DEFAULT_ZOOM = 1
const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.35
const CANVAS_HORIZONTAL_PADDING = 30
const CANVAS_TOP_PADDING = 84
const CANVAS_BOTTOM_PADDING = 30

function topologyAreaStorageKey(activeContext) {
  return `sinergi.topology.last-area:${activeContext.datasetId}:${activeContext.branchId}`
}

function readStoredTopologyArea(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function persistTopologyArea(key, area) {
  try {
    window.localStorage.setItem(key, area ?? 'all')
  } catch {
    // Storage can be disabled; URL state still remains authoritative.
  }
}

export async function renderTopologyPage(container) {
  document.title = 'Diagram Topologi — SINERGI'
  document.body.className = 'map-body topology-body'
  const requested = readRequestedDatasetContext()

  container.innerHTML = renderLoadingState(requested)
  bindUserAccountMenu()

  try {
    const payload = await loadActiveDataset({ ...requested, view: 'topology' })
    const mapData = adaptActiveDatasetForTopology(payload)
    persistActiveContext(mapData.activeContext)

    const datasetVersionId = mapData.activeContext.datasetVersionId
    let graph = mapData.topologyGraph ?? { nodes: [], edges: [] }
    if (!hasGraph(graph)) {
      const graphPayload = await loadTopologyProjection({
        datasetVersionId,
        projection: 'graph',
      }).catch(() => null)
      graph = graphFromPayload(graphPayload, graph)
    }

    const rootsPayload = graph.graphRevision
      ? await loadTopologyRoots({
        datasetVersionId,
        graphRevision: graph.graphRevision,
      }).catch(() => null)
      : null

    mountTopologyWorkspace(container, {
      mapData,
      graph,
      roots: rootsPayload?.roots ?? rootsPayload?.items ?? [],
      context: requested,
    })
  } catch (error) {
    container.innerHTML = renderErrorState(requested, error)
    bindUserAccountMenu()
    container.querySelector('[data-retry-topology]')?.addEventListener('click', () => {
      void renderTopologyPage(container)
    })
  }
}

function mountTopologyWorkspace(container, {
  mapData,
  graph,
  roots,
  context,
}) {
  const activeContext = mapData.activeContext
  const query = new URLSearchParams(window.location.search)
  const validAreaKeys = new Set(mapData.locationGroups.map(({ key }) => key))
  const requestedArea = query.get('area')
  const areaStorageKey = topologyAreaStorageKey(activeContext)
  const storedArea = readStoredTopologyArea(areaStorageKey)
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
    zoom: DEFAULT_ZOOM,
    filterOpen: false,
    viewOpen: false,
    exportOpen: false,
    inspectorOpen: Boolean(selectedAssetFromUrl),
    searchResults: [],
    toastTimer: null,
  }

  let model = null
  let layout = null
  let searchTimer = null
  let panState = null
  let suppressViewportClick = false

  const buildModel = () => buildTopologyDiagramModel({
    assets: mapData.assets,
    graph,
    locationGroups: mapData.locationGroups,
    area: state.area,
    branchId: activeContext.branchId,
    datasetId: activeContext.datasetId,
    datasetVersionId: activeContext.datasetVersionId,
    roots,
    mountingRelations: mapData.mountingRelations,
    poleGroups: mapData.poleGroups,
    selectedFamilies: state.selectedFamilies,
    search: state.search,
    showMountingPhysical: state.showMountingPhysical,
    publicationProfile: activeContext.publicationProfile,
    readiness: mapData.topologyReadiness,
  })

  const buildLayout = () => calculateTopologyDiagramLayout(model, {
    minWidth: 1240,
    componentColumns: 3,
    componentMaxColumns: 4,
    componentPackingAspectRatio: 2.25,
    layoutStyle: 'central-backbone',
    ...(state.area === 'dppu-yia'
      ? {
        mountingBoxGapX: 40,
        mountingBoxGapY: 36,
        mountingBoxNodeGapX: 24,
        mountingBoxLevelGapY: 40,
      }
      : {}),
    overview: state.area === null,
  })

  const rebuild = ({ fit = false } = {}) => {
    model = buildModel()
    if (!model.nodeById.has(state.selectedAssetId)) state.selectedAssetId = null
    layout = buildLayout()
    renderGraph()
    renderInspector()
    renderTray()
    renderFilterPanel()
    updateToolbar()
    updatePanelState()
    if (fit) requestAnimationFrame(() => resetGraphViewport())
    syncUrl()
  }

  model = buildModel()
  state.selectedAssetId = model.nodeById.has(state.selectedAssetId)
    ? state.selectedAssetId
    : null
  layout = buildLayout()

  container.innerHTML = renderWorkspaceShell({
    mapData,
    activeContext,
    context,
    state,
    model,
  })
  bindWorkspaceEvents()
  renderGraph()
  renderInspector()
  renderTray()
  renderFilterPanel()
  updateToolbar()
  updatePanelState()
  requestAnimationFrame(() => resetGraphViewport())

  function bindWorkspaceEvents() {
    container.addEventListener('click', handleClick)
    container.addEventListener('change', handleChange)
    container.addEventListener('input', handleInput)
    container.addEventListener('keydown', handleKeydown)

    const viewport = container.querySelector('[data-topology-viewport]')
    viewport?.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const direction = event.deltaY > 0 ? -1 : 1
      zoomGraphTo(state.zoom + direction * 0.08, {
        clientX: event.clientX,
        clientY: event.clientY,
      })
    }, { passive: false })

    viewport?.addEventListener('pointerdown', beginPan)
    viewport?.addEventListener('pointermove', movePan)
    viewport?.addEventListener('pointerup', endPan)
    viewport?.addEventListener('pointercancel', endPan)

    if (viewport && typeof ResizeObserver === 'function') {
      const resizeObserver = new ResizeObserver(() => syncGraphSurface({ preserveCenter: true }))
      resizeObserver.observe(viewport)
    }
  }

  function handleClick(event) {
    if (suppressViewportClick) {
      suppressViewportClick = false
      return
    }
    const target = event.target?.closest?.('[data-node-id], [data-edge-id], [data-mounting-group-id]')
    if (target?.dataset.nodeId) {
      selectAsset(target.dataset.nodeId)
      return
    }
    if (target?.dataset.edgeId) {
      selectEdge(target.dataset.edgeId)
      return
    }
    if (target?.dataset.mountingGroupId) {
      selectMountingGroup(target.dataset.mountingGroupId)
      return
    }

    const relationAsset = event.target?.closest?.('[data-select-asset]')
    if (relationAsset?.dataset.selectAsset) {
      selectAsset(relationAsset.dataset.selectAsset)
      return
    }

    const areaOverview = event.target?.closest?.('[data-area-overview]')
    if (areaOverview?.dataset.areaOverview) {
      state.area = areaOverview.dataset.areaOverview
      persistTopologyArea(areaStorageKey, state.area)
      rebuild({ fit: true })
      return
    }

    const action = event.target?.closest?.('[data-action]')?.dataset.action
    if (action === 'zoom-in') return changeZoom(0.1)
    if (action === 'zoom-out') return changeZoom(-0.1)
    if (action === 'fit') return fitGraph()
    if (action === 'toggle-filter') return togglePanel('filter')
    if (action === 'toggle-view') return togglePanel('view')
    if (action === 'toggle-export') return togglePanel('export')
    if (action === 'toggle-inspector') {
      state.inspectorOpen = !state.inspectorOpen
      updatePanelState()
      return
    }
    if (action === 'close-filter') {
      state.filterOpen = false
      updatePanelState()
      return
    }
    if (action === 'close-view') {
      state.viewOpen = false
      updatePanelState()
      return
    }
    if (action === 'close-export') {
      state.exportOpen = false
      updatePanelState()
      return
    }
    if (action === 'close-inspector') {
      state.inspectorOpen = false
      updatePanelState()
      return
    }
    if (action === 'clear-selection') {
      clearSelection()
      return
    }
    if (action === 'open-map') return openAssetMap(event.target.closest('[data-action]')?.dataset.assetId)
    if (action === 'retry') return void renderTopologyPage(container)
    if (action === 'help') {
      showToast('Klik node atau garis untuk melihat detail. Gunakan Ctrl/Cmd + scroll untuk zoom.')
      return
    }

    const family = event.target?.closest?.('[data-family]')
    if (family?.dataset.family) {
      if (family.dataset.family === '__reset__') {
        state.selectedFamilies.clear()
        rebuild()
        return
      }
      toggleFamily(family.dataset.family)
      return
    }
    const trayAsset = event.target?.closest?.('[data-tray-asset]')
    if (trayAsset?.dataset.trayAsset) {
      selectAsset(trayAsset.dataset.trayAsset)
      return
    }
    const searchResult = event.target?.closest?.('[data-search-result]')
    if (searchResult?.dataset.searchResult) {
      const [kind, ...idParts] = searchResult.dataset.searchResult.split(':')
      const id = idParts.join(':')
      if (kind === 'edge') selectEdge(id)
      else selectAsset(id)
      state.searchResults = []
      renderFilterPanel()
    }

    const exportButton = event.target?.closest?.('[data-export]')
    if (exportButton?.dataset.export) {
      exportDiagram(exportButton.dataset.export)
      return
    }

    if (event.target?.closest?.('[data-topology-viewport]')) clearSelection()
  }

  function handleChange(event) {
    const target = event.target
    if (target.matches('[data-area-filter]')) {
      state.area = target.value === 'all' ? null : target.value
      persistTopologyArea(areaStorageKey, state.area)
      state.selectedAssetId = null
      rebuild({ fit: true })
    } else if (target.matches('[data-label-mode]')) {
      state.labelMode = target.value
      renderGraph()
    } else if (target.matches('[data-mounting-toggle]')) {
      state.showMountingPhysical = target.checked
      rebuild()
    }
  }

  function handleInput(event) {
    const target = event.target
    if (!target.matches('[data-topology-search]')) return
    state.search = target.value
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      state.searchResults = getTopologyDiagramSearchResults(model, state.search)
      rebuild()
    }, 120)
  }

  function handleKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target?.closest?.('[data-node-id], [data-edge-id], [data-mounting-group-id]')
    if (!target) return
    event.preventDefault()
    if (target.dataset.nodeId) selectAsset(target.dataset.nodeId)
    else if (target.dataset.edgeId) selectEdge(target.dataset.edgeId)
    else if (target.dataset.mountingGroupId) selectMountingGroup(target.dataset.mountingGroupId)
  }

  function selectAsset(assetId) {
    if (!assetId || !model.nodeById.has(assetId)) return
    state.selectedAssetId = assetId
    state.selectedEdgeId = null
    state.selectedMountingGroupId = null
    state.inspectorOpen = true
    renderGraph()
    renderInspector()
    updatePanelState()
    syncUrl()
  }

  function selectEdge(edgeId) {
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
    const box = layout?.mountingBoxes?.find(({ id }) => id === groupId)
    if (!box || !['confirmed', 'empty'].includes(box.kind)) return
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

  function toggleFamily(family) {
    if (state.selectedFamilies.has(family)) state.selectedFamilies.delete(family)
    else state.selectedFamilies.add(family)
    rebuild()
  }

  function togglePanel(panel) {
    state.filterOpen = panel === 'filter' ? !state.filterOpen : false
    state.viewOpen = panel === 'view' ? !state.viewOpen : false
    state.exportOpen = panel === 'export' ? !state.exportOpen : false
    updatePanelState()
  }

  function changeZoom(delta) {
    zoomGraphTo(state.zoom + delta)
  }

  function setZoom(value) {
    state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value) || DEFAULT_ZOOM))
  }

  function fitGraph() {
    if (!layout?.width || !layout?.height) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    setZoom(computeFitZoom({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      minZoom: MIN_ZOOM,
      maxZoom: 1.12,
      horizontalPadding: CANVAS_HORIZONTAL_PADDING * 2,
      verticalPadding: CANVAS_TOP_PADDING + CANVAS_BOTTOM_PADDING,
    }))
    renderGraph()
    updateToolbar()
    requestAnimationFrame(() => centerGraph({ smooth: true }))
  }

  function resetGraphViewport() {
    if (!layout?.width || !layout?.height) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    const readableFloor = viewport.clientWidth < 620 ? 0.75 : 0.85
    setZoom(computeReadableZoom({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      minZoom: readableFloor,
      maxZoom: DEFAULT_ZOOM,
      horizontalPadding: CANVAS_HORIZONTAL_PADDING * 2,
      verticalPadding: CANVAS_TOP_PADDING + CANVAS_BOTTOM_PADDING,
    }))
    renderGraph()
    updateToolbar()
    requestAnimationFrame(() => centerGraph())
  }

  function renderGraph() {
    const frame = container.querySelector('[data-topology-frame]')
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
    const svg = renderTopologyDiagramSvg({
      model,
      layout,
      context: {
        branchId: activeContext.branchId,
        branchName: activeContext.branchName,
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
    })
    frame.innerHTML = svg
    frame.style.width = `${layout.width}px`
    frame.style.height = `${layout.height}px`
    frame.style.transform = `scale(${state.zoom})`
    syncGraphSurface()
  }

  function zoomGraphTo(value, pointer = null) {
    const viewport = container.querySelector('[data-topology-viewport]')
    const frame = container.querySelector('[data-topology-frame]')
    if (!viewport || !frame || !layout?.width || !layout?.height) return
    const previousZoom = state.zoom
    const rect = viewport.getBoundingClientRect()
    const anchorX = pointer ? pointer.clientX - rect.left : viewport.clientWidth / 2
    const anchorY = pointer ? pointer.clientY - rect.top : viewport.clientHeight / 2
    const oldScrollLeft = viewport.scrollLeft
    const oldScrollTop = viewport.scrollTop
    const oldFrameLeft = numericStyle(frame.style.left, frame.offsetLeft)
    const oldFrameTop = numericStyle(frame.style.top, frame.offsetTop)

    setZoom(value)
    if (state.zoom === previousZoom) return
    renderGraph()

    const position = anchoredZoomScrollPosition({
      scrollLeft: oldScrollLeft,
      scrollTop: oldScrollTop,
      anchorX,
      anchorY,
      oldZoom: previousZoom,
      newZoom: state.zoom,
      oldFrameLeft,
      oldFrameTop,
      newFrameLeft: numericStyle(frame.style.left, frame.offsetLeft),
      newFrameTop: numericStyle(frame.style.top, frame.offsetTop),
    })
    viewport.scrollTo({ ...position, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    updateToolbar()
  }

  function syncGraphSurface({ preserveCenter = false } = {}) {
    const viewport = container.querySelector('[data-topology-viewport]')
    const canvas = container.querySelector('.topology-stitch-canvas')
    const frame = container.querySelector('[data-topology-frame]')
    if (!viewport || !canvas || !frame || !layout?.width || !layout?.height) return
    const snapshot = preserveCenter ? viewportCenterSnapshot(viewport, frame) : null
    const metrics = zoomSurfaceMetrics({
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      zoom: state.zoom,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      horizontalPadding: viewport.clientWidth < 820 ? 16 : CANVAS_HORIZONTAL_PADDING,
      topPadding: viewport.clientWidth < 620 ? 72 : CANVAS_TOP_PADDING,
      bottomPadding: CANVAS_BOTTOM_PADDING,
    })
    canvas.style.width = `${metrics.width}px`
    canvas.style.height = `${metrics.height}px`
    frame.style.left = `${metrics.frameLeft}px`
    frame.style.top = `${metrics.frameTop}px`
    if (snapshot) restoreViewportCenter(viewport, frame, snapshot)
  }

  function centerGraph({ smooth = false } = {}) {
    const viewport = container.querySelector('[data-topology-viewport]')
    const frame = container.querySelector('[data-topology-frame]')
    if (!viewport || !frame) return
    const left = Math.max(0, numericStyle(frame.style.left, frame.offsetLeft)
      + layout.width * state.zoom / 2 - viewport.clientWidth / 2)
    viewport.scrollTo({
      left,
      top: 0,
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
    })
  }

  function viewportCenterSnapshot(viewport, frame) {
    return {
      x: (viewport.scrollLeft + viewport.clientWidth / 2
        - numericStyle(frame.style.left, frame.offsetLeft)) / state.zoom,
      y: (viewport.scrollTop + viewport.clientHeight / 2
        - numericStyle(frame.style.top, frame.offsetTop)) / state.zoom,
    }
  }

  function restoreViewportCenter(viewport, frame, snapshot) {
    viewport.scrollLeft = Math.max(0, numericStyle(frame.style.left, frame.offsetLeft)
      + snapshot.x * state.zoom - viewport.clientWidth / 2)
    viewport.scrollTop = Math.max(0, numericStyle(frame.style.top, frame.offsetTop)
      + snapshot.y * state.zoom - viewport.clientHeight / 2)
  }

  function beginPan(event) {
    if (event.button !== 0 || event.pointerType === 'touch') return
    if (event.target.closest('[data-node-id], [data-edge-id], [data-mounting-group-id], button, a, input, select')) return
    const viewport = event.currentTarget
    panState = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      distance: 0,
    }
    viewport.setPointerCapture(event.pointerId)
    viewport.classList.add('is-panning')
  }

  function movePan(event) {
    if (!panState || event.pointerId !== panState.pointerId) return
    const viewport = event.currentTarget
    const deltaX = event.clientX - panState.x
    const deltaY = event.clientY - panState.y
    panState.distance = Math.max(panState.distance, Math.hypot(deltaX, deltaY))
    viewport.scrollLeft = panState.left - deltaX
    viewport.scrollTop = panState.top - deltaY
  }

  function endPan(event) {
    if (!panState || event.pointerId !== panState.pointerId) return
    suppressViewportClick = panState.distance >= 4
    panState = null
    event.currentTarget.classList.remove('is-panning')
    window.setTimeout(() => { suppressViewportClick = false }, 0)
  }

  function renderInspector() {
    const inspector = container.querySelector('[data-topology-inspector]')
    if (!inspector) return
    inspector.innerHTML = state.selectedAssetId
      ? renderAssetInspector(model.nodeById.get(state.selectedAssetId))
      : state.selectedEdgeId
        ? renderEdgeInspector(model.edgeById.get(state.selectedEdgeId))
        : renderNoSelectionInspector()
  }

  function renderAssetInspector(node) {
    if (!node) return renderNoSelectionInspector()
    const group = poleGroupForAsset(mapData.poleGroups, node.id)
    const path = networkPathFor(node.id)
    const relations = directRelationsFor(node.id)
    const online = node.connectivityStatus !== 'disconnected' && !isOfflineStatus(node.status)
    return `
      <div class="topology-stitch-inspector-head">
        <h3>Detail Perangkat</h3>
        <button class="topology-stitch-icon-button" type="button" data-action="close-inspector" aria-label="Tutup detail">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
      <div class="topology-stitch-inspector-body">
        <div class="topology-stitch-asset-heading">
          <div class="topology-stitch-asset-icon ${online ? 'online' : 'offline'}">
            <span class="material-symbols-outlined" aria-hidden="true">${iconForNode(node)}</span>
          </div>
          <div class="topology-stitch-asset-title">
            <div class="topology-stitch-name-row">
              <h4>${escapeHtml(node.name || node.id)}</h4>
              <span class="topology-stitch-status ${online ? 'online' : 'offline'}"><i></i>${online ? 'Online' : 'Offline'}</span>
            </div>
            <span>${escapeHtml(node.type || node.assetType || 'Aset')}</span>
          </div>
        </div>
        <section class="topology-stitch-inspector-card">
          <div class="topology-stitch-section-label"><span class="material-symbols-outlined" aria-hidden="true">location_on</span>Lokasi Fisik</div>
          <p>${escapeHtml(physicalLocation(node, group))}</p>
        </section>
        <section class="topology-stitch-inspector-section">
          <label>Jalur Jaringan</label>
          <div class="topology-stitch-path">${path.map((item, index) => `
            ${index ? '<span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>' : ''}
            <span class="${item.id === node.id ? 'current' : ''}">${escapeHtml(item.name || item.id)}</span>
          `).join('') || `<span class="current">${escapeHtml(node.name || node.id)}</span>`}</div>
        </section>
        <section class="topology-stitch-inspector-section">
          <label>Endpoint Terhubung (${relations.length})</label>
          <div class="topology-stitch-relations">
            ${relations.length ? relations.map(({ other, edge }) => `
              <button type="button" class="topology-stitch-relation" data-select-asset="${escapeAttribute(other.id)}">
                <span class="topology-stitch-relation-main"><span class="material-symbols-outlined" aria-hidden="true">${iconForNode(other)}</span><strong>${escapeHtml(other.name || other.id)}</strong></span>
                <span class="topology-stitch-relation-meta">${escapeHtml(edge.networkFamilyLabel || networkFamilyLabel(other.networkFamily))}<i class="${other.connectivityStatus === 'disconnected' ? 'offline' : ''}"></i></span>
              </button>
            `).join('') : '<p class="topology-stitch-muted">Belum ada relasi terkonfirmasi pada perangkat ini.</p>'}
          </div>
        </section>
      </div>
      <div class="topology-stitch-inspector-footer">
        <button type="button" class="topology-stitch-secondary-button" data-action="open-map" data-asset-id="${escapeAttribute(node.id)}">
          <span class="material-symbols-outlined" aria-hidden="true">map</span>Buka di Peta Aset
        </button>
        <button type="button" class="topology-stitch-detail-link" data-action="open-map" data-asset-id="${escapeAttribute(node.id)}">Lihat detail aset</button>
      </div>
    `
  }

  function renderEdgeInspector(edge) {
    if (!edge) return renderNoSelectionInspector()
    const source = model.nodeById.get(edge.sourceId)
    const target = model.nodeById.get(edge.targetId)
    return `
      <div class="topology-stitch-inspector-head">
        <h3>Detail Relasi</h3>
        <button class="topology-stitch-icon-button" type="button" data-action="close-inspector" aria-label="Tutup detail">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
      <div class="topology-stitch-inspector-body">
        <div class="topology-stitch-asset-heading">
          <div class="topology-stitch-asset-icon online"><span class="material-symbols-outlined" aria-hidden="true">cable</span></div>
          <div class="topology-stitch-asset-title"><div class="topology-stitch-name-row"><h4>${escapeHtml(edge.relationId || edge.id)}</h4><span class="topology-stitch-status online"><i></i>Aktif</span></div><span>${escapeHtml(edge.networkFamilyLabel || 'Relasi terkonfirmasi')}</span></div>
        </div>
        <section class="topology-stitch-inspector-card"><div class="topology-stitch-section-label"><span class="material-symbols-outlined" aria-hidden="true">route</span>Endpoint Relasi</div><p>${escapeHtml(source?.name || edge.sourceId)} <span class="material-symbols-outlined topology-stitch-inline-icon" aria-hidden="true">arrow_forward</span> ${escapeHtml(target?.name || edge.targetId)}</p></section>
        <section class="topology-stitch-inspector-section"><label>Provenance</label><p class="topology-stitch-provenance">${escapeHtml(edge.provenance || edge.sourceGeometryId || 'Relasi aktif dari dataset topology.')}</p></section>
        <section class="topology-stitch-inspector-section"><label>Metadata</label><dl class="topology-stitch-facts"><div><dt>Status</dt><dd>Terkonfirmasi</dd></div><div><dt>Arah</dt><dd>${escapeHtml(edge.direction || 'undirected')}</dd></div>${edge.lengthMeters != null ? `<div><dt>Panjang</dt><dd>${escapeHtml(String(edge.lengthMeters))} m</dd></div>` : ''}</dl></section>
      </div>
      <div class="topology-stitch-inspector-footer"><button type="button" class="topology-stitch-secondary-button" data-action="open-map" data-asset-id="${escapeAttribute(source?.id || '')}"><span class="material-symbols-outlined" aria-hidden="true">map</span>Buka di Peta Aset</button></div>
    `
  }

  function renderNoSelectionInspector() {
    return `
      <div class="topology-stitch-inspector-head"><h3>Detail Perangkat</h3><button class="topology-stitch-icon-button" type="button" data-action="close-inspector" aria-label="Tutup detail"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>
      <div class="topology-stitch-inspector-empty"><span class="material-symbols-outlined" aria-hidden="true">touch_app</span><strong>Pilih perangkat atau garis</strong><p>Detail identitas, lokasi, jalur, dan koneksi akan muncul di panel ini.</p></div>
    `
  }

  function renderTray() {
    const tray = container.querySelector('[data-topology-tray]')
    if (!tray) return
    const isolated = model?.isolatedNodes ?? []
    tray.innerHTML = `
      <div class="topology-stitch-tray-title"><span class="material-symbols-outlined" aria-hidden="true">link_off</span>Perangkat Belum Terhubung (${isolated.length})</div>
      <div class="topology-stitch-tray-list">
        ${isolated.length ? isolated.map((node) => `<button type="button" class="topology-stitch-tray-item" data-tray-asset="${escapeAttribute(node.id)}"><span class="topology-stitch-tray-icon"><span class="material-symbols-outlined" aria-hidden="true">${iconForNode(node)}</span></span><span>${escapeHtml(node.name || node.id)}</span></button>`).join('') : '<span class="topology-stitch-tray-empty">Semua perangkat pada area ini sudah memiliki relasi.</span>'}
      </div>
    `
  }

  function renderFilterPanel() {
    const panel = container.querySelector('[data-topology-filter-panel]')
    if (!panel) return
    const families = model?.networkOptions ?? []
    const areas = mapData.locationGroups
    const results = state.searchResults
    panel.innerHTML = `
      <div class="topology-stitch-panel-head"><div><span class="topology-stitch-eyebrow">KONFIGURASI TAMPILAN</span><h2>Filter Diagram</h2></div><button type="button" class="topology-stitch-icon-button" data-action="close-filter" aria-label="Tutup filter"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>
      <label class="topology-stitch-field-label" for="topology-area-filter">Area diagram</label>
      <select id="topology-area-filter" class="topology-stitch-select" data-area-filter><option value="all" ${state.area === null ? 'selected' : ''}>Semua area</option>${areas.map(({ key, name }) => `<option value="${escapeAttribute(key)}" ${state.area === key ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>
      <label class="topology-stitch-field-label" for="topology-search">Cari perangkat atau relasi</label>
      <div class="topology-stitch-search-field"><span class="material-symbols-outlined" aria-hidden="true">search</span><input id="topology-search" data-topology-search type="search" value="${escapeAttribute(state.search)}" placeholder="Cari ID, nama, atau jalur…" autocomplete="off"/></div>
      ${results.length ? `<div class="topology-stitch-search-results">${results.map((result) => `<button type="button" data-search-result="${escapeAttribute(`${result.kind}:${result.id}`)}"><span class="material-symbols-outlined" aria-hidden="true">${result.kind === 'edge' ? 'route' : 'device_hub'}</span><span><strong>${escapeHtml(result.label)}</strong><small>${escapeHtml(result.detail)}</small></span></button>`).join('')}</div>` : ''}
      <div class="topology-stitch-filter-section"><div class="topology-stitch-filter-heading"><span>Keluarga jaringan</span><button type="button" class="topology-stitch-link-button" data-family="__reset__">Tampilkan semua</button></div><div class="topology-stitch-family-list">${families.length ? families.map((family) => `<button type="button" class="topology-stitch-family ${state.selectedFamilies.has(family.id) ? 'active' : ''}" data-family="${escapeAttribute(family.id)}"><i style="--family-color:${escapeAttribute(family.color || networkFamilyColor(family.id))}"></i>${escapeHtml(family.label || networkFamilyLabel(family.id))}</button>`).join('') : '<span class="topology-stitch-muted">Belum ada keluarga jaringan.</span>'}</div></div>
      <div class="topology-stitch-filter-section"><label class="topology-stitch-check"><input type="checkbox" data-mounting-toggle ${state.showMountingPhysical ? 'checked' : ''}/><span><strong>Tampilkan mounting fisik</strong><small>Oranye = indoor/standalone; kuning = aset yang masih perlu mounting.</small></span></label></div>
      <div class="topology-stitch-filter-section"><label class="topology-stitch-field-label" for="topology-label-mode">Kepadatan label</label><select id="topology-label-mode" class="topology-stitch-select" data-label-mode><option value="auto" ${state.labelMode === 'auto' ? 'selected' : ''}>Otomatis</option><option value="detail" ${state.labelMode === 'detail' ? 'selected' : ''}>Detail</option><option value="all" ${state.labelMode === 'all' ? 'selected' : ''}>Semua label</option></select></div>
    `
  }

  function updateToolbar() {
    const summary = model?.summary ?? {}
    const setText = (selector, value) => {
      const element = container.querySelector(selector)
      if (element) element.textContent = value
    }
    setText('[data-topology-area-title]', areaName(state.area, mapData.locationGroups))
    setText('[data-topology-connected-count]', `${summary.connectedAssetCount ?? 0} Aktif`)
    setText('[data-topology-offline-count]', `${summary.isolatedAssetCount ?? 0} Offline`)
    setText('[data-topology-pole-count]', `${summary.physicalMountCount ?? 0} Tiang${
      summary.emptyPhysicalMountCount ? ` · ${summary.emptyPhysicalMountCount} kosong` : ''
    }`)
    setText('[data-topology-zoom-label]', `${Math.round(state.zoom * 100)}%`)
    setText('[data-topology-asset-count]', String(summary.totalAssetCount ?? 0))
    setText('[data-topology-edge-count]', String(summary.confirmedEdgeCount ?? 0))
  }

  function updatePanelState() {
    const setHidden = (selector, hidden) => {
      const element = container.querySelector(selector)
      if (element) element.hidden = hidden
    }
    setHidden('[data-topology-filter-panel]', !state.filterOpen)
    setHidden('[data-topology-view-panel]', !state.viewOpen)
    setHidden('[data-topology-export-panel]', !state.exportOpen)
    const inspector = container.querySelector('.topology-stitch-inspector')
    if (inspector) inspector.hidden = !state.inspectorOpen
    container.querySelector('[data-action="toggle-filter"]')?.classList.toggle('active', state.filterOpen)
    container.querySelector('[data-action="toggle-view"]')?.classList.toggle('active', state.viewOpen)
    container.querySelector('[data-action="toggle-export"]')?.classList.toggle('active', state.exportOpen)
  }

  function exportDiagram(kind) {
    const svg = container.querySelector('[data-topology-frame] svg')
    if (!svg) return showToast('Diagram belum siap untuk diekspor.')
    const slug = slugify(`${activeContext.branchName || activeContext.branchId}-${areaName(state.area, mapData.locationGroups)}`)
    const filename = `sinergi-topologi-${slug}.${kind}`
    state.exportOpen = false
    updatePanelState()
    if (kind === 'png') {
      void downloadSchematicPng(svg, filename).catch((error) => showToast(error.message))
    } else {
      downloadSchematicSvg(svg, filename)
    }
  }

  function openAssetMap(assetId) {
    if (!assetId) return
    const params = new URLSearchParams({
      datasetId: activeContext.datasetId,
      branchId: activeContext.branchId,
      selectedAssetId: assetId,
    })
    if (state.area) params.set('area', state.area)
    window.location.assign(`/map?${params.toString()}`)
  }

  function networkPathFor(nodeId) {
    const component = model.components.find(({ nodeIds }) => nodeIds.includes(nodeId))
    if (!component) return [model.nodeById.get(nodeId)].filter(Boolean)
    const root = component.rootId
    const previous = new Map([[root, null]])
    const queue = [root]
    while (queue.length) {
      const current = queue.shift()
      if (current === nodeId) break
      for (const next of model.adjacency.get(current) ?? []) {
        if (!previous.has(next.id)) {
          previous.set(next.id, current)
          queue.push(next.id)
        }
      }
    }
    if (!previous.has(nodeId)) return [model.nodeById.get(nodeId)].filter(Boolean)
    const ids = []
    let cursor = nodeId
    while (cursor) {
      ids.unshift(cursor)
      cursor = previous.get(cursor)
    }
    return ids.map((id) => model.nodeById.get(id)).filter(Boolean)
  }

  function directRelationsFor(nodeId) {
    const seen = new Set()
    return (model.adjacency.get(nodeId) ?? []).filter(({ id, edge }) => {
      const key = `${id}:${edge.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).map(({ id, edge }) => ({ other: model.nodeById.get(id), edge })).filter(({ other }) => other)
  }

  function showToast(message) {
    const toast = container.querySelector('[data-topology-toast]')
    if (!toast) return
    toast.textContent = message
    toast.classList.add('visible')
    window.clearTimeout(state.toastTimer)
    state.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200)
  }

  function syncUrl() {
    const params = new URLSearchParams(window.location.search)
    params.set('datasetId', activeContext.datasetId)
    params.set('branchId', activeContext.branchId)
    params.set('area', state.area ?? 'all')
    if (state.selectedAssetId) params.set('selectedAssetId', state.selectedAssetId)
    else params.delete('selectedAssetId')
    window.history.replaceState(null, '', `/topology?${params.toString()}`)
  }
}

function numericStyle(value, fallback = 0) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : Number(fallback) || 0
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function renderWorkspaceShell({ activeContext, state, model }) {
  const summary = model?.summary ?? {}
  return `
    <div class="topology-stitch-app" data-topology-app>
      ${renderTopNavigation('topology', activeContext)}
      <div class="topology-stitch-shell">
        <nav class="topology-stitch-rail" aria-label="Opsi diagram">
          <div class="topology-stitch-rail-group">
            <button type="button" class="topology-stitch-rail-button active" data-action="toggle-view" title="Opsi tampilan" aria-label="Opsi tampilan"><span class="material-symbols-outlined" aria-hidden="true">visibility</span></button>
            <button type="button" class="topology-stitch-rail-button" data-action="toggle-filter" title="Filter" aria-label="Filter"><span class="material-symbols-outlined" aria-hidden="true">filter_list</span></button>
            <button type="button" class="topology-stitch-rail-button" data-action="toggle-export" title="Export" aria-label="Export"><span class="material-symbols-outlined" aria-hidden="true">download</span></button>
            <button type="button" class="topology-stitch-rail-button topology-stitch-inspector-toggle" data-action="toggle-inspector" title="Panel detail" aria-label="Panel detail"><span class="material-symbols-outlined" aria-hidden="true">right_panel_open</span></button>
          </div>
          <button type="button" class="topology-stitch-rail-button" data-action="help" title="Bantuan" aria-label="Bantuan"><span class="material-symbols-outlined" aria-hidden="true">help</span></button>
        </nav>
        <main class="topology-stitch-main" aria-label="Workspace Diagram Topologi">
          <div class="topology-stitch-toolbar">
            <div class="topology-stitch-toolbar-context"><strong data-topology-area-title>${escapeHtml(areaName(state.area, []))}</strong><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span><span>Topologi Jaringan</span><i></i><span class="topology-stitch-health online"><b></b><span data-topology-connected-count>${summary.connectedAssetCount ?? 0} Aktif</span></span><span class="topology-stitch-health offline"><b></b><span data-topology-offline-count>${summary.isolatedAssetCount ?? 0} Offline</span></span><span class="topology-stitch-health mounting"><b></b><span data-topology-pole-count>${summary.physicalMountCount ?? 0} Tiang${summary.emptyPhysicalMountCount ? ` · ${summary.emptyPhysicalMountCount} kosong` : ''}</span></span></div>
            <div class="topology-stitch-toolbar-actions">
              <div class="topology-stitch-zoom-control"><button type="button" data-action="zoom-out" aria-label="Zoom out"><span class="material-symbols-outlined" aria-hidden="true">remove</span></button><span data-topology-zoom-label>${Math.round(state.zoom * 100)}%</span><button type="button" data-action="zoom-in" aria-label="Zoom in"><span class="material-symbols-outlined" aria-hidden="true">add</span></button></div>
              <button type="button" class="topology-stitch-toolbar-button" data-action="fit" title="Fit semua" aria-label="Fit semua"><span class="material-symbols-outlined" aria-hidden="true">fit_screen</span></button>
              <span class="topology-stitch-toolbar-divider"></span>
              <button type="button" class="topology-stitch-toolbar-button" data-action="toggle-export" title="Aksi lain" aria-label="Aksi lain"><span class="material-symbols-outlined" aria-hidden="true">more_vert</span></button>
            </div>
          </div>
          <div class="topology-stitch-viewport" data-topology-viewport tabindex="0" aria-label="Canvas diagram topologi">
            <div class="topology-stitch-canvas"><div class="topology-stitch-graph-frame" data-topology-frame></div></div>
          </div>
          <div class="topology-stitch-tray" data-topology-tray></div>
        </main>
        <aside class="topology-stitch-inspector" data-topology-inspector aria-label="Detail perangkat"></aside>
      </div>
      <aside class="topology-stitch-floating-panel topology-stitch-filter-panel" data-topology-filter-panel hidden></aside>
      <aside class="topology-stitch-floating-panel topology-stitch-view-panel" data-topology-view-panel hidden>
        <div class="topology-stitch-panel-head"><div><span class="topology-stitch-eyebrow">PRESENTASI</span><h2>Opsi Tampilan</h2></div><button type="button" class="topology-stitch-icon-button" data-action="close-view" aria-label="Tutup opsi tampilan"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <div class="topology-stitch-view-stats"><div><strong data-topology-asset-count>${summary.totalAssetCount ?? 0}</strong><span>aset</span></div><div><strong data-topology-edge-count>${summary.confirmedEdgeCount ?? 0}</strong><span>relasi aktif</span></div><div><strong>${summary.componentCount ?? 0}</strong><span>island</span></div></div>
        <p class="topology-stitch-panel-note">Diagram memakai relasi terkonfirmasi dari dataset aktif. Kotak berwarna menunjukkan perangkat terikat tiang; kotak oranye menunjukkan perangkat non-tiang/indoor.</p>
      </aside>
      <aside class="topology-stitch-floating-panel topology-stitch-export-panel" data-topology-export-panel hidden>
        <div class="topology-stitch-panel-head"><div><span class="topology-stitch-eyebrow">DOWNLOAD</span><h2>Export Diagram</h2></div><button type="button" class="topology-stitch-icon-button" data-action="close-export" aria-label="Tutup export"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <button type="button" class="topology-stitch-export-option" data-export="svg"><span class="material-symbols-outlined" aria-hidden="true">code</span><span><strong>SVG</strong><small>Vektor, cocok untuk dokumentasi.</small></span></button>
        <button type="button" class="topology-stitch-export-option" data-export="png"><span class="material-symbols-outlined" aria-hidden="true">image</span><span><strong>PNG</strong><small>Gambar siap dibagikan.</small></span></button>
      </aside>
      <div class="topology-stitch-toast" data-topology-toast role="status" aria-live="polite"></div>
    </div>
  `
}

function renderLoadingState(context) {
  return `<div class="topology-stitch-app topology-stitch-state-app">${renderTopNavigation('topology', context)}<main class="map-data-state is-loading" aria-live="polite" aria-busy="true"><span class="material-symbols-outlined" aria-hidden="true">progress_activity</span><h1>Memuat dataset aktif</h1><p>Aset dan relasi sedang dibaca dari versi aktif yang sama.</p></main></div>`
}

function renderErrorState(context, error) {
  return `<div class="topology-stitch-app topology-stitch-state-app">${renderTopNavigation('topology', context)}<main class="topology-stitch-state error"><span class="material-symbols-outlined" aria-hidden="true">error</span><h1>Diagram Topologi belum tersedia</h1><p>${escapeHtml(error?.message || 'Dataset aktif tidak dapat dimuat.')}</p><button type="button" class="topology-stitch-primary-button" data-retry-topology>Coba lagi</button></main></div>`
}

function readRequestedDatasetContext() {
  const query = new URLSearchParams(window.location.search)
  let datasetId = query.get('datasetId')
  let branchId = query.get('branchId')
  try {
    datasetId ||= window.sessionStorage.getItem('sinergiActiveDatasetId')
    branchId ||= window.sessionStorage.getItem('sinergiActiveBranchId')
  } catch {
    // Storage may be unavailable in a restricted browser context.
  }
  return {
    datasetId: datasetId || DEFAULT_DATASET_ID,
    branchId: branchId || DEFAULT_BRANCH_ID,
    siteId: query.get('siteId') || null,
  }
}

function persistActiveContext(context) {
  try {
    if (context?.datasetId) window.sessionStorage.setItem('sinergiActiveDatasetId', context.datasetId)
    if (context?.branchId) window.sessionStorage.setItem('sinergiActiveBranchId', context.branchId)
  } catch {
    // Storage is a convenience only.
  }
}

function graphFromPayload(payload, fallback) {
  const graph = payload?.graph ?? payload
  return hasGraph(graph) ? graph : fallback
}

function hasGraph(graph) {
  return Array.isArray(graph?.nodes) && Array.isArray(graph?.edges)
    && (graph.nodes.length > 0 || graph.edges.length > 0)
}

function areaName(area, locationGroups) {
  if (!area) return 'Semua Area'
  return locationGroups?.find(({ key }) => key === area)?.name
    ?? String(area).replaceAll('-', ' ')
}

function physicalLocation(node, group) {
  const area = node.areaName || node.areaKey || 'Area belum tersedia'
  if (!group) return area
  return `${area} · Mounting ${group.pole?.name || group.poleAssetId} · ${group.childCount} aset terpasang`
}

function iconForNode(node) {
  const icon = String(node?.iconType ?? '').toLowerCase()
  const type = `${node?.type ?? ''} ${node?.name ?? ''}`.toLowerCase()
  if (icon.includes('server') || /server|nvr|rack/.test(type)) return 'dns'
  if (icon.includes('junction') || /junction|\bjb\b/.test(type)) return 'device_hub'
  if (icon.includes('switch') || /switch|router/.test(type)) return 'router'
  if (icon.includes('cctv') || /cctv|camera|kamera/.test(type)) return 'videocam'
  if (/sensor/.test(type)) return 'sensors'
  if (/printer|peripheral/.test(type)) return 'developer_board'
  return 'hub'
}

function isOfflineStatus(value) {
  return /offline|down|inactive|rusak|mati|disconnected/i.test(String(value ?? ''))
}

function slugify(value) {
  return String(value ?? 'topology').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'topology'
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

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}
