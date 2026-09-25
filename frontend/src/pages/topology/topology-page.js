import '../../styles/topology-workspace.css'
import '../../styles/topology-refinement.css'
import { adaptActiveDatasetForTopology } from '../../adapters/active-dataset-map-adapter.js'
import { branchNameForFacility } from '../../domain/facility-branch.js'
import { renderLocationContextPanel } from '../../components/location-context-panel.js'
import { stageCameraRelationReplacement } from '../../domain/camera-relation-draft.js'
import { createSourceIconLoader } from '../../domain/source-icon-loader.js'
import { CONNECTION_STYLES } from './topology-connection-style.js'
import {
  buildTopologyDiagramModel,
  getTopologyDiagramSearchResults,
  networkFamilyColor,
  networkFamilyLabel,
} from '../../domain/topology-diagram-model.js'
import { buildPoleGroups, poleGroupForAsset } from '../../domain/pole-groups.js'
import {
  saveTopologyDiagram,
  loadActiveDataset,
  loadTopologyProjection,
  loadTopologyRoots,
} from '../../services/active-dataset-service.js'
import { downloadSchematicPng, downloadSchematicSvg } from '../map/schematic-export.js'
import { bindUserAccountMenu, renderTopNavigation } from '../map/map-page.js'
import { bindThemeToggle } from '../../theme.js'
import { calculateTopologyDiagramLayout } from './topology-diagram-layout.js'
import { loadTopologyDraft } from '../../services/topology-sync-service.js'
import { renderTopologyDiagramSvg } from './topology-diagram-svg.js'
import { resolveTopologyDropTarget } from './topology-drop-target.js'
import { createAssetDragFeedback } from './topology-drag-feedback.js'
import { createDragAutoPan } from './topology-drag-auto-pan.js'
import {
  anchoredZoomScrollPosition,
  computeFitZoom,
  computeReadableZoom,
  effectiveViewportFor,
  zoomSurfaceMetrics,
} from './topology-viewport.js'

const DEFAULT_DATASET_ID = 'dataset-semarang'
const DEFAULT_BRANCH_ID = 'semarang'
const DEFAULT_ZOOM = 1
const MIN_ZOOM = 0.1
const MAX_ZOOM = 1.35
const CANVAS_HORIZONTAL_PADDING = 30
const CANVAS_TOP_PADDING = 24
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
  bindThemeToggle()

  try {
    const draftVersionId = new URLSearchParams(window.location.search).get('draftVersionId')
    let payload
    if (draftVersionId) {
      try {
        payload = await loadTopologyDraft(draftVersionId)
      } catch (error) {
        if (error.status !== 404) throw error
        const active = await loadActiveDataset({ ...requested, view: 'topology' })
        if (active.datasetVersion?.id !== draftVersionId) throw error
        const url = new URL(window.location.href)
        url.searchParams.delete('draftVersionId')
        window.history.replaceState({}, '', url)
        payload = active
      }
    } else {
      payload = await loadActiveDataset({ ...requested, view: 'topology' })
    }
    const mapData = adaptActiveDatasetForTopology(payload)
    mapData.recordRevision = payload.recordRevision
    mapData.topologyFrameNames = payload.topologyFrameNames ?? {}
    mapData.topologyFrameAssignments = payload.topologyFrameAssignments ?? {}
    mapData.topologyFrames = payload.topologyFrames ?? {}
    mapData.isDraft = payload.draft === true
    mapData.editingRequiresDraft = payload.editingRequiresDraft === true
    if (mapData.isDraft) mapData.activeContext.draftVersionId = draftVersionId
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

    const rootsPayload = Array.isArray(payload.topologyRoots)
      ? { roots: payload.topologyRoots }
      : graph.graphRevision
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
    bindThemeToggle()
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
    sidebarCollapsed: window.matchMedia?.('(max-width: 960px)').matches ?? false,
    exportOpen: false,
    actionsOpen: false,
    legendOpen: false,
    inspectorOpen: Boolean(selectedAssetFromUrl),
    searchResults: [],
    relationSearch: '',
    removeEdgeMode: false,
    mutationBusy: false,
    frameComposerOpen: false,
    pendingFrameId: null,
    frameNames: Object.fromEntries(Object.entries(mapData.topologyFrameNames ?? {}).map(([id, name]) => [`pole-group:${id}`, name])),
    changes: [],
    saveError: '',
    toastTimer: null,
  }

  let model = null
  let layout = null
  let searchTimer = null
  let panState = null
  let dragState = null
  let suppressViewportClick = false
  let savedSnapshot = null
  const sourceIconLoader = createSourceIconLoader()
  const captureSavedSnapshot = () => structuredClone({ graph, assets: mapData.assets,
    mountingRelations: mapData.mountingRelations,
    topologyFrameAssignments: mapData.topologyFrameAssignments,
    topologyFrames: mapData.topologyFrames,
    frameNames: state.frameNames })
  savedSnapshot = captureSavedSnapshot()

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

  const buildLayout = (overrides = {}) => calculateTopologyDiagramLayout(model, {
    minWidth: 1240,
    componentColumns: 3,
    componentMaxColumns: 4,
    componentPackingAspectRatio: 2.25,
    layoutStyle: 'central-backbone',
    mountingBoxMinWidth: 248,
    mountingBoxPadding: 24,
    mountingBoxHeaderHeight: 52,
    mountingBoxNodeGapX: 36,
    mountingBoxLevelGapY: 82,
    mountingBoxGapY: 54,
    mountingBoxGapX: 36,
    mountingRootFrameGap: state.area === 'ft-tegal-baru' ? 64 : null,
    overview: state.area === null,
    frameAssignments: mapData.topologyFrameAssignments,
    customFrames: mapData.topologyFrames,
    ...overrides,
  })

  const rebuild = ({ fit = false } = {}) => {
    model = buildModel()
    if (!model.nodeById.has(state.selectedAssetId)) state.selectedAssetId = null
    layout = buildLayout()
    renderGraph()
    renderInspector()
    renderTray()
    renderTopologySidebar()
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
  bindThemeToggle()
  bindWorkspaceEvents()
  renderGraph()
  renderInspector()
  renderTray()
  renderTopologySidebar()
  updateToolbar()
  updatePanelState()
  requestAnimationFrame(() => state.selectedAssetId ? focusRelations() : resetGraphViewport())

  function bindWorkspaceEvents() {
    container.addEventListener('click', handleClick)
    container.addEventListener('change', handleChange)
    container.addEventListener('input', handleInput)
    container.addEventListener('keydown', handleKeydown)
    container.addEventListener('dblclick', handleDoubleClick)
    container.addEventListener('submit', handleSubmit)
    const viewport = container.querySelector('[data-topology-viewport]')
    const warnUnsaved = event => {
      if (!viewport?.isConnected) { window.removeEventListener('beforeunload', warnUnsaved); return }
      if (state.changes.length) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warnUnsaved)
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
    viewport?.addEventListener('lostpointercapture', endPan)

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
    if (event.target?.closest?.('[data-publish-draft]') && state.changes.length) {
      event.preventDefault()
      showToast('Simpan perubahan ke draft sebelum menerbitkan.')
      return
    }
    if (state.actionsOpen && !event.target?.closest?.('[data-topology-actions-menu], [data-action="toggle-actions"]')) {
      state.actionsOpen = false
      updatePanelState()
    }
    // Do not replace the SVG label between the clicks of a double-click.
    if (event.target?.closest?.('[data-frame-label]')) return
    const target = event.target?.closest?.('[data-node-id], [data-edge-id], [data-mounting-group-id]')
    if (target?.dataset.nodeId) {
      selectAsset(target.dataset.nodeId)
      return
    }
    if (target?.dataset.edgeId) {
      if (state.removeEdgeMode) {
        void removeRelation(target.dataset.edgeId)
        return
      }
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
    if (action === 'open-sync') {
      const draftId = new URLSearchParams(window.location.search).get('draftVersionId')
      window.location.assign(draftId
        ? `/admin/topology-sync?draftVersionId=${encodeURIComponent(draftId)}`
        : '/admin/topology-sync')
      return
    }
    if (action === 'save-diagram') return void saveDraft()
    if (action === 'cancel-diagram') return cancelDraft()
    if (action === 'add-pole-frame') return openFrameComposer()
    if (action === 'toggle-actions') {
      state.actionsOpen = !state.actionsOpen
      state.exportOpen = false
      state.legendOpen = false
      updatePanelState()
      return
    }
    if (action === 'close-frame-composer') return closeFrameComposer()
    if (action === 'rename-selected-frame') {
      state.actionsOpen = false
      updatePanelState()
      const label = container.querySelector(`[data-frame-label="${cssEscape(state.selectedMountingGroupId)}"]`)
      if (label) openFrameNameEditor(state.selectedMountingGroupId, label)
      return
    }
    if (action === 'zoom-in') return changeZoom(0.1)
    if (action === 'zoom-out') return changeZoom(-0.1)
    if (action === 'zoom-reset') return zoomGraphTo(DEFAULT_ZOOM)
    if (action === 'fit') return fitGraph()
    if (action === 'focus-relations') return focusRelations()
    if (action === 'toggle-remove-edge') {
      state.actionsOpen = false
      state.removeEdgeMode = !state.removeEdgeMode
      updatePanelState()
      return
    }
    if (action === 'toggle-export') {
      state.exportOpen = !state.exportOpen
      state.legendOpen = false
      updatePanelState()
      return
    }
    if (action === 'toggle-legend') {
      state.legendOpen = !state.legendOpen
      state.exportOpen = false
      updatePanelState()
      return
    }
    if (action === 'toggle-sidebar') {
      state.sidebarCollapsed = !state.sidebarCollapsed
      updatePanelState()
      requestAnimationFrame(() => syncGraphSurface({ preserveCenter: true }))
      return
    }
    if (action === 'close-export') {
      state.exportOpen = false
      updatePanelState()
      return
    }
    if (action === 'close-legend') {
      state.legendOpen = false
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
    if (action === 'cancel-frame-name') {
      closeFrameNameEditor()
      return
    }
    if (action === 'remove-relation') {
      const relationId = event.target.closest('[data-action]')?.dataset.relationId
      if (relationId) void removeRelation(relationId)
      return
    }
    if (action === 'open-map') return openAssetMap(event.target.closest('[data-action]')?.dataset.assetId)
    if (action === 'retry') return void renderTopologyPage(container)
    if (action === 'help') {
      showToast('Tarik aset ke aset untuk membuat relasi, atau ke ruang kosong frame untuk memindahkan.')
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
      const result = state.searchResults.find((item) => item.kind === kind && item.id === id)
      selectSearchResult(result ?? {kind, id})
      return
    }

    const relationTarget = event.target?.closest?.('[data-relation-target]')
    if (relationTarget?.dataset.relationTarget) {
      void addRelation(state.selectedAssetId, relationTarget.dataset.relationTarget)
      return
    }
    const frameOption = event.target?.closest?.('[data-frame-option]')
    if (frameOption) return chooseFrameOption(frameOption.dataset.frameOption)

    const exportButton = event.target?.closest?.('[data-export]')
    if (exportButton?.dataset.export) {
      exportDiagram(exportButton.dataset.export)
      return
    }

    if (event.target?.closest?.('[data-topology-viewport]')) clearSelection()
  }

  function handleChange(event) {
    const target = event.target
    if (target.matches('[data-asset-frame-select]')) {
      const box = layout?.mountingBoxes?.find(item => item.id === target.value)
      if (box && state.selectedAssetId) void moveAssetToFrame(state.selectedAssetId, box)
      return
    }
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
    if (target.matches('[data-topology-search]')) {
      state.search = target.value
      window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(() => {
        state.searchResults = getTopologyDiagramSearchResults(model, state.search)
        rebuild()
      }, 120)
      return
    }
    if (target.matches('[data-relation-search]')) {
      state.relationSearch = target.value
      renderRelationSearchResults()
    }
    if (target.matches('[data-frame-search]')) renderFrameOptions(target.value)
  }

  function handleKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      state.sidebarCollapsed = false
      updatePanelState()
      container.querySelector('[data-topology-search]')?.focus()
      return
    }
    if (event.key === 'Escape') {
      const openPanel = state.legendOpen ? 'legend' : state.exportOpen ? 'export' : null
      state.exportOpen = false
      state.legendOpen = false
      state.actionsOpen = false
      updatePanelState()
      if (openPanel) container.querySelector(`[data-action="toggle-${openPanel}"]`)?.focus()
      if (dragState) cancelAssetDrag()
      closeFrameComposer()
      if (state.removeEdgeMode) {
        state.removeEdgeMode = false
        updatePanelState()
      }
      closeFrameNameEditor()
      return
    }
    if (event.target?.matches?.('[data-topology-search]')) {
      if (event.key !== 'Enter') return
      event.preventDefault()
      const results = state.searchResults.length
        ? state.searchResults
        : getTopologyDiagramSearchResults(model, event.target.value)
      if (results[0]) selectSearchResult(results[0])
      else showToast('Aset atau relasi tidak ditemukan.')
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    const frameLabel = event.target?.closest?.('[data-frame-label]')
    if (frameLabel) {
      event.preventDefault()
      openFrameNameEditor(frameLabel.dataset.frameLabel, frameLabel)
      return
    }
    const target = event.target?.closest?.('[data-node-id], [data-edge-id], [data-mounting-group-id]')
    if (!target) return
    event.preventDefault()
    if (target.dataset.nodeId) selectAsset(target.dataset.nodeId)
    else if (target.dataset.edgeId) selectEdge(target.dataset.edgeId)
    else if (target.dataset.mountingGroupId) selectMountingGroup(target.dataset.mountingGroupId)
  }

  function handleDoubleClick(event) {
    const label = event.target?.closest?.('[data-frame-label]')
    if (!label?.dataset.frameLabel) return
    event.preventDefault()
    openFrameNameEditor(label.dataset.frameLabel, label)
  }

  function handleSubmit(event) {
    if (!event.target?.matches?.('[data-frame-name-form]')) return
    event.preventDefault()
    const form = event.target
    const groupId = form.dataset.groupId
    const input = form.querySelector('[data-frame-name-input]')
    const value = String(input?.value ?? '').trim()
    const box = layout?.mountingBoxes?.find(item => item.id === groupId)
    if (!groupId || !box || (!box.hostId && !mapData.topologyFrames?.[groupId]) || state.mutationBusy) return
    if (value) state.frameNames[groupId] = value
    else delete state.frameNames[groupId]
    if (mapData.topologyFrames?.[groupId]) {
      const frame = { ...mapData.topologyFrames[groupId], name: value || box.hostName }
      mapData.topologyFrames = { ...mapData.topologyFrames, [groupId]: frame }
      stageChange({ type: 'create-frame', frame })
    } else {
      stageChange({ type: 'rename-frame', assetId: box.hostId, name: value })
    }
    closeFrameNameEditor()
    renderGraph()
  }

  function selectSearchResult(result) {
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
      persistTopologyArea(areaStorageKey, state.area)
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

  function toggleFamily(family) {
    if (state.selectedFamilies.has(family)) state.selectedFamilies.delete(family)
    else state.selectedFamilies.add(family)
    rebuild()
  }

  function changeZoom(delta) {
    zoomGraphTo(state.zoom + delta)
  }

  function setZoom(value) {
    state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value) || DEFAULT_ZOOM))
  }

  function graphSafeViewport(viewport) {
    const bounds = viewport.getBoundingClientRect()
    const visibleOverlay = (selector) => {
      const element = container.querySelector(selector)
      if (!element || element.hidden || getComputedStyle(element).visibility === 'hidden') return null
      return element.getBoundingClientRect()
    }
    const context = visibleOverlay('.topology-context-card')
    const actions = visibleOverlay('.topology-stitch-toolbar')
    const navigation = visibleOverlay('.topology-canvas-navigation')
    const overlayTop = Math.max(CANVAS_TOP_PADDING,
      ...[context, actions].filter(Boolean).map((rect) => rect.bottom - bounds.top + 16))
    const overlayBottom = navigation
      ? Math.max(CANVAS_BOTTOM_PADDING, bounds.bottom - navigation.top + 12)
      : CANVAS_BOTTOM_PADDING
    return effectiveViewportFor({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      paddingLeft: CANVAS_HORIZONTAL_PADDING,
      paddingRight: CANVAS_HORIZONTAL_PADDING,
      overlayTop,
      overlayBottom,
    })
  }

  function fitGraph() {
    if (!layout?.width || !layout?.height) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    const safe = graphSafeViewport(viewport)
    setZoom(computeFitZoom({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      minZoom: MIN_ZOOM,
      maxZoom: 1.12,
      horizontalPadding: CANVAS_HORIZONTAL_PADDING * 2,
      verticalPadding: viewport.clientHeight - safe.height,
    }))
    renderGraph()
    updateToolbar()
    requestAnimationFrame(() => centerGraph({ smooth: true, wholeContent: true }))
  }

  function focusAssetCard(assetId) {
    const target = layout?.nodes?.find((node) => node.id === assetId)
    if (!target?.diagram) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    const center = {
      x: target.diagram.centerX,
      y: target.diagram.centerY,
    }
    const nextZoom = Math.min(MAX_ZOOM, Math.max(state.zoom, 1))
    if (nextZoom !== state.zoom) {
      setZoom(nextZoom)
      renderGraph()
      updateToolbar()
    }
    requestAnimationFrame(() => {
      const frame = container.querySelector('[data-topology-frame]')
      if (!frame) return
      restoreViewportCenter(viewport, frame, center, { respectOverlays: true })
    })
  }

  function focusMountingGroup(groupId) {
    const target = layout?.mountingBoxes?.find((box) => box.id === groupId)
    if (!target) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    const center = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    }
    const nextZoom = Math.min(MAX_ZOOM, Math.max(state.zoom, 0.9))
    if (nextZoom !== state.zoom) {
      setZoom(nextZoom)
      renderGraph()
      updateToolbar()
    }
    requestAnimationFrame(() => {
      const frame = container.querySelector('[data-topology-frame]')
      if (!frame) return
      restoreViewportCenter(viewport, frame, center, { respectOverlays: true })
    })
  }

  function focusRelations() {
    const selected = model.nodeById.get(state.selectedAssetId)
    if (!selected) return showToast('Pilih JB atau kamera, lalu klik Fokus relasi.')
    const ids = new Set([selected.id])
    for (const edgeId of selected.directEdgeIds ?? []) {
      const edge = model.edgeById.get(edgeId)
      if (edge) { ids.add(edge.sourceId); ids.add(edge.targetId) }
    }
    const nodes = layout.nodes.filter(node => ids.has(node.id))
    const bounds = nodes.map(node => node.diagram)
    const left = Math.min(...bounds.map(box => box.x)) - 36
    const right = Math.max(...bounds.map(box => box.x + box.width)) + 36
    const top = Math.min(...bounds.map(box => box.y)) - 72
    const bottom = Math.max(...bounds.map(box => box.y + box.height)) + 36
    const viewport = container.querySelector('[data-topology-viewport]')
    const frame = container.querySelector('[data-topology-frame]')
    if (!viewport || !frame) return
    const safe = graphSafeViewport(viewport)
    const fittedZoom = Math.min(1.12, safe.width / (right - left),
      safe.height / (bottom - top))
    setZoom(Math.max(0.5, fittedZoom))
    renderGraph()
    updateToolbar()
    const selectedDiagram = nodes.find((node) => node.id === selected.id)?.diagram
    requestAnimationFrame(() => restoreViewportCenter(viewport, frame, {
      x: fittedZoom < 0.5 && selectedDiagram ? selectedDiagram.centerX : (left + right) / 2,
      y: fittedZoom < 0.5 && selectedDiagram ? selectedDiagram.centerY : (top + bottom) / 2,
    }, { respectOverlays: true }))
  }

  function resetGraphViewport() {
    if (!layout?.width || !layout?.height) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    const safe = graphSafeViewport(viewport)
    if (layout.options?.layoutStyle === 'facility-schematic') {
      setZoom(Math.max(viewport.clientWidth < 620 ? 0.7 : 0.8, Math.min(DEFAULT_ZOOM,
        (viewport.clientWidth - CANVAS_HORIZONTAL_PADDING * 2) / layout.width)))
      renderGraph()
      updateToolbar()
      requestAnimationFrame(() => centerGraph())
      return
    }
    const readableFloor = viewport.clientWidth < 620 ? 0.85 : DEFAULT_ZOOM
    setZoom(computeReadableZoom({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      minZoom: readableFloor,
      maxZoom: DEFAULT_ZOOM,
      horizontalPadding: CANVAS_HORIZONTAL_PADDING * 2,
      verticalPadding: viewport.clientHeight - safe.height,
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
    const sourceIconPreload = sourceIconLoader.preload(
      layout.nodes.map(({ sourceIconUrl }) => sourceIconUrl),
    )
    if (sourceIconPreload) {
      void sourceIconPreload.then(() => {
        if (frame.isConnected && !dragState?.active) renderGraph()
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
        branchId: activeContext.branchId,
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
    const safe = graphSafeViewport(viewport)
    const metrics = zoomSurfaceMetrics({
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      zoom: state.zoom,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      horizontalPadding: viewport.clientWidth < 820 ? 16 : CANVAS_HORIZONTAL_PADDING,
      topPadding: safe.top,
      bottomPadding: viewport.clientHeight - safe.bottom,
    })
    canvas.style.width = `${metrics.width}px`
    canvas.style.height = `${metrics.height}px`
    frame.style.left = `${metrics.frameLeft}px`
    frame.style.top = `${metrics.frameTop}px`
    if (snapshot) restoreViewportCenter(viewport, frame, snapshot)
  }

  function centerGraph({ smooth = false, wholeContent = false } = {}) {
    const viewport = container.querySelector('[data-topology-viewport]')
    const frame = container.querySelector('[data-topology-frame]')
    if (!viewport || !frame) return
    const mountedBoxes = (layout.mountingBoxes ?? [])
      .map(({ x, y, width, height }) => ({ x, y, width, height }))
    const diagramBoxes = mountedBoxes.length ? mountedBoxes
      : (layout.nodes ?? []).map(({ diagram }) => diagram).filter(Boolean)
    const boxes = diagramBoxes.length ? diagramBoxes
      : [{ x: 0, y: 0, width: layout.width, height: layout.height }]
    const content = boxes.length ? {
      left: Math.min(...boxes.map((box) => box.x)),
      right: Math.max(...boxes.map((box) => box.x + box.width)),
      top: Math.min(...boxes.map((box) => box.y)),
      bottom: Math.max(...boxes.map((box) => box.y + box.height)),
    } : { left: 0, right: layout.width, top: 0, bottom: layout.height }
    const frameLeft = numericStyle(frame.style.left, frame.offsetLeft)
    const frameTop = numericStyle(frame.style.top, frame.offsetTop)
    const safe = graphSafeViewport(viewport)
    const contentWidth = (content.right - content.left) * state.zoom
    const left = contentWidth <= viewport.clientWidth - 64
      ? frameLeft + (content.left + content.right) * state.zoom / 2 - viewport.clientWidth / 2
      : frameLeft + content.left * state.zoom - 32
    const visibleContent = boxes.filter((box) => (
      box.x + box.width > (Math.max(0, left) - frameLeft) / state.zoom
      && box.x < (Math.max(0, left) - frameLeft + viewport.clientWidth) / state.zoom
    ))
    const verticalBoxes = visibleContent.length ? visibleContent : boxes
    const visibleTop = Math.min(...verticalBoxes.map((box) => box.y))
    const firstRow = verticalBoxes.filter((box) => box.y <= visibleTop + 40)
    const visibleBottom = Math.max(...firstRow.map((box) => box.y + box.height))
    const focusY = wholeContent ? (content.top + content.bottom) / 2
      : (visibleTop + visibleBottom) / 2
    const targetY = wholeContent ? safe.top + safe.height / 2
      : safe.top + safe.height * .43
    const top = frameTop + focusY * state.zoom - targetY
    viewport.scrollTo({
      left: Math.max(0, Math.min(left, viewport.scrollWidth - viewport.clientWidth)),
      top: Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight)),
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

  function restoreViewportCenter(viewport, frame, snapshot, { respectOverlays = false } = {}) {
    const safe = respectOverlays ? graphSafeViewport(viewport) : null
    const targetX = safe ? safe.left + safe.width / 2 : viewport.clientWidth / 2
    const targetY = safe ? safe.top + safe.height / 2 : viewport.clientHeight / 2
    viewport.scrollLeft = Math.max(0, numericStyle(frame.style.left, frame.offsetLeft)
      + snapshot.x * state.zoom - targetX)
    viewport.scrollTop = Math.max(0, numericStyle(frame.style.top, frame.offsetTop)
      + snapshot.y * state.zoom - targetY)
  }

  function beginPan(event) {
    if (event.button !== 0 || state.mutationBusy || dragState || panState) return
    const node = event.target.closest('[data-node-id]')
    if (node?.dataset.nodeId && !state.mutationBusy) {
      node.setPointerCapture(event.pointerId)
      dragState = {
        viewport: event.currentTarget,
        captureElement: node,
        pointerId: event.pointerId,
        assetId: node.dataset.nodeId,
        startX: event.clientX,
        startY: event.clientY,
        distance: 0,
        active: false,
        targetGroupId: null,
      }
      return
    }
    if (event.pointerType === 'touch') return
    if (event.target.closest('[data-edge-id], [data-mounting-group-id], button, a, input, select')) return
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
    if (dragState && event.pointerId === dragState.pointerId) {
      moveAssetDrag(event)
      return
    }
    if (!panState || event.pointerId !== panState.pointerId) return
    const viewport = event.currentTarget
    const deltaX = event.clientX - panState.x
    const deltaY = event.clientY - panState.y
    panState.distance = Math.max(panState.distance, Math.hypot(deltaX, deltaY))
    viewport.scrollLeft = panState.left - deltaX
    viewport.scrollTop = panState.top - deltaY
  }

  function endPan(event) {
    if (dragState && event.pointerId === dragState.pointerId) {
      endAssetDrag(event)
      return
    }
    if (!panState || event.pointerId !== panState.pointerId) return
    suppressViewportClick = panState.distance >= 4
    panState = null
    event.currentTarget.classList.remove('is-panning')
    window.setTimeout(() => { suppressViewportClick = false }, 0)
  }

  function moveAssetDrag(event) {
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY)
    dragState.distance = Math.max(dragState.distance, distance)
    if (!dragState.active && distance < 6) return
    event.preventDefault()
    if (!dragState.active) {
      dragState.active = true
      event.currentTarget.classList.add('is-dragging-asset')
      const source = container.querySelector(`[data-node-id="${cssEscape(dragState.assetId)}"]`)
      if (!source) {
        cancelAssetDrag()
        return
      }
      dragState.feedback = createAssetDragFeedback(source, event, { reducedMotion: prefersReducedMotion() })
      dragState.autoPan = createDragAutoPan(dragState.viewport, pointer => {
        if (dragState?.active) scheduleAssetDropTarget(pointer)
      })
      source.classList.add('is-dragging')
    }
    dragState.feedback.move(event)
    scheduleAssetDropTarget(event)
    dragState.autoPan.move(event)
  }

  function scheduleAssetDropTarget({ clientX, clientY }) {
    if (!dragState?.active) return
    dragState.latestPointer = { clientX, clientY }
    if (dragState.targetFrame) return
    dragState.targetFrame = window.requestAnimationFrame(() => {
      if (!dragState?.active) return
      dragState.targetFrame = 0
      updateAssetDropTarget(dragState.latestPointer)
    })
  }

  function updateAssetDropTarget(event) {
    const viewport = dragState.viewport
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const inside = hit && viewport.contains(hit)
    const hitNode = inside ? hit.closest('[data-node-id]') : null
    const targetId = hitNode?.dataset.nodeId
    const box = inside ? mountingGroupAtClientPoint(hit) : null
    const drop = resolveTopologyDropTarget({ sourceId: dragState.assetId, targetId, box, model })
    dragState.drop = drop
    dragState.targetGroupId = drop.kind === 'move' ? drop.box.id : null
    dragState.feedback.target(drop.kind === 'move'
      ? hit.closest('[data-mounting-group-id]') : null, drop.box)
    dragState.feedback.connection(drop.kind === 'connect' ? hitNode : null)
    dragState.feedback.hint(drop.message, drop.kind !== 'invalid')
  }

  function clearAssetDrag(completed) {
    completed.autoPan?.stop()
    if (completed.targetFrame) window.cancelAnimationFrame(completed.targetFrame)
    dragState = null
    completed.viewport.classList.remove('is-dragging-asset')
    container.querySelectorAll('.topology-node.is-dragging')
      .forEach(element => element.classList.remove('is-dragging'))
    if (completed.captureElement.hasPointerCapture(completed.pointerId)) {
      completed.captureElement.releasePointerCapture(completed.pointerId)
    }
    if (completed.active) {
      suppressViewportClick = true
      window.setTimeout(() => { suppressViewportClick = false }, 0)
    }
  }

  function cancelAssetDrag() {
    const completed = dragState
    if (!completed) return
    clearAssetDrag(completed)
    completed.feedback?.cancel()
  }

  function endAssetDrag(event) {
    // Losing capture or native touch cancellation must never commit a stale hover.
    if (event.type !== 'pointerup') { cancelAssetDrag(); return }
    if (dragState.active) updateAssetDropTarget(event)
    const completed = dragState
    clearAssetDrag(completed)
    if (!completed.active) return
    const drop = completed.drop
    if (state.mutationBusy || drop?.kind === 'invalid' || !drop) {
      void completed.feedback?.finish()
      if (drop) showToast(drop.message)
      return
    }
    if (drop.kind === 'connect') {
      void addRelation(completed.assetId, drop.targetId)
      void completed.feedback?.finish(container.querySelector(`[data-node-id="${cssEscape(drop.targetId)}"]`))
      showToast('Relasi ditambahkan ke draft. Pilih Simpan untuk menerapkan.')
      return
    }
    void moveAssetToFrame(completed.assetId, drop.box, completed.feedback)
  }

  function mountingGroupAtClientPoint(hit) {
    const frame = container.querySelector('[data-topology-frame]')
    if (!frame || !layout?.mountingBoxes) return null
    const group = hit?.closest('[data-mounting-group-id]')
    if (!group || !frame.contains(group)) return null
    // SVG rendering can reposition frames. Use the visible group's identity,
    // not stale layout coordinates; labels and the expanded drop slot count too.
    return layout.mountingBoxes.find(box => box.id === group.dataset.mountingGroupId
      && ['confirmed', 'empty', 'excluded'].includes(box.kind)) ?? null
  }

  async function moveAssetToFrame(assetId, box, feedback = null) {
    const node = model.nodeById.get(assetId)
    if (!node || !box) return
    const currentFrameId = mapData.topologyFrameAssignments?.[assetId] ?? null
    const displayedFrameId = layout?.nodes?.find(item => item.id === assetId)?.mountingBoxId ?? null
    const current = (mapData.mountingRelations ?? []).find((relation) => (
      relation.sourceAssetId === assetId
        && !['rejected', 'revoked'].includes(String(relation.verificationStatus).toLowerCase())
    ))
    if (box.kind === 'excluded') {
      if (currentFrameId === box.id && !current && displayedFrameId === box.id) {
        void feedback?.finish()
        return
      }
      mapData.topologyFrameAssignments = {
        ...(mapData.topologyFrameAssignments ?? {}),
        [assetId]: box.id,
      }
      stageChange({ type: 'move-frame', assetId, frameId: box.id })
      if (current) {
        applyMutationResponse({ mountingRelations: (mapData.mountingRelations ?? [])
          .filter(relation => relation.sourceAssetId !== assetId) })
        stageChange({ type: 'mount', assetId, poleAssetId: null, action: 'detach' })
      }
      rebuild()
      void feedback?.finish(container.querySelector(`[data-mounting-group-id="${cssEscape(box.id)}"]`))
      return
    }
    if (!box.hostId) return
    if (current?.targetAssetId === box.hostId) {
      if (displayedFrameId !== box.id || currentFrameId !== box.id) {
        mapData.topologyFrameAssignments = { ...(mapData.topologyFrameAssignments ?? {}), [assetId]: box.id }
        stageChange({ type: 'move-frame', assetId, frameId: box.id })
        rebuild()
      }
      void feedback?.finish()
      return
    }
    if (state.mutationBusy) { feedback?.cancel(); return }
    mapData.topologyFrameAssignments = { ...(mapData.topologyFrameAssignments ?? {}), [assetId]: box.id }
    stageChange({ type: 'move-frame', assetId, frameId: box.id })
    const previousMounting = mapData.mountingRelations ?? []
    applyMutationResponse({ mountingRelations: [
      ...previousMounting.filter(relation => relation.sourceAssetId !== assetId),
      { sourceAssetId: assetId, targetAssetId: box.hostId, relationType: 'mounted_on', verificationStatus: 'confirmed', provenance: 'manual_admin' },
    ] })
    stageChange({ type: 'mount', assetId, poleAssetId: box.hostId })
    rebuild()
    void feedback?.finish(container.querySelector(`[data-mounting-group-id="${cssEscape(box.id)}"]`))
  }

  async function removeRelation(edgeId) {
    const edge = model.edgeById.get(edgeId)
    if (!edge || state.mutationBusy) return
    const added = state.changes.find(change => change.type === 'add-relation' && change.draftEdgeId === edgeId)
    if (added) state.changes = state.changes.filter(change => change !== added)
    else stageChange({ type: 'remove-edge', edgeId })
    graph = { ...graph, edges: graph.edges.filter(item => (item.id ?? item.relationId) !== edgeId) }
    state.removeEdgeMode = false
    state.selectedEdgeId = null
    rebuild()
    showToast('Relasi dihapus dari draft. Gunakan Batal untuk memulihkannya sebelum disimpan.')
  }

  async function addRelation(sourceAssetId, targetAssetId) {
    if (!sourceAssetId || !targetAssetId || sourceAssetId === targetAssetId || state.mutationBusy) return
    const target = model.nodeById.get(targetAssetId)
    if (!target) return
    if ((model.adjacency.get(sourceAssetId) ?? []).some(item => item.id === targetAssetId)) return
    const replacement = stageCameraRelationReplacement({
      graph, changes: state.changes, nodes: [...model.nodeById.values()],
      sourceAssetId, targetAssetId,
    })
    graph = replacement.graph
    state.changes = replacement.changes
    const savedEdge = savedSnapshot.graph.edges.find(edge => {
      const a = edge.sourceAssetId ?? edge.sourceNodeId
      const b = edge.targetAssetId ?? edge.targetNodeId
      return (a === sourceAssetId && b === targetAssetId)
        || (a === targetAssetId && b === sourceAssetId)
    })
    const savedEdgeId = savedEdge?.id ?? savedEdge?.relationId
    if (savedEdgeId && state.changes.some(change =>
      change.type === 'remove-edge' && change.edgeId === savedEdgeId)) {
      state.changes = state.changes.filter(change =>
        change.type !== 'remove-edge' || change.edgeId !== savedEdgeId)
      graph = { ...graph, edges: [...graph.edges, savedEdge] }
      state.relationSearch = ''
      state.selectedAssetId = sourceAssetId
      rebuild()
      showToast('Relasi awal dipulihkan dalam draft.')
      return
    }
    const id = `draft-edge:${crypto.randomUUID()}`
    graph = { ...graph, edges: [...graph.edges, { id, relationId: id, sourceAssetId, targetAssetId,
      sourceNodeId: sourceAssetId, targetNodeId: targetAssetId, relationType: 'connected-to',
      direction: 'undirected', verificationStatus: 'confirmed', provenance: 'manual_admin' }] }
    stageChange({ type: 'add-relation', sourceAssetId, targetAssetId, draftEdgeId: id })
    state.relationSearch = ''
    state.selectedAssetId = sourceAssetId
    rebuild()
    if (replacement.replaced.length) showToast('Relasi JB utama sebelumnya diganti dalam draft. Batal akan memulihkannya.')
  }

  function stageChange(change) {
    if (['mount', 'move-frame', 'rename-frame'].includes(change.type)) {
      state.changes = state.changes.filter(item => item.type !== change.type || item.assetId !== change.assetId)
    }
    if (change.type === 'create-frame') {
      state.changes = state.changes.filter(item => item.type !== 'create-frame' || item.frame?.id !== change.frame?.id)
    }
    state.changes.push(change)
    state.saveError = ''
    updatePanelState()
  }

  function cancelDraft() {
    if (state.mutationBusy) return
    const snapshot = structuredClone(savedSnapshot)
    graph = snapshot.graph
    mapData.topologyGraph = graph
    mapData.assets = snapshot.assets
    applyMutationResponse({ mountingRelations: snapshot.mountingRelations })
    mapData.topologyFrameAssignments = snapshot.topologyFrameAssignments ?? {}
    mapData.topologyFrames = snapshot.topologyFrames ?? {}
    state.frameNames = snapshot.frameNames
    state.changes = []
    state.saveError = ''
    closeFrameNameEditor()
    rebuild()
  }

  async function saveDraft() {
    if (!state.changes.length || state.mutationBusy) return
    if (mapData.editingRequiresDraft && !mapData.isDraft) {
      showToast('Buat draft dari menu Sinkronisasi data sebelum menyimpan koreksi.')
      return
    }
    await runMutation(async () => {
      const response = await saveTopologyDiagram({ datasetVersionId: activeContext.datasetVersionId,
        expectedRecordRevision: mapData.recordRevision,
        changes: state.changes.map(({ draftEdgeId, ...change }) => change) })
      applyMutationResponse(response)
      mapData.recordRevision = response.recordRevision
      mapData.topologyFrameAssignments = response.topologyFrameAssignments ?? {}
      mapData.topologyFrames = response.topologyFrames ?? {}
      state.frameNames = Object.fromEntries(Object.entries(response.topologyFrameNames ?? {}).map(([id, name]) => [`pole-group:${id}`, name]))
      state.changes = []
      state.saveError = ''
      savedSnapshot = captureSavedSnapshot()
      rebuild()
    })
  }

  async function runMutation(operation) {
    if (state.mutationBusy) return
    state.mutationBusy = true
    updatePanelState()
    try {
      await operation()
    } catch (error) {
      state.saveError = error?.message || 'Perubahan belum dapat disimpan. Draft tetap tersedia.'
      showToast(error?.message || 'Perubahan belum dapat disimpan. Coba lagi.')
    } finally {
      state.mutationBusy = false
      updatePanelState()
    }
  }

  function applyMutationResponse(response) {
    if (response?.graph) {
      graph = response.graph
      mapData.topologyGraph = response.graph
    }
    if (response && Object.prototype.hasOwnProperty.call(response, 'topologyFrameAssignments')) {
      mapData.topologyFrameAssignments = structuredClone(response.topologyFrameAssignments ?? {})
    }
    if (response && Object.prototype.hasOwnProperty.call(response, 'topologyFrames')) {
      mapData.topologyFrames = structuredClone(response.topologyFrames ?? {})
    }
    if (Array.isArray(response?.mountingRelations)) {
      mapData.mountingRelations = response.mountingRelations
      mapData.poleGroups = buildPoleGroups({
        assets: mapData.assets,
        mountingRelations: mapData.mountingRelations,
      })
      const mountedOnByAsset = new Map(response.mountingRelations.map((relation) => [
        relation.sourceAssetId,
        relation.targetAssetId,
      ]))
      const manualMounts = new Set(response.mountingRelations.filter(relation => relation.provenance === 'manual_admin').map(relation => relation.sourceAssetId))
      const childrenByPole = new Map()
      response.mountingRelations.forEach(relation => {
        const children = childrenByPole.get(relation.targetAssetId) ?? []
        children.push(relation.sourceAssetId)
        childrenByPole.set(relation.targetAssetId, children)
      })
      mapData.assets.forEach((asset) => {
        asset.mountedOnAssetId = mountedOnByAsset.get(asset.id) ?? null
        asset.mountedAssetIds = childrenByPole.get(asset.id) ?? []
        if (manualMounts.has(asset.id)) asset.mountingExpectation = 'pole'
      })
      graph.nodes?.forEach(node => {
        node.mountedOnAssetId = mountedOnByAsset.get(node.id) ?? null
        node.mountedAssetIds = childrenByPole.get(node.id) ?? []
        if (manualMounts.has(node.id)) node.mountingExpectation = 'pole'
      })
    }
  }

  function openFrameNameEditor(groupId, labelElement) {
    const form = container.querySelector('[data-frame-name-form]')
    const input = form?.querySelector('[data-frame-name-input]')
    const box = layout?.mountingBoxes?.find(({ id }) => id === groupId)
    if (!form || !input || !box || (!box.hostId && !mapData.topologyFrames?.[groupId]) || state.mutationBusy) return
    const rect = labelElement.getBoundingClientRect()
    form.dataset.groupId = groupId
    input.value = state.frameNames[groupId] || box.label || box.hostName || box.hostId || ''
    form.hidden = false
    form.style.left = `${Math.min(window.innerWidth - 282, Math.max(12, rect.left - 12))}px`
    form.style.top = `${Math.min(window.innerHeight - 86, rect.bottom + 8)}px`
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  }

  function closeFrameNameEditor() {
    const form = container.querySelector('[data-frame-name-form]')
    if (!form || form.hidden) return
    form.hidden = true
    form.removeAttribute('data-group-id')
  }

  function openFrameComposer() {
    if (state.mutationBusy || state.frameComposerOpen) return
    const areaKey = state.area ?? model.areas?.[0]?.key ?? mapData.locationGroups?.[0]?.key
    if (!areaKey) { showToast('Area untuk frame belum tersedia.'); return }
    if (!state.area) {
      state.area = areaKey
      persistTopologyArea(areaStorageKey, areaKey)
    }
    const id = `excluded-mounting:${areaKey}:custom:${crypto.randomUUID()}`
    mapData.topologyFrames = {
      ...(mapData.topologyFrames ?? {}),
      [id]: { id, type: 'non-pole', areaKey, name: 'Frame baru' },
    }
    state.pendingFrameId = id
    state.frameComposerOpen = true
    rebuild()
    const composer = container.querySelector('[data-frame-composer]')
    const input = composer?.querySelector('[data-frame-search]')
    if (!composer || !input) return
    composer.hidden = false
    input.value = ''
    renderFrameOptions('')
    requestAnimationFrame(() => {
      focusFrame(id)
      input.focus()
    })
  }

  function closeFrameComposer({ discard = true } = {}) {
    const composer = container.querySelector('[data-frame-composer]')
    if (composer) composer.hidden = true
    const pendingId = state.pendingFrameId
    state.frameComposerOpen = false
    state.pendingFrameId = null
    if (!discard || !pendingId || !mapData.topologyFrames?.[pendingId]) return
    const next = { ...(mapData.topologyFrames ?? {}) }
    delete next[pendingId]
    mapData.topologyFrames = next
    rebuild()
  }

  function frameChoices(queryText = '') {
    const query = String(queryText).trim().toLocaleLowerCase('id')
    const custom = [
      { value: 'type:indoor', label: 'Indoor', detail: 'Frame perangkat di dalam ruangan', icon: 'home' },
      { value: 'type:non-pole', label: 'Non-tiang', detail: 'Frame perangkat tanpa tiang', icon: 'deployed_code' },
    ]
    const poles = (model.physicalMounts ?? [])
      .slice()
      .sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), 'id', { numeric: true }))
      .map((pole) => ({
        value: `pole:${pole.id}`,
        label: state.frameNames[`pole-group:${pole.id}`] || pole.name || pole.id,
        detail: pole.areaName || pole.locationGroupName || areaName(pole.areaKey, mapData.locationGroups),
        icon: 'cell_tower',
      }))
    return [...custom, ...poles].filter(({ label, detail }) => (
      !query || `${label} ${detail}`.toLocaleLowerCase('id').includes(query)
    )).slice(0, 80)
  }

  function renderFrameOptions(query) {
    const results = container.querySelector('[data-frame-options]')
    if (!results) return
    const choices = frameChoices(query)
    results.innerHTML = choices.map((choice, index) => `${index === 2 ? '<div class="topology-frame-option-separator"><span>Tiang</span></div>' : ''}
      <button type="button" role="option" data-frame-option="${escapeAttribute(choice.value)}">
        <span class="material-symbols-outlined" aria-hidden="true">${choice.icon}</span>
        <span><strong>${escapeHtml(choice.label)}</strong><small>${escapeHtml(choice.detail)}</small></span>
        <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
      </button>`).join('') || '<p class="topology-frame-options-empty">Frame tidak ditemukan.</p>'
  }

  function chooseFrameOption(value) {
    const pendingId = state.pendingFrameId
    const pending = mapData.topologyFrames?.[pendingId]
    if (!pending || state.mutationBusy) return
    let frame
    if (value === 'type:indoor' || value === 'type:non-pole') {
      const type = value.slice(5)
      frame = { ...pending, type, name: type === 'indoor' ? 'Indoor' : 'Non-tiang' }
      const next = { ...(mapData.topologyFrames ?? {}), [pendingId]: frame }
      mapData.topologyFrames = next
    } else if (value.startsWith('pole:')) {
      const poleId = value.slice(5)
      const pole = model.physicalMounts.find(item => item.id === poleId)
      if (!pole) return
      const next = { ...(mapData.topologyFrames ?? {}) }
      delete next[pendingId]
      frame = { id: `pole-group:${pole.id}`, type: 'pole', areaKey: pole.areaKey,
        poleAssetId: pole.id, name: pole.name || pole.id }
      next[frame.id] = frame
      mapData.topologyFrames = next
      state.area = pole.areaKey
      persistTopologyArea(areaStorageKey, state.area)
    } else return
    stageChange({ type: 'create-frame', frame })
    closeFrameComposer({ discard: false })
    rebuild()
    requestAnimationFrame(() => focusFrame(frame.id))
    showToast(`${frame.name} ditambahkan ke draft.`)
  }

  function focusFrame(frameId) {
    const box = layout?.mountingBoxes?.find(item => item.id === frameId)
    const viewport = container.querySelector('[data-topology-viewport]')
    const frame = container.querySelector('[data-topology-frame]')
    if (!box || !viewport || !frame) return
    state.selectedMountingGroupId = box.id
    renderGraph()
    updatePanelState()
    restoreViewportCenter(viewport, frame, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  }

  function relationTargetsFor(nodeId, queryText) {
    const query = String(queryText || '').trim().toLocaleLowerCase('id')
    if (!query) return []
    const connectedIds = new Set((model.adjacency.get(nodeId) ?? []).map(({ id }) => id))
    const source = model.nodeById.get(nodeId)
    return model.nodes
      .filter((candidate) => candidate.id !== nodeId && !connectedIds.has(candidate.id))
      .filter(candidate => candidate.areaKey === source?.areaKey)
      .map((candidate) => {
        const haystack = `${candidate.name || ''} ${candidate.id} ${candidate.type || ''}`
          .toLocaleLowerCase('id')
        const index = haystack.indexOf(query)
        return { candidate, score: index === 0 ? 2 : index >= 0 ? 1 : 0 }
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score
        || String(left.candidate.name || left.candidate.id).localeCompare(
          String(right.candidate.name || right.candidate.id), 'id',
        ))
      .slice(0, 8)
      .map(({ candidate }) => candidate)
  }

  function renderRelationSearchResults() {
    const results = container.querySelector('[data-relation-search-results]')
    if (!results) return
    const targets = relationTargetsFor(state.selectedAssetId, state.relationSearch)
    const hasQuery = Boolean(state.relationSearch.trim())
    results.hidden = !hasQuery
    results.innerHTML = targets.length
      ? targets.map((target) => `
        <button type="button" data-relation-target="${escapeAttribute(target.id)}">
          <span class="topology-stitch-relation-result-icon"><span class="material-symbols-outlined" aria-hidden="true">${iconForNode(target)}</span></span>
          <span><strong>${escapeHtml(target.name || target.id)}</strong><small>${escapeHtml(target.type || target.assetType || 'Aset')} · ${escapeHtml(target.areaName || '')}</small></span>
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
        </button>
      `).join('')
      : hasQuery ? '<p>Tidak ada aset lain yang cocok atau aset sudah terhubung.</p>' : ''
  }

  function renderInspector() {
    const inspector = container.querySelector('[data-topology-inspector]')
    if (!inspector) return
    inspector.innerHTML = state.selectedAssetId
      ? renderAssetInspector(model.nodeById.get(state.selectedAssetId))
      : state.selectedEdgeId
        ? renderEdgeInspector(model.edgeById.get(state.selectedEdgeId))
        : renderNoSelectionInspector()
    if (state.selectedAssetId) renderRelationSearchResults()
  }

  function renderAssetInspector(node) {
    if (!node) return renderNoSelectionInspector()
    const group = poleGroupForAsset(mapData.poleGroups, node.id)
    const path = networkPathFor(node.id)
    const relations = directRelationsFor(node.id)
    const needsPrimaryReview = (graph.cameraRelationReview ?? []).some(item =>
      item.cameraAssetId === node.id)
      && !relations.some(({ other }) => ['junction-peer', 'junction-extended']
        .includes(other.diagramClass))
    const online = node.connectivityStatus !== 'disconnected' && !isOfflineStatus(node.status)
    const canMountOnPole = /junction\s*box|\bjb\b|cctv|camera|kamera/i.test(
      `${node.type ?? ''} ${node.assetType ?? ''} ${node.name ?? ''}`)
    const availableFrames = (layout?.mountingBoxes ?? []).filter(box =>
      ['confirmed', 'empty', 'excluded'].includes(box.kind)
        && (!box.areaKey || box.areaKey === node.areaKey)
        && (canMountOnPole || box.kind === 'excluded'))
    const displayedFrameId = layout?.nodes?.find(item => item.id === node.id)?.mountingBoxId ?? ''
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
        ${needsPrimaryReview ? `<p class="topology-primary-review" role="status">Beberapa kandidat JB memiliki bukti setara. Pilih satu relasi utama untuk kamera ini.</p>` : ''}
        <section class="topology-stitch-inspector-card">
          <div class="topology-stitch-section-label"><span class="material-symbols-outlined" aria-hidden="true">location_on</span>Lokasi Fisik</div>
          <p>${escapeHtml(physicalLocation(node, group))}</p>
        </section>
        <section class="topology-stitch-inspector-section topology-frame-picker">
          <label for="topology-asset-frame">Pindahkan ke frame</label>
          <select id="topology-asset-frame" data-asset-frame-select ${state.mutationBusy ? 'disabled' : ''}>
            <option value="">Pilih frame tujuan…</option>
            ${availableFrames.map(box => `<option value="${escapeAttribute(box.id)}" ${box.id === displayedFrameId ? 'selected' : ''}>${escapeHtml(box.label || box.hostName || box.id)}</option>`).join('')}
          </select>
          <small>Penempatan tiang juga memperbarui mounting di Peta Aset setelah disimpan.</small>
        </section>
        <section class="topology-stitch-inspector-section">
          <label>Jalur Jaringan</label>
          <div class="topology-stitch-path">${path.map((item, index) => `
            ${index ? '<span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>' : ''}
            <span class="${item.id === node.id ? 'current' : ''}">${escapeHtml(item.name || item.id)}</span>
          `).join('') || `<span class="current">${escapeHtml(node.name || node.id)}</span>`}</div>
        </section>
        <section class="topology-stitch-inspector-section">
          <div class="topology-stitch-section-heading">
            <label>Relasi (${relations.length})</label>
            <span>Perubahan masuk ke draft</span>
          </div>
          <div class="topology-stitch-relations">
            ${relations.length ? relations.map(({ other, edge }) => `
              <div class="topology-stitch-relation-row">
                <button type="button" class="topology-stitch-relation" data-select-asset="${escapeAttribute(other.id)}">
                  <span class="topology-stitch-relation-main"><span class="material-symbols-outlined" aria-hidden="true">${iconForNode(other)}</span><strong>${escapeHtml(other.name || other.id)}</strong></span>
                  <span class="topology-stitch-relation-meta">${escapeHtml(edge.networkFamilyLabel || networkFamilyLabel(other.networkFamily))}<i class="${other.connectivityStatus === 'disconnected' ? 'offline' : ''}"></i></span>
                </button>
                <button type="button" class="topology-stitch-relation-remove" data-action="remove-relation"
                  data-relation-id="${escapeAttribute(edge.id)}" aria-label="Hapus relasi dengan ${escapeAttribute(other.name || other.id)}"
                  title="Hapus relasi" ${state.mutationBusy ? 'disabled' : ''}>
                  <span class="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </div>
            `).join('') : '<p class="topology-stitch-muted">Belum ada relasi terkonfirmasi pada perangkat ini.</p>'}
          </div>
          <div class="topology-relation-editor">
            <label class="topology-stitch-search-field" for="topology-relation-search">
              <span class="material-symbols-outlined" aria-hidden="true">search</span>
              <input id="topology-relation-search" data-relation-search type="search"
                value="${escapeAttribute(state.relationSearch)}" placeholder="Cari aset untuk dihubungkan…"
                autocomplete="off" spellcheck="false" ${state.mutationBusy ? 'disabled' : ''}/>
            </label>
            <div class="topology-relation-search-results" data-relation-search-results
              role="listbox" aria-label="Aset yang dapat dihubungkan" hidden></div>
            <small>Pilih aset dan garis akan dibuat otomatis.</small>
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
    const hasIsolated = isolated.length > 0
    tray.hidden = !hasIsolated
    tray.closest('.topology-stitch-main')?.classList.toggle('has-disconnected-tray', hasIsolated)
    tray.innerHTML = `
      <div class="topology-stitch-tray-title"><span class="material-symbols-outlined" aria-hidden="true">link_off</span><span>Belum terhubung</span><strong>${isolated.length}</strong></div>
      <div class="topology-stitch-tray-list">
        ${isolated.map((node) => `<button type="button" class="topology-stitch-tray-item" data-tray-asset="${escapeAttribute(node.id)}" title="Fokus ke ${escapeAttribute(node.name || node.id)}"><span class="topology-stitch-tray-icon"><span class="material-symbols-outlined" aria-hidden="true">${iconForNode(node)}</span></span><span>${escapeHtml(node.name || node.id)}</span></button>`).join('')}
      </div>
    `
  }

  function renderTopologySidebar() {
    const sidebar = container.querySelector('[data-topology-sidebar]')
    if (!sidebar) return
    const input = sidebar.querySelector('[data-topology-search]')
    if (input && input.value !== state.search) input.value = state.search
    const results = sidebar.querySelector('[data-topology-search-results]')
    if (!results) return
    const hasQuery = Boolean(String(state.search || '').trim())
    results.hidden = !hasQuery
    results.setAttribute('aria-expanded', String(hasQuery))
    input?.setAttribute('aria-expanded', String(hasQuery))
    sidebar.querySelectorAll('[data-family]').forEach((button) => {
      const family = button.dataset.family
      const active = family === '__reset__'
        ? state.selectedFamilies.size === 0
        : state.selectedFamilies.has(family)
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    results.innerHTML = state.searchResults.length
      ? state.searchResults.map((result) => `<button type="button" data-search-result="${escapeAttribute(`${result.kind}:${result.id}`)}"><span class="material-symbols-outlined" aria-hidden="true">${result.kind === 'edge' ? 'route' : 'device_hub'}</span><span><strong>${escapeHtml(result.label)}</strong><small>${escapeHtml(result.detail)}</small></span><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>`).join('')
      : hasQuery
        ? '<p>Tidak ada perangkat atau relasi yang cocok.</p>'
        : ''
  }

  function updateToolbar() {
    const summary = model?.summary ?? {}
    const setText = (selector, value) => {
      container.querySelectorAll(selector).forEach((element) => {
        element.textContent = value
      })
    }
    const currentAreaName = areaName(state.area, mapData.locationGroups)
    setText('[data-topology-area-title]', currentAreaName)
    container.querySelector('[data-topology-area-title]')?.setAttribute('title', currentAreaName)
    const branchLabel = branchNameForFacility(
      mapData.locationGroups.find(({ key }) => key === state.area),
      activeContext.branchName,
    ) || activeContext.branchId
    setText('[data-topology-branch-title]', branchLabel)
    container.querySelector('[data-topology-branch-title]')?.setAttribute('title', branchLabel)
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
    setHidden('[data-topology-export-panel]', !state.exportOpen)
    setHidden('[data-topology-legend]', !state.legendOpen)
    setHidden('[data-topology-actions-menu]', !state.actionsOpen)
    setHidden('[data-remove-mode-hint]', !state.removeEdgeMode)
    const actionsToggle = container.querySelector('[data-action="toggle-actions"]')
    actionsToggle?.setAttribute('aria-expanded', String(state.actionsOpen))
    const inspector = container.querySelector('.topology-stitch-inspector')
    if (inspector) inspector.hidden = !state.inspectorOpen
    const app = container.querySelector('[data-topology-app]')
    app?.classList.toggle('topology-sidebar-collapsed', state.sidebarCollapsed)
    app?.classList.toggle('is-remove-edge-mode', state.removeEdgeMode)
    app?.classList.toggle('is-saving', state.mutationBusy)
    const draftBar = container.querySelector('[data-draft-bar]')
    if (draftBar) {
      draftBar.hidden = !state.changes.length
      draftBar.querySelector('[data-draft-count]').textContent = state.mutationBusy
        ? 'Menyimpan perubahan…' : `${state.changes.length} perubahan belum disimpan`
      draftBar.querySelector('[data-draft-error]').textContent = state.saveError
      draftBar.querySelectorAll('button').forEach(button => { button.disabled = state.mutationBusy })
      draftBar.setAttribute('aria-busy', String(state.mutationBusy))
    }
    const focusButton = container.querySelector('[data-action="focus-relations"]')
    if (focusButton) focusButton.disabled = !state.selectedAssetId
    const renameButton = container.querySelector('[data-action="rename-selected-frame"]')
    if (renameButton) {
      renameButton.disabled = !state.selectedMountingGroupId || state.mutationBusy
      renameButton.title = state.selectedMountingGroupId
        ? 'Ubah nama frame terpilih'
        : 'Pilih frame terlebih dahulu'
    }
    container.querySelectorAll('[data-action="toggle-sidebar"]').forEach((button) => {
      button.setAttribute('aria-expanded', String(!state.sidebarCollapsed))
    })
    const actionStates = {
      'toggle-export': state.exportOpen,
      'toggle-legend': state.legendOpen,
      'toggle-remove-edge': state.removeEdgeMode,
    }
    Object.entries(actionStates).forEach(([action, active]) => {
      container.querySelectorAll(`[data-action="${action}"]`).forEach((button) => {
        button.classList.toggle('active', active)
        button.setAttribute('aria-pressed', String(active))
        if (['toggle-export', 'toggle-legend'].includes(action)) {
          button.setAttribute('aria-expanded', String(active))
          button.setAttribute('aria-controls', action === 'toggle-legend' ? 'topology-legend' : 'topology-export-panel')
        }
      })
    })
    const legendToggle = container.querySelector('[data-action="toggle-legend"]')
    legendToggle?.setAttribute('aria-label', state.legendOpen ? 'Sembunyikan legenda diagram' : 'Tampilkan legenda diagram')
    container.querySelectorAll('[data-action="toggle-remove-edge"]').forEach((button) => {
      button.setAttribute('aria-label', state.removeEdgeMode ? 'Selesai menghapus relasi' : 'Aktifkan mode hapus relasi')
      button.setAttribute('title', state.removeEdgeMode ? 'Selesai menghapus relasi (Esc)' : 'Hapus relasi dengan memilih garis')
      const label = button.querySelector('[data-remove-edge-label]')
      if (label) label.textContent = state.removeEdgeMode ? 'Selesai' : 'Hapus relasi'
      button.disabled = state.mutationBusy
    })
  }

  function exportDiagram(kind) {
    if (!layout || layout.status !== 'ready') return showToast('Diagram belum siap untuk diekspor.')
    const exportLayout = layout
    const displayBranchName = branchNameForFacility(
      mapData.locationGroups.find(({ key }) => key === state.area),
      activeContext.branchName,
    )
    const svg = new DOMParser().parseFromString(renderTopologyDiagramSvg({
      model,
      layout: exportLayout,
      context: {...activeContext, branchName: displayBranchName, areaKey: state.area},
      renderMode: 'export', showMountingPhysical: state.showMountingPhysical,
      sourceIconDataByUrl: sourceIconLoader.dataByUrl,
      mountingLabelById: state.frameNames,
    }), 'image/svg+xml').documentElement
    const slug = slugify(`${displayBranchName || activeContext.branchId}-${areaName(state.area, mapData.locationGroups)}`)
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
    state.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200)
  }

  function syncUrl() {
    const params = new URLSearchParams(window.location.search)
    params.set('datasetId', activeContext.datasetId)
    params.set('branchId', activeContext.branchId)
    params.set('area', state.area ?? 'all')
    if (state.selectedAssetId) params.set('selectedAssetId', state.selectedAssetId)
    else params.delete('selectedAssetId')
    window.history.replaceState(null, '', `/topology?${params.toString()}`)
    const mapLink = container.querySelector('.top-navigation nav a[href^="/map"]')
    if (mapLink) {
      const mapParams = new URLSearchParams({ datasetId: activeContext.datasetId, branchId: activeContext.branchId })
      mapParams.set('area', state.area ?? 'all')
      if (state.selectedAssetId) mapParams.set('selectedAssetId', state.selectedAssetId)
      mapLink.href = `/map?${mapParams.toString()}`
    }
  }
}

function numericStyle(value, fallback = 0) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : Number(fallback) || 0
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function renderTopologySidebarMarkup({ activeContext, mapData, state, summary, families }) {
  const areas = mapData.locationGroups ?? []
  const datasetLabel = activeContext.datasetName || activeContext.version || 'Dataset aktif'
  return `
    <aside class="network-sidebar topology-sidebar" id="topology-sidebar"
      data-topology-sidebar aria-label="Kontrol diagram topologi">
      <header class="sidebar-heading">
        <div>
          <span class="eyebrow">DATASET AKTIF</span>
          <h1>Diagram topologi</h1>
        </div>
        <div class="sidebar-heading-actions">
          <button class="icon-button sidebar-collapse desktop-only" type="button"
            title="Tutup panel" aria-label="Tutup panel diagram" aria-expanded="true"
            data-action="toggle-sidebar">
            <span class="material-symbols-outlined" aria-hidden="true">left_panel_close</span>
          </button>
          <button class="icon-button close-sidebar mobile-only" type="button"
            aria-label="Tutup panel diagram" aria-expanded="true" data-action="toggle-sidebar">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </header>
      <div class="sidebar-content">
        <label class="area-selector">
          <span>Area fasilitas</span>
          <span class="area-selector-control">
            <select aria-label="Area fasilitas" data-area-filter>
              <option value="all" ${state.area === null ? 'selected' : ''}>Semua area</option>
              ${areas.map(({ key, name }) => `<option value="${escapeAttribute(key)}" ${state.area === key ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
            </select>
            <span class="area-selector-icon material-symbols-outlined" aria-hidden="true">expand_more</span>
          </span>
        </label>

        <div class="asset-search-combobox">
          <label class="search-control">
            <span class="material-symbols-outlined" aria-hidden="true">search</span>
            <input id="topology-search" data-topology-search type="search" value="${escapeAttribute(state.search)}"
              placeholder="Cari perangkat atau relasi" autocomplete="off" spellcheck="false"
              aria-label="Cari perangkat atau relasi" aria-autocomplete="list" aria-haspopup="listbox"
              aria-controls="topology-search-results" aria-expanded="false" />
            <kbd>Ctrl K</kbd>
          </label>
          <div class="sidebar-asset-search-results topology-search-results" id="topology-search-results"
            data-topology-search-results role="listbox" aria-label="Hasil pencarian diagram" hidden></div>
        </div>

        <details class="topology-sidebar-disclosure" ${window.matchMedia?.('(min-width: 961px)').matches ? 'open' : ''}>
          <summary><span class="material-symbols-outlined" aria-hidden="true">tune</span><span>Tampilan &amp; filter</span><span class="material-symbols-outlined topology-disclosure-chevron" aria-hidden="true">expand_more</span></summary>
        <section class="topology-sidebar-filter" aria-labelledby="topology-network-filter-title">
          <header class="topology-sidebar-section-heading">
            <span id="topology-network-filter-title">Jaringan</span>
            <small>Sorot jalur; aset lain tetap tampil</small>
          </header>
          <div class="map-category-presets topology-family-presets" aria-label="Filter keluarga jaringan">
            <button type="button" data-family="__reset__" class="${state.selectedFamilies.size === 0 ? 'active' : ''}"
              aria-pressed="${state.selectedFamilies.size === 0}">Semua</button>
            ${(families ?? []).map((family) => `<button type="button" data-family="${escapeAttribute(family.id)}"
              class="${state.selectedFamilies.has(family.id) ? 'active' : ''}"
              aria-pressed="${state.selectedFamilies.has(family.id)}">
              <i style="--family-color:${escapeAttribute(family.color || networkFamilyColor(family.id))}" aria-hidden="true"></i>
              ${escapeHtml(family.label || networkFamilyLabel(family.id))}
            </button>`).join('')}
          </div>
          <div class="topology-sidebar-options">
            <label class="topology-sidebar-option topology-sidebar-switch">
              <span><strong>Frame fisik</strong><small>Indoor, non-tiang, dan tiang</small></span>
              <input type="checkbox" data-mounting-toggle ${state.showMountingPhysical ? 'checked' : ''}
                aria-label="Tampilkan frame fisik" />
              <i aria-hidden="true"></i>
            </label>
            <label class="topology-sidebar-option topology-sidebar-label-mode">
              <span><strong>Label aset</strong><small>Atur kepadatan teks</small></span>
              <select id="topology-label-mode" data-label-mode aria-label="Kepadatan label aset">
                <option value="auto" ${state.labelMode === 'auto' ? 'selected' : ''}>Otomatis</option>
                <option value="detail" ${state.labelMode === 'detail' ? 'selected' : ''}>Ringkas</option>
                <option value="all" ${state.labelMode === 'all' ? 'selected' : ''}>Lengkap</option>
              </select>
            </label>
          </div>
        </section>
        </details>

        <div class="sidebar-list-header topology-sidebar-summary">
          <div class="selection-summary">
            <span><strong data-topology-asset-count>${summary.totalAssetCount ?? 0}</strong> aset · <strong data-topology-edge-count>${summary.confirmedEdgeCount ?? 0}</strong> relasi aktif</span>
          </div>
        </div>

        <section class="sidebar-secondary-context topology-sidebar-secondary" aria-label="Informasi diagram">
          <section class="dataset-card" aria-label="${escapeAttribute(datasetLabel)}">
            <span class="dataset-icon material-symbols-outlined" aria-hidden="true">account_tree</span>
            <div>
              <strong>${escapeHtml(datasetLabel)}</strong>
              <span>Versi aktif</span>
            </div>
            <span class="status-dot" title="Dataset aktif"></span>
          </section>
        </section>

        <footer class="sidebar-footer topology-sidebar-footer">
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
          <p>Tarik aset ke perangkat untuk menghubungkan, atau ke frame untuk memindahkan.</p>
          <button type="button" class="topology-sidebar-help" data-action="help" aria-label="Bantuan diagram">
            <span class="material-symbols-outlined" aria-hidden="true">help</span>
          </button>
        </footer>
      </div>
    </aside>
  `
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value))
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)
}

function renderWorkspaceShell({ activeContext, mapData, state, model }) {
  const summary = model?.summary ?? {}
  const branchLabel = branchNameForFacility(
    mapData.locationGroups.find(({ key }) => key === state.area),
    activeContext.branchName,
  ) || activeContext.branchId
  return `
    <div class="topology-stitch-app" data-topology-app>
      ${renderTopNavigation('topology', { ...activeContext, area: state.area ?? 'all' })}
      <div class="topology-stitch-shell">
        ${renderTopologySidebarMarkup({
          activeContext,
          mapData,
          state,
          summary,
          families: model?.networkOptions ?? [],
        })}
        <main class="topology-stitch-main" aria-label="Workspace Diagram Topologi">
          <button type="button" class="topology-sidebar-reopen" data-action="toggle-sidebar" aria-label="Buka panel diagram">
            <span class="material-symbols-outlined" aria-hidden="true">left_panel_open</span>
          </button>
          ${renderLocationContextPanel({
            surface: 'topology',
            branchName: branchLabel,
            areaName: areaName(state.area, mapData.locationGroups),
          })}
          ${mapData.editingRequiresDraft && !mapData.isDraft ? `<div class="topology-draft-required" role="status">
            <span>Versi aktif hanya untuk dilihat. Buat draft untuk mengedit.</span>
            <a href="/admin/topology-sync">Buat draft</a>
          </div>` : ''}
          ${mapData.isDraft ? `<div class="topology-draft-required is-draft" role="status">
            <span>Ini diagram draft. Simpan koreksi, lalu terbitkan agar muncul di diagram aktif.</span>
            <a data-publish-draft href="/admin/topology-sync?draftVersionId=${encodeURIComponent(activeContext.draftVersionId || activeContext.datasetVersionId)}">Tinjau &amp; terbitkan</a>
          </div>` : ''}
          <div class="topology-stitch-toolbar" role="group" aria-label="Alat diagram">
            <div class="topology-stitch-toolbar-actions">
              <div class="topology-toolbar-group topology-toolbar-edit-actions" aria-label="Edit diagram">
                <button type="button" class="topology-stitch-toolbar-button topology-toolbar-labeled topology-toolbar-primary" data-action="add-pole-frame"
                  title="Tambah frame Indoor, Non-tiang, atau tiang" aria-label="Tambah frame"><span class="material-symbols-outlined" aria-hidden="true">add_box</span><span>Tambah frame</span></button>
                <button type="button" class="topology-stitch-toolbar-button topology-toolbar-labeled" data-action="toggle-export" title="Ekspor diagram" aria-label="Ekspor diagram"><span class="material-symbols-outlined" aria-hidden="true">ios_share</span><span>Ekspor</span></button>
                <button type="button" class="topology-stitch-toolbar-button topology-toolbar-labeled" data-action="toggle-actions" aria-label="Tindakan lainnya" aria-controls="topology-actions-menu" aria-expanded="false" title="Tindakan lainnya"><span class="material-symbols-outlined" aria-hidden="true">more_horiz</span><span>Lainnya</span></button>
              </div>
            </div>
          </div>
          <div class="topology-actions-menu" id="topology-actions-menu" data-topology-actions-menu hidden>
            <span class="topology-actions-heading">Tindakan diagram</span>
            <button type="button" data-action="rename-selected-frame" title="Pilih frame terlebih dahulu" disabled><span class="material-symbols-outlined" aria-hidden="true">edit</span><span>Ubah nama frame</span></button>
            <button type="button" class="topology-remove-edge-tool" data-action="toggle-remove-edge" aria-pressed="false"><span class="material-symbols-outlined" aria-hidden="true">link_off</span><span data-remove-edge-label>Hapus relasi</span></button>
            <button type="button" data-action="open-sync"><span class="material-symbols-outlined" aria-hidden="true">sync_alt</span><span>Sinkronisasi data</span></button>
          </div>
          <div class="topology-remove-mode-hint" data-remove-mode-hint role="status" hidden>
            <span class="material-symbols-outlined" aria-hidden="true">link_off</span>
            <span><strong>Mode hapus relasi</strong><small>Pilih garis yang ingin dihapus. Perubahan masih bisa dibatalkan sebelum disimpan.</small></span>
            <button type="button" data-action="toggle-remove-edge">Selesai</button>
          </div>
          <div class="topology-stitch-viewport" data-topology-viewport tabindex="0" aria-label="Canvas diagram topologi">
            <div class="topology-stitch-canvas"><div class="topology-stitch-graph-frame" data-topology-frame></div></div>
          </div>
          <div class="topology-canvas-navigation" role="group" aria-label="Navigasi kanvas">
              <div class="topology-toolbar-group topology-toolbar-navigation" aria-label="Navigasi diagram">
                <div class="topology-stitch-zoom-control"><button type="button" data-action="zoom-out" aria-label="Perkecil diagram"><span class="material-symbols-outlined" aria-hidden="true">remove</span></button><button type="button" class="topology-zoom-reset" data-action="zoom-reset" data-topology-zoom-label title="Kembalikan zoom ke 100%" aria-label="Kembalikan zoom ke 100%">${Math.round(state.zoom * 100)}%</button><button type="button" data-action="zoom-in" aria-label="Perbesar diagram"><span class="material-symbols-outlined" aria-hidden="true">add</span></button></div>
                <button type="button" class="topology-stitch-toolbar-button topology-toolbar-navigation-button" data-action="fit" title="Tampilkan seluruh diagram" aria-label="Tampilkan seluruh diagram"><span class="material-symbols-outlined" aria-hidden="true">fit_screen</span><span>Semua</span></button>
                <button type="button" class="topology-stitch-toolbar-button topology-toolbar-navigation-button" data-action="focus-relations" title="Fokus ke relasi aset terpilih" aria-label="Fokus ke relasi aset terpilih"><span class="material-symbols-outlined" aria-hidden="true">center_focus_strong</span><span>Aset</span></button>
                <span class="topology-navigation-divider" aria-hidden="true"></span>
                <button type="button" class="topology-stitch-toolbar-button topology-toolbar-navigation-button topology-legend-toggle"
                  data-action="toggle-legend" title="Legenda diagram" aria-label="Tampilkan legenda diagram"
                  aria-controls="topology-legend" aria-expanded="false"><span class="material-symbols-outlined" aria-hidden="true">info</span></button>
              </div>
          </div>
          <div class="topology-stitch-tray" data-topology-tray></div>
          <div class="topology-draft-bar" data-draft-bar hidden role="status" aria-live="polite">
            <span class="topology-draft-indicator"></span><div><strong data-draft-count></strong><small data-draft-error></small></div>
            <button type="button" data-action="cancel-diagram">Batal</button>
            <button type="button" class="topology-save-button" data-action="save-diagram">Simpan ke draft</button>
          </div>
          <aside class="topology-legend-popover" id="topology-legend" data-topology-legend hidden>
            <header><strong>Legenda diagram</strong><button type="button" data-action="close-legend" aria-label="Tutup legenda"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></header>
            <section><small>Frame</small><span><i class="topology-legend-frame pole"></i>Tiang</span><span><i class="topology-legend-frame indoor"></i>Indoor</span><span><i class="topology-legend-frame standalone"></i>Non-tiang</span></section>
            <section><small>Perangkat</small><span><i class="topology-legend-device server"></i>Server</span><span><i class="topology-legend-device junction"></i>Junction Box</span><span><i class="topology-legend-device camera"></i>Kamera</span></section>
            <section><small>Jenis koneksi</small>${Object.values(CONNECTION_STYLES).map(style => `<span><i class="topology-legend-route" style="--legend-route:${escapeAttribute(style.color)}"></i>${escapeHtml(style.label)}</span>`).join('')}</section>
            <footer>Warna garis menunjukkan jenis koneksi.</footer>
          </aside>
        </main>
        <aside class="topology-stitch-inspector" data-topology-inspector aria-label="Detail perangkat"></aside>
      </div>
      <aside class="topology-stitch-floating-panel topology-stitch-export-panel" id="topology-export-panel" data-topology-export-panel hidden>
        <div class="topology-stitch-panel-head"><div><span class="topology-stitch-eyebrow">Ekspor</span><h2>Export diagram</h2></div><button type="button" class="topology-stitch-icon-button" data-action="close-export" aria-label="Tutup export"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <button type="button" class="topology-stitch-export-option" data-export="svg"><span class="material-symbols-outlined" aria-hidden="true">code</span><span><strong>SVG resolusi tinggi</strong><small>Vektor lengkap dengan susunan frame dan legenda.</small></span></button>
        <button type="button" class="topology-stitch-export-option" data-export="png"><span class="material-symbols-outlined" aria-hidden="true">image</span><span><strong>PNG resolusi tinggi</strong><small>Gambar 2× dengan kartu dan teks tetap tajam.</small></span></button>
      </aside>
      <section class="topology-frame-composer" data-frame-composer aria-labelledby="frame-composer-title" hidden>
        <header><div><span class="material-symbols-outlined" aria-hidden="true">add_box</span><div><h2 id="frame-composer-title">Frame baru</h2><p>Frame sudah terlihat di kanvas. Pilih jenis atau tiangnya.</p></div></div>
          <button type="button" data-action="close-frame-composer" aria-label="Batalkan frame baru"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></header>
        <label class="topology-frame-search"><span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input type="search" data-frame-search aria-label="Cari jenis frame atau tiang" placeholder="Cari Indoor, Non-tiang, atau tiang…" autocomplete="off" />
        </label>
        <div class="topology-frame-options" data-frame-options role="listbox" aria-label="Pilihan frame"></div>
      </section>
      <form class="topology-frame-name-editor" data-frame-name-form hidden>
        <label for="topology-frame-name">Nama frame</label>
        <div><input id="topology-frame-name" data-frame-name-input maxlength="48" autocomplete="off" />
          <button type="button" data-action="cancel-frame-name" aria-label="Batal"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
          <button type="submit" aria-label="Terapkan nama ke draft"><span class="material-symbols-outlined" aria-hidden="true">check</span></button>
        </div>
        <small>Nama tampilan saja; nama aset KMZ tetap. Tekan Enter, lalu Simpan draft.</small>
      </form>
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
