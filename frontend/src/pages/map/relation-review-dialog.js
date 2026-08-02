import {
  loadRelationReview,
  reviewRelationCandidate,
} from '../../services/active-dataset-service.js'

export function openRelationReviewDialog({
  datasetVersionId,
  siteScopeId = 'pengapon',
  onPreviewCandidate,
  onChanged,
}) {
  const dialog = document.createElement('dialog')
  dialog.className = 'relation-review-dialog'
  dialog.innerHTML = `
    <div class="relation-review-shell">
      <header>
        <div>
          <span class="eyebrow">ADMINISTRASI RELASI</span>
          <h2>Periksa kandidat relasi</h2>
          <p>Konfirmasi hanya hubungan yang dapat dipertanggungjawabkan.</p>
        </div>
        <button class="icon-button close-relation-review" type="button"
          aria-label="Tutup pemeriksaan relasi">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>
      <div class="relation-review-content" aria-live="polite" aria-busy="true">
        ${renderLoading()}
      </div>
      <footer>
        <p>
          <span class="material-symbols-outlined" aria-hidden="true">lock</span>
          Review tidak mengubah koordinat atau geometri sumber.
        </p>
        <button class="button secondary close-relation-review" type="button">Tutup</button>
      </footer>
    </div>
  `
  document.body.append(dialog)
  dialog.showModal()
  const content = dialog.querySelector('.relation-review-content')
  let model = null

  const close = () => dialog.close()
  dialog.querySelectorAll('.close-relation-review')
    .forEach((button) => button.addEventListener('click', close))
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close()
  })
  dialog.addEventListener('close', () => dialog.remove())

  async function load() {
    content.setAttribute('aria-busy', 'true')
    try {
      model = await loadRelationReview({ datasetVersionId, siteScopeId })
      render()
    } catch (error) {
      content.innerHTML = renderError(error.message)
      content.querySelector('.retry-relation-review')?.addEventListener('click', load)
    } finally {
      content.setAttribute('aria-busy', 'false')
    }
  }

  function render() {
    content.innerHTML = renderRelationReview(model)
    content.querySelectorAll('[data-preview-relation]').forEach((button) => {
      button.addEventListener('click', () => {
        const candidate = model.candidates.find(({ id }) => (
          id === button.dataset.previewRelation
        ))
        if (candidate) onPreviewCandidate?.(candidate)
      })
    })
    content.querySelectorAll('[data-relation-decision]').forEach((button) => {
      button.addEventListener('click', async () => {
        const candidate = model.candidates.find(({ id }) => (
          id === button.dataset.relationId
        ))
        if (!candidate) return
        content.querySelectorAll('[data-relation-decision]')
          .forEach((action) => { action.disabled = true })
        const status = content.querySelector('.relation-review-status')
        status.textContent = 'Menyimpan keputusan review…'
        try {
          model = await reviewRelationCandidate({
            datasetVersionId,
            relationId: candidate.id,
            decision: button.dataset.relationDecision,
            siteScopeId,
          })
          status.textContent = 'Keputusan review tersimpan.'
          dialog.close()
          onChanged?.(model)
        } catch (error) {
          status.textContent = error.message
          content.querySelectorAll('[data-relation-decision]')
            .forEach((action) => { action.disabled = false })
        }
      })
    })
  }

  load()
  return dialog
}

export function renderRelationReview(model) {
  const summary = model?.summary ?? {}
  const candidates = model?.candidates ?? []
  return `
    <section class="relation-review-summary" aria-label="Ringkasan kesiapan relasi">
      ${summaryItem('Terkonfirmasi', summary.confirmed)}
      ${summaryItem('Perlu diperiksa', summary.inferredPending)}
      ${summaryItem('Ambiguous', summary.ambiguous)}
      ${summaryItem('Unresolved', summary.unresolved)}
      ${summaryItem('Aset terisolasi', summary.isolatedAssets)}
    </section>
    <section class="relation-review-list" aria-labelledby="relation-candidate-title">
      <div class="relation-review-section-heading">
        <div>
          <h3 id="relation-candidate-title">Kandidat relasi</h3>
          <p>Hasil inferensi belum digunakan oleh map User, tracing, atau Diagram 2D.</p>
        </div>
        <span class="count-badge">${candidates.length}</span>
      </div>
      ${candidates.length ? candidates.map(renderCandidate).join('') : `
        <div class="relation-review-empty">
          <span class="material-symbols-outlined" aria-hidden="true">task_alt</span>
          <strong>Tidak ada kandidat yang menunggu review</strong>
          <p>Relasi terkonfirmasi tetap tersedia pada graph User.</p>
        </div>
      `}
    </section>
    <p class="relation-review-status" role="status" aria-live="polite"></p>
  `
}

function renderCandidate(candidate) {
  return `
    <article class="relation-candidate">
      <header>
        <div>
          <strong>${escapeHtml(candidate.sourceName)}</strong>
          <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
          <strong>${escapeHtml(candidate.targetName)}</strong>
        </div>
        <span class="category-badge">${escapeHtml(candidate.relationSource)}</span>
      </header>
      <dl>
        <div><dt>Jenis aset</dt><dd>${escapeHtml(candidate.sourceType)} → ${
          escapeHtml(candidate.targetType)
        }</dd></div>
        <div><dt>Relation type</dt><dd>${escapeHtml(candidate.relationType)}</dd></div>
        <div><dt>Network</dt><dd>${escapeHtml(
          displayNetwork(candidate.networkId),
        )}</dd></div>
        <div><dt>Metode inferensi</dt><dd>${escapeHtml(
          displayInferenceMethod(candidate.inferenceMethod),
        )}</dd></div>
        <div><dt>Path geometry</dt><dd>${
          escapeHtml(candidate.pathGeometry?.id || 'Tidak tersedia')
        }</dd></div>
        <div><dt>Jarak ke jalur</dt><dd>${
          Number.isFinite(candidate.distanceMeters)
            ? `${candidate.distanceMeters.toFixed(2)} meter`
            : 'Tidak tersedia'
        }</dd></div>
        <div><dt>Chainage</dt><dd>${escapeHtml(
          displayChainage(candidate.chainage),
        )}</dd></div>
        <div><dt>Folder sumber</dt><dd title="${
          escapeAttribute(candidate.sourceFolderPath || '')
        }">${escapeHtml(candidate.sourceFolderPath || 'Tidak tersedia')}</dd></div>
      </dl>
      <div class="relation-candidate-actions">
        <button class="button secondary" type="button"
          data-preview-relation="${escapeAttribute(candidate.id)}">
          <span class="material-symbols-outlined" aria-hidden="true">map</span>
          Preview peta
        </button>
        <button class="button primary" type="button" data-relation-decision="confirm"
          data-relation-id="${escapeAttribute(candidate.id)}">Konfirmasi</button>
        <button class="button secondary" type="button" data-relation-decision="reject"
          data-relation-id="${escapeAttribute(candidate.id)}">Tolak</button>
        <button class="button secondary" type="button" data-relation-decision="undetermined"
          data-relation-id="${escapeAttribute(candidate.id)}">Belum dapat ditentukan</button>
      </div>
    </article>
  `
}

function summaryItem(label, count = 0) {
  return `<div><strong>${Number(count) || 0}</strong><span>${escapeHtml(label)}</span></div>`
}

function displayNetwork(networkId) {
  return String(networkId ?? '')
    .replace(/^network:/, '')
    .replaceAll('-', ' ')
    || 'Tidak tersedia'
}

function displayInferenceMethod(value) {
  return String(value ?? '')
    .replace(/^inferred_/, '')
    .replaceAll('_', ' ')
    || 'Tidak tersedia'
}

function displayChainage(chainage) {
  if (Number.isFinite(chainage)) return `${chainage.toFixed(2)} meter`
  if (Number.isFinite(chainage?.sourceMeters)
    && Number.isFinite(chainage?.targetMeters)) {
    return `${chainage.sourceMeters.toFixed(2)} – ${chainage.targetMeters.toFixed(2)} meter`
  }
  return 'Tidak tersedia'
}

function renderLoading() {
  return `
    <div class="relation-review-loading">
      <span class="material-symbols-outlined" aria-hidden="true">progress_activity</span>
      <strong>Memuat kandidat relasi</strong>
      <p>Graph dataset version sedang diperiksa.</p>
    </div>
  `
}

function renderError(message) {
  return `
    <div class="relation-review-empty" role="alert">
      <span class="material-symbols-outlined" aria-hidden="true">error</span>
      <strong>Kandidat relasi tidak dapat dimuat</strong>
      <p>${escapeHtml(message)}</p>
      <button class="button secondary retry-relation-review" type="button">Coba lagi</button>
    </div>
  `
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
  return escapeHtml(value).replaceAll('`', '&#096;')
}
