function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function renderLocationContextPanel({ surface, branchName, areaName }) {
  const isTopology = surface === 'topology'
  const panelClass = isTopology ? 'topology-context-card' : 'map-context-pill'
  const panelLabel = isTopology ? 'Konteks diagram aktif' : 'Konteks peta aktif'
  const branchHook = isTopology ? ' data-topology-branch-title' : ''
  const areaHook = isTopology ? ' data-topology-area-title' : ''
  const branch = escapeHtml(branchName)
  const area = escapeHtml(areaName)

  return `
    <section class="${panelClass} location-context-panel" aria-label="${panelLabel}">
      <div class="location-context-fields">
        <span class="location-context-item">
          <span class="material-symbols-outlined location-context-icon" aria-hidden="true">apartment</span>
          <span class="location-context-copy">
            <small>Kantor cabang</small>
            <strong${branchHook} title="${branch}">${branch}</strong>
          </span>
        </span>
        <span class="location-context-item">
          <span class="material-symbols-outlined location-context-icon" aria-hidden="true">location_on</span>
          <span class="location-context-copy">
            <small>Area</small>
            <strong${areaHook} title="${area}">${area}</strong>
          </span>
        </span>
      </div>
    </section>
  `
}
