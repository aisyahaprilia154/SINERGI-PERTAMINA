export const MAP_SEMANTIC_ZOOM = Object.freeze({
  overview: 13,
  network: 15,
  detail: 18,
})

export function semanticZoomLevel(zoom) {
  if (zoom < MAP_SEMANTIC_ZOOM.overview) return 'overview'
  if (zoom < MAP_SEMANTIC_ZOOM.network) return 'network'
  if (zoom < MAP_SEMANTIC_ZOOM.detail) return 'detail'
  return 'inspection'
}

/** Lower values stay visible longer as the map zooms out. */
export function assetVisualTier(asset = {}) {
  if (asset.isPole || isPoleAsset(asset)) return 0
  const identity = identityText(asset)
  if (asset.isCoreNode || /\b(hub|switch|router|server|rack|nvr|core)\b/.test(identity)) {
    return 1
  }
  if (/junction|\bjb\b/.test(identity)) return 2
  if (/cctv|camera|kamera|endpoint/.test(identity)) return 3
  return 4
}

export function assetVisibleAtZoom(asset, zoom) {
  const tier = assetVisualTier(asset)
  if (zoom < MAP_SEMANTIC_ZOOM.overview) return tier <= 1
  if (zoom < MAP_SEMANTIC_ZOOM.network) return tier <= 2
  if (zoom < MAP_SEMANTIC_ZOOM.detail) return tier <= 3
  return true
}

export function assetLabelEligibleAtZoom(asset, zoom, { showAllLabels = false } = {}) {
  if (asset.selected || asset.hovered || asset.searchHighlighted) return true
  const tier = assetVisualTier(asset)
  if (tier === 0) return true
  if (zoom < MAP_SEMANTIC_ZOOM.overview) return false
  // Show common network children as soon as they become individually useful.
  // Collision placement below keeps dense areas readable.
  if (tier === 1) return zoom >= MAP_SEMANTIC_ZOOM.overview
  if (tier === 2) return zoom >= (showAllLabels ? 13 : 14)
  if (tier === 3) return zoom >= (showAllLabels ? 14 : 15)
  if (tier === 4 && !showAllLabels) return zoom >= 18
  if (zoom < MAP_SEMANTIC_ZOOM.network) return false
  if (zoom < MAP_SEMANTIC_ZOOM.detail) return tier <= 3
  if (zoom < 20) return tier <= 3
  return true
}

export function maximumVisibleLineTier(zoom) {
  if (zoom < MAP_SEMANTIC_ZOOM.overview) return 1
  if (zoom < MAP_SEMANTIC_ZOOM.network) return 2
  if (zoom < MAP_SEMANTIC_ZOOM.detail) return 3
  return 4
}

function identityText(asset) {
  return [asset.topologyRole, asset.type, asset.category, asset.networkFamily,
    asset.assetType, asset.label, asset.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function isPoleAsset(asset) {
  const name = String(asset.name ?? asset.label ?? '').trim()
  return /\b(pole|tiang|tower|pylon)\b/.test(identityText(asset))
    || /^t[-_ ]?(?:\d+[a-z]?|tower)\b/i.test(name)
}
