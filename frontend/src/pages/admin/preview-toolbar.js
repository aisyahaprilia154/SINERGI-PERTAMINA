import { escapeAttribute, escapeHtml } from './import-view-utils.js'

export function renderPreviewToolbar({ model, state }) {
  const activeAvailable = Boolean(model.active)
  return `
    <div class="preview-toolbar" role="toolbar" aria-label="Kontrol preview dataset">
      <div class="preview-dataset-switch" aria-label="Dataset yang ditampilkan">
        <button type="button" data-view-mode="candidate"
          class="${state.viewMode === 'candidate' ? 'active' : ''}" aria-pressed="${state.viewMode === 'candidate'}">
          Dataset baru
        </button>
        <button type="button" data-view-mode="active"
          class="${state.viewMode === 'active' ? 'active' : ''}" aria-pressed="${state.viewMode === 'active'}"
          ${activeAvailable ? '' : 'disabled'}>
          Dataset aktif
        </button>
      </div>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <button type="button" class="preview-tool-toggle" data-toggle-changes
        aria-pressed="${state.showChanges}" ${state.viewMode === 'active' ? 'disabled' : ''}>
        <span class="material-symbols-outlined" aria-hidden="true">difference</span>
        Tampilkan perubahan
      </button>
      <button type="button" class="preview-tool-toggle" data-toggle-issues
        aria-pressed="${state.showIssues}">
        <span class="material-symbols-outlined" aria-hidden="true">rule</span>
        Tampilkan issue
      </button>
      <span class="toolbar-spacer"></span>
      ${state.activeMapUrl ? `
        <a class="preview-active-map-link" href="${escapeAttribute(state.activeMapUrl)}">
          <span class="material-symbols-outlined" aria-hidden="true">map</span>
          Buka map dataset aktif
        </a>
      ` : ''}
      <span class="preview-readonly">
        <span class="material-symbols-outlined" aria-hidden="true">lock</span>
        Read-only
      </span>
      <button type="button" class="preview-icon-button" data-fit-all
        aria-label="Fit seluruh data" title="Fit seluruh data">
        <span class="material-symbols-outlined" aria-hidden="true">fit_screen</span>
      </button>
      <button type="button" class="preview-icon-button" data-reset-view
        aria-label="Reset view" title="Reset view">
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
      </button>
    </div>
    ${state.actionMessage ? `
      <div class="preview-action-message tone-${escapeHtml(state.actionStatus)}" role="status">
        <span class="material-symbols-outlined" aria-hidden="true">
          ${state.actionStatus === 'error' ? 'error' : 'check_circle'}
        </span>
        ${escapeHtml(state.actionMessage)}
      </div>
    ` : ''}
  `
}
