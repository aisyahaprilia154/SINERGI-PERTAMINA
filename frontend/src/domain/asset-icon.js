import { isJunctionBoxAsset, JUNCTION_BOX_ICON_URL } from './junction-box-icon.js'

export function assetIconUrl(asset) {
  if (asset?.customIconUrl) return asset.customIconUrl
  if (asset?.iconReset) return isJunctionBoxAsset(asset) ? JUNCTION_BOX_ICON_URL : null
  return isJunctionBoxAsset(asset) ? JUNCTION_BOX_ICON_URL : asset?.sourceIconUrl || null
}

export function assetIconCanReset(asset) {
  return Boolean(asset?.customIconUrl || (!asset?.iconReset && asset?.sourceIconUrl))
}

export function assetIconGlyph(asset) {
  const type = `${asset?.type || ''} ${asset?.category || ''}`.toLowerCase()
  if (/cctv|camera|kamera/.test(type)) return 'videocam'
  if (/junction|\bjb\b/.test(type)) return 'hub'
  if (/tiang|pole/.test(type)) return 'cell_tower'
  if (/switch|router/.test(type)) return 'router'
  if (/server|nvr/.test(type)) return 'dns'
  if (/otb/.test(type)) return 'settings_input_component'
  if (/access point/.test(type)) return 'wifi'
  if (/printer/.test(type)) return 'print'
  return 'device_hub'
}
