import { getAssetRenderLabels } from '../../domain/asset-display-name.js'

export function renderAssetDetailDrawer({
  status = 'ready',
  errorMessage = null,
  asset,
  assetNetworks = [],
  connectedAssets = [],
  activeContext,
  trace = {},
  showAdditionalMetadata = false,
}) {
  if (status === 'loading') return renderLoadingState()
  if (status === 'error') return renderErrorState(errorMessage)
  if (!asset) return renderEmptyState()

  const category = getAssetCategory(asset, assetNetworks)
  const hasIpAddress = asset.ip && !['—', 'â€”', '-'].includes(asset.ip)
  const labels = getAssetRenderLabels(asset, {
    shortMax: 18,
    displayMax: 30,
  })

  return `
    <header class="drawer-header" data-asset-stable-id="${escapeAttribute(
      asset.stableId || asset.id,
    )}">
      <div class="drawer-heading">
        <span class="asset-type-icon">
          <span class="material-symbols-outlined" aria-hidden="true">${assetIcon(asset.type)}</span>
        </span>
        <span>
          <small>Detail aset</small>
          <strong title="${escapeAttribute(labels.fullShortLabel)}">${escapeHtml(labels.shortLabel)}</strong>
        </span>
      </div>
      <button class="icon-button close-drawer" type="button" aria-label="Tutup detail aset">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>

    <div class="drawer-scroll-content">
      <section class="drawer-title">
        <div class="asset-badge-row">
          <span class="category-badge category-${category.token}">${escapeHtml(category.label)}</span>
          <span class="asset-status ${asset.status === 'Online' ? 'online' : 'warning'}">
            <span class="material-symbols-outlined" aria-hidden="true">
              ${asset.status === 'Online' ? 'check_circle' : 'error'}
            </span>
            ${escapeHtml(asset.status)}
          </span>
        </div>
        <h2 title="${escapeAttribute(labels.fullDisplayName)}">${escapeHtml(labels.fullDisplayName)}</h2>
        <p>${escapeHtml(asset.type)}</p>
      </section>

      ${renderTraceSection(trace)}

      <section class="drawer-section" aria-labelledby="asset-information-title">
        <h3 id="asset-information-title">Informasi aset</h3>
        <dl class="asset-properties">
          <div><dt>Asset ID</dt><dd>${escapeHtml(asset.assetId || 'Tidak tersedia')}</dd></div>
          <div><dt>Nama aset</dt><dd>${escapeHtml(labels.fullDisplayName)}</dd></div>
          <div><dt>Nama sumber</dt><dd>${escapeHtml(asset.sourceName || 'Tidak tersedia')}</dd></div>
          <div><dt>Kategori</dt><dd>${escapeHtml(category.label)}</dd></div>
          <div><dt>Jenis aset</dt><dd>${escapeHtml(asset.type)}</dd></div>
          <div><dt>Lokasi</dt><dd>${escapeHtml(asset.location || 'Lokasi belum tersedia')}</dd></div>
          ${hasIpAddress ? `<div><dt>IP address</dt><dd>${escapeHtml(asset.ip)}</dd></div>` : ''}
          <div>
            <dt>Dataset aktif</dt>
            <dd>${escapeHtml(activeContext.datasetName)} · ${escapeHtml(activeContext.version)}</dd>
          </div>
        </dl>
      </section>

      <section class="drawer-section connected-networks" aria-labelledby="asset-networks-title">
        <div class="drawer-section-heading">
          <h3 id="asset-networks-title">Jaringan yang mencakup aset</h3>
          <span class="count-badge">${assetNetworks.length}</span>
        </div>
        ${assetNetworks.length ? assetNetworks.map((network) => `
          <button type="button" data-focus-network="${escapeAttribute(network.id)}">
            <i style="--network-indicator:${escapeAttribute(network.color)}" aria-hidden="true"></i>
            <span>
              <strong>${escapeHtml(network.shortName || network.name)}</strong>
              <small>${escapeHtml(network.type)}</small>
            </span>
            <span class="material-symbols-outlined" aria-hidden="true">center_focus_strong</span>
          </button>
        `).join('') : renderInlineEmpty('Aset ini belum tercakup dalam jaringan pada dataset aktif.')}
      </section>

      <section class="drawer-section connected-assets" aria-labelledby="connected-assets-title">
        <div class="drawer-section-heading">
          <h3 id="connected-assets-title">Aset terhubung</h3>
          <span class="count-badge">${connectedAssets.length}</span>
        </div>
        ${connectedAssets.length ? `
          <ul class="relation-list">
            ${connectedAssets.map(({ asset: connectedAsset, network }) => `
              <li>
                <button type="button" data-connected-asset="${escapeAttribute(connectedAsset.id)}">
                  <span class="relation-icon material-symbols-outlined" aria-hidden="true">
                    ${assetIcon(connectedAsset.type)}
                  </span>
                  <span>
                    <strong>${escapeHtml(
                      getAssetRenderLabels(connectedAsset).fullDisplayName,
                    )}</strong>
                    <small>${escapeHtml(
                      getAssetRenderLabels(connectedAsset).fullShortLabel,
                    )} · ${escapeHtml(network?.shortName || network?.name || 'Topologi terkonfirmasi')}</small>
                  </span>
                  <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                </button>
              </li>
            `).join('')}
          </ul>
        ` : renderInlineEmpty('Tidak ada relasi topologi terkonfirmasi untuk aset ini. Aset tetap ditampilkan di peta.')}
      </section>

      <section class="drawer-section additional-metadata ${showAdditionalMetadata ? 'expanded' : ''}"
        aria-labelledby="additional-metadata-title">
        <div class="drawer-section-heading">
          <h3 id="additional-metadata-title">Metadata tambahan</h3>
        </div>
        ${showAdditionalMetadata ? `
          <dl class="asset-properties compact">
            <div><dt>Status operasional</dt><dd>${escapeHtml(asset.status)}</dd></div>
            <div><dt>Penanggung jawab</dt><dd>${escapeHtml(asset.owner || 'Belum tersedia')}</dd></div>
            <div><dt>Kantor cabang</dt><dd>${escapeHtml(activeContext.branchName)}</dd></div>
            <div><dt>Versi dataset</dt><dd>${escapeHtml(activeContext.version)}</dd></div>
            <div><dt>Dipublikasikan</dt><dd>${escapeHtml(activeContext.publishedAt || 'Belum tersedia')}</dd></div>
            <div><dt>Folder sumber</dt><dd>${escapeHtml(asset.sourceFolderPath || 'Tidak tersedia')}</dd></div>
            <div><dt>Stable ID</dt><dd>${escapeHtml(asset.stableId || asset.id)}</dd></div>
          </dl>
        ` : `
          <p class="section-summary">Informasi operasional tambahan tersedia tanpa membuka mode edit.</p>
        `}
      </section>

      <p class="read-only-note">
        <span class="material-symbols-outlined" aria-hidden="true">lock</span>
        Detail dan relasi ini hanya dapat dibaca.
      </p>
    </div>

    <footer class="drawer-actions">
      ${trace.status && trace.status !== 'idle' ? `
        <button class="button secondary stop-tracing" type="button">
          <span class="material-symbols-outlined" aria-hidden="true">stop_circle</span>
          Hentikan tracing
        </button>
      ` : `
        <button class="button primary trace-from" type="button">
          <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
          Telusuri jaringan
        </button>
      `}
      <div class="drawer-secondary-actions">
        <button class="button secondary open-asset-detail" type="button"
          aria-expanded="${String(showAdditionalMetadata)}">
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
          Buka detail aset
        </button>
        <button class="button secondary open-schematic" type="button">
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
          Buat diagram 2D
        </button>
      </div>
    </footer>
  `
}

function renderTraceSection(trace) {
  if (!trace.status || trace.status === 'idle') return ''
  if (['selecting_start', 'selecting_end', 'calculating'].includes(trace.status)) return ''

  if (trace.status === 'loading') {
    return `
      <section class="drawer-section trace-panel" aria-live="polite" aria-busy="true">
        <div class="trace-panel-heading">
          <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
          <h3>Menyusun jalur</h3>
        </div>
        <div class="drawer-skeleton trace-skeleton"><i></i><i></i><i></i></div>
      </section>
    `
  }

  if (trace.status === 'choosing') {
    return `
      <section class="drawer-section trace-panel" aria-labelledby="trace-destination-title">
        <div class="trace-panel-heading">
          <span class="material-symbols-outlined" aria-hidden="true">flag</span>
          <div>
            <h3 id="trace-destination-title">Pilih aset tujuan</h3>
            <p>Tujuan berikut dapat dicapai melalui graph topologi terkonfirmasi.</p>
          </div>
        </div>
        <div class="trace-destinations">
          ${(trace.candidates || []).map(({ asset, distance }) => `
            <button type="button" data-trace-target="${escapeAttribute(asset.id)}">
              <span>
                <strong>${escapeHtml(getAssetRenderLabels(asset).fullDisplayName)}</strong>
                <small>${escapeHtml(getAssetRenderLabels(asset).fullShortLabel)} · ${distance} hubungan</small>
              </span>
              <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </button>
          `).join('')}
        </div>
      </section>
    `
  }

  if (trace.status === 'error' || trace.status === 'no_path') {
    const noPath = trace.status === 'no_path'
    return `
      <section class="drawer-section trace-panel trace-error" role="alert">
        <div class="trace-panel-heading">
          <span class="material-symbols-outlined" aria-hidden="true">${noPath ? 'route' : 'error'}</span>
          <div>
            <h3>${noPath ? 'Jalur tidak ditemukan' : 'Tracing tidak dapat diselesaikan'}</h3>
            <p>${escapeHtml(trace.error || 'Relasi atau tujuan tidak tersedia pada dataset aktif.')}</p>
          </div>
        </div>
      </section>
    `
  }

  if (trace.status === 'result' || trace.status === 'active') {
    return `
      <section class="drawer-section trace-panel" aria-labelledby="trace-path-title">
        <div class="trace-panel-heading success">
          <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
          <div>
            <h3 id="trace-path-title">Jalur koneksi</h3>
            <p>${escapeHtml(trace.explanation || 'Urutan berdasarkan graph topologi terkonfirmasi.')}</p>
          </div>
        </div>
        <ol class="trace-sequence">
          ${(trace.pathAssets || []).map((pathAsset, index) => {
            const relation = trace.relations?.[index]
            return `
              <li>
                <span class="trace-order">${index + 1}</span>
                <span>
                  <strong>${escapeHtml(getAssetRenderLabels(pathAsset).fullDisplayName)}</strong>
                  <small>${escapeHtml(getAssetRenderLabels(pathAsset).fullShortLabel)}</small>
                  ${relation?.networkName ? `<em>${escapeHtml(relation.networkName)}</em>` : ''}
                </span>
              </li>
            `
          }).join('')}
        </ol>
      </section>
    `
  }

  return ''
}

function renderLoadingState() {
  return `
    <header class="drawer-header">
      <div class="drawer-heading"><span class="drawer-title-placeholder">Memuat detail aset</span></div>
      <button class="icon-button close-drawer" type="button" aria-label="Tutup detail aset">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <div class="drawer-state drawer-loading" aria-live="polite" aria-busy="true">
      <div class="drawer-skeleton"><i></i><i></i><i></i><i></i></div>
      <span>Memuat aset dari dataset aktif…</span>
    </div>
  `
}

function renderErrorState(errorMessage) {
  return `
    <header class="drawer-header">
      <div class="drawer-heading"><strong>Detail aset</strong></div>
      <button class="icon-button close-drawer" type="button" aria-label="Tutup detail aset">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <div class="drawer-state drawer-error" role="alert">
      <span class="material-symbols-outlined" aria-hidden="true">error</span>
      <strong>Detail aset tidak dapat dimuat</strong>
      <p>${escapeHtml(errorMessage || 'Aset tidak tersedia pada dataset aktif.')}</p>
      <button class="button secondary retry-asset-detail" type="button">Coba lagi</button>
    </div>
  `
}

function renderEmptyState() {
  return `
    <header class="drawer-header">
      <div class="drawer-heading"><strong>Detail aset</strong></div>
      <button class="icon-button close-drawer" type="button" aria-label="Tutup detail aset">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <div class="drawer-state">
      <span class="material-symbols-outlined" aria-hidden="true">location_off</span>
      <strong>Aset tidak tersedia</strong>
      <p>Aset ini tidak ditemukan pada dataset aktif.</p>
    </div>
  `
}

function renderInlineEmpty(message) {
  return `<p class="drawer-inline-empty">${escapeHtml(message)}</p>`
}

function getAssetCategory(asset, assetNetworks) {
  const assetSource = `${asset.category || ''} ${asset.type || ''}`.toLowerCase()
  if (assetSource.includes('cctv') || assetSource.includes('nvr') || assetSource.includes('junction')) {
    return { label: 'CCTV', token: 'cctv' }
  }
  if (assetSource.includes('fiber') || assetSource.includes('otb')) {
    return { label: 'Fiber optic', token: 'fiber' }
  }
  if (assetSource.includes('printer') || assetSource.includes('peripheral')) {
    return { label: 'Peripheral', token: 'peripheral' }
  }
  if (assetSource.includes('lan')) return { label: 'LAN', token: 'lan' }
  if (['switch', 'server', 'access point'].some((type) => assetSource.includes(type))) {
    return { label: 'Infrastruktur', token: 'infrastructure' }
  }

  const networkSource = assetNetworks.map((network) => network.type).join(' ').toLowerCase()
  if (networkSource.includes('cctv')) return { label: 'CCTV', token: 'cctv' }
  if (networkSource.includes('fiber')) return { label: 'Fiber optic', token: 'fiber' }
  if (networkSource.includes('lan')) return { label: 'LAN', token: 'lan' }
  return { label: 'Infrastruktur', token: 'infrastructure' }
}

function assetIcon(type = '') {
  const normalizedType = type.toLowerCase()
  if (normalizedType.includes('switch')) return 'router'
  if (normalizedType.includes('junction')) return 'hub'
  if (normalizedType === 'cctv') return 'videocam'
  if (normalizedType === 'server' || normalizedType === 'nvr') return 'dns'
  if (normalizedType === 'otb') return 'settings_input_component'
  if (normalizedType === 'access point') return 'wifi'
  if (normalizedType === 'printer') return 'print'
  return 'device_hub'
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
