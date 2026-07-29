import { adaptActiveDatasetForMap } from '../../adapters/active-dataset-map-adapter.js'
import { prioritizeTopologyCandidates } from '../../domain/topology-view-model.js'
import {
  loadActiveDataset,
  loadTopologyProjection,
  reviewTopologyCandidate,
  revokeTopologyRelation,
} from '../../services/active-dataset-service.js'
import { renderTopNavigation } from '../map/map-page.js'

export async function renderTopologyReviewPage(container) {
  document.title = 'Review Relasi Topology — SINERGI'
  document.body.className = 'map-body topology-review-body'
  container.innerHTML = reviewState('progress_activity', 'Memuat candidate review',
    'Queue dan evidence topology sedang disiapkan.', true)

  const requested = readContext()
  try {
    const activePayload = await loadActiveDataset(requested)
    const mapData = adaptActiveDatasetForMap(activePayload)
    await initializeReview(container, mapData)
  } catch (error) {
    container.innerHTML = reviewState('error', 'Candidate review tidak dapat dimuat', error.message)
    container.querySelector('.retry-review')?.addEventListener('click', () => {
      renderTopologyReviewPage(container)
    })
  }
}

async function initializeReview(container, mapData) {
  const datasetVersionId = mapData.activeContext.datasetVersionId
  let projections = await loadReviewProjections(datasetVersionId)
  const params = new URLSearchParams(window.location.search)
  const state = {
    selectedCandidateId: params.get('reviewCandidateId'),
    status: params.get('status') ?? 'open',
    family: params.get('family') ?? 'all',
    type: params.get('type') ?? 'all',
    minScore: Number(params.get('minScore') ?? 0),
    maxDistance: Number(params.get('maxDistance') ?? 6),
    search: params.get('q') ?? '',
    actionStatus: 'idle',
    actionMessage: '',
  }
  if (!projections.candidates.items.some(({ candidateId }) => (
    candidateId === state.selectedCandidateId
  ))) {
    state.selectedCandidateId = filterCandidates(projections.candidates.items, state)[0]?.candidateId
      ?? null
  }

  container.innerHTML = `
    <div class="map-app review-app">
      ${renderTopNavigation('review')}
      <header class="review-header">
        <div>
          <a href="/topology?datasetId=${encodeURIComponent(mapData.activeContext.datasetId)}"
            class="back-link">
            <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
            Topologi Cabang
          </a>
          <h1>Review Relasi Topology</h1>
          <p>${escapeHtml(mapData.activeContext.branchName)} · ${
            escapeHtml(mapData.activeContext.version)
          }</p>
        </div>
        ${renderReadiness(projections.summary)}
      </header>
      <main class="review-workspace">
        <aside class="candidate-queue" aria-label="Candidate queue">
          <div class="queue-summary"></div>
          <div class="queue-filters">
            <label>
              <span>Cari</span>
              <input class="candidate-search" type="search" value="${escapeHtml(state.search)}"
                placeholder="Asset, endpoint, geometry">
            </label>
            <div>
              <label><span>Status</span><select class="candidate-status-filter"></select></label>
              <label><span>Family</span><select class="candidate-family-filter"></select></label>
            </div>
            <div>
              <label><span>Tipe candidate</span><select class="candidate-type-filter"></select></label>
              <label><span>Jarak maks.</span>
                <input class="candidate-distance-filter" type="number" min="0" step=".5"
                  value="${state.maxDistance}">
              </label>
            </div>
            <label>
              <span>Score minimum <output class="score-output">${state.minScore.toFixed(2)}</output></span>
              <input class="candidate-score-filter" type="range" min="0" max="1" step=".05"
                value="${state.minScore}">
            </label>
          </div>
          <div class="candidate-list" role="listbox" aria-label="Kandidat relasi"></div>
        </aside>
        <section class="candidate-review-panel" aria-live="polite"></section>
      </main>
    </div>
  `

  bindFilters()
  renderAll()

  function renderAll() {
    const items = filterCandidates(projections.candidates.items, state)
    if (!items.some(({ candidateId }) => candidateId === state.selectedCandidateId)) {
      state.selectedCandidateId = items[0]?.candidateId ?? null
    }
    renderQueue(items)
    renderDetail()
    updateUrl()
  }

  function renderQueue(items) {
    container.querySelector('.queue-summary').innerHTML = `
      <div><strong>${items.length}</strong><span>ditampilkan</span></div>
      <div><strong>${projections.summary.summary?.candidateCount ?? 0}</strong><span>candidate</span></div>
      <div><strong>${projections.summary.summary?.ambiguousCount ?? 0}</strong><span>ambiguous</span></div>
    `
    const list = container.querySelector('.candidate-list')
    if (!items.length) {
      list.innerHTML = `<div class="empty-candidate-list">
        <span class="material-symbols-outlined">filter_alt_off</span>
        <strong>Tidak ada kandidat</strong>
        <p>Ubah filter untuk melihat candidate lainnya.</p>
      </div>`
      return
    }
    list.innerHTML = items.map((candidate) => `
      <button type="button" role="option" class="candidate-card${
        candidate.candidateId === state.selectedCandidateId ? ' selected' : ''
      }" aria-selected="${candidate.candidateId === state.selectedCandidateId}"
        data-candidate-id="${escapeHtml(candidate.candidateId)}">
        <span class="candidate-status ${escapeHtml(candidate.candidateStatus)}">
          ${escapeHtml(candidate.candidateStatus)}
        </span>
        <strong>${escapeHtml(candidate.sourcePathAssetId)}</strong>
        <span class="candidate-arrow" aria-hidden="true">→</span>
        <strong>${escapeHtml(candidate.targetAssetId ?? candidate.targetPathAssetId ?? 'Unresolved')}</strong>
        <small>${escapeHtml(labelCandidateType(candidate.candidateType))} · ${
          formatDistance(candidate.distanceMeters)
        }</small>
        <span class="candidate-score">${Math.round((candidate.score ?? 0) * 100)}%</span>
      </button>
    `).join('')
    list.querySelectorAll('[data-candidate-id]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedCandidateId = button.dataset.candidateId
        state.actionStatus = 'idle'
        state.actionMessage = ''
        renderAll()
      })
    })
  }

  function renderDetail() {
    const panel = container.querySelector('.candidate-review-panel')
    const candidate = projections.candidates.items.find(({ candidateId }) => (
      candidateId === state.selectedCandidateId
    ))
    if (!candidate) {
      panel.innerHTML = `<div class="review-empty">
        <span class="material-symbols-outlined">fact_check</span>
        <h2>Pilih candidate untuk direview</h2>
        <p>Evidence, alternatif target, dan dampak graph akan muncul di sini.</p>
      </div>`
      return
    }
    const alternatives = projections.candidates.items.filter((item) => (
      item.sourceEndpointId === candidate.sourceEndpointId
      && item.candidateId !== candidate.candidateId
      && ['candidate', 'ambiguous', 'revoked'].includes(item.candidateStatus)
    ))
    const relation = projections.graph.confirmedRelations.find(({ candidateId }) => (
      candidate.candidateId === candidateId
    ))
    const impact = graphImpact(candidate, projections.graph.graph)
    panel.innerHTML = `
      <header class="candidate-detail-header">
        <div>
          <span class="candidate-status ${escapeHtml(candidate.candidateStatus)}">
            ${escapeHtml(candidate.candidateStatus)}
          </span>
          <h2>${escapeHtml(labelCandidateType(candidate.candidateType))}</h2>
          <code>${escapeHtml(candidate.candidateId)}</code>
        </div>
        <div class="score-gauge" aria-label="Score ${Math.round((candidate.score ?? 0) * 100)} persen">
          <strong>${Math.round((candidate.score ?? 0) * 100)}%</strong><span>score</span>
        </div>
      </header>
      <section class="candidate-route" aria-label="Usulan relasi">
        ${routeEndpoint('Source cable', candidate.sourcePathAssetId, candidate.sourceEndpointId)}
        <div class="route-connector">
          <span>${formatDistance(candidate.distanceMeters)}</span>
          <i></i>
          <small>margin ${formatNumber(candidate.scoreMargin)}</small>
        </div>
        ${routeEndpoint('Target asset', candidate.targetAssetId ?? candidate.targetPathAssetId,
          candidate.targetEndpointId)}
      </section>
      <section class="impact-summary">
        <h3>Dampak jika dikonfirmasi</h3>
        <div>
          <span><strong>${impact.sourceComponentSize}</strong> source component</span>
          <span><strong>${impact.targetComponentSize}</strong> target component</span>
          <span><strong>${impact.mergeDelta}</strong> estimasi node tergabung</span>
        </div>
        <p>Graph operasional baru berubah setelah aksi konfirmasi berhasil.</p>
      </section>
      <div class="evidence-grid">
        <section>
          <h3>Evidence dan scoring</h3>
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
          <h3>Source references</h3>
          <dl class="source-reference-list">
            ${detailRow('Geometry', (candidate.sourceGeometryIds ?? []).join(', ') || '—')}
            ${detailRow('Source feature', candidate.sourceFeatureId ?? '—')}
            ${detailRow('Target feature', candidate.targetFeatureId ?? '—')}
            ${detailRow('Endpoint', candidate.sourceEndpointId ?? '—')}
            ${detailRow('Network family', candidate.networkFamily ?? '—')}
            ${detailRow('Rule set', candidate.topologyRuleSetVersion ?? '—')}
          </dl>
          <h3>Alternatif target</h3>
          <select class="alternative-target"${alternatives.length ? '' : ' disabled'}>
            <option value="">${alternatives.length ? 'Pilih alternatif…' : 'Tidak ada alternatif'}</option>
            ${alternatives.map((item) => `
              <option value="${escapeHtml(item.candidateId)}">${
                escapeHtml(item.targetAssetId ?? item.targetPathAssetId)
              } · ${Math.round((item.score ?? 0) * 100)}%</option>`).join('')}
          </select>
        </section>
      </div>
      <section class="review-history">
        <h3>Riwayat keputusan</h3>
        ${renderHistory(candidate, projections.candidates.history, projections.candidates.runs)}
      </section>
      <footer class="review-actions">
        <label>
          <span>Catatan/alasan review</span>
          <textarea class="review-reason" rows="2"
            placeholder="Wajib untuk tolak, pilih aset lain, atau batalkan konfirmasi"></textarea>
        </label>
        ${state.actionMessage ? `<p class="review-action-message ${state.actionStatus}" role="status">${
          escapeHtml(state.actionMessage)
        }</p>` : ''}
        <div>
          <button class="button primary confirm-candidate" type="button"${
            canConfirm(candidate) ? '' : ' disabled'
          }>Konfirmasi</button>
          <button class="button secondary select-alternative" type="button"${
            alternatives.length ? '' : ' disabled'
          }>Pilih aset lain</button>
          <button class="button danger reject-candidate" type="button"${
            canReject(candidate) ? '' : ' disabled'
          }>Tolak</button>
          <button class="button secondary skip-candidate" type="button"${
            canSkip(candidate) ? '' : ' disabled'
          }>Lewati</button>
          <button class="button danger-outline revoke-relation" type="button"${
            relation?.relationId ? '' : ' disabled'
          }>Batalkan konfirmasi</button>
        </div>
      </footer>
    `
    bindActions(candidate, relation)
  }

  function bindActions(candidate, relation) {
    const panel = container.querySelector('.candidate-review-panel')
    panel.querySelector('.confirm-candidate')?.addEventListener('click', () => (
      performCandidateAction(candidate, 'confirm')
    ))
    panel.querySelector('.reject-candidate')?.addEventListener('click', () => (
      performCandidateAction(candidate, 'reject')
    ))
    panel.querySelector('.skip-candidate')?.addEventListener('click', () => (
      performCandidateAction(candidate, 'skip')
    ))
    panel.querySelector('.select-alternative')?.addEventListener('click', () => {
      const targetCandidateId = panel.querySelector('.alternative-target').value
      if (!targetCandidateId) {
        showActionError('Pilih alternatif target terlebih dahulu.')
        return
      }
      performCandidateAction(candidate, 'select-target', { targetCandidateId })
    })
    panel.querySelector('.revoke-relation')?.addEventListener('click', async () => {
      const reason = panel.querySelector('.review-reason').value.trim()
      if (reason.length < 3) {
        showActionError('Alasan pembatalan minimal tiga karakter.')
        return
      }
      await performMutation(async () => {
        await revokeTopologyRelation({ relationId: relation.relationId, reason })
      }, 'Relasi berhasil dibatalkan dan dikeluarkan dari graph operasional.')
    })
  }

  async function performCandidateAction(candidate, action, extra = {}) {
    const reason = container.querySelector('.review-reason')?.value.trim() ?? ''
    if (['reject', 'select-target'].includes(action) && reason.length < 3) {
      showActionError('Alasan review minimal tiga karakter.')
      return
    }
    await performMutation(async () => {
      await reviewTopologyCandidate({
        candidateId: candidate.candidateId,
        action,
        body: { reason, ...extra },
      })
    }, actionSuccessMessage(action))
  }

  async function performMutation(mutation, successMessage) {
    if (state.actionStatus === 'loading') return
    state.actionStatus = 'loading'
    state.actionMessage = 'Menyimpan keputusan dan memperbarui confirmed graph…'
    renderDetail()
    try {
      await mutation()
      projections = await loadReviewProjections(datasetVersionId)
      state.actionStatus = 'success'
      state.actionMessage = successMessage
    } catch (error) {
      state.actionStatus = 'error'
      state.actionMessage = error.message
    }
    renderAll()
  }

  function showActionError(message) {
    state.actionStatus = 'error'
    state.actionMessage = message
    renderDetail()
  }

  function bindFilters() {
    const statuses = [
      ['open', 'Open (candidate + ambiguous)'],
      ['all', 'Semua status'],
      ['candidate', 'Candidate'],
      ['ambiguous', 'Ambiguous'],
      ['confirmed', 'Confirmed'],
      ['rejected', 'Rejected'],
      ['revoked', 'Revoked'],
      ['unresolved', 'Unresolved'],
    ]
    const families = unique(projections.candidates.items.map(({ networkFamily }) => networkFamily))
    const types = unique(projections.candidates.items.map(({ candidateType }) => candidateType))
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
      container.querySelector('.score-output').textContent = state.minScore.toFixed(2)
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
    setOrDelete(query, 'reviewCandidateId', state.selectedCandidateId)
    setOrDelete(query, 'status', state.status)
    setOrDelete(query, 'family', state.family)
    setOrDelete(query, 'type', state.type)
    setOrDelete(query, 'minScore', state.minScore ? state.minScore : null)
    setOrDelete(query, 'maxDistance', state.maxDistance !== 6 ? state.maxDistance : null)
    setOrDelete(query, 'q', state.search)
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`)
  }
}

async function loadReviewProjections(datasetVersionId) {
  const [candidates, graph, summary] = await Promise.all([
    loadTopologyProjection({ datasetVersionId, projection: 'candidates' }),
    loadTopologyProjection({ datasetVersionId, projection: 'graph' }),
    loadTopologyProjection({ datasetVersionId, projection: 'summary' }),
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
  return { candidates, graph, summary }
}

function filterCandidates(items, state) {
  const query = state.search.trim().toLowerCase()
  return prioritizeTopologyCandidates(items).filter((candidate) => {
    const statusMatch = state.status === 'all'
      || (state.status === 'open'
        ? ['candidate', 'ambiguous', 'unresolved'].includes(candidate.candidateStatus)
        : candidate.candidateStatus === state.status)
    const familyMatch = state.family === 'all' || candidate.networkFamily === state.family
    const typeMatch = state.type === 'all' || candidate.candidateType === state.type
    const scoreMatch = (candidate.score ?? 0) >= state.minScore
    const distanceMatch = candidate.distanceMeters == null
      || candidate.distanceMeters <= state.maxDistance
    const queryMatch = !query || [
      candidate.candidateId,
      candidate.sourceEndpointId,
      candidate.sourcePathAssetId,
      candidate.targetAssetId,
      candidate.targetPathAssetId,
      ...(candidate.sourceGeometryIds ?? []),
    ].filter(Boolean).join(' ').toLowerCase().includes(query)
    return statusMatch && familyMatch && typeMatch && scoreMatch && distanceMatch && queryMatch
  })
}

function graphImpact(candidate, graph) {
  const componentFor = (assetId) => (
    (graph.components ?? []).find(({ nodeIds }) => nodeIds.includes(assetId))?.nodeIds.length ?? 0
  )
  const sourceComponentSize = componentFor(candidate.sourcePathAssetId)
  const targetComponentSize = componentFor(candidate.targetAssetId)
  return {
    sourceComponentSize,
    targetComponentSize,
    mergeDelta: sourceComponentSize && targetComponentSize
      ? sourceComponentSize + targetComponentSize
      : Math.max(sourceComponentSize, targetComponentSize, 1),
  }
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
    <span>${escapeHtml(label)}</span><strong>${escapeHtml(assetId ?? '—')}</strong>
    <small>${escapeHtml(reference ?? 'Tidak ada endpoint reference')}</small>
  </div>`
}

function renderReadiness(summary) {
  const readiness = summary.readiness?.topologyReadiness ?? 'not_ready'
  return `<div class="review-readiness ${readiness}">
    <span class="material-symbols-outlined">${readiness === 'ready' ? 'verified' : 'warning'}</span>
    <div><strong>${readiness === 'ready' ? 'Topology ready' : 'Topology belum ready'}</strong>
    <small>${(summary.readiness?.blockingReasons ?? []).join(' · ') || 'Semua gate terpenuhi'}</small></div>
  </div>`
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
  return ['candidate', 'ambiguous', 'revoked'].includes(candidate.candidateStatus)
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

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '—'
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
