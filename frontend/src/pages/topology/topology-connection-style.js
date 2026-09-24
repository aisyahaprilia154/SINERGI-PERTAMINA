// One palette for every facility, SVG export, arrowhead, and legend.
export const CONNECTION_STYLES = Object.freeze({
  'core-core': {label: 'Server/core ↔ Server/core', color: '#8967c8'},
  'core-jb': {label: 'Server/core ↔ JB', color: '#438bdf'},
  'camera-core': {label: 'Server/core ↔ CCTV', color: '#1ba6ad'},
  'jb-jb': {label: 'JB ↔ JB', color: '#3ba676'},
  'camera-jb': {label: 'JB ↔ CCTV', color: '#d69331'},
  'camera-camera': {label: 'CCTV ↔ CCTV', color: '#c577a8'},
  other: {label: 'Koneksi lainnya', color: '#8e9aa8'},
})

function kind(node) {
  if (!node) return 'other'
  if (['junction-peer', 'junction-extended'].includes(node.diagramClass)) return 'jb'
  if (node.diagramClass === 'rack-root') return 'core'
  const type = [node.canonicalAssetType, node.assetType, node.type, node.category].filter(Boolean).join(' ')
  if (/cctv|camera|kamera/i.test(type)) return 'camera'
  return 'other'
}

export function connectionStyle(source, target) {
  const key = [kind(source), kind(target)].sort().join('-')
  return {key: CONNECTION_STYLES[key] ? key : 'other', ...(CONNECTION_STYLES[key] ?? CONNECTION_STYLES.other)}
}
