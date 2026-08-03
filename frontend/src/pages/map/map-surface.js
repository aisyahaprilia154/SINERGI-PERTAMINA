export function renderNetworkMapCanvas(activeContext, {
  empty = false,
  assetsWithoutGeometry = 0,
  selectedArea = null,
  counts = {},
  confirmedConnectionCount = 0,
  topologyReadiness = null,
} = {}) {
  const traceAvailable = topologyReadiness?.traceAvailable
    ?? topologyReadiness?.ready
    ?? activeContext?.topologyReady
    ?? true
  const topologyMessage = topologyReadiness?.traceMessage
    || topologyReadiness?.message
    || 'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.'
  const displayedConfirmedConnectionCount = traceAvailable
    ? Number(confirmedConnectionCount) || 0
    : 0
  return `
    <section class="map-stage" aria-label="Peta geografis aset">
      <div id="network-map" tabindex="0" aria-label="Peta geografis jaringan aset"
        aria-describedby="map-keyboard-help"></div>
      <p class="map-sr-only" id="map-keyboard-help">
        Geser peta dengan drag. Zoom langsung dengan scroll atau touchpad tanpa tombol Control,
        cubit layar sentuh, atau gunakan tombol tambah dan kurang. Untuk memiringkan peta,
        tahan tombol Control sambil drag pada peta.
      </p>
      <div class="map-accessible-assets map-sr-only" aria-label="Daftar aset pada peta"></div>
      <div class="basemap-status loading" role="status">
        <span class="basemap-status-overview">
          <span class="material-symbols-outlined" aria-hidden="true">map</span>
          <span>
            <small>Peta kerja &middot; ${escapeHtml(selectedArea?.name ?? 'Area aktif')}</small>
            <strong><b class="basemap-availability">memuat</b> &middot; <b class="basemap-mode-label">Jalan &amp; bangunan</b></strong>
          </span>
        </span>
        <span class="basemap-status-metrics">
          <span><b>${Number(counts.assetNodeCount) || 0}</b> aset</span>
          <span><b>${Number(counts.lineCount) || 0}</b> jalur</span>
          <span><b>${displayedConfirmedConnectionCount}</b> koneksi</span>
          <span class="declutter-summary">adaptif</span>
        </span>
      </div>
      ${!traceAvailable ? `
        <div class="map-topology-readiness" id="topology-not-ready-message" role="status">
          <strong>Topology-ready: No</strong>
          <span>${escapeHtml(topologyMessage)}</span>
        </div>
      ` : ''}
      <div class="map-asset-tooltip" id="map-asset-tooltip" role="tooltip" aria-live="polite" hidden></div>
      ${empty ? `
        <section class="map-empty-layer" aria-live="polite">
          <span class="material-symbols-outlined" aria-hidden="true">layers_clear</span>
          <strong>Layer aktif belum mempunyai geometri yang dapat ditampilkan</strong>
          <p>${assetsWithoutGeometry
            ? `${assetsWithoutGeometry} aset tanpa geometri tetap tersedia melalui inventaris.`
            : 'Pilih atau aktifkan dataset yang memiliki Point, LineString, atau Polygon valid.'}</p>
        </section>
      ` : ''}
      ${renderMapContextPill(activeContext, topologyReadiness)}
      ${renderMapAssetFinder()}
      ${renderMapFloatingControls(activeContext, topologyReadiness)}

      <div class="trace-banner" hidden>
        <span class="trace-step">1</span>
        <div>
          <strong>Pilih titik awal</strong>
          <span>Klik aset pada peta untuk memulai tracing.</span>
        </div>
        <button class="icon-button cancel-trace" type="button" aria-label="Batalkan tracing">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <div class="legend-popover" id="map-legend" hidden>
        <strong>Legenda peta</strong>
        <span><i class="legend-node"></i> Koordinat aktual dari KML</span>
        <span><i class="legend-leader"></i> Label disebar dari titik asli</span>
        <span><i class="legend-cluster">12</i> Kelompok aset; klik untuk buka</span>
        <span><i class="legend-line"></i> Jalur fisik dari KML</span>
      </div>

      <div class="basemap-popover" id="basemap-picker" hidden>
        <div class="basemap-popover-heading">
          <span>
            <strong>Tampilan peta dasar</strong>
            <small>Pilih konteks yang paling membantu di lapangan.</small>
          </span>
          <button class="icon-button close-basemap-picker" type="button" aria-label="Tutup pilihan peta dasar">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <button class="basemap-option active" type="button" data-basemap-mode="street" aria-pressed="true">
          <span class="basemap-preview street" aria-hidden="true"><i></i><i></i><i></i></span>
          <span><strong>Peta kerja</strong><small>Jalan, bangunan, nomor, dan nama tempat</small></span>
          <span class="material-symbols-outlined basemap-option-check" aria-hidden="true">check_circle</span>
        </button>
        <button class="basemap-option" type="button" data-basemap-mode="satellite" aria-pressed="false">
          <span class="basemap-preview satellite" aria-hidden="true"><i></i><i></i><i></i></span>
          <span><strong>Citra satelit</strong><small class="satellite-option-copy">Kondisi fisik area dengan label jalan</small></span>
          <span class="material-symbols-outlined basemap-option-check" aria-hidden="true">radio_button_unchecked</span>
        </button>
      </div>

      <div class="map-attribution">SINERGI Topology · Dataset ${escapeHtml(activeContext.version)}</div>
      <button class="mobile-panel-backdrop" type="button" tabindex="-1" aria-label="Tutup panel"></button>
      <aside class="asset-drawer" aria-live="polite" aria-label="Detail aset" aria-hidden="true"></aside>
    </section>
  `
}

export function renderMapContextPill(activeContext, topologyReadiness = null) {
  const branchName = formatBranchName(activeContext.branchName)
  const topologyReady = topologyReadiness?.ready ?? activeContext?.topologyReady ?? true
  const topologyStatus = topologyReadiness?.status
    || (topologyReady ? 'ready' : 'not_ready')
  const topologyLabel = topologyStatus === 'partial_ready'
    ? 'Partial'
    : topologyReady ? 'Yes' : 'No'
  const topologyText = topologyStatus === 'partial_ready'
    ? 'Topology: Partial'
    : `Topology-ready: ${topologyLabel}`
  return `
    <section class="map-context-pill" aria-label="Konteks peta aktif">
      <span class="context-branch">
        <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
        <span>
          <small>Kantor cabang</small>
          <strong title="${escapeHtml(branchName)}">${escapeHtml(branchName)}</strong>
        </span>
      </span>
      <span class="context-separator" aria-hidden="true"></span>
      <span class="context-dataset">
        <small>Dataset aktif</small>
        <strong>${escapeHtml(activeContext.version)}</strong>
      </span>
      <span class="context-readonly">
        <span class="material-symbols-outlined" aria-hidden="true">lock</span>
        Read-only
      </span>
      <span class="context-topology ${topologyStatus}"
        title="${escapeHtml(topologyReadiness?.message || (topologyReady
          ? 'Topologi siap untuk tracing.'
          : 'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.'))}">
        ${topologyText}
      </span>
    </section>
  `
}

export function renderMapAssetFinder() {
  return `
    <section class="map-asset-finder" aria-label="Cari lokasi aset">
      <div class="map-asset-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input type="search" autocomplete="off" spellcheck="false"
          placeholder="Cari nama, ID, atau lokasi aset"
          aria-label="Cari nama, ID, atau lokasi aset"
          aria-controls="map-asset-results" aria-expanded="false">
        <kbd>Ctrl K</kbd>
      </div>
      <div class="map-asset-results" id="map-asset-results" role="listbox" hidden></div>
    </section>
  `
}

export function renderMapFloatingControls(activeContext = null, topologyReadiness = null) {
  const traceAvailable = topologyReadiness?.traceAvailable
    ?? topologyReadiness?.ready
    ?? activeContext?.topologyReady
    ?? true
  const diagramAvailable = topologyReadiness?.diagramAvailable
    ?? topologyReadiness?.ready
    ?? activeContext?.topologyReady
    ?? true
  const topologyMessage = topologyReadiness?.traceMessage
    || topologyReadiness?.message
    || 'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.'
  const traceActionAttributes = traceAvailable
    ? ''
    : `title="${escapeHtml(topologyMessage)}"`
  const diagramActionAttributes = diagramAvailable
    ? ''
    : `disabled aria-disabled="true" title="${escapeHtml(
      topologyReadiness?.message || topologyMessage,
    )}"`
  return `
    <div class="map-floating-top">
      <button class="icon-button open-sidebar mobile-only" type="button"
        aria-label="Buka daftar jaringan" aria-controls="network-sidebar" aria-expanded="false">
        <span class="material-symbols-outlined" aria-hidden="true">left_panel_open</span>
      </button>

      <div class="map-action-group" aria-label="Aksi peta">
        <button class="tool-button data-transfer-toggle" type="button">
          <span class="material-symbols-outlined" aria-hidden="true">swap_vert</span>
          <span>Import / Export</span>
        </button>
        <button class="tool-button trace-toggle" type="button" ${traceActionAttributes}>
          <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
          <span>Tracing</span>
        </button>
        <button class="tool-button diagram-toggle" type="button" ${diagramActionAttributes}>
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
          <span>Diagram 2D</span>
        </button>
        <button class="tool-button declutter-toggle" type="button" aria-pressed="true"
          title="Sebarkan marker yang berdekatan tanpa mengubah koordinat KML">
          <span class="material-symbols-outlined" aria-hidden="true">scatter_plot</span>
          <span>Tata aset adaptif</span>
        </button>
        <button class="tool-button dim-toggle" type="button" aria-pressed="true">
          <span class="material-symbols-outlined" aria-hidden="true">contrast</span>
          <span>Redupkan lainnya</span>
        </button>
      </div>
    </div>

    <div class="map-floating-bottom">
      <button class="icon-button basemap-toggle" type="button" aria-label="Pilih tampilan peta dasar"
        aria-controls="basemap-picker" aria-expanded="false">
        <span class="material-symbols-outlined" aria-hidden="true">layers</span>
      </button>
      <button class="icon-button legend-toggle" type="button" aria-label="Tampilkan legenda"
        aria-controls="map-legend" aria-expanded="false">
        <span class="material-symbols-outlined" aria-hidden="true">info</span>
      </button>

      <div class="zoom-controls" aria-label="Kontrol zoom peta">
        <button type="button" aria-label="Perbesar peta" title="Perbesar peta" class="zoom-in">
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
        </button>
        <button type="button" aria-label="Perkecil peta" title="Perkecil peta" class="zoom-out">
          <span class="material-symbols-outlined" aria-hidden="true">remove</span>
        </button>
        <button type="button" aria-label="Kembali ke seluruh area cabang"
          title="Kembali ke seluruh area cabang" class="zoom-reset">
          <span class="material-symbols-outlined" aria-hidden="true">my_location</span>
        </button>
      </div>
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

function formatBranchName(value) {
  const normalized = String(value ?? '').trim()
  return normalized.replace(/^kantor\s+cabang\s+/i, '') || 'Belum tersedia'
}
