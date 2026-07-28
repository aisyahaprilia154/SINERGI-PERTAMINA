import { renderDatasetDropzone } from './dataset-dropzone.js'
import { escapeAttribute, escapeHtml } from './import-view-utils.js'

export function renderImportDatasetForm({
  config,
  values,
  file,
  fileValidation,
  fieldErrors = {},
  disabled = false,
} = {}) {
  const branches = config?.branches ?? []
  const selectedBranch = branches.find((branch) => branch.id === values.branchId)
    ?? branches[0]
  return `
    <form class="import-dataset-form" id="import-dataset-form" novalidate>
      <section class="import-form-card" aria-labelledby="import-form-title">
        <header class="import-section-header">
          <div>
            <span class="section-kicker">DATASET VERSION BARU</span>
            <h2 id="import-form-title">Informasi import</h2>
          </div>
          <span class="read-only-badge">
            <span class="material-symbols-outlined" aria-hidden="true">lock</span>
            Tidak mengubah versi aktif
          </span>
        </header>

        <div class="import-form-grid">
          <label class="admin-field">
            <span>Kantor cabang <i>Wajib</i></span>
            <select name="branchId" ${disabled ? 'disabled' : ''}>
              ${branches.map((branch) => `
                <option value="${escapeAttribute(branch.id)}"
                  ${branch.id === selectedBranch?.id ? 'selected' : ''}>
                  ${escapeHtml(branch.name)}
                </option>
              `).join('')}
            </select>
            ${renderFieldError(fieldErrors.branchId)}
          </label>

          <label class="admin-field">
            <span>Dataset tujuan <i>Wajib</i></span>
            <select name="datasetId" disabled>
              <option value="${escapeAttribute(selectedBranch?.datasetId ?? '')}">
                ${escapeHtml(selectedBranch?.datasetId ?? 'Dataset belum dikonfigurasi')}
              </option>
            </select>
            <small>Version baru dibuat tanpa mengganti dataset aktif.</small>
          </label>

          <label class="admin-field">
            <span>Identitas versi <i>Wajib</i></span>
            <input name="versionName" type="text" maxlength="120"
              value="${escapeAttribute(values.versionName)}"
              placeholder="Contoh: Import jaringan Juli 2026"
              ${fieldErrors.versionName ? 'aria-invalid="true"' : ''}
              ${disabled ? 'disabled' : ''} />
            ${renderFieldError(fieldErrors.versionName)}
          </label>

          <label class="admin-field admin-field-wide">
            <span>Catatan versi <em>Opsional</em></span>
            <textarea name="versionNote" maxlength="1000" rows="3"
              placeholder="Jelaskan sumber atau cakupan perubahan dataset"
              ${disabled ? 'disabled' : ''}>${escapeHtml(values.versionNote)}</textarea>
            <small>Maksimum 1.000 karakter. Jangan masukkan credential atau data rahasia.</small>
          </label>
        </div>

        ${renderDatasetDropzone({
          file,
          fileValidation,
          disabled,
          maxFileSize: config?.limits?.maxFileSize ?? 50 * 1024 * 1024,
        })}

        <label class="official-source-confirmation ${fieldErrors.confirmed ? 'has-error' : ''}">
          <input name="officialSourceConfirmed" type="checkbox"
            ${values.officialSourceConfirmed ? 'checked' : ''}
            ${disabled ? 'disabled' : ''} />
          <span class="custom-check" aria-hidden="true">
            <span class="material-symbols-outlined">check</span>
          </span>
          <span>
            <strong>Saya mengonfirmasi file berasal dari sumber resmi.</strong>
            <small>Data geografis dan relasi sumber tidak akan diperbaiki otomatis oleh halaman ini.</small>
          </span>
        </label>
        ${renderFieldError(fieldErrors.confirmed)}
      </section>

      <div class="import-form-actions">
        <button class="button secondary cancel-import-draft" type="button">Batal</button>
        <button class="button primary submit-import" type="submit"
          ${disabled || !file || fileValidation?.valid === false ? 'disabled' : ''}>
          <span class="material-symbols-outlined" aria-hidden="true">upload</span>
          Import dataset
        </button>
      </div>
    </form>
  `
}

function renderFieldError(message) {
  if (!message) return ''
  return `
    <small class="field-error" role="alert">
      <span class="material-symbols-outlined" aria-hidden="true">error</span>
      ${escapeHtml(message)}
    </small>
  `
}
