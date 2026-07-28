import {
  activateDatasetVersion,
  downloadDatasetSource,
  getDefaultAdminToken,
  loadImportPreview,
  rejectDatasetVersion,
} from '../../services/import-dataset-service.js'
import { renderImportStatusBadge } from './import-status-badge.js'
import { escapeAttribute, escapeHtml } from './import-view-utils.js'
import { renderPreviewAssetDrawer } from './preview-asset-drawer.js'
import { renderPreviewMapCanvas } from './preview-map-canvas.js'
import {
  buildImportPreviewModel,
  calculateAssetBounds,
  createImportPreviewState,
  findConnectedAssetIds,
  getVisiblePreviewData,
} from './preview-import-state.js'
import { renderPreviewSidebar } from './preview-sidebar.js'
import { renderPreviewToolbar } from './preview-toolbar.js'

export function renderPreviewImportPage(container, datasetVersionId) {
  document.title = 'Preview Import Dataset — SINERGI'
  document.body.className = 'admin-preview-body'

  const page = {
    status: 'loading',
    error: '',
    model: null,
    state: null,
    controller: new AbortController(),
    confirmAction: null,
  }

  document.addEventListener('keydown', handleGlobalEscape)
  load()

  async function load() {
    page.status = 'loading'
    page.error = ''
    render()
    try {
      const payload = await loadImportPreview({
        token: getDefaultAdminToken(),
        datasetVersionId,
        signal: page.controller.signal,
      })
      page.model = buildImportPreviewModel(payload)
      page.state = createImportPreviewState(page.model)
      page.status = 'ready'
    } catch (error) {
      if (error.name === 'AbortError') return
      page.status = 'error'
      page.error = error.message
    }
    render()
  }

  function render() {
    container.innerHTML = renderShell(page, datasetVersionId)
    if (page.status === 'ready') bindReadyEvents()
    else container.querySelector('[data-retry-preview]')?.addEventListener('click', load)
  }

  function bindReadyEvents() {
    const { model, state } = page
    const rerender = () => render()
    container.querySelectorAll('[data-view-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.viewMode = button.dataset.viewMode
        state.selectedAssetId = null
        state.selectedIssueId = null
        state.traceAssetIds.clear()
        state.focusBounds = null
        state.zoom = 1
        rerender()
      })
    })
    container.querySelector('[data-toggle-changes]')?.addEventListener('click', () => {
      state.showChanges = !state.showChanges
      rerender()
    })
    container.querySelector('[data-toggle-issues]')?.addEventListener('click', () => {
      state.showIssues = !state.showIssues
      rerender()
    })
    bindFilter('[data-filter-layer]', state.visibleLayerIds, 'filterLayer')
    bindFilter('[data-filter-category]', state.visibleCategories, 'filterCategory')
    bindFilter('[data-filter-geometry]', state.visibleGeometryTypes, 'filterGeometry')
    bindFilter('[data-filter-issue]', state.visibleIssueSeverities, 'filterIssue')

    container.querySelectorAll('[data-preview-asset]').forEach((element) => {
      element.addEventListener('click', () => selectAsset(element.dataset.previewAsset))
      element.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return
        event.preventDefault()
        selectAsset(element.dataset.previewAsset)
      })
    })
    container.querySelectorAll('[data-problem-asset], [data-navigate-issue]').forEach((button) => {
      button.addEventListener('click', () => navigateIssue(
        button.dataset.navigateIssue || button.dataset.issueId,
        button.dataset.problemAsset,
      ))
    })
    container.querySelector('.close-preview-drawer')?.addEventListener('click', closeDrawer)
    container.querySelectorAll('[data-related-asset]').forEach((button) => {
      button.addEventListener('click', () => selectAsset(button.dataset.relatedAsset))
    })
    container.querySelector('[data-trace-connected]')?.addEventListener('click', () => {
      const wasTracing = state.traceAssetIds.size > 0
      state.traceAssetIds = wasTracing
        ? new Set()
        : findConnectedAssetIds(model, state.selectedAssetId)
      const hasConnection = state.traceAssetIds.size > 1
      if (!hasConnection) state.traceAssetIds.clear()
      state.actionStatus = wasTracing || hasConnection ? 'success' : 'error'
      state.actionMessage = wasTracing
        ? 'Penelusuran koneksi dihentikan.'
        : hasConnection
          ? `${state.traceAssetIds.size} aset ditelusuri dari relasi eksplisit.`
          : 'Aset ini tidak mempunyai koneksi eksplisit yang dapat ditelusuri.'
      rerender()
    })

    container.querySelectorAll('[data-fit-all], [data-preview-fit], [data-reset-view]')
      .forEach((button) => button.addEventListener('click', () => {
        state.focusBounds = null
        state.zoom = 1
        rerender()
      }))
    container.querySelector('[data-preview-zoom-in]')?.addEventListener('click', () => {
      state.zoom = Math.min(4, state.zoom + 0.5)
      rerender()
    })
    container.querySelector('[data-preview-zoom-out]')?.addEventListener('click', () => {
      state.zoom = Math.max(1, state.zoom - 0.5)
      rerender()
    })
    container.querySelector('[data-open-preview-sidebar]')?.addEventListener('click', () => {
      state.sidebarOpen = true
      rerender()
    })
    container.querySelector('.close-preview-sidebar')?.addEventListener('click', () => {
      state.sidebarOpen = false
      rerender()
    })
    container.querySelector('.preview-mobile-backdrop')?.addEventListener('click', () => {
      state.sidebarOpen = false
      rerender()
    })
    container.querySelector('[data-download-report]')?.addEventListener('click', downloadReport)
    container.querySelector('[data-download-source]')?.addEventListener('click', downloadSource)
    container.querySelector('[data-request-activate]')?.addEventListener('click', () => {
      page.confirmAction = 'activate'
      rerender()
      container.querySelector('#preview-confirm-dialog')?.showModal()
    })
    container.querySelector('[data-request-reject]')?.addEventListener('click', () => {
      page.confirmAction = 'reject'
      rerender()
      container.querySelector('#preview-confirm-dialog')?.showModal()
    })
    container.querySelector('[data-cancel-confirmation]')?.addEventListener('click', () => {
      container.querySelector('#preview-confirm-dialog')?.close()
      page.confirmAction = null
    })
    container.querySelector('[data-confirm-action]')?.addEventListener('click', performAction)
    function bindFilter(selector, values, datasetKey) {
      container.querySelectorAll(selector).forEach((input) => {
        input.addEventListener('change', () => {
          const value = input.dataset[datasetKey]
          if (input.checked) values.add(value)
          else values.delete(value)
          state.focusBounds = null
          rerender()
        })
      })
    }
  }

  function selectAsset(assetId) {
    page.state.selectedAssetId = assetId
    page.state.selectedIssueId = null
    page.state.focusBounds = calculateAssetBounds(page.model, assetId)
      ?? page.state.focusBounds
    page.state.zoom = 1
    render()
  }

  function navigateIssue(issueId, hintedAssetId) {
    const issue = page.model.payload.issues.find(({ id }) => id === issueId)
    const assetId = hintedAssetId
      || issue?.assetId
      || findAssetForSourceReference(page.model, issue)?.assetId
    page.state.selectedIssueId = issueId
    if (assetId) {
      page.state.selectedAssetId = assetId
      page.state.focusBounds = calculateAssetBounds(page.model, assetId)
      page.state.actionStatus = 'success'
      page.state.actionMessage = `Issue ${issue?.issueCode ?? ''} difokuskan pada ${assetId}.`
    } else {
      page.state.actionStatus = 'error'
      page.state.actionMessage = 'Issue ini tidak mempunyai referensi geometri yang dapat difokuskan.'
    }
    page.state.zoom = 1
    render()
  }

  function closeDrawer() {
    page.state.selectedAssetId = null
    page.state.selectedIssueId = null
    page.state.traceAssetIds.clear()
    page.state.focusBounds = null
    render()
  }

  function handleGlobalEscape(event) {
    if (event.key !== 'Escape' || page.status !== 'ready') return
    if (container.querySelector('#preview-confirm-dialog')?.open) return
    if (page.state.selectedAssetId) closeDrawer()
    else if (page.state.sidebarOpen) {
      page.state.sidebarOpen = false
      render()
    }
  }

  async function performAction() {
    const action = page.confirmAction
    container.querySelector('#preview-confirm-dialog')?.close()
    page.state.actionStatus = 'loading'
    page.state.actionMessage = action === 'activate'
      ? 'Mengaktifkan dataset version secara atomik…'
      : 'Menolak dataset version…'
    render()
    try {
      const result = action === 'activate'
        ? await activateDatasetVersion({
          token: getDefaultAdminToken(),
          datasetVersionId,
          expectedActiveVersionId:
            page.model.payload.comparison?.activeDatasetVersionId ?? null,
        })
        : await rejectDatasetVersion({
          token: getDefaultAdminToken(),
          datasetVersionId,
        })
      page.model.payload.datasetVersion = result.datasetVersion
      page.model.payload.canActivate = false
      if (action === 'activate') {
        page.model.payload.comparison.activeDatasetVersionId = result.datasetVersion.id
        page.model.payload.activeDatasetVersion = {
          datasetVersion: result.datasetVersion,
          layers: page.model.payload.layers,
          assets: page.model.payload.assets,
          geometries: page.model.payload.geometries,
          relations: page.model.payload.relations,
        }
        page.model.active = page.model.candidate
        page.state.activeMapUrl = result.mapUrl || '/map'
      }
      page.state.actionStatus = 'success'
      page.state.actionMessage = action === 'activate'
        ? `Dataset ${result.datasetVersion.versionName} sekarang aktif. Dataset aktif sebelumnya telah diarsipkan.`
        : `Dataset ${result.datasetVersion.versionName} telah ditolak dan diarsipkan.`
    } catch (error) {
      page.state.actionStatus = 'error'
      page.state.actionMessage = error.message
    }
    page.confirmAction = null
    render()
  }

  function downloadReport() {
    const report = {
      datasetVersion: page.model.payload.datasetVersion,
      validation: page.model.payload.validation,
      summary: page.model.payload.comparison?.summary,
      issues: page.model.payload.issues,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `validation-${datasetVersionId}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function downloadSource() {
    page.state.actionStatus = 'loading'
    page.state.actionMessage = 'Memverifikasi dan menyiapkan file sumber asli…'
    render()
    try {
      const source = await downloadDatasetSource({
        token: getDefaultAdminToken(),
        datasetVersionId,
      })
      const objectUrl = URL.createObjectURL(source.blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = source.filename
      anchor.hidden = true
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
      page.state.actionStatus = 'success'
      page.state.actionMessage = `File sumber ${source.filename} berhasil diverifikasi dan diunduh.`
    } catch (error) {
      page.state.actionStatus = 'error'
      page.state.actionMessage = error.message
    }
    render()
  }
}

function renderShell(page, datasetVersionId) {
  return `
    <div class="admin-preview-app">
      ${renderAdminHeader()}
      ${page.status === 'loading' ? renderLoading() : ''}
      ${page.status === 'error' ? renderError(page.error) : ''}
      ${page.status === 'ready' ? renderReady(page, datasetVersionId) : ''}
    </div>
  `
}

function renderReady(page, datasetVersionId) {
  const { model, state } = page
  const visible = getVisiblePreviewData(model, state)
  return `
    <main class="import-preview-workspace ${state.selectedAssetId ? 'drawer-open' : ''}">
      ${renderPreviewSidebar({ model, state })}
      <section class="import-preview-main" aria-label="Peta preview import">
        ${renderPreviewToolbar({ model, state })}
        <div class="import-preview-map">
          ${renderPreviewMapCanvas({ visible, state })}
        </div>
      </section>
      ${renderPreviewAssetDrawer({ model, state })}
      <div class="preview-mobile-backdrop" ${state.sidebarOpen ? '' : 'hidden'}></div>
    </main>
    ${renderActivationBar(model, state)}
    ${renderConfirmationDialog(page.confirmAction, model)}
  `
}

function renderAdminHeader() {
  return `
    <header class="admin-app-header">
      <a class="brand-lockup" href="/map" aria-label="SINERGI">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="brand-name">SINERGI</span>
      </a>
      <span class="admin-area-label">Administrasi dataset</span>
      <nav aria-label="Navigasi admin">
        <a href="/map">Peta jaringan</a>
        <button class="admin-user-menu" type="button" aria-label="Profil SSC ICT Administrator">
          <span class="material-symbols-outlined" aria-hidden="true">account_circle</span>
          <span><strong>SSC ICT</strong><small>Administrator</small></span>
        </button>
      </nav>
    </header>
  `
}

function renderLoading() {
  return `
    <main class="preview-page-state" aria-busy="true" aria-live="polite">
      <span class="material-symbols-outlined preview-spinner" aria-hidden="true">progress_activity</span>
      <strong>Menyiapkan preview import</strong>
      <p>Membaca aset, geometri, relasi, dan perbandingan dataset aktif.</p>
    </main>
  `
}

function renderError(message) {
  return `
    <main class="preview-page-state preview-page-error" role="alert">
      <span class="material-symbols-outlined" aria-hidden="true">error</span>
      <strong>Preview tidak dapat dimuat</strong>
      <p>${escapeHtml(message)}</p>
      <div>
        <a class="button secondary" href="/admin/datasets/import">Kembali</a>
        <button class="button primary" type="button" data-retry-preview>Coba lagi</button>
      </div>
    </main>
  `
}

export function renderActivationBar(model, state) {
  const { datasetVersion, validation, canActivate } = model.payload
  const blocking = validation?.summary?.blockingErrors
    ?? model.payload.issues.filter(({ canActivate: allowed }) => allowed === false).length
  const warnings = validation?.summary?.warnings
    ?? model.payload.issues.filter(({ severity }) => severity === 'warning').length
  const terminal = ['active', 'archived'].includes(datasetVersion.status)
  return `
    <footer class="preview-activation-bar">
      <div class="preview-version-details">
        ${renderImportStatusBadge(datasetVersion.status)}
        <span><small>Blocking errors</small><strong>${blocking}</strong></span>
        <span><small>Warnings</small><strong>${warnings}</strong></span>
        <span><small>Source filename</small><strong title="${escapeAttribute(datasetVersion.sourceFilename)}">${escapeHtml(datasetVersion.sourceFilename)}</strong></span>
        <span><small>Ukuran</small><strong>${formatFileSize(datasetVersion.sourceSize)}</strong></span>
        <span class="checksum-detail"><small>Checksum</small><strong
          title="${escapeAttribute(datasetVersion.checksum || 'Tidak tersedia')}">${escapeHtml(shortChecksum(datasetVersion.checksum))}</strong></span>
        <span><small>Uploader</small><strong>${escapeHtml(datasetVersion.importedBy || 'Tidak tersedia')}</strong></span>
        <span><small>Upload time</small><strong>${formatDate(datasetVersion.importedAt)}</strong></span>
      </div>
      <div class="preview-activation-actions">
        <a class="button secondary" href="/admin/datasets/import">
          <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>Kembali
        </a>
        <button class="button secondary source-file-download" type="button" data-download-source
          ${state.actionStatus === 'loading' ? 'disabled' : ''}
          title="Unduh byte file KML/KMZ asli, bukan export dataset">
          <span class="material-symbols-outlined" aria-hidden="true">file_download</span>
          Unduh file sumber
        </button>
        <button class="button secondary" type="button" data-download-report>
          <span class="material-symbols-outlined" aria-hidden="true">download</span>Unduh laporan
        </button>
        <button class="button danger-outline" type="button" data-request-reject
          ${terminal || state.actionStatus === 'loading' ? 'disabled' : ''}>
          Tolak versi
        </button>
        <button class="button primary" type="button" data-request-activate
          ${canActivate && !terminal && state.actionStatus !== 'loading' ? '' : 'disabled'}
          title="${canActivate ? 'Aktifkan dataset version ini' : 'Selesaikan blocking error sebelum aktivasi'}">
          <span class="material-symbols-outlined" aria-hidden="true">publish</span>Aktifkan dataset
        </button>
      </div>
    </footer>
  `
}

function renderConfirmationDialog(action, model) {
  const activate = action !== 'reject'
  return `
    <dialog id="preview-confirm-dialog" class="preview-confirm-dialog">
      <form method="dialog">
        <span class="confirmation-icon material-symbols-outlined" aria-hidden="true">
          ${activate ? 'publish' : 'archive'}
        </span>
        <h2>${activate ? 'Aktifkan dataset version?' : 'Tolak dataset version?'}</h2>
        <p>${activate
          ? 'Dataset aktif saat ini akan diarsipkan dan versi ini dipublikasikan sebagai satu operasi penuh. Aktivasi sebagian tidak dilakukan.'
          : 'Versi ini akan diarsipkan dan tidak dapat diaktifkan dari preview ini.'}</p>
        <dl>
          <div><dt>Versi</dt><dd>${escapeHtml(model.payload.datasetVersion.versionName)}</dd></div>
          <div><dt>Cabang</dt><dd>${escapeHtml(model.payload.datasetVersion.branchId)}</dd></div>
        </dl>
        <div>
          <button class="button secondary" type="button" data-cancel-confirmation>Batal</button>
          <button class="button ${activate ? 'primary' : 'danger'}" type="button" data-confirm-action>
            ${activate ? 'Ya, aktifkan dataset' : 'Ya, tolak versi'}
          </button>
        </div>
      </form>
    </dialog>
  `
}

function findAssetForSourceReference(model, issue) {
  if (!issue) return null
  return model.candidate.assets.find((asset) => (
    asset.sourcePlacemarkId === issue.geometryReference
      || asset.name === issue.sourcePlacemarkName
      || asset.properties?.sourceFolderPath === issue.sourceFolderPath
  ))
}

function formatDate(value) {
  if (!value) return 'Tidak tersedia'
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatFileSize(value) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) return 'Tidak tersedia'
  const bytes = Number(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function shortChecksum(value) {
  if (!value) return 'Tidak tersedia'
  const normalized = String(value).replace(/^sha256:/i, '')
  return `sha256:${normalized.slice(0, 12)}${normalized.length > 12 ? '…' : ''}`
}
