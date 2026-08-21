import { adaptActiveDatasetForTopology } from '../../adapters/active-dataset-map-adapter.js'
import {
  buildTopologyDiagramModel,
  getTopologyDiagramSearchResults,
  isConfirmedTopologyEdge,
} from '../../domain/topology-diagram-model.js'
import {
  parseTopologyViewState,
  serializeTopologyViewState,
} from '../../domain/topology-view-state.js'
import {
  loadActiveDataset,
  loadAllTopologyCandidates,
  loadTopologyProjection,
  loadTopologyRoots,
  reviewTopologyCandidate,
  traceTopology,
} from '../../services/active-dataset-service.js'
import { downloadSchematicPng, downloadSchematicSvg } from '../map/schematic-export.js'
import { bindUserAccountMenu, renderTopNavigation } from '../map/map-page.js'
import {
  calculateTopologyDiagramLayout,
  createTopologyDiagramLayoutCacheKey,
  createTopologyLayoutWorkerModel,
} from './topology-diagram-layout.js'
import {
  getTopologyLabelVisibility,
  renderTopologyDiagramSvg,
} from './topology-diagram-svg.js'

export async function renderTopologyPage(container) {
  document.title = 'Diagram Topologi — SINERGI'
  document.body.className = 'map-body topology-body'
  const requested = readContext()
  container.innerHTML = renderLoadingState(requested)
  bindUserAccountMenu()

  try {
    const activePayload = await loadActiveDataset({ ...requested, view: 'topology' })
    const mapData = adaptActiveDatasetForTopology(activePayload)
    const datasetVersionId = mapData.activeContext.datasetVersionId
    const [graphPayload, summaryPayload] = await Promise.all([
      loadTopologyProjection({ datasetVersionId, projection: 'graph' }),
      loadTopologyProjection({ datasetVersionId, projection: 'summary' }),
    ])
    const graph = graphPayload.graph ?? graphPayload
    const [rootsPayload, candidatePayload] = await Promise.all([
      loadTopologyRoots({
        datasetVersionId,
        graphRevision: graph.graphRevision ?? null,
      }).catch((error) => ({
        roots: [],
        error,
      })),
      loadTopologyProjection({
        datasetVersionId,
        projection: 'candidates',
        limit: 1,
      }).catch((error) => ({
        items: [],
        unresolved: [],
        restricted: [401, 403].includes(error.status),
        error,
      })),
    ])
    const adminAvailable = candidatePayload.restricted !== true
    const topologyReady = isTopologyPublicationReady(mapData)
    if (!topologyReady && !adminAvailable) {
      container.innerHTML = renderTopologyNotReadyState({
        activeContext: mapData.activeContext,
        readiness: mapData.topologyReadiness,
      })
      bindUserAccountMenu()
      return
    }
    await initializeTopologyWorkspace(container, {
      mapData,
      graph,
      summary: summaryPayload,
      roots: rootsPayload.roots ?? [],
      rootError: rootsPayload.error ?? null,
      candidates: candidatePayload.items ?? [],
      unresolved: candidatePayload.unresolved ?? [],
      reviewRestricted: candidatePayload.restricted === true,
      adminAvailable,
      topologyReady,
      candidateError: candidatePayload.error ?? null,
      candidateDataComplete: !candidatePayload.nextCursor && !candidatePayload.error,
    })
  } catch (error) {
    container.innerHTML = renderErrorState(error.message, requested)
    bindUserAccountMenu()
    container.querySelector('.retry-topology')?.addEventListener('click', () => {
      void renderTopologyPage(container)
    })
  }
}

async function initializeTopologyWorkspace(container, initial) {
  let graph = initial.graph ?? { nodes: [], edges: [] }
  let summary = initial.summary ?? {}
  let roots = initial.roots ?? []
  let candidates = initial.candidates ?? []
  let unresolved = initial.unresolved ?? []
  let adminDataLoaded = initial.candidateDataComplete === true
  let adminDataLoading = false
  const { mapData } = initial
  const {
    activeContext,
    assets,
    locationGroups,
    mountingRelations,
    poleGroups,
  } = mapData
  const adminAvailable = initial.adminAvailable ?? initial.reviewRestricted !== true
  const topologyReady = initial.topologyReady ?? isTopologyPublicationReady(mapData)
  const draftDiagram = !topologyReady
  const urlState = new URLSearchParams(window.location.search)
  const requestedCandidateId = urlState.get('reviewCandidateId')
  const requestedUnresolvedId = urlState.get('unresolvedEndpoint')
  const allAssetIds = assets.map(({ id }) => id)
  const allCandidateIds = [
    ...candidates.map(({ candidateId }) => candidateId),
    requestedCandidateId,
  ].filter(Boolean)
  const allEdgeIds = (graph.edges ?? []).map(({ id, edgeId, relationId }) => id ?? edgeId ?? relationId)
  const familyIds = uniqueFamilies(assets, graph)
  const areaKeys = locationGroups.map(({ key }) => key)
  const parsed = parseTopologyViewState(window.location.search, {
    assetIds: allAssetIds,
    candidateIds: allCandidateIds,
    edgeIds: allEdgeIds,
    areaKeys,
    networkFamilies: familyIds,
  })
  const state = {
    ...parsed,
    area: parsed.area
      ?? assets.find(({ id }) => id === parsed.selectedAssetId)?.locationGroupKey
      ?? null,
    selectedFamilies: parsed.selectedFamilies,
    selectedAssetId: parsed.selectedAssetId,
    selectedEdgeId: parsed.selectedEdgeId,
    selectedCandidateId: adminAvailable && parsed.reviewCandidateId
      ? parsed.reviewCandidateId
      : null,
    selectedUnresolvedId: adminAvailable
      ? requestedUnresolvedId
      : null,
    selectedMountingGroupId: null,
    showAdminLayers: adminAvailable,
    showMountingPhysical: parsed.showMountingPhysical !== false,
    traceStatus: parsed.traceFrom && parsed.traceTo ? 'pending' : 'idle',
    traceMessage: '',
    tracePath: [],
    traceEdgeIds: [],
    traceResult: null,
    zoom: 1,
    layoutStatus: 'loading',
    layoutError: null,
    actionStatus: 'idle',
    actionMessage: '',
  }
  let model = null
  let layout = null
  let searchTimer = null
  let layoutWorker = null
  let layoutRequestId = 0

  container.innerHTML = renderWorkspaceShell({
    activeContext,
    locationGroups,
    area: state.area,
    search: state.search,
    adminAvailable,
    showAdminLayers: state.showAdminLayers,
    showMountingPhysical: state.showMountingPhysical,
    selectedFamilies: state.selectedFamilies,
    labelMode: state.labelMode,
    draftDiagram,
    topologyReady,
  })
  bindUserAccountMenu()
  bindStaticControls()
  await rebuild({ initial: true })

  if (state.showAdminLayers && !adminDataLoaded) {
    await ensureAdminData()
  }

  if (state.traceStatus === 'pending' && topologyReady) {
    await runTrace({ historyMode: 'replace' })
  } else if (state.traceStatus === 'pending') {
    state.traceStatus = 'idle'
    state.traceMessage = 'Tracing menunggu dataset topology-ready dipublikasikan.'
    renderWorkspace()
  }

  function buildModel() {
    return buildTopologyDiagramModel({
      assets,
      graph,
      candidates,
      unresolved,
      locationGroups,
      area: state.area,
      branchId: activeContext.branchId,
      datasetId: activeContext.datasetId,
      datasetVersionId: activeContext.datasetVersionId,
      roots,
      mountingRelations,
      poleGroups,
      selectedFamilies: state.selectedFamilies,
      search: state.search,
      showAdminLayers: state.showAdminLayers,
      showMountingPhysical: state.showMountingPhysical,
      selectedMountingGroupId: state.selectedMountingGroupId,
      traceAssetIds: state.tracePath,
      traceEdgeIds: state.traceEdgeIds,
      readiness: mapData.topologyReadiness,
      publicationProfile: activeContext.publicationProfile,
      isDraft: draftDiagram,
    })
  }

  async function rebuild({ initial = false, fit = false } = {}) {
    model = buildModel()
    if (state.selectedAssetId && !model.nodeById.has(state.selectedAssetId)) {
      state.selectedAssetId = null
    }
    if (state.selectedEdgeId && !model.edgeById.has(state.selectedEdgeId)) {
      state.selectedEdgeId = null
    }
    if (state.selectedCandidateId && !model.allCandidates.some(({ candidateId }) => (
      candidateId === state.selectedCandidateId
    ))) {
      state.selectedCandidateId = null
    }
    if (state.selectedUnresolvedId && !model.allUnresolved.some(({ unresolvedId }) => (
      unresolvedId === state.selectedUnresolvedId
    ))) {
      state.selectedUnresolvedId = null
    }
    if (state.selectedMountingGroupId && !model.mountingGroups.some(({ id }) => (
      id === state.selectedMountingGroupId
    ))) {
      state.selectedMountingGroupId = null
    }
    if (state.tracePath.some((id) => !model.nodeById.has(id))) {
      state.tracePath = []
      state.traceEdgeIds = []
      state.traceStatus = state.traceStatus === 'active' ? 'stale' : state.traceStatus
    }
    state.layoutStatus = 'loading'
    state.layoutError = null
    layout = null
    renderWorkspace({ initial })
    const cacheKey = createTopologyDiagramLayoutCacheKey({
      model,
      selectedFamilies: state.selectedFamilies,
      hideFiltered: state.hideFiltered,
      overview: !state.area
        && !state.selectedAssetId
        && !state.selectedEdgeId
        && !state.selectedCandidateId
        && !state.selectedUnresolvedId
        && !state.tracePath.length,
    })
    const cached = layoutCache.get(cacheKey)
    if (cached) {
      layout = cloneLayout(cached)
      state.layoutStatus = 'ready'
      renderWorkspace()
      if (fit || (initial && !state.selectedAssetId && !state.selectedEdgeId)) {
        window.requestAnimationFrame(fitGraph)
      }
      return
    }
    try {
      const calculated = await calculateLayout(model)
      layout = cloneLayout(calculated)
      layoutCache.set(cacheKey, cloneLayout(calculated))
      state.layoutStatus = 'ready'
    } catch (error) {
      state.layoutError = error.message
      state.layoutStatus = 'error'
      layout = cloneLayout(calculateTopologyDiagramLayout(model, {
        overview: !state.area
          && !state.selectedAssetId
          && !state.selectedEdgeId
          && !state.selectedCandidateId
          && !state.selectedUnresolvedId
          && !state.tracePath.length,
      }))
      cacheLayout(cacheKey, cloneLayout(layout))
    }
    renderWorkspace()
    if (fit || (initial && !state.selectedAssetId && !state.selectedEdgeId)) {
      window.requestAnimationFrame(fitGraph)
    }
  }

  async function calculateLayout(nextModel) {
    const overview = !state.area
      && !state.selectedAssetId
      && !state.selectedEdgeId
      && !state.selectedCandidateId
      && !state.selectedUnresolvedId
      && !state.tracePath.length
    if (overview || typeof Worker === 'undefined' || nextModel.nodes.length < 160) {
      return calculateTopologyDiagramLayout(nextModel, { overview })
    }
    if (!layoutWorker) {
      layoutWorker = new Worker(new URL('./topology-layout.worker.js', import.meta.url), {
        type: 'module',
      })
    }
    const requestId = ++layoutRequestId
    const workerModel = createTopologyLayoutWorkerModel(nextModel)
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        layoutWorker?.removeEventListener('message', onMessage)
        layoutWorker?.removeEventListener('error', onError)
        reject(new Error('Layout worker melebihi batas waktu.'))
      }, 15000)
      const onError = (event) => {
        window.clearTimeout(timeout)
        layoutWorker?.removeEventListener('message', onMessage)
        layoutWorker?.removeEventListener('error', onError)
        reject(new Error(event.message || 'Layout worker gagal dijalankan.'))
      }
      const onMessage = (event) => {
        if (event.data?.requestId !== requestId) return
        window.clearTimeout(timeout)
        layoutWorker.removeEventListener('message', onMessage)
        layoutWorker.removeEventListener('error', onError)
        if (event.data.status === 'ready') resolve(event.data.layout)
        else reject(new Error(event.data.message || 'Layout worker gagal.'))
      }
      layoutWorker.addEventListener('message', onMessage)
      layoutWorker.addEventListener('error', onError)
      try {
        layoutWorker.postMessage({ requestId, model: workerModel })
      } catch (error) {
        onError(error)
      }
    })
  }

  async function ensureAdminData() {
    if (!adminAvailable || adminDataLoaded || adminDataLoading) return
    adminDataLoading = true
    state.actionStatus = 'loading'
    state.actionMessage = 'Memuat seluruh kandidat dan unresolved untuk layer administrator…'
    renderWorkspace()
    try {
      const payload = await loadAllTopologyCandidates({
        datasetVersionId: activeContext.datasetVersionId,
      })
      candidates = payload.items ?? []
      unresolved = payload.unresolved ?? []
      adminDataLoaded = true
      state.actionStatus = 'idle'
      state.actionMessage = ''
      state.selectedCandidateId = candidates.some(({ candidateId }) => (
        candidateId === requestedCandidateId
      )) ? requestedCandidateId : state.selectedCandidateId
      state.selectedUnresolvedId = unresolved.some(({ unresolvedId }) => (
        unresolvedId === requestedUnresolvedId
      )) ? requestedUnresolvedId : state.selectedUnresolvedId
      await rebuild()
    } catch (error) {
      state.actionStatus = 'error'
      state.actionMessage = `Layer administrator gagal dimuat: ${error.message}`
      renderWorkspace()
    } finally {
      adminDataLoading = false
    }
  }

  function renderWorkspace({ initial = false } = {}) {
    renderControls()
    renderCanvas()
    renderInspector()
    renderStatus()
    updateUrl()
    if (initial) return
    window.requestAnimationFrame(() => {
      const selected = state.selectedAssetId
        ? layout?.nodes.find(({ id }) => id === state.selectedAssetId)
        : null
      if (selected) centerOnNode(selected)
    })
  }

  function renderControls() {
    const areaSelect = container.querySelector('[data-topology-area]')
    if (areaSelect) {
      areaSelect.innerHTML = `<option value="">Seluruh area fasilitas</option>${locationGroups.map((group) => (
        `<option value="${escapeAttribute(group.key)}"${group.key === state.area ? ' selected' : ''}>${escapeHtml(group.name)}</option>`
      )).join('')}`
      areaSelect.value = state.area ?? ''
    }
    const familyContainer = container.querySelector('.topology-diagram-family-chips')
    if (familyContainer) {
      familyContainer.innerHTML = model.networkOptions.map((family) => {
        const active = !state.selectedFamilies.size || state.selectedFamilies.has(family.id)
        return `<button type="button" class="topology-family-chip${active ? ' active' : ''}"
          data-family="${escapeAttribute(family.id)}" aria-pressed="${active}">
          <i style="background:${escapeAttribute(family.color)}"></i>${escapeHtml(family.label)}
        </button>`
      }).join('') || '<p class="topology-control-empty">Belum ada keluarga jaringan.</p>'
    }
    const stats = container.querySelector('.topology-diagram-stats')
    if (stats) {
      const summary = model.summary
      stats.innerHTML = `
        ${statCard(summary.totalAssetCount, 'aset dalam scope')}
        ${statCard(summary.connectedAssetCount, 'aset terhubung', 'connected')}
        ${statCard(summary.confirmedEdgeCount, 'edge terkonfirmasi', 'confirmed')}
        ${state.area
          ? statCard(summary.isolatedAssetCount, 'aset tanpa relasi', 'isolated')
          : statCard(summary.areaCount, 'area tersedia')}
      `
    }
    const candidateToggle = container.querySelector('[data-toggle-admin-layer]')
    if (candidateToggle) candidateToggle.checked = state.showAdminLayers
    const mountingToggle = container.querySelector('[data-toggle-mounting-physical]')
    if (mountingToggle) mountingToggle.checked = state.showMountingPhysical
    const mountingToggleState = container.querySelector('.topology-mounting-toggle b')
    if (mountingToggleState) mountingToggleState.textContent = state.showMountingPhysical ? 'ON' : 'OFF'
    const candidateCounts = container.querySelector('.topology-admin-layer-count')
    if (candidateCounts) candidateCounts.textContent = adminDataLoaded
      ? `${model.allCandidates.length} kandidat · ${model.allUnresolved.length} unresolved`
      : `${model.allCandidates.length}+ kandidat · ${model.allUnresolved.length} unresolved`
    const searchResults = container.querySelector('.topology-diagram-search-results')
    if (searchResults && document.activeElement === container.querySelector('[data-topology-search]')) {
      renderSearchResults()
    } else if (searchResults) {
      searchResults.hidden = true
    }
  }

  function renderCanvas() {
    const canvas = container.querySelector('.topology-diagram-canvas')
    const empty = !model || model.status !== 'ready'
    if (empty) {
      canvas.innerHTML = `<div class="topology-diagram-empty" role="status">
        <span class="material-symbols-outlined">account_tree</span>
        <h2>${escapeHtml(model?.message ?? 'Diagram belum tersedia.')}</h2>
        <p>Scope tetap valid. Pilih area lain atau kembali ke Peta Aset untuk memeriksa dataset.</p>
      </div>`
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      return
    }
    if (!layout || layout.status !== 'ready') {
      canvas.innerHTML = `<div class="topology-diagram-empty loading" role="status">
        <span class="material-symbols-outlined spin">progress_activity</span><p>Menghitung layout diagram…</p>
      </div>`
      return
    }
    const svg = renderTopologyDiagramSvg({
      model,
      layout,
      context: activeContext,
      selectedAssetId: state.selectedAssetId,
      selectedEdgeId: state.selectedEdgeId,
      selectedCandidateId: state.selectedCandidateId,
      selectedUnresolvedId: state.selectedUnresolvedId,
      selectedMountingGroupId: state.selectedMountingGroupId,
      labelMode: state.labelMode,
      showAdminLayers: state.showAdminLayers,
      showMountingPhysical: state.showMountingPhysical,
      zoom: state.zoom,
    })
    canvas.innerHTML = `<div class="topology-diagram-frame" style="width:${layout.width}px;height:${layout.height}px">${svg}</div>`
    applyCanvasScale()
    bindCanvasTargets()
    const a11yList = container.querySelector('.topology-diagram-a11y-list')
    if (a11yList) {
      a11yList.innerHTML = layout.nodes.map((node) => (
        `<button data-a11y-node="${escapeAttribute(node.id)}">${escapeHtml(node.name || node.id)} · ${escapeHtml(node.type || 'Aset')}</button>`
      )).join('')
    }
  }

  function applyCanvasScale() {
    if (!layout) return
    const canvas = container.querySelector('.topology-diagram-canvas')
    const frame = canvas?.querySelector('.topology-diagram-frame')
    if (!canvas || !frame) return
    canvas.style.width = `${layout.width * state.zoom}px`
    canvas.style.height = `${layout.height * state.zoom}px`
    frame.style.transform = `translateX(-50%) scale(${state.zoom})`
    const label = container.querySelector('[data-topology-zoom-label]')
    if (label) label.textContent = `${Math.round(state.zoom * 100)}%`
  }

  function bindCanvasTargets() {
    const canvas = container.querySelector('.topology-diagram-canvas')
    canvas.querySelectorAll('[data-area-overview]').forEach((target) => bindActivation(target, () => {
      const nextArea = target.dataset.areaOverview
      if (!areaKeys.includes(nextArea)) return
      state.area = nextArea
      clearSelectionAndTrace()
      resetViewport()
      void rebuild({ fit: true })
    }))
    canvas.querySelectorAll('[data-node-id]').forEach((target) => bindActivation(target, () => {
      state.selectedAssetId = target.dataset.nodeId
      state.selectedEdgeId = null
      state.selectedCandidateId = null
      state.selectedUnresolvedId = null
      state.selectedMountingGroupId = null
      renderWorkspace()
    }))
    canvas.querySelectorAll('[data-edge-id]').forEach((target) => bindActivation(target, () => {
      state.selectedEdgeId = target.dataset.edgeId
      state.selectedAssetId = null
      state.selectedCandidateId = null
      state.selectedUnresolvedId = null
      state.selectedMountingGroupId = null
      renderWorkspace()
    }))
    canvas.querySelectorAll('[data-candidate-id]').forEach((target) => bindActivation(target, () => {
      state.selectedCandidateId = target.dataset.candidateId
      state.selectedAssetId = null
      state.selectedEdgeId = null
      state.selectedUnresolvedId = null
      state.selectedMountingGroupId = null
      renderWorkspace()
    }))
    canvas.querySelectorAll('[data-unresolved-id]').forEach((target) => bindActivation(target, () => {
      state.selectedUnresolvedId = target.dataset.unresolvedId
      state.selectedAssetId = null
      state.selectedEdgeId = null
      state.selectedCandidateId = null
      state.selectedMountingGroupId = null
      renderWorkspace()
    }))
    canvas.querySelectorAll('[data-mounting-group-id]').forEach((target) => bindActivation(target, () => {
      state.selectedMountingGroupId = target.dataset.mountingGroupId
      state.selectedAssetId = null
      state.selectedEdgeId = null
      state.selectedCandidateId = null
      state.selectedUnresolvedId = null
      renderWorkspace()
    }))
  }

  function renderInspector() {
    const inspector = container.querySelector('.topology-diagram-inspector')
    if (!inspector) return
    const candidate = state.showAdminLayers
      ? model.allCandidates.find(({ candidateId }) => candidateId === state.selectedCandidateId)
      : null
    const unresolvedItem = state.showAdminLayers
      ? model.allUnresolved.find(({ unresolvedId }) => unresolvedId === state.selectedUnresolvedId)
      : null
    const mountingGroup = model.mountingGroups.find(({ id }) => id === state.selectedMountingGroupId)
    const edge = model.edgeById.get(state.selectedEdgeId)
    const node = model.nodeById.get(state.selectedAssetId)
    let content = ''
    if (candidate) content = renderCandidateInspector(candidate)
    else if (unresolvedItem) content = renderUnresolvedInspector(unresolvedItem)
    else if (mountingGroup) content = renderMountingInspector(mountingGroup)
    else if (edge) content = renderEdgeInspector(edge)
    else if (node) content = renderNodeInspector(node)
    if (!content) {
      inspector.classList.remove('open')
      inspector.innerHTML = ''
      return
    }
    inspector.classList.add('open')
    inspector.innerHTML = content
    inspector.querySelector('[data-close-inspector]')?.addEventListener('click', () => {
      state.selectedAssetId = null
      state.selectedEdgeId = null
      state.selectedCandidateId = null
      state.selectedUnresolvedId = null
      state.selectedMountingGroupId = null
      renderWorkspace()
    })
    inspector.querySelector('[data-open-map]')?.addEventListener('click', (event) => {
      window.location.href = mapHref({ ...activeContext, area: state.area }, event.currentTarget.dataset.openMap)
    })
    inspector.querySelector('[data-trace-start]')?.addEventListener('click', () => {
      if (!node) return
      state.traceFrom = node.id
      state.traceTo = null
      state.traceStatus = 'idle'
      state.traceMessage = ''
      state.tracePath = []
      state.traceEdgeIds = []
      state.traceResult = null
      renderWorkspace()
    })
    inspector.querySelector('[data-trace-target]')?.addEventListener('click', () => {
      if (!node || !state.traceFrom || node.id === state.traceFrom) return
      state.traceTo = node.id
      state.traceStatus = 'pending'
      state.traceMessage = ''
      state.tracePath = []
      state.traceEdgeIds = []
      state.traceResult = null
      renderWorkspace()
      void runTrace({ historyMode: 'push' })
    })
    inspector.querySelector('[data-trace-clear]')?.addEventListener('click', () => {
      clearTrace()
      renderWorkspace()
    })
    inspector.querySelectorAll('[data-inspector-edge]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedEdgeId = button.dataset.inspectorEdge
        state.selectedAssetId = null
        state.selectedMountingGroupId = null
        renderWorkspace()
      })
    })
    inspector.querySelectorAll('[data-mounted-asset]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedAssetId = button.dataset.mountedAsset
        state.selectedEdgeId = null
        state.selectedCandidateId = null
        state.selectedUnresolvedId = null
        state.selectedMountingGroupId = null
        renderWorkspace()
      })
    })
    inspector.querySelector('[data-candidate-action="confirm"]')?.addEventListener('click', () => {
      openDecisionDialog(candidate, 'confirm')
    })
    inspector.querySelector('[data-candidate-action="reject"]')?.addEventListener('click', () => {
      openDecisionDialog(candidate, 'reject')
    })
  }

  function renderNodeInspector(node) {
    const directEdges = node.directEdgeIds.map((edgeId) => model.edgeById.get(edgeId)).filter(Boolean)
    const traceSection = topologyReady && state.traceStatus === 'active'
      ? renderTraceSummary()
      : ''
    const traceTargetAction = topologyReady && state.traceFrom && state.traceFrom !== node.id
      ? `<button class="button primary" type="button" data-trace-target>
          <span class="material-symbols-outlined" aria-hidden="true">route</span>Jadikan tujuan tracing
        </button>`
      : ''
    const traceClearAction = topologyReady && state.traceFrom
      ? `<button class="button ghost" type="button" data-trace-clear>Batalkan tracing</button>`
      : ''
    return `
      <button class="icon-button topology-inspector-close" type="button" data-close-inspector aria-label="Tutup detail">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <header class="topology-inspector-header">
        <span class="topology-inspector-kicker">${escapeHtml(node.networkFamilyLabel)}</span>
        <h2>${escapeHtml(node.name || node.id)}</h2>
        <p>${escapeHtml(node.type || 'Aset')} · ${escapeHtml(node.areaName || 'Area tidak tersedia')}</p>
      </header>
      <dl class="topology-inspector-facts">
        <div><dt>Asset ID</dt><dd>${escapeHtml(node.id)}</dd></div>
        <div><dt>Peran</dt><dd>${escapeHtml(node.topologyRole || 'unknown')}</dd></div>
        <div><dt>Depth</dt><dd>${node.depth === null ? '—' : node.depth}</dd></div>
        <div><dt>Status konektivitas</dt><dd>${escapeHtml(connectivityLabel(node.connectivityStatus))}</dd></div>
        <div><dt>Confirmed degree</dt><dd>${node.confirmedDegree}</dd></div>
        <div><dt>Suggested degree</dt><dd>${node.suggestedDegree}</dd></div>
        <div><dt>Status aset</dt><dd>${escapeHtml(node.status || 'Tidak tersedia')}</dd></div>
      </dl>
      <section class="topology-inspector-section">
        <h3>Relasi langsung · ${directEdges.length}</h3>
        ${directEdges.length ? `<ul class="topology-relation-list">${directEdges.map((edge) => {
          const otherId = edge.sourceId === node.id ? edge.targetId : edge.sourceId
          const other = model.nodeById.get(otherId)
          return `<li><button type="button" data-inspector-edge="${escapeAttribute(edge.id)}">
            <span>${escapeHtml(other?.name || otherId)}</span><small>${escapeHtml(edge.networkFamilyLabel)} · ${escapeHtml(edge.provenance)}</small>
          </button></li>`
        }).join('')}</ul>` : '<p class="topology-inspector-muted">Aset belum memiliki relasi terkonfirmasi.</p>'}
      </section>
      ${traceSection}
      ${!topologyReady ? `<div class="topology-admin-warning"><span class="material-symbols-outlined">lock</span>
        <p>Tracing operasional tersedia setelah dataset topology-ready dipublikasikan.</p></div>` : ''}
      <footer class="topology-inspector-actions">
        <button class="button primary" type="button" data-open-map="${escapeAttribute(node.id)}">
          <span class="material-symbols-outlined" aria-hidden="true">location_on</span>Buka di Peta Aset
        </button>
        ${traceTargetAction}
        ${topologyReady ? `<button class="button secondary" type="button" data-trace-start>
          <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>${state.traceFrom === node.id ? 'Ubah titik awal' : 'Jadikan titik awal'}
        </button>` : ''}
        ${traceClearAction}
      </footer>
    `
  }

  function renderMountingInspector(group) {
    const childAssets = group.childIds.map((id) => model.nodeById.get(id)).filter(Boolean)
    return `
      <button class="icon-button topology-inspector-close" type="button" data-close-inspector aria-label="Tutup detail">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <header class="topology-inspector-header">
        <span class="topology-inspector-kicker">Mounting fisik · bukan edge jaringan</span>
        <h2>${escapeHtml(group.hostName || group.hostId)}</h2>
        <p>${escapeHtml(group.hostType || 'Tiang')} · ${childAssets.length} aset terpasang</p>
      </header>
      <dl class="topology-inspector-facts">
        <div><dt>Host ID</dt><dd>${escapeHtml(group.hostId)}</dd></div>
        <div><dt>Klasifikasi</dt><dd>physical-mount</dd></div>
        <div><dt>Relation</dt><dd>${group.relationIds.length} mounting relation</dd></div>
        <div><dt>Network edge</dt><dd>Tidak ada · dikeluarkan dari graph</dd></div>
      </dl>
      <section class="topology-inspector-section">
        <h3>Aset terpasang · ${childAssets.length}</h3>
        ${childAssets.length ? `<ul class="topology-relation-list">${childAssets.map((asset) => (
          `<li><button type="button" data-mounted-asset="${escapeAttribute(asset.id)}">
            <span>${escapeHtml(asset.name || asset.id)}</span><small>${escapeHtml(asset.type || asset.diagramClass || 'Aset')}</small>
          </button></li>`
        )).join('')}</ul>` : '<p class="topology-inspector-muted">Tidak ada aset jaringan dalam scope area ini.</p>'}
      </section>
    `
  }

  function renderEdgeInspector(edge) {
    const source = model.nodeById.get(edge.sourceId)
    const target = model.nodeById.get(edge.targetId)
    return `
      <button class="icon-button topology-inspector-close" type="button" data-close-inspector aria-label="Tutup detail">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <header class="topology-inspector-header">
        <span class="topology-inspector-kicker">Edge terkonfirmasi · ${escapeHtml(edge.networkFamilyLabel)}</span>
        <h2>${escapeHtml(edge.relationId || edge.id)}</h2>
        <p>${escapeHtml(source?.name || edge.sourceId)} → ${escapeHtml(target?.name || edge.targetId)}</p>
      </header>
      <dl class="topology-inspector-facts">
        <div><dt>Relation ID</dt><dd>${escapeHtml(edge.relationId || edge.id)}</dd></div>
        <div><dt>Status</dt><dd>Confirmed · garis solid</dd></div>
        <div><dt>Arah</dt><dd>${edge.direction === 'undirected' ? 'Undirected' : escapeHtml(edge.direction)}</dd></div>
        <div><dt>Media/family</dt><dd>${escapeHtml(edge.mediaType || edge.networkFamilyLabel)}</dd></div>
        <div><dt>Relation type</dt><dd>${escapeHtml(edge.relationType || 'connected-to')}</dd></div>
        <div><dt>Panjang</dt><dd>${edge.lengthMeters === null ? '—' : `${formatNumber(edge.lengthMeters)} m`}</dd></div>
        <div><dt>Source geometry</dt><dd>${escapeHtml(edge.sourceGeometryIds?.join(', ') || edge.sourceGeometryId || 'Tidak tersedia')}</dd></div>
        <div><dt>Path asset</dt><dd>${escapeHtml(edge.pathAssetIds?.join(', ') || 'Tidak tersedia')}</dd></div>
        <div><dt>Provenance</dt><dd>${escapeHtml(edge.provenance)}</dd></div>
      </dl>
      <section class="topology-inspector-section">
        <h3>Evidence</h3>
        ${edge.evidence.length ? `<ul class="topology-evidence-list">${edge.evidence.slice(0, 5).map((item) => (
          `<li><strong>${escapeHtml(item.source ?? item.ruleId ?? 'Evidence')}</strong><small>${escapeHtml(item.explanation ?? '')}</small></li>`
        )).join('')}</ul>` : '<p class="topology-inspector-muted">Provenance tersedia pada metadata edge.</p>'}
      </section>
    `
  }

  function renderCandidateInspector(candidate) {
    return `
      <button class="icon-button topology-inspector-close" type="button" data-close-inspector aria-label="Tutup detail">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <header class="topology-inspector-header admin">
        <span class="topology-inspector-kicker">${escapeHtml(candidate.candidateStatus)} · layer administrator</span>
        <h2>Kandidat koneksi</h2>
        <p>${escapeHtml(candidate.sourceId)} → ${escapeHtml(candidate.targetId)}</p>
      </header>
      <dl class="topology-inspector-facts">
        <div><dt>Candidate ID</dt><dd>${escapeHtml(candidate.candidateId)}</dd></div>
        <div><dt>Network family</dt><dd>${escapeHtml(candidate.networkFamilyLabel)}</dd></div>
        <div><dt>Candidate type</dt><dd>${escapeHtml(candidate.candidateType || candidate.relationType || 'suggested-connection')}</dd></div>
        <div><dt>Media</dt><dd>${escapeHtml(candidate.mediaType || candidate.networkFamilyLabel)}</dd></div>
        <div><dt>Score / confidence</dt><dd>${candidate.score === undefined && candidate.confidence === null ? '—' : formatPercent(candidate.score ?? candidate.confidence)}</dd></div>
        <div><dt>Jarak</dt><dd>${candidate.distanceMeters === undefined ? '—' : `${formatNumber(candidate.distanceMeters)} m`}</dd></div>
        <div><dt>Status</dt><dd>Bukan relasi operasional</dd></div>
      </dl>
      <section class="topology-inspector-section"><h3>Evidence</h3>
        ${candidate.evidence?.length ? `<ul class="topology-evidence-list">${candidate.evidence.slice(0, 6).map((item) => (
          `<li><strong>${escapeHtml(item.source ?? item.ruleId ?? 'Rule')}</strong><small>${escapeHtml(item.explanation ?? '')}</small></li>`
        )).join('')}</ul>` : '<p class="topology-inspector-muted">Evidence belum tersedia.</p>'}
      </section>
      <div class="topology-admin-warning"><span class="material-symbols-outlined">warning</span>
        <p>Kandidat tidak ikut graph terkonfirmasi atau tracing sebelum keputusan administrator.</p></div>
      <footer class="topology-inspector-actions">
        <button class="button primary" type="button" data-candidate-action="confirm">Konfirmasi relasi</button>
        <button class="button danger-outline" type="button" data-candidate-action="reject">Tolak kandidat</button>
      </footer>
    `
  }

  function renderUnresolvedInspector(item) {
    return `
      <button class="icon-button topology-inspector-close" type="button" data-close-inspector aria-label="Tutup detail">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <header class="topology-inspector-header admin">
        <span class="topology-inspector-kicker">Unresolved · layer administrator</span>
        <h2>Jalur belum terpetakan</h2>
        <p>Endpoint ini tidak dipaksakan menjadi node atau edge palsu.</p>
      </header>
      <dl class="topology-inspector-facts">
        <div><dt>Endpoint</dt><dd>${escapeHtml(item.unresolvedId)}</dd></div>
        <div><dt>Jalur sumber</dt><dd>${escapeHtml(item.sourcePathAssetId || '—')}</dd></div>
        <div><dt>Peran endpoint</dt><dd>${escapeHtml(item.endpointRole || '—')}</dd></div>
        <div><dt>Alasan</dt><dd>${escapeHtml(item.reason)}</dd></div>
      </dl>
      <div class="topology-admin-warning"><span class="material-symbols-outlined">rule</span>
        <p>Perbaiki endpoint sumber atau target aset lalu regenerasi topology. Marker ini tidak dapat ditelusuri.</p></div>
    `
  }

  function renderTraceSummary() {
    const result = state.traceResult ?? {}
    return `<section class="topology-trace-summary"><h3>Tracing terkonfirmasi</h3>
      <p>${state.tracePath.length} hop/node · ${result.totalLengthMeters == null ? 'panjang tidak tersedia' : `${formatNumber(result.totalLengthMeters)} m`}</p>
      <ol>${state.tracePath.map((id) => `<li>${escapeHtml(model.nodeById.get(id)?.name || id)}</li>`).join('')}</ol>
      <small>Graph revision ${escapeHtml(result.graphRevision ?? model.graphRevision ?? '—')} · candidate/unresolved tidak ikut.</small>
    </section>`
  }

  function clearTrace() {
    state.traceFrom = null
    state.traceTo = null
    state.traceStatus = 'idle'
    state.traceMessage = ''
    state.tracePath = []
    state.traceEdgeIds = []
    state.traceResult = null
  }

  function renderStatus() {
    const status = container.querySelector('.topology-diagram-status')
    if (!status) return
    const messages = []
    if (draftDiagram) {
      messages.push('Draft Diagram Topologi · Diagram belum siap dipublikasikan untuk pengguna operasional.')
    }
    if (state.layoutError) messages.push(`Layout worker gagal; fallback dipakai: ${state.layoutError}`)
    if (model.diagnostics.invalid) messages.push(model.diagnostics.message || 'Graph topology perlu diperiksa.')
    if (model.components.some(({ rootVerified }) => !rootVerified)) {
      messages.push('Root terverifikasi tidak tersedia; anchor layout ditandai dan bukan root operasional.')
    }
    if (!model.summary.confirmedEdgeCount && model.nodes.length) {
      messages.push('Graph belum memiliki confirmed edge. Semua aset tetap ditampilkan pada Aset tanpa relasi.')
    }
    if (state.traceStatus === 'loading' || state.traceStatus === 'pending') messages.push('Menghitung tracing dari confirmed graph…')
    if (state.traceFrom && !state.traceTo && state.traceStatus === 'idle') {
      messages.push('Titik awal tracing dipilih. Pilih aset tujuan dari graph atau inspector.')
    }
    if (state.traceStatus === 'active') messages.push(`Tracing aktif · ${state.tracePath.length} node di-highlight.`)
    if (state.traceStatus === 'stale') messages.push('Trace stale karena graph revision berubah. Jalankan tracing ulang.')
    if (state.traceStatus === 'error') messages.push(state.traceMessage)
    if (state.traceMessage && !['error', 'stale'].includes(state.traceStatus)) messages.push(state.traceMessage)
    if (state.actionStatus === 'loading') messages.push(state.actionMessage)
    if (state.actionStatus === 'error') messages.push(state.actionMessage)
    status.className = `topology-diagram-status${messages.length ? ' visible' : ''}${
      state.traceStatus === 'error' || state.traceStatus === 'stale' || state.actionStatus === 'error'
        ? ' error'
        : draftDiagram ? ' warning' : ''
    }`
    status.innerHTML = messages.map((message) => `<span>${escapeHtml(message)}</span>`).join('')
      + (state.traceFrom && !state.traceTo && state.traceStatus === 'idle'
        ? '<button type="button" class="topology-status-action" data-trace-cancel>Batalkan tracing</button>'
        : '')
      + (state.traceStatus === 'stale'
        ? '<button type="button" class="topology-status-action" data-refresh-topology>Muat ulang graph</button>'
        : '')
  }

  function bindStaticControls() {
    const search = container.querySelector('[data-topology-search]')
    search?.addEventListener('input', (event) => {
      state.search = event.target.value
      window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(() => {
        void rebuild()
      }, 120)
    })
    search?.addEventListener('focus', () => renderSearchResults())
    search?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const results = container.querySelector('.topology-diagram-search-results')
        if (results) results.hidden = true
      }
    })
    container.querySelector('.topology-diagram-search-results')?.addEventListener('click', (event) => {
      const item = event.target.closest('[data-search-kind]')
      if (!item) return
      if (item.dataset.searchKind === 'asset') selectAsset(item.dataset.searchId)
      else selectEdge(item.dataset.searchId)
      event.currentTarget.hidden = true
    })
    container.querySelector('[data-topology-area]')?.addEventListener('change', (event) => {
      const nextArea = event.target.value || null
      if (nextArea && !areaKeys.includes(nextArea)) return
      state.area = nextArea
      clearSelectionAndTrace()
      resetViewport()
      void rebuild({ fit: true })
    })
    container.querySelector('.topology-diagram-family-chips')?.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-family]')
      if (!chip) return
      const family = chip.dataset.family
      if (!state.selectedFamilies.size) state.selectedFamilies = new Set(familyIds)
      if (state.selectedFamilies.has(family)) state.selectedFamilies.delete(family)
      else state.selectedFamilies.add(family)
      if (state.selectedFamilies.size === familyIds.length) state.selectedFamilies.clear()
      void rebuild()
    })
    container.querySelector('[data-reset-families]')?.addEventListener('click', () => {
      state.selectedFamilies.clear()
      void rebuild()
    })
    container.querySelector('[data-toggle-admin-layer]')?.addEventListener('change', (event) => {
      if (!adminAvailable) return
      state.showAdminLayers = event.target.checked
      state.adminLayers = state.showAdminLayers
      if (!state.showAdminLayers) {
        state.selectedCandidateId = null
        state.selectedUnresolvedId = null
      }
      if (state.showAdminLayers && !adminDataLoaded) {
        void ensureAdminData()
        return
      }
      void rebuild()
    })
    container.querySelector('[data-toggle-mounting-physical]')?.addEventListener('change', (event) => {
      state.showMountingPhysical = event.target.checked
      if (!state.showMountingPhysical) state.selectedMountingGroupId = null
      renderCanvas()
      renderInspector()
      updateUrl()
    })
    container.querySelector('[data-topology-label-mode]')?.addEventListener('change', (event) => {
      state.labelMode = event.target.value
      renderCanvas()
      updateUrl()
    })
    container.querySelector('[data-zoom-in]')?.addEventListener('click', () => setZoom(state.zoom + .12))
    container.querySelector('[data-zoom-out]')?.addEventListener('click', () => setZoom(state.zoom - .12))
    container.querySelector('[data-zoom-reset]')?.addEventListener('click', () => setZoom(1))
    container.querySelector('[data-fit-graph]')?.addEventListener('click', fitGraph)
    container.querySelector('[data-export-svg]')?.addEventListener('click', () => void exportSvg())
    container.querySelector('[data-export-png]')?.addEventListener('click', () => void exportPng())
    container.addEventListener('click', (event) => {
      if (event.target.closest('[data-trace-cancel]')) {
        clearTrace()
        renderWorkspace()
      }
      if (event.target.closest('[data-refresh-topology]')) void renderTopologyPage(container)
    })
    container.querySelector('.topology-diagram-a11y-list')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-a11y-node]')
      if (button) selectAsset(button.dataset.a11yNode)
    })
  }

  function setZoom(value, afterRender) {
    const previousVisibility = getTopologyLabelVisibility({
      labelMode: state.labelMode,
      zoom: state.zoom,
    })
    state.zoom = clamp(value, .25, 3.2)
    const nextVisibility = getTopologyLabelVisibility({
      labelMode: state.labelMode,
      zoom: state.zoom,
    })
    if (previousVisibility !== nextVisibility) renderCanvas()
    else applyCanvasScale()
    afterRender?.()
  }

  function fitGraph() {
    if (!layout) return
    const viewport = container.querySelector('.topology-diagram-viewport')
    const availableWidth = Math.max(320, (viewport?.clientWidth || 1000) - 72)
    const nextZoom = clamp(availableWidth / Math.max(layout.width, 1), .35, 1)
    setZoom(nextZoom, () => {
      if (!viewport) return
      viewport.scrollLeft = Math.max(0, (layout.width * nextZoom - viewport.clientWidth) / 2)
      viewport.scrollTop = 0
    })
  }

  async function exportSvg() {
    const svg = container.querySelector('.topology-diagram-canvas .topology-diagram-svg')
    if (!svg) return
    try {
      downloadSchematicSvg(svg, exportFilename('svg'))
      showToast('SVG Diagram Topologi berhasil diekspor.')
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function exportPng() {
    const svg = container.querySelector('.topology-diagram-canvas .topology-diagram-svg')
    if (!svg) return
    try {
      await downloadSchematicPng(svg, exportFilename('png'), 2)
      showToast('PNG Diagram Topologi berhasil diekspor.')
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  function selectAsset(assetId) {
    const node = model.nodeById.get(assetId)
    if (!node) return
    const areaChanged = !state.area && node.areaKey
    if (areaChanged) {
      state.area = node.areaKey
      resetViewport()
    }
    state.selectedAssetId = assetId
    state.selectedEdgeId = null
    state.selectedCandidateId = null
    state.selectedUnresolvedId = null
    if (areaChanged) void rebuild()
    else renderWorkspace()
  }

  function selectEdge(edgeId) {
    const edge = model.edgeById.get(edgeId)
    if (!edge) return
    const nextArea = model.nodeById.get(edge.sourceId)?.areaKey ?? null
    const areaChanged = !state.area && nextArea
    if (areaChanged) {
      state.area = nextArea
      resetViewport()
    }
    state.selectedEdgeId = edgeId
    state.selectedAssetId = null
    state.selectedCandidateId = null
    state.selectedUnresolvedId = null
    if (areaChanged) void rebuild()
    else renderWorkspace()
  }

  function centerOnNode(node) {
    const viewport = container.querySelector('.topology-diagram-viewport')
    if (!viewport || !node?.diagram) return
    viewport.scrollLeft = Math.max(0, node.diagram.centerX * state.zoom - viewport.clientWidth / 2)
    viewport.scrollTop = Math.max(0, node.diagram.centerY * state.zoom - viewport.clientHeight / 2)
  }

  function resetViewport() {
    const viewport = container.querySelector('.topology-diagram-viewport')
    if (!viewport) return
    viewport.scrollLeft = 0
    viewport.scrollTop = 0
  }

  async function runTrace({ historyMode = 'push' } = {}) {
    if (!state.traceFrom || !state.traceTo) return
    if (!topologyReady) {
      state.traceStatus = 'error'
      state.traceMessage = 'Tracing hanya tersedia pada dataset topology-ready.'
      state.tracePath = []
      state.traceEdgeIds = []
      await rebuild()
      return
    }
    if (!model.nodeById.has(state.traceFrom) || !model.nodeById.has(state.traceTo)) {
      state.traceStatus = 'error'
      state.traceMessage = 'Trace diabaikan karena endpoint berada di luar scope cabang/area aktif.'
      state.tracePath = []
      state.traceEdgeIds = []
      renderWorkspace()
      return
    }
    if (!model.graphRevision) {
      state.traceStatus = 'error'
      state.traceMessage = 'Graph revision tidak tersedia; tracing aman tidak dapat dijalankan.'
      renderWorkspace()
      return
    }
    state.traceStatus = 'loading'
    state.traceMessage = ''
    renderWorkspace()
    try {
      const result = await traceTopology({
        datasetVersionId: activeContext.datasetVersionId,
        sourceAssetId: state.traceFrom,
        targetAssetId: state.traceTo,
        graphRevision: model.graphRevision,
        direction: 'both',
        scopeAssetIds: model.nodes.map(({ id }) => id),
      })
      if (result.graphRevision && result.graphRevision !== model.graphRevision) {
        state.traceStatus = 'stale'
        state.traceMessage = 'Graph revision berubah saat tracing. Muat ulang data lalu jalankan ulang.'
        state.tracePath = []
        state.traceEdgeIds = []
      } else if (result.status === 'found' && Array.isArray(result.nodeIds)
        && result.nodeIds.length > 1) {
        state.traceStatus = 'active'
        state.traceResult = result
        state.tracePath = result.nodeIds.filter((id) => model.nodeById.has(id))
        state.traceEdgeIds = resolveTraceEdges(result.edges ?? [], state.tracePath)
        state.traceMessage = ''
        await rebuild()
        focusTrace()
        updateUrl(historyMode)
        return
      } else {
        state.traceStatus = 'error'
        state.traceMessage = result.message || 'Jalur terkonfirmasi tidak ditemukan.'
        state.tracePath = []
        state.traceEdgeIds = []
      }
    } catch (error) {
      state.traceStatus = error?.code === 'topology_graph_stale' ? 'stale' : 'error'
      state.traceMessage = error?.code === 'topology_graph_stale'
        ? 'Graph revision berubah. Muat ulang data sebelum menjalankan tracing ulang.'
        : error.message
      state.tracePath = []
      state.traceEdgeIds = []
    }
    await rebuild()
    updateUrl(historyMode)
  }

  function resolveTraceEdges(traceEdges, traceNodeIds = []) {
    const resolved = traceEdges.flatMap((traceEdge) => {
      if (!isConfirmedTopologyEdge(traceEdge)) return []
      const directId = traceEdge.id ?? traceEdge.edgeId ?? traceEdge.relationId
      if (directId && model.edgeById.has(directId)) return [directId]
      const source = traceEdge.sourceAssetId ?? traceEdge.sourceNodeId ?? traceEdge.sourceId
      const target = traceEdge.targetAssetId ?? traceEdge.targetNodeId ?? traceEdge.targetId
      return model.edges.filter((edge) => (
        [edge.sourceId, edge.targetId].sort().join('|') === [source, target].sort().join('|')
      )).map(({ id }) => id)
    })
    if (resolved.length || traceNodeIds.length < 2) return [...new Set(resolved)]
    return [...new Set(traceNodeIds.slice(1).flatMap((targetId, index) => {
      const sourceId = traceNodeIds[index]
      return model.edges.filter((edge) => (
        [edge.sourceId, edge.targetId].sort().join('|') === [sourceId, targetId].sort().join('|')
      )).map(({ id }) => id)
    }))]
  }

  function focusTrace() {
    const traceNodes = state.tracePath.map((id) => layout.nodes.find((node) => node.id === id)).filter(Boolean)
    if (!traceNodes.length) return
    const viewport = container.querySelector('.topology-diagram-viewport')
    const minX = Math.min(...traceNodes.map((node) => node.diagram.x))
    const maxX = Math.max(...traceNodes.map((node) => node.diagram.x + node.diagram.width))
    const minY = Math.min(...traceNodes.map((node) => node.diagram.y))
    const maxY = Math.max(...traceNodes.map((node) => node.diagram.y + node.diagram.height))
    viewport.scrollLeft = Math.max(0, ((minX + maxX) / 2) * state.zoom - viewport.clientWidth / 2)
    viewport.scrollTop = Math.max(0, ((minY + maxY) / 2) * state.zoom - viewport.clientHeight / 2)
  }

  function clearSelectionAndTrace() {
    state.selectedAssetId = null
    state.selectedEdgeId = null
    state.selectedCandidateId = null
    state.selectedUnresolvedId = null
    state.selectedMountingGroupId = null
    clearTrace()
  }

  function updateUrl(mode = 'replace') {
    const params = new URLSearchParams(serializeTopologyViewState(window.location.search, {
      ...state,
      reviewCandidateId: state.selectedCandidateId,
      selectedEdgeId: state.selectedEdgeId,
      area: state.area,
      adminLayers: state.showAdminLayers,
      selectedFamilies: state.selectedFamilies,
    }))
    params.set('datasetId', activeContext.datasetId)
    params.set('branchId', activeContext.branchId)
    if (state.area) params.set('area', state.area)
    else params.delete('area')
    if (state.selectedUnresolvedId && state.showAdminLayers) {
      params.set('unresolvedEndpoint', state.selectedUnresolvedId)
    } else {
      params.delete('unresolvedEndpoint')
    }
    const nextUrl = `${window.location.pathname}?${params}${window.location.hash}`
    window.history[`${mode}State`](null, '', nextUrl)
    const mapLink = container.querySelector('.top-navigation nav a[href^="/map"]')
    if (mapLink) {
      mapLink.href = mapHref(
        { ...activeContext, area: state.area },
        state.selectedAssetId,
        { traceFrom: state.traceFrom, traceTo: state.traceTo },
      )
    }
    const topologyLink = container.querySelector('.top-navigation nav a[href^="/topology"]')
    if (topologyLink) topologyLink.href = nextUrl
  }

  function renderSearchResults() {
    const resultContainer = container.querySelector('.topology-diagram-search-results')
    if (!resultContainer) return
    const results = getTopologyDiagramSearchResults(model, state.search)
    resultContainer.innerHTML = results.length ? results.map((result) => `
      <button type="button" data-search-kind="${result.kind}" data-search-id="${escapeAttribute(result.id)}">
        <strong>${escapeHtml(result.label)}</strong><small>${escapeHtml(result.detail)}</small>
      </button>
    `).join('') : '<p>Tidak ada aset atau jalur yang cocok.</p>'
    resultContainer.hidden = !state.search.trim()
  }

  function openDecisionDialog(candidate, action) {
    const dialog = container.querySelector('.topology-decision-dialog')
    if (!dialog || !candidate) return
    dialog.innerHTML = `
      <form method="dialog" class="topology-decision-form">
        <button class="icon-button topology-decision-close" value="cancel" type="submit" aria-label="Tutup">
          <span class="material-symbols-outlined">close</span>
        </button>
        <span class="topology-inspector-kicker">${action === 'confirm' ? 'KONFIRMASI' : 'TOLAK'} KANDIDAT</span>
        <h2>${action === 'confirm' ? 'Jadikan relasi ini terkonfirmasi?' : 'Tolak kandidat koneksi?'}</h2>
        <p>${escapeHtml(candidate.sourceId)} → ${escapeHtml(candidate.targetId)}</p>
        <label><span>Alasan keputusan</span><textarea name="reason" required minlength="4" rows="3">Diverifikasi dari Diagram Topologi.</textarea></label>
        <p class="topology-decision-error" role="alert"></p>
        <footer><button class="button secondary" type="submit" value="cancel">Batal</button>
          <button class="button ${action === 'confirm' ? 'primary' : 'danger'}" type="button" data-submit-decision>Simpan keputusan</button></footer>
      </form>
    `
    if (!dialog.open) dialog.showModal()
    dialog.querySelector('[data-submit-decision]').addEventListener('click', async () => {
      const reason = dialog.querySelector('textarea').value.trim()
      if (reason.length < 4) return
      await commitCandidateDecision(candidate, action, reason, dialog)
    })
  }

  async function commitCandidateDecision(candidate, action, reason, dialog) {
    const submit = dialog.querySelector('[data-submit-decision]')
    submit.disabled = true
    try {
      await reviewTopologyCandidate({
        candidateId: candidate.candidateId,
        action,
        body: { reason },
      })
      dialog.close()
      showToast('Keputusan tersimpan. Graph dan layout sedang disegarkan.')
      const [nextGraph, nextSummary, nextCandidates] = await Promise.all([
        loadTopologyProjection({ datasetVersionId: activeContext.datasetVersionId, projection: 'graph' }),
        loadTopologyProjection({ datasetVersionId: activeContext.datasetVersionId, projection: 'summary' }),
        loadAllTopologyCandidates({ datasetVersionId: activeContext.datasetVersionId }),
      ])
      graph = nextGraph.graph ?? nextGraph
      summary = nextSummary
      candidates = nextCandidates.items ?? []
      unresolved = nextCandidates.unresolved ?? []
      roots = (await loadTopologyRoots({ datasetVersionId: activeContext.datasetVersionId }).catch(() => ({ roots: [] }))).roots ?? roots
      state.selectedCandidateId = null
      state.traceStatus = state.traceStatus === 'active' ? 'stale' : state.traceStatus
      state.traceMessage = state.traceStatus === 'stale'
        ? 'Graph revision berubah setelah keputusan admin. Jalankan tracing ulang.'
        : ''
      await rebuild()
    } catch (error) {
      const errorElement = dialog.querySelector('.topology-decision-error')
      if (errorElement) errorElement.textContent = error.message
      submit.disabled = false
    }
  }

  function showToast(message, type = 'success') {
    const toast = container.querySelector('.topology-diagram-toast')
    if (!toast) return
    toast.className = `topology-diagram-toast visible ${type}`
    toast.textContent = message
    window.setTimeout(() => toast.classList.remove('visible'), 4200)
  }

  function exportFilename(extension) {
    const branch = slug(activeContext.branchId)
    const area = slug(state.area || 'seluruh-area')
    const version = slug(activeContext.version || activeContext.datasetVersionId)
    return `sinergi-diagram-topologi-${branch}-${area}-${version}.${extension}`
  }
}

const layoutCache = new Map()

function cloneLayout(layout) {
  return layout ? structuredClone(layout) : layout
}

function cacheLayout(key, layout) {
  layoutCache.set(key, layout)
  while (layoutCache.size > 24) layoutCache.delete(layoutCache.keys().next().value)
}

function renderWorkspaceShell({
  activeContext,
  locationGroups,
  area,
  search,
  adminAvailable,
  showAdminLayers,
  showMountingPhysical = true,
  selectedFamilies,
  labelMode,
  draftDiagram = false,
  topologyReady = true,
}) {
  return `
    <div class="map-app topology-diagram-app${draftDiagram ? ' is-draft' : ''}" data-topology-ready="${topologyReady}">
      ${renderTopNavigation('topology', { ...activeContext, area })}
      <main class="topology-diagram-workspace">
        <aside class="topology-diagram-sidebar" aria-label="Kontrol Diagram Topologi">
          <div class="topology-diagram-sidebar-scroll">
            <section class="topology-diagram-context">
              <span class="topology-diagram-eyebrow">CABANG / DATASET AKTIF</span>
              <h1>${escapeHtml(activeContext.branchName || activeContext.branchId)}</h1>
              <p>${escapeHtml(activeContext.version || activeContext.datasetVersionId)}</p>
              <small>${escapeHtml(activeContext.datasetVersionId)}</small>
              ${draftDiagram ? `<div class="topology-draft-banner" role="alert">
                <span class="material-symbols-outlined" aria-hidden="true">warning</span>
                <span><strong>Draft Diagram Topologi</strong><small>Publication profile ${escapeHtml(activeContext.publicationProfile || 'map_only')}. Hanya administrator yang dapat meninjau saran.</small></span>
              </div>` : ''}
            </section>
            <section class="topology-diagram-control">
              <label for="topology-area">Area diagram</label>
              <select id="topology-area" data-topology-area>
                <option value="">${area ? 'Seluruh area fasilitas' : 'Seluruh area fasilitas'}</option>
                ${locationGroups.map((group) => `<option value="${escapeAttribute(group.key)}"${group.key === area ? ' selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}
              </select>
              <small>Pilih satu area untuk membuka susunan perangkat dan jalurnya.</small>
            </section>
            <section class="topology-diagram-control topology-search-control">
              <label for="topology-search">Cari perangkat atau jalur</label>
              <div class="topology-diagram-search-input">
                <span class="material-symbols-outlined" aria-hidden="true">search</span>
                <input id="topology-search" data-topology-search type="search" value="${escapeAttribute(search)}"
                  placeholder="Asset ID, nama, tipe, lokasi" autocomplete="off">
              </div>
              <div class="topology-diagram-search-results" hidden role="listbox"></div>
            </section>
            <section class="topology-diagram-control">
              <div class="topology-control-heading"><h2>Keluarga jaringan</h2>
                <button type="button" class="topology-text-button" data-reset-families>Tampilkan semua</button></div>
              <div class="topology-diagram-family-chips"></div>
              <small>Konteks lain tetap terlihat redup supaya hubungan tidak terputus.</small>
            </section>
            <section class="topology-diagram-control">
              <h2>Lapisan presentasi</h2>
              ${adminAvailable ? `<label class="topology-diagram-toggle">
                <input type="checkbox" data-toggle-admin-layer${showAdminLayers ? ' checked' : ''}>
                <span><strong>Layer administrator</strong><small>Saran dan unresolved · default aktif untuk administrator</small></span>
                <b class="topology-admin-layer-count">—</b>
              </label>` : `<p class="topology-admin-locked"><span class="material-symbols-outlined">lock</span>Layer kandidat/unresolved hanya tersedia untuk administrator.</p>`}
              <label class="topology-diagram-toggle topology-mounting-toggle">
                <input type="checkbox" data-toggle-mounting-physical${showMountingPhysical ? ' checked' : ''}>
                <span><strong>Area tiang</strong><small>Bubble berwarna = perangkat terpasang pada tiang yang sama</small></span>
                <b aria-hidden="true">${showMountingPhysical ? 'ON' : 'OFF'}</b>
              </label>
              <label for="topology-label-mode">Label aset</label>
              <select id="topology-label-mode" data-topology-label-mode>
                ${option('auto', 'Auto: Rack/JB jauh · CCTV dekat', labelMode)}
                ${option('all', 'Semua label', labelMode)}
                ${option('off', 'Sembunyikan label', labelMode)}
              </select>
            </section>
            <section class="topology-diagram-stats" aria-label="Ringkasan diagram"></section>
          </div>
          <div class="topology-diagram-sidebar-note">
            <span class="material-symbols-outlined" aria-hidden="true">route</span>
            <p><strong>Baca dari atas ke bawah</strong><small>Garis solid adalah relasi terkonfirmasi. Posisi perangkat dikunci dan bukan koordinat geografis.</small></p>
          </div>
        </aside>
        <section class="topology-diagram-stage" aria-label="Workspace Diagram Topologi">
          <header class="topology-diagram-toolbar">
            <div class="topology-diagram-toolbar-title">
              <span class="topology-diagram-eyebrow">LOGICAL TOPOLOGY</span>
              <strong>Core → distribusi → akses → endpoint</strong>
              <small>${draftDiagram
                ? 'DRAFT · Graph belum siap dipublikasikan; gunakan untuk review administrator.'
                : 'Layout statis dari graph terkonfirmasi · posisi perangkat dikunci'}</small>
            </div>
            <div class="topology-diagram-toolbar-actions">
              <span class="topology-layout-lock" title="Posisi perangkat ditentukan otomatis agar jalur konsisten">
                <span class="material-symbols-outlined" aria-hidden="true">lock</span>Layout terkunci
              </span>
              <div class="topology-diagram-zoom" aria-label="Kontrol zoom">
                <button type="button" class="icon-button" data-zoom-out aria-label="Perkecil"><span class="material-symbols-outlined">remove</span></button>
                <button type="button" class="topology-zoom-label" data-zoom-reset data-topology-zoom-label aria-label="Reset zoom">100%</button>
                <button type="button" class="icon-button" data-zoom-in aria-label="Perbesar"><span class="material-symbols-outlined">add</span></button>
                <button type="button" class="button secondary" data-fit-graph><span class="material-symbols-outlined">fit_screen</span>Fit lebar</button>
              </div>
              <div class="topology-diagram-export-actions">
                <button type="button" class="button secondary" data-export-svg><span class="material-symbols-outlined">download</span>SVG</button>
                <button type="button" class="button secondary" data-export-png>PNG</button>
              </div>
            </div>
          </header>
          <div class="topology-diagram-viewport" tabindex="0" aria-label="Diagram Topologi statis. Gunakan pencarian, klik perangkat, atau kontrol zoom untuk membaca relasi.">
            <div class="topology-diagram-canvas" aria-live="polite"></div>
          </div>
          <aside class="topology-diagram-inspector" aria-live="polite"></aside>
          <div class="topology-diagram-status" role="status" aria-live="polite"></div>
          <div class="topology-diagram-toast" role="status" aria-live="polite"></div>
          <div class="topology-diagram-a11y-list map-sr-only" aria-label="Daftar aset Diagram Topologi"></div>
        </section>
      </main>
      <dialog class="topology-decision-dialog"></dialog>
    </div>
  `
}

function renderLoadingState(context) {
  return `<div class="map-app topology-diagram-app">${renderTopNavigation('topology', context)}
    <main class="topology-diagram-page-state" aria-busy="true">
      <span class="material-symbols-outlined spin">progress_activity</span>
      <h1>Memuat Diagram Topologi</h1>
      <p>Menyelaraskan cabang, dataset aktif, graph terkonfirmasi, dan metadata provenance.</p>
    </main></div>`
}

function renderTopologyNotReadyState({ activeContext, readiness } = {}) {
  const reason = readiness?.message
    || 'Data koneksi masih dalam review dan belum memenuhi syarat topology-ready.'
  return `<div class="map-app topology-diagram-app">
    ${renderTopNavigation('topology', activeContext)}
    <main class="topology-diagram-page-state topology-not-ready-state" role="status">
      <span class="material-symbols-outlined">lock</span>
      <span class="topology-diagram-eyebrow">READINESS GATE</span>
      <h1>Diagram belum siap dipublikasikan</h1>
      <p>${escapeHtml(reason)}</p>
      <p class="topology-page-state-note">Pengguna operasional hanya dapat membuka Diagram Topologi setelah publication profile dan graph terkonfirmasi siap.</p>
      <a class="button secondary" href="${escapeAttribute(mapHref(activeContext, null, {}))}">
        <span class="material-symbols-outlined" aria-hidden="true">map</span>Buka Peta Aset
      </a>
    </main>
  </div>`
}

function renderErrorState(message, context) {
  return `<div class="map-app topology-diagram-app">${renderTopNavigation('topology', context)}
    <main class="topology-diagram-page-state error">
      <span class="material-symbols-outlined">error</span>
      <h1>Diagram Topologi tidak dapat dimuat</h1>
      <p>${escapeHtml(message)}</p>
      <button class="button primary retry-topology" type="button">Coba lagi</button>
    </main></div>`
}

function readContext() {
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

function mapHref(context, selectedAssetId, extra = {}) {
  const params = new URLSearchParams({
    datasetId: context.datasetId,
    branchId: context.branchId,
  })
  if (context.area) params.set('area', context.area)
  if (selectedAssetId) params.set('selectedAssetId', selectedAssetId)
  if (extra.traceFrom) params.set('traceFrom', extra.traceFrom)
  if (extra.traceTo) params.set('traceTo', extra.traceTo)
  return `/map?${params}`
}

function statCard(value, label, tone = '') {
  return `<div class="topology-stat-card ${tone}"><strong>${value}</strong><span>${label}</span></div>`
}

function uniqueFamilies(assets, graph) {
  const source = [
    ...assets.map((asset) => asset.networkFamily ?? asset.category ?? asset.type),
    ...(graph?.nodes ?? []).map((node) => node.networkFamily ?? node.category ?? node.assetType),
    ...(graph?.edges ?? []).map((edge) => edge.networkFamily ?? edge.networkType),
  ]
  return [...new Set(source.map((value) => normalizeFamily(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'id'))
}

function normalizeFamily(value) {
  const source = String(value ?? '').toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
  if (source.includes('fiber') || source.includes('fibre') || source === 'fo') return 'fiber-optic'
  if (source.includes('utp') || source.includes('ethernet')) return 'utp'
  if (source.includes('power') || source.includes('listrik')) return 'power'
  if (source.includes('cctv') || source.includes('camera')) return 'cctv'
  if (source.includes('lan')) return 'lan'
  if (source.includes('peripheral') || source.includes('printer')) return 'peripheral'
  if (source.includes('infra') || source.includes('switch') || source.includes('server')
    || source.includes('router') || source.includes('core') || source.includes('otb')) return 'infrastructure'
  return source || 'unmapped'
}

function option(value, label, selected) {
  return `<option value="${escapeAttribute(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('id-ID', { maximumFractionDigits: 1 }) : '—'
}

function formatPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${Math.round((number <= 1 ? number : number / 100) * 100)}%`
}

function connectivityLabel(value) {
  return {
    confirmed: 'Terkonfirmasi',
    'suggested-only': 'Hanya memiliki saran',
    disconnected: 'Belum terhubung',
  }[value] ?? 'Belum diketahui'
}

function isTopologyPublicationReady(mapData) {
  const context = mapData?.activeContext ?? {}
  const readiness = mapData?.topologyReadiness ?? {}
  return context.publicationProfile === 'operational_topology'
    && context.capabilities?.topologyDiagram !== false
    && (context.topologyReady === true || readiness.ready === true)
}

function bindActivation(element, callback) {
  element.addEventListener('click', (event) => {
    event.stopPropagation()
    callback(event)
  })
  element.addEventListener('keydown', (event) => {
    if (!['Enter', ' ', 'Spacebar'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    callback(event)
  })
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function slug(value) {
  return String(value ?? 'value').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function escapeAttribute(value) {
  return escapeHtml(value)
}
