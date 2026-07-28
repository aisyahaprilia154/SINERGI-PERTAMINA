import { escapeAttribute, escapeHtml } from './import-view-utils.js'
import { renderImportStatusBadge } from './import-status-badge.js'

const CHANGE_LABELS = {
  new: ['add_circle', 'Baru'],
  updated: ['edit_note', 'Diperbarui'],
  unchanged: ['check_circle', 'Tidak berubah'],
  removed: ['remove_circle', 'Dihapus dari versi baru'],
}

export function renderPreviewSidebar({ model, state }) {
  const { payload } = model
  const summary = payload.comparison?.summary ?? payload.datasetVersion.summary ?? {}
  const problematicAssets = model.candidate.assets
    .filter(({ issues }) => issues.length)
    .sort((left, right) => left.assetId.localeCompare(right.assetId, 'id'))
  const issueCounts = countBy(payload.issues ?? [], 'severity')
  return `
    <aside class="import-preview-sidebar ${state.sidebarOpen ? 'mobile-open' : ''}"
      aria-label="Filter dan ringkasan preview">
      <header class="preview-sidebar-header">
        <div>
          <span class="section-kicker">PREVIEW IMPORT</span>
          <h1>${escapeHtml(payload.datasetVersion.versionName)}</h1>
          <p>${escapeHtml(payload.datasetVersion.branchId)} · ${escapeHtml(payload.datasetVersion.sourceFilename)}</p>
        </div>
        <button type="button" class="preview-icon-button close-preview-sidebar"
          aria-label="Tutup sidebar">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>
      <div class="preview-sidebar-scroll">
        <section class="preview-sidebar-section" aria-labelledby="preview-summary-heading">
          <div class="preview-section-title">
            <h2 id="preview-summary-heading">Ringkasan import</h2>
            ${renderImportStatusBadge(payload.datasetVersion.status)}
          </div>
          <dl class="preview-mini-summary">
            ${summaryMetric('add_circle', 'Baru', summary.newAssets ?? 0, 'new')}
            ${summaryMetric('edit_note', 'Diperbarui', summary.updatedAssets ?? 0, 'updated')}
            ${summaryMetric('check_circle', 'Tidak berubah', summary.unchangedAssets ?? 0, 'unchanged')}
            ${summaryMetric('remove_circle', 'Tidak tersedia', summary.removedAssets ?? 0, 'removed')}
          </dl>
          <div class="preview-validation-counts">
            <span><i class="material-symbols-outlined" aria-hidden="true">error</i>${issueCounts.error ?? 0} error</span>
            <span><i class="material-symbols-outlined" aria-hidden="true">warning</i>${issueCounts.warning ?? 0} warning</span>
          </div>
        </section>

        ${renderCheckboxSection({
          title: 'Layer',
          values: model.candidate.layers.map((layer) => ({
            id: layer.id,
            label: layer.name,
            count: model.candidate.assets.filter(({ layerId }) => layerId === layer.id).length,
          })),
          selected: state.visibleLayerIds,
          dataName: 'layer',
          empty: 'Tidak ada layer yang dapat ditampilkan.',
        })}
        ${renderCheckboxSection({
          title: 'Kategori',
          values: model.categories.map((category) => ({
            id: category,
            label: category,
            count: model.candidate.assets.filter((asset) => (
              (asset.category || 'Unmapped') === category
            )).length,
          })),
          selected: state.visibleCategories,
          dataName: 'category',
        })}
        ${renderCheckboxSection({
          title: 'Geometri',
          values: model.geometryTypes.map((type) => ({
            id: type,
            label: geometryLabel(type),
            count: model.candidate.geometries.filter(({ geometryType }) => geometryType === type).length,
          })),
          selected: state.visibleGeometryTypes,
          dataName: 'geometry',
        })}
        ${renderCheckboxSection({
          title: 'Issue',
          values: model.issueSeverities.map((severity) => ({
            id: severity,
            label: severityLabel(severity),
            count: issueCounts[severity] ?? 0,
          })),
          selected: state.visibleIssueSeverities,
          dataName: 'issue',
          empty: 'Tidak ada issue pada versi ini.',
        })}

        <section class="preview-sidebar-section" aria-labelledby="issue-navigation-heading">
          <div class="preview-section-title">
            <h2 id="issue-navigation-heading">Navigasi issue</h2>
            <span class="count-badge">${payload.issues.length}</span>
          </div>
          ${payload.issues.length ? `
            <ul class="problem-asset-list preview-issue-navigation">
              ${payload.issues.map((issue) => `
                <li ${state.visibleIssueSeverities.has(issue.severity) ? '' : 'hidden'}>
                  <button type="button" data-navigate-issue="${escapeAttribute(issue.id)}"
                    ${issue.assetId ? `data-problem-asset="${escapeAttribute(issue.assetId)}"` : ''}>
                    <span class="material-symbols-outlined issue-${escapeAttribute(issue.severity)}"
                      aria-hidden="true">${issueIcon(issue.severity)}</span>
                    <span>
                      <strong>${escapeHtml(issue.issueCode)}</strong>
                      <small>${escapeHtml(issue.assetId || issue.sourcePlacemarkName || issue.sourceFolderPath || 'Import')}</small>
                    </span>
                    <span class="material-symbols-outlined" aria-hidden="true">my_location</span>
                  </button>
                </li>
              `).join('')}
            </ul>
          ` : '<p class="preview-empty-copy">Tidak ada issue pada versi ini.</p>'}
        </section>

        <section class="preview-sidebar-section" aria-labelledby="problem-assets-heading">
          <div class="preview-section-title">
            <h2 id="problem-assets-heading">Aset bermasalah</h2>
            <span class="count-badge">${problematicAssets.length}</span>
          </div>
          ${problematicAssets.length ? `
            <ul class="problem-asset-list">
              ${problematicAssets.map((asset) => {
                const primaryIssue = asset.issues[0]
                return `
                  <li>
                    <button type="button" data-problem-asset="${escapeAttribute(asset.assetId)}"
                      data-issue-id="${escapeAttribute(primaryIssue.id)}">
                      <span class="material-symbols-outlined issue-${escapeAttribute(primaryIssue.severity)}"
                        aria-hidden="true">${issueIcon(primaryIssue.severity)}</span>
                      <span><strong>${escapeHtml(asset.assetId)}</strong><small>${escapeHtml(primaryIssue.issueCode)}</small></span>
                      <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                    </button>
                  </li>
                `
              }).join('')}
            </ul>
          ` : '<p class="preview-empty-copy">Tidak ada aset dengan issue terikat.</p>'}
        </section>
      </div>
    </aside>
  `
}

function renderCheckboxSection({ title, values, selected, dataName, empty = 'Tidak tersedia.' }) {
  return `
    <section class="preview-sidebar-section">
      <div class="preview-section-title">
        <h2>${escapeHtml(title)}</h2>
        <span class="count-badge">${values.length}</span>
      </div>
      ${values.length ? `
        <ul class="preview-filter-list">
          ${values.map((value) => `
            <li>
              <label>
                <input type="checkbox" data-filter-${dataName}="${escapeAttribute(value.id)}"
                  ${selected.has(value.id) ? 'checked' : ''}>
                <span class="preview-custom-check">
                  <span class="material-symbols-outlined" aria-hidden="true">check</span>
                </span>
                <span>${escapeHtml(value.label)}</span>
                <small>${value.count}</small>
              </label>
            </li>
          `).join('')}
        </ul>
      ` : `<p class="preview-empty-copy">${escapeHtml(empty)}</p>`}
    </section>
  `
}

function summaryMetric(icon, label, value, tone) {
  return `
    <div class="change-${tone}">
      <dt><span class="material-symbols-outlined" aria-hidden="true">${icon}</span>${label}</dt>
      <dd>${value}</dd>
    </div>
  `
}

function countBy(records, key) {
  return records.reduce((result, record) => ({
    ...result,
    [record[key]]: (result[record[key]] ?? 0) + 1,
  }), {})
}

function geometryLabel(value) {
  return {
    point: 'Point',
    line_string: 'LineString',
    polygon: 'Polygon',
    multi_geometry: 'MultiGeometry',
  }[value] ?? value
}

function severityLabel(value) {
  return { error: 'Error', warning: 'Warning', information: 'Informasi' }[value] ?? value
}

function issueIcon(value) {
  return { error: 'error', warning: 'warning', information: 'info' }[value] ?? 'info'
}

export function changeDescriptor(status) {
  return CHANGE_LABELS[status] ?? CHANGE_LABELS.unchanged
}
