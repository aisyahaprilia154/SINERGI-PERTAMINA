export function getAssetCategory(asset, assetNetworks) {
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

export function assetIcon(type = '') {
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


export function networkDisplayName(network = {}) {
  return network.shortName || network.name || network.type || 'Jaringan aset'
}

export function networkDisplayType(network = {}) {
  const type = String(network.type || '').trim()
  return type && type.toLocaleLowerCase('id') !== String(networkDisplayName(network)).trim().toLocaleLowerCase('id')
    ? type
    : ''
}

export function connectedNetworkIcon(type = '') {
  const normalizedType = String(type ?? '').toLocaleLowerCase('id')
  if (/cctv|camera|kamera/.test(normalizedType)) return 'videocam'
  if (/fiber|optic/.test(normalizedType)) return 'settings_ethernet'
  if (/power|pln|listrik/.test(normalizedType)) return 'bolt'
  if (/lan/.test(normalizedType)) return 'hub'
  return 'device_hub'
}

export function isGeneratedAssetId(value) {
  return /^AUTO[-_]/i.test(String(value ?? '').trim())
}

export function mountingAssetSubtitle(assetId) {
  return isGeneratedAssetId(assetId) ? 'Relasi terkonfirmasi' : String(assetId ?? '').trim()
}

export function mountingCandidateMetadata(candidate = {}) {
  const distance = formatDistance(candidate.distanceMeters)
  return isGeneratedAssetId(candidate.targetAssetId)
    ? distance
    : `${candidate.targetAssetId} · ${distance}`
}

export function mountedOnAssetTooltip(name, assetId) {
  return isGeneratedAssetId(assetId) ? name : `${name} · ${assetId}`
}

export function isMountableAsset(asset) {
  return /junction|\bjb\b|cctv|camera|kamera/i.test(
    `${asset?.type || ''} ${asset?.category || ''}`,
  )
}

export function isPoleAsset(asset) {
  return /\b(tiang|pole|pylon)\b/i.test(
    `${asset?.type || ''} ${asset?.category || ''} ${asset?.name || ''}`,
  )
}

export function formatDistance(value) {
  if (value === null || value === undefined || value === '') return 'jarak tidak tersedia'
  const distance = Number(value)
  return Number.isFinite(distance) ? `${distance.toLocaleString('id-ID', { maximumFractionDigits: 2 })} m` : 'jarak tidak tersedia'
}

export function displayAssetName(asset) {
  return String(asset?.name || '').trim() || 'Aset tanpa nama'
}

export function hasMapPosition(coordinate) {
  return Array.isArray(coordinate) && coordinate.length >= 2
    && Number.isFinite(Number(coordinate[0])) && Number.isFinite(Number(coordinate[1]))
}
