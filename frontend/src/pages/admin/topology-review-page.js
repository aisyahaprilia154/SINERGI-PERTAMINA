import {
  adaptActiveDatasetForMap,
  locationGroupFor,
} from '../../adapters/active-dataset-map-adapter.js'
import {
  attachCandidateMapGeometryIds,
  countCandidatesForLocation,
  createReviewLocationIndex,
  filterCandidatesByLocation,
  selectReviewLocationGroup,
} from '../../domain/topology-review-location.js'
import {
  isRelationCategoryId,
  RELATION_CATEGORIES,
  relationCategoryForCandidate,
} from '../../domain/topology-review-category.js'
import { prioritizeTopologyCandidates } from '../../domain/topology-view-model.js'
import {
  loadActiveDataset,
  loadDatasetProjection,
  loadAllTopologyCandidates,
  loadTopologyProjection,
  createTopologyRelation,
  reviewTopologyBulk,
  reviewTopologyCandidate,
  revokeTopologyRelation,
} from '../../services/active-dataset-service.js'
import { bindUserAccountMenu, renderTopNavigation, scopeMapData } from '../map/map-page.js'
import { createMapLibreSurface } from '../map/maplibre-map.js'

export async function renderTopologyReviewPage(container) {
  document.title = 'Konfirmasi Koneksi — SINERGI'
  document.body.className = 'map-body topology-review-body'
  container.innerHTML = reviewState('progress_activity', 'Memuat konfirmasi koneksi',
    'Daftar koneksi sedang disiapkan.', true)
  bindUserAccountMenu()

  const requested = readContext()
  try {
    const activePayload = await loadActiveDataset(requested)
    const mapData = adaptActiveDatasetForMap(activePayload)
    await initializeReview(container, mapData)
  } catch (error) {
    container.innerHTML = reviewState('error', 'Konfirmasi koneksi tidak dapat dimuat', error.message)
    bindUserAccountMenu()
    container.querySelector('.retry-review')?.addEventListener('click', () => {
      renderTopologyReviewPage(container)
    })
  }
}

async function initializeReview(container, mapData) {
  const datasetVersionId = mapData.activeContext.datasetVersionId
  let projections = await loadReviewProjections(datasetVersionId, mapData.geometries)
  const params = new URLSearchParams(window.location.search)
  const requestedStatus = params.get('status')
  const locationIndex = createReviewLocationIndex(mapData)
  const requestedCategory = params.get('category')
  const state = {
    selectedCandidateId: params.get('reviewCandidateId'),
    selectedCandidateIds: new Set(),
    status: requestedStatus === 'open' ? 'needs-review' : requestedStatus ?? 'needs-review',
    category: isRelationCategoryId(requestedCategory) ? requestedCategory : 'all',
    family: params.get('family') ?? 'all',
    type: params.get('type') ?? 'all',
    minScore: Number(params.get('minScore') ?? 0),
    maxDistance: Number(params.get('maxDistance') ?? 6),
    search: params.get('q') ?? '',
    actionStatus: 'idle',
    actionMessage: '',
    bulkStatus: 'idle',
    bulkMessage: '',
  }
  let decisionContext = null
  const requestedCandidate = projections.candidates.items.find(({ candidateId }) => (
    candidateId === state.selectedCandidateId
  )) ?? null
  const selectedArea = selectReviewLocationGroup({
    requestedKey: params.get('area'),
    locationGroups: mapData.locationGroups,
    candidate: requestedCandidate,
    candidates: projections.candidates.items,
    locationIndex,
    branchId: mapData.activeContext.branchId,
  })
  state.area = selectedArea?.key ?? null
  const scopedMapData = scopeMapData({
    selectedArea,
    assets: mapData.assets,
    diagramAssets: mapData.diagramAssets,
    geometries: mapData.geometries,
    exportAssets: mapData.exportAssets,
    networks: mapData.networks,
    topologyGraph: mapData.topologyGraph,
  })
  const manualRelationAssets = scopedMapData.assets
    .filter(({ hasPointGeometry }) => hasPointGeometry)
    .sort((left, right) => (
      `${left.name ?? ''} ${left.id}`.localeCompare(`${right.name ?? ''} ${right.id}`, 'id')
    ))
  const initialLocationCandidates = candidatesForLocation()
  if (!initialLocationCandidates.some(({ candidateId }) => (
    candidateId === state.selectedCandidateId
  ))) {
    state.selectedCandidateId = filterCandidates(initialLocationCandidates, state)[0]?.candidateId
      ?? null
  }

  container.innerHTML = `
    <div class="map-app review-app">
      ${renderTopNavigation('review', {
        ...mapData.activeContext,
        area: selectedArea?.key,
      })}
      <header class="review-header">
        <div class="review-title">
          <h1>Konfirmasi koneksi</h1>
          <p>${escapeHtml(formatLocationName(selectedArea?.name ?? 'Semua lokasi'))} · ${
            escapeHtml(mapData.activeContext.version)
          }</p>
        </div>
        <label class="site-picker">
          <span>Site operasional</span>
          <span class="site-picker-control">
            <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
            <select class="site-select" aria-label="Pilih site operasional">
              ${mapData.locationGroups.map((location) => `
                <option value="${escapeHtml(location.key)}"
                  ${location.key === selectedArea?.key ? 'selected' : ''}>
                  ${escapeHtml(formatLocationName(location.name))} · ${
                    countCandidatesForLocation(
                      projections.candidates.items,
                      location.key,
                      locationIndex,
                    )
                  } koneksi
                </option>
              `).join('')}
            </select>
            <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
          </span>
        </label>
        <div class="review-header-actions">
          <div class="review-readiness-slot">${renderReadiness(
            projections.summary,
            initialLocationCandidates,
          )}</div>
          <div class="review-bulk-actions"></div>
        </div>
      </header>
      <main class="review-workspace">
        <aside class="candidate-queue" aria-label="Candidate queue">
          <div class="queue-summary"></div>
          <div class="queue-filters">
            <div class="primary-filters">
              <label class="candidate-search-field">
                <span>Cari koneksi</span>
                <input class="candidate-search" type="search" value="${escapeHtml(state.search)}"
                  placeholder="Nama aset atau kabel">
              </label>
              <label><span>Status</span><select class="candidate-status-filter"></select></label>
            </div>
            <div class="relation-category-section">
              <span class="relation-category-label">Kelompok relasi</span>
              <div class="relation-category-tabs" role="tablist"
                aria-label="Kelompok relasi koneksi"></div>
            </div>
            <details class="advanced-filters">
              <summary>
                <span class="material-symbols-outlined" aria-hidden="true">tune</span>
                Filter lanjutan
              </summary>
              <div>
                <label><span>Jenis jaringan</span><select class="candidate-family-filter"></select></label>
                <label><span>Tipe koneksi</span><select class="candidate-type-filter"></select></label>
                <label><span>Jarak maks.</span>
                  <input class="candidate-distance-filter" type="number" min="0" step=".5"
                    value="${state.maxDistance}">
                </label>
                <label>
                  <span>Keyakinan minimum
                    <output class="score-output">${Math.round(state.minScore * 100)}%</output>
                  </span>
                  <input class="candidate-score-filter" type="range" min="0" max="1" step=".05"
                    value="${state.minScore}">
                </label>
              </div>
            </details>
          </div>
          <div class="candidate-list" role="list" aria-label="Kandidat relasi"></div>
        </aside>
        <section class="review-map-panel" aria-label="Peta koneksi yang ditinjau">
          <header>
            <div>
              <strong>Peta koneksi · ${escapeHtml(formatLocationName(
                selectedArea?.name ?? 'Semua lokasi',
              ))}</strong>
              <small>Garis putus-putus menunjukkan koneksi yang sedang diperiksa</small>
            </div>
            <span class="review-map-status">
              <i></i><span class="review-map-status-label">Memuat peta</span>
            </span>
          </header>
          <div id="review-map" tabindex="0" aria-label="Peta aset dan jalur kabel"></div>
          <div class="review-map-legend" aria-label="Legenda peta">
            <span><i class="asset"></i>Aset</span>
            <span><i class="cable"></i>Jalur kabel</span>
            <span><i class="candidate"></i>Koneksi diperiksa</span>
          </div>
        </section>
        <section class="candidate-review-panel" aria-live="polite"></section>
      </main>
      ${renderBulkDialog()}
      ${renderDecisionDialog()}
      ${renderManualRelationDialog(manualRelationAssets)}
    </div>
  `

  bindUserAccountMenu()
  const reviewMap = createMapLibreSurface(container.querySelector('#review-map'), {
    assets: scopedMapData.assets,
    networks: scopedMapData.networks,
    geometries: scopedMapData.geometries,
    topologyGraph: scopedMapData.topologyGraph,
    candidates: initialLocationCandidates,
    onSelectCandidate: (candidateId) => {
      if (!candidatesForLocation().some((item) => item.candidateId === candidateId)) return
      state.selectedCandidateId = candidateId
      state.actionStatus = 'idle'
      state.actionMessage = ''
      renderAll()
    },
    onBasemapStatus: (status) => {
      const label = container.querySelector('.review-map-status-label')
      const indicator = container.querySelector('.review-map-status')
      if (!label || !indicator) return
      label.textContent = {
        available: 'Peta tersedia',
        loading: 'Memuat peta',
        unavailable: 'Data aset tetap tersedia',
      }[status] ?? 'Status peta'
      indicator.dataset.status = status
    },
  })
  reviewMap.setState({
    selectedNetworkIds: scopedMapData.networks.map(({ id }) => id),
    dimOthers: true,
    // Keep the full cable context visible while emphasizing the selected candidate.
    isolateSelectedCandidate: false,
  })

  bindSitePicker()
  bindFilters()
  bindBulkDialog()
  bindDecisionDialog()
  bindManualRelationDialog()
  renderAll()

  function bindSitePicker() {
    container.querySelector('.site-select')?.addEventListener('change', (event) => {
      const nextArea = event.target.value
      if (!mapData.locationGroups.some(({ key }) => key === nextArea)
        || nextArea === selectedArea?.key) return
      const query = new URLSearchParams(window.location.search)
      query.set('datasetId', mapData.activeContext.datasetId)
      query.set('branchId', mapData.activeContext.branchId)
      query.set('area', nextArea)
      query.delete('reviewCandidateId')
      reviewMap.destroy()
      window.location.assign(`${window.location.pathname}?${query}`)
    })
  }

  function renderAll() {
    const items = filterCandidates(candidatesForLocation(), state)
    pruneSelectedCandidates()
    if (!items.some(({ candidateId }) => candidateId === state.selectedCandidateId)) {
      state.selectedCandidateId = items[0]?.candidateId ?? null
    }
    renderHeaderActions()
    renderRelationCategories(candidatesForLocation())
    renderQueue(items)
    renderDetail()
    focusCandidateOnMap()
    updateUrl()
  }

  function pruneSelectedCandidates() {
    const confirmableIds = new Set(
      projections.candidates.items.filter(canConfirm)
        .map(({ candidateId }) => candidateId),
    )
    state.selectedCandidateIds.forEach((candidateId) => {
      if (!confirmableIds.has(candidateId)) state.selectedCandidateIds.delete(candidateId)
    })
  }

  function getSelectedConfirmableCandidates() {
    return projections.candidates.items.filter((candidate) => (
      state.selectedCandidateIds.has(candidate.candidateId)
      && canConfirm(candidate)
    ))
  }

  function candidatesForLocation() {
    return filterCandidatesByLocation(
      projections.candidates.items,
      state.area,
      locationIndex,
    )
  }

  function focusCandidateOnMap() {
    const candidate = projections.candidates.items.find(({ candidateId }) => (
      candidateId === state.selectedCandidateId
    ))
    reviewMap.setCandidates(filterCandidates(candidatesForLocation(), state))
    reviewMap.setState({
      selectedCandidateId: candidate?.candidateId ?? null,
      selectedAssetId: candidate?.targetAssetId ?? null,
      connectedNodeIds: [
        candidate?.sourcePathAssetId,
        candidate?.targetAssetId ?? candidate?.targetPathAssetId,
      ].filter(Boolean),
    })
    if (!candidate) return
    const positions = [candidate.sourceCoordinate, candidate.targetCoordinate]
      .filter(validCoordinate)
    if (positions.length) {
      reviewMap.focusCoordinates(positions)
      return
    }
    reviewMap.focusAssetBounds([
      candidate.sourcePathAssetId,
      candidate.targetAssetId ?? candidate.targetPathAssetId,
    ].filter(Boolean))
  }

  function renderHeaderActions() {
    container.querySelector('.review-readiness-slot').innerHTML = renderReadiness(
      projections.summary,
      candidatesForLocation(),
    )
    const confirmableCount = projections.candidates.items.filter(
      isBulkConfirmableCandidate,
    ).length
    const lineConfirmableCount = projections.candidates.items.filter(
      isLineLabelConfirmableCandidate,
    ).length
    const confirmedCount = projections.graph.confirmedRelations.filter(
      ({ verificationStatus }) => verificationStatus === 'confirmed',
    ).length
    const confirmedDeviceEdgeCount = projections.graph.graph?.edges?.length ?? 0
    const actions = container.querySelector('.review-bulk-actions')
    actions.innerHTML = `
      <button class="button primary manual-relation-action" type="button"
        ${manualRelationAssets.length >= 2 ? '' : 'disabled'}
        title="${manualRelationAssets.length >= 2
          ? 'Tambahkan koneksi langsung antar device'
          : 'Minimal dua device bertitik diperlukan'}">
        <span class="material-symbols-outlined" aria-hidden="true">add_link</span>
        Tambah koneksi
      </button>
      <details class="bulk-actions-menu">
        <summary class="button secondary">
          <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
          Aksi massal
        </summary>
        <div>
          <button class="confirm-line-labels" type="button"
            ${lineConfirmableCount ? '' : 'disabled'}>
            <span class="material-symbols-outlined" aria-hidden="true">route</span>
            <span><strong>Konfirmasi koneksi dari garis</strong>
              <small>${lineConfirmableCount} garis punya endpoint terbaca</small></span>
          </button>
          <button class="confirm-all-candidates" type="button"
            ${confirmableCount ? '' : 'disabled'}>
            <span class="material-symbols-outlined" aria-hidden="true">done_all</span>
            <span><strong>Konfirmasi rekomendasi</strong>
              <small>${confirmableCount} koneksi di seluruh dataset</small></span>
          </button>
          <button class="revoke-all-relations destructive" type="button"
            ${confirmedCount ? '' : 'disabled'}>
            <span class="material-symbols-outlined" aria-hidden="true">delete_sweep</span>
            <span><strong>Hapus semua konfirmasi</strong>
              <small>${confirmedDeviceEdgeCount} device edge &middot; ${confirmedCount} relation/attachment</small></span>
          </button>
        </div>
      </details>
      ${state.bulkMessage ? `<p class="bulk-action-message ${state.bulkStatus}" role="status">${
        escapeHtml(state.bulkMessage)
      }</p>` : ''}
    `
    actions.querySelector('.manual-relation-action')?.addEventListener('click', () => {
      openManualRelationDialog()
    })
    actions.querySelector('.confirm-all-candidates')?.addEventListener('click', () => {
      openBulkDialog('confirm-all', confirmableCount)
    })
    actions.querySelector('.confirm-line-labels')?.addEventListener('click', () => {
      openBulkDialog('confirm-line-labels', lineConfirmableCount)
    })
    actions.querySelector('.revoke-all-relations')?.addEventListener('click', () => {
      openBulkDialog('revoke-all', confirmedCount)
    })
  }

  function renderQueue(items) {
    const locationCandidates = candidatesForLocation()
    const selectableItems = items.filter(canConfirm)
    const selectedVisibleCount = selectableItems.filter(({ candidateId }) => (
      state.selectedCandidateIds.has(candidateId)
    )).length
    container.querySelector('.queue-summary').innerHTML = `
      <div><strong>${items.length}</strong><span>ditampilkan</span></div>
      <div><strong>${locationCandidates.filter(isBulkConfirmableCandidate).length}</strong>
        <span>rekomendasi</span></div>
      <div><strong>${locationCandidates.filter(({ candidateStatus }) => (
        candidateStatus === 'ambiguous'
      )).length}</strong><span>belum pasti</span></div>
      <label class="queue-selection-control">
        <input class="select-visible-candidates" type="checkbox"
          ${selectableItems.length > 0 && selectedVisibleCount === selectableItems.length
            ? 'checked' : ''}
          ${selectableItems.length ? '' : 'disabled'}
          aria-label="Pilih semua koneksi yang tampil dan bisa dikonfirmasi">
        <span>Pilih semua yang tampil</span>
        <strong>${state.selectedCandidateIds.size} dipilih</strong>
      </label>
    `
    const selectVisible = container.querySelector('.select-visible-candidates')
    let pendingSelectionScrollTop = null
    const captureSelectionScroll = () => {
      pendingSelectionScrollTop = container.querySelector('.candidate-list')?.scrollTop ?? null
    }
    const consumeSelectionScroll = () => {
      const scrollTop = pendingSelectionScrollTop
      pendingSelectionScrollTop = null
      return scrollTop
    }
    if (selectVisible) {
      selectVisible.indeterminate = selectedVisibleCount > 0
        && selectedVisibleCount < selectableItems.length
      selectVisible.addEventListener('pointerdown', captureSelectionScroll)
      selectVisible.addEventListener('change', (event) => {
        selectableItems.forEach(({ candidateId }) => {
          if (event.target.checked) state.selectedCandidateIds.add(candidateId)
          else state.selectedCandidateIds.delete(candidateId)
        })
        renderSelectionState(consumeSelectionScroll())
      })
    }
    const list = container.querySelector('.candidate-list')
    if (!items.length) {
      list.innerHTML = `<div class="empty-candidate-list">
        <span class="material-symbols-outlined">filter_alt_off</span>
        <strong>Tidak ada kandidat</strong>
        <p>Ubah filter untuk melihat candidate lainnya.</p>
      </div>`
      return
    }
    list.innerHTML = items.map((candidate) => {
      const selectable = canConfirm(candidate)
      const selectedForBulk = state.selectedCandidateIds.has(candidate.candidateId)
      const sourceName = endpointName(candidate, 'source', projections.sourceFeatures)
      const targetName = endpointName(candidate, 'target', projections.sourceFeatures)
      return `
      <div class="candidate-card-row${selectedForBulk ? ' selection-selected' : ''}" role="listitem">
        <label class="candidate-select-control${selectable ? '' : ' disabled'}"
          title="${selectable ? 'Pilih koneksi ini' : 'Koneksi ini belum dapat dikonfirmasi'}">
          <input type="checkbox" data-candidate-select="${escapeHtml(candidate.candidateId)}"
            ${selectable ? '' : 'disabled'} ${selectedForBulk ? 'checked' : ''}
            aria-label="Pilih koneksi ${escapeHtml(sourceName)} ke ${escapeHtml(targetName)}">
          <span aria-hidden="true"></span>
        </label>
        <button type="button" class="candidate-card${
        candidate.candidateId === state.selectedCandidateId ? ' selected' : ''
      }" aria-current="${candidate.candidateId === state.selectedCandidateId ? 'true' : 'false'}"
        data-candidate-id="${escapeHtml(candidate.candidateId)}">
        <span class="candidate-status ${escapeHtml(candidate.candidateStatus)}">
          ${escapeHtml(statusLabel(candidate))}
        </span>
        <strong>${escapeHtml(sourceName)}</strong>
        <span class="candidate-arrow" aria-hidden="true">→</span>
        <strong>${escapeHtml(targetName)}</strong>
        <small>${escapeHtml(labelCandidateType(candidate.candidateType))} · ${
          formatDistance(candidate.distanceMeters)
        }</small>
        <span class="candidate-score">${Math.round((candidate.score ?? 0) * 100)}%</span>
        </button>
      </div>
    `
    }).join('')
    list.querySelectorAll('[data-candidate-select]').forEach((input) => {
      input.addEventListener('pointerdown', captureSelectionScroll)
      input.addEventListener('change', (event) => {
        const candidateId = event.target.dataset.candidateSelect
        if (event.target.checked) state.selectedCandidateIds.add(candidateId)
        else state.selectedCandidateIds.delete(candidateId)
        renderSelectionState(consumeSelectionScroll())
      })
    })
    list.querySelectorAll('button[data-candidate-id]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedCandidateId = button.dataset.candidateId
        state.actionStatus = 'idle'
        state.actionMessage = ''
        renderAll()
      })
    })
  }

  function renderRelationCategories(locationCandidates) {
    const tabs = container.querySelector('.relation-category-tabs')
    if (!tabs) return
    const itemsWithoutCategory = filterCandidates(locationCandidates, state, {
      ignoreCategory: true,
    })
    tabs.innerHTML = RELATION_CATEGORIES.map((category) => {
      const count = category.id === 'all'
        ? itemsWithoutCategory.length
        : itemsWithoutCategory.filter((candidate) => (
          relationCategoryForCandidate(candidate) === category.id
        )).length
      const selected = state.category === category.id
      return `<button type="button" role="tab"
        class="relation-category-tab${selected ? ' selected' : ''}"
        aria-selected="${selected}" data-relation-category="${category.id}"
        title="${escapeHtml(category.description)}">
        <span>${escapeHtml(category.label)}</span>
        <strong>${count}</strong>
        <small>${escapeHtml(category.description)}</small>
      </button>`
    }).join('')
    tabs.querySelectorAll('[data-relation-category]').forEach((button) => {
      button.addEventListener('click', () => {
        const category = button.dataset.relationCategory
        if (!isRelationCategoryId(category) || category === state.category) return
        state.category = category
        renderAll()
      })
    })
  }

  function renderSelectionState(scrollTop = null) {
    const selectedCount = getSelectedConfirmableCandidates().length
    const currentCandidate = projections.candidates.items.find(({ candidateId }) => (
      candidateId === state.selectedCandidateId
    ))
    const button = container.querySelector('.confirm-candidate')
    if (button) {
      button.disabled = selectedCount === 0 && !canConfirm(currentCandidate)
      button.title = selectedCount
        ? 'Hubungkan ' + selectedCount + ' koneksi yang dipilih'
        : canConfirm(currentCandidate) ? 'Hubungkan koneksi ini' : 'Koneksi ini belum dapat dihubungkan'
      button.textContent = selectedCount
        ? 'Hubungkan pilihan (' + selectedCount + ')'
        : 'Hubungkan'
    }

    const selectedCountLabel = container.querySelector('.queue-selection-control strong')
    if (selectedCountLabel) {
      selectedCountLabel.textContent = state.selectedCandidateIds.size + ' dipilih'
    }

    const selectableInputs = [...container.querySelectorAll(
      'input[data-candidate-select]:not(:disabled)',
    )]
    const selectedVisibleCount = selectableInputs.filter((input) => (
      state.selectedCandidateIds.has(input.dataset.candidateSelect)
    )).length
    selectableInputs.forEach((input) => {
      const selected = state.selectedCandidateIds.has(input.dataset.candidateSelect)
      input.checked = selected
      input.closest('.candidate-card-row')?.classList.toggle('selection-selected', selected)
    })
    const selectVisible = container.querySelector('.select-visible-candidates')
    if (selectVisible) {
      selectVisible.checked = selectableInputs.length > 0
        && selectedVisibleCount === selectableInputs.length
      selectVisible.indeterminate = selectedVisibleCount > 0
        && selectedVisibleCount < selectableInputs.length
    }
    if (scrollTop === null) return
    const candidateList = container.querySelector('.candidate-list')
    if (!candidateList) return
    const restoreScroll = () => {
      candidateList.scrollTop = scrollTop
    }
    restoreScroll()
    requestAnimationFrame(restoreScroll)
  }

  function renderDetail() {
    const panel = container.querySelector('.candidate-review-panel')
    const candidate = projections.candidates.items.find(({ candidateId }) => (
      candidateId === state.selectedCandidateId
    ))
    if (!candidate) {
      panel.innerHTML = `<div class="review-empty">
        <span class="material-symbols-outlined">fact_check</span>
        <h2>Pilih koneksi untuk diperiksa</h2>
        <p>Pasangan aset dan pilihan keputusan akan muncul di sini.</p>
      </div>`
      return
    }
    const alternatives = candidatesForLocation().filter((item) => (
      item.sourceEndpointId === candidate.sourceEndpointId
      && item.candidateId !== candidate.candidateId
      && ['candidate', 'ambiguous', 'revoked'].includes(item.candidateStatus)
    ))
    const relation = projections.graph.confirmedRelations.find(({ candidateId }) => (
      candidate.candidateId === candidateId
    ))
    const sourceName = endpointName(candidate, 'source', projections.sourceFeatures)
    const targetName = endpointName(candidate, 'target', projections.sourceFeatures)
    const selectedCount = getSelectedConfirmableCandidates().length
    panel.innerHTML = `
      <header class="candidate-detail-header">
        <div>
          <span class="candidate-status ${escapeHtml(candidate.candidateStatus)}">
            ${escapeHtml(statusLabel(candidate))}
          </span>
          <h2>Periksa sambungan ini</h2>
          <p>${escapeHtml(labelCandidateType(candidate.candidateType))}</p>
        </div>
        <div class="confidence-pill"
          aria-label="Keyakinan ${Math.round((candidate.score ?? 0) * 100)} persen">
          <span>Keyakinan sistem</span>
          <strong>${Math.round((candidate.score ?? 0) * 100)}%</strong>
        </div>
      </header>
      <section class="candidate-route" aria-label="Usulan koneksi">
        ${routeEndpoint('Dari', sourceName, shortReference(candidate.sourceEndpointId))}
        <div class="route-connector">
          <span>${formatDistance(candidate.distanceMeters)}</span>
          <i></i>
          <small>${escapeHtml(candidate.networkFamily ?? 'Jaringan tidak diketahui')}</small>
        </div>
        ${routeEndpoint('Ke', targetName, shortReference(candidate.targetEndpointId))}
      </section>
      <details class="technical-details">
        <summary>
          <span class="material-symbols-outlined" aria-hidden="true">analytics</span>
          Detail teknis dan evidence
        </summary>
        <div class="evidence-grid">
          <section>
            <h3>Dasar penilaian</h3>
            <div class="score-components">
              ${Object.entries(candidate.scoreComponents ?? {}).map(([key, value]) => `
                <div><span>${escapeHtml(componentLabel(key))}</span>
                  <meter min="0" max="1" value="${Number(value)}">${Number(value)}</meter>
                  <strong>${Math.round(Number(value) * 100)}%</strong></div>
              `).join('')}
            </div>
            <ul class="evidence-list">${(candidate.evidence ?? []).map((evidence) => `
              <li>
                <span class="material-symbols-outlined" aria-hidden="true">task_alt</span>
                <div><strong>${escapeHtml(evidence.source ?? evidence.evidenceType ?? 'Rule evidence')}</strong>
                <p>${escapeHtml(evidence.explanation ?? evidence.normalizedValue ?? '')}</p></div>
              </li>
            `).join('')}</ul>
          </section>
          <section>
            <h3>Referensi sumber</h3>
            <dl class="source-reference-list">
              ${detailRow('Geometry', (candidate.sourceGeometryIds ?? []).join(', ') || '—')}
              ${detailRow('Source feature', candidate.sourceFeatureId ?? '—')}
              ${detailRow('Target feature', candidate.targetFeatureId ?? '—')}
              ${detailRow('Endpoint', candidate.sourceEndpointId ?? '—')}
              ${detailRow('Jenis jaringan', candidate.networkFamily ?? '—')}
              ${detailRow('Rule set', candidate.topologyRuleSetVersion ?? '—')}
            </dl>
          </section>
        </div>
        <section class="review-history">
          <h3>Riwayat keputusan</h3>
          ${renderHistory(candidate, projections.candidates.history, projections.candidates.runs)}
        </section>
      </details>
      <footer class="review-actions">
        ${state.actionMessage ? `<p class="review-action-message ${state.actionStatus}" role="status">${
          escapeHtml(state.actionMessage)
        }</p>` : ''}
        <div class="review-primary-actions">
          <button class="button primary confirm-candidate" type="button"${
            selectedCount || canConfirm(candidate) ? '' : ' disabled'
          } title="${selectedCount
            ? `Hubungkan ${selectedCount} koneksi yang dipilih`
            : canConfirm(candidate) ? 'Hubungkan koneksi ini' : 'Koneksi ini belum dapat dihubungkan'
          }">${selectedCount ? `Hubungkan pilihan (${selectedCount})` : 'Hubungkan'}</button>
          <button class="button secondary select-alternative" type="button"${
            alternatives.length ? '' : ' disabled'
          }>Pilih target lain</button>
          <details class="decision-more">
            <summary class="button secondary">Opsi lain</summary>
            <div>
              <button class="button reject-candidate" type="button"${
                canReject(candidate) ? '' : ' disabled'
              }>Tandai tidak terhubung</button>
              <button class="button skip-candidate" type="button"${
                canSkip(candidate) ? '' : ' disabled'
              }>Simpan untuk nanti</button>
              <button class="button revoke-relation destructive" type="button"${
                relation?.relationId ? '' : ' disabled'
              }>Batalkan koneksi</button>
            </div>
          </details>
        </div>
      </footer>
    `
    bindActions(candidate, relation)
  }

  function bindActions(candidate, relation) {
    const panel = container.querySelector('.candidate-review-panel')
    panel.querySelector('.confirm-candidate')?.addEventListener('click', () => {
      const selectedCount = getSelectedConfirmableCandidates().length
      if (selectedCount) {
        openBulkDialog('confirm-selected', selectedCount)
        return
      }
      performCandidateAction(candidate, 'confirm')
    })
    panel.querySelector('.reject-candidate')?.addEventListener('click', () => {
      openDecisionDialog('reject', { candidate, relation })
    })
    panel.querySelector('.skip-candidate')?.addEventListener('click', () => (
      performCandidateAction(candidate, 'skip')
    ))
    panel.querySelector('.select-alternative')?.addEventListener('click', () => {
      const alternatives = candidatesForLocation().filter((item) => (
        item.sourceEndpointId === candidate.sourceEndpointId
        && item.candidateId !== candidate.candidateId
        && ['candidate', 'ambiguous', 'revoked'].includes(item.candidateStatus)
      ))
      openDecisionDialog('select-target', { candidate, relation, alternatives })
    })
    panel.querySelector('.revoke-relation')?.addEventListener('click', () => {
      openDecisionDialog('revoke', { candidate, relation })
    })
  }

  async function performCandidateAction(candidate, action, extra = {}, reason = '') {
    await performMutation(async () => (
      reviewTopologyCandidate({
        candidateId: candidate.candidateId,
        action,
        body: { ...reviewSnapshotBody(), reason, ...extra },
      })
    ), actionSuccessMessage(action))
  }

  async function performMutation(mutation, successMessage) {
    if (state.actionStatus === 'loading') return
    state.actionStatus = 'loading'
    state.actionMessage = 'Menyimpan keputusan dan memperbarui confirmed graph…'
    renderDetail()
    try {
      const result = await mutation()
      projections = applyReviewMutationResult(projections, result)
      state.actionStatus = 'success'
      state.actionMessage = successMessage
    } catch (error) {
      state.actionStatus = 'error'
      state.actionMessage = error.message
    }
    renderAll()
  }

  function applyReviewMutationResult(current, result) {
    if (!result || typeof result !== 'object') return current
    const next = {
      ...current,
      candidates: {
        ...current.candidates,
        ...(result.graphRevision !== undefined ? { graphRevision: result.graphRevision } : {}),
        ...(result.candidateRevision !== undefined
          ? { candidateRevision: result.candidateRevision }
          : {}),
        ...(result.recordRevision !== undefined ? { recordRevision: result.recordRevision } : {}),
        items: current.candidates.items.map((candidate) => (
          result.candidate?.candidateId === candidate.candidateId
            ? { ...candidate, ...result.candidate }
            : result.updatedCandidates?.find(({ candidateId }) => (
              candidateId === candidate.candidateId
            )) ?? candidate
        )),
      },
      graph: {
        ...current.graph,
        ...(result.graph ? { graph: result.graph } : {}),
        ...(result.confirmedRelations
          ? { confirmedRelations: result.confirmedRelations }
          : {}),
      },
      ...(result.summary ? { summary: result.summary } : {}),
    }
    if (result.candidate && !next.candidates.items.some(({ candidateId }) => (
      candidateId === result.candidate.candidateId
    ))) {
      next.candidates.items = [...next.candidates.items, result.candidate]
    }
    const existingIds = new Set(next.candidates.items.map(({ candidateId }) => candidateId))
    const newCandidates = (result.updatedCandidates ?? []).filter(({ candidateId }) => (
      !existingIds.has(candidateId)
    ))
    if (newCandidates.length) next.candidates.items = [...next.candidates.items, ...newCandidates]
    return next
  }

  function bindDecisionDialog() {
    const dialog = container.querySelector('.decision-dialog')
    const form = dialog.querySelector('form')
    dialog.querySelector('.close-decision-dialog').addEventListener('click', () => dialog.close())
    dialog.querySelector('.cancel-decision').addEventListener('click', () => dialog.close())
    dialog.addEventListener('close', () => {
      decisionContext = null
      form.reset()
      dialog.querySelector('.decision-dialog-message').textContent = ''
    })
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (!decisionContext) return
      const context = decisionContext
      const reasonChoice = dialog.querySelector('.decision-reason-select').value
      const details = dialog.querySelector('.decision-details').value.trim()
      if (reasonChoice === 'Lainnya' && details.length < 3) {
        dialog.querySelector('.decision-dialog-message').textContent =
          'Tambahkan penjelasan singkat untuk alasan lainnya.'
        return
      }
      const reason = details ? `${reasonChoice}: ${details}` : reasonChoice
      const targetCandidateId = dialog.querySelector('.decision-target').value
      if (context.action === 'select-target' && !targetCandidateId) {
        dialog.querySelector('.decision-dialog-message').textContent =
          'Pilih target pengganti terlebih dahulu.'
        return
      }
      const submit = dialog.querySelector('.submit-decision')
      submit.disabled = true
      dialog.querySelector('.decision-dialog-message').textContent = 'Menyimpan keputusan…'
      try {
        dialog.close()
        if (context.action === 'revoke') {
          await performMutation(async () => {
            await revokeTopologyRelation({
              relationId: context.relation.relationId,
              reason,
              ...reviewSnapshotBody(),
            })
          }, 'Koneksi dibatalkan dan dikeluarkan dari graph operasional.')
        } else {
          await performCandidateAction(
            context.candidate,
            context.action,
            context.action === 'select-target' ? { targetCandidateId } : {},
            reason,
          )
        }
      } finally {
        submit.disabled = false
      }
    })
  }

  function openDecisionDialog(action, context) {
    const dialog = container.querySelector('.decision-dialog')
    decisionContext = { action, ...context }
    const copy = decisionDialogCopy(action)
    dialog.querySelector('.decision-dialog-icon').textContent = copy.icon
    dialog.querySelector('.decision-dialog-title').textContent = copy.title
    dialog.querySelector('.decision-dialog-description').textContent = copy.description
    dialog.querySelector('.decision-reason-select').innerHTML = copy.reasons.map((reason) => (
      `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`
    )).join('')
    const targetField = dialog.querySelector('.decision-target-field')
    targetField.hidden = action !== 'select-target'
    const targetSelect = dialog.querySelector('.decision-target')
    targetSelect.innerHTML = action === 'select-target'
      ? context.alternatives.map((item) => `
        <option value="${escapeHtml(item.candidateId)}">${
          escapeHtml(endpointName(item, 'target', projections.sourceFeatures))
        } · ${Math.round((item.score ?? 0) * 100)}%</option>
      `).join('')
      : ''
    dialog.querySelector('.submit-decision').textContent = copy.submit
    dialog.querySelector('.decision-dialog-message').textContent = ''
    dialog.showModal()
  }

  function bindManualRelationDialog() {
    const dialog = container.querySelector('.manual-relation-dialog')
    const form = dialog.querySelector('form')
    const source = dialog.querySelector('.manual-source-asset')
    const target = dialog.querySelector('.manual-target-asset')
    const reason = dialog.querySelector('.manual-relation-reason')
    const message = dialog.querySelector('.manual-relation-message')
    const submit = dialog.querySelector('.submit-manual-relation')
    const cancel = dialog.querySelector('.cancel-manual-relation')
    dialog.querySelector('.close-manual-relation').addEventListener('click', () => dialog.close())
    cancel.addEventListener('click', () => dialog.close())
    dialog.addEventListener('close', () => {
      form.reset()
      message.textContent = ''
    })
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const sourceAssetId = source.value
      const targetAssetId = target.value
      const normalizedReason = reason.value.trim()
      if (!sourceAssetId || !targetAssetId) {
        message.textContent = 'Pilih device sumber dan device tujuan terlebih dahulu.'
        return
      }
      if (sourceAssetId === targetAssetId) {
        message.textContent = 'Device sumber dan tujuan harus berbeda.'
        return
      }
      if (normalizedReason.length < 3) {
        message.textContent = 'Alasan konfirmasi minimal tiga karakter.'
        return
      }
      submit.disabled = true
      cancel.disabled = true
      message.textContent = 'Menyimpan koneksi dan membangun ulang graph…'
      try {
        const result = await createTopologyRelation({
          datasetVersionId,
          sourceAssetId,
          targetAssetId,
          reason: normalizedReason,
          ...reviewSnapshotBody(),
        })
        projections = applyReviewMutationResult(projections, result)
        reviewMap.setTopologyGraph(scopeMapData({
          selectedArea,
          assets: mapData.assets,
          diagramAssets: mapData.diagramAssets,
          geometries: mapData.geometries,
          exportAssets: mapData.exportAssets,
          networks: mapData.networks,
          topologyGraph: projections.graph.graph,
        }).topologyGraph)
        state.bulkStatus = 'success'
        state.bulkMessage = 'Koneksi antar-device dikonfirmasi. Graph dan tracing diperbarui.'
        dialog.close()
        renderAll()
      } catch (error) {
        state.bulkStatus = 'error'
        state.bulkMessage = ''
        message.textContent = error.message
      } finally {
        submit.disabled = false
        cancel.disabled = false
      }
    })
  }

  function openManualRelationDialog() {
    const dialog = container.querySelector('.manual-relation-dialog')
    const source = dialog.querySelector('.manual-source-asset')
    const target = dialog.querySelector('.manual-target-asset')
    const reason = dialog.querySelector('.manual-relation-reason')
    const message = dialog.querySelector('.manual-relation-message')
    if (manualRelationAssets.length < 2) return
    source.value = manualRelationAssets[0].id
    target.value = manualRelationAssets[1].id
    reason.value = ''
    message.textContent = ''
    dialog.showModal()
    source.focus()
  }

  function bindBulkDialog() {
    const dialog = container.querySelector('.bulk-review-dialog')
    const form = dialog.querySelector('form')
    dialog.querySelector('.close-bulk-dialog').addEventListener('click', () => dialog.close())
    dialog.querySelector('.cancel-bulk-action').addEventListener('click', () => dialog.close())
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const action = dialog.dataset.action
      const reason = dialog.querySelector('.bulk-review-reason').value.trim()
      if (action === 'revoke-all' && reason.length < 3) {
        dialog.querySelector('.bulk-dialog-message').textContent =
          'Alasan penghapusan konfirmasi minimal tiga karakter.'
        return
      }
      await performBulkAction(action, reason)
    })
    dialog.addEventListener('close', () => {
      dialog.dataset.action = ''
      dialog.querySelector('.bulk-review-reason').value = ''
      dialog.querySelector('.bulk-dialog-message').textContent = ''
    })
  }

  function openBulkDialog(action, count) {
    const dialog = container.querySelector('.bulk-review-dialog')
    const destructive = action === 'revoke-all'
    const lineLabelAction = action === 'confirm-line-labels'
    const selectedAction = action === 'confirm-selected'
    if (selectedAction && getSelectedConfirmableCandidates().length < 1) return
    dialog.dataset.action = action
    dialog.querySelector('.bulk-dialog-icon').textContent = destructive
      ? 'delete_sweep'
      : lineLabelAction ? 'route' : 'done_all'
    dialog.querySelector('.bulk-dialog-title').textContent = destructive
      ? `Hapus ${count} konfirmasi?`
      : lineLabelAction
        ? `Konfirmasi ${count} koneksi dari garis?`
        : selectedAction
          ? `Hubungkan ${count} koneksi terpilih?`
        : `Konfirmasi ${count} koneksi yang direkomendasikan?`
    dialog.querySelector('.bulk-dialog-description').textContent = destructive
      ? 'Semua relasi confirmed akan dikeluarkan dari graph dan tidak lagi dapat dipakai tracing.'
      : lineLabelAction
        ? 'Sistem memakai urutan nama device pada garis dan lokasi sumbernya. Garis yang ambigu tidak ikut.'
        : selectedAction
          ? 'Hanya koneksi yang kamu centang yang akan dikonfirmasi. Pastikan semua pilihan sudah diperiksa.'
        : 'Hanya kandidat berstatus recommended yang dikonfirmasi. Ambiguous, unresolved, rejected, dan revoked tidak ikut.'
    dialog.querySelector('.bulk-reason-label').textContent = destructive
      ? 'Alasan penghapusan konfirmasi'
      : 'Catatan konfirmasi (opsional)'
    const submit = dialog.querySelector('.submit-bulk-action')
    submit.textContent = destructive
      ? 'Hapus semua konfirmasi'
      : lineLabelAction
        ? 'Konfirmasi koneksi dari garis'
        : selectedAction ? 'Hubungkan pilihan' : 'Konfirmasi rekomendasi'
    submit.className = `button ${destructive ? 'danger' : 'primary'} submit-bulk-action`
    dialog.querySelector('.bulk-dialog-message').textContent = ''
    dialog.showModal()
    dialog.querySelector('.bulk-review-reason').focus()
  }

  async function performBulkAction(action, reason) {
    const dialog = container.querySelector('.bulk-review-dialog')
    const submit = dialog.querySelector('.submit-bulk-action')
    const cancel = dialog.querySelector('.cancel-bulk-action')
    submit.disabled = true
    cancel.disabled = true
    dialog.querySelector('.bulk-dialog-message').textContent =
      'Menyimpan keputusan dan membangun ulang graph…'
    try {
      const selectedCandidateIds = action === 'confirm-selected'
        ? getSelectedConfirmableCandidates().map(({ candidateId }) => candidateId)
        : null
      if (action === 'confirm-selected' && selectedCandidateIds.length < 1) {
        throw new Error('Pilih minimal satu koneksi yang bisa dikonfirmasi terlebih dahulu.')
      }
      const result = await reviewTopologyBulk({
        datasetVersionId,
        action,
        reason,
        ...(selectedCandidateIds ? { candidateIds: selectedCandidateIds } : {}),
        ...reviewSnapshotBody(),
      })
      projections = applyReviewMutationResult(projections, result)
      state.bulkStatus = 'success'
      if (action === 'confirm-selected') {
        selectedCandidateIds.forEach((candidateId) => state.selectedCandidateIds.delete(candidateId))
        state.bulkMessage = `${result.affectedCount} koneksi terpilih dihubungkan. Graph dan tracing telah diperbarui.`
      } else if (['confirm-all', 'confirm-line-labels'].includes(action)) {
        const remaining = action === 'confirm-line-labels'
          ? result.remainingLineLabelCount
          : result.remainingRecommendedCount
        state.bulkMessage = `${result.affectedCount} koneksi dikonfirmasi. Graph dan tracing telah diperbarui.${
          remaining ? ` ${remaining} kandidat baru masih perlu ditinjau.` : ''
        }`
      } else {
        state.bulkMessage = `${result.affectedCount} konfirmasi dihapus dari graph operasional.`
      }
      dialog.close()
      renderAll()
    } catch (error) {
      state.bulkStatus = 'error'
      state.bulkMessage = ''
      dialog.querySelector('.bulk-dialog-message').textContent = error.message
    } finally {
      submit.disabled = false
      cancel.disabled = false
    }
  }

  function reviewSnapshotBody() {
    return {
      datasetVersionId,
      ...(projections.candidates.graphRevision !== undefined
        ? { expectedGraphRevision: projections.candidates.graphRevision }
        : {}),
      ...(projections.candidates.candidateRevision !== undefined
        ? { expectedCandidateRevision: projections.candidates.candidateRevision }
        : {}),
    }
  }

  function bindFilters() {
    const statuses = [
      ['needs-review', 'Perlu ditinjau'],
      ['all', 'Semua status'],
      ['candidate', 'Rekomendasi sistem'],
      ['ambiguous', 'Belum pasti'],
      ['confirmed', 'Sudah dikonfirmasi'],
      ['rejected', 'Tidak terhubung'],
      ['revoked', 'Dibatalkan'],
      ['unresolved', 'Belum ada pasangan'],
    ]
    const locationCandidates = candidatesForLocation()
    const families = unique(locationCandidates.map(({ networkFamily }) => networkFamily))
    const types = unique(locationCandidates.map(({ candidateType }) => candidateType))
    setOptions('.candidate-status-filter', statuses, state.status)
    setOptions('.candidate-family-filter', [
      ['all', 'Semua family'],
      ...families.map((value) => [value, value]),
    ], state.family)
    setOptions('.candidate-type-filter', [
      ['all', 'Semua tipe'],
      ...types.map((value) => [value, labelCandidateType(value)]),
    ], state.type)
    container.querySelector('.candidate-search').addEventListener('input', (event) => {
      state.search = event.target.value
      renderAll()
    })
    container.querySelector('.candidate-status-filter').addEventListener('change', (event) => {
      state.status = event.target.value
      renderAll()
    })
    container.querySelector('.candidate-family-filter').addEventListener('change', (event) => {
      state.family = event.target.value
      renderAll()
    })
    container.querySelector('.candidate-type-filter').addEventListener('change', (event) => {
      state.type = event.target.value
      renderAll()
    })
    container.querySelector('.candidate-distance-filter').addEventListener('input', (event) => {
      state.maxDistance = Number(event.target.value)
      renderAll()
    })
    container.querySelector('.candidate-score-filter').addEventListener('input', (event) => {
      state.minScore = Number(event.target.value)
      container.querySelector('.score-output').textContent = `${Math.round(state.minScore * 100)}%`
      renderAll()
    })
  }

  function setOptions(selector, entries, selected) {
    container.querySelector(selector).innerHTML = entries.map(([value, label]) => (
      `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${
        escapeHtml(label)
      }</option>`
    )).join('')
  }

  function updateUrl() {
    const query = new URLSearchParams(window.location.search)
    setOrDelete(query, 'datasetId', mapData.activeContext.datasetId)
    setOrDelete(query, 'branchId', mapData.activeContext.branchId)
    setOrDelete(query, 'area', state.area)
    setOrDelete(query, 'reviewCandidateId', state.selectedCandidateId)
    setOrDelete(query, 'status', state.status)
    setOrDelete(query, 'category', state.category === 'all' ? null : state.category)
    setOrDelete(query, 'family', state.family)
    setOrDelete(query, 'type', state.type)
    setOrDelete(query, 'minScore', state.minScore ? state.minScore : null)
    setOrDelete(query, 'maxDistance', state.maxDistance !== 6 ? state.maxDistance : null)
    setOrDelete(query, 'q', state.search)
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`)
  }
}

async function loadReviewProjections(datasetVersionId, mapGeometries = []) {
  const [candidates, graph, summary, sourceFeaturePayload] = await Promise.all([
    loadAllTopologyCandidates({ datasetVersionId }),
    loadTopologyProjection({ datasetVersionId, projection: 'graph' }),
    loadTopologyProjection({ datasetVersionId, projection: 'summary' }),
    loadDatasetProjection({ datasetVersionId, projection: 'source-features' })
      .catch(() => ({ items: [] })),
  ])
  candidates.items = [
    ...(candidates.items ?? []),
    ...(candidates.unresolved ?? []).map((item) => ({
      candidateId: `unresolved:${item.sourceEndpointId}`,
      datasetVersionId,
      candidateType: 'unresolved',
      candidateStatus: 'unresolved',
      proposalStatus: 'no_eligible_candidate',
      sourceEndpointId: item.sourceEndpointId,
      sourcePathAssetId: item.sourcePathAssetId,
      sourceGeometryIds: [item.sourceGeometryId].filter(Boolean),
      sourceCoordinate: item.coordinate,
      targetAssetId: null,
      distanceMeters: null,
      score: 0,
      scoreMargin: null,
      evidence: [{
        source: 'relation_engine',
        explanation: item.reason ?? 'Tidak ada target yang memenuhi eligibility.',
      }],
    })),
  ]
  const sourceFeatureById = new Map(
    (sourceFeaturePayload.items ?? []).map((feature) => [feature.sourceFeatureId, feature]),
  )
  candidates.items = candidates.items.map((candidate) => {
    const sourceFeature = sourceFeatureById.get(candidate.sourceFeatureId)
    const targetFeature = sourceFeatureById.get(candidate.targetFeatureId)
    return {
      ...candidate,
      sourceDisplayName: sourceFeature?.sourceName,
      targetDisplayName: targetFeature?.sourceName,
      sourceLocationKey: sourceFeature?.sourceFolderPath
        ? locationGroupFor(sourceFeature.sourceFolderPath).locationGroupKey
        : null,
      targetLocationKey: targetFeature?.sourceFolderPath
        ? locationGroupFor(targetFeature.sourceFolderPath).locationGroupKey
        : null,
    }
  })
  candidates.items = attachCandidateMapGeometryIds(candidates.items, mapGeometries)
  return { candidates, graph, summary, sourceFeatures: sourceFeaturePayload.items ?? [] }
}

function filterCandidates(items, state, { ignoreCategory = false } = {}) {
  const query = state.search.trim().toLowerCase()
  return prioritizeTopologyCandidates(items).filter((candidate) => {
    const statusMatch = state.status === 'all'
      || (state.status === 'needs-review'
        ? isReviewableCandidate(candidate)
        : candidate.candidateStatus === state.status)
    const categoryMatch = ignoreCategory
      || state.category === 'all'
      || relationCategoryForCandidate(candidate) === state.category
    const familyMatch = state.family === 'all' || candidate.networkFamily === state.family
    const typeMatch = state.type === 'all' || candidate.candidateType === state.type
    const scoreMatch = (candidate.score ?? 0) >= state.minScore
    const distanceMatch = candidate.distanceMeters == null
      || candidate.distanceMeters <= state.maxDistance
    const queryMatch = !query || [
      candidate.candidateId,
      candidate.sourceEndpointId,
      candidate.sourcePathAssetId,
      candidate.sourceDisplayName,
      candidate.targetAssetId,
      candidate.targetPathAssetId,
      candidate.targetDisplayName,
      ...(candidate.sourceGeometryIds ?? []),
    ].filter(Boolean).join(' ').toLowerCase().includes(query)
    return statusMatch && categoryMatch && familyMatch && typeMatch
      && scoreMatch && distanceMatch && queryMatch
  })
}

function renderHistory(candidate, history = [], runs = []) {
  const items = [
    ...(candidate.review ? [{
      label: candidate.review.action ?? 'review',
      timestamp: candidate.review.reviewedAt,
      actor: candidate.review.actorId,
      reason: candidate.review.reason,
    }] : []),
    ...history.filter(({ candidateId }) => candidateId === candidate.candidateId).map((item) => ({
      label: 'superseded',
      timestamp: item.supersededAt,
      actor: item.review?.actorId,
      reason: item.review?.reason,
    })),
    ...runs.slice(-3).map((run) => ({
      label: 'regenerate',
      timestamp: run.generatedAt,
      actor: run.actorId,
      reason: run.reason,
    })),
  ].filter(({ timestamp }) => timestamp)
  if (!items.length) return '<p class="history-empty">Belum ada keputusan review.</p>'
  return `<ol>${items.map((item) => `
    <li><i></i><div><strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(formatTimestamp(item.timestamp))} · ${escapeHtml(item.actor ?? 'system')}</span>
      ${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ''}</div></li>`).join('')}</ol>`
}

function routeEndpoint(label, assetId, reference) {
  return `<div class="route-endpoint">
    <span>${escapeHtml(label)}</span><strong>${escapeHtml(assetId ?? 'Belum ada pasangan')}</strong>
    <small>${escapeHtml(reference ?? 'Referensi endpoint tidak tersedia')}</small>
  </div>`
}

function endpointName(candidate, side, sourceFeatures = []) {
  const isSource = side === 'source'
  const displayName = isSource ? candidate.sourceDisplayName : candidate.targetDisplayName
  if (displayName) return displayName
  const featureId = isSource ? candidate.sourceFeatureId : candidate.targetFeatureId
  const featureName = sourceFeatures.find((feature) => (
    feature.sourceFeatureId === featureId
  ))?.sourceName
  if (featureName) return featureName
  const assetId = isSource
    ? candidate.sourcePathAssetId
    : candidate.targetAssetId ?? candidate.targetPathAssetId
  if (!assetId) return 'Belum ada pasangan'
  return `Aset ${shortReference(assetId)}`
}

function shortReference(value) {
  if (!value) return null
  const text = String(value)
  const meaningful = text.split(':').at(-1)
  return meaningful.length > 12
    ? `…${meaningful.slice(-10)}`
    : meaningful
}

function validCoordinate(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
}

function statusLabel(candidate) {
  if (isBulkConfirmableCandidate(candidate)) return 'Direkomendasikan'
  if (candidate.candidateStatus === 'candidate' && candidate.proposalStatus === 'not_selected') {
    return 'Alternatif tidak dipilih'
  }
  return {
    candidate: 'Perlu ditinjau',
    ambiguous: 'Belum pasti',
    confirmed: 'Terkonfirmasi',
    rejected: 'Tidak terhubung',
    revoked: 'Dibatalkan',
    unresolved: 'Belum ada pasangan',
  }[candidate.candidateStatus] ?? candidate.candidateStatus
}

function renderBulkDialog() {
  return `
    <dialog class="bulk-review-dialog" aria-labelledby="bulk-dialog-title">
      <form>
        <header>
          <span class="material-symbols-outlined bulk-dialog-icon" aria-hidden="true">
            done_all
          </span>
          <div>
            <h2 class="bulk-dialog-title" id="bulk-dialog-title">Konfirmasi semua</h2>
            <p class="bulk-dialog-description"></p>
          </div>
          <button class="icon-button close-bulk-dialog" type="button" aria-label="Tutup dialog">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <label>
          <span class="bulk-reason-label">Catatan konfirmasi</span>
          <textarea class="bulk-review-reason" rows="3"
            placeholder="Tuliskan konteks atau alasan keputusan bulk"></textarea>
        </label>
        <p class="bulk-dialog-message" role="status"></p>
        <footer>
          <button class="button secondary cancel-bulk-action" type="button">Batal</button>
          <button class="button primary submit-bulk-action" type="submit">Konfirmasi semua</button>
        </footer>
      </form>
    </dialog>
  `
}

function renderDecisionDialog() {
  return `
    <dialog class="decision-dialog" aria-labelledby="decision-dialog-title">
      <form>
        <header>
          <span class="material-symbols-outlined decision-dialog-icon" aria-hidden="true">
            rule
          </span>
          <div>
            <h2 class="decision-dialog-title" id="decision-dialog-title">Simpan keputusan</h2>
            <p class="decision-dialog-description"></p>
          </div>
          <button class="icon-button close-decision-dialog" type="button" aria-label="Tutup dialog">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <div class="decision-dialog-fields">
          <label class="decision-target-field" hidden>
            <span>Target pengganti</span>
            <select class="decision-target"></select>
          </label>
          <label>
            <span>Alasan</span>
            <select class="decision-reason-select"></select>
          </label>
          <label>
            <span>Detail tambahan <small>Opsional</small></span>
            <textarea class="decision-details" rows="2"
              placeholder="Tambahkan konteks jika diperlukan"></textarea>
          </label>
        </div>
        <p class="decision-dialog-message" role="status"></p>
        <footer>
          <button class="button secondary cancel-decision" type="button">Batal</button>
          <button class="button primary submit-decision" type="submit">Simpan keputusan</button>
        </footer>
      </form>
    </dialog>
  `
}

function renderManualRelationDialog(assets = []) {
  const options = assets.map((asset) => `
    <option value="${escapeHtml(asset.id)}">${escapeHtml(asset.name ?? 'Aset')} · ${escapeHtml(
      asset.type ?? asset.category ?? 'Device',
    )} · ${escapeHtml(shortReference(asset.id) ?? asset.id)}</option>
  `).join('')
  return `
    <dialog class="decision-dialog manual-relation-dialog" aria-labelledby="manual-relation-title">
      <form>
        <header>
          <span class="material-symbols-outlined decision-dialog-icon" aria-hidden="true">
            add_link
          </span>
          <div>
            <h2 class="decision-dialog-title" id="manual-relation-title">Tambah koneksi antar-device</h2>
            <p class="decision-dialog-description">Pilih dua device yang memang terhubung secara fisik. Kabel atau path tidak dapat dipilih sebagai endpoint.</p>
          </div>
          <button class="icon-button close-manual-relation" type="button" aria-label="Tutup dialog">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <div class="decision-dialog-fields">
          <label>
            <span>Device sumber</span>
            <select class="manual-source-asset" required>${options}</select>
          </label>
          <label>
            <span>Device tujuan</span>
            <select class="manual-target-asset" required>${options}</select>
          </label>
          <label>
            <span>Alasan konfirmasi</span>
            <textarea class="manual-relation-reason" rows="3" minlength="3" required
              placeholder="Contoh: diverifikasi dari dokumentasi dan pengecekan lapangan"></textarea>
          </label>
        </div>
        <p class="decision-dialog-message manual-relation-message" role="status"></p>
        <footer>
          <button class="button secondary cancel-manual-relation" type="button">Batal</button>
          <button class="button primary submit-manual-relation" type="submit">Konfirmasi koneksi</button>
        </footer>
      </form>
    </dialog>
  `
}

function decisionDialogCopy(action) {
  return {
    reject: {
      icon: 'link_off',
      title: 'Tandai tidak terhubung?',
      description: 'Koneksi ini tidak akan dipakai oleh graph dan tracing.',
      submit: 'Tandai tidak terhubung',
      reasons: [
        'Endpoint tidak tersambung',
        'Aset berbeda jaringan',
        'Posisi pada data sumber salah',
        'Hasil verifikasi lapangan',
        'Lainnya',
      ],
    },
    'select-target': {
      icon: 'swap_horiz',
      title: 'Pilih target pengganti',
      description: 'Target baru akan dikonfirmasi dan kandidat sebelumnya ditutup.',
      submit: 'Gunakan target ini',
      reasons: [
        'Target sesuai kondisi lapangan',
        'Target sesuai dokumentasi',
        'Target sebelumnya salah',
        'Lainnya',
      ],
    },
    revoke: {
      icon: 'undo',
      title: 'Batalkan koneksi?',
      description: 'Koneksi akan dikeluarkan dari graph dan tidak dipakai untuk tracing.',
      submit: 'Batalkan koneksi',
      reasons: [
        'Konfirmasi sebelumnya salah',
        'Data aset berubah',
        'Hasil verifikasi lapangan',
        'Lainnya',
      ],
    },
  }[action]
}

function renderReadiness(summary, locationCandidates = null) {
  const hasLocationScope = Array.isArray(locationCandidates)
  const openCount = hasLocationScope
    ? locationCandidates.filter(isReviewableCandidate).length
    : summary.summary?.ambiguousCount ?? 0
  const readiness = hasLocationScope
    ? (openCount ? 'not_ready' : 'ready')
    : summary.readiness?.topologyReadiness ?? 'not_ready'
  return `<div class="review-readiness ${readiness}">
    <span class="material-symbols-outlined">${readiness === 'ready' ? 'verified' : 'pending_actions'}</span>
    <div><strong>${readiness === 'ready' ? 'Site ini selesai' : 'Perlu peninjauan'}</strong>
    <small>${readiness === 'ready'
      ? 'Tidak ada koneksi yang tertunda'
      : `${openCount} koneksi di site ini`}</small></div>
  </div>`
}

function isBulkConfirmableCandidate(candidate) {
  return candidate.candidateStatus === 'candidate'
    && candidate.proposalStatus === 'recommended'
}

function isReviewableCandidate(candidate) {
  return isBulkConfirmableCandidate(candidate)
    || ['ambiguous', 'unresolved'].includes(candidate.candidateStatus)
}

function isLineLabelConfirmableCandidate(candidate) {
  return isBulkConfirmableCandidate(candidate)
    && ['line_label_connection', 'line_label_attachment'].includes(candidate.candidateType)
}

function reviewState(icon, title, message, loading = false) {
  return `<div class="map-app">${renderTopNavigation('review')}
    <main class="review-page-state" aria-busy="${loading}">
      <span class="material-symbols-outlined${loading ? ' spin' : ''}">${icon}</span>
      <h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
      ${loading ? '' : '<button class="button primary retry-review">Coba lagi</button>'}
    </main></div>`
}

function detailRow(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
}

function componentLabel(value) {
  return String(value).replaceAll(/([A-Z])/g, ' $1').replaceAll('_', ' ').trim()
}

function labelCandidateType(value) {
  return {
    endpoint_device: 'Endpoint ke perangkat',
    inline_device: 'Perangkat inline',
    endpoint_endpoint: 'Gap antar endpoint',
    intersection_with_junction: 'Intersection dengan junction',
    line_label_connection: 'Koneksi dari nama garis',
    line_label_attachment: 'Endpoint kabel dari nama garis',
    explicit_metadata: 'Metadata eksplisit',
    unresolved: 'Endpoint belum terhubung',
  }[value] ?? value
}

function actionSuccessMessage(action) {
  return {
    confirm: 'Candidate dikonfirmasi. Confirmed graph dan tracing sudah diperbarui.',
    reject: 'Candidate ditolak dan tidak masuk graph operasional.',
    skip: 'Candidate dilewati dan tetap di luar graph operasional.',
    'select-target': 'Target alternatif dikonfirmasi; kandidat lama ditutup.',
  }[action]
}

function canConfirm(candidate) {
  return ['candidate', 'ambiguous', 'revoked'].includes(candidate?.candidateStatus)
}

function canReject(candidate) {
  return ['candidate', 'ambiguous'].includes(candidate.candidateStatus)
}

function canSkip(candidate) {
  return ['candidate', 'ambiguous'].includes(candidate.candidateStatus)
}

function formatDistance(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} m` : 'Metadata eksplisit'
}

function formatTimestamp(value) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort()
}

function readContext() {
  const params = new URLSearchParams(window.location.search)
  return {
    datasetId: params.get('datasetId')
      || window.sessionStorage.getItem('sinergiActiveDatasetId')
      || 'dataset-semarang',
    branchId: params.get('branchId')
      || window.sessionStorage.getItem('sinergiActiveBranchId')
      || 'semarang',
  }
}

function setOrDelete(params, key, value) {
  if (value !== null && value !== undefined && value !== '') params.set(key, value)
  else params.delete(key)
}

function formatLocationName(value) {
  const source = String(value ?? '').trim()
  if (!source || source !== source.toUpperCase()) return source.replaceAll(' - ', ' — ')
  const acronyms = new Set(['DPPU', 'FT', 'ICT', 'ITC', 'LPG', 'SSC', 'YIA'])
  return source
    .split(/\s+/)
    .map((word) => (
      acronyms.has(word)
        ? word
        : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
    ))
    .join(' ')
    .replaceAll(' - ', ' — ')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
