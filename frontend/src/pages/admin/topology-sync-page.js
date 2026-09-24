import '../../styles/topology-sync.css'
import { loadActiveDataset } from '../../services/active-dataset-service.js'
import { getDefaultAdminToken, loadImportConfig } from '../../services/import-dataset-service.js'
import {
  applyReconciliation,
  applyCorrections,
  createTopologyDraft,
  detectSyncPackageType,
  downloadSyncFile,
  exportBootstrap,
  exportCorrections,
  importBootstrap,
  initializeSync,
  loadDraftReview,
  previewCorrections,
  previewReconciliation,
  publishTopologyDraft,
  syncStatus,
} from '../../services/topology-sync-service.js'
import { escapeAttribute, escapeHtml } from './import-view-utils.js'

export async function renderTopologySyncPage(container) {
  document.title = 'Sinkronisasi Topologi — SINERGI'
  document.body.className = 'topology-sync-body'
  const state = {
    branches: [], branchId: '', datasetVersionId: '', status: null,
    draftVersionId: new URLSearchParams(window.location.search).get('draftVersionId') ?? '',
    stagedVersionId: '',
    draftReview: null, reviewConfirmed: false,
    exportOffset: 0,
    envelope: null, filename: '', passphrase: '', exportPassphrase: '', preview: null,
    resolutions: {}, message: '', error: '', exportError: '', exportMessage: '', busy: false,
  }

  function render() {
    const branch = state.branches.find(item => item.id === state.branchId)
    const packageType = detectSyncPackageType(state.envelope, state.filename)
    container.innerHTML = `
      <main class="sync-page">
        <header class="sync-header">
          <a href="/topology" class="sync-back" aria-label="Kembali ke diagram topologi">←</a>
          <div><span class="sync-eyebrow">SINERGI · Data workspace</span>
            <h1>Sinkronisasi topologi</h1>
            <p>Bertukar koreksi dua arah tanpa menaruh lokasi aset di GitHub.</p></div>
        </header>
        <section class="sync-card">
          <div class="sync-card-heading"><span class="material-symbols-outlined" aria-hidden="true">database</span>
            <div><h2>Dataset kerja</h2><p>Pilih cabang yang sedang kalian koreksi.</p></div></div>
          <label>Cabang
            <select id="sync-branch">${state.branches.map(item => `<option value="${escapeAttribute(item.id)}" ${item.id === state.branchId ? 'selected' : ''}>${escapeHtml(item.name ?? item.id)}</option>`).join('')}</select>
          </label>
          <div class="sync-dataset">${branch ? `Dataset: ${escapeHtml(branch.datasetId ?? '—')}` : 'Memuat cabang…'}<br>
            Versi kerja: <strong>${escapeHtml(state.datasetVersionId || 'Belum ada')}</strong>${state.draftVersionId ? ' · Draft' : ' · Aktif'}<br>
            Titik sinkronisasi: <strong>${escapeHtml(state.status?.syncId ?? 'Belum disiapkan')}</strong></div>
          ${state.datasetVersionId ? `<div class="sync-actions">
            <button type="button" data-action="initialize" ${state.status?.syncId || state.busy ? 'disabled' : ''}>Siapkan titik awal</button>
            ${state.draftVersionId ? `<a class="sync-link" href="/topology?draftVersionId=${encodeURIComponent(state.draftVersionId)}">Buka diagram draft</a>
              <button type="button" data-action="review-draft">Tinjau publikasi</button>`
              : `<button type="button" data-action="create-draft" ${!state.status?.syncId || state.busy ? 'disabled' : ''}>Buat draft untuk deploy</button>`}
          </div>
          ${state.status?.syncId ? `<label for="sync-export-passphrase">Kata sandi untuk file unduhan
            <input id="sync-export-passphrase" type="password" minlength="12" autocomplete="off" placeholder="Minimal 12 karakter" value="${escapeAttribute(state.exportPassphrase)}">
          </label><p class="sync-hint">Kata sandi ini dipakai untuk mengenkripsi paket awal dan paket koreksi.</p>`
            : '<p class="sync-hint sync-next-step">Siapkan titik awal sebelum mengunduh paket koreksi.</p>'}
          <div class="sync-actions">
            <button type="button" data-action="bootstrap-export" ${!state.status?.syncId || state.busy ? 'disabled' : ''}>Unduh paket awal</button>
            <button type="button" data-action="export" ${!state.status?.syncId || state.busy ? 'disabled' : ''}>Unduh koreksi (${state.status?.pendingChanges ?? 0})${(state.status?.pendingChanges ?? 0) > 200 ? ` · bagian ${Math.floor(state.exportOffset / 200) + 1}` : ''}</button>
          </div>
          ${state.exportError ? `<p class="sync-alert" role="alert">${escapeHtml(state.exportError)}</p>` : ''}
          ${state.exportMessage ? `<p class="sync-success" role="status">${escapeHtml(state.exportMessage)}</p>` : ''}` : ''}
          ${state.stagedVersionId ? `<a class="sync-link" href="/admin/datasets/import/${encodeURIComponent(state.stagedVersionId)}/preview">Tinjau & aktifkan paket awal</a>` : ''}
        </section>
        <section class="sync-card">
          <div class="sync-card-heading"><span class="material-symbols-outlined" aria-hidden="true">sync_alt</span>
            <div><h2>Terima paket</h2><p>Paket koreksi untuk titik awal yang sama. Paket awal dari rekan bisa dipakai untuk menyelaraskan dua impor KMZ terpisah.</p></div></div>
          <p class="sync-field-title">File paket terenkripsi</p>
          <input id="sync-file" class="sync-file-input" type="file" accept=".json,application/json" aria-describedby="sync-file-description">
          <label for="sync-file" class="sync-file-picker"><span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
            <span class="sync-file-picker-name">${escapeHtml(state.filename || 'Pilih file paket')}</span>
            <span class="sync-file-picker-action">${state.filename ? 'Ganti file' : 'Pilih file'}</span></label>
          <p id="sync-file-description" class="sync-hint">${packageType === 'correction'
            ? 'Ini paket koreksi. Gunakan “Periksa koreksi”. Untuk dua impor KMZ terpisah, minta paket awal dari rekan.'
            : packageType === 'bootstrap'
              ? 'Ini paket awal. Gunakan “Selaraskan dari paket awal rekan” jika dataset sudah ada.'
              : packageType === 'unknown' ? 'Jenis paket tidak dikenal. Pilih file paket awal atau koreksi yang diunduh dari halaman ini.'
                : 'Pilih paket koreksi atau paket awal terenkripsi dari rekan.'}</p>
          <label>Kata sandi paket <input id="sync-passphrase" type="password" minlength="12" autocomplete="off" placeholder="Minimal 12 karakter" value="${escapeAttribute(state.passphrase)}"></label>
          <p class="sync-hint">Kirim file dan kata sandinya melalui kanal berbeda. Jangan commit file paket ke Git.</p>
          <div class="sync-actions">
            <button type="button" data-action="preview" ${packageType !== 'correction' || !state.datasetVersionId || state.busy ? 'disabled' : ''}>Periksa koreksi</button>
            <button type="button" data-action="bootstrap-import" ${packageType !== 'bootstrap' || state.datasetVersionId || state.busy ? 'disabled' : ''}>Impor paket awal</button>
            <button type="button" data-action="reconcile-preview" ${packageType !== 'bootstrap' || !state.datasetVersionId || state.draftVersionId || state.busy ? 'disabled' : ''}>Selaraskan dari paket awal rekan</button>
          </div>
        </section>
        ${state.preview ? renderPreview(state) : ''}
        ${state.draftReview ? renderDraftReview(state) : ''}
        ${state.error ? `<p class="sync-alert" role="alert">${escapeHtml(state.error)}</p>` : ''}
        ${state.message ? `<p class="sync-success" role="status">${escapeHtml(state.message)}</p>` : ''}
      </main>`
    bind()
  }

  function bind() {
    container.querySelector('#sync-branch')?.addEventListener('change', event => {
      state.branchId = event.target.value
      state.draftVersionId = ''
      state.draftReview = null
      window.history.replaceState({}, '', '/admin/topology-sync')
      state.exportOffset = 0
      state.exportError = ''
      state.exportMessage = ''
      state.preview = null
      void loadBranch()
    })
    container.querySelector('#sync-passphrase')?.addEventListener('input', event => {
      state.passphrase = event.target.value
    })
    container.querySelector('#sync-export-passphrase')?.addEventListener('input', event => {
      state.exportPassphrase = event.target.value
      if (state.exportError) {
        state.exportError = ''
        container.querySelector('.sync-card .sync-alert')?.remove()
      }
    })
    container.querySelector('#sync-file')?.addEventListener('change', async event => {
      const file = event.target.files?.[0]
      state.envelope = null
      state.preview = null
      state.filename = file?.name ?? ''
      state.error = ''
      if (file) {
        try { state.envelope = JSON.parse(await file.text()) }
        catch { state.error = 'File paket bukan JSON yang valid.' }
      }
      render()
    })
    container.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', () => void run(button.dataset.action))
    })
    container.querySelectorAll('[data-resolution]').forEach(input => {
      input.addEventListener('change', () => {
        state.resolutions[input.dataset.resolution] = input.value
        render()
      })
    })
    container.querySelector('#sync-review-confirm')?.addEventListener('change', event => {
      state.reviewConfirmed = event.target.checked
      render()
    })
  }

  async function loadBranch() {
    const branch = state.branches.find(item => item.id === state.branchId)
    state.datasetVersionId = ''
    state.status = null
    if (!branch?.datasetId) { render(); return }
    try {
      const payload = await loadActiveDataset({
        datasetId: branch.datasetId, branchId: branch.id,
        view: 'topology', token: getDefaultAdminToken(),
      })
      state.datasetVersionId = payload.activeContext?.datasetVersionId
        ?? payload.context?.datasetVersionId ?? payload.datasetVersion?.id ?? ''
      if (state.draftVersionId) state.datasetVersionId = state.draftVersionId
      if (state.datasetVersionId) {
        state.status = await syncStatus(state.datasetVersionId)
        if (state.exportOffset >= (state.status.pendingChanges ?? 0)) state.exportOffset = 0
      }
    } catch (error) {
      if (error.status !== 404) state.error = error.message
    }
    render()
  }

  async function run(action) {
    if (state.busy) return
    const exporting = ['bootstrap-export', 'export'].includes(action)
    if (exporting && state.exportPassphrase.length < 12) {
      state.exportError = 'Isi kata sandi file unduhan, minimal 12 karakter.'
      render()
      container.querySelector('#sync-export-passphrase')?.focus()
      return
    }
    if (['bootstrap-import', 'preview', 'apply', 'reconcile-preview', 'reconcile-apply'].includes(action)
      && state.passphrase.length < 12) {
      state.error = 'Masukkan kata sandi minimal 12 karakter.'
      render()
      container.querySelector('#sync-passphrase')?.focus()
      return
    }
    state.busy = true
    state.error = ''
    state.exportError = ''
    state.exportMessage = ''
    state.message = ''
    render()
    try {
      const id = state.datasetVersionId
      if (action === 'initialize') {
        state.status = await initializeSync(id, state.status.recordRevision)
        state.message = 'Titik awal dibuat. Unduh paket awal untuk laptop lain.'
      } else if (action === 'create-draft') {
        const draft = await createTopologyDraft(id)
        window.location.assign(`/admin/topology-sync?draftVersionId=${encodeURIComponent(draft.datasetVersionId)}`)
        return
      } else if (action === 'bootstrap-export') {
        downloadSyncFile(await exportBootstrap(id, state.exportPassphrase), `sinergi-awal-${id}.sinergi-sync.json`)
        state.exportMessage = 'Paket awal terenkripsi berhasil diunduh.'
      } else if (action === 'export') {
        const page = Math.floor(state.exportOffset / 200) + 1
        downloadSyncFile(await exportCorrections(id, state.exportPassphrase, state.exportOffset),
          `sinergi-koreksi-${id}-${page}.sinergi-sync.json`)
        const total = state.status?.pendingChanges ?? 0
        state.exportOffset = state.exportOffset + 200 < total ? state.exportOffset + 200 : 0
        state.exportMessage = total > 200
          ? `Bagian ${page} berhasil diunduh. Kirim semua bagian ke rekanmu.`
          : 'Paket koreksi terenkripsi berhasil diunduh.'
      } else if (action === 'bootstrap-import') {
        const result = await importBootstrap(state.envelope, state.passphrase)
        state.message = result.message
        state.stagedVersionId = result.datasetVersionId
        state.envelope = null
        state.filename = ''
        state.passphrase = ''
        await loadBranch()
      } else if (action === 'preview') {
        state.preview = await previewCorrections(id, state.envelope, state.passphrase)
        state.resolutions = {}
      } else if (action === 'reconcile-preview') {
        state.preview = await previewReconciliation(id, state.envelope, state.passphrase)
        state.resolutions = {}
      } else if (action === 'review-draft') {
        state.draftReview = await loadDraftReview(id)
        state.reviewConfirmed = false
      } else if (action === 'publish-draft') {
        if (!state.reviewConfirmed) throw new Error('Tinjau dan centang persetujuan publikasi.')
        const result = await publishTopologyDraft(id, state.draftReview.reviewHash)
        state.message = `${result.reviewedChangeCount} koreksi diterbitkan.`
        state.draftReview = null
        state.draftVersionId = ''
        window.history.replaceState({}, '', '/admin/topology-sync')
        await loadBranch()
      } else if (action === 'apply') {
        const unresolved = state.preview.changes.filter(item => item.status === 'conflict'
          && !state.resolutions[item.id])
        if (unresolved.length) throw new Error('Pilih hasil untuk setiap konflik dahulu.')
        const result = await applyCorrections(id, state.envelope, state.passphrase,
          state.preview.recordRevision, state.resolutions)
        state.status = result.status
        state.preview = null
        state.message = `${result.applied} koreksi diterapkan. Muat ulang diagram untuk melihat hasil.`
      } else if (action === 'reconcile-apply') {
        const unresolved = state.preview.changes.filter(item => item.status === 'conflict'
          && !state.resolutions[item.id])
        if (unresolved.length) throw new Error('Pilih hasil untuk setiap konflik dahulu.')
        const result = await applyReconciliation(id, state.envelope, state.passphrase,
          state.preview.recordRevision, state.resolutions)
        window.location.assign(`/admin/topology-sync?draftVersionId=${encodeURIComponent(result.datasetVersionId)}`)
        return
      }
    } catch (error) {
      if (exporting) state.exportError = error.message
      else state.error = error.message
    } finally {
      state.busy = false
      render()
    }
  }

  render()
  try {
    const config = await loadImportConfig({ token: getDefaultAdminToken() })
    state.branches = config.branches ?? []
    state.branchId = state.branches[0]?.id ?? ''
    if (state.draftVersionId) {
      const draftStatus = await syncStatus(state.draftVersionId)
      state.branchId = draftStatus.source?.branchId ?? state.branchId
    }
    await loadBranch()
  } catch (error) {
    state.error = error.message
    render()
  }
}

function renderPreview(state) {
  const preview = state.preview
  const unresolved = preview.changes.some(item => item.status === 'conflict'
    && !state.resolutions[item.id])
  return `<section class="sync-card sync-preview">
    <div class="sync-card-heading"><span class="material-symbols-outlined" aria-hidden="true">fact_check</span>
      <div><h2>${preview.mode === 'reconciliation' ? 'Pratinjau penyelarasan' : 'Pratinjau koreksi'}</h2><p>${preview.summary.ready} baru · ${preview.summary.alreadyApplied} sudah diterima · ${preview.summary.conflict} konflik</p></div></div>
    ${preview.mode === 'reconciliation' ? '<p class="sync-hint">Pastikan kamu sudah mengunduh paket awal milikmu sebagai cadangan. Hasil penyelarasan akan dibuat sebagai draft dan perlu ditinjau sebelum diterbitkan.</p>' : ''}
    ${preview.changes.some(item => item.relatedConflict) ? '<p class="sync-alert" role="alert">Ada relasi yang memakai aset sama dengan relasi lokal lain. Periksa relasi tersebut di diagram sebelum menyelaraskan.</p>' : ''}
    <div class="sync-change-list">${preview.changes.map(change => `
      <div class="sync-change">
        <div><strong>${escapeHtml(labelFor(change.key))}</strong><span class="sync-badge ${change.status}">${escapeHtml(statusFor(change.status))}</span></div>
        <small>Lokal: ${escapeHtml(valueFor(change.local))}<br>Dari paket: ${escapeHtml(valueFor(change.after))}</small>
        ${change.status === 'conflict' ? `<fieldset><legend>Pilih hasil</legend>
          <label><input type="radio" name="resolve-${escapeAttribute(change.id)}" data-resolution="${escapeAttribute(change.id)}" value="local" ${state.resolutions[change.id] === 'local' ? 'checked' : ''}> Simpan lokal</label>
          <label><input type="radio" name="resolve-${escapeAttribute(change.id)}" data-resolution="${escapeAttribute(change.id)}" value="remote" ${state.resolutions[change.id] === 'remote' ? 'checked' : ''}> Pakai paket</label>
        </fieldset>` : ''}
      </div>`).join('') || '<p>Tidak ada perubahan dalam paket ini.</p>'}</div>
    <button type="button" class="sync-primary" data-action="${preview.mode === 'reconciliation' ? 'reconcile-apply' : 'apply'}" ${unresolved || preview.changes.some(item => item.relatedConflict) || state.busy ? 'disabled' : ''}>${preview.mode === 'reconciliation' ? 'Buat draft hasil penyelarasan' : 'Terapkan koreksi'}</button>
  </section>`
}

function renderDraftReview(state) {
  const review = state.draftReview
  return `<section class="sync-card sync-preview">
    <div class="sync-card-heading"><span class="material-symbols-outlined" aria-hidden="true">publish</span>
      <div><h2>Tinjau sebelum terbit</h2><p>${review.changes.length} koreksi terhadap versi aktif ${escapeHtml(review.baseDatasetVersionId)}</p></div></div>
    <div class="sync-change-list">${review.changes.map(change => `
      <div class="sync-change"><strong>${escapeHtml(labelFor(change.key))}</strong>
        <small><br>Saat ini: ${escapeHtml(valueFor(change.before))}<br>Setelah terbit: ${escapeHtml(valueFor(change.after))}</small>
      </div>`).join('') || '<p>Draft belum memiliki perubahan untuk diterbitkan.</p>'}</div>
    <label class="sync-review-check"><input id="sync-review-confirm" type="checkbox" ${state.reviewConfirmed ? 'checked' : ''}>
      Saya sudah memeriksa perubahan ini dan ingin menerbitkannya.</label>
    <button type="button" class="sync-primary" data-action="publish-draft"
      ${!state.reviewConfirmed || !review.changes.length || state.busy ? 'disabled' : ''}>Terbitkan versi</button>
  </section>`
}

function labelFor(key) {
  const [kind, ...rest] = key.split(':')
  return `${{
    mount: 'Penempatan fisik', 'frame-assignment': 'Frame aset',
    'frame-name': 'Nama frame', frame: 'Frame baru', edge: 'Garis dihapus',
    relation: 'Relasi baru',
    'sync-baseline': 'Titik awal sinkronisasi',
  }[kind] ?? 'Koreksi'} · ${rest.join(':')}`
}

function statusFor(status) {
  return { ready: 'Baru', 'already-applied': 'Sudah diterima', conflict: 'Konflik' }[status]
}

function valueFor(value) {
  if (value === null || value === undefined) return 'Belum diatur'
  if (typeof value === 'string') return value
  if (value.action === 'detach') return 'Dilepas dari tiang'
  if (value.targetAssetId) return value.targetAssetId
  if (value.source && value.target) return `${value.source} ↔ ${value.target}`
  if (value.edgeId) return value.edgeId
  return JSON.stringify(value)
}
