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
  collectFocusedAssetIds,
  collectSelectedNetworkAssetIds,
  collectTraceAssetIds,
  collectViewportAssetIds,
  collectVisibleLayerAssetIds,
  createContextualExportFilename,
  downloadActiveDatasetKml,
} from './active-dataset-kml-export.js'

export function openMapDataTransferDialog({
  activeContext,
  assets = [],
  networks = [],
  layers = [],
  topologyGraph = null,
  selectedNetworkIds = new Set(),
  selectedAssetId = null,
  tracePath = [],
  visibleAssetIds = [],
  visibleGeometryIds = [],
  initialMode = 'import',
  onActivated,
  onOpenDiagram,
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
    exportStatus: null,
    controller: null,
    exportFormat: 'kml',
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
      layers,
      topologyGraph,
      selectedNetworkIds,
      selectedAssetId,
      tracePath,
      visibleAssetIds,
      visibleGeometryIds,
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
    dialog.querySelector('.export-visible-layer')?.addEventListener('click', exportVisibleLayers)
    dialog.querySelector('.export-focused-depth-1')?.addEventListener('click', () => {
      exportFocusedAsset(1)
    })
    dialog.querySelector('.export-focused-depth-2')?.addEventListener('click', () => {
      exportFocusedAsset(2)
    })
    dialog.querySelector('.export-active-trace')?.addEventListener('click', exportActiveTrace)
    dialog.querySelector('.export-current-viewport')?.addEventListener('click', exportCurrentViewport)
    dialog.querySelector('[name="mapExportFormat"]')?.addEventListener('change', (event) => {
      state.exportFormat = event.target.value === 'kmz' ? 'kmz' : 'kml'
      render()
    })
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
          branchId: activeContext.branchId,
          datasetId: activeContext.datasetId,
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
    exportScope('dataset-aktif', null, 'Dataset aktif')
  }

  function exportSelectedKml() {
    const assetIds = collectSelectedNetworkAssetIds(networks, selectedNetworkIds)
    exportScope('jaringan-terpilih', assetIds, 'Jaringan terpilih')
  }

  function exportVisibleLayers() {
    const layerIds = networks
      .filter(({ id }) => selectedNetworkIds.has(id))
      .flatMap(({ layerIds = [] }) => layerIds)
    exportScope(
      'layer-terlihat',
      collectVisibleLayerAssetIds(assets, layerIds),
      'Layer terlihat',
    )
  }

  function exportFocusedAsset(depth) {
    exportScope(
      `Aset-Fokus-Depth-${depth}`,
      collectFocusedAssetIds(topologyGraph, selectedAssetId, depth),
      `Aset ${selectedAssetId || ''} dan relasi depth ${depth}`,
    )
  }

  function exportActiveTrace() {
    exportScope('Trace', collectTraceAssetIds(tracePath), 'Jalur tracing aktif')
  }

  function exportCurrentViewport() {
    exportScope(
      'Viewport',
      collectViewportAssetIds(assets, visibleAssetIds, visibleGeometryIds),
      'Area peta saat ini',
    )
  }

  function exportScope(filenameScope, assetIds, scopeLabel) {
    state.error = null
    state.exportStatus = null
    try {
      const scopedIds = assetIds == null ? null : [...new Set(assetIds)]
      if (scopedIds && !scopedIds.length) {
        throw new Error('Scope export tidak mempunyai objek Pengapon yang dapat diexport.')
      }
      downloadActiveDatasetKml(
        {
          activeContext,
          assets,
          layers,
          assetIds: scopedIds,
          relations: topologyGraph?.edges ?? [],
          scopeLabel,
        },
        createContextualExportFilename(activeContext, filenameScope),
        state.exportFormat,
      )
      state.exportStatus = `${scopeLabel} berhasil disiapkan sebagai ${
        state.exportFormat.toUpperCase()
      }.`
    } catch (error) {
      state.error = error.message || 'Export tidak dapat diselesaikan.'
    }
    render()
  }

  async function downloadSource() {
    const button = dialog.querySelector('.download-active-source')
    if (!activeContext.datasetVersionId || !button) return
    button.disabled = true
    state.error = null
    state.exportStatus = 'Menyiapkan file sumber asliâ€¦'
    try {
      const source = await downloadDatasetSource({
        token: getDefaultAdminToken(),
        datasetVersionId: activeContext.datasetVersionId,
      })
      downloadBlob(source.blob, source.filename)
      state.exportStatus = 'File sumber asli berhasil disiapkan.'
      render()
    } catch (error) {
      state.error = error.message
      state.exportStatus = null
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
    state.exportStatus = null
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

export function renderMapDataTransferDialog({
  activeContext,
  assets,
  networks,
  layers = [],
  topologyGraph = null,
  selectedNetworkIds,
  selectedAssetId = null,
  tracePath = [],
  visibleAssetIds = [],
  visibleGeometryIds = [],
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
            layers,
            topologyGraph,
            selectedNetworkIds,
            selectedAssetId,
            tracePath,
            visibleAssetIds,
            visibleGeometryIds,
            exportFormat: state.exportFormat,
            error: state.error,
            exportStatus: state.exportStatus,
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
  topologyGraph,
  selectedNetworkIds,
  selectedAssetId,
  tracePath,
  visibleAssetIds,
  visibleGeometryIds,
  exportFormat,
  error,
  exportStatus,
}) {
  const hasActiveDataset = Boolean(activeContext.datasetVersionId)
  const selectedAssetIds = collectSelectedNetworkAssetIds(networks, selectedNetworkIds)
  const visibleLayerIds = networks
    .filter(({ id }) => selectedNetworkIds.has(id))
    .flatMap(({ layerIds = [] }) => layerIds)
  const visibleLayerAssetIds = collectVisibleLayerAssetIds(assets, visibleLayerIds)
  const focusedDepthOneIds = collectFocusedAssetIds(topologyGraph, selectedAssetId, 1)
  const focusedDepthTwoIds = collectFocusedAssetIds(topologyGraph, selectedAssetId, 2)
  const traceAssetIds = collectTraceAssetIds(tracePath)
  const viewportAssetIds = collectViewportAssetIds(
    assets,
    visibleAssetIds,
    visibleGeometryIds,
  )
  const formatLabel = String(exportFormat || 'kml').toUpperCase()
  return `
    <section class="map-export-panel">
      <p class="map-transfer-intro">
        Export hanya membaca dataset aktif. Koordinat geografis dan relasi sumber tidak diubah.
      </p>
      <label class="map-transfer-field">
        <span>Format data Google Earth</span>
        <select name="mapExportFormat">
          <option value="kml" ${exportFormat === 'kmz' ? '' : 'selected'}>KML</option>
          <option value="kmz" ${exportFormat === 'kmz' ? 'selected' : ''}>KMZ</option>
        </select>
      </label>
      <div class="map-export-options">
        ${renderExportOption({
          icon: 'public',
          title: `Dataset aktif ke ${formatLabel}`,
          description: `${assets.length} aset · ${activeContext.version || 'Belum ada versi aktif'}`,
          buttonClass: 'export-active-kml',
          buttonLabel: `Export ${formatLabel}`,
          disabled: !hasActiveDataset || !assets.length,
        })}
        ${renderExportOption({
          icon: 'filter_alt',
          title: `Jaringan terpilih ke ${formatLabel}`,
          description: `${selectedAssetIds.length} aset dari ${selectedNetworkIds.size} jaringan`,
          buttonClass: 'export-selected-kml',
          buttonLabel: 'Export pilihan',
          disabled: !hasActiveDataset || !selectedAssetIds.length,
        })}
        ${renderExportOption({
          icon: 'layers',
          title: `Layer terlihat ke ${formatLabel}`,
          description: `${visibleLayerAssetIds.length} aset dari ${visibleLayerIds.length} layer aktif`,
          buttonClass: 'export-visible-layer',
          buttonLabel: 'Export layer',
          disabled: !hasActiveDataset || !visibleLayerAssetIds.length,
        })}
        ${renderExportOption({
          icon: 'hub',
          title: `Aset fokus depth 1 ke ${formatLabel}`,
          description: selectedAssetId
            ? `${focusedDepthOneIds.length} aset termasuk koneksi langsung`
            : 'Pilih satu aset pada peta terlebih dahulu',
          buttonClass: 'export-focused-depth-1',
          buttonLabel: 'Export depth 1',
          disabled: !hasActiveDataset || !selectedAssetId || !focusedDepthOneIds.length,
        })}
        ${renderExportOption({
          icon: 'account_tree',
          title: `Aset fokus depth 2 ke ${formatLabel}`,
          description: selectedAssetId
            ? `${focusedDepthTwoIds.length} aset sampai dua tingkat relasi`
            : 'Pilih satu aset pada peta terlebih dahulu',
          buttonClass: 'export-focused-depth-2',
          buttonLabel: 'Export depth 2',
          disabled: !hasActiveDataset || !selectedAssetId || !focusedDepthTwoIds.length,
        })}
        ${renderExportOption({
          icon: 'route',
          title: `Jalur tracing aktif ke ${formatLabel}`,
          description: traceAssetIds.length
            ? `${traceAssetIds.length} aset pada urutan tracing`
            : 'Jalankan tracing terlebih dahulu',
          buttonClass: 'export-active-trace',
          buttonLabel: 'Export trace',
          disabled: !hasActiveDataset || traceAssetIds.length < 2,
        })}
        ${renderExportOption({
          icon: 'crop_free',
          title: `Area peta saat ini ke ${formatLabel}`,
          description: viewportAssetIds.length
            ? `${viewportAssetIds.length} aset atau pemilik geometri terlihat`
            : 'Area peta saat ini tidak mempunyai objek',
          buttonClass: 'export-current-viewport',
          buttonLabel: 'Export viewport',
          disabled: !hasActiveDataset || !viewportAssetIds.length,
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
          disabled: !hasActiveDataset || !assets.length,
        })}
      </div>
      ${error ? `<p class="map-transfer-error" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        ${escapeHtml(error)}
      </p>` : ''}
      ${exportStatus ? `<p class="map-transfer-success" role="status" aria-live="polite">
        <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
        ${escapeHtml(exportStatus)}
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
}) {
  return `
    <article class="map-export-option">
      <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
      <button class="button secondary ${buttonClass}" type="button"
        ${disabled ? 'disabled' : ''}>${escapeHtml(buttonLabel)}</button>
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
