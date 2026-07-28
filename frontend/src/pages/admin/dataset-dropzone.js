import { formatFileSize } from './import-dataset-state.js'
import { escapeAttribute, escapeHtml } from './import-view-utils.js'

export function renderDatasetDropzone({
  file = null,
  fileValidation = null,
  disabled = false,
  maxFileSize,
} = {}) {
  const hasError = fileValidation?.valid === false
  return `
    <section class="dataset-dropzone-section" aria-labelledby="source-file-title">
      <div class="form-label-row">
        <div>
          <label id="source-file-title" for="dataset-file">File KML/KMZ</label>
          <span>1 file, maksimum ${escapeHtml(formatFileSize(maxFileSize))}</span>
        </div>
        <span class="required-label">Wajib</span>
      </div>

      <input id="dataset-file" class="visually-hidden dataset-file-input" type="file"
        accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
        ${disabled ? 'disabled' : ''} />

      ${file ? renderSelectedFile({ file, fileValidation, disabled }) : `
        <button class="dataset-dropzone ${hasError ? 'has-error' : ''}" type="button"
          data-dropzone-trigger aria-describedby="dropzone-help${hasError ? ' dropzone-error' : ''}"
          ${disabled ? 'disabled' : ''}>
          <span class="dropzone-icon material-symbols-outlined" aria-hidden="true">upload_file</span>
          <span class="dropzone-copy">
            <strong>Tarik file ke area ini atau pilih dari perangkat</strong>
            <small id="dropzone-help">Format KML atau KMZ. File belum diunggah sampai Anda menekan tombol Import dataset.</small>
          </span>
          <span class="dropzone-action">Pilih file</span>
        </button>
      `}

      ${hasError ? `
        <p class="field-error" id="dropzone-error" role="alert">
          <span class="material-symbols-outlined" aria-hidden="true">error</span>
          ${escapeHtml(fileValidation.error)}
        </p>
      ` : ''}
    </section>
  `
}

function renderSelectedFile({ file, fileValidation, disabled }) {
  const extension = String(file.name).split('.').at(-1)?.toUpperCase() || 'FILE'
  return `
    <div class="selected-import-file ${fileValidation?.valid === false ? 'has-error' : ''}">
      <span class="file-type-icon" aria-hidden="true">${escapeHtml(extension)}</span>
      <span class="selected-file-copy">
        <strong title="${escapeAttribute(file.name)}">${escapeHtml(file.name)}</strong>
        <small>
          ${escapeHtml(formatFileSize(file.size))}
          <i aria-hidden="true"></i>
          ${escapeHtml(fileValidation?.typeLabel ?? extension)}
        </small>
      </span>
      <div class="selected-file-actions">
        <button class="button secondary compact replace-import-file" type="button"
          ${disabled ? 'disabled' : ''}>
          Ganti file
        </button>
        <button class="icon-button remove-import-file" type="button"
          aria-label="Hapus ${escapeAttribute(file.name)}" ${disabled ? 'disabled' : ''}>
          <span class="material-symbols-outlined" aria-hidden="true">delete</span>
        </button>
      </div>
    </div>
  `
}
