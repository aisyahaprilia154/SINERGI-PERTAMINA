import { createHash } from 'node:crypto'

export const CANONICAL_ASSET_ID_VERSION = 'canonical-asset-identity/1.0.0'
export const AUTOMATIC_IDENTITY_ACTOR = 'system:auto-identity'

const AUTOMATIC_IDENTITY_ROLES = new Set(['device_node', 'cable_path'])

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
  identityRegistry = [],
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
  const registryMatches = buildRegistryMatches(identityRegistry, datasetVersion)

  const items = records.map(({ object, feature }) => {
    const sourceFeatureId = object.sourceFeatureId
    const nonAsset = object.identityResolutionStatus === 'not_applicable'
    const explicitAssetId = businessAssetId(object.assetId)
    const registryMatch = nonAsset || explicitAssetId
      ? null
      : registryMatchFor({ feature, sourceFeatureId, registryMatches })
    const stableAssetId = nonAsset ? null : explicitAssetId ?? registryMatch?.assetId ?? null
    const identityResolutionStatus = nonAsset
      ? 'not_applicable'
      : explicitAssetId
      ? 'stable_explicit'
      : registryMatch?.conflict
        ? 'conflict'
        : registryMatch
        ? 'stable_registry'
        : 'onboarding_candidate'
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
      // `identityStatus` is retained for the existing topology/map contract.
      // `identityResolutionStatus` is the Fase 1 vocabulary.
      identityStatus: nonAsset ? 'not_applicable' : stableAssetId ? 'stable' : 'onboarding',
      identityResolutionStatus,
      sourceMatchType: explicitAssetId
        ? 'explicit_asset_id'
        : registryMatch?.sourceMatchType ?? null,
      sourceMatchValue: explicitAssetId
        ? explicitAssetId
        : registryMatch?.sourceMatchValue ?? null,
      registryId: registryMatch?.registryId ?? null,
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
    identityRegistry: normalizeIdentityRegistry(identityRegistry, datasetVersion),
  }
}

/**
 * Proposes internal stable IDs only when the source identity is unique and
 * deterministic inside the current version. Official IDs and ambiguous
 * mappings remain untouched for administrator review.
 */
export function hydrateIdentityRegistrySourceAliases({
  datasetVersion,
  sourceFeatures = [],
  classifiedObjects = [],
  identityRegistry = [],
  approvedAt = null,
} = {}) {
  const normalizedRegistry = normalizeIdentityRegistry(identityRegistry, datasetVersion)
  const activeRegistry = normalizedRegistry.filter(({ status }) => status === 'active')
  const featureById = new Map(
    sourceFeatures
      .filter((feature) => feature?.sourceFeatureId)
      .map((feature) => [feature.sourceFeatureId, feature]),
  )
  const objectByFeatureId = new Map(
    classifiedObjects
      .filter((object) => object?.sourceFeatureId)
      .map((object) => [object.sourceFeatureId, object]),
  )
  const matchGroups = new Map()
  sourceFeatures.forEach((feature) => {
    const match = automaticIdentityMatch(feature)
    if (!match) return
    const key = identityRegistryKey(match.sourceMatchType, match.sourceMatchValue)
    const group = matchGroups.get(key) ?? []
    group.push(feature.sourceFeatureId)
    matchGroups.set(key, group)
  })
  const activeMatchesByKey = new Map(
    activeRegistry.map((entry) => [
      identityRegistryKey(entry.sourceMatchType, entry.sourceMatchValue),
      entry,
    ]),
  )
  const addedEntries = []
  const assignments = []
  const skipped = []
  activeRegistry
    .filter(({ sourceMatchType }) => sourceMatchType === 'source_feature_id')
    .forEach((entry) => {
      const feature = featureById.get(entry.sourceMatchValue)
      const object = objectByFeatureId.get(entry.sourceMatchValue)
      if (!feature || !object || !AUTOMATIC_IDENTITY_ROLES.has(object.objectRole)) return
      const match = automaticIdentityMatch(feature)
      if (!match) return
      const key = identityRegistryKey(match.sourceMatchType, match.sourceMatchValue)
      const group = matchGroups.get(key) ?? []
      if (group.length !== 1) {
        skipped.push({
          sourceFeatureId: entry.sourceMatchValue,
          reason: 'ambiguous_source_key',
        })
        return
      }
      const objectAssetId = businessAssetId(object.stableAssetId, object.assetId)
      if (objectAssetId && objectAssetId !== entry.assetId) {
        skipped.push({
          sourceFeatureId: entry.sourceMatchValue,
          reason: 'identity_registry_alias_conflict',
        })
        return
      }
      const existing = activeMatchesByKey.get(key)
      if (existing) {
        if (existing.assetId !== entry.assetId) {
          skipped.push({
            sourceFeatureId: entry.sourceMatchValue,
            reason: 'identity_registry_alias_conflict',
          })
        }
        return
      }
      const identityHash = identityHashFor(datasetVersion, match)
      const reason = 'Identity registry source key dilengkapi otomatis dari mapping source_feature_id yang sudah stabil.'
      const evidence = {
        assignmentMode: 'automatic_identity_alias_backfill',
        sourceFeatureId: entry.sourceMatchValue,
        sourceFeatureKey: feature.sourceFeatureKey ?? null,
        sourceKmlId: feature.sourceKmlId ?? null,
        reason,
      }
      const aliasEntry = {
        ...automaticRegistryEntry({
          datasetVersion,
          assetId: entry.assetId,
          sourceMatchType: match.sourceMatchType,
          sourceMatchValue: match.sourceMatchValue,
          identityHash,
          approvedAt,
          evidence,
          suffix: 'alias',
        }),
        datasetId: entry.datasetId ?? datasetVersion?.datasetId ?? null,
        branchId: entry.branchId ?? datasetVersion?.branchId ?? null,
        validFromDatasetVersionId: entry.validFromDatasetVersionId
          ?? datasetVersion?.id
          ?? null,
        approvedBy: entry.approvedBy ?? AUTOMATIC_IDENTITY_ACTOR,
        approvedAt: entry.approvedAt ?? approvedAt ?? datasetVersion?.importedAt ?? null,
      }
      addedEntries.push(aliasEntry)
      assignments.push({
        sourceFeatureId: entry.sourceMatchValue,
        action: 'assign',
        assetId: entry.assetId,
        reason,
        evidenceRefs: [
          `identity-source:${match.sourceMatchType}:${match.sourceMatchValue}`,
          `identity-source:source_feature_id:${entry.sourceMatchValue}`,
        ],
      })
      activeMatchesByKey.set(key, aliasEntry)
    })
  return {
    identityRegistry: [...normalizedRegistry, ...addedEntries],
    addedEntries,
    assignments,
    skipped,
  }
}

export function createAutomaticIdentityRegistry({
  datasetVersion,
  sourceFeatures = [],
  classifiedObjects = [],
  identityRegistry = [],
  approvedAt = null,
} = {}) {
  const hydrated = hydrateIdentityRegistrySourceAliases({
    datasetVersion,
    sourceFeatures,
    classifiedObjects,
    identityRegistry,
    approvedAt,
  })
  const normalizedRegistry = hydrated.identityRegistry
  const activeRegistry = normalizedRegistry.filter(({ status }) => status === 'active')
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
  const matchGroups = new Map()
  records.forEach(({ feature, object }) => {
    const match = automaticIdentityMatch(feature, object)
    if (!match) return
    const key = identityRegistryKey(match.sourceMatchType, match.sourceMatchValue)
    const group = matchGroups.get(key) ?? []
    group.push({ feature, object, match })
    matchGroups.set(key, group)
  })

  const activeMatchesByKey = new Map()
  activeRegistry.forEach((entry) => {
    activeMatchesByKey.set(
      identityRegistryKey(entry.sourceMatchType, entry.sourceMatchValue),
      entry,
    )
  })
  const usedAssetIds = new Set([
    ...activeRegistry.map(({ assetId }) => assetId),
    ...records.map(({ object }) => businessAssetId(object.stableAssetId, object.assetId)).filter(Boolean),
  ])
  const generatedEntries = []
  const assignments = []
  const linkedEntries = []
  const linkedAssignments = []
  const backfilledEntries = hydrated.addedEntries
  const backfillAssignments = hydrated.assignments
  const skipped = [...hydrated.skipped]
  records.forEach(({ feature, object }) => {
    if (!AUTOMATIC_IDENTITY_ROLES.has(object.objectRole)
      || object.sourceStatus === 'retired'
      || object.identityResolutionStatus === 'not_applicable'
      || businessAssetId(object.stableAssetId, object.assetId)
      || ['stable', 'stable_explicit', 'stable_registry'].includes(
        String(object.identityStatus ?? object.identityResolutionStatus ?? '').toLowerCase(),
      )) {
      return
    }
    if (object.identityResolutionStatus === 'conflict') {
      skipped.push({ sourceFeatureId: object.sourceFeatureId, reason: 'identity_conflict' })
      return
    }
    const match = automaticIdentityMatch(feature, object)
    if (!match) {
      skipped.push({ sourceFeatureId: object.sourceFeatureId, reason: 'stable_source_key_missing' })
      return
    }
    const key = identityRegistryKey(match.sourceMatchType, match.sourceMatchValue)
    const existing = activeMatchesByKey.get(key)
    if (existing) {
      const featureKey = identityRegistryKey('source_feature_id', object.sourceFeatureId)
      const existingFeatureMatch = activeMatchesByKey.get(featureKey)
      if (!existingFeatureMatch) {
        const identityHash = identityHashFor(datasetVersion, match)
        const reason = 'Source feature otomatis ditautkan ke identity internal yang sudah terdaftar.'
        const evidence = {
          assignmentMode: 'automatic_registry_match',
          sourceFeatureId: object.sourceFeatureId,
          sourceFeatureKey: feature?.sourceFeatureKey ?? null,
          sourceKmlId: feature?.sourceKmlId ?? null,
          reason,
        }
        const linkedEntry = automaticRegistryEntry({
          datasetVersion,
          assetId: existing.assetId,
          sourceMatchType: 'source_feature_id',
          sourceMatchValue: object.sourceFeatureId,
          identityHash,
          approvedAt,
          evidence,
          suffix: 'feature',
        })
        linkedEntries.push(linkedEntry)
        linkedAssignments.push({
          sourceFeatureId: object.sourceFeatureId,
          action: 'assign',
          assetId: existing.assetId,
          reason,
          evidenceRefs: [
            `identity-source:${match.sourceMatchType}:${match.sourceMatchValue}`,
          ],
        })
        activeMatchesByKey.set(featureKey, linkedEntry)
      } else if (existingFeatureMatch.assetId !== existing.assetId) {
        skipped.push({
          sourceFeatureId: object.sourceFeatureId,
          reason: 'identity_registry_alias_conflict',
        })
      }
      return
    }
    const group = matchGroups.get(key) ?? []
    if (group.length !== 1) {
      skipped.push({ sourceFeatureId: object.sourceFeatureId, reason: 'ambiguous_source_key' })
      return
    }
    const assetId = automaticAssetId(datasetVersion, match)
    if (usedAssetIds.has(assetId)) {
      skipped.push({ sourceFeatureId: object.sourceFeatureId, reason: 'generated_asset_id_conflict' })
      return
    }
    const identityHash = identityHashFor(datasetVersion, match)
    const reason = 'Identity internal dibuat otomatis karena source identity unik dan tidak konflik.'
    const evidence = {
      assignmentMode: 'automatic_unique_onboarding',
      sourceFeatureId: object.sourceFeatureId,
      sourceFeatureKey: feature?.sourceFeatureKey ?? null,
      sourceKmlId: feature?.sourceKmlId ?? null,
      reason,
    }
    generatedEntries.push(
      automaticRegistryEntry({
        datasetVersion,
        assetId,
        sourceMatchType: match.sourceMatchType,
        sourceMatchValue: match.sourceMatchValue,
        identityHash,
        approvedAt,
        evidence,
      }),
      automaticRegistryEntry({
        datasetVersion,
        assetId,
        sourceMatchType: 'source_feature_id',
        sourceMatchValue: object.sourceFeatureId,
        identityHash,
        approvedAt,
        evidence,
        suffix: 'feature',
      }),
    )
    activeMatchesByKey.set(key, generatedEntries.at(-2))
    assignments.push({
      sourceFeatureId: object.sourceFeatureId,
      action: 'assign',
      assetId,
      reason,
      evidenceRefs: [
        `identity-source:${match.sourceMatchType}:${match.sourceMatchValue}`,
      ],
    })
    usedAssetIds.add(assetId)
  })

  return {
    identityRegistry: [...normalizedRegistry, ...linkedEntries, ...generatedEntries],
    generatedEntries,
    assignments,
    linkedEntries,
    linkedAssignments,
    backfilledEntries,
    backfillAssignments,
    skipped,
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
      identityResolutionStatus: asset.identityResolutionStatus
        ?? (stableAssetId ? 'stable_explicit' : 'onboarding_candidate'),
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

function businessAssetId(...values) {
  return values
    .map((value) => readString(value))
    .find((value) => value && !isOnboardingIdentity(value)) ?? null
}

function isOnboardingIdentity(value) {
  return String(value ?? '').startsWith('onboarding-identity:')
}

function buildRegistryMatches(identityRegistry, datasetVersion) {
  return normalizeIdentityRegistry(identityRegistry, datasetVersion)
    .filter((entry) => entry.status === 'active')
}

function registryMatchFor({ feature, sourceFeatureId, registryMatches }) {
  const matches = registryMatches.filter((entry) => (
    entry.sourceMatchType === 'source_kml_id'
      ? entry.sourceMatchValue && entry.sourceMatchValue === feature?.sourceKmlId
      : entry.sourceMatchType === 'source_feature_id'
        ? entry.sourceMatchValue === sourceFeatureId
      : entry.sourceMatchType === 'source_feature_key'
          ? entry.sourceMatchValue === (
            feature?.sourceIdentityKey ?? feature?.sourceFeatureKey
          )
          : false
  ))
  if (!matches.length) return null
  const uniqueAssetIds = [...new Set(matches.map(({ assetId }) => assetId))]
  if (uniqueAssetIds.length !== 1) {
    return {
      ...matches[0],
      assetId: null,
      conflict: true,
    }
  }
  return matches[0]
}

function automaticIdentityMatch(feature) {
  const sourceKmlId = readString(feature?.sourceKmlId)
  if (sourceKmlId) {
    return {
      sourceMatchType: 'source_kml_id',
      sourceMatchValue: sourceKmlId,
    }
  }
  const sourceIdentityKey = stableSourceIdentityKeyFor(feature)
  if (sourceIdentityKey) {
    return {
      sourceMatchType: 'source_feature_key',
      sourceMatchValue: sourceIdentityKey,
    }
  }
  // Geometry/source fingerprints are evidence only. They can change when a
  // source file is edited and must never become an automatic stable identity.
  return null
}

function stableSourceIdentityKeyFor(feature) {
  const explicit = readString(feature?.sourceIdentityKey)
  if (explicit) return explicit
  const sourceName = readString(feature?.sourceName)
  if (!sourceName) return null
  return [
    String(feature?.sourceFolderPath ?? '/').trim().toLowerCase(),
    sourceName.toLowerCase(),
    String(feature?.sourceElementType ?? 'Placemark').trim().toLowerCase(),
  ].join('|')
}

function identityHashFor(datasetVersion, match) {
  return createHash('sha256')
    .update(stableStringify([
      datasetVersion?.datasetId ?? null,
      datasetVersion?.branchId ?? null,
      match.sourceMatchType,
      match.sourceMatchValue,
    ]))
    .digest('hex')
    .slice(0, 24)
}

function automaticAssetId(datasetVersion, match) {
  return `AUTO-${identityHashFor(datasetVersion, match).toUpperCase()}`
}

function automaticRegistryEntry({
  datasetVersion,
  assetId,
  sourceMatchType,
  sourceMatchValue,
  identityHash,
  approvedAt,
  evidence,
  suffix = 'source',
}) {
  return {
    registryId: `identity-registry:auto:${identityHash}:${suffix}`,
    datasetId: datasetVersion?.datasetId ?? null,
    branchId: datasetVersion?.branchId ?? null,
    assetId,
    sourceMatchType,
    sourceMatchValue,
    validFromDatasetVersionId: datasetVersion?.id ?? null,
    validToDatasetVersionId: null,
    status: 'active',
    approvedBy: AUTOMATIC_IDENTITY_ACTOR,
    approvedAt: approvedAt ?? datasetVersion?.importedAt ?? null,
    evidence,
    auditEventId: `identity-auto:${identityHash}`,
  }
}

function identityRegistryKey(type, value) {
  return `${type ?? ''}:${value ?? ''}`
}

function normalizeIdentityRegistry(entries, datasetVersion = {}) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      registryId: entry.registryId ?? entry.id ?? null,
      datasetId: entry.datasetId ?? datasetVersion.datasetId ?? null,
      branchId: entry.branchId ?? datasetVersion.branchId ?? null,
      assetId: readString(entry.assetId),
      sourceMatchType: entry.sourceMatchType ?? entry.matchType ?? null,
      sourceMatchValue: readString(entry.sourceMatchValue ?? entry.matchValue),
      validFromDatasetVersionId: entry.validFromDatasetVersionId
        ?? datasetVersion.id
        ?? null,
      validToDatasetVersionId: entry.validToDatasetVersionId ?? null,
      status: entry.status ?? 'active',
      approvedBy: entry.approvedBy ?? null,
      approvedAt: entry.approvedAt ?? null,
      evidence: structuredClone(entry.evidence ?? {}),
      auditEventId: entry.auditEventId ?? null,
    }))
    .filter((entry) => entry.assetId && entry.sourceMatchType && entry.sourceMatchValue)
}
