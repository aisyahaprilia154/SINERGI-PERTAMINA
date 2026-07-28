export const IMPORT_STEPS = Object.freeze([
  { id: 'upload', label: 'Mengunggah file' },
  { id: 'security', label: 'Memeriksa keamanan file' },
  { id: 'extract', label: 'Mengekstrak KMZ jika diperlukan' },
  { id: 'parse', label: 'Membaca KML' },
  { id: 'process', label: 'Memproses aset dan geometri' },
  { id: 'validate', label: 'Memvalidasi metadata dan relasi' },
  { id: 'preview', label: 'Menyiapkan preview' },
])

const STAGE_INDEX = Object.freeze({
  uploading: 0,
  queued: 1,
  reading_source: 1,
  extracting_kmz: 2,
  parsing_kml: 3,
  validating_import: 5,
  persisting_result: 6,
  valid: 6,
  invalid: 6,
})

export function validateImportFile(file, maxFileSize = 50 * 1024 * 1024) {
  if (!file) return { valid: false, error: 'Pilih satu file KML atau KMZ.' }
  const extension = extensionOf(file.name)
  if (!['.kml', '.kmz'].includes(extension)) {
    return {
      valid: false,
      error: 'Jenis file tidak didukung. Gunakan file dengan ekstensi .kml atau .kmz.',
    }
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { valid: false, error: 'File kosong tidak dapat diunggah.' }
  }
  if (file.size > maxFileSize) {
    return {
      valid: false,
      error: `Ukuran file melebihi batas ${formatFileSize(maxFileSize)}.`,
    }
  }
  return {
    valid: true,
    extension,
    typeLabel: extension === '.kmz' ? 'KMZ archive' : 'KML document',
  }
}

export function getImportStepState({
  phase = 'idle',
  backendStage = null,
  fileExtension = null,
} = {}) {
  if (phase === 'idle' || phase === 'error' || phase === 'cancelled') {
    return IMPORT_STEPS.map((step) => ({ ...step, status: 'pending' }))
  }

  const activeIndex = phase === 'uploading'
    ? 0
    : STAGE_INDEX[backendStage] ?? 1
  const completed = ['success', 'invalid'].includes(phase)

  return IMPORT_STEPS.map((step, index) => {
    if (step.id === 'extract' && fileExtension === '.kml') {
      return {
        ...step,
        status: activeIndex > 2 || completed ? 'skipped' : 'pending',
        detail: 'Tidak diperlukan untuk file KML',
      }
    }
    if (completed || index < activeIndex) return { ...step, status: 'complete' }
    if (index === activeIndex) return { ...step, status: 'active' }
    return { ...step, status: 'pending' }
  })
}

export function getOverallProgress({
  phase,
  backendProgress,
  uploadPercent,
}) {
  if (phase === 'uploading' && Number.isFinite(uploadPercent)) {
    return Math.max(0, Math.min(100, Math.round(uploadPercent)))
  }
  if (['processing', 'success', 'invalid'].includes(phase)
    && Number.isFinite(backendProgress)) {
    return Math.max(0, Math.min(100, Math.round(backendProgress)))
  }
  return null
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function formatElapsed(startedAt, now = Date.now()) {
  if (!Number.isFinite(startedAt)) return null
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds < 60) return `${seconds} detik`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} menit ${seconds % 60} detik`
}

export function countIssueHighlights(issues = []) {
  const labels = {
    ASSET_ID_MISSING: 'tanpa Asset ID',
    COORDINATE_INVALID: 'koordinat invalid',
    CATEGORY_UNMAPPED: 'folder/kategori belum terpetakan',
    RELATION_TARGET_NOT_FOUND: 'target relasi tidak ditemukan',
  }
  const counts = new Map()
  issues.forEach((issue) => {
    if (!labels[issue.issueCode]) return
    counts.set(issue.issueCode, (counts.get(issue.issueCode) ?? 0) + 1)
  })
  return [...counts].map(([issueCode, count]) => ({
    issueCode,
    count,
    label: labels[issueCode],
  }))
}

function extensionOf(filename) {
  const normalized = String(filename ?? '').toLowerCase()
  const index = normalized.lastIndexOf('.')
  return index >= 0 ? normalized.slice(index) : ''
}
