export function renderNetworkMapSurface(activeContext, {
  empty = false,
  assetsWithoutGeometry = 0,
} = {}) {
  return `
    <section class="map-stage" aria-label="Peta topologi jaringan">
      <div id="network-map" class="network-map-host"
        aria-label="Visualisasi peta geografis jaringan aset"
        aria-describedby="map-keyboard-help"></div>
      <p class="map-sr-only" id="map-keyboard-help">
        Gunakan tombol panah untuk berpindah antar aset, Enter untuk memilih, dan Escape untuk menutup informasi.
      </p>
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

      <section class="map-topology-notice" role="status" aria-live="polite" hidden>
        <span class="material-symbols-outlined" aria-hidden="true">route</span>
        <div>
          <strong>Endpoint aset belum terkonfirmasi</strong>
          <span>Jaringan ini belum memiliki endpoint aset yang terkonfirmasi.</span>
        </div>
      </section>

      <div class="trace-banner" role="status" aria-live="polite" hidden>
        <span class="trace-step">1</span>
        <div>
          <strong>Pilih titik awal</strong>
          <span class="trace-description">Klik aset pada peta untuk memulai tracing.</span>
        </div>
        <button class="icon-button cancel-trace" type="button" aria-label="Batalkan tracing">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      ${renderCompactMapLegend()}

      <div class="map-attribution">SINERGI Topology · Dataset ${escapeHtml(activeContext.version)}</div>
      <button class="mobile-panel-backdrop" type="button" tabindex="-1" aria-label="Tutup panel"></button>
      <aside class="asset-drawer" aria-live="polite" aria-label="Detail aset" aria-hidden="true"></aside>
    </section>
  `
}

export function renderMapContextPill(activeContext) {
  const branchName = formatBranchName(activeContext.branchName)
  const contextLabel = activeContext.siteScopeName ? 'Site' : 'Kantor cabang'
  return `
    <section class="map-context-pill" aria-label="Konteks peta aktif">
      <span class="context-branch">
        <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
        <span>
          <small>${contextLabel}</small>
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
        <button class="tool-button data-transfer-toggle" type="button"
          aria-label="Buka pilihan export peta" title="Export">
          <span class="material-symbols-outlined" aria-hidden="true">download</span>
          <span>Export</span>
        </button>
        <button class="tool-button trace-toggle" type="button" disabled
          aria-label="Mulai tracing jaringan" title="Pilih satu aset untuk memulai tracing.">
          <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
          <span>Tracing</span>
        </button>
        <button class="tool-button diagram-toggle" type="button" disabled
          aria-label="Buka Diagram 2D"
          title="Jaringan yang dipilih belum mempunyai relasi terkonfirmasi untuk diagram.">
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
          <span>Diagram 2D</span>
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
        <button type="button" aria-label="Fit seluruh data Pengapon" class="zoom-fit">
          <span class="material-symbols-outlined" aria-hidden="true">fit_screen</span>
        </button>
        <button type="button" aria-label="Atur ulang tampilan" class="zoom-reset">
          <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
        </button>
      </div>
    </div>
  `
}

function renderCompactMapLegend() {
  const networks = [
    ['--color-cctv', 'CCTV'],
    ['--color-fiber-optic', 'Fiber Optic'],
    ['--color-lan', 'LAN'],
    ['--color-infrastructure', 'Infrastruktur'],
    ['--color-peripheral', 'Peripheral'],
  ]
  return `
    <section class="legend-popover" id="map-legend" aria-label="Legenda peta" hidden>
      <header>
        <strong>Legenda peta</strong>
        <small>Warna menunjukkan jaringan, bentuk menunjukkan fungsi aset.</small>
      </header>
      <div class="legend-section">
        <span class="legend-section-title">Jaringan</span>
        <div class="legend-network-grid">
          ${networks.map(([token, label]) => `
            <span><i class="legend-network-line" style="--legend-color:var(${token})"></i>${label}</span>
          `).join('')}
        </div>
      </div>
      <div class="legend-section">
        <span class="legend-section-title">Jenis aset</span>
        <div class="legend-asset-grid">
          <span><i class="legend-asset-shape is-camera">C</i>CCTV</span>
          <span><i class="legend-asset-shape is-junction"><b>J</b></i>Junction</span>
          <span><i class="legend-asset-shape is-device">S</i>Switch / server</span>
          <span><i class="legend-asset-shape is-device">O</i>OTB / perangkat</span>
        </div>
      </div>
      <div class="legend-section legend-state-grid">
        <span><i class="legend-geographic-path"></i>Jalur geografis</span>
        <span><i class="legend-confirmed-relation"></i>Relasi terkonfirmasi</span>
        <span><i class="legend-isolated-asset"></i>Aset tanpa relasi</span>
        <span><i class="legend-selected-state"></i>Aset terpilih</span>
      </div>
    </section>
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
