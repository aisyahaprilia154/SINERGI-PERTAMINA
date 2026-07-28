import {
  getDefaultAdminToken,
  loadImportConfig,
  loadImportStatus,
  uploadDataset,
} from '../../services/import-dataset-service.js'
import { renderImportDatasetForm } from './import-dataset-form.js'
import { validateImportFile } from './import-dataset-state.js'
import { renderImportProgress } from './import-progress.js'
import { renderImportStatusBadge } from './import-status-badge.js'
import { renderImportSummary } from './import-summary.js'
import { escapeAttribute, escapeHtml } from './import-view-utils.js'

export function renderImportDatasetPage(container) {
  document.title = 'Import Dataset KML/KMZ — SINERGI'
  document.body.className = 'admin-import-body'

  const state = {
    configStatus: 'loading',
    config: null,
    configError: null,
    phase: 'idle',
    values: {
      branchId: '',
      versionName: createDefaultVersionName(),
      versionNote: '',
      officialSourceConfirmed: false,
    },
    selectedFile: null,
    fileValidation: null,
    fieldErrors: {},
    uploadPercent: null,
    backendStatus: null,
    uploadResponse: null,
    statusUrl: null,
    startedAt: null,
    errorMessage: null,
    processMessage: null,
    reportOpen: false,
    previewOpen: false,
    issueFilter: 'all',
    controller: null,
    elapsedTimer: null,
  }

  loadConfig()

  async function loadConfig() {
    state.configStatus = 'loading'
    state.configError = null
    render()
    try {
      state.config = await loadImportConfig({ token: getDefaultAdminToken() })
      state.configStatus = 'ready'
      state.values.branchId = state.config.branches[0]?.id ?? ''
    } catch (error) {
      state.configStatus = 'error'
      state.configError = error.message
    }
    render()
  }

  function render() {
    container.innerHTML = renderShell(state)
    bindEvents()
  }

  function bindEvents() {
    container.querySelector('.retry-import-config')?.addEventListener('click', loadConfig)
    if (state.configStatus !== 'ready') return

    const form = container.querySelector('#import-dataset-form')
    form?.addEventListener('submit', handleSubmit)
    form?.querySelector('[name="branchId"]')?.addEventListener('change', (event) => {
      state.values.branchId = event.target.value
      render()
    })
    form?.querySelector('[name="versionName"]')?.addEventListener('input', (event) => {
      state.values.versionName = event.target.value
    })
    form?.querySelector('[name="versionNote"]')?.addEventListener('input', (event) => {
      state.values.versionNote = event.target.value
    })
    form?.querySelector('[name="officialSourceConfirmed"]')
      ?.addEventListener('change', (event) => {
        state.values.officialSourceConfirmed = event.target.checked
      })

    const fileInput = container.querySelector('#dataset-file')
    fileInput?.addEventListener('change', () => selectFiles(fileInput.files))
    container.querySelector('[data-dropzone-trigger]')
      ?.addEventListener('click', () => fileInput?.click())
    container.querySelector('.replace-import-file')
      ?.addEventListener('click', () => fileInput?.click())
    container.querySelector('.remove-import-file')?.addEventListener('click', () => {
      state.selectedFile = null
      state.fileValidation = null
      render()
    })

    const dropTarget = container.querySelector('[data-dropzone-trigger]')
      ?? container.querySelector('.selected-import-file')
    if (dropTarget) {
      for (const eventName of ['dragenter', 'dragover']) {
        dropTarget.addEventListener(eventName, (event) => {
          event.preventDefault()
          dropTarget.classList.add('is-dragging')
        })
      }
      for (const eventName of ['dragleave', 'drop']) {
        dropTarget.addEventListener(eventName, (event) => {
          event.preventDefault()
          dropTarget.classList.remove('is-dragging')
        })
      }
      dropTarget.addEventListener('drop', (event) => selectFiles(event.dataTransfer.files))
    }

    container.querySelector('.cancel-import')?.addEventListener('click', cancelImport)
    container.querySelector('.cancel-import-draft')?.addEventListener('click', resetImport)
    container.querySelector('.retry-import')?.addEventListener('click', retryImport)
    container.querySelector('.upload-again')?.addEventListener('click', resetImport)
    container.querySelector('.open-validation-report')?.addEventListener('click', () => {
      state.reportOpen = !state.reportOpen
      state.previewOpen = false
      render()
    })
    container.querySelector('.open-import-preview')?.addEventListener('click', () => {
      const datasetVersionId = state.backendStatus?.datasetVersion?.id
      if (datasetVersionId) {
        window.location.assign(
          `/admin/datasets/import/${encodeURIComponent(datasetVersionId)}/preview`,
        )
      }
    })
    container.querySelector('.issue-filter')?.addEventListener('change', (event) => {
      state.issueFilter = event.target.value
      render()
    })
  }

  function selectFiles(fileList) {
    if (!fileList?.length) return
    if (fileList.length > 1) {
      state.selectedFile = null
      state.fileValidation = {
        valid: false,
        error: 'Pilih hanya satu file KML atau KMZ.',
      }
      render()
      return
    }
    state.selectedFile = fileList[0]
    state.fileValidation = validateImportFile(
      state.selectedFile,
      state.config.limits.maxFileSize,
    )
    state.fieldErrors = {}
    render()
  }

  async function handleSubmit(event) {
    event.preventDefault()
    readFormValues(event.currentTarget)
    state.fileValidation = validateImportFile(
      state.selectedFile,
      state.config.limits.maxFileSize,
    )
    state.fieldErrors = validateFields(state)
    if (Object.keys(state.fieldErrors).length || !state.fileValidation.valid) {
      render()
      return
    }

    const branch = state.config.branches.find(({ id }) => id === state.values.branchId)
    state.phase = 'uploading'
    state.startedAt = Date.now()
    state.uploadPercent = null
    state.errorMessage = null
    state.processMessage = null
    state.controller = new AbortController()
    startElapsedTimer()
    render()

    try {
      const response = await uploadDataset({
        token: getDefaultAdminToken(),
        fields: {
          branchId: state.values.branchId,
          datasetId: branch?.datasetId,
          versionName: state.values.versionName,
          versionNote: state.values.versionNote,
          officialSourceConfirmed: state.values.officialSourceConfirmed,
        },
        file: state.selectedFile,
        signal: state.controller.signal,
        onProgress: (percent) => {
          state.uploadPercent = percent
          render()
        },
      })
      state.uploadResponse = response
      state.statusUrl = response.statusUrl
      state.phase = 'processing'
      state.backendStatus = {
        datasetVersion: response.datasetVersion,
        processing: response.processing,
      }
      render()
      await pollStatus()
    } catch (error) {
      if (error.name === 'AbortError') return
      state.phase = 'error'
      state.errorMessage = error.message
      stopElapsedTimer()
      render()
    }
  }

  async function pollStatus() {
    while (state.phase === 'processing' && !state.controller.signal.aborted) {
      try {
        const status = await loadImportStatus({
          token: getDefaultAdminToken(),
          statusUrl: state.statusUrl,
          signal: state.controller.signal,
        })
        state.backendStatus = status
        if (['valid', 'invalid'].includes(status.datasetVersion.status)) {
          state.phase = status.datasetVersion.status === 'valid' ? 'success' : 'invalid'
          stopElapsedTimer()
          render()
          return
        }
        render()
        await delay(500, state.controller.signal)
      } catch (error) {
        if (error.name === 'AbortError') return
        state.phase = 'error'
        state.errorMessage = error.message
        stopElapsedTimer()
        render()
        return
      }
    }
  }

  function cancelImport() {
    const wasAccepted = Boolean(state.statusUrl)
    state.controller?.abort()
    stopElapsedTimer()
    state.phase = 'cancelled'
    state.processMessage = wasAccepted
      ? 'Pemantauan dihentikan. Backend tidak mendukung pembatalan job setelah file diterima; proses server dapat tetap berjalan.'
      : 'Upload dibatalkan sebelum request selesai.'
    render()
  }

  function retryImport() {
    if (state.statusUrl) {
      state.phase = 'processing'
      state.errorMessage = null
      state.controller = new AbortController()
      startElapsedTimer()
      render()
      pollStatus()
      return
    }
    state.phase = 'idle'
    state.errorMessage = null
    render()
  }

  function resetImport() {
    state.controller?.abort()
    stopElapsedTimer()
    state.phase = 'idle'
    state.selectedFile = null
    state.fileValidation = null
    state.fieldErrors = {}
    state.uploadPercent = null
    state.backendStatus = null
    state.uploadResponse = null
    state.statusUrl = null
    state.startedAt = null
    state.errorMessage = null
    state.processMessage = null
    state.reportOpen = false
    state.previewOpen = false
    state.issueFilter = 'all'
    state.values.versionName = createDefaultVersionName()
    state.values.versionNote = ''
    state.values.officialSourceConfirmed = false
    render()
  }

  function readFormValues(form) {
    const data = new FormData(form)
    state.values.branchId = String(data.get('branchId') ?? state.values.branchId)
    state.values.versionName = String(data.get('versionName') ?? '').trim()
    state.values.versionNote = String(data.get('versionNote') ?? '').trim()
    state.values.officialSourceConfirmed = data.get('officialSourceConfirmed') === 'on'
  }

  function startElapsedTimer() {
    stopElapsedTimer()
    state.elapsedTimer = window.setInterval(() => {
      if (['uploading', 'processing'].includes(state.phase)) render()
    }, 1000)
  }

  function stopElapsedTimer() {
    if (state.elapsedTimer) window.clearInterval(state.elapsedTimer)
    state.elapsedTimer = null
  }
}

function renderShell(state) {
  return `
    <div class="admin-import-app">
      ${renderAdminHeader()}
      <main class="admin-import-main">
        <header class="admin-page-heading">
          <div>
            <nav aria-label="Breadcrumb">
              <a href="/admin/datasets">Dataset</a>
              <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
              <span>Import dataset</span>
            </nav>
            <h1>Import Dataset KML/KMZ</h1>
            <p>Buat dataset version baru untuk diperiksa sebelum aktivasi.</p>
          </div>
          ${renderImportStatusBadge(
            state.configStatus === 'loading' ? 'loading' : state.phase,
          )}
        </header>

        ${renderContent(state)}
      </main>
    </div>
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

function renderContent(state) {
  if (state.configStatus === 'loading') {
    return `
      <section class="admin-loading-state" aria-live="polite" aria-busy="true">
        <span class="material-symbols-outlined" aria-hidden="true">progress_activity</span>
        <strong>Memuat konfigurasi import</strong>
        <p>Membaca daftar cabang dan batas file dari server.</p>
      </section>
    `
  }
  if (state.configStatus === 'error') {
    return `
      <section class="admin-error-state" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        <div>
          <strong>Konfigurasi import tidak dapat dimuat</strong>
          <p>${escapeHtml(state.configError)}</p>
          <button class="button secondary retry-import-config" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
            Coba lagi
          </button>
        </div>
      </section>
    `
  }

  const busy = ['uploading', 'processing'].includes(state.phase)
  const completed = ['success', 'invalid'].includes(state.phase)
  return `
    <div class="admin-import-layout">
      ${!completed ? renderImportDatasetForm({
        config: state.config,
        values: state.values,
        file: state.selectedFile,
        fileValidation: state.fileValidation,
        fieldErrors: state.fieldErrors,
        disabled: busy,
      }) : ''}

      ${['uploading', 'processing', 'success', 'invalid', 'cancelled'].includes(state.phase)
        ? renderImportProgress({
          phase: state.phase,
          backendStage: state.backendStatus?.processing?.stage,
          backendProgress: state.backendStatus?.processing?.progress,
          uploadPercent: state.uploadPercent,
          fileExtension: extensionOf(state.selectedFile?.name),
          startedAt: state.startedAt,
          now: Date.now(),
          message: state.processMessage,
        })
        : ''}

      ${state.phase === 'error' ? renderErrorState(state) : ''}
      ${completed ? renderCompletedState(state) : ''}
      ${state.phase === 'cancelled' ? renderCancelledActions(state) : ''}
      ${busy ? `
        <div class="processing-actions">
          <button class="button secondary cancel-import" type="button">Batal</button>
        </div>
      ` : ''}
    </div>
  `
}

function renderCompletedState(state) {
  const status = state.backendStatus
  return `
    ${renderImportSummary({
      datasetVersion: status.datasetVersion,
      validation: status.validation,
      issues: status.issues,
    })}
    <div class="import-result-actions">
      <button class="button secondary upload-again" type="button">
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
        Upload ulang
      </button>
      <span></span>
      <button class="button secondary open-validation-report" type="button"
        aria-expanded="${state.reportOpen}">
        <span class="material-symbols-outlined" aria-hidden="true">fact_check</span>
        Lihat laporan validasi
      </button>
      <button class="button primary open-import-preview" type="button"
        aria-label="Buka preview peta hasil import">
        <span class="material-symbols-outlined" aria-hidden="true">preview</span>
        Lihat preview
      </button>
    </div>
    ${state.reportOpen ? renderValidationReport(state) : ''}
  `
}

function renderValidationReport(state) {
  const issues = state.backendStatus?.issues ?? []
  const filtered = state.issueFilter === 'all'
    ? issues
    : issues.filter((issue) => issue.severity === state.issueFilter)
  return `
    <section class="validation-report-panel" aria-labelledby="validation-report-title">
      <header class="import-section-header">
        <div>
          <span class="section-kicker">IMPORT ISSUES</span>
          <h2 id="validation-report-title">Laporan validasi</h2>
        </div>
        <label>
          <span class="visually-hidden">Filter issue</span>
          <select class="issue-filter">
            ${['all', 'error', 'warning', 'information'].map((filter) => `
              <option value="${filter}" ${state.issueFilter === filter ? 'selected' : ''}>
                ${filter === 'all' ? 'Semua issue' : capitalize(filter)}
              </option>
            `).join('')}
          </select>
        </label>
      </header>
      ${filtered.length ? `
        <ul class="validation-issue-list">
          ${filtered.map((issue) => `
            <li class="issue-${escapeAttribute(issue.severity)}">
              <span class="material-symbols-outlined" aria-hidden="true">
                ${issue.severity === 'error'
                  ? 'error'
                  : issue.severity === 'warning' ? 'warning' : 'info'}
              </span>
              <span>
                <strong>${escapeHtml(issue.issueCode)}</strong>
                <p>${escapeHtml(issue.message)}</p>
                <small>
                  ${escapeHtml(issue.scope ?? 'processing')}
                  ${issue.assetId ? ` · ${escapeHtml(issue.assetId)}` : ''}
                </small>
              </span>
            </li>
          `).join('')}
        </ul>
      ` : '<p class="panel-empty-state">Tidak ada issue untuk filter ini.</p>'}
    </section>
  `
}

function renderErrorState(state) {
  return `
    <section class="admin-error-state" role="alert">
      <span class="material-symbols-outlined" aria-hidden="true">error</span>
      <div>
        <strong>Import tidak dapat dilanjutkan</strong>
        <p>${escapeHtml(state.errorMessage)}</p>
        <button class="button secondary retry-import" type="button">
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
          Coba lagi
        </button>
      </div>
    </section>
  `
}

function renderCancelledActions(state) {
  return `
    <div class="import-result-actions">
      <button class="button secondary upload-again" type="button">Upload ulang</button>
      ${state.statusUrl ? `
        <button class="button primary retry-import" type="button">
          Lanjutkan pemantauan
        </button>
      ` : ''}
    </div>
  `
}

function validateFields(state) {
  const errors = {}
  if (!state.values.branchId) errors.branchId = 'Kantor cabang wajib dipilih.'
  if (!state.values.versionName) errors.versionName = 'Identitas versi wajib diisi.'
  if (!state.values.officialSourceConfirmed) {
    errors.confirmed = 'Konfirmasi sumber resmi wajib diberikan sebelum import.'
  }
  return errors
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timeout)
      const error = new Error('Dibatalkan')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
}

function extensionOf(filename) {
  const normalized = String(filename ?? '').toLowerCase()
  const index = normalized.lastIndexOf('.')
  return index >= 0 ? normalized.slice(index) : null
}

function createDefaultVersionName() {
  return `Import ${new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date())}`
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
