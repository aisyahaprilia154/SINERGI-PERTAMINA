import {
  loadMountingReview,
  previewMountingRegeneration,
  queueMountingRegeneration,
  reviewMountingBulk,
  setMountingExpectation,
  setMountingRelation,
} from '../../services/active-dataset-service.js'
import { bindUserAccountMenu, renderTopNavigation } from '../map/map-page.js'

const QUEUES = Object.freeze([
  { id: 'ready', label: 'Siap otomatis / diterapkan' },
  { id: 'needs-choice', label: 'Perlu pilih tiang' },
  { id: 'no-nearby', label: 'Tanpa pole terdekat' },
  { id: 'needs-classification', label: 'Perlu klasifikasi' },
  { id: 'excluded', label: 'Indoor / standalone' },
])

export async function initializeMountingReview(container, mapData) {
  const datasetVersionId = mapData.activeContext.datasetVersionId
  const params = new URLSearchParams(window.location.search)
  const requestedArea = params.get('area')
  const state = {
    area: requestedArea === 'all' || mapData.locationGroups.some(({ key }) => key === requestedArea)
      ? requestedArea
      : 'all',
    queue: QUEUES.some(({ id }) => id === params.get('queue')) ? params.get('queue') : 'needs-choice',
    search: params.get('q') ?? '',
    selectedIds: new Set(),
    activeId: null,
    poleSearch: '',
    review: null,
    preview: null,
    busy: false,
    message: '',
    error: '',
  }

  container.innerHTML = shell(mapData, state)
  bindUserAccountMenu()
  bindEvents()
  await reload()

  function bindEvents() {
    container.addEventListener('click', (event) => {
      const queue = event.target.closest('[data-mounting-queue]')?.dataset.mountingQueue
      if (queue) {
        state.queue = queue
        state.selectedIds.clear()
        render()
        syncUrl()
        return
      }
      const row = event.target.closest('[data-mounting-item]')?.dataset.mountingItem
      if (row) {
        state.activeId = row
        render()
        return
      }
      const expectation = event.target.closest('[data-set-expectation]')?.dataset.setExpectation
      if (expectation) {
        void updateExpectation(state.activeId, expectation)
        return
      }
      const bulkExpectation = event.target.closest('[data-bulk-expectation]')?.dataset.bulkExpectation
      if (bulkExpectation) {
        void updateBulkExpectation(bulkExpectation)
        return
      }
      const poleId = event.target.closest('[data-assign-pole]')?.dataset.assignPole
      if (poleId) {
        void assignPole(state.activeId, poleId)
        return
      }
      if (event.target.closest('[data-preview-mounting]')) void runPreview()
      if (event.target.closest('[data-apply-mounting]')) void applyPreview()
      if (event.target.closest('[data-reload-mounting]')) void reload()
    })
    container.addEventListener('change', (event) => {
      if (event.target.matches('[data-mounting-area]')) {
        state.area = event.target.value
        state.selectedIds.clear()
        void reload()
      }
      if (event.target.matches('[data-mounting-select]')) {
        const id = event.target.dataset.mountingSelect
        if (event.target.checked) state.selectedIds.add(id)
        else state.selectedIds.delete(id)
        renderBulkBar()
      }
    })
    container.addEventListener('input', (event) => {
      if (event.target.matches('[data-mounting-search]')) {
        state.search = event.target.value
        render()
        syncUrl()
      }
      if (event.target.matches('[data-pole-search]')) {
        state.poleSearch = event.target.value
        renderDetail()
        const input = container.querySelector('[data-pole-search]')
        input?.focus()
        input?.setSelectionRange(input.value.length, input.value.length)
      }
    })
  }

  async function reload() {
    state.busy = true
    state.error = ''
    renderStatus()
    try {
      state.review = await loadMountingReview({
        datasetVersionId,
        area: state.area === 'all' ? null : state.area,
        limit: 1000,
      })
      const visible = filteredItems()
      if (!visible.some(({ assetId }) => assetId === state.activeId)) {
        state.activeId = visible[0]?.assetId ?? state.review.items[0]?.assetId ?? null
      }
      state.selectedIds = new Set([...state.selectedIds].filter((id) => (
        state.review.items.some(({ assetId }) => assetId === id)
      )))
      state.message = 'Antrean mounting sudah diperbarui.'
    } catch (error) {
      state.error = error.message
    } finally {
      state.busy = false
      render()
      syncUrl()
    }
  }

  function filteredItems() {
    const search = state.search.trim().toLocaleLowerCase('id')
    return (state.review?.items ?? []).filter((item) => (
      queueFor(item) === state.queue
        && (!search || `${item.assetName} ${item.assetId}`.toLocaleLowerCase('id').includes(search))
    ))
  }

  async function updateExpectation(assetId, expectation) {
    if (!assetId || state.busy) return
    await mutate(() => setMountingExpectation({
      datasetVersionId,
      assetId,
      expectation,
      reason: `Klasifikasi mounting ${expectation} dari halaman review.`,
      expectedRecordRevision: state.review.recordRevision,
      idempotencyKey: mutationKey('expectation'),
    }), 'Klasifikasi mounting disimpan.')
  }

  async function updateBulkExpectation(expectation) {
    const ids = [...state.selectedIds].slice(0, 200)
    if (!ids.length || state.busy) return
    await mutate(() => reviewMountingBulk({
      datasetVersionId,
      decisions: ids.map((assetId) => ({
        action: 'set_expectation',
        assetId,
        expectation,
      })),
      reason: `Bulk classification mounting menjadi ${expectation}.`,
      expectedRecordRevision: state.review.recordRevision,
      idempotencyKey: mutationKey('bulk-expectation'),
    }), `${ids.length} aset berhasil diklasifikasikan.`)
    state.selectedIds.clear()
  }

  async function assignPole(assetId, poleAssetId) {
    if (!assetId || !poleAssetId || state.busy) return
    await mutate(() => setMountingRelation({
      datasetVersionId,
      assetId,
      poleAssetId,
      action: 'assign',
      reason: 'Tiang dipilih manual dari antrean mounting fisik.',
      expectedRecordRevision: state.review.recordRevision,
      idempotencyKey: mutationKey('assign-pole'),
    }), 'Tiang berhasil ditetapkan.')
  }

  async function mutate(operation, successMessage) {
    state.busy = true
    state.error = ''
    renderStatus()
    try {
      await operation()
      state.message = successMessage
      await reload()
    } catch (error) {
      state.error = error.message
      state.busy = false
      render()
    }
  }

  async function runPreview() {
    if (state.busy) return
    state.busy = true
    state.error = ''
    renderStatus()
    try {
      state.preview = await previewMountingRegeneration({ datasetVersionId })
      state.message = state.preview.integrity?.valid
        ? 'Preview lolos pemeriksaan integritas dan siap diterapkan.'
        : 'Preview belum aman diterapkan.'
    } catch (error) {
      state.preview = null
      state.error = error.message
    } finally {
      state.busy = false
      render()
    }
  }

  async function applyPreview() {
    if (!state.preview?.integrity?.valid || state.busy) return
    state.busy = true
    state.error = ''
    renderStatus()
    try {
      const applied = await queueMountingRegeneration({
        datasetVersionId,
        expectedRecordRevision: state.preview.expectedRecordRevision,
        reason: 'Penerapan preview mounting fisik 25 meter yang lolos integritas.',
        idempotencyKey: mutationKey('apply-preview'),
      })
      state.message = `Regenerasi mounting diterapkan. ${number(applied.delta?.addedCount)} relasi baru.`
      state.preview = null
    } catch (error) {
      state.error = error.message
    } finally {
      state.busy = false
      render()
    }
  }

  function render() {
    renderSummary()
    renderQueues()
    renderList()
    renderDetail()
    renderBulkBar()
    renderPreview()
    renderStatus()
  }

  function renderSummary() {
    const target = container.querySelector('[data-mounting-summary]')
    if (!target) return
    const summary = state.review?.mountingSummary ?? {}
    const counts = summary.reviewStatusCounts ?? {}
    target.innerHTML = [
      ['Mounted', counts.mounted ?? summary.relationCount ?? 0],
      ['Ambiguous', counts.ambiguous ?? summary.ambiguousAssetCount ?? 0],
      ['Tanpa pole ≤25 m', counts['no-nearby-pole'] ?? 0],
      ['Indoor', counts.indoor ?? 0],
      ['Standalone', counts.standalone ?? 0],
    ].map(([label, value]) => `<div><strong>${number(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('')
  }

  function renderQueues() {
    const target = container.querySelector('[data-mounting-queues]')
    if (!target) return
    const all = state.review?.items ?? []
    target.innerHTML = QUEUES.map((queue) => {
      const count = all.filter((item) => queueFor(item) === queue.id).length
      return `<button type="button" class="${state.queue === queue.id ? 'active' : ''}"
        data-mounting-queue="${queue.id}"><span>${escapeHtml(queue.label)}</span><b>${count}</b></button>`
    }).join('')
  }

  function renderList() {
    const target = container.querySelector('[data-mounting-list]')
    if (!target) return
    const items = filteredItems()
    target.innerHTML = items.length ? items.map((item) => `
      <article class="mounting-review-row ${state.activeId === item.assetId ? 'active' : ''}"
        data-mounting-item="${escapeAttribute(item.assetId)}">
        <input type="checkbox" data-mounting-select="${escapeAttribute(item.assetId)}"
          ${state.selectedIds.has(item.assetId) ? 'checked' : ''} aria-label="Pilih ${escapeAttribute(item.assetName)}">
        <div><strong>${escapeHtml(item.assetName)}</strong><small>${escapeHtml(item.assetId)}</small></div>
        <span class="mounting-review-status ${escapeAttribute(item.reviewStatus)}">${escapeHtml(statusLabel(item))}</span>
        ${item.warnings?.length ? '<span class="material-symbols-outlined warning" title="Ada warning">warning</span>' : ''}
      </article>
    `).join('') : '<div class="mounting-review-empty">Tidak ada aset pada antrean dan filter ini.</div>'
  }

  function renderDetail() {
    const target = container.querySelector('[data-mounting-detail]')
    if (!target) return
    const item = state.review?.items?.find(({ assetId }) => assetId === state.activeId)
    if (!item) {
      target.innerHTML = '<div class="mounting-review-empty">Pilih aset untuk melihat evidence dan opsi tiang.</div>'
      return
    }
    const search = state.poleSearch.trim().toLocaleLowerCase('id')
    const poles = (state.review?.poles ?? []).filter((pole) => (
      String(pole.areaKey ?? '').toLocaleLowerCase('id')
        === String(item.areaKey ?? '').toLocaleLowerCase('id')
      && (!search || `${pole.name} ${pole.assetId}`.toLocaleLowerCase('id').includes(search))
    ))
    target.innerHTML = `
      <header><div><span>Detail mounting</span><h2>${escapeHtml(item.assetName)}</h2><small>${escapeHtml(item.assetId)}</small></div>
        <span class="mounting-review-status ${escapeAttribute(item.reviewStatus)}">${escapeHtml(statusLabel(item))}</span></header>
      <dl class="mounting-review-facts">
        <div><dt>Ekspektasi</dt><dd>${escapeHtml(expectationLabel(item.mountingExpectation))}</dd></div>
        <div><dt>Provenance</dt><dd>${escapeHtml(item.expectationProvenance ?? '—')}</dd></div>
        <div><dt>Tiang aktif</dt><dd>${escapeHtml(item.targetAssetId ?? 'Belum ditentukan')}</dd></div>
        <div><dt>Jarak</dt><dd>${formatDistance(item.distanceMeters)}</dd></div>
      </dl>
      ${item.warnings?.length ? `<div class="mounting-review-warnings">${item.warnings.map((warning) => `
        <p><span class="material-symbols-outlined">warning</span>${escapeHtml(warningLabel(warning))}</p>
      `).join('')}</div>` : ''}
      <section><h3>Klasifikasi fisik</h3><div class="mounting-review-classify">
        ${['pole', 'indoor', 'standalone', 'unknown'].map((expectation) => `
          <button type="button" data-set-expectation="${expectation}"
            class="${item.mountingExpectation === expectation ? 'active' : ''}" ${state.busy ? 'disabled' : ''}>
            ${escapeHtml(expectationLabel(expectation))}
          </button>`).join('')}
      </div></section>
      <section><h3>Pilih seluruh tiang dalam area</h3>
        <label class="mounting-review-pole-search"><span class="material-symbols-outlined">search</span>
          <input type="search" data-pole-search value="${escapeAttribute(state.poleSearch)}" placeholder="Cari nama atau ID tiang"></label>
        <div class="mounting-review-poles">${poles.length ? poles.map((pole) => `
          <button type="button" data-assign-pole="${escapeAttribute(pole.assetId)}" ${state.busy ? 'disabled' : ''}>
            <span class="material-symbols-outlined">location_on</span><span><strong>${escapeHtml(pole.name)}</strong><small>${escapeHtml(pole.assetId)}</small></span>
          </button>`).join('') : '<p>Tidak ada tiang yang cocok.</p>'}</div>
      </section>
    `
  }

  function renderBulkBar() {
    const target = container.querySelector('[data-mounting-bulk]')
    if (!target) return
    const count = state.selectedIds.size
    target.hidden = count === 0
    target.innerHTML = count ? `<strong>${count} aset dipilih</strong><span>Klasifikasikan:</span>
      ${['pole', 'indoor', 'standalone', 'unknown'].map((expectation) => `
        <button type="button" data-bulk-expectation="${expectation}" ${state.busy ? 'disabled' : ''}>${escapeHtml(expectationLabel(expectation))}</button>
      `).join('')}` : ''
  }

  function renderPreview() {
    const target = container.querySelector('[data-mounting-preview]')
    if (!target) return
    const preview = state.preview
    target.innerHTML = preview ? `
      <div><strong>Preview mounting 25 m</strong><span>Revision ${preview.expectedRecordRevision}</span></div>
      <dl><div><dt>Relasi baru</dt><dd>${number(preview.delta?.addedCount)}</dd></div>
        <div><dt>Retarget</dt><dd>${number(preview.delta?.retargetedCount)}</dd></div>
        <div><dt>Ambiguous</dt><dd>${number(preview.after?.reviewStatusCounts?.ambiguous)}</dd></div>
        <div><dt>Tanpa pole</dt><dd>${number(preview.after?.reviewStatusCounts?.['no-nearby-pole'])}</dd></div></dl>
      <button type="button" data-apply-mounting ${!preview.integrity?.valid || state.busy ? 'disabled' : ''}>Terapkan preview aman</button>
    ` : '<span>Jalankan preview untuk melihat delta sebelum dataset aktif diubah.</span>'
  }

  function renderStatus() {
    const target = container.querySelector('[data-mounting-message]')
    if (!target) return
    target.className = `mounting-review-message ${state.error ? 'error' : state.busy ? 'busy' : ''}`
    target.textContent = state.error || (state.busy ? 'Memproses mounting…' : state.message)
  }

  function syncUrl() {
    const next = new URLSearchParams(window.location.search)
    next.set('mode', 'mounting')
    next.set('area', state.area)
    next.set('queue', state.queue)
    if (state.search) next.set('q', state.search)
    else next.delete('q')
    window.history.replaceState(null, '', `${window.location.pathname}?${next}`)
  }
}

function shell(mapData, state) {
  return `<div class="map-app review-app mounting-review-app">
    ${renderTopNavigation('review', mapData.activeContext)}
    <header class="mounting-review-header"><div><span class="mounting-review-eyebrow">AUDIT TOTAL</span>
      <h1>Mounting fisik</h1><p>Koordinat adalah sumber kebenaran · auto-mount nearest pole unik ≤25 m</p></div>
      <nav class="review-mode-switch" aria-label="Mode review"><a href="/admin/topology-review">Sambungan jaringan</a><a class="active" href="/admin/topology-review?mode=mounting">Mounting fisik</a></nav>
      <label>Area<select data-mounting-area><option value="all">Semua area</option>${mapData.locationGroups.map(({ key, name }) => `
        <option value="${escapeAttribute(key)}" ${state.area === key ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label>
      <div class="mounting-review-actions"><button type="button" data-reload-mounting>Refresh audit</button><button class="primary" type="button" data-preview-mounting>Preview regenerasi</button></div>
    </header>
    <div class="mounting-review-summary" data-mounting-summary></div>
    <main class="mounting-review-workspace"><aside><div class="mounting-review-queues" data-mounting-queues></div>
      <label class="mounting-review-search"><span class="material-symbols-outlined">search</span><input type="search" data-mounting-search value="${escapeAttribute(state.search)}" placeholder="Cari aset"></label>
      <div class="mounting-review-list" data-mounting-list></div></aside>
      <section class="mounting-review-detail" data-mounting-detail></section></main>
    <div class="mounting-review-preview" data-mounting-preview></div>
    <div class="mounting-review-bulk" data-mounting-bulk hidden></div>
    <div class="mounting-review-message" data-mounting-message></div>
  </div>`
}

function queueFor(item) {
  if (['indoor', 'standalone'].includes(item.reviewStatus)) return 'excluded'
  if (item.reviewStatus === 'mounted') return 'ready'
  if (item.reviewStatus === 'no-nearby-pole') return 'no-nearby'
  if (item.reviewStatus === 'ambiguous') return 'needs-choice'
  if (item.mountingExpectation === 'unknown') return 'needs-classification'
  return 'needs-choice'
}

function statusLabel(item) {
  return ({
    mounted: item.provenance === 'manual_admin' ? 'Mounted manual' : 'Mounted otomatis',
    ambiguous: 'Perlu pilih tiang',
    'no-nearby-pole': 'Tanpa pole ≤25 m',
    indoor: 'Indoor',
    standalone: 'Standalone',
  })[item.reviewStatus] ?? item.reviewStatus
}

function expectationLabel(value) {
  return ({ pole: 'Tiang', indoor: 'Indoor', standalone: 'Standalone', unknown: 'Belum diketahui' })[value] ?? value
}

function warningLabel(value) {
  return ({
    number_coordinate_mismatch: 'Nomor aset berbeda dari nomor tiang; koordinat tetap dipakai.',
    invalid_coordinate: 'Koordinat aset tidak valid atau tidak tersedia.',
    manual_detach: 'Aset dilepas manual dan tidak akan di-auto-mount.',
  })[value] ?? value
}

function formatDistance(value) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${numeric.toLocaleString('id-ID', { maximumFractionDigits: 2 })} m` : '—'
}

function number(value) {
  return (Number(value) || 0).toLocaleString('id-ID')
}

function mutationKey(action) {
  return `mounting-review:${action}:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function escapeAttribute(value) {
  return escapeHtml(value)
}
