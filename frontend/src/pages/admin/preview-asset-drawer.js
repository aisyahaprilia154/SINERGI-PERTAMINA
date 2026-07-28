import { escapeAttribute, escapeHtml } from './import-view-utils.js'
import { changeDescriptor } from './preview-sidebar.js'

export function renderPreviewAssetDrawer({ model, state }) {
  const asset = [...model.candidate.assets, ...model.removed.assets]
    .find((item) => item.assetId === state.selectedAssetId)
  if (!asset) return ''
  const geometries = [
    ...(model.candidate.geometriesByAssetNode.get(asset.id) ?? []),
    ...(model.removed.geometriesByAssetNode.get(asset.id) ?? []),
  ]
  const relations = model.candidate.relations.filter(({ sourceAssetId, targetAssetId }) => (
    sourceAssetId === asset.assetId || targetAssetId === asset.assetId
  ))
  const [changeIcon, changeLabel] = changeDescriptor(asset.changeStatus)
  const properties = Object.entries(asset.properties ?? {})
  return `
    <aside class="preview-asset-drawer" aria-label="Detail aset ${escapeAttribute(asset.assetId)}">
      <header>
        <div>
          <span class="section-kicker">DETAIL ASSET · READ-ONLY</span>
          <h2>${escapeHtml(asset.assetId)}</h2>
          <p>${escapeHtml(asset.name || 'Tanpa nama')}</p>
        </div>
        <button type="button" class="preview-icon-button close-preview-drawer" aria-label="Tutup detail aset">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>
      <div class="preview-drawer-scroll">
        <span class="change-badge change-${escapeAttribute(asset.changeStatus)}">
          <span class="material-symbols-outlined" aria-hidden="true">${changeIcon}</span>
          ${changeLabel}
        </span>
        ${state.selectedIssueId ? renderFocusedIssue(asset, state.selectedIssueId) : ''}
        <section>
          <h3>Informasi aset</h3>
          <dl class="drawer-detail-list">
            ${detail('Kategori', asset.category || 'Unmapped')}
            ${detail('Jenis', asset.type || 'Tidak tersedia')}
            ${detail('Lokasi', asset.location || 'Tidak tersedia')}
            ${detail('Layer', model.candidate.layers.find(({ id }) => id === asset.layerId)?.name || 'Tidak tersedia')}
            ${detail('Source Placemark ID', asset.sourcePlacemarkId || 'Tidak tersedia')}
          </dl>
        </section>
        <section>
          <h3>Geometry information</h3>
          ${geometries.length ? `
            <ul class="drawer-record-list">
              ${geometries.map((geometry) => `
                <li>
                  <span class="material-symbols-outlined" aria-hidden="true">${geometryIcon(geometry.geometryType)}</span>
                  <span><strong>${escapeHtml(geometry.geometryType)}</strong>
                    <small>${coordinateSummary(geometry)}</small></span>
                </li>
              `).join('')}
            </ul>
          ` : '<p class="preview-empty-copy">Aset tidak mempunyai geometri yang dapat dirender.</p>'}
        </section>
        <section>
          <h3>Relasi eksplisit</h3>
          ${relations.length ? `
            <ul class="drawer-record-list">
              ${relations.map((relation) => {
                const target = relation.sourceAssetId === asset.assetId
                  ? relation.targetAssetId
                  : relation.sourceAssetId
                return `
                  <li>
                    <span class="material-symbols-outlined" aria-hidden="true">device_hub</span>
                    <button type="button" data-related-asset="${escapeAttribute(target)}">
                      <strong>${escapeHtml(target)}</strong>
                      <small>${escapeHtml(relation.relationType)}</small>
                    </button>
                  </li>
                `
              }).join('')}
            </ul>
            <button type="button" class="preview-secondary-action" data-trace-connected
              aria-pressed="${state.traceAssetIds.size > 0}">
              <span class="material-symbols-outlined" aria-hidden="true">route</span>
              ${state.traceAssetIds.size ? 'Hentikan penelusuran' : 'Telusuri koneksi'}
            </button>
          ` : '<p class="preview-empty-copy">Tidak ada relasi eksplisit untuk aset ini.</p>'}
        </section>
        <section>
          <h3>Import issue</h3>
          ${asset.issues.length ? `
            <ul class="drawer-issue-list">
              ${asset.issues.map((issue) => `
                <li class="issue-${escapeAttribute(issue.severity)}">
                  <span class="material-symbols-outlined" aria-hidden="true">${issueIcon(issue.severity)}</span>
                  <span><strong>${escapeHtml(issue.issueCode)}</strong><p>${escapeHtml(issue.message)}</p></span>
                </li>
              `).join('')}
            </ul>
          ` : '<p class="preview-empty-copy">Tidak ada issue yang terkait langsung dengan aset ini.</p>'}
        </section>
        <section>
          <h3>Metadata sumber</h3>
          ${properties.length ? `
            <dl class="drawer-detail-list metadata-list">
              ${properties.map(([key, value]) => detail(key, formatValue(value))).join('')}
            </dl>
          ` : '<p class="preview-empty-copy">Metadata tambahan tidak tersedia.</p>'}
        </section>
      </div>
    </aside>
  `
}

function renderFocusedIssue(asset, selectedIssueId) {
  const issue = asset.issues.find(({ id }) => id === selectedIssueId)
  if (!issue) return ''
  return `
    <div class="drawer-focused-issue issue-${escapeAttribute(issue.severity)}" role="status">
      <span class="material-symbols-outlined" aria-hidden="true">${issueIcon(issue.severity)}</span>
      <span><strong>${escapeHtml(issue.issueCode)}</strong><p>${escapeHtml(issue.message)}</p></span>
    </div>
  `
}

function detail(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return 'Tidak tersedia'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function coordinateSummary(geometry) {
  if (geometry.geometryType === 'point') {
    return `${geometry.coordinates?.[0] ?? '–'}, ${geometry.coordinates?.[1] ?? '–'}`
  }
  const source = geometry.sourceGeometry ? ' · sumber dipertahankan' : ''
  return `${countPositions(geometry.coordinates)} koordinat${source}`
}

function countPositions(value) {
  if (!Array.isArray(value)) return 0
  if (value.length >= 2 && Number.isFinite(Number(value[0]))) return 1
  return value.reduce((total, child) => total + countPositions(child?.coordinates ?? child), 0)
}

function geometryIcon(type) {
  return {
    point: 'location_on',
    line_string: 'timeline',
    polygon: 'pentagon',
    multi_geometry: 'category',
  }[type] ?? 'shapes'
}

function issueIcon(value) {
  return { error: 'error', warning: 'warning', information: 'info' }[value] ?? 'info'
}
