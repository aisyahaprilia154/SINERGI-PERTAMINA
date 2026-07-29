const DEFAULT_SHORT_LABEL_LENGTH = 18
const DEFAULT_DISPLAY_LABEL_LENGTH = 30
const GENERATED_ID_PREFIXES = /^(?:src|asset-node|dataset|version|branch):/i
const TECHNICAL_SUFFIX = /(?:[\s._-]+(?:kml|kmz|exp))$/i
const UUID_TOKEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const ASSET_CODE = /\b(?:JB[-_\s]*CCTV|JB|CCTV|CAM(?:ERA)?|C|OTB|SW(?:ITCH)?|NVR|AP|SRV|SERVER|FO|LAN)(?:[-_\s]*(?:CORE|DIST|DISTRIBUTION|ACCESS))?[-_\s]*\d{1,6}(?:\.\d{1,3})?(?:[-_\s]*WP)?\b/i
const GENERIC_ASSET_CODE = /\b[A-Z]{1,5}[-_.\s]*\d{1,6}(?:\.\d{1,3})?(?:[-_\s]*[A-Z]{1,4})?\b/i

export function sanitizeSourceAssetName(value) {
  let normalized = String(value ?? '').trim()
  if (!normalized) return ''
  normalized = normalized.replaceAll('\\', '/')
  if (normalized.includes('/')) {
    normalized = normalized.split('/').map((part) => part.trim()).filter(Boolean).at(-1) || ''
  }
  normalized = stripGeneratedSourcePrefix(normalized)
    .replace(UUID_TOKEN, ' ')
    .replace(/\.(?:kml|kmz)$/gi, '')
    .replace(TECHNICAL_SUFFIX, '')
    .replace(/[\s_]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;|/._-]+|[\s:;|/._-]+$/g, '')
  return normalized.trim()
}

export function stripGeneratedSourcePrefix(value) {
  const source = String(value ?? '').trim()
  if (!source) return ''
  if (/^src:/i.test(source)) return source.split(':').filter(Boolean).at(-1) || ''
  if (GENERATED_ID_PREFIXES.test(source) && source.includes(':')) {
    return source.split(':').filter(Boolean).at(-1) || ''
  }
  return source
}

export function deriveAssetDisplayName(asset) {
  const officialAssetId = readOfficialAssetId(asset)
  const sourceName = readSourceName(asset)
  const cleanedSourceName = sanitizeSourceAssetName(sourceName)
  const companionName = validCompanionName(cleanedSourceName, officialAssetId)
  if (officialAssetId && companionName) return `${officialAssetId} · ${companionName}`
  if (officialAssetId) return officialAssetId
  if (cleanedSourceName && !isGeneratedIdentity(cleanedSourceName)) return cleanedSourceName

  const typeSequence = deriveTypeSequence(asset, cleanedSourceName)
  if (typeSequence) return typeSequence
  return stableFallbackLabel(asset)
}

export function deriveAssetShortLabel(asset) {
  const officialAssetId = readOfficialAssetId(asset)
  if (officialAssetId) return truncateAssetLabel(officialAssetId, DEFAULT_SHORT_LABEL_LENGTH)

  const sourceName = sanitizeSourceAssetName(readSourceName(asset))
  const sourceCode = extractAssetCode(sourceName)
  if (sourceCode) return truncateAssetLabel(sourceCode, DEFAULT_SHORT_LABEL_LENGTH)

  const typeSequence = deriveTypeSequence(asset, sourceName)
  if (typeSequence) return truncateAssetLabel(typeSequence, DEFAULT_SHORT_LABEL_LENGTH)
  return truncateAssetLabel(stableFallbackLabel(asset), DEFAULT_SHORT_LABEL_LENGTH)
}

export function normalizeAssetDisplayFields(asset, { sourceFolderPath = null } = {}) {
  const stableId = String(asset?.stableId ?? asset?.assetId ?? asset?.id ?? '').trim()
  const sourceName = String(asset?.sourceName ?? asset?.name ?? '').trim()
  const normalizedAsset = {
    ...asset,
    stableId,
    assetId: readOfficialAssetId({ ...asset, stableId }),
    sourceName,
    sourceFolderPath: sourceFolderPath
      ?? asset?.sourceFolderPath
      ?? asset?.properties?.sourceIdentityMapping?.sourceFolderPath
      ?? null,
  }
  const displayName = deriveAssetDisplayName(normalizedAsset)
  return {
    ...normalizedAsset,
    displayName,
    shortLabel: deriveAssetShortLabel(normalizedAsset),
    name: displayName,
  }
}

export function resolveDuplicateShortLabels(assets) {
  const normalized = (assets ?? []).map((asset) => (
    asset?.shortLabel && asset?.displayName && asset?.stableId
      ? { ...asset }
      : normalizeAssetDisplayFields(asset)
  ))
  const groups = new Map()
  normalized.forEach((asset) => {
    const key = String(asset.shortLabel || '').trim().toLocaleLowerCase('id')
    groups.set(key, [...(groups.get(key) ?? []), asset])
  })

  groups.forEach((duplicates) => {
    if (duplicates.length < 2) return
    duplicates
      .sort((left, right) => stableKey(left).localeCompare(stableKey(right), 'id'))
      .forEach((asset, index) => {
        const suffix = ` · ${alphabeticSequence(index)}`
        const base = truncateAssetLabel(
          asset.shortLabel,
          DEFAULT_SHORT_LABEL_LENGTH - suffix.length,
          '',
        )
        asset.shortLabel = `${base}${suffix}`
      })
  })
  return normalized
}

export function getAssetRenderLabels(asset, {
  shortMax = DEFAULT_SHORT_LABEL_LENGTH,
  displayMax = DEFAULT_DISPLAY_LABEL_LENGTH,
} = {}) {
  const fullShortLabel = asset?.shortLabel || deriveAssetShortLabel(asset)
  const fullDisplayName = asset?.displayName || deriveAssetDisplayName(asset)
  return {
    shortLabel: truncateAssetLabel(fullShortLabel, shortMax),
    displayName: truncateAssetLabel(fullDisplayName, displayMax),
    fullShortLabel,
    fullDisplayName,
  }
}

export function truncateAssetLabel(value, maximumLength, suffix = '…') {
  const normalized = String(value ?? '').trim()
  if (!Number.isInteger(maximumLength) || maximumLength < 1 || normalized.length <= maximumLength) {
    return normalized
  }
  const available = Math.max(1, maximumLength - suffix.length)
  return `${normalized.slice(0, available).trimEnd()}${suffix}`
}

function readOfficialAssetId(asset) {
  const candidate = String(asset?.assetId ?? '').trim()
  if (!candidate
    || asset?.properties?.sourceIdentityMapping
    || /^src:/i.test(candidate)
    || /^asset-node:/i.test(candidate)) return null
  return candidate
}

function readSourceName(asset) {
  return asset?.sourceName
    ?? asset?.properties?.sourceIdentityMapping?.sourcePlacemarkName
    ?? asset?.name
    ?? ''
}

function validCompanionName(cleanedSourceName, officialAssetId) {
  if (!cleanedSourceName || /^placemark\s+\d+$/i.test(cleanedSourceName)) return ''
  if (canonical(cleanedSourceName) === canonical(officialAssetId)) return ''
  if (isGeneratedIdentity(cleanedSourceName)) return ''
  return cleanedSourceName
}

function extractAssetCode(value) {
  const source = String(value ?? '')
  const match = source.match(ASSET_CODE)?.[0] || source.match(GENERIC_ASSET_CODE)?.[0]
  if (!match) return ''
  return match
    .toUpperCase()
    .replace(/\bCAMERA\b/, 'CCTV')
    .replace(/\bCAM\b/, 'CCTV')
    .replace(/\bSWITCH\b/, 'SW')
    .replace(/\bSERVER\b/, 'SRV')
    .replace(/\bDISTRIBUTION\b/, 'DIST')
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
}

function deriveTypeSequence(asset, sourceName) {
  const sequence = String(sourceName || stripGeneratedSourcePrefix(stableKey(asset)))
    .match(/\d{1,6}[A-Z]?/i)?.[0]
  if (!sequence) return ''
  return `${typePrefix(asset?.assetType || asset?.type || asset?.category)}-${sequence.toUpperCase()}`
}

function typePrefix(value) {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized.includes('junction') || /\bjb\b/.test(normalized)) return 'JB'
  if (normalized.includes('cctv') || normalized.includes('camera')) return 'CCTV'
  if (normalized.includes('otb')) return 'OTB'
  if (normalized.includes('switch') || normalized.includes('router')) return 'SW'
  if (normalized.includes('nvr')) return 'NVR'
  if (normalized.includes('access point')) return 'AP'
  if (normalized.includes('server')) return 'SRV'
  if (normalized.includes('fiber')) return 'FO'
  if (normalized.includes('lan')) return 'LAN'
  return 'ASET'
}

function stableFallbackLabel(asset) {
  const stableId = stableKey(asset)
  const stripped = sanitizeSourceAssetName(stripGeneratedSourcePrefix(stableId))
  const code = extractAssetCode(stripped)
  if (code) return code
  return `${typePrefix(asset?.assetType || asset?.type || asset?.category)}-${stableHash(stableId)}`
}

function stableKey(asset) {
  return String(asset?.stableId ?? asset?.id ?? asset?.assetId ?? '').trim()
}

function stableHash(value) {
  let hash = 2166136261
  for (const character of String(value || 'asset')) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(4, '0').slice(-4)
}

function alphabeticSequence(index) {
  let value = index + 1
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

function canonical(value) {
  return String(value ?? '').toLocaleLowerCase('id').replace(/[^a-z0-9]/g, '')
}

function isGeneratedIdentity(value) {
  return /^src:/i.test(value) || /^asset-node:/i.test(value) || value.length > 80
}
