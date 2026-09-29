export const JUNCTION_BOX_ICON_URL = '/icons/junction-box.png'

export function isJunctionBoxAsset(asset = {}) {
  const type = String(asset.type ?? '').toLowerCase()
  const iconType = String(asset.iconType ?? '').toLowerCase()
  const diagramClass = String(asset.diagramClass ?? '').toLowerCase()
  const role = String(asset.topologyRole ?? '').toLowerCase()
  if (/junction[\s_-]*box/.test(type) || iconType === 'junction-box'
    || diagramClass.startsWith('junction-') || role === 'junction') return true
  if (/server|rack|switch|router|nvr/.test(type)) return false
  return /^jb(?:[-_.\s]|$)/i.test(String(asset.name ?? '').trim())
}
