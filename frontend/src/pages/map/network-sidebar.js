export function renderNetworkSidebar(activeContext, selectedCount, counts = {}) {
  const countSummary = formatDatasetCounts(counts)
  return `
    <aside class="network-sidebar" id="network-sidebar"
      aria-label="Pemilih jaringan. ${escapeAttribute(countSummary)}">
      <header class="sidebar-heading">
        <div>
          <span class="eyebrow">DATASET AKTIF</span>
          <h1>Jaringan aset</h1>
        </div>
        <div class="sidebar-heading-actions">
          <button class="icon-button sidebar-collapse desktop-only" type="button"
            aria-label="Ciutkan daftar jaringan" aria-controls="network-sidebar" aria-expanded="true">
            <span class="material-symbols-outlined" aria-hidden="true">left_panel_close</span>
          </button>
          <button class="icon-button close-sidebar mobile-only" type="button"
            aria-label="Tutup daftar jaringan" aria-controls="network-sidebar">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </header>

      <div class="sidebar-content">
        <section class="dataset-card" aria-label="Dataset aktif. ${escapeAttribute(countSummary)}">
          <span class="dataset-icon material-symbols-outlined" aria-hidden="true">database</span>
          <div>
            <strong>${escapeHtml(activeContext.datasetName)}</strong>
            <span>${escapeHtml(activeContext.version)} · ${escapeHtml(activeContext.publishedAt)}</span>
          </div>
          <span class="status-dot" title="Dataset aktif"></span>
        </section>

        <label class="search-control">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input type="search" placeholder="Cari Asset ID, nama aset, atau lokasi"
            aria-label="Cari Asset ID, nama aset, atau lokasi" />
          <kbd>⌘ K</kbd>
        </label>

        <div class="sidebar-list-header">
          <div class="selection-summary" aria-live="polite">
            <span><strong class="selected-count">${selectedCount}</strong> jaringan ditampilkan</span>
          </div>
          <div class="selection-actions" aria-label="Aksi pilihan jaringan">
            <button class="text-button show-all-networks" type="button">Tampilkan semua</button>
            <span aria-hidden="true"></span>
            <button class="text-button hide-all-networks" type="button">Sembunyikan semua</button>
          </div>
          <button class="inactive-mode-toggle" type="button" aria-pressed="false">
            <span class="material-symbols-outlined" aria-hidden="true">contrast</span>
            <span>Redupkan jaringan nonaktif</span>
          </button>
        </div>

        <div class="network-list" aria-label="Daftar jaringan" aria-busy="true"></div>

        <footer class="sidebar-footer">
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
          <p>Peta bersifat read-only. Perubahan sumber dilakukan melalui Google Earth.</p>
        </footer>
      </div>
    </aside>
  `
}

export function renderNetworkList({
  status,
  errorMessage,
  networks,
  assets,
  selectedNetworkIds,
  expandedNetworkIds,
  search,
}) {
  if (status === 'loading') return renderLoadingSkeleton()
  if (status === 'error') return renderErrorState(errorMessage)
  if (!networks.length) return renderEmptyState('Belum ada jaringan pada dataset aktif.', 'dataset')

  const normalizedSearch = search.trim().toLowerCase()
  const assetById = Object.fromEntries(assets.map((asset) => [asset.id, asset]))
  const filtered = networks.filter((network) => (
    matchesNetworkSearch(network, assetById, normalizedSearch)
  ))
  if (!filtered.length) return renderEmptyState('Asset atau jaringan tidak ditemukan.', 'search')

  return filtered.map((network) => renderNetworkItem({
    network,
    assetById,
    selected: selectedNetworkIds.has(network.id),
    expanded: expandedNetworkIds.has(network.id),
  })).join('')
}

function renderNetworkItem({ network, assetById, selected, expanded }) {
  const category = getNetworkCategory(network)
  const subcategories = getNetworkSubcategories(network, assetById)
  const networkId = escapeAttribute(network.id)
  const networkName = escapeHtml(network.name)

  return `
    <article class="network-item ${selected ? 'selected' : ''}" data-network-id="${networkId}">
      <div class="network-row">
        <button class="network-main" type="button" data-network-select="${networkId}"
          aria-pressed="${selected}" aria-label="${selected ? 'Sembunyikan' : 'Tampilkan'} ${networkName}">
          <span class="network-checkbox ${selected ? 'checked' : ''}" aria-hidden="true">
            <span class="material-symbols-outlined">check</span>
          </span>
          <i class="network-color-indicator" style="--network-color:${network.color}" aria-hidden="true"></i>
          <span class="network-copy">
            <strong>${networkName}</strong>
            <small><span class="network-health"><i></i>${escapeHtml(network.health)}</span> · ${escapeHtml(category)}</small>
          </span>
          <span class="network-count" aria-label="${networkCountLabel(network)}">${network.assetCount}</span>
        </button>
        <div class="network-row-actions">
          <button class="network-icon-action focus-network" type="button" data-network-focus="${networkId}"
            aria-label="Fokuskan peta ke ${networkName}" ${network.assetCount ? '' : 'disabled'}>
            <span class="material-symbols-outlined" aria-hidden="true">center_focus_strong</span>
          </button>
          <button class="network-icon-action expand-network" type="button" data-network-expand="${networkId}"
            aria-label="${expanded ? 'Tutup' : 'Buka'} subkategori ${networkName}"
            aria-expanded="${expanded}" aria-controls="network-subcategories-${networkId}">
            <span class="material-symbols-outlined" aria-hidden="true">${expanded ? 'expand_less' : 'expand_more'}</span>
          </button>
        </div>
      </div>
      <div class="network-subcategories" id="network-subcategories-${networkId}"
        ${expanded ? '' : 'hidden'}>
        ${subcategories.map((subcategory) => `
          <span><i style="--network-color:${network.color}" aria-hidden="true"></i>${escapeHtml(subcategory.label)}</span>
          <strong>${subcategory.count}</strong>
        `).join('')}
      </div>
    </article>
  `
}

function matchesNetworkSearch(network, assetById, search) {
  if (!search) return true
  const networkText = `${network.id} ${network.name} ${network.type} `
    + `${network.description} ${network.sourceFolderPath || ''}`.toLowerCase()
  if (networkText.includes(search)) return true
  return network.nodeIds.some((assetId) => {
    const asset = assetById[assetId]
    if (!asset) return false
    return `${asset.id} ${asset.name} ${asset.location}`.toLowerCase().includes(search)
  })
}

function getNetworkCategory(network) {
  if (network.categoryLabel) return network.categoryLabel
  if (network.type === 'CCTV') return 'CCTV'
  if (network.type === 'Fiber optic') return 'Fiber Optic'
  if (network.type === 'LAN') return 'LAN'
  if (network.type === 'Server') return 'Peripheral'
  return 'Infrastruktur'
}

function getNetworkSubcategories(network, assetById) {
  if (Array.isArray(network.subcategories) && network.subcategories.length) {
    return network.subcategories
  }
  const counts = new Map()
  network.nodeIds.forEach((assetId) => {
    const asset = assetById[assetId]
    if (!asset) return
    const label = normalizeSubcategory(asset.type, network.type)
    counts.set(label, (counts.get(label) || 0) + 1)
  })
  return [...counts].map(([label, count]) => ({ label, count }))
}

function normalizeSubcategory(type, networkType) {
  if (type === 'Junction box' && networkType === 'CCTV') return 'Junction Box CCTV'
  if (type.includes('switch')) return 'Switch'
  if (type === 'Access point') return 'Access Point'
  return type
}

function formatDatasetCounts(counts) {
  return `${Number(counts.networkCount) || 0} jaringan, `
    + `${Number(counts.layerCount) || 0} layer, `
    + `${Number(counts.assetNodeCount) || 0} node, `
    + `${Number(counts.lineCount) || 0} line, `
    + `${Number(counts.polygonCount) || 0} polygon`
}

function networkCountLabel(network) {
  return `${Number(network.assetCount) || 0} objek: `
    + `${Number(network.nodeCount) || 0} node, `
    + `${Number(network.lineCount) || 0} line, `
    + `${Number(network.polygonCount) || 0} polygon`
}

function renderLoadingSkeleton() {
  return `
    <div class="network-loading" aria-label="Memuat jaringan">
      ${Array.from({ length: 4 }, () => `
        <div class="network-skeleton">
          <i></i><span><b></b><small></small></span><em></em>
        </div>
      `).join('')}
    </div>
  `
}

function renderErrorState(message) {
  return `
    <div class="network-state">
      <span class="material-symbols-outlined state-error-icon" aria-hidden="true">error</span>
      <strong>Jaringan gagal dimuat</strong>
      <span>${escapeHtml(message || 'Terjadi kendala saat membaca dataset aktif.')}</span>
      <button class="button secondary retry-networks" type="button">
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        Coba lagi
      </button>
    </div>
  `
}

function renderEmptyState(message, type) {
  return `
    <div class="network-state">
      <span class="material-symbols-outlined" aria-hidden="true">${type === 'search' ? 'search_off' : 'lan'}</span>
      <strong>${type === 'search' ? 'Tidak ada hasil' : 'Jaringan belum tersedia'}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `
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
