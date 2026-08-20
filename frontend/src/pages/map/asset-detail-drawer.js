export function renderAssetDetailDrawer({
  status = 'ready',
  errorMessage = null,
  asset,
  assetNetworks = [],
  connectedAssets = [],
  mountedOnAsset = null,
  mountedAssets = [],
  mountingCandidates = [],
  mountingOptions = [],
  mountingSearch = '',
  showMountingCandidates = false,
  mountingActionStatus = 'idle',
  mountingActionError = null,
  mountingControlsAvailable = false,
  activeContext,
  trace = {},
  showAdditionalMetadata = false,
  traceAvailable = true,
  diagramAvailable = true,
  topologySummary = {},
  relationOptions = [],
  relationEditorOpen = false,
  relationTargetId = '',
  relationReplaceId = null,
  relationStatus = 'idle',
  relationError = null,
}) {
  if (status === 'loading') return renderLoadingState()
  if (status === 'error') return renderErrorState(errorMessage)
  if (!asset) return renderEmptyState()

  const category = getAssetCategory(asset, assetNetworks)
  const hasIpAddress = asset.ip && !['—', 'â€”', '-'].includes(asset.ip)
  const poleAsset = isPoleAsset(asset)
  const hasDirectRelations = connectedAssets.length > 0
  const canTraceAsset = !poleAsset && traceAvailable && hasDirectRelations
  const operationalStatus = resolveOperationalStatus(asset)
  const assetName = displayAssetName(asset)

  return `
    <header class="drawer-header">
      <div class="drawer-heading">
        <span class="asset-type-icon">
          <span class="material-symbols-outlined" aria-hidden="true">${assetIcon(asset.type)}</span>
        </span>
        <span>
          <small>Detail aset</small>
          <strong>${escapeHtml(assetName)}</strong>
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
          ${operationalStatus.value ? `
            <span class="asset-status ${operationalStatusTone(operationalStatus.value)}">
              <span class="material-symbols-outlined" aria-hidden="true">
                ${operationalStatusIcon(operationalStatus.value)}
              </span>
              ${escapeHtml(operationalStatus.value)}
            </span>
          ` : ''}
        </div>
        <h2>${escapeHtml(assetName)}</h2>
        <p>${escapeHtml(asset.type || 'Jenis aset belum tersedia')}</p>
      </section>

      ${poleAsset ? '' : renderTraceSection(trace)}

      ${poleAsset ? '' : `<section class="drawer-section drawer-topology-summary" aria-labelledby="asset-topology-title">
        <div class="drawer-section-heading">
          <h3 id="asset-topology-title">Relasi aset</h3>
          <span class="count-badge">${connectedAssets.length}</span>
        </div>
        <p>${hasDirectRelations
          ? `${connectedAssets.length} relasi langsung terkonfirmasi untuk aset ini.`
          : 'Relasi aset belum tersedia.'}</p>
        <small>${Number(topologySummary.confirmedConnectionCount) || 0} relasi otomatis terkonfirmasi pada area aktif.</small>
        ${relationStatus === 'saved' ? `
          <p class="drawer-relation-success" role="status">
            <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
            Hubungan tersimpan dan sudah ditampilkan pada peta.
          </p>
        ` : ''}
        ${relationOptions.length ? `
          <button class="drawer-relation-add" type="button" data-open-relation-picker>
            <span class="material-symbols-outlined" aria-hidden="true">add_link</span>
            ${hasDirectRelations ? 'Tambah atau ganti relasi' : 'Sambungkan aset'}
            <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
          </button>
        ` : `
          <small class="drawer-relation-hint">Tidak ada aset kompatibel lain yang tersedia di area ini.</small>
        `}
        ${relationEditorOpen ? renderRelationEditor({
          relationOptions,
          relationTargetId,
          relationReplaceId,
          relationStatus,
          relationError,
        }) : ''}
      </section>`}

      ${renderMountingSection({
        asset,
        mountedOnAsset,
        mountedAssets,
        mountingCandidates,
        mountingOptions,
        mountingSearch,
        showMountingCandidates,
        mountingActionStatus,
        mountingActionError,
        mountingControlsAvailable,
      })}

      <section class="drawer-section" aria-labelledby="asset-information-title">
        <h3 id="asset-information-title">Informasi aset</h3>
        <dl class="asset-properties">
          <div><dt>Nama aset</dt><dd>${escapeHtml(assetName)}</dd></div>
          <div><dt>Kategori</dt><dd>${escapeHtml(category.label)}</dd></div>
          <div><dt>Jenis aset</dt><dd>${escapeHtml(asset.type || 'Jenis aset belum tersedia')}</dd></div>
          <div><dt>Lokasi</dt><dd>${escapeHtml(asset.location || 'Lokasi belum tersedia')}</dd></div>
          ${operationalStatus.present && !operationalStatus.value ? `
            <div class="asset-operational-status-empty">
              <dt>Status operasional</dt><dd>Belum dicatat</dd>
            </div>
          ` : ''}
          ${hasIpAddress ? `<div><dt>IP address</dt><dd>${escapeHtml(asset.ip)}</dd></div>` : ''}
          <div>
            <dt>Dataset aktif</dt>
            <dd>${escapeHtml(activeContext.datasetName === activeContext.version
              ? activeContext.datasetName
              : `${activeContext.datasetName} · ${activeContext.version}`)}</dd>
          </div>
        </dl>
        <details class="asset-technical-metadata">
          <summary>
            <span>Informasi teknis</span>
            <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
          </summary>
          <dl class="asset-properties compact">
            <div><dt>ID internal</dt><dd class="asset-id-value">${renderAssetId(asset.id)}</dd></div>
          </dl>
        </details>
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

      ${poleAsset ? '' : `<section class="drawer-section connected-assets" aria-labelledby="connected-assets-title">
        <div class="drawer-section-heading">
          <h3 id="connected-assets-title">Aset terhubung</h3>
          <span class="count-badge">${connectedAssets.length}</span>
        </div>
        ${connectedAssets.length ? `
          <ul class="relation-list">
            ${connectedAssets.map(({ asset: connectedAsset, network, relation }) => `
              <li>
                <div class="relation-item-row">
                  <button type="button" data-connected-asset="${escapeAttribute(connectedAsset.id)}">
                    <span class="relation-icon material-symbols-outlined" aria-hidden="true">
                      ${assetIcon(connectedAsset.type)}
                    </span>
                    <span>
                      <strong>${escapeHtml(displayAssetName(connectedAsset))}</strong>
                      <small>${escapeHtml(connectedAsset.id)} · ${escapeHtml(network?.shortName || network?.name || 'Relasi terkonfirmasi')}</small>
                    </span>
                    <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                  </button>
                  ${relation?.id ? `
                    <button class="relation-replace-button" type="button"
                      data-replace-relation="${escapeAttribute(relation.id)}">
                      Ganti
                    </button>
                  ` : ''}
                </div>
              </li>
            `).join('')}
          </ul>
        ` : renderInlineEmpty('Relasi aset belum tersedia.')}
      </section>`}

      <section class="drawer-section additional-metadata ${showAdditionalMetadata ? 'expanded' : ''}"
        aria-labelledby="additional-metadata-title">
        <div class="drawer-section-heading">
          <h3 id="additional-metadata-title">Metadata tambahan</h3>
        </div>
        ${showAdditionalMetadata ? `
          <dl class="asset-properties compact">
            <div><dt>Penanggung jawab</dt><dd>${escapeHtml(asset.owner || 'Belum tersedia')}</dd></div>
            <div><dt>Kantor cabang</dt><dd>${escapeHtml(activeContext.branchName)}</dd></div>
            <div><dt>Versi dataset</dt><dd>${escapeHtml(activeContext.version)}</dd></div>
            <div><dt>Dipublikasikan</dt><dd>${escapeHtml(activeContext.publishedAt || 'Belum tersedia')}</dd></div>
          </dl>
        ` : `
          <p class="section-summary">Informasi operasional tambahan tersedia tanpa membuka mode edit.</p>
        `}
      </section>

      <p class="read-only-note">
        <span class="material-symbols-outlined" aria-hidden="true">${mountingControlsAvailable ? 'admin_panel_settings' : 'lock'}</span>
        ${mountingControlsAvailable
          ? 'Geometri sumber tetap read-only; penempatan tiang dapat disesuaikan administrator.'
          : 'Detail dan relasi ini hanya dapat dibaca.'}
      </p>
    </div>

    <footer class="drawer-actions">
      ${trace.status && trace.status !== 'idle' ? `
        <button class="button secondary stop-tracing" type="button">
          <span class="material-symbols-outlined" aria-hidden="true">stop_circle</span>
          Hentikan tracing
        </button>
      ` : canTraceAsset ? `
        <button class="button primary trace-from" type="button"
          title="Telusuri koneksi terkonfirmasi dari aset ini">
          <span class="material-symbols-outlined" aria-hidden="true">conversion_path</span>
          Telusuri koneksi
        </button>
      ` : ''}
      <div class="drawer-secondary-actions">
        <button class="button secondary open-asset-detail" type="button"
          aria-expanded="${String(showAdditionalMetadata)}">
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
          Buka detail aset
        </button>
        <button class="button secondary open-schematic" type="button"
          ${diagramAvailable ? '' : 'disabled aria-disabled="true" title="Belum ada aset yang dapat ditampilkan pada diagram."'}>
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
          Buat diagram 2D
        </button>
      </div>
    </footer>
  `
}

function renderRelationEditor({
  relationOptions = [],
  relationTargetId = '',
  relationReplaceId = null,
  relationStatus = 'idle',
  relationError = null,
}) {
  const saving = relationStatus === 'saving'
  const selectedTargetId = relationTargetId || relationOptions[0]?.asset?.id || ''
  return `
    <div class="drawer-relation-editor" role="group" aria-labelledby="relation-editor-title">
      <strong id="relation-editor-title">${relationReplaceId ? 'Ganti hubungan aset' : 'Sambungkan ke aset'}</strong>
      <label for="relation-target-select">Pilih aset tujuan</label>
      <select id="relation-target-select" data-relation-target ${saving ? 'disabled' : ''}>
        <option value="">Pilih aset</option>
        ${relationOptions.map(({ asset: optionAsset, reason }) => `
          <option value="${escapeAttribute(optionAsset.id)}"
            ${optionAsset.id === selectedTargetId ? 'selected' : ''}>
            ${escapeHtml(displayAssetName(optionAsset))} · ${escapeHtml(reason)}
          </option>
        `).join('')}
      </select>
      <small>Relasi yang disimpan langsung menjadi terkonfirmasi dan garisnya ditampilkan pada peta.</small>
      ${relationError ? `<p class="drawer-relation-error" role="alert">${escapeHtml(relationError)}</p>` : ''}
      <div class="drawer-relation-editor-actions">
        <button class="button secondary" type="button" data-cancel-relation ${saving ? 'disabled' : ''}>
          Batal
        </button>
        <button class="button primary" type="button" data-save-relation
          ${!selectedTargetId || saving ? 'disabled' : ''}>
          ${saving ? 'Menyimpan…' : 'Simpan hubungan'}
        </button>
      </div>
    </div>
  `
}

function renderMountingSection({
  asset,
  mountedOnAsset,
  mountedAssets,
  mountingCandidates,
  mountingOptions,
  mountingSearch = '',
  showMountingCandidates,
  mountingActionStatus,
  mountingActionError,
  mountingControlsAvailable,
}) {
  const mountable = isMountableAsset(asset)
  const pole = isPoleAsset(asset)
  const availableMountingOptions = mountingOptions.length ? mountingOptions : mountingCandidates
  if (!mountable && !pole && !mountedOnAsset && !mountedAssets.length
    && !availableMountingOptions.length) {
    return ''
  }

  const busy = mountingActionStatus === 'loading'
  const canEdit = mountingControlsAvailable && mountable
  const assignedLabel = mountedOnAsset
    ? displayAssetName(mountedOnAsset)
    : 'Belum ditentukan'
  const normalizedSearch = String(mountingSearch ?? '').trim().toLocaleLowerCase('id')
  const filteredMountingOptions = availableMountingOptions.filter((candidate) => {
    if (!normalizedSearch) return true
    const haystack = [
      candidate.targetAssetName,
      candidate.targetAssetId,
    ].map((value) => String(value ?? '').toLocaleLowerCase('id')).join(' ')
    return haystack.includes(normalizedSearch)
  })
  const candidateList = filteredMountingOptions.map((candidate) => `
    <li>
      <button type="button" data-mounting-pole="${escapeAttribute(candidate.targetAssetId)}" ${busy ? 'disabled' : ''}>
        <span class="relation-icon material-symbols-outlined" aria-hidden="true">location_on</span>
        <span>
          <strong>${escapeHtml(candidate.targetAssetName || candidate.targetAssetId)}</strong>
          <small>${escapeHtml(candidate.targetAssetId)} · ${formatDistance(candidate.distanceMeters)} · pilih untuk menetapkan</small>
        </span>
        <span class="material-symbols-outlined" aria-hidden="true">check</span>
      </button>
    </li>
  `).join('')

  return `
    <section class="drawer-section mounting-section" aria-labelledby="asset-mounting-title">
      <div class="drawer-section-heading">
        <h3 id="asset-mounting-title">Pemasangan fisik</h3>
        <span class="count-badge">${pole ? mountedAssets.length : mountedOnAsset ? 1 : 0}</span>
      </div>
      ${mountable ? `
        <div class="mounting-assignment">
          <span class="mounting-label">Dipasang pada</span>
          ${mountedOnAsset ? `
            <button type="button" class="mounting-current" data-connected-asset="${escapeAttribute(mountedOnAsset.id)}">
              <span class="relation-icon material-symbols-outlined" aria-hidden="true">location_on</span>
              <span><strong>${escapeHtml(assignedLabel)}</strong><small>${escapeHtml(mountedOnAsset.id)}</small></span>
              <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
            </button>
          ` : `<p class="drawer-inline-empty">Belum ada tiang yang ditetapkan.</p>`}
        </div>
      ` : ''}
      ${pole ? `
        <div class="mounting-assignment">
          <span class="mounting-label">Aset terpasang</span>
          ${mountedAssets.length ? `
            <ul class="relation-list mounting-asset-list">
              ${mountedAssets.map((mountedAsset) => `
                <li>
                  <button type="button" data-connected-asset="${escapeAttribute(mountedAsset.id)}">
                    <span class="relation-icon material-symbols-outlined" aria-hidden="true">${assetIcon(mountedAsset.type)}</span>
                    <span><strong>${escapeHtml(displayAssetName(mountedAsset))}</strong><small>${escapeHtml(mountedAsset.id)}</small></span>
                    <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                  </button>
                </li>
              `).join('')}
            </ul>
          ` : renderInlineEmpty('Belum ada aset yang terdeteksi terpasang pada tiang ini.')}
        </div>
      ` : ''}
      ${canEdit ? `
        <div class="mounting-actions">
          <button type="button" class="button secondary" data-mounting-action="change" ${busy ? 'disabled' : ''}>
            <span class="material-symbols-outlined" aria-hidden="true">swap_horiz</span>
            Ganti tiang
          </button>
          ${mountedOnAsset ? `
            <button type="button" class="button secondary danger" data-mounting-action="detach" ${busy ? 'disabled' : ''}>
              <span class="material-symbols-outlined" aria-hidden="true">link_off</span>
              Lepaskan
            </button>
          ` : ''}
        </div>
      ` : ''}
      ${showMountingCandidates ? `
        <div class="mounting-candidate-panel" aria-live="polite">
          <span class="mounting-label">Tiang dalam fasilitas untuk dipilih</span>
          <label class="mounting-search-field">
            <span class="material-symbols-outlined" aria-hidden="true">search</span>
            <span class="sr-only">Cari tiang</span>
            <input type="search" data-mounting-search
              value="${escapeAttribute(mountingSearch)}"
              placeholder="Cari ID atau nama tiang"
              autocomplete="off" ${busy ? 'disabled' : ''}>
          </label>
          ${candidateList ? `<ul class="relation-list mounting-candidate-list">${candidateList}</ul>` : renderInlineEmpty('Tidak ada tiang yang cocok pada fasilitas ini.')}
        </div>
      ` : ''}
      ${busy ? `<p class="mounting-action-status" role="status"><span class="material-symbols-outlined" aria-hidden="true">progress_activity</span>Menyimpan penempatan…</p>` : ''}
      ${mountingActionStatus === 'success' ? `<p class="mounting-action-status success" role="status"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Penempatan fisik diperbarui.</p>` : ''}
      ${mountingActionError ? `<p class="mounting-action-status error" role="alert"><span class="material-symbols-outlined" aria-hidden="true">error</span>${escapeHtml(mountingActionError)}</p>` : ''}
      </section>
  `
}

function renderTraceSection(trace) {
  if (!trace.status || trace.status === 'idle') return ''

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
                <strong>${escapeHtml(displayAssetName(asset))}</strong>
                <small>${escapeHtml(asset.id)} · ${distance} hubungan</small>
              </span>
              <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </button>
          `).join('')}
        </div>
      </section>
    `
  }

  if (trace.status === 'error') {
    return `
      <section class="drawer-section trace-panel trace-error" role="alert">
        <div class="trace-panel-heading">
          <span class="material-symbols-outlined" aria-hidden="true">error</span>
          <div>
            <h3>Tracing tidak dapat diselesaikan</h3>
            <p>${escapeHtml(trace.error || 'Relasi atau tujuan tidak tersedia pada dataset aktif.')}</p>
          </div>
        </div>
      </section>
    `
  }

  if (trace.status === 'active') {
    const sourceLabel = trace.pathAssets?.[0]?.name
      || trace.sourceAssetId
      || trace.pathAssets?.[0]?.id
      || 'Belum tersedia'
    const targetLabel = trace.pathAssets?.at(-1)?.name
      || trace.targetAssetId
      || trace.pathAssets?.at(-1)?.id
      || 'Belum tersedia'
    const hopLabel = Number.isFinite(Number(trace.hopCount))
      ? String(trace.hopCount)
      : 'Belum tersedia'
    const lengthLabel = Number.isFinite(Number(trace.totalLengthMeters))
      ? `${Number(trace.totalLengthMeters).toLocaleString('id-ID')} m`
      : 'Belum tersedia'
    const verifiedLabel = formatDateTime(trace.verifiedAt)
    return `
      <section class="drawer-section trace-panel" aria-labelledby="trace-path-title">
        <div class="trace-panel-heading success">
          <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
          <div>
            <h3 id="trace-path-title">Jalur koneksi</h3>
            <p>${escapeHtml(trace.explanation || 'Urutan berdasarkan graph topologi terkonfirmasi.')}</p>
          </div>
        </div>
        <dl class="asset-properties compact trace-metadata">
          <div><dt>Dari</dt><dd>${escapeHtml(sourceLabel)}</dd></div>
          <div><dt>Ke</dt><dd>${escapeHtml(targetLabel)}</dd></div>
          <div><dt>Hop</dt><dd>${escapeHtml(hopLabel)}</dd></div>
          <div><dt>Total panjang</dt><dd>${escapeHtml(lengthLabel)}</dd></div>
          <div><dt>Network family</dt><dd>${escapeHtml(String(trace.networkFamily || 'Belum tersedia').toUpperCase())}</dd></div>
          <div><dt>Status</dt><dd>Terkonfirmasi</dd></div>
          <div><dt>Graph revision</dt><dd>${escapeHtml(trace.graphRevision || 'Belum tersedia')}</dd></div>
          <div><dt>Verified at</dt><dd>${escapeHtml(verifiedLabel)}</dd></div>
        </dl>
        <ol class="trace-sequence">
          ${(trace.pathAssets || []).map((pathAsset, index) => {
            const relation = trace.relations?.[index]
            const pathEvidence = relation?.pathAssetIds?.length
              ? `Path: ${relation.pathAssetIds.join(', ')}`
              : ''
            const geometryEvidence = relation?.sourceGeometryIds?.length
              ? `Geometry: ${relation.sourceGeometryIds.join(', ')}`
              : ''
            return `
              <li>
                <span class="trace-order">${index + 1}</span>
                <span>
                  <strong>${escapeHtml(displayAssetName(pathAsset))}</strong>
                  <small>${escapeHtml(pathAsset.id)}</small>
                  ${relation?.networkName ? `<em>${escapeHtml(relation.networkName)}</em>` : ''}
                  ${pathEvidence ? `<small>${escapeHtml(pathEvidence)}</small>` : ''}
                  ${geometryEvidence ? `<small>${escapeHtml(geometryEvidence)}</small>` : ''}
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

const OPERATIONAL_STATUS_KEYS = [
  'operationalStatus',
  'assetStatus',
  'status',
  'condition',
]

function resolveOperationalStatus(asset) {
  if (typeof asset?.hasOperationalStatusField === 'boolean') {
    return {
      present: asset.hasOperationalStatusField,
      value: normalizeOperationalStatus(asset.operationalStatus ?? asset.status),
    }
  }
  const key = OPERATIONAL_STATUS_KEYS.find((candidate) => (
    Object.prototype.hasOwnProperty.call(asset ?? {}, candidate)
  ))
  return key
    ? { present: true, value: normalizeOperationalStatus(asset[key]) }
    : { present: false, value: null }
}

function normalizeOperationalStatus(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.toLocaleLowerCase('id') === 'status tidak tersedia') return null
  return normalized
}

function operationalStatusTone(value) {
  const normalized = value.toLocaleLowerCase('id')
  if (['aktif', 'active', 'online', 'operasional', 'operational'].includes(normalized)) {
    return 'success'
  }
  if (['dalam perbaikan', 'perbaikan', 'maintenance'].includes(normalized)) return 'warning'
  return 'neutral'
}

function operationalStatusIcon(value) {
  const tone = operationalStatusTone(value)
  if (tone === 'success') return 'check_circle'
  if (tone === 'warning') return 'build_circle'
  return 'info'
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

function isMountableAsset(asset) {
  return /junction|\bjb\b|cctv|camera|kamera/i.test(
    `${asset?.type || ''} ${asset?.category || ''}`,
  )
}

function isPoleAsset(asset) {
  return /\b(tiang|pole|pylon)\b/i.test(
    `${asset?.type || ''} ${asset?.category || ''} ${asset?.name || ''}`,
  )
}

function formatDistance(value) {
  const distance = Number(value)
  return Number.isFinite(distance) ? `${distance.toLocaleString('id-ID', { maximumFractionDigits: 2 })} m` : 'jarak tidak tersedia'
}

function formatDateTime(value) {
  if (!value) return 'Belum tersedia'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function renderAssetId(value) {
  return escapeHtml(value).replaceAll(':', ':<wbr>')
}

function displayAssetName(asset) {
  return String(asset?.name || '').trim() || 'Aset tanpa nama'
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
