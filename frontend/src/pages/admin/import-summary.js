import { countIssueHighlights } from './import-dataset-state.js'
import { renderImportStatusBadge } from './import-status-badge.js'
import { escapeHtml } from './import-view-utils.js'

const METRICS = Object.freeze([
  ['totalFolders', 'Folder ditemukan', 'folder'],
  ['totalPlacemarks', 'Placemark ditemukan', 'location_on'],
  ['totalAssets', 'Aset dikenali', 'inventory_2'],
  ['totalPoints', 'Point', 'pin_drop'],
  ['totalLines', 'Line', 'timeline'],
  ['totalPolygons', 'Polygon', 'pentagon'],
  ['totalRelations', 'Relation', 'conversion_path'],
  ['newAssets', 'Aset baru', 'add_circle'],
  ['updatedAssets', 'Aset diperbarui', 'update'],
  ['unchangedAssets', 'Tidak berubah', 'check_circle'],
  ['removedAssets', 'Tidak lagi tersedia', 'remove_circle'],
  ['errors', 'Error', 'error'],
  ['warnings', 'Warning', 'warning'],
])

export function renderImportSummary({
  datasetVersion,
  validation,
  issues = [],
} = {}) {
  const summary = datasetVersion?.summary ?? {}
  const status = validation?.status === 'valid' ? 'success' : 'invalid'
  const highlights = countIssueHighlights(issues)
  return `
    <section class="import-summary-card" aria-labelledby="import-summary-title">
      <header class="import-section-header">
        <div>
          <span class="section-kicker">HASIL IMPORT</span>
          <h2 id="import-summary-title">Ringkasan dataset version</h2>
        </div>
        ${renderImportStatusBadge(status)}
      </header>

      <div class="summary-context">
        <span>
          <small>Identitas versi</small>
          <strong>${escapeHtml(datasetVersion?.versionName ?? '-')}</strong>
        </span>
        <span>
          <small>Dataset tujuan</small>
          <strong>${escapeHtml(datasetVersion?.datasetId ?? '-')}</strong>
        </span>
        <span>
          <small>Status publikasi</small>
          <strong>Belum aktif</strong>
        </span>
      </div>

      <dl class="import-summary-grid">
        ${METRICS.map(([key, label, icon]) => `
          <div class="${key === 'errors' ? 'metric-error' : key === 'warnings' ? 'metric-warning' : ''}">
            <dt>
              <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
              ${escapeHtml(label)}
            </dt>
            <dd>${formatCount(summary[key])}</dd>
          </div>
        `).join('')}
      </dl>

      ${highlights.length ? `
        <div class="issue-highlights" aria-label="Sorotan issue">
          ${highlights.map((item) => `
            <span>
              <strong>${item.count}</strong>
              ${escapeHtml(item.label)}
            </span>
          `).join('')}
        </div>
      ` : ''}

      ${validation?.canActivate === false ? `
        <p class="activation-blocked-note">
          <span class="material-symbols-outlined" aria-hidden="true">lock</span>
          Dataset version tidak dapat diaktifkan sampai seluruh error blocking diselesaikan.
        </p>
      ` : `
        <p class="activation-ready-note">
          <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
          Validasi selesai. Aktivasi tetap dilakukan melalui tindakan Administrator yang terpisah.
        </p>
      `}
    </section>
  `
}

function formatCount(value) {
  return Number.isInteger(value) && value >= 0
    ? new Intl.NumberFormat('id-ID').format(value)
    : '0'
}
