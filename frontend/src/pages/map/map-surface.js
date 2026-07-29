export function renderNetworkMapCanvas(activeContext, {
  empty = false,
  assetsWithoutGeometry = 0,
  selectedArea = null,
  counts = {},
  confirmedConnectionCount = 0,
} = {}) {
  return `
    <section class="map-stage" aria-label="Peta geografis aset">
      <div id="network-map" tabindex="0" aria-label="Peta geografis jaringan aset"
        aria-describedby="map-keyboard-help"></div>
      <p class="map-sr-only" id="map-keyboard-help">
        Gunakan kontrol zoom dan pan pada peta. Daftar aset alternatif tersedia setelah peta.
      </p>
      <div class="map-accessible-assets map-sr-only" aria-label="Daftar aset pada peta"></div>
      <div class="basemap-status" role="status">
        <span class="material-symbols-outlined" aria-hidden="true">satellite_alt</span>
        <strong>Peta geografis &middot; Dataset aktif</strong>
        <span>Basemap: <b class="basemap-availability">memuat</b></span>
        <span>Area: ${escapeHtml(selectedArea?.name ?? 'Lainnya')}</span>
        <span>Aset: ${Number(counts.assetNodeCount) || 0}</span>
        <span>Jalur kabel: ${Number(counts.lineCount) || 0}</span>
        <span>Confirmed connection: ${Number(confirmedConnectionCount) || 0}</span>
        <span>Tata aset: <b class="declutter-summary">adaptif</b></span>
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
      ${renderMapContextPill(activeContext)}
      ${renderMapFloatingControls(activeContext)}

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

      <div class="map-attribution">SINERGI Topology · Dataset ${escapeHtml(activeContext.version)}</div>
      <button class="mobile-panel-backdrop" type="button" tabindex="-1" aria-label="Tutup panel"></button>
      <aside class="asset-drawer" aria-live="polite" aria-label="Detail aset" aria-hidden="true"></aside>
    </section>
  `
}

export function renderMapContextPill(activeContext) {
  const branchName = formatBranchName(activeContext.branchName)
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
    </section>
  `
}

export function renderMapFloatingControls() {
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
        <button class="tool-button trace-toggle" type="button">
          <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
          <span>Tracing</span>
        </button>
        <button class="tool-button diagram-toggle" type="button">
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
      <button class="icon-button legend-toggle" type="button" aria-label="Tampilkan legenda"
        aria-controls="map-legend" aria-expanded="false">
        <span class="material-symbols-outlined" aria-hidden="true">info</span>
      </button>

      <div class="zoom-controls" aria-label="Kontrol zoom peta">
        <button type="button" aria-label="Perbesar peta" class="zoom-in">
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
        </button>
        <button type="button" aria-label="Perkecil peta" class="zoom-out">
          <span class="material-symbols-outlined" aria-hidden="true">remove</span>
        </button>
        <button type="button" aria-label="Atur ulang tampilan" class="zoom-reset">
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
