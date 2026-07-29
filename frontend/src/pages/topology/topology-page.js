import { adaptActiveDatasetForMap } from '../../adapters/active-dataset-map-adapter.js'
import {
  parseTopologyViewState,
  serializeTopologyViewState,
} from '../../domain/topology-view-state.js'
import {
  loadActiveDataset,
  loadDatasetProjection,
  loadTopologyProjection,
  reviewTopologyCandidate,
} from '../../services/active-dataset-service.js'
import { renderTopNavigation } from '../map/map-page.js'
import { renderSpatialTopologySvg } from './topology-renderer.js'
import { createSpatialTopologyLayout } from './topology-spatial-layout.js'

const ALL_CATEGORIES = Object.freeze([
  'cctv',
  'fiber-optic',
  'lan',
  'infrastructure',
  'peripheral',
  'unmapped',
])

export async function renderTopologyPage(container) {
  document.title = 'Peta Topologi — SINERGI'
  document.body.className = 'map-body topology-body'
  container.innerHTML = renderLoadingState()

  const requested = readContext()
  try {
    const activePayload = await loadActiveDataset(requested)
    const mapData = adaptActiveDatasetForMap(activePayload)
    const datasetVersionId = mapData.activeContext.datasetVersionId
    const [
      graphPayload,
      summaryPayload,
      candidatePayload,
      featurePayload,
      geometryPayload,
    ] = await Promise.all([
      loadTopologyProjection({ datasetVersionId, projection: 'graph' }),
      loadTopologyProjection({ datasetVersionId, projection: 'summary' }),
      loadTopologyProjection({ datasetVersionId, projection: 'candidates' })
        .catch(() => ({ items: [], unresolved: [], restricted: true })),
      loadDatasetProjection({ datasetVersionId, projection: 'source-features' })
        .catch(() => ({ items: [] })),
      loadDatasetProjection({ datasetVersionId, projection: 'geometries' })
        .catch(() => ({ items: [] })),
    ])
    initializeTopologyWorkspace(container, {
      mapData,
      graph: graphPayload.graph,
      summary: summaryPayload,
      candidates: candidatePayload.items ?? [],
      unresolved: candidatePayload.unresolved ?? [],
      sourceFeatures: featurePayload.items ?? [],
      sourceGeometries: geometryPayload.items ?? [],
      reviewRestricted: candidatePayload.restricted === true,
    })
  } catch (error) {
    container.innerHTML = renderErrorState(error.message)
    container.querySelector('.retry-topology')?.addEventListener('click', () => {
      renderTopologyPage(container)
    })
  }
}

function initializeTopologyWorkspace(container, initial) {
  const {
    mapData,
    sourceFeatures,
    sourceGeometries,
    reviewRestricted = false,
  } = initial
  let graph = initial.graph
  let summary = initial.summary
  let candidates = initial.candidates
  let unresolved = initial.unresolved
  const { activeContext, assets, geometries } = mapData
  const selectableIds = unique([
    ...assets.map(({ id }) => id),
    ...(graph.nodes ?? []).map(({ id }) => id),
  ])
  const parsed = parseTopologyViewState(window.location.search, {
    assetIds: selectableIds,
    candidateIds: candidates.map(({ candidateId }) => candidateId),
  })
  const query = new URLSearchParams(window.location.search)
  const state = {
    ...parsed,
    selectedCandidateId: parsed.reviewCandidateId,
    selectedUnresolvedId: query.get('unresolvedEndpoint'),
    selectedCategories: parsed.selectedCategories.size
      ? parsed.selectedCategories
      : new Set(),
    showCandidates: query.get('candidates') !== 'off',
    showUnresolved: query.get('unresolved') !== 'off',
    zoom: 1,
    actionStatus: 'idle',
    actionMessage: '',
  }
  let layout = buildLayout()
  let searchTimer = null

  container.innerHTML = `
    <div class="map-app topology-app">
      ${renderTopNavigation('topology')}
      <section class="view-switcher" aria-label="Projection data">
        <a href="${mapHref(activeContext)}">
          <span class="material-symbols-outlined" aria-hidden="true">map</span>Peta Aset
        </a>
        <a class="active" href="${topologyHref(activeContext)}" aria-current="page">
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>Peta Topologi
        </a>
      </section>
      <main class="topology-workspace">
        <aside class="topology-controls" aria-label="Kontrol peta topologi">
          <div class="topology-controls-scroll">
            ${renderContext(activeContext, summary)}
            <div class="topology-search">
              <label for="topology-search-input">Cari aset atau jalur</label>
              <div>
                <span class="material-symbols-outlined" aria-hidden="true">search</span>
                <input id="topology-search-input" type="search" value="${escapeHtml(state.search)}"
                  placeholder="Nama, Asset ID, endpoint" autocomplete="off">
              </div>
            </div>
            <section class="control-section category-control">
              <div class="control-section-heading">
                <h2>Jaringan</h2>
                <button class="text-button reset-category-filter" type="button">Tampilkan semua</button>
              </div>
              <div class="category-chips"></div>
            </section>
            <section class="control-section topology-layer-control">
              <h2>Lapisan status</h2>
              <label class="presentation-toggle">
                <input class="toggle-candidates" type="checkbox"${
                  state.showCandidates ? ' checked' : ''
                }>
                <span><strong>Kandidat koneksi</strong><small>Perlu keputusan admin</small></span>
                <b class="candidate-layer-count"></b>
              </label>
              <label class="presentation-toggle">
                <input class="toggle-unresolved" type="checkbox"${
                  state.showUnresolved ? ' checked' : ''
                }>
                <span><strong>Endpoint unresolved</strong><small>Belum punya target aman</small></span>
                <b class="unresolved-layer-count"></b>
              </label>
              <label for="label-mode">Label aset</label>
              <select id="label-mode">
                ${option('auto', 'Otomatis mengikuti zoom', state.labelMode)}
                ${option('all', 'Tampilkan semua', state.labelMode)}
                ${option('off', 'Sembunyikan', state.labelMode)}
              </select>
            </section>
            <section class="topology-stats" aria-label="Ringkasan topologi"></section>
          </div>
          ${reviewRestricted ? `
            <div class="topology-review-access">
              <span class="material-symbols-outlined" aria-hidden="true">lock</span>
              <p><strong>Review khusus admin</strong>
                <small>Masuk sebagai admin untuk mengambil keputusan endpoint.</small></p>
            </div>
          ` : `
            <a class="review-link" href="${reviewHref(activeContext)}">
              <span class="material-symbols-outlined" aria-hidden="true">fact_check</span>
              <span>Review endpoint<strong>Periksa evidence lengkap</strong></span>
              <b class="review-link-count"></b>
            </a>
          `}
        </aside>
        <section class="topology-stage" aria-label="Peta topologi cabang">
          <header class="topology-toolbar">
            <div class="topology-toolbar-title">
              <span class="eyebrow">SPATIAL TOPOLOGY</span>
              <strong>Posisi dan geometri asli</strong>
              <small>Proyeksi yang sama dengan peta aset · data sumber tidak digeser</small>
            </div>
            <div class="topology-toolbar-actions">
              <div class="zoom-control" aria-label="Kontrol zoom">
                <button class="icon-button topology-zoom-out" type="button" aria-label="Perkecil">
                  <span class="material-symbols-outlined" aria-hidden="true">remove</span>
                </button>
                <button class="topology-zoom-value" type="button" aria-label="Reset zoom">100%</button>
                <button class="icon-button topology-zoom-in" type="button" aria-label="Perbesar">
                  <span class="material-symbols-outlined" aria-hidden="true">add</span>
                </button>
                <button class="button secondary topology-fit" type="button">
                  <span class="material-symbols-outlined" aria-hidden="true">fit_screen</span>Fit
                </button>
              </div>
              <div class="export-control">
                <button class="button secondary export-topology-svg" type="button">
                  <span class="material-symbols-outlined" aria-hidden="true">download</span>SVG
                </button>
                <button class="button secondary export-topology-png" type="button">PNG</button>
              </div>
            </div>
          </header>
          <div class="topology-viewport" tabindex="0"
            aria-label="Kanvas topologi. Geser untuk pan dan gunakan roda mouse untuk zoom.">
            <div class="topology-canvas" aria-live="polite"></div>
          </div>
          <div class="topology-canvas-legend" aria-label="Legenda status">
            <span><i class="legend-line source"></i>Geometri sumber</span>
            <span><i class="legend-line confirmed"></i>Jalur terkonfirmasi</span>
            <span><i class="legend-line candidate"></i>Perlu konfirmasi</span>
            <span><i class="legend-endpoint"></i>Unresolved</span>
          </div>
          <aside class="topology-minimap" aria-label="Ringkasan posisi topologi"></aside>
          <aside class="topology-inspector" aria-live="polite"></aside>
          <div class="topology-toast" role="status" aria-live="polite"></div>
          <div class="topology-a11y-list map-sr-only" aria-label="Daftar aset topologi"></div>
        </section>
      </main>
      <dialog class="topology-decision-dialog"></dialog>
    </div>
  `

  bindStaticControls()
  renderWorkspace()
  requestAnimationFrame(fitGraph)

  function buildLayout() {
    return createSpatialTopologyLayout({
      assets,
      geometries,
      sourceFeatures,
      sourceGeometries,
      graph,
      candidates,
      unresolved,
      state,
    })
  }

  function renderWorkspace({ preserveInspector = false } = {}) {
    layout = buildLayout()
    renderControls()
    renderCanvas()
    if (!preserveInspector) renderInspector()
    renderStatus()
    updateUrl()
  }

  function renderControls() {
    const chips = container.querySelector('.category-chips')
    chips.innerHTML = layout.categories.map((category) => {
      const active = !state.selectedCategories.size || state.selectedCategories.has(category)
      return `<button type="button" class="category-chip${active ? ' active' : ''}"
        data-category="${category}" aria-pressed="${active}">
        <i class="category-dot ${category}"></i>${categoryLabel(category)}
      </button>`
    }).join('')
    const openCandidates = candidates.filter(({ candidateStatus }) => (
      ['candidate', 'ambiguous'].includes(candidateStatus)
    ))
    container.querySelector('.candidate-layer-count').textContent = openCandidates.length
    container.querySelector('.unresolved-layer-count').textContent = unresolved.length
    const reviewCount = container.querySelector('.review-link-count')
    if (reviewCount) reviewCount.textContent = openCandidates.length
    container.querySelector('.topology-stats').innerHTML = `
      <div><strong>${layout.pathCount}</strong><span>jalur sumber</span></div>
      <div><strong>${layout.graphNodeCount}</strong><span>node</span></div>
      <div class="confirmed-stat"><strong>${layout.graphEdgeCount}</strong><span>confirmed edge</span></div>
      <div class="review-stat"><strong>${openCandidates.length}</strong><span>perlu review</span></div>
    `
  }

  function renderCanvas() {
    const canvas = container.querySelector('.topology-canvas')
    canvas.innerHTML = `<div class="topology-canvas-frame" style="
      width:${layout.width}px;height:${layout.height}px">
      ${renderSpatialTopologySvg(layout, {
        labelMode: state.labelMode,
        zoom: state.zoom,
        showCandidates: state.showCandidates,
        showUnresolved: state.showUnresolved,
      })}
    </div>`
    applyCanvasScale()
    bindCanvasTargets()
    renderMinimap()
    container.querySelector('.topology-a11y-list').innerHTML = layout.nodes.map((node) => (
      `<button data-a11y-node="${escapeHtml(node.id)}">${escapeHtml(node.name)}</button>`
    )).join('')
  }

  function applyCanvasScale() {
    const canvas = container.querySelector('.topology-canvas')
    const frame = canvas.querySelector('.topology-canvas-frame')
    canvas.style.width = `${layout.width * state.zoom}px`
    canvas.style.height = `${layout.height * state.zoom}px`
    if (frame) frame.style.transform = `scale(${state.zoom})`
    container.querySelector('.topology-zoom-value').textContent = `${
      Math.round(state.zoom * 100)
    }%`
  }

  function renderMinimap() {
    container.querySelector('.topology-minimap').innerHTML = renderSpatialTopologySvg(layout, {
      labelMode: 'off',
      showCandidates: false,
      showUnresolved: false,
      minimap: true,
    })
  }

  function bindCanvasTargets() {
    container.querySelectorAll('[data-node-id]').forEach((node) => {
      bindActivation(node, () => {
        state.selectedAssetId = node.dataset.nodeId
        state.selectedCandidateId = null
        state.selectedUnresolvedId = null
        renderWorkspace()
      })
    })
    container.querySelectorAll('[data-candidate-id]').forEach((candidate) => {
      bindActivation(candidate, () => {
        state.selectedCandidateId = candidate.dataset.candidateId
        state.selectedAssetId = null
        state.selectedUnresolvedId = null
        renderWorkspace()
      })
    })
    container.querySelectorAll('[data-unresolved-id]').forEach((endpoint) => {
      bindActivation(endpoint, () => {
        state.selectedUnresolvedId = endpoint.dataset.unresolvedId
        state.selectedAssetId = null
        state.selectedCandidateId = null
        renderWorkspace()
      })
    })
  }

  function renderInspector() {
    const inspector = container.querySelector('.topology-inspector')
    const candidate = candidates.find(({ candidateId }) => (
      candidateId === state.selectedCandidateId
    ))
    if (candidate) {
      inspector.classList.add('open')
      inspector.innerHTML = renderCandidateInspector(candidate, {
        activeContext,
        featureById: new Map(sourceFeatures.map((feature) => [
          feature.sourceFeatureId,
          feature,
        ])),
        restricted: reviewRestricted,
        actionStatus: state.actionStatus,
        actionMessage: state.actionMessage,
      })
      bindInspectorBase()
      inspector.querySelector('.confirm-topology-candidate')?.addEventListener('click', () => {
        openDecisionDialog(candidate, 'confirm')
      })
      inspector.querySelector('.reject-topology-candidate')?.addEventListener('click', () => {
        openDecisionDialog(candidate, 'reject')
      })
      return
    }
    const endpoint = unresolved.find(({ sourceEndpointId }) => (
      sourceEndpointId === state.selectedUnresolvedId
    ))
    if (endpoint) {
      inspector.classList.add('open')
      inspector.innerHTML = renderUnresolvedInspector(endpoint, activeContext)
      bindInspectorBase()
      return
    }
    const node = layout.nodes.find(({ id }) => id === state.selectedAssetId)
    if (node) {
      inspector.classList.add('open')
      inspector.innerHTML = renderNodeInspector(node)
      bindInspectorBase()
      inspector.querySelector('.open-topology-node-on-map')?.addEventListener('click', () => {
        window.location.href = mapHref(activeContext, node.mapAssetId)
      })
      return
    }
    inspector.classList.remove('open')
    inspector.innerHTML = ''
  }

  function bindInspectorBase() {
    container.querySelector('.close-topology-inspector')?.addEventListener('click', () => {
      state.selectedAssetId = null
      state.selectedCandidateId = null
      state.selectedUnresolvedId = null
      state.actionStatus = 'idle'
      state.actionMessage = ''
      renderWorkspace()
    })
  }

  function openDecisionDialog(candidate, action) {
    const dialog = container.querySelector('.topology-decision-dialog')
    const isReject = action === 'reject'
    const sourceName = featureName(sourceFeatures, candidate.sourceFeatureId)
      ?? candidate.sourcePathAssetId
    const targetName = featureName(sourceFeatures, candidate.targetFeatureId)
      ?? candidate.targetAssetId
      ?? candidate.targetPathAssetId
    dialog.innerHTML = `
      <form method="dialog" class="topology-decision-form">
        <button class="icon-button close-decision-dialog" value="cancel" aria-label="Tutup">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
        <span class="decision-icon ${isReject ? 'reject' : 'confirm'} material-symbols-outlined"
          aria-hidden="true">${isReject ? 'link_off' : 'verified'}</span>
        <span class="eyebrow">${isReject ? 'TOLAK KANDIDAT' : 'KONFIRMASI RELASI'}</span>
        <h2>${isReject
          ? 'Keluarkan kandidat dari antrean operasional?'
          : 'Jadikan relasi ini terkonfirmasi?'}</h2>
        <p class="decision-route"><strong>${escapeHtml(sourceName)}</strong>
          <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
          <strong>${escapeHtml(targetName)}</strong></p>
        <div class="decision-facts">
          <span><small>Score</small><strong>${formatPercent(candidate.score)}</strong></span>
          <span><small>Jarak endpoint</small><strong>${formatDistance(
            candidate.distanceMeters,
          )}</strong></span>
          <span><small>Status</small><strong>${escapeHtml(candidate.candidateStatus)}</strong></span>
        </div>
        <div class="decision-safety-note">
          <span class="material-symbols-outlined" aria-hidden="true">straighten</span>
          <p><strong>Koordinat sumber tetap.</strong> Keputusan ini hanya mengubah confirmed graph.
            Posisi titik, panjang jalur, dan vertex KML tidak akan dipindahkan.</p>
        </div>
        <label>
          <span>Catatan keputusan${isReject ? ' (wajib)' : ' (opsional)'}</span>
          <textarea class="decision-reason" rows="3"
            placeholder="${isReject
              ? 'Jelaskan alasan penolakan…'
              : 'Tambahkan konteks bila diperlukan…'}"></textarea>
          <small class="decision-error" role="alert"></small>
        </label>
        <footer>
          <button class="button secondary" value="cancel">Batal</button>
          <button class="button ${isReject ? 'danger' : 'primary'} submit-topology-decision"
            type="button">${isReject ? 'Tolak kandidat' : 'Ya, konfirmasi relasi'}</button>
        </footer>
      </form>
    `
    dialog.showModal()
    dialog.querySelector('.submit-topology-decision').addEventListener('click', async () => {
      const reason = dialog.querySelector('.decision-reason').value.trim()
      if (isReject && reason.length < 3) {
        dialog.querySelector('.decision-error').textContent = 'Alasan minimal tiga karakter.'
        return
      }
      const submit = dialog.querySelector('.submit-topology-decision')
      submit.disabled = true
      submit.textContent = 'Menyimpan…'
      await performDecision(candidate, action, reason, dialog)
    })
  }

  async function performDecision(candidate, action, reason, dialog) {
    state.actionStatus = 'loading'
    state.actionMessage = 'Menyimpan keputusan dan memperbarui confirmed graph…'
    renderInspector()
    try {
      await reviewTopologyCandidate({
        candidateId: candidate.candidateId,
        action,
        body: { reason },
      })
      const [nextGraph, nextSummary, nextCandidates] = await Promise.all([
        loadTopologyProjection({
          datasetVersionId: activeContext.datasetVersionId,
          projection: 'graph',
        }),
        loadTopologyProjection({
          datasetVersionId: activeContext.datasetVersionId,
          projection: 'summary',
        }),
        loadTopologyProjection({
          datasetVersionId: activeContext.datasetVersionId,
          projection: 'candidates',
        }),
      ])
      graph = nextGraph.graph
      summary = nextSummary
      candidates = nextCandidates.items ?? []
      unresolved = nextCandidates.unresolved ?? []
      state.actionStatus = 'success'
      state.actionMessage = action === 'confirm'
        ? 'Relasi dikonfirmasi. Confirmed graph sudah diperbarui.'
        : 'Kandidat ditolak dan tidak masuk confirmed graph.'
      dialog.close()
      renderWorkspace()
      showToast(state.actionMessage, 'success')
    } catch (error) {
      state.actionStatus = 'error'
      state.actionMessage = error.message
      const submit = dialog.querySelector('.submit-topology-decision')
      if (submit) {
        submit.disabled = false
        submit.textContent = action === 'confirm' ? 'Ya, konfirmasi relasi' : 'Tolak kandidat'
      }
      const errorElement = dialog.querySelector('.decision-error')
      if (errorElement) errorElement.textContent = error.message
      renderInspector()
    }
  }

  function showToast(message, status) {
    const toast = container.querySelector('.topology-toast')
    toast.className = `topology-toast show ${status}`
    toast.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${
      status === 'success' ? 'check_circle' : 'error'
    }</span>${escapeHtml(message)}`
    window.setTimeout(() => toast.classList.remove('show'), 4200)
  }

  function renderStatus() {
    const readiness = summary.readiness?.topologyReadiness ?? 'not_ready'
    const context = container.querySelector('.readiness-badge')
    if (context) {
      context.className = `readiness-badge ${readiness}`
      context.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${
        readiness === 'ready' ? 'verified' : 'pending_actions'
      }</span>${readiness === 'ready' ? 'Topologi siap' : 'Perlu konfirmasi'}`
    }
  }

  function bindStaticControls() {
    container.querySelector('#topology-search-input').addEventListener('input', (event) => {
      state.search = event.target.value
      window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(renderWorkspace, 140)
    })
    container.querySelector('.category-chips').addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]')
      if (!button) return
      const category = button.dataset.category
      if (!state.selectedCategories.size) state.selectedCategories = new Set(ALL_CATEGORIES)
      if (state.selectedCategories.has(category)) state.selectedCategories.delete(category)
      else state.selectedCategories.add(category)
      if (state.selectedCategories.size === ALL_CATEGORIES.length) {
        state.selectedCategories = new Set()
      }
      renderWorkspace()
    })
    container.querySelector('.reset-category-filter').addEventListener('click', () => {
      state.selectedCategories = new Set()
      renderWorkspace()
    })
    container.querySelector('.toggle-candidates').addEventListener('change', (event) => {
      state.showCandidates = event.target.checked
      renderWorkspace()
    })
    container.querySelector('.toggle-unresolved').addEventListener('change', (event) => {
      state.showUnresolved = event.target.checked
      renderWorkspace()
    })
    container.querySelector('#label-mode').addEventListener('change', (event) => {
      state.labelMode = event.target.value
      renderCanvas()
      updateUrl()
    })
    container.querySelector('.topology-zoom-in').addEventListener('click', () => zoomBy(0.12))
    container.querySelector('.topology-zoom-out').addEventListener('click', () => zoomBy(-0.12))
    container.querySelector('.topology-zoom-value').addEventListener('click', () => setZoom(1))
    container.querySelector('.topology-fit').addEventListener('click', fitGraph)
    container.querySelector('.export-topology-svg').addEventListener('click', exportSvg)
    container.querySelector('.export-topology-png').addEventListener('click', exportPng)
    container.querySelector('.topology-a11y-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-a11y-node]')
      if (!button) return
      state.selectedAssetId = button.dataset.a11yNode
      renderWorkspace()
    })
    bindViewportNavigation()
  }

  function bindViewportNavigation() {
    const viewport = container.querySelector('.topology-viewport')
    let drag = null
    viewport.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-node-id], [data-candidate-id], [data-unresolved-id]')) {
        return
      }
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      }
      viewport.classList.add('panning')
      viewport.setPointerCapture(event.pointerId)
    })
    viewport.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return
      viewport.scrollLeft = drag.left - (event.clientX - drag.x)
      viewport.scrollTop = drag.top - (event.clientY - drag.y)
    })
    const stopDrag = () => {
      drag = null
      viewport.classList.remove('panning')
    }
    viewport.addEventListener('pointerup', stopDrag)
    viewport.addEventListener('pointercancel', stopDrag)
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault()
      const oldZoom = state.zoom
      const nextZoom = clamp(oldZoom + (event.deltaY < 0 ? 0.1 : -0.1), 0.18, 3.2)
      if (nextZoom === oldZoom) return
      const bounds = viewport.getBoundingClientRect()
      const pointerX = event.clientX - bounds.left
      const pointerY = event.clientY - bounds.top
      const sourceX = (viewport.scrollLeft + pointerX) / oldZoom
      const sourceY = (viewport.scrollTop + pointerY) / oldZoom
      setZoom(nextZoom, () => {
        viewport.scrollLeft = sourceX * nextZoom - pointerX
        viewport.scrollTop = sourceY * nextZoom - pointerY
      })
    }, { passive: false })
  }

  function zoomBy(delta) {
    setZoom(clamp(state.zoom + delta, 0.18, 3.2))
  }

  function setZoom(value, afterRender) {
    const previousRenderBucket = zoomRenderBucket(state.zoom, state.labelMode)
    state.zoom = value
    if (previousRenderBucket === zoomRenderBucket(state.zoom, state.labelMode)) {
      applyCanvasScale()
    } else {
      renderCanvas()
    }
    afterRender?.()
  }

  function fitGraph() {
    const viewport = container.querySelector('.topology-viewport')
    const nextZoom = clamp(Math.min(
      (viewport.clientWidth - 60) / layout.width,
      (viewport.clientHeight - 60) / layout.height,
    ), 0.18, 1)
    setZoom(nextZoom, () => {
      viewport.scrollLeft = Math.max(0, (layout.width * nextZoom - viewport.clientWidth) / 2)
      viewport.scrollTop = Math.max(0, (layout.height * nextZoom - viewport.clientHeight) / 2)
    })
  }

  function exportSvg() {
    const svg = container.querySelector('.topology-canvas .topology-svg')
    if (!svg) return
    downloadBlob(new Blob([svg.outerHTML], { type: 'image/svg+xml' }), 'peta-topologi-spasial.svg')
  }

  function exportPng() {
    const svg = container.querySelector('.topology-canvas .topology-svg')
    if (!svg) return
    const source = new Blob([svg.outerHTML], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(source)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(layout.width)
      canvas.height = Math.ceil(layout.height)
      const context = canvas.getContext('2d')
      context.fillStyle = '#101923'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, 'peta-topologi-spasial.png')
        URL.revokeObjectURL(url)
      }, 'image/png')
    }
    image.src = url
  }

  function updateUrl() {
    const base = serializeTopologyViewState(window.location.search, {
      ...state,
      reviewCandidateId: state.selectedCandidateId,
    })
    const params = new URLSearchParams(base)
    setOrDelete(params, 'unresolvedEndpoint', state.selectedUnresolvedId)
    setOrDelete(params, 'candidates', state.showCandidates ? null : 'off')
    setOrDelete(params, 'unresolved', state.showUnresolved ? null : 'off')
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
  }
}

function renderContext(activeContext, summaryPayload) {
  const readiness = summaryPayload.readiness?.topologyReadiness ?? 'not_ready'
  return `
    <section class="topology-context">
      <span class="eyebrow">CABANG AKTIF</span>
      <h1>${escapeHtml(activeContext.branchName)}</h1>
      <p>${escapeHtml(activeContext.version)} · ${escapeHtml(activeContext.datasetVersionId)}</p>
      <span class="readiness-badge ${readiness}">
        <span class="material-symbols-outlined" aria-hidden="true">${
          readiness === 'ready' ? 'verified' : 'pending_actions'
        }</span>${readiness === 'ready' ? 'Topologi siap' : 'Perlu konfirmasi'}
      </span>
    </section>
  `
}

function renderCandidateInspector(candidate, {
  activeContext,
  featureById,
  restricted,
  actionStatus,
  actionMessage,
}) {
  const sourceName = featureById.get(candidate.sourceFeatureId)?.sourceName
    ?? candidate.sourcePathAssetId
  const targetName = featureById.get(candidate.targetFeatureId)?.sourceName
    ?? candidate.targetAssetId
    ?? candidate.targetPathAssetId
    ?? 'Target belum tersedia'
  const open = ['candidate', 'ambiguous'].includes(candidate.candidateStatus)
  return `
    <button class="icon-button close-topology-inspector" type="button" aria-label="Tutup detail">
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
    <header class="inspector-header">
      <span class="candidate-status ${escapeHtml(candidate.candidateStatus)}">${
        statusLabel(candidate.candidateStatus)
      }</span>
      <h2>Konfirmasi endpoint</h2>
      <p>${candidate.candidateStatus === 'ambiguous'
        ? 'Ada lebih dari satu target yang layak. Periksa evidence sebelum memutuskan.'
        : 'Sistem menemukan target yang layak, tetapi keputusan manusia tetap diperlukan.'}</p>
    </header>
    <section class="inspector-route">
      ${endpointCard('Jalur sumber', sourceName, candidate.sourceEndpointId)}
      <div class="inspector-route-line">
        <span>${formatDistance(candidate.distanceMeters)}</span><i></i>
      </div>
      ${endpointCard('Target usulan', targetName, candidate.targetEndpointId)}
    </section>
    <section class="candidate-confidence">
      <div class="confidence-score"><strong>${formatPercent(
        candidate.score,
      )}</strong><span>confidence</span></div>
      <div>
        <span>Score margin <strong>${formatNumber(candidate.scoreMargin)}</strong></span>
        <span>Tipe <strong>${candidateTypeLabel(candidate.candidateType)}</strong></span>
        <span>Family <strong>${categoryLabel(
          normalizeFamily(candidate.networkFamily),
        )}</strong></span>
      </div>
    </section>
    <section class="inspector-evidence">
      <h3>Evidence terkuat</h3>
      <ul>${(candidate.evidence ?? []).slice(0, 3).map((evidence) => `
        <li><span class="material-symbols-outlined" aria-hidden="true">task_alt</span>
          <p><strong>${escapeHtml(evidence.source ?? evidence.ruleId ?? 'Rule')}</strong>
          <small>${escapeHtml(evidence.explanation ?? '')}</small></p>
        </li>`).join('') || '<li>Evidence tidak tersedia.</li>'}</ul>
    </section>
    <div class="inspector-integrity-note">
      <span class="material-symbols-outlined" aria-hidden="true">straighten</span>
      <p><strong>Posisi tidak akan berubah.</strong> Konfirmasi hanya memasukkan relasi ke graph;
        koordinat dan garis sumber tetap sama dengan peta.</p>
    </div>
    ${actionMessage ? `<p class="inspector-action-message ${actionStatus}" role="status">${
      escapeHtml(actionMessage)
    }</p>` : ''}
    <footer class="inspector-actions">
      <button class="button primary confirm-topology-candidate" type="button"${
        !open || restricted || actionStatus === 'loading' ? ' disabled' : ''
      }>
        <span class="material-symbols-outlined" aria-hidden="true">verified</span>Konfirmasi relasi
      </button>
      <button class="button danger-outline reject-topology-candidate" type="button"${
        !open || restricted || actionStatus === 'loading' ? ' disabled' : ''
      }>Tolak</button>
      <a class="button secondary" href="${reviewHref(activeContext, candidate.candidateId)}">
        Review lengkap
      </a>
    </footer>
  `
}

function renderUnresolvedInspector(endpoint, activeContext) {
  return `
    <button class="icon-button close-topology-inspector" type="button" aria-label="Tutup detail">
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
    <header class="inspector-header unresolved">
      <span class="candidate-status unresolved">Unresolved</span>
      <h2>Endpoint belum memiliki target aman</h2>
      <p>Mesin relasi tidak menemukan kandidat yang memenuhi radius dan aturan kompatibilitas.</p>
    </header>
    <section class="unresolved-detail">
      <dl>
        <div><dt>Jalur</dt><dd>${escapeHtml(endpoint.sourcePathAssetId)}</dd></div>
        <div><dt>Posisi endpoint</dt><dd>${escapeHtml(endpoint.endpointRole ?? '—')}</dd></div>
        <div><dt>Alasan</dt><dd>${reasonLabel(endpoint.reason)}</dd></div>
        <div><dt>Koordinat</dt><dd>${formatCoordinate(endpoint.coordinate)}</dd></div>
      </dl>
    </section>
    <div class="inspector-integrity-note warning">
      <span class="material-symbols-outlined" aria-hidden="true">rule</span>
      <p><strong>Tidak dapat dikonfirmasi langsung.</strong> Perbaiki endpoint sumber atau
        tambahkan aset target yang valid, lalu jalankan ulang pemeriksaan topologi.</p>
    </div>
    <footer class="inspector-actions">
      <a class="button primary" href="${reviewHref(activeContext)}">Buka antrean review</a>
    </footer>
  `
}

function renderNodeInspector(node) {
  return `
    <button class="icon-button close-topology-inspector" type="button" aria-label="Tutup detail">
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
    <header class="inspector-header node">
      <span class="node-family"><i class="category-dot ${node.family}"></i>${
        categoryLabel(node.family)
      }</span>
      <h2>${escapeHtml(node.name)}</h2>
      <p>${escapeHtml(node.type)}</p>
    </header>
    <section class="unresolved-detail">
      <dl>
        <div><dt>Confirmed edge</dt><dd>${node.degree}</dd></div>
        <div><dt>Kandidat masuk</dt><dd>${node.candidateCount}</dd></div>
        <div><dt>Koordinat</dt><dd>${formatCoordinate(node.coordinate)}</dd></div>
        <div><dt>Identitas graph</dt><dd>${escapeHtml(node.id)}</dd></div>
      </dl>
    </section>
    <div class="inspector-integrity-note">
      <span class="material-symbols-outlined" aria-hidden="true">my_location</span>
      <p>Titik ini memakai koordinat yang sama dengan peta aset, tanpa offset layout.</p>
    </div>
    <footer class="inspector-actions">
      <button class="button primary open-topology-node-on-map" type="button"${
        node.mapAssetId ? '' : ' disabled'
      }>
        <span class="material-symbols-outlined" aria-hidden="true">location_on</span>Lihat di peta
      </button>
    </footer>
  `
}

function endpointCard(label, name, id) {
  return `<div class="inspector-endpoint">
    <span>${escapeHtml(label)}</span><strong>${escapeHtml(name)}</strong>
    <small>${escapeHtml(id ?? 'Endpoint tidak tersedia')}</small>
  </div>`
}

function renderLoadingState() {
  return `<div class="map-app">${renderTopNavigation('topology')}
    <main class="topology-page-state" aria-busy="true">
      <span class="material-symbols-outlined spin">progress_activity</span>
      <h1>Memuat Peta Topologi</h1>
      <p>Menyelaraskan geometri sumber, node, dan status endpoint.</p>
    </main></div>`
}

function renderErrorState(message) {
  return `<div class="map-app">${renderTopNavigation('topology')}
    <main class="topology-page-state error">
      <span class="material-symbols-outlined">error</span>
      <h1>Peta topologi tidak dapat dimuat</h1>
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

function mapHref(context, selectedAssetId) {
  const params = new URLSearchParams({
    datasetId: context.datasetId,
    branchId: context.branchId,
  })
  if (selectedAssetId) params.set('selectedAssetId', selectedAssetId)
  return `/map?${params}`
}

function topologyHref(context) {
  return `/topology?${new URLSearchParams({
    datasetId: context.datasetId,
    branchId: context.branchId,
  })}`
}

function reviewHref(context, candidateId) {
  const params = new URLSearchParams({
    datasetId: context.datasetId,
    branchId: context.branchId,
  })
  if (candidateId) params.set('reviewCandidateId', candidateId)
  return `/admin/topology-review?${params}`
}

function option(value, label, selected) {
  return `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`
}

function categoryLabel(category) {
  return {
    cctv: 'CCTV',
    'fiber-optic': 'Fiber Optic',
    lan: 'LAN',
    infrastructure: 'Infrastruktur',
    peripheral: 'Peripheral',
    unmapped: 'Lainnya',
  }[category] ?? category
}

function normalizeFamily(value) {
  const source = String(value ?? '').toLowerCase().replaceAll('_', '-')
  if (source.includes('fiber')) return 'fiber-optic'
  if (source.includes('cctv')) return 'cctv'
  if (source.includes('lan')) return 'lan'
  if (source.includes('infra')) return 'infrastructure'
  if (source.includes('peripheral')) return 'peripheral'
  return 'unmapped'
}

function statusLabel(status) {
  return {
    candidate: 'Perlu konfirmasi',
    ambiguous: 'Target ambigu',
    confirmed: 'Terkonfirmasi',
    rejected: 'Ditolak',
    revoked: 'Dibatalkan',
  }[status] ?? status
}

function candidateTypeLabel(type) {
  return {
    endpoint_device: 'Endpoint ke perangkat',
    endpoint_endpoint: 'Endpoint ke endpoint',
    inline_device: 'Perangkat pada jalur',
    intersection_with_junction: 'Persilangan dengan junction',
    explicit_metadata: 'Metadata eksplisit',
  }[type] ?? String(type ?? 'Kandidat relasi').replaceAll('_', ' ')
}

function reasonLabel(reason) {
  return {
    no_eligible_candidate: 'Tidak ada kandidat yang memenuhi aturan',
    invalid_geometry: 'Geometri endpoint tidak valid',
  }[reason] ?? String(reason ?? 'Belum diketahui').replaceAll('_', ' ')
}

function formatPercent(value) {
  return `${Math.round(Number(value ?? 0) * 100)}%`
}

function formatDistance(value) {
  if (!Number.isFinite(Number(value))) return '—'
  return Number(value) < 1
    ? `${Math.round(Number(value) * 100)} cm`
    : `${Number(value).toFixed(2)} m`
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—'
}

function formatCoordinate(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return '—'
  return `${Number(coordinate[1]).toFixed(6)}, ${Number(coordinate[0]).toFixed(6)}`
}

function featureName(features, featureId) {
  return features.find(({ sourceFeatureId }) => sourceFeatureId === featureId)?.sourceName
}

function bindActivation(element, action) {
  element.addEventListener('click', action)
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  })
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function setOrDelete(params, key, value) {
  if (value) params.set(key, value)
  else params.delete(key)
}

function unique(values) {
  return [...new Set(values)]
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function zoomRenderBucket(zoom, labelMode) {
  return `${labelMode}:${zoom >= 0.72}:${zoom >= 1.18}`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
