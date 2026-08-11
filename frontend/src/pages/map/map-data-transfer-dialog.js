import {
  activateDatasetVersion,
  downloadDatasetSource,
  getDefaultAdminToken,
  loadImportConfig,
  loadImportStatus,
  uploadDataset,
} from '../../services/import-dataset-service.js'
import {
  formatFileSize,
  validateImportFile,
} from '../admin/import-dataset-state.js'
import {
  collectSelectedNetworkAssetIds,
  downloadActiveDatasetKml,
} from './active-dataset-kml-export.js'

export function openMapDataTransferDialog({
  activeContext,
  assets = [],
  networks = [],
  selectedNetworkIds = new Set(),
  initialMode = 'import',
  onActivated,
  onOpenDiagram,
  topologyReady = true,
  topologyMessage = 'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.',
}) {
  const dialog = document.createElement('dialog')
  dialog.className = 'map-transfer-dialog'
  const state = {
    mode: initialMode,
    configStatus: 'loading',
    config: null,
    file: null,
    fileValidation: null,
    officialSourceConfirmed: false,
    versionName: createVersionName(),
    phase: 'idle',
    uploadPercent: null,
    status: null,
    error: null,
    controller: null,
  }

  document.body.append(dialog)
  dialog.showModal()
  render()
  loadConfig()

  async function loadConfig() {
    try {
      state.config = await loadImportConfig({ token: getDefaultAdminToken() })
      state.configStatus = 'ready'
    } catch (error) {
      state.configStatus = 'error'
      state.error = error.message
    }
    render()
  }

  function render() {
    dialog.innerHTML = renderMapDataTransferDialog({
      activeContext,
      assets,
      networks,
      selectedNetworkIds,
      topologyReady,
      topologyMessage,
      state,
    })
    bindEvents()
  }

  function bindEvents() {
    dialog.querySelectorAll('.close-map-transfer').forEach((button) => {
      button.addEventListener('click', close)
    })
    dialog.querySelectorAll('[data-transfer-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.mode = button.dataset.transferMode
        state.error = null
        render()
      })
    })

    const fileInput = dialog.querySelector('#map-import-file')
    const dropzone = dialog.querySelector('.map-import-dropzone')
    fileInput?.addEventListener('change', () => selectFile(fileInput.files?.[0]))
    dropzone?.addEventListener('click', () => fileInput?.click())
    dropzone?.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      fileInput?.click()
    })
    for (const eventName of ['dragenter', 'dragover']) {
      dropzone?.addEventListener(eventName, (event) => {
        event.preventDefault()
        dropzone.classList.add('is-dragging')
      })
    }
    for (const eventName of ['dragleave', 'drop']) {
      dropzone?.addEventListener(eventName, (event) => {
        event.preventDefault()
        dropzone.classList.remove('is-dragging')
      })
    }
    dropzone?.addEventListener('drop', (event) => {
      if (event.dataTransfer.files.length > 1) {
        state.fileValidation = {
          valid: false,
          error: 'Pilih satu file KML atau KMZ.',
        }
        render()
        return
      }
      selectFile(event.dataTransfer.files[0])
    })
    dialog.querySelector('.remove-map-import-file')?.addEventListener('click', () => {
      state.file = null
      state.fileValidation = null
      state.error = null
      render()
    })
    dialog.querySelector('[name="mapVersionName"]')?.addEventListener('input', (event) => {
      state.versionName = event.target.value
    })
    dialog.querySelector('[name="mapOfficialSource"]')?.addEventListener('change', (event) => {
      state.officialSourceConfirmed = event.target.checked
      render()
    })
    dialog.querySelector('.start-map-import')?.addEventListener('click', startImport)
    dialog.querySelector('.retry-map-import')?.addEventListener('click', resetImport)
    dialog.querySelector('.export-active-kml')?.addEventListener('click', exportActiveKml)
    dialog.querySelector('.export-selected-kml')?.addEventListener('click', exportSelectedKml)
    dialog.querySelector('.download-active-source')?.addEventListener('click', downloadSource)
    dialog.querySelector('.open-map-diagram')?.addEventListener('click', () => {
      close()
      onOpenDiagram?.()
    })
  }

  function selectFile(file) {
    if (!file) return
    state.file = file
    state.fileValidation = validateImportFile(
      file,
      state.config?.limits?.maxFileSize,
    )
    state.versionName = createVersionName(file.name)
    state.error = null
    render()
  }

  async function startImport() {
    state.fileValidation = validateImportFile(
      state.file,
      state.config?.limits?.maxFileSize,
    )
    if (!state.fileValidation.valid) {
      render()
      return
    }
    if (!state.officialSourceConfirmed) {
      state.error = 'Konfirmasi sumber resmi diperlukan sebelum import.'
      render()
      return
    }
    if (!state.versionName.trim()) {
      state.error = 'Identitas versi wajib diisi.'
      render()
      return
    }

    const importTarget = resolveConfiguredImportTarget(activeContext, state.config)
    if (!importTarget?.id || !importTarget.datasetId) {
      state.error = 'Kantor cabang aktif belum terdaftar pada konfigurasi server. Muat ulang halaman lalu coba lagi.'
      render()
      return
    }

    state.controller?.abort()
    state.controller = new AbortController()
    state.phase = 'uploading'
    state.uploadPercent = null
    state.error = null
    render()

    try {
      const response = await uploadDataset({
        token: getDefaultAdminToken(),
        fields: {
          branchId: importTarget.id,
          datasetId: importTarget.datasetId,
          versionName: state.versionName.trim(),
          officialSourceConfirmed: true,
        },
        file: state.file,
        signal: state.controller.signal,
        onProgress: (percent) => {
          state.uploadPercent = percent
          render()
        },
      })
      state.status = {
        datasetVersion: response.datasetVersion,
        processing: response.processing,
      }
      state.phase = 'processing'
      render()
      await pollStatus(response.statusUrl)
    } catch (error) {
      if (error.name === 'AbortError') return
      state.phase = 'error'
      state.error = error.message
      render()
    }
  }

  async function pollStatus(statusUrl) {
    while (state.phase === 'processing' && !state.controller.signal.aborted) {
      const status = await loadImportStatus({
        token: getDefaultAdminToken(),
        statusUrl,
        signal: state.controller.signal,
      })
      state.status = status
      if (status.datasetVersion.status === 'invalid') {
        state.phase = 'invalid'
        render()
        return
      }
      if (status.datasetVersion.status === 'valid' && status.canActivate) {
        await activate(status.datasetVersion.id)
        return
      }
      render()
      await delay(500, state.controller.signal)
    }
  }

  async function activate(datasetVersionId) {
    state.phase = 'activating'
    render()
    const result = await activateDatasetVersion({
      token: getDefaultAdminToken(),
      datasetVersionId,
      expectedActiveVersionId: activeContext.datasetVersionId ?? null,
      signal: state.controller.signal,
    })
    state.phase = 'active'
    state.status = {
      ...state.status,
      datasetVersion: result.datasetVersion,
    }
    render()
    window.setTimeout(() => onActivated?.(result), 350)
  }

  function exportActiveKml() {
    downloadActiveDatasetKml(
      { activeContext, assets },
      createExportFilename(activeContext, 'dataset-aktif'),
    )
  }

  function exportSelectedKml() {
    const assetIds = collectSelectedNetworkAssetIds(networks, selectedNetworkIds)
    downloadActiveDatasetKml(
      { activeContext, assets, assetIds },
      createExportFilename(activeContext, 'jaringan-terpilih'),
    )
  }

  async function downloadSource() {
    const button = dialog.querySelector('.download-active-source')
    if (!activeContext.datasetVersionId || !button) return
    button.disabled = true
    state.error = null
    try {
      const source = await downloadDatasetSource({
        token: getDefaultAdminToken(),
        datasetVersionId: activeContext.datasetVersionId,
      })
      downloadBlob(source.blob, source.filename)
    } catch (error) {
      state.error = error.message
      render()
    } finally {
      if (button.isConnected) button.disabled = false
    }
  }

  function resetImport() {
    state.controller?.abort()
    state.controller = null
    state.file = null
    state.fileValidation = null
    state.officialSourceConfirmed = false
    state.versionName = createVersionName()
    state.phase = 'idle'
    state.uploadPercent = null
    state.status = null
    state.error = null
    render()
  }

  function close() {
    state.controller?.abort()
    dialog.close()
  }

  dialog.addEventListener('close', () => dialog.remove())
  dialog.addEventListener('cancel', () => state.controller?.abort())
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close()
  })
}

/**
 * Resolve a possibly stale active-map context to the canonical branch and
 * dataset pair advertised by the current backend configuration. Older map
 * sessions may retain a display label (for example "Kantor Cabang Semarang")
 * or a differently-cased branch ID; sending that value directly would make a
 * valid import fail the server-side branch allow-list check.
 */
export function resolveConfiguredImportTarget(activeContext, config) {
  const branches = Array.isArray(config?.branches) ? config.branches : []
  const contextId = String(activeContext?.branchId ?? '').trim()
  const exact = branches.find((branch) => String(branch?.id ?? '').trim() === contextId)
  if (exact) return exact

  const normalizedId = normalizeBranchKey(contextId)
  const byId = normalizedId
    ? branches.find((branch) => normalizeBranchKey(branch?.id) === normalizedId)
    : null
  if (byId) return byId

  const normalizedName = normalizeBranchKey(activeContext?.branchName)
  return normalizedName
    ? branches.find((branch) => normalizeBranchKey(branch?.name) === normalizedName)
    : null
}

function normalizeBranchKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^kantor\s+cabang\s+/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function renderMapDataTransferDialog({
  activeContext,
  assets,
  networks,
  selectedNetworkIds,
  topologyReady = true,
  topologyMessage = 'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.',
  state,
}) {
  const importSelected = state.mode === 'import'
  return `
    <div class="map-transfer-shell">
      <header class="map-transfer-header">
        <div>
          <span class="eyebrow">ADMINISTRASI DATASET</span>
          <h2>Import &amp; export peta</h2>
          <p>${escapeHtml(activeContext.branchName || activeContext.branchId)}</p>
        </div>
        <button class="icon-button close-map-transfer" type="button"
          aria-label="Tutup import dan export">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>

      <div class="map-transfer-tabs" role="tablist" aria-label="Import dan export dataset">
        <button type="button" role="tab" data-transfer-mode="import"
          aria-selected="${importSelected}" class="${importSelected ? 'active' : ''}">
          <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
          Import KML/KMZ
        </button>
        <button type="button" role="tab" data-transfer-mode="export"
          aria-selected="${!importSelected}" class="${!importSelected ? 'active' : ''}">
          <span class="material-symbols-outlined" aria-hidden="true">download</span>
          Export
        </button>
      </div>

      <div class="map-transfer-content">
        ${importSelected
          ? renderImportPanel(activeContext, state)
          : renderExportPanel({
            activeContext,
            assets,
            networks,
            selectedNetworkIds,
            topologyReady,
            topologyMessage,
            error: state.error,
          })}
      </div>
    </div>
  `
}

function renderImportPanel(activeContext, state) {
  if (state.configStatus === 'loading') {
    return renderTransferState('progress_activity', 'Menyiapkan import', 'Membaca batas file dari server.')
  }
  if (state.configStatus === 'error') {
    return renderTransferState('error', 'Import belum tersedia', state.error, true)
  }
  if (['uploading', 'processing', 'activating', 'active'].includes(state.phase)) {
    return renderCompactProgress(state)
  }
  if (state.phase === 'invalid') return renderInvalidResult(state)

  const fileError = state.fileValidation?.valid === false
    ? state.fileValidation.error
    : null
  return `
    <section class="map-import-panel">
      <div class="map-transfer-context">
        <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
        <span>
          <small>Kantor cabang</small>
          <strong>${escapeHtml(activeContext.branchName || activeContext.branchId)}</strong>
        </span>
        <span>
          <small>Dataset tujuan</small>
          <strong>${escapeHtml(activeContext.datasetId)}</strong>
        </span>
      </div>

      <input id="map-import-file" type="file" accept=".kml,.kmz"
        class="visually-hidden" aria-describedby="map-import-help" />
      ${state.file ? renderSelectedFile(state.file, state.fileValidation) : `
        <div class="map-import-dropzone" role="button" tabindex="0">
          <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
          <strong>Pilih file KML atau KMZ</strong>
          <span id="map-import-help">Klik atau tarik file ke sini · maksimum ${
            formatFileSize(state.config.limits.maxFileSize)
          }</span>
        </div>
      `}
      ${fileError ? `<p class="map-transfer-error" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        ${escapeHtml(fileError)}
      </p>` : ''}

      <label class="map-transfer-field">
        <span>Identitas versi</span>
        <input name="mapVersionName" value="${escapeAttribute(state.versionName)}"
          maxlength="120" autocomplete="off" />
      </label>

      <label class="map-import-confirmation">
        <input name="mapOfficialSource" type="checkbox"
          ${state.officialSourceConfirmed ? 'checked' : ''} />
        <span>
          <strong>File berasal dari sumber resmi.</strong>
          <small>Jika valid, versi aktif saat ini akan diarsipkan dan peta dimuat ulang.</small>
        </span>
      </label>

      ${state.error ? `<p class="map-transfer-error" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        ${escapeHtml(state.error)}
      </p>` : ''}

      <footer class="map-transfer-actions">
        <button class="button secondary close-map-transfer" type="button">Batal</button>
        <button class="button primary start-map-import" type="button"
          ${state.fileValidation?.valid && state.officialSourceConfirmed ? '' : 'disabled'}>
          <span class="material-symbols-outlined" aria-hidden="true">map</span>
          Import dan tampilkan di peta
        </button>
      </footer>
    </section>
  `
}

function renderSelectedFile(file, validation) {
  return `
    <div class="map-selected-file ${validation?.valid === false ? 'invalid' : ''}">
      <span class="material-symbols-outlined" aria-hidden="true">description</span>
      <span>
        <strong>${escapeHtml(file.name)}</strong>
        <small>${formatFileSize(file.size)} · ${
          escapeHtml(validation?.typeLabel || 'KML/KMZ')
        }</small>
      </span>
      <button class="icon-button remove-map-import-file" type="button"
        aria-label="Hapus file ${escapeAttribute(file.name)}">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
  `
}

function renderCompactProgress(state) {
  const progress = state.phase === 'uploading'
    ? state.uploadPercent
    : state.status?.processing?.progress
  const label = {
    uploading: 'Mengunggah file',
    processing: stageLabel(state.status?.processing?.stage),
    activating: 'Mengaktifkan dataset baru',
    active: 'Dataset aktif berhasil diperbarui',
  }[state.phase]
  const complete = state.phase === 'active'
  return `
    <section class="map-transfer-progress" aria-live="polite" aria-busy="${!complete}">
      <span class="map-transfer-progress-icon material-symbols-outlined" aria-hidden="true">
        ${complete ? 'check_circle' : 'progress_activity'}
      </span>
      <h3>${escapeHtml(label)}</h3>
      <p>${complete
        ? 'Peta akan dimuat ulang menggunakan dataset version yang baru.'
        : 'Peta aktif tetap aman sampai seluruh validasi dan aktivasi selesai.'}</p>
      <div class="map-transfer-progress-track ${Number.isFinite(progress) ? '' : 'indeterminate'}">
        <i style="${Number.isFinite(progress) ? `width:${progress}%` : ''}"></i>
      </div>
      <small>${Number.isFinite(progress) ? `${Math.round(progress)}%` : 'Sedang diproses oleh server'}</small>
    </section>
  `
}

function renderInvalidResult(state) {
  const summary = state.status?.validation?.summary ?? {}
  const issues = state.status?.issues ?? []
  return `
    <section class="map-transfer-invalid" role="alert">
      <span class="material-symbols-outlined" aria-hidden="true">error</span>
      <h3>File belum dapat ditampilkan</h3>
      <p>Dataset aktif tidak berubah. Perbaiki error pada file sumber lalu import kembali.</p>
      <div>
        <span><strong>${summary.blocking ?? summary.errors ?? 0}</strong> error penghalang</span>
        <span><strong>${summary.warnings ?? 0}</strong> warning</span>
      </div>
      ${issues.slice(0, 3).map((issue) => `
        <small>${escapeHtml(issue.issueCode)} · ${escapeHtml(issue.message)}</small>
      `).join('')}
      <footer class="map-transfer-actions">
        <button class="button secondary close-map-transfer" type="button">Tutup</button>
        <button class="button primary retry-map-import" type="button">Pilih file lain</button>
      </footer>
    </section>
  `
}

function renderExportPanel({
  activeContext,
  assets,
  networks,
  selectedNetworkIds,
  topologyReady,
  topologyMessage,
  error,
}) {
  const hasActiveDataset = Boolean(activeContext.datasetVersionId)
  const selectedAssetIds = collectSelectedNetworkAssetIds(networks, selectedNetworkIds)
  return `
    <section class="map-export-panel">
      <p class="map-transfer-intro">
        Export hanya membaca dataset aktif. Koordinat geografis dan relasi sumber tidak diubah.
      </p>
      <div class="map-export-options">
        ${renderExportOption({
          icon: 'public',
          title: 'Dataset aktif ke KML',
          description: `${assets.length} aset · ${activeContext.version || 'Belum ada versi aktif'}`,
          buttonClass: 'export-active-kml',
          buttonLabel: 'Export KML',
          disabled: !hasActiveDataset || !assets.length,
        })}
        ${renderExportOption({
          icon: 'filter_alt',
          title: 'Jaringan terpilih ke KML',
          description: `${selectedAssetIds.length} aset dari ${selectedNetworkIds.size} jaringan`,
          buttonClass: 'export-selected-kml',
          buttonLabel: 'Export pilihan',
          disabled: !hasActiveDataset || !selectedAssetIds.length,
        })}
        ${renderExportOption({
          icon: 'source',
          title: 'File sumber asli',
          description: activeContext.sourceFilename || 'File sumber belum tersedia',
          buttonClass: 'download-active-source',
          buttonLabel: 'Unduh sumber',
          disabled: !hasActiveDataset,
        })}
        ${renderExportOption({
          icon: 'account_tree',
          title: 'Diagram skematik 2D',
          description: 'Export peta penuh atau jalur tracing ke SVG/PNG',
          buttonClass: 'open-map-diagram',
          buttonLabel: 'Buka diagram',
          disabled: !hasActiveDataset || !assets.length || !topologyReady,
          disabledReason: topologyReady ? null : topologyMessage,
        })}
      </div>
      ${error ? `<p class="map-transfer-error" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        ${escapeHtml(error)}
      </p>` : ''}
    </section>
  `
}

function renderExportOption({
  icon,
  title,
  description,
  buttonClass,
  buttonLabel,
  disabled,
  disabledReason = null,
}) {
  const disabledAttribute = disabled
    ? `disabled aria-disabled="true"${disabledReason
      ? ` title="${escapeAttribute(disabledReason)}"`
      : ''}`
    : ''
  return `
    <article class="map-export-option">
      <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <button class="button secondary ${buttonClass}" type="button"
        ${disabledAttribute}>${escapeHtml(buttonLabel)}</button>
    </article>
  `
}

function renderTransferState(icon, title, message, isError = false) {
  return `
    <section class="map-transfer-state ${isError ? 'error' : ''}" aria-live="polite">
      <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </section>
  `
}

function stageLabel(stage) {
  return {
    queued: 'Menyiapkan proses import',
    reading_source: 'Memeriksa keamanan file',
    extracting_kmz: 'Mengekstrak KMZ',
    parsing_kml: 'Membaca aset dan geometri KML',
    validating_import: 'Memvalidasi metadata dan relasi',
    persisting_result: 'Menyiapkan dataset version',
  }[stage] || 'Memproses dataset'
}

function createVersionName(filename = '') {
  const source = String(filename).replace(/\.(kml|kmz)$/i, '').trim()
  const date = new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date())
  return source ? `${source} · ${date}` : `Import ${date}`
}

function createExportFilename(activeContext, scope) {
  return `sinergi-${activeContext.branchId}-${scope}-${activeContext.version || 'aktif'}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeout)
      const error = new Error('Import dibatalkan.')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
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
  return escapeHtml(value)
}
