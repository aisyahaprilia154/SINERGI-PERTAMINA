export function formatAssetTypeLabel(asset = {}) {
  const values = typeof asset === 'string'
    ? [asset]
    : [asset?.type, asset?.assetType, asset?.category, asset?.networkFamily]
  const source = values
    .map((value) => String(value ?? '').trim())
    .find((value) => value && !/^(unknown|aset)$/i.test(value))
  if (!source) return 'Jenis aset belum tercatat'

  const normalized = source.toLowerCase()
  if (/cctv|camera|kamera/.test(normalized)) return 'Kamera CCTV'
  if (/junction|\bjb\b/.test(normalized)) return 'Junction Box'
  if (/router/.test(normalized)) return 'Router'
  if (/switch/.test(normalized)) return 'Switch'
  if (/server|rack|nvr/.test(normalized)) return 'Server / rack'
  if (/access.?point|\bap\b/.test(normalized)) return 'Access point'
  if (/printer/.test(normalized)) return 'Printer'
  if (/fiber|fibre|\botb\b/.test(normalized)) return 'Fiber optic'
  if (/power|\bpln\b|listrik/.test(normalized)) return 'Power PLN'
  if (/\blan\b|\butp\b/.test(normalized)) return 'LAN'
  if (/tiang|pole|pylon/.test(normalized)) return 'Tiang'
  return source
}
