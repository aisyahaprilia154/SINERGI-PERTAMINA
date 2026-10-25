import { escapeHtml } from './import-view-utils.js'

const STATUS = Object.freeze({
  idle: { label: 'Belum dimulai', icon: 'schedule', tone: 'neutral' },
  loading: { label: 'Memuat', icon: 'progress_activity', tone: 'neutral' },
  uploading: { label: 'Mengunggah', icon: 'upload', tone: 'progress' },
  processing: { label: 'Memproses', icon: 'progress_activity', tone: 'progress' },
  success: { label: 'Valid', icon: 'check_circle', tone: 'success' },
  valid: { label: 'Valid', icon: 'check_circle', tone: 'success' },
  invalid: { label: 'Perlu diperbaiki', icon: 'error', tone: 'danger' },
  active: { label: 'Aktif', icon: 'published_with_changes', tone: 'success' },
  archived: { label: 'Diarsipkan', icon: 'archive', tone: 'neutral' },
  draft: { label: 'Draft', icon: 'draft', tone: 'neutral' },
  error: { label: 'Gagal', icon: 'error', tone: 'danger' },
  cancelled: { label: 'Dibatalkan', icon: 'cancel', tone: 'neutral' },
})

export function renderImportStatusBadge(status, customLabel = null) {
  const config = STATUS[status] ?? STATUS.idle
  return `
    <span class="import-status-badge tone-${config.tone}">
      <span class="material-symbols-outlined" aria-hidden="true">${config.icon}</span>
      ${escapeHtml(customLabel ?? config.label)}
    </span>
  `
}
