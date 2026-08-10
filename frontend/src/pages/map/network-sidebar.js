export function renderNetworkSidebar(activeContext, selectedCount, counts = {}, {
  locationGroups = [],
  selectedArea = null,
  topologyReadiness = null,
  topologySummary = {},
} = {}) {
  const countSummary = formatDatasetCounts(counts)
  const topologyReady = topologyReadiness?.ready ?? activeContext?.topologyReady ?? true
  const traceAvailable = topologyReadiness?.traceAvailable ?? topologyReady
  const topologyStatus = topologyReadiness?.status || (topologyReady ? 'ready' : 'not_ready')
  const topologyMessage = topologyReadiness?.message
    || 'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.'
  const confirmedCount = Number(topologySummary.confirmedConnectionCount) || 0
  const pendingCount = Number(topologySummary.pendingConnectionCount) || 0
  const isolatedCount = Number(topologySummary.isolatedAssetCount) || 0
  const canReviewTopology = topologyReadiness?.capabilities?.reviewTopology === true
  const reviewQuery = new URLSearchParams({
    datasetId: activeContext.datasetId,
    branchId: activeContext.branchId,
  })
  if (selectedArea?.key) reviewQuery.set('area', selectedArea.key)
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
            title="Tutup panel" aria-label="Tutup panel jaringan"
            aria-controls="network-sidebar" aria-expanded="true">
            <span class="material-symbols-outlined" aria-hidden="true">left_panel_close</span>
          </button>
          <button class="icon-button close-sidebar mobile-only" type="button"
            aria-label="Tutup daftar jaringan" aria-controls="network-sidebar">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </header>

      <div class="sidebar-content">
        <label class="area-selector">
          <span>Area fasilitas</span>
          <span class="area-selector-control">
            <select aria-label="Area fasilitas" aria-haspopup="listbox" aria-expanded="false">
              ${locationGroups.map((group) => `
                <option value="${escapeAttribute(group.key)}"
                  ${group.key === selectedArea?.key ? 'selected' : ''}>
                  ${escapeHtml(group.name)}
                </option>
              `).join('')}
            </select>
            <span class="area-selector-icon material-symbols-outlined"
              aria-hidden="true">expand_more</span>
          </span>
        </label>

        <div class="asset-search-combobox">
          <label class="search-control">
            <span class="material-symbols-outlined" aria-hidden="true">search</span>
            <input type="search" autocomplete="off" spellcheck="false"
              placeholder="Cari ID, nama, atau lokasi aset"
              aria-label="Cari Asset ID, nama aset, lokasi, atau hostname"
              role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
              aria-controls="sidebar-asset-search-results" aria-expanded="false" />
            <kbd>Ctrl K</kbd>
          </label>
          <div class="sidebar-asset-search-results" id="sidebar-asset-search-results"
            role="listbox" aria-label="Hasil pencarian aset" hidden></div>
        </div>

        <div class="map-category-presets" aria-label="Preset kategori peta">
          <button type="button" data-category-preset="all" class="active"
            aria-pressed="true">Semua</button>
          <button type="button" data-category-preset="cctv" aria-pressed="false">CCTV</button>
          <button type="button" data-category-preset="fiber" aria-pressed="false">Fiber Optic</button>
          <button type="button" data-category-preset="lan" aria-pressed="false">LAN</button>
          <button type="button" data-category-preset="infrastructure"
            aria-pressed="false">Infrastruktur</button>
        </div>

        <div class="sidebar-list-header">
          <div class="selection-summary" aria-live="polite">
            <span><strong class="selected-count">${selectedCount}</strong> jaringan ditampilkan</span>
          </div>
          <div class="selection-actions" aria-label="Aksi pilihan jaringan">
            <button class="text-button show-all-networks" type="button">Tampilkan semua</button>
            <span aria-hidden="true"></span>
            <button class="text-button hide-all-networks" type="button">Sembunyikan semua</button>
          </div>
        </div>

        <div class="network-list" aria-label="Daftar jaringan" aria-busy="true"></div>

        <section class="sidebar-secondary-context" aria-label="Informasi dataset dan topologi">
          <section class="dataset-card" aria-label="Dataset aktif. ${escapeAttribute(countSummary)}">
            <span class="dataset-icon material-symbols-outlined" aria-hidden="true">database</span>
            <div>
              <strong>${escapeHtml(activeContext.datasetName)}</strong>
              <span>Versi aktif</span>
            </div>
            <span class="status-dot" title="Dataset aktif"></span>
          </section>

          <details class="sidebar-topology-readiness ${topologyStatus}">
            <summary>
              <span>
                <strong>Status topologi</strong>
                <small>${formatCount(confirmedCount)} terkonfirmasi · ${formatCount(isolatedCount)} tanpa relasi</small>
              </span>
              <span class="material-symbols-outlined topology-summary-chevron"
                aria-hidden="true">expand_more</span>
            </summary>
            <div class="sidebar-topology-detail">
              <span class="sidebar-topology-metrics">
                <span><b>${formatCount(confirmedCount)}</b> terkonfirmasi</span>
                <span title="Jumlah kandidat pada dataset aktif"><b>${formatCount(pendingCount)}</b> perlu diperiksa</span>
                <span><b>${formatCount(isolatedCount)}</b> tanpa relasi</span>
              </span>
              <small>${escapeHtml(traceAvailable
                ? 'Tracing menggunakan graph koneksi terkonfirmasi.'
                : topologyMessage)}</small>
              ${canReviewTopology ? `
                <a class="topology-review-link" href="/admin/topology-review?${reviewQuery}">
                  Buka Konfirmasi Koneksi
                  <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                </a>
              ` : ''}
            </div>
          </details>
        </section>

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
  focusedNetworkId = null,
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
    focused: focusedNetworkId === network.id,
  })).join('')
}

function renderNetworkItem({ network, assetById, selected, expanded, focused }) {
  const subcategories = getNetworkSubcategories(network, assetById)
  const networkId = escapeAttribute(network.id)
  const networkName = escapeHtml(network.name)

  return `
    <article class="network-item ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}"
      data-network-id="${networkId}" style="--network-color:${escapeAttribute(network.color)}">
      <div class="network-row">
        <button class="network-main" type="button" data-network-select="${networkId}"
          aria-pressed="${selected}" aria-label="${selected ? 'Sembunyikan' : 'Tampilkan'} ${networkName}">
          <span class="network-checkbox ${selected ? 'checked' : ''}" aria-hidden="true">
            <span class="material-symbols-outlined">check</span>
          </span>
          <i class="network-color-indicator" style="--network-color:${network.color}" aria-hidden="true"></i>
          <span class="network-copy">
            <strong>${networkName}</strong>
            <small>
              <span class="network-health"><i></i>${escapeHtml(network.health)}</span>
              <span>${Number(network.confirmedConnectionCount) || 0} koneksi</span>
              ${network.isolatedAssetCount ? `
                <span class="network-relation-warning"
                  title="${Number(network.isolatedAssetCount)} aset belum memiliki relasi terkonfirmasi">
                  <span class="material-symbols-outlined" aria-hidden="true">warning</span>
                  ${Number(network.isolatedAssetCount)}
                </span>
              ` : ''}
            </small>
          </span>
          <span class="network-count" aria-label="${networkCountLabel(network)}">${network.assetCount}</span>
        </button>
        <div class="network-row-actions">
          <button class="network-icon-action focus-network" type="button" data-network-focus="${networkId}"
            aria-pressed="${focused}" aria-label="${focused ? 'Keluar dari fokus' : 'Fokuskan peta ke'} ${networkName}"
            title="${focused ? 'Keluar dari fokus' : 'Fokuskan peta ke'} ${networkName}"
            ${network.assetCount ? '' : 'disabled'}>
            <span class="material-symbols-outlined" aria-hidden="true">center_focus_strong</span>
          </button>
          <button class="network-icon-action expand-network" type="button" data-network-expand="${networkId}"
            aria-label="${expanded ? 'Tutup' : 'Buka'} subkategori ${networkName}"
            title="${expanded ? 'Tutup' : 'Buka'} detail ${networkName}"
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
    return `${asset.id} ${asset.name} ${asset.location} ${asset.hostname || ''}`
      .toLowerCase().includes(search)
  })
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

function formatCount(value) {
  return Number(value || 0).toLocaleString('id-ID')
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
