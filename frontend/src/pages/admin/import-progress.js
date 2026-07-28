import {
  formatElapsed,
  getImportStepState,
  getOverallProgress,
} from './import-dataset-state.js'
import { renderImportStatusBadge } from './import-status-badge.js'
import { escapeHtml } from './import-view-utils.js'

export function renderImportProgress({
  phase,
  backendStage,
  backendProgress,
  uploadPercent,
  fileExtension,
  startedAt,
  now,
  message,
} = {}) {
  const steps = getImportStepState({ phase, backendStage, fileExtension })
  const progress = getOverallProgress({ phase, backendProgress, uploadPercent })
  const elapsed = formatElapsed(startedAt, now)
  const isBusy = ['uploading', 'processing'].includes(phase)
  const isIndeterminate = isBusy && progress === null

  return `
    <section class="import-progress-card" aria-labelledby="import-progress-title"
      aria-live="polite" ${isBusy ? 'aria-busy="true"' : ''}>
      <header class="import-section-header">
        <div>
          <span class="section-kicker">STATUS PROSES</span>
          <h2 id="import-progress-title">Proses import dataset</h2>
        </div>
        ${renderImportStatusBadge(phase)}
      </header>

      <div class="progress-copy">
        <strong>${escapeHtml(message ?? statusMessage(phase, backendStage))}</strong>
        ${elapsed ? `<span>Waktu berjalan ${escapeHtml(elapsed)}</span>` : ''}
      </div>

      <div class="import-progress-track ${isIndeterminate ? 'indeterminate' : ''}"
        role="progressbar"
        aria-label="Progress import"
        ${progress !== null
          ? `aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"`
          : 'aria-valuetext="Sedang diproses"'}>
        <span style="${progress !== null ? `width:${progress}%` : ''}"></span>
      </div>

      <ol class="import-step-list">
        ${steps.map((step) => `
          <li class="step-${step.status}">
            <span class="step-marker material-symbols-outlined" aria-hidden="true">
              ${stepIcon(step.status)}
            </span>
            <span>
              <strong>${escapeHtml(step.label)}</strong>
              ${step.detail ? `<small>${escapeHtml(step.detail)}</small>` : ''}
            </span>
            <em>${stepLabel(step.status)}</em>
          </li>
        `).join('')}
      </ol>
    </section>
  `
}

function statusMessage(phase, stage) {
  if (phase === 'uploading') return 'Mengirim file ke service import.'
  if (phase === 'success') return 'Dataset selesai divalidasi dan siap dilihat pada preview.'
  if (phase === 'invalid') return 'Import selesai, tetapi terdapat error yang menghalangi aktivasi.'
  if (phase === 'error') return 'Proses import mengalami kendala.'
  if (phase === 'cancelled') return 'Pemantauan import dihentikan.'
  const labels = {
    queued: 'File diterima dan menunggu giliran proses.',
    reading_source: 'Memeriksa file sumber yang tersimpan.',
    extracting_kmz: 'Mengekstrak resource KMZ secara aman.',
    parsing_kml: 'Membaca struktur dan geometri KML.',
    validating_import: 'Memvalidasi aset, metadata, geometri, dan relasi.',
    persisting_result: 'Menyimpan hasil validasi untuk preview.',
  }
  return labels[stage] ?? 'Menunggu proses import dimulai.'
}

function stepIcon(status) {
  if (status === 'complete') return 'check'
  if (status === 'active') return 'progress_activity'
  if (status === 'skipped') return 'remove'
  return 'circle'
}

function stepLabel(status) {
  if (status === 'complete') return 'Selesai'
  if (status === 'active') return 'Diproses'
  if (status === 'skipped') return 'Dilewati'
  return 'Menunggu'
}
