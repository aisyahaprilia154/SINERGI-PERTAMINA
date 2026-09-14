import {
  loadTopologyRootAssignments,
  previewTopologyRootAssignments,
  saveTopologyRootAssignments,
} from '../../services/active-dataset-service.js'
import { bindUserAccountMenu, renderTopNavigation } from '../map/map-page.js'

export async function initializeRootReview(container, mapData) {
  const datasetVersionId = mapData.activeContext.datasetVersionId
  const params = new URLSearchParams(window.location.search)
  const state = {
    area: params.get('area') ?? mapData.locationGroups[0]?.key ?? 'all',
    response: null,
    decisions: new Map(),
    preview: null,
    reason: 'Koreksi pusat JB dan zona topology dari halaman administrator.',
    busy: false,
    message: '',
    error: '',
  }

  container.innerHTML = shell(mapData, state)
  bindUserAccountMenu()
  bindEvents()
  await reload()

  function bindEvents() {
    container.addEventListener('change', (event) => {
      if (event.target.matches('[data-root-area]')) {
        state.area = event.target.value
        state.decisions.clear()
        state.preview = null
        syncUrl()
        void reload()
        return
      }
      const assetId = event.target.dataset.rootToggle
      if (assetId) {
        const candidate = candidateById(assetId)
        const checked = event.target.checked
        setDecision(assetId, checked ? {
          action: 'promote',
          zoneKey: candidate.rootZoneKey || defaultZone(candidate),
          aliases: candidate.aliases ?? [],
        } : { action: 'demote' })
      }
    })
    container.addEventListener('input', (event) => {
      const zoneAssetId = event.target.dataset.rootZone
      const aliasesAssetId = event.target.dataset.rootAliases
      if (zoneAssetId) {
        const candidate = candidateById(zoneAssetId)
        setDecision(zoneAssetId, {
          action: 'promote',
          zoneKey: event.target.value,
          aliases: currentDecision(zoneAssetId)?.aliases ?? candidate.aliases ?? [],
        }, false)
      }
      if (aliasesAssetId) {
        const candidate = candidateById(aliasesAssetId)
        setDecision(aliasesAssetId, {
          action: 'promote',
          zoneKey: currentDecision(aliasesAssetId)?.zoneKey
            ?? candidate.rootZoneKey
            ?? defaultZone(candidate),
          aliases: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
        }, false)
      }
      if (event.target.matches('[data-root-reason]')) state.reason = event.target.value
    })
    container.addEventListener('click', (event) => {
      const resetId = event.target.closest('[data-root-reset]')?.dataset.rootReset
      if (resetId) {
        setDecision(resetId, { action: 'reset' })
        return
      }
      if (event.target.closest('[data-root-preview]')) void preview()
      if (event.target.closest('[data-root-save]')) void save()
      if (event.target.closest('[data-root-reload]')) void reload()
    })
  }

  async function reload() {
    state.busy = true
    state.error = ''
    renderStatus()
    try {
      state.response = await loadTopologyRootAssignments({
        datasetVersionId,
        area: state.area === 'all' ? null : state.area,
      })
      state.decisions.clear()
      state.preview = null
      state.message = `${state.response.summary.rootCount} pusat JB aktif.`
    } catch (error) {
      state.error = error.message
    } finally {
      state.busy = false
      render()
    }
  }

  async function preview() {
    const decisions = decisionList()
    if (!decisions.length || state.busy) return
    state.busy = true
    state.error = ''
    renderStatus()
    try {
      state.preview = await previewTopologyRootAssignments({
        datasetVersionId,
        decisions,
        expectedRecordRevision: state.response.recordRevision,
      })
      state.message = 'Preview siap. Graph operasional tidak berubah.'
    } catch (error) {
      state.error = error.message
      state.preview = null
    } finally {
      state.busy = false
      render()
    }
  }

  async function save() {
    const decisions = decisionList()
    if (!decisions.length || state.busy) return
    if (!state.preview) await preview()
    if (!state.preview || state.error) return
    state.busy = true
    state.error = ''
    renderStatus()
    try {
      await saveTopologyRootAssignments({
        datasetVersionId,
        decisions,
        reason: state.reason,
        expectedRecordRevision: state.response.recordRevision,
        idempotencyKey: `root:${datasetVersionId}:${Date.now()}`,
      })
      state.message = 'Keputusan pusat JB tersimpan dan regenerasi topology dijadwalkan.'
      await reload()
    } catch (error) {
      state.error = error.message
      state.busy = false
      render()
    }
  }

  function setDecision(assetId, value, rerender = true) {
    state.decisions.set(assetId, { assetId, ...value })
    state.preview = null
    if (rerender) render()
    else renderActions()
  }

  function decisionList() {
    return [...state.decisions.values()].map((item) => ({
      assetId: item.assetId,
      action: item.action,
      ...(item.action === 'promote' ? {
        zoneKey: item.zoneKey,
        aliases: item.aliases ?? [],
      } : {}),
    }))
  }

  function candidateById(assetId) {
    return (state.response?.candidates ?? []).find((item) => item.assetId === assetId) ?? {}
  }

  function currentDecision(assetId) {
    return state.decisions.get(assetId) ?? null
  }

  function render() {
    container.querySelector('[data-root-list]').innerHTML = renderCandidates()
    container.querySelector('[data-root-preview-panel]').innerHTML = renderPreview()
    renderActions()
    renderStatus()
  }

  function renderActions() {
    const count = state.decisions.size
    const target = container.querySelector('[data-root-actions]')
    if (!target) return
    target.innerHTML = `
      <span>${count} perubahan</span>
      <button type="button" class="secondary-button" data-root-preview ${!count || state.busy ? 'disabled' : ''}>Preview</button>
      <button type="button" class="primary-button" data-root-save ${!count || !state.preview || state.busy ? 'disabled' : ''}>Simpan</button>
    `
  }

  function renderStatus() {
    const target = container.querySelector('[data-root-status]')
    if (!target) return
    target.className = `root-review-status${state.error ? ' error' : ''}`
    target.textContent = state.busy
      ? 'Memproses…'
      : state.error || state.message || 'Siap.'
  }

  function renderCandidates() {
    const candidates = state.response?.candidates ?? []
    if (!candidates.length) return '<p class="root-review-empty">Tidak ada kandidat JB Server pada cabang ini.</p>'
    return candidates.map((candidate) => {
      const decision = currentDecision(candidate.assetId)
      const root = decision?.action === 'promote'
        || (!decision && candidate.topologyRole === 'root')
      const zone = decision?.zoneKey ?? candidate.rootZoneKey ?? defaultZone(candidate)
      const aliases = decision?.aliases ?? candidate.aliases ?? []
      return `
        <article class="root-review-card${root ? ' is-root' : ''}">
          <div class="root-review-card-heading">
            <label class="root-review-toggle">
              <input type="checkbox" data-root-toggle="${escapeAttribute(candidate.assetId)}" ${root ? 'checked' : ''}>
              <span>${root ? 'Pusat JB aktif' : 'JB biasa'}</span>
            </label>
            ${candidate.override ? `<button type="button" class="root-review-reset" data-root-reset="${escapeAttribute(candidate.assetId)}">Reset override</button>` : ''}
          </div>
          <h3>${escapeHtml(candidate.sourceName || candidate.assetId)}</h3>
          <p>${escapeHtml(candidate.areaName)} · ${escapeHtml(candidate.assignmentSource || 'kandidat')}</p>
          <div class="root-review-fields">
            <label>Zona<input data-root-zone="${escapeAttribute(candidate.assetId)}" value="${escapeAttribute(zone)}" ${root ? '' : 'disabled'}></label>
            <label>Alias jalur<input data-root-aliases="${escapeAttribute(candidate.assetId)}" value="${escapeAttribute(aliases.join(', '))}" ${root ? '' : 'disabled'}></label>
          </div>
          <small>ID stabil: ${escapeHtml(candidate.stableAssetId || 'belum tersedia')}</small>
        </article>
      `
    }).join('')
  }

  function renderPreview() {
    if (!state.preview) {
      const stale = state.response?.reviewItems ?? []
      return `
        <div class="root-review-placeholder">
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
          <strong>Preview hierarki</strong>
          <p>Perubahan root hanya mengubah proyeksi visual sampai relasi kabel terkonfirmasi.</p>
          ${stale.length ? `<p class="root-review-warning">${stale.length} override lama perlu direview karena stable ID tidak ditemukan.</p>` : ''}
        </div>
      `
    }
    const next = state.preview.next
    const gaps = state.preview.presentation?.backboneGaps?.length ?? 0
    const unmapped = state.preview.presentation?.unmappedAssetIds?.length ?? 0
    return `
      <div class="root-review-preview-summary">
        <h2>Hasil preview</h2>
        <dl>
          <div><dt>Cabang</dt><dd>${next.areaCount}</dd></div>
          <div><dt>Pusat JB</dt><dd>${next.rootCount}</dd></div>
          <div><dt>Garis visual</dt><dd>${gaps}</dd></div>
          <div><dt>Belum terpetakan</dt><dd>${unmapped}</dd></div>
        </dl>
        <p>Garis visual tidak masuk tracing, impact analysis, atau jumlah relasi confirmed.</p>
      </div>
    `
  }

  function syncUrl() {
    const url = new URL(window.location.href)
    url.searchParams.set('mode', 'roots')
    url.searchParams.set('area', state.area)
    window.history.replaceState({}, '', url)
  }
}

function shell(mapData, state) {
  const groups = [{ key: 'all', name: 'Semua cabang' }, ...mapData.locationGroups]
  return `
    <div class="map-app review-app root-review-app">
      ${renderTopNavigation('review', mapData.activeContext)}
      <header class="review-header">
        <div class="review-title"><h1>Pusat JB</h1><p>Atur root dan zona tanpa membuat relasi operasional palsu.</p></div>
        <nav class="review-mode-switch" aria-label="Mode review"><a href="/admin/topology-review">Sambungan jaringan</a><a href="/admin/topology-review?mode=mounting">Mounting fisik</a><a class="active" href="/admin/topology-review?mode=roots">Pusat JB</a></nav>
        <label class="site-picker"><span>Cabang</span><span class="site-picker-control"><select data-root-area>${groups.map((group) => `<option value="${escapeAttribute(group.key)}" ${group.key === state.area ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}</select></span></label>
        <div data-root-actions class="root-review-actions"></div>
      </header>
      <main class="root-review-workspace">
        <section class="root-review-list-panel">
          <div class="root-review-list-toolbar"><label>Alasan perubahan<input data-root-reason value="${escapeAttribute(state.reason)}"></label><button type="button" class="secondary-button" data-root-reload>Reload</button></div>
          <div data-root-status class="root-review-status"></div>
          <div data-root-list class="root-review-list"></div>
        </section>
        <aside data-root-preview-panel class="root-review-preview"></aside>
      </main>
    </div>
  `
}

function defaultZone(candidate) {
  const name = String(candidate.sourceName ?? '').toLowerCase()
  if (name.includes('utara')) return 'utara'
  if (name.includes('selatan')) return 'selatan'
  if (/\bcr\b/.test(name)) return 'cr'
  return 'utama'
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]))
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#096;')
}
