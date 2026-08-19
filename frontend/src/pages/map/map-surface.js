export function renderNetworkMapCanvas(activeContext, {
  empty = false,
  assetsWithoutGeometry = 0,
  selectedArea = null,
  counts = {},
  confirmedConnectionCount = 0,
  selectedAssetId = null,
  topologyReadiness = null,
} = {}) {
  const displayedConfirmedConnectionCount = Number(confirmedConnectionCount) || 0
  const operationalReadiness = {
    operational: true,
    ready: true,
    traceAvailable: displayedConfirmedConnectionCount > 0,
    diagramAvailable: Number(counts.assetNodeCount) > 0,
    status: 'ready',
  }
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
            <small>PETA KERJA</small>
            <strong>${escapeHtml(selectedArea?.name ?? 'Area aktif')}</strong>
          </span>
        </span>
        <span class="basemap-status-metrics">
          ${Number(counts.assetNodeCount) || 0} aset &middot; ${Number(counts.lineCount) || 0} jalur &middot; ${displayedConfirmedConnectionCount} koneksi terkonfirmasi
        </span>
        <span class="map-sr-only">Peta dasar <b class="basemap-availability">memuat</b>,
          mode <b class="basemap-mode-label">Jalan &amp; bangunan</b>.</span>
      </div>
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
      <div class="map-info-overlays" aria-label="Informasi konteks peta">
        ${renderMapContextPill(activeContext, operationalReadiness, selectedArea, {
          counts,
          confirmedConnectionCount: displayedConfirmedConnectionCount,
        })}
      </div>
      ${renderMapFloatingControls(activeContext, operationalReadiness, { selectedAssetId })}

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

      ${renderMapLegend()}

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

export function renderMapContextPill(
  activeContext,
  topologyReadiness = null,
  selectedArea = null,
  { counts = {}, confirmedConnectionCount = 0 } = {},
) {
  const branchName = formatBranchName(activeContext.branchName)
  const topologyStatus = 'ready'
  const assetCount = Number(counts.assetNodeCount) || 0
  const lineCount = Number(counts.lineCount) || 0
  const confirmedCount = Number(confirmedConnectionCount) || 0
  return `
    <section class="map-context-pill" aria-label="Konteks peta aktif">
      <span class="context-main-row">
        <span class="context-branch context-item">
          <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
          <span>
            <small>Kantor cabang</small>
            <strong title="${escapeHtml(branchName)}">${escapeHtml(branchName)}</strong>
          </span>
        </span>
        <span class="context-separator" aria-hidden="true"></span>
        <span class="context-area context-item">
          <small>Area</small>
          <strong title="${escapeHtml(selectedArea?.name || 'Area aktif')}">${escapeHtml(selectedArea?.name || 'Area aktif')}</strong>
        </span>
        <span class="context-separator" aria-hidden="true"></span>
        <span class="context-dataset context-item">
          <small>Dataset aktif</small>
          <strong>${escapeHtml(activeContext.version)}</strong>
        </span>
      </span>
      <span class="context-statuses">
        <span class="context-readonly">
          <span class="material-symbols-outlined" aria-hidden="true">lock</span>
          Read-only
        </span>
        <span class="context-topology ${topologyStatus}"
          title="Relasi kuat pada dataset dibaca dan dikonfirmasi otomatis.">
          ${confirmedCount > 0 ? 'Relasi otomatis' : 'Belum ada relasi'}
        </span>
      </span>
      <span class="context-metrics" aria-label="Ringkasan aset dan jalur">
        ${assetCount} aset &middot; ${lineCount} jalur &middot; ${confirmedCount} koneksi terkonfirmasi
      </span>
    </section>
  `
}

export function renderMapFloatingControls(
  activeContext = null,
  topologyReadiness = null,
  { selectedAssetId = null } = {},
) {
  const operationalReadiness = topologyReadiness?.operational === true
    ? topologyReadiness
    : null
  const traceAvailable = operationalReadiness?.traceAvailable
    ?? activeContext?.topologyReady
    ?? true
  const diagramAvailable = operationalReadiness?.diagramAvailable
    ?? activeContext?.topologyReady
    ?? true
  const topologyMessage = 'Belum ada relasi terkonfirmasi untuk ditelusuri.'
  const traceActionMessage = !traceAvailable ? topologyMessage : ''
  const traceActionAttributes = traceActionMessage
    ? `disabled aria-disabled="true" title="${escapeHtml(traceActionMessage)}"`
    : `title="${escapeHtml(selectedAssetId
      ? 'Telusuri koneksi dari aset terpilih.'
      : 'Klik lalu pilih aset awal pada peta.')}"`
  const diagramActionAttributes = diagramAvailable
    ? ''
    : `disabled aria-disabled="true" title="${escapeHtml(
      topologyMessage,
    )}"`
  return `
    <button class="open-sidebar sidebar-reopen" type="button" title="Buka panel"
      aria-label="Buka panel jaringan" aria-controls="network-sidebar" aria-expanded="false">
      <span class="material-symbols-outlined" aria-hidden="true">left_panel_open</span>
    </button>

    <div class="map-floating-top">
      <div class="map-action-group" aria-label="Aksi peta">
        <button class="tool-button trace-toggle map-action-primary" type="button"
          aria-label="Tracing" ${traceActionAttributes || 'title="Telusuri hubungan antar aset"'}>
          <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
          <span>Tracing</span>
        </button>
        <button class="tool-button diagram-toggle map-action-secondary" type="button"
          aria-label="Diagram 2D" ${diagramAvailable
            ? 'title="Lihat jaringan dalam diagram 2D"'
            : diagramActionAttributes}>
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
          <span>Diagram 2D</span>
        </button>
        <button class="tool-button import-toggle map-action-ghost" type="button"
          aria-label="Import" title="Import data peta">
          <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
          <span>Import</span>
        </button>
        <button class="tool-button export-toggle map-action-ghost" type="button"
          aria-label="Export" title="Export data peta">
          <span class="material-symbols-outlined" aria-hidden="true">download</span>
          <span>Export</span>
        </button>
      </div>
    </div>

    <nav class="mobile-map-tabs" aria-label="Navigasi peta mobile">
      <button class="mobile-map-tab active" type="button" data-mobile-map-tab="map" aria-current="page">
        <span class="material-symbols-outlined" aria-hidden="true">map</span>
        <span>Peta</span>
      </button>
      <button class="mobile-map-tab" type="button" data-mobile-map-tab="layers">
        <span class="material-symbols-outlined" aria-hidden="true">layers</span>
        <span>Layer</span>
      </button>
      <button class="mobile-map-tab" type="button" data-mobile-map-tab="assets">
        <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
        <span>Aset</span>
      </button>
    </nav>

    <div class="map-floating-bottom" aria-label="Kontrol peta">
      <div class="map-primary-controls" role="group" aria-label="Kontrol utama peta">
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

      <div class="map-secondary-controls" role="group" aria-label="Kontrol layer dan informasi">
        <button class="icon-button basemap-toggle" type="button" aria-label="Pilih tampilan peta dasar"
          aria-controls="basemap-picker" aria-expanded="false">
          <span class="material-symbols-outlined" aria-hidden="true">layers</span>
        </button>
        <button class="icon-button legend-toggle" type="button" aria-label="Tampilkan legenda"
          aria-controls="map-legend" aria-expanded="false">
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
        </button>
      </div>
    </div>
  `
}

function renderMapLegend() {
  return `
    <div class="legend-popover" id="map-legend" hidden>
      <strong>Legenda peta</strong>
      <section>
        <small>Warna jaringan</small>
        <span><i class="legend-color cctv"></i>CCTV</span>
        <span><i class="legend-color fiber"></i>Fiber Optic</span>
        <span><i class="legend-color lan"></i>LAN</span>
        <span><i class="legend-color infrastructure"></i>Infrastruktur</span>
      </section>
      <section>
        <small>Bentuk aset</small>
        <span><i class="legend-shape circle"></i>CCTV</span>
        <span><i class="legend-shape diamond"></i>Junction Box</span>
        <span><i class="legend-shape square"></i>Switch</span>
        <span><i class="legend-shape rectangle"></i>NVR / Server</span>
        <span><i class="legend-shape hexagon"></i>OTB</span>
      </section>
      <section>
        <small>Jenis jalur</small>
        <span><i class="legend-route geographic"></i>Jalur geografis</span>
        <span><i class="legend-route confirmed"></i>Relasi terkonfirmasi</span>
        <span><i class="legend-route trace"></i>Tracing aktif</span>
      </section>
      <span class="legend-coordinate-note"><i class="legend-leader"></i>Offset visual tetap menunjuk koordinat KML</span>
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
