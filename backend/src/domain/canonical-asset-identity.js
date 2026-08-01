import { createHash } from 'node:crypto'

export const CANONICAL_ASSET_ID_VERSION = 'canonical-asset-identity/1.0.0'

/**
 * Builds the versioned identity map shared by the importer and topology
 * engine. A business Asset ID remains the preferred canonical value. When a
 * source does not provide one, the deterministic onboarding identity becomes
 * canonical and the legacy folder/name value is retained only as an alias.
 */
export function buildCanonicalAssetIdentityMap({
  datasetVersion,
  sourceFeatures = [],
  classifiedObjects = [],
} = {}) {
  const datasetVersionId = readString(datasetVersion?.id) ?? 'unknown-dataset-version'
  const featureById = new Map(
    sourceFeatures
      .filter((feature) => feature?.sourceFeatureId)
      .map((feature) => [feature.sourceFeatureId, feature]),
  )
  const records = classifiedObjects
    .filter((object) => object?.sourceFeatureId)
    .map((object) => ({
      object,
      feature: featureById.get(object.sourceFeatureId),
    }))
  const legacyBases = records.map(({ object, feature }) => (
    legacyIdentityBase(feature, object)
  ))
  const legacyTotals = countValues(legacyBases.filter(Boolean))
  const legacyOccurrences = new Map()

  const items = records.map(({ object, feature }) => {
    const sourceFeatureId = object.sourceFeatureId
    const stableAssetId = readString(object.assetId)
    const onboardingId = deterministicId(
      'onboarding-identity',
      datasetVersionId,
      sourceFeatureId,
    )
    const legacyBase = legacyIdentityBase(feature, object)
    const occurrence = legacyBase
      ? (legacyOccurrences.set(
        legacyBase,
        (legacyOccurrences.get(legacyBase) ?? 0) + 1,
      ), legacyOccurrences.get(legacyBase))
      : 1
    const legacyId = legacyBase
      ? (legacyTotals.get(legacyBase) > 1 ? `${legacyBase}:${occurrence}` : legacyBase)
      : `legacy:${sourceFeatureId}`
    const canonicalAssetId = stableAssetId ?? onboardingId
    const aliases = {
      canonicalAssetId: [canonicalAssetId],
      stableAssetId: stableAssetId ? [stableAssetId] : [],
      sourceId: unique([feature?.sourceKmlId]),
      onboardingId: [onboardingId],
      legacyId: [legacyId],
      sourceFeatureId: [sourceFeatureId],
    }
    return {
      canonicalAssetId,
      stableAssetId: stableAssetId ?? null,
      onboardingId,
      legacyId,
      sourceFeatureId,
      sourceKmlId: feature?.sourceKmlId ?? null,
      identityStatus: stableAssetId ? 'stable' : 'onboarding',
      aliasValues: unique(Object.values(aliases).flat()),
      aliases,
    }
  })

  const validation = validateIdentityItems(items, records)
  return {
    version: CANONICAL_ASSET_ID_VERSION,
    datasetVersionId,
    items,
    aliasToCanonicalAssetId: buildAliasIndex(items, validation),
    validation,
  }
}

/**
 * Reconstructs an identity map for records imported before the canonical map
 * was persisted. The topology input bundle is used only to recover old
 * onboarding IDs; canonical identity falls back to the persisted asset ID so
 * existing active datasets remain readable.
 */
export function buildAssetIdentityMapFromRecord(record = {}) {
  if (record.assetIdentityMap?.items && record.assetIdentityMap?.aliasToCanonicalAssetId) {
    return structuredClone(record.assetIdentityMap)
  }

  const topologyObjects = new Map(
    [
      ...(record.topologyInputBundle?.classifiedNodes ?? []),
      ...(record.topologyInputBundle?.classifiedPaths ?? []),
    ]
      .filter((object) => object?.sourceFeatureId)
      .map((object) => [object.sourceFeatureId, object]),
  )
  const items = (record.assets ?? []).map((asset) => {
    const properties = asset.properties ?? {}
    const sourceFeatureId = asset.canonicalSourceFeatureId
      ?? asset.sourceFeatureId
      ?? properties.sourceFeatureId
      ?? null
    const topologyObject = topologyObjects.get(sourceFeatureId)
    const onboardingId = asset.onboardingIdentity
      ?? topologyObject?.onboardingIdentity
      ?? (sourceFeatureId
        ? deterministicId('onboarding-identity', record.datasetVersion?.id, sourceFeatureId)
        : null)
    const sourceIdentityStrategy = properties.sourceIdentityMapping?.strategy
    const isLegacyFallback = sourceIdentityStrategy === 'folder-path-name'
    const stableAssetId = asset.stableAssetId
      ?? (asset.identityStatus === 'stable'
        || (!isLegacyFallback && !asset.onboardingIdentity && !topologyObject?.onboardingIdentity)
        ? (asset.assetId ?? null)
        : null)
    const canonicalAssetId = asset.canonicalAssetId
      ?? stableAssetId
      ?? topologyObject?.canonicalAssetId
      ?? topologyObject?.assetId
      ?? onboardingId
      ?? asset.id
    const legacyId = asset.legacyAssetId
      ?? properties.sourceIdentityMapping?.legacyId
      ?? asset.assetId
      ?? null
    const aliases = {
      canonicalAssetId: [canonicalAssetId],
      stableAssetId: stableAssetId ? [stableAssetId] : [],
      sourceId: unique([asset.sourcePlacemarkId, properties.sourcePlacemarkId]),
      onboardingId: onboardingId ? [onboardingId] : [],
      legacyId: legacyId ? [legacyId] : [],
      sourceFeatureId: sourceFeatureId ? [sourceFeatureId] : [],
      legacyNodeId: asset.id ? [asset.id] : [],
      topologyAssetId: unique([topologyObject?.assetId, topologyObject?.canonicalAssetId]),
    }
    return {
      canonicalAssetId,
      stableAssetId,
      onboardingId,
      legacyId,
      sourceFeatureId,
      sourceKmlId: asset.sourcePlacemarkId ?? null,
      identityStatus: asset.identityStatus
        ?? (stableAssetId ? 'stable' : onboardingId ? 'onboarding' : 'legacy'),
      aliasValues: unique(Object.values(aliases).flat().filter(Boolean)),
      aliases,
    }
  })
  const validation = validateIdentityItems(items, [])
  return {
    version: record.assetIdentityMap?.version ?? CANONICAL_ASSET_ID_VERSION,
    datasetVersionId: record.datasetVersion?.id ?? null,
    items,
    aliasToCanonicalAssetId: buildAliasIndex(items, validation),
    validation,
    migratedFromLegacyRecord: true,
  }
}

export function createAssetIdentityResolver(identityMap = {}) {
  const aliasToCanonical = new Map()
  const blockedAliases = new Set((identityMap.validation?.duplicateAliases ?? [])
    .map(({ alias }) => alias))
  const blockedCanonicalIds = new Set((identityMap.validation?.duplicateCanonicalIds ?? [])
    .map(({ canonicalAssetId }) => canonicalAssetId))
  const register = (alias, canonical) => {
    const value = readString(alias)
    const target = readString(canonical)
    if (!value || !target) return
    if (blockedAliases.has(value) || blockedCanonicalIds.has(target)) {
      aliasToCanonical.set(value, null)
      return
    }
    if (!aliasToCanonical.has(value)) {
      aliasToCanonical.set(value, target)
      return
    }
    if (aliasToCanonical.get(value) === null) return
    if (aliasToCanonical.get(value) !== target) aliasToCanonical.set(value, null)
  }
  Object.entries(identityMap.aliasToCanonicalAssetId ?? {}).forEach(([alias, canonical]) => {
    if (canonical === null) aliasToCanonical.set(alias, null)
    else register(alias, canonical)
  })
  ;(identityMap.items ?? []).forEach((item) => {
    const canonical = item.canonicalAssetId
    ;(item.aliasValues ?? Object.values(item.aliases ?? {}).flat())
      .forEach((alias) => register(alias, canonical))
  })
  return {
    resolve(value) {
      const normalized = readString(value)
      if (!normalized) return null
      return aliasToCanonical.get(normalized) ?? null
    },
    has(value) {
      return Boolean(this.resolve(value))
    },
    aliases: Object.fromEntries(aliasToCanonical),
  }
}

export function identityItemForValue(identityMap, value) {
  const resolved = createAssetIdentityResolver(identityMap).resolve(value)
  return (identityMap.items ?? []).find((item) => item.canonicalAssetId === resolved) ?? null
}

function validateIdentityItems(items, records) {
  const duplicateAliases = []
  const aliasOwners = new Map()
  const duplicateCanonicalIds = []
  const canonicalCounts = countValues(items.map(({ canonicalAssetId }) => canonicalAssetId))
  canonicalCounts.forEach((count, canonicalAssetId) => {
    if (count > 1) duplicateCanonicalIds.push({ canonicalAssetId, count })
  })

  items.forEach((item) => {
    item.aliasValues.forEach((alias) => {
      const existing = aliasOwners.get(alias)
      if (existing && existing.canonicalAssetId !== item.canonicalAssetId) {
        duplicateAliases.push({
          alias,
          previousCanonicalAssetId: existing.canonicalAssetId,
          canonicalAssetId: item.canonicalAssetId,
          sourceFeatureId: item.sourceFeatureId,
        })
        return
      }
      aliasOwners.set(alias, item)
    })
  })
  const missingSourceFeatureReferences = records
    .filter(({ feature }) => !feature)
    .map(({ object }) => object.sourceFeatureId)
  return {
    valid: duplicateAliases.length === 0
      && duplicateCanonicalIds.length === 0
      && missingSourceFeatureReferences.length === 0,
    duplicateAliases,
    duplicateCanonicalIds,
    missingSourceFeatureReferences,
  }
}

function buildAliasIndex(items, validation = {}) {
  const duplicateValues = new Set((validation.duplicateAliases ?? []).map(({ alias }) => alias))
  const duplicateCanonicalIds = new Set(
    (validation.duplicateCanonicalIds ?? []).map(({ canonicalAssetId }) => canonicalAssetId),
  )
  const result = {}
  items.forEach((item) => {
    item.aliasValues.forEach((alias) => {
      if (duplicateValues.has(alias) || duplicateCanonicalIds.has(item.canonicalAssetId)) {
        result[alias] = null
        return
      }
      if (result[alias] === undefined) result[alias] = item.canonicalAssetId
      else if (result[alias] !== item.canonicalAssetId) result[alias] = null
    })
  })
  return result
}

function legacyIdentityBase(feature, object) {
  const sourcePath = feature?.sourceFolderPath ?? object?.sourceFolderPath
  const sourceName = feature?.sourceName ?? object?.sourceName
  if (!sourcePath || sourcePath === '/' || !sourceName) return null
  return `src:${slugify(sourcePath)}:${slugify(sourceName)}`
}

function deterministicId(prefix, ...values) {
  const digest = createHash('sha256')
    .update(stableStringify(values))
    .digest('hex')
    .slice(0, 24)
  return `${prefix}:${digest}`
}

function stableStringify(value) {
  if (value === undefined) return '"__undefined__"'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item'
}

function countValues(values) {
  return values.reduce((result, value) => (
    result.set(value, (result.get(value) ?? 0) + 1)
  ), new Map())
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function readString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim()
}
