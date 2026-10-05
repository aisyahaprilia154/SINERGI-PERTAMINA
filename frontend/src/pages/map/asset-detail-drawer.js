import { formatAssetTypeLabel } from '../../domain/asset-type-label.js'
import { isJunctionBoxAsset, JUNCTION_BOX_ICON_URL } from '../../domain/junction-box-icon.js'
import { assetIconUrl, assetIconCanReset, assetIconGlyph } from '../../domain/asset-icon.js'

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
  diagramAvailable = true,
  relationOptions = [],
  relationControlsAvailable = false,
  relationEditorOpen = false,
  relationReplaceId = null,
  relationSearch = '',
  relationStatus = 'idle',
  relationError = null,
  sourceIconDataByUrl = null,
  iconControlsAvailable = false,
  iconFeedback = null,
}) {
  if (status === 'loading' && !asset) return renderLoadingState()
  if (status === 'error') return renderErrorState(errorMessage, asset)
  if (!asset) return renderEmptyState()

  const category = getAssetCategory(asset, assetNetworks)
  const poleAsset = isPoleAsset(asset)
  const hasDirectRelations = connectedAssets.length > 0
  const assetName = displayAssetName(asset)
  const positionAvailable = hasMapPosition(asset.coordinate)
  const assetTypeLabel = formatAssetTypeLabel(asset)
  const relationBusy = ['saving', 'removing'].includes(relationStatus)

  return `
    <header class="drawer-header drawer-header-minimal">
      <h2 class="drawer-compact-title">Detail aset ${escapeHtml(assetName)}</h2>
      <button class="icon-button toggle-mobile-drawer" type="button"
        aria-expanded="false" aria-label="Perluas detail aset" title="Perluas detail aset">
        <span class="material-symbols-outlined" aria-hidden="true">expand_less</span>
      </button>
      <button class="icon-button close-drawer" type="button" aria-label="Tutup detail aset">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>

    ${renderMobileLocationSummary(asset)}

    ${status === 'loading' ? `<p class="drawer-detail-loading" role="status" aria-live="polite">Memuat data tambahan aset…</p>` : ''}

    <div class="drawer-scroll-content">
      <section class="drawer-title drawer-asset-identity">
        ${renderAssetIconControl(asset, { iconControlsAvailable, sourceIconDataByUrl })}
        <div class="asset-badge-row">
          <span class="category-badge category-${category.token}">${escapeHtml(category.label)}</span>
        </div>
        <p>${escapeHtml(assetTypeLabel)}</p>
        ${asset.location ? `<small class="drawer-asset-location">${escapeHtml(asset.location)}</small>` : ''}
        <p class="asset-icon-feedback${iconFeedback?.error ? ' error' : ''}"
          data-asset-icon-feedback role="${iconFeedback?.error ? 'alert' : 'status'}" ${iconFeedback ? '' : 'hidden'}>${escapeHtml(iconFeedback?.message ?? '')}</p>
      </section>

      ${poleAsset || (!hasDirectRelations && !relationOptions.length && !['saved', 'removed', 'removing', 'error'].includes(relationStatus)) ? '' : `<section class="drawer-section drawer-topology-summary" aria-labelledby="asset-topology-title">
        <div class="drawer-section-heading">
          <h3 id="asset-topology-title">Relasi aset</h3>
          <div class="drawer-section-heading-actions">
            <span class="count-badge">${connectedAssets.length}</span>
            ${relationControlsAvailable && relationOptions.length ? `
              <button class="drawer-relation-add" type="button" data-open-relation-picker
                aria-label="${relationEditorOpen && !relationReplaceId
                  ? 'Tutup pencarian relasi'
                  : hasDirectRelations ? 'Tambah atau ganti relasi' : 'Sambungkan aset'}"
                title="${relationEditorOpen && !relationReplaceId
                  ? 'Tutup pencarian relasi'
                  : hasDirectRelations ? 'Tambah atau ganti relasi' : 'Sambungkan aset'}"
                aria-expanded="${relationEditorOpen ? 'true' : 'false'}"
                ${relationBusy ? 'disabled' : ''}>
                <span class="material-symbols-outlined" aria-hidden="true">${relationEditorOpen && !relationReplaceId ? 'close' : 'add'}</span>
              </button>
            ` : ''}
          </div>
        </div>
        ${hasDirectRelations ? '' : '<p>Relasi aset belum tersedia.</p>'}
        ${relationStatus === 'saved' ? `
          <p class="drawer-relation-success" role="status">
            <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
            Hubungan tersimpan dan sudah ditampilkan pada peta.
          </p>
        ` : ''}
        ${relationStatus === 'removing' ? `
          <p class="drawer-relation-feedback" role="status">Menghapus relasi…</p>
        ` : ''}
        ${relationStatus === 'removed' ? `
          <p class="drawer-relation-feedback success" role="status">Relasi berhasil dihapus.</p>
        ` : ''}
        ${relationStatus === 'error' && !relationEditorOpen && relationError ? `
          <p class="drawer-relation-feedback error" role="alert">${escapeHtml(relationError)}</p>
        ` : ''}
        ${relationControlsAvailable && !relationOptions.length ? `
          <small class="drawer-relation-hint">Tidak ada aset kompatibel lain yang tersedia di area ini.</small>
        ` : ''}
        ${relationControlsAvailable && relationEditorOpen ? renderRelationEditor({
          relationOptions,
          relationReplaceId,
          relationSearch,
          relationStatus,
          relationError,
          sourceIconDataByUrl,
        }) : ''}
        ${connectedAssets.length ? `
          <ul class="relation-list">
            ${connectedAssets.map(({ asset: connectedAsset, network, relation }) => `
              <li>
                <div class="relation-item-row">
                  <button type="button" data-connected-asset="${escapeAttribute(connectedAsset.id)}">
                    ${renderRelationAssetIcon(connectedAsset, sourceIconDataByUrl)}
                    <span>
                      <strong>${escapeHtml(displayAssetName(connectedAsset))}</strong>
                      <small>${escapeHtml(network?.shortName || network?.name || 'Relasi terkonfirmasi')}</small>
                    </span>
                    <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                  </button>
                  ${relationControlsAvailable && (relation?.id || relation?.edgeId) ? `
                    <button class="relation-action-button relation-replace-button" type="button"
                      data-replace-relation="${escapeAttribute(relation.id)}"
                      data-replace-edge="${escapeAttribute(relation.edgeId)}"
                      aria-label="Ganti relasi dengan ${escapeAttribute(displayAssetName(connectedAsset))}"
                      title="Ganti relasi" ${relationBusy ? 'disabled' : ''}>
                      <span class="material-symbols-outlined" aria-hidden="true">swap_horiz</span>
                    </button>
                    <button class="relation-action-button relation-remove-button" type="button"
                      data-remove-relation="${escapeAttribute(relation.id)}"
                      data-remove-edge="${escapeAttribute(relation.edgeId)}"
                      aria-label="Hapus relasi dengan ${escapeAttribute(displayAssetName(connectedAsset))}"
                      title="Hapus relasi" ${relationBusy ? 'disabled' : ''}>
                      <span class="material-symbols-outlined" aria-hidden="true">close</span>
                    </button>
                  ` : ''}
                </div>
              </li>
            `).join('')}
          </ul>
        ` : ''}
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
        sourceIconDataByUrl,
      })}

      ${assetNetworks.length ? `<section class="drawer-section connected-networks" aria-labelledby="asset-networks-title">
        <div class="drawer-section-heading">
          <h3 id="asset-networks-title">Jaringan yang mencakup aset</h3>
          <span class="count-badge">${assetNetworks.length}</span>
        </div>
        ${assetNetworks.map((network) => `
          <button type="button" data-focus-network="${escapeAttribute(network.id)}">
            <span class="connected-network-icon material-symbols-outlined"
              style="--network-indicator:${escapeAttribute(network.color)}" aria-hidden="true">${connectedNetworkIcon(network.type)}</span>
            <span>
              <strong>${escapeHtml(networkDisplayName(network))}</strong>
              ${networkDisplayType(network) ? `<small>${escapeHtml(networkDisplayType(network))}</small>` : ''}
            </span>
            <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
        `).join('')}
      </section>` : ''}

    </div>

    <footer class="drawer-actions">
      <div class="drawer-secondary-actions${positionAvailable ? '' : ' single-action'}">
        ${positionAvailable ? `<button class="button secondary drawer-map-position-action" type="button"
          data-focus-asset-position>
          <span class="material-symbols-outlined" aria-hidden="true">center_focus_strong</span>
          Lihat di peta
        </button>` : ''}
        <button class="button secondary open-schematic" type="button"
          ${diagramAvailable ? '' : 'disabled aria-disabled="true" title="Belum ada aset yang dapat ditampilkan pada diagram."'}>
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
          Diagram topologi
        </button>
      </div>
    </footer>
  `
}

function renderRelationEditor({
  relationOptions = [],
  relationReplaceId = null,
  relationSearch = '',
  relationStatus = 'idle',
  relationError = null,
  sourceIconDataByUrl = null,
}) {
  const saving = relationStatus === 'saving'
  const hasQuery = Boolean(relationSearch.trim())
  return `
    <div class="drawer-relation-editor" role="group" aria-label="${relationReplaceId ? 'Ganti relasi aset' : 'Tambah relasi aset'}" aria-busy="${saving ? 'true' : 'false'}">
      <label class="search-control drawer-relation-search" for="drawer-relation-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input id="drawer-relation-search" data-relation-search type="search"
          value="${escapeAttribute(relationSearch)}"
          placeholder="Cari aset untuk dihubungkan…"
          aria-label="Cari aset untuk ${relationReplaceId ? 'mengganti' : 'menambah'} relasi"
          autocomplete="off" spellcheck="false" ${saving ? 'disabled' : ''}/>
      </label>
      <div class="drawer-relation-search-results" data-relation-search-results
        role="listbox" aria-label="Aset yang dapat dihubungkan" ${hasQuery ? '' : 'hidden'}>
        ${renderRelationSearchResults(relationOptions, relationSearch, relationReplaceId, saving, sourceIconDataByUrl)}
      </div>
      <small>${relationReplaceId
        ? 'Cari aset pengganti, lalu pilih untuk memperbarui relasi.'
        : 'Cari aset, lalu pilih + untuk menambahkan relasi.'}</small>
      ${relationError ? `<p class="drawer-relation-error" role="alert">${escapeHtml(relationError)}</p>` : ''}
    </div>
  `
}

export function renderRelationSearchResults(
  relationOptions = [],
  searchText = '',
  relationReplaceId = null,
  disabled = false,
  sourceIconDataByUrl = null,
) {
  const query = String(searchText || '').trim().toLocaleLowerCase('id')
  if (!query) return ''

  const matchingOptions = relationOptions
    .map((option, index) => {
      const optionAsset = option.asset
      const searchValue = [
        displayAssetName(optionAsset),
        optionAsset?.id,
        optionAsset?.type,
        optionAsset?.category,
        optionAsset?.branchName,
        optionAsset?.areaName,
        optionAsset?.locationGroupName,
        option.reason,
      ].filter(Boolean).join(' ').toLocaleLowerCase('id')
      const matchIndex = searchValue.indexOf(query)
      if (matchIndex < 0) return null
      const name = displayAssetName(optionAsset).toLocaleLowerCase('id')
      const id = String(optionAsset?.id || '').toLocaleLowerCase('id')
      const score = name.startsWith(query) || id.startsWith(query) ? 2 : 1
      return { ...option, index, score }
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 30)

  if (!matchingOptions.length) {
    return '<p role="status">Tidak ada aset yang cocok.</p>'
  }

  const actionIcon = relationReplaceId ? 'swap_horiz' : 'add'
  return matchingOptions.map(({ asset: optionAsset, reason }) => {
    const metadata = [
      optionAsset.type || optionAsset.category || 'Aset',
      optionAsset.branchName || optionAsset.locationGroupName || optionAsset.areaName || reason,
    ].filter(Boolean).join(' · ')
    return `
      <button type="button" role="option" data-relation-target="${escapeAttribute(optionAsset.id)}"
        aria-label="${relationReplaceId ? 'Ganti relasi dengan' : 'Tambah relasi ke'} ${escapeAttribute(displayAssetName(optionAsset))}"
        ${disabled ? 'disabled' : ''}>
        ${renderRelationAssetIcon(optionAsset, sourceIconDataByUrl)}
        <span>
          <strong>${escapeHtml(displayAssetName(optionAsset))}</strong>
          <small>${escapeHtml(metadata)}</small>
        </span>
        <span class="material-symbols-outlined" aria-hidden="true">${actionIcon}</span>
      </button>
    `
  }).join('')
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
  sourceIconDataByUrl,
}) {
  const mountable = isMountableAsset(asset)
  const pole = isPoleAsset(asset)
  const availableMountingOptions = mountingOptions.length ? mountingOptions : mountingCandidates
  if (!pole && !mountedOnAsset && !mountedAssets.length
    && !(mountable && mountingControlsAvailable)
    && !showMountingCandidates && !mountingActionError
    && mountingActionStatus !== 'success') {
    return ''
  }

  const busy = mountingActionStatus === 'loading'
  const canEdit = mountingControlsAvailable && mountable
  const assignedLabel = mountedOnAsset
    ? displayAssetName(mountedOnAsset)
    : 'Belum ditentukan'
  const mountingPickerLabel = showMountingCandidates
    ? 'Tutup pilihan tiang'
    : mountedOnAsset ? 'Ganti tiang' : 'Tambah tiang'
  const mountingPickerIcon = showMountingCandidates
    ? 'close'
    : mountedOnAsset ? 'swap_horiz' : 'add'
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
          <small>${escapeHtml(mountingCandidateMetadata(candidate))}</small>
        </span>
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
    </li>
  `).join('')

  return `
    <section class="drawer-section mounting-section" aria-labelledby="asset-mounting-title">
      <div class="drawer-section-heading">
        <h3 id="asset-mounting-title">${pole ? 'Aset terpasang' : 'Jaringan tiang'}</h3>
        <div class="drawer-section-heading-actions">
          <span class="count-badge">${pole ? mountedAssets.length : mountedOnAsset ? 1 : 0}</span>
          ${canEdit && !mountedOnAsset ? `
            <button class="mounting-picker-action" type="button" data-mounting-action="change"
              aria-label="${mountingPickerLabel}" title="${mountingPickerLabel}"
              aria-expanded="${showMountingCandidates ? 'true' : 'false'}" ${busy ? 'disabled' : ''}>
              <span class="material-symbols-outlined" aria-hidden="true">${mountingPickerIcon}</span>
            </button>
          ` : ''}
        </div>
      </div>
      ${mountable ? `
        <div class="mounting-assignment mounting-current-row">
          ${mountedOnAsset ? `
            <button type="button" class="mounting-current" data-connected-asset="${escapeAttribute(mountedOnAsset.id)}"
              title="${escapeAttribute(mountedOnAssetTooltip(assignedLabel, mountedOnAsset.id))}">
              <span class="relation-icon material-symbols-outlined" aria-hidden="true">location_on</span>
              <span><strong>${escapeHtml(assignedLabel)}</strong><small>${escapeHtml(mountingAssetSubtitle(mountedOnAsset.id))}</small></span>
              <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
            </button>
          ` : `<p class="drawer-inline-empty">Belum ada tiang yang ditetapkan.</p>`}
          ${mountedOnAsset && canEdit ? `
            <button class="mounting-picker-action relation-replace-button" type="button"
              data-mounting-action="change" aria-label="${mountingPickerLabel}"
              title="${mountingPickerLabel}" aria-expanded="${showMountingCandidates ? 'true' : 'false'}"
              ${busy ? 'disabled' : ''}>
              <span class="material-symbols-outlined" aria-hidden="true">${mountingPickerIcon}</span>
            </button>
            <button class="mounting-picker-action mounting-remove-button" type="button"
              data-mounting-action="detach"
              aria-label="Hapus relasi dengan tiang ${escapeAttribute(assignedLabel)}"
              title="Hapus relasi tiang" ${busy ? 'disabled' : ''}>
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          ` : ''}
        </div>
      ` : ''}
      ${pole ? `
        <div class="mounting-assignment">
          ${mountedAssets.length ? `
            <ul class="relation-list mounting-asset-list">
              ${mountedAssets.map((mountedAsset) => `
                <li>
                  <button type="button" data-connected-asset="${escapeAttribute(mountedAsset.id)}">
                    ${renderRelationAssetIcon(mountedAsset, sourceIconDataByUrl)}
                    <span><strong>${escapeHtml(displayAssetName(mountedAsset))}</strong><small>${escapeHtml(mountingAssetSubtitle(mountedAsset.id))}</small></span>
                    <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                  </button>
                </li>
              `).join('')}
            </ul>
          ` : renderInlineEmpty('Belum ada aset yang terdeteksi terpasang pada tiang ini.')}
        </div>
      ` : ''}
      ${showMountingCandidates ? `
        <div class="mounting-candidate-panel" aria-live="polite">
          <h4 class="mounting-candidate-heading">Pilih tiang</h4>
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
      ${mountingActionStatus === 'success' ? `<p class="mounting-action-status success" role="status"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Jaringan tiang diperbarui.</p>` : ''}
      ${mountingActionError ? `<p class="mounting-action-status error" role="alert"><span class="material-symbols-outlined" aria-hidden="true">error</span>${escapeHtml(mountingActionError)}</p>` : ''}
      </section>
  `
}

function renderLoadingState(asset) {
  return `
    <header class="drawer-header drawer-header-minimal">
      <button class="icon-button close-drawer" type="button" aria-label="Tutup detail aset">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    ${asset ? `<section class="drawer-title">
      <h2>${escapeHtml(displayAssetName(asset))}</h2>
      <p>${escapeHtml(asset.type || 'Jenis aset belum tersedia')}</p>
      ${asset.location ? `<small>${escapeHtml(asset.location)}</small>` : ''}
    </section>` : ''}
    <div class="drawer-state drawer-loading" aria-live="polite" aria-busy="true">
      <div class="drawer-skeleton"><i></i><i></i><i></i><i></i></div>
      <span>Memuat aset dari dataset aktif…</span>
    </div>
  `
}

function renderErrorState(errorMessage, asset = null) {
  return `
    <header class="drawer-header drawer-header-minimal">
      <button class="icon-button toggle-mobile-drawer" type="button"
        aria-expanded="false" aria-label="Perluas detail aset" title="Perluas detail aset">
        <span class="material-symbols-outlined" aria-hidden="true">expand_less</span>
      </button>
      <button class="icon-button close-drawer" type="button" aria-label="Tutup detail aset">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    ${asset ? renderMobileLocationSummary(asset) : ''}
    <div class="drawer-scroll-content">
      <div class="drawer-state drawer-error" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">error</span>
        <strong>Detail aset tidak dapat dimuat</strong>
        <p>${escapeHtml(errorMessage || 'Aset tidak tersedia pada dataset aktif.')}</p>
        <button class="button secondary retry-asset-detail" type="button">Coba lagi</button>
      </div>
    </div>
  `
}

function renderMobileLocationSummary(asset) {
  const positionAvailable = hasMapPosition(asset?.coordinate)
  return `
    <div class="drawer-mobile-summary">
      <span class="drawer-mobile-location-copy">
        <strong>${escapeHtml(displayAssetName(asset))}</strong>
        <small>${escapeHtml(formatAssetTypeLabel(asset))}${asset.location ? ` · ${escapeHtml(asset.location)}` : ''}</small>
      </span>
      ${positionAvailable ? `<button class="focus-asset-position" type="button" data-focus-asset-position>
        Lihat posisi di peta
      </button>` : ''}
    </div>
  `
}

function renderEmptyState() {
  return `
    <header class="drawer-header drawer-header-minimal">
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
  if (asset.dynamicCategory) return { label: asset.category, token: 'custom' }
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
  if (assetSource.includes('power') || assetSource.includes('pln') || assetSource.includes('listrik')) {
    return { label: 'Power PLN', token: 'power' }
  }
  if (['switch', 'server', 'access point'].some((type) => assetSource.includes(type))) {
    return { label: 'Infrastruktur', token: 'infrastructure' }
  }

  const networkSource = assetNetworks.map((network) => network.type).join(' ').toLowerCase()
  if (networkSource.includes('cctv')) return { label: 'CCTV', token: 'cctv' }
  if (networkSource.includes('fiber')) return { label: 'Fiber optic', token: 'fiber' }
  if (networkSource.includes('power')) return { label: 'Power PLN', token: 'power' }
  if (networkSource.includes('lan')) return { label: 'LAN', token: 'lan' }
  return { label: 'Infrastruktur', token: 'infrastructure' }
}

function assetIcon(type = '') {
  const normalizedType = String(type ?? '').toLocaleLowerCase('id')
  if (/cctv|camera|kamera/.test(normalizedType)) return 'videocam'
  if (normalizedType.includes('switch')) return 'router'
  if (normalizedType.includes('junction')) return 'hub'
  if (normalizedType === 'server' || normalizedType === 'nvr') return 'dns'
  if (normalizedType === 'otb') return 'settings_input_component'
  if (normalizedType === 'access point') return 'wifi'
  if (normalizedType === 'printer') return 'print'
  return 'device_hub'
}

function renderRelationAssetIcon(asset, sourceIconDataByUrl = null) {
  const iconUrl = assetIconUrl(asset)
  const sourceIcon = sourceIconDataByUrl?.get?.(iconUrl)
  if (sourceIcon) return `<img class="relation-icon relation-icon-image" src="${escapeAttribute(sourceIcon)}" alt="" aria-hidden="true">`
  if (isJunctionBoxAsset(asset) && !asset.iconReset) {
    return `<img class="relation-icon relation-icon-image" src="${JUNCTION_BOX_ICON_URL}" alt="" aria-hidden="true">`
  }
  return `<span class="relation-icon material-symbols-outlined" aria-hidden="true">${assetIcon(`${asset?.type || ''} ${asset?.category || ''}`)}</span>`
}

function renderAssetIconControl(asset, { iconControlsAvailable, sourceIconDataByUrl }) {
  const url = assetIconUrl(asset)
  const source = sourceIconDataByUrl?.get?.(url)
    || (url === JUNCTION_BOX_ICON_URL ? url : null)
  const preview = source
    ? `<img src="${escapeAttribute(source)}" alt="" class="asset-icon-image">`
    : `<span class="material-symbols-outlined" aria-hidden="true">${assetIconGlyph(asset)}</span>`
  return `<div class="asset-icon-control">
    ${iconControlsAvailable ? `<button class="asset-icon-preview" type="button" data-asset-icon-trigger
      aria-label="Ubah ikon aset" aria-expanded="false" aria-controls="asset-icon-actions" title="Ubah ikon aset">
      ${preview}<span class="asset-icon-edit material-symbols-outlined" aria-hidden="true">edit</span>
    </button>
    <div class="asset-icon-actions" id="asset-icon-actions" hidden>
      <button type="button" data-change-asset-icon><span class="material-symbols-outlined" aria-hidden="true">image</span>Ganti ikon</button>
      <button type="button" data-reset-asset-icon ${assetIconCanReset(asset) ? '' : 'disabled title="Tidak ada gambar ikon untuk dihapus"'}><span class="material-symbols-outlined" aria-hidden="true">delete</span>Hapus ikon</button>
    </div>` : `<div class="asset-icon-preview">${preview}</div>`}
  </div>`
}

function networkDisplayName(network = {}) {
  return network.shortName || network.name || network.type || 'Jaringan aset'
}

function networkDisplayType(network = {}) {
  const type = String(network.type || '').trim()
  return type && type.toLocaleLowerCase('id') !== String(networkDisplayName(network)).trim().toLocaleLowerCase('id')
    ? type
    : ''
}

function connectedNetworkIcon(type = '') {
  const normalizedType = String(type ?? '').toLocaleLowerCase('id')
  if (/cctv|camera|kamera/.test(normalizedType)) return 'videocam'
  if (/fiber|optic/.test(normalizedType)) return 'settings_ethernet'
  if (/power|pln|listrik/.test(normalizedType)) return 'bolt'
  if (/lan/.test(normalizedType)) return 'hub'
  return 'device_hub'
}

function isGeneratedAssetId(value) {
  return /^AUTO[-_]/i.test(String(value ?? '').trim())
}

function mountingAssetSubtitle(assetId) {
  return isGeneratedAssetId(assetId) ? 'Relasi terkonfirmasi' : String(assetId ?? '').trim()
}

function mountingCandidateMetadata(candidate = {}) {
  const distance = formatDistance(candidate.distanceMeters)
  return isGeneratedAssetId(candidate.targetAssetId)
    ? distance
    : `${candidate.targetAssetId} · ${distance}`
}

function mountedOnAssetTooltip(name, assetId) {
  return isGeneratedAssetId(assetId) ? name : `${name} · ${assetId}`
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
  if (value === null || value === undefined || value === '') return 'jarak tidak tersedia'
  const distance = Number(value)
  return Number.isFinite(distance) ? `${distance.toLocaleString('id-ID', { maximumFractionDigits: 2 })} m` : 'jarak tidak tersedia'
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

function hasMapPosition(coordinate) {
  return Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(Number(coordinate[0]))
    && Number.isFinite(Number(coordinate[1]))
}

function escapeAttribute(value) {
  return escapeHtml(value)
}
