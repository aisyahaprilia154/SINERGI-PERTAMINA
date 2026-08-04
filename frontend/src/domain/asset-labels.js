const INTERNAL_ID_PATTERN = /^(asset-node:|dv-[a-f0-9-]+:|[a-f0-9]{8}-[a-f0-9-]{20,}|[a-f0-9]{24,})/i

export function deriveAssetDisplayName(asset = {}) {
  const candidates = [asset.displayName, asset.name, asset.label, asset.shortName]
  const label = candidates.find((value) => value && !looksInternal(value))
  if (label) return cleanLabel(label)
  return humanizeType(asset.type || asset.category || 'Aset')
}

export function deriveAssetShortLabel(asset = {}, maxLength = 18) {
  const label = deriveAssetDisplayName(asset)
  if (label.length <= maxLength) return label
  return `${label.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function createAssetLabelIndex(assets = [], maxLength = 18) {
  const records = [...assets]
    .map((asset) => ({ asset, base: deriveAssetShortLabel(asset, maxLength) }))
    .sort((left, right) => String(left.asset.id).localeCompare(String(right.asset.id), 'id'))
  const occurrences = new Map()
  const result = new Map()
  records.forEach(({ asset, base }) => {
    const count = (occurrences.get(base) || 0) + 1
    occurrences.set(base, count)
    const suffix = count > 1 ? ` ${count}` : ''
    const shortened = suffix
      ? `${base.slice(0, Math.max(1, maxLength - suffix.length)).trimEnd()}${suffix}`
      : base
    result.set(asset.id, {
      displayName: deriveAssetDisplayName(asset),
      shortLabel: shortened,
    })
  })
  return result
}

export function looksInternal(value = '') {
  const text = String(value).trim()
  return INTERNAL_ID_PATTERN.test(text) || (text.includes(':src-') && text.length > 32)
}

function cleanLabel(value) {
  return String(value).replaceAll(/\s+/g, ' ').trim()
}

function humanizeType(value) {
  return cleanLabel(value).replaceAll(/[-_]+/g, ' ')
}
