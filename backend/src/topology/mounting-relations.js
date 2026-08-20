import { createHash } from 'node:crypto'

export const MOUNTING_RELATION_TYPE = 'mounted_on'
// Keep the mounting edge compatible with the topology engine's existing
// installation graph contract. It is still stored separately from the
// traversable service/network graph.
export const MOUNTING_RELATION_KIND = 'installation_attachment'

export const DEFAULT_MOUNTING_CONFIG = Object.freeze({
  // KMZ points for a pole, camera, and junction box are commonly drawn a few
  // metres apart even though they describe one physical installation.
  mountingSearchRadiusMeters: 5,
  // A matching asset number is stronger evidence than coordinates alone, but
  // remains bounded so similarly named assets in another location are ignored.
  mountingIdentityRadiusMeters: 10,
  mountingOptionRadiusMeters: 25,
  mountingAmbiguityDeltaMeters: 0.35,
  // A small absolute delta is not enough when both coordinates are several
  // metres away from their real-world position. The ratio catches those
  // cases without making the automatic radius itself wider.
  mountingAmbiguityRatio: 1.5,
})

/**
 * Builds the physical installation relation independently from the
 * operational network graph. A pole can group assets visually without
 * becoming a traversable network device.
 */
export function generateMountingArtifacts(topologyInputBundle, {
  config = {},
  previousRelations = [],
  previousOverrides = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const bundle = topologyInputBundle ?? {}
  const settings = normalizeConfig(config)
  const nodes = prepareNodes(bundle)
  const poles = nodes.filter(isPoleNode)
  const mountableNodes = nodes.filter((node) => isMountableNode(node) && !isPoleNode(node))
  const resolver = createNodeResolver(nodes)
  const overrides = normalizeOverrides({
    previousOverrides,
    previousRelations,
    resolver,
  })
  const relations = []
  const candidates = []
  const options = []

  mountableNodes.forEach((asset) => {
    const nearbyOptions = poles
      .filter((pole) => sameFacilityScope(asset, pole, bundle))
      .map((pole) => ({
        pole,
        distanceMeters: geographicDistanceMeters(asset.coordinate, pole.coordinate),
      }))
      .filter(({ distanceMeters }) => distanceMeters <= settings.mountingOptionRadiusMeters)
      .sort((left, right) => (
        left.distanceMeters - right.distanceMeters
        || left.pole.id.localeCompare(right.pole.id)
      ))
    nearbyOptions.forEach(({ pole, distanceMeters }) => {
      options.push(createMountingOption({
        bundle,
        asset,
        pole,
        distanceMeters,
        generatedAt,
      }))
    })
    const nearby = nearbyOptions.filter(({ distanceMeters }) => (
      distanceMeters <= settings.mountingSearchRadiusMeters
    ))
    const matchingIdentityOptions = nearbyOptions.filter(({ pole, distanceMeters }) => (
      distanceMeters <= settings.mountingIdentityRadiusMeters
        && hasMatchingMountingIdentity(asset, pole)
    ))

    const override = overrides.byAsset.get(asset.id)
    if (override) {
      const pole = override.targetAssetId
        ? resolver.resolve(override.targetAssetId)
        : null
      if (pole && isPoleNode(pole) && sameFacilityScope(asset, pole, bundle)) {
        const distanceMeters = geographicDistanceMeters(asset.coordinate, pole.coordinate)
        if (!options.some((option) => option.assetId === asset.id
          && option.targetAssetId === pole.id)) {
          options.push(createMountingOption({
            bundle,
            asset,
            pole,
            distanceMeters,
            generatedAt,
          }))
        }
        relations.push(createMountingRelation({
          bundle,
          asset,
          pole,
          distanceMeters,
          provenance: 'manual_admin',
          verifiedBy: override.actorId ?? null,
          verifiedAt: override.updatedAt ?? generatedAt,
          auditEventId: override.auditEventId ?? null,
          reason: override.reason ?? null,
          generatedAt,
        }))
      }
      return
    }

    const identityMatch = matchingIdentityOptions.length === 1
      ? matchingIdentityOptions[0]
      : null
    // The number match may bridge a small KMZ coordinate offset. It must not
    // overrule a different pole that is already inside the normal search
    // radius, unless the matching pole is inside that radius as well.
    if (identityMatch && (
      identityMatch.distanceMeters <= settings.mountingSearchRadiusMeters
        || nearby.length === 0
    )) {
      relations.push(createMountingRelation({
        bundle,
        asset,
        pole: identityMatch.pole,
        distanceMeters: identityMatch.distanceMeters,
        provenance: 'spatial_inference',
        inferenceRule: 'matching_asset_number',
        verifiedBy: 'mounting-identity-spatial-policy',
        verifiedAt: generatedAt,
        generatedAt,
      }))
      return
    }

    if (!nearby.length) return
    const nearestDistanceMeters = nearby[0].distanceMeters
    const secondDistanceMeters = nearby[1]?.distanceMeters ?? null
    const distanceMarginMeters = secondDistanceMeters === null
      ? Number.POSITIVE_INFINITY
      : secondDistanceMeters - nearestDistanceMeters
    const distanceRatio = secondDistanceMeters === null || nearestDistanceMeters <= 0
      ? Number.POSITIVE_INFINITY
      : secondDistanceMeters / nearestDistanceMeters
    const ambiguous = nearby.length > 1 && (
      distanceMarginMeters <= settings.mountingAmbiguityDeltaMeters
        || distanceRatio <= settings.mountingAmbiguityRatio
    )
    if (ambiguous) {
      nearby.forEach(({ pole, distanceMeters }) => {
        candidates.push(createMountingCandidate({
          bundle,
          asset,
          pole,
          distanceMeters,
          reason: 'multiple_poles_within_ambiguity_delta',
          generatedAt,
        }))
      })
      return
    }

    const nearest = nearby[0]
    relations.push(createMountingRelation({
      bundle,
      asset,
      pole: nearest.pole,
      distanceMeters: nearest.distanceMeters,
      provenance: 'spatial_inference',
      verifiedBy: 'mounting-spatial-policy',
      verifiedAt: generatedAt,
      generatedAt,
    }))
  })

  return {
    relations: deduplicateRelations(relations),
    candidates: candidates.sort(compareMountingCandidates),
    options: options.sort(compareMountingOptions),
    overrides: overrides.items,
    summary: {
      relationCount: relations.length,
      automaticRelationCount: relations.filter(({ provenance }) => provenance === 'spatial_inference').length,
      manualRelationCount: relations.filter(({ provenance }) => provenance === 'manual_admin').length,
      candidateCount: candidates.length,
      optionCount: options.length,
      ambiguousAssetCount: new Set(candidates.map(({ assetId }) => assetId)).size,
      poleCount: poles.length,
      mountableAssetCount: mountableNodes.length,
      searchRadiusMeters: settings.mountingSearchRadiusMeters,
      identityRadiusMeters: settings.mountingIdentityRadiusMeters,
      optionRadiusMeters: settings.mountingOptionRadiusMeters,
      ambiguityDeltaMeters: settings.mountingAmbiguityDeltaMeters,
      ambiguityRatio: settings.mountingAmbiguityRatio,
    },
  }
}

export function isPoleNode(node) {
  return /\b(tiang|pole|pylon)\b/.test(nodeSemanticText(node))
}

export function isMountableNode(node) {
  const text = nodeSemanticText(node)
  return /junction|\bjb\b|cctv|camera|kamera/.test(text)
}

export function normalizeMountingRelations(relations = [], resolver = null) {
  return asArray(relations).flatMap((relation) => {
    if (relation?.relationType && relation.relationType !== MOUNTING_RELATION_TYPE) return []
    const source = resolvedReferenceId(resolver, relation?.sourceAssetId)
    const target = resolvedReferenceId(resolver, relation?.targetAssetId)
    if (!source || !target || source === target) return []
    return [{
      ...structuredClone(relation),
      relationType: MOUNTING_RELATION_TYPE,
      relationKind: MOUNTING_RELATION_KIND,
      sourceAssetId: source,
      targetAssetId: target,
      verificationStatus: relation.verificationStatus ?? 'confirmed',
    }]
  })
}

export function normalizeMountingOptions(options = [], resolver = null) {
  return asArray(options).flatMap((option) => {
    const assetId = resolvedReferenceId(resolver, option?.assetId)
    const targetAssetId = resolvedReferenceId(resolver, option?.targetAssetId)
    if (!assetId || !targetAssetId || assetId === targetAssetId) return []
    return [{
      ...structuredClone(option),
      optionType: 'mounting_option',
      relationType: MOUNTING_RELATION_TYPE,
      relationKind: MOUNTING_RELATION_KIND,
      assetId,
      targetAssetId,
    }]
  })
}

function prepareNodes(bundle) {
  const geometryById = new Map(asArray(bundle.geometries).map((geometry) => [
    geometry.geometryId,
    geometry,
  ]))
  return asArray(bundle.classifiedNodes).flatMap((object) => {
    const point = asArray(object.geometryIds)
      .map((geometryId) => geometryById.get(geometryId))
      .find((geometry) => (
        geometry?.valid === true
        && geometry.geometryType === 'Point'
        && validCoordinate(geometry.coordinates)
      ))
    const id = objectIdentity(object)
    if (!point || !id) return []
    return [{
      ...structuredClone(object),
      id,
      branchId: object.branchId ?? bundle.datasetVersion?.branchId ?? bundle.site ?? null,
      locationGroupKey: object.locationGroupKey
        ?? facilityScopeKey(object.sourceFolderPath)
        ?? null,
      coordinate: cloneCoordinate(point.coordinates),
    }]
  }).sort((left, right) => left.id.localeCompare(right.id))
}

function normalizeOverrides({ previousOverrides, previousRelations, resolver }) {
  const raw = [
    ...asArray(previousOverrides),
    ...asArray(previousRelations)
      .filter((relation) => (
        relation?.relationType === MOUNTING_RELATION_TYPE
          && relation?.provenance === 'manual_admin'
      ))
      .map((relation) => ({
        ...relation,
        assetId: relation.sourceAssetId,
        targetAssetId: relation.targetAssetId,
      })),
  ]
  const byAsset = new Map()
  const items = []
  raw.forEach((value) => {
    const assetId = resolvedReferenceId(
      resolver,
      value.assetId ?? value.sourceAssetId,
    )
    if (!assetId || byAsset.has(assetId)) return
    const targetReference = value.targetAssetId ?? value.poleAssetId ?? null
    const target = targetReference
      ? resolvedReferenceId(resolver, targetReference)
      : null
    const item = {
      assetId,
      targetAssetId: target ?? targetReference,
      action: targetReference ? 'assign' : 'detach',
      provenance: 'manual_admin',
      actorId: value.actorId ?? value.verifiedBy ?? value.manualConfirmation?.actorId ?? null,
      updatedAt: value.updatedAt
        ?? value.verifiedAt
        ?? value.manualConfirmation?.reviewedAt
        ?? null,
      reason: value.reason ?? value.manualConfirmation?.reason ?? null,
      auditEventId: value.auditEventId ?? value.manualConfirmation?.auditEventId ?? null,
    }
    byAsset.set(assetId, item)
    items.push(item)
  })
  return {
    byAsset,
    items: items.sort((left, right) => left.assetId.localeCompare(right.assetId)),
  }
}

function createMountingRelation({
  bundle,
  asset,
  pole,
  distanceMeters,
  provenance,
  inferenceRule = 'unique_nearest_pole',
  verifiedBy,
  verifiedAt,
  auditEventId = null,
  reason = null,
  generatedAt,
}) {
  return {
    relationId: deterministicId(
      'mounting-relation',
      bundle.datasetVersion?.id,
      asset.id,
      pole.id,
    ),
    datasetVersionId: bundle.datasetVersion?.id ?? null,
    siteId: asset.siteId ?? bundle.site ?? null,
    sourceAssetId: asset.id,
    targetAssetId: pole.id,
    relationType: MOUNTING_RELATION_TYPE,
    relationKind: MOUNTING_RELATION_KIND,
    direction: 'source_to_target',
    distanceMeters: round(distanceMeters),
    provenance,
    verificationStatus: 'confirmed',
    verifiedBy,
    verifiedAt,
    auditEventId,
    ...(reason ? { reason } : {}),
    evidence: [{
      source: provenance === 'manual_admin'
        ? 'manual_review'
        : inferenceRule === 'matching_asset_number'
          ? 'source_label_and_spatial'
          : 'spatial',
      ruleId: provenance === 'manual_admin'
        ? 'mounting.manual_override'
        : inferenceRule === 'matching_asset_number'
          ? 'mounting.matching-asset-number'
          : 'mounting.unique-nearest-pole',
      observedValue: round(distanceMeters),
      normalizedValue: `${round(distanceMeters)}m`,
      explanation: provenance === 'manual_admin'
        ? 'Penempatan aset pada tiang ditetapkan administrator.'
        : inferenceRule === 'matching_asset_number'
          ? 'Nomor aset dan tiang sama, berada dalam area fasilitas yang sama, dan tidak ada tiang lain dalam radius pemasangan normal.'
          : 'Aset memiliki satu tiang terdekat yang unik dalam area fasilitas dan radius pemasangan.',
    }],
    generatedAt,
  }
}

function createMountingCandidate({ bundle, asset, pole, distanceMeters, reason, generatedAt }) {
  return {
    candidateId: deterministicId(
      'mounting-candidate',
      bundle.datasetVersion?.id,
      asset.id,
      pole.id,
    ),
    datasetVersionId: bundle.datasetVersion?.id ?? null,
    siteId: asset.siteId ?? bundle.site ?? null,
    assetId: asset.id,
    targetAssetId: pole.id,
    candidateType: MOUNTING_RELATION_TYPE,
    relationType: MOUNTING_RELATION_TYPE,
    relationKind: MOUNTING_RELATION_KIND,
    candidateStatus: 'ambiguous',
    proposalStatus: 'ambiguous',
    distanceMeters: round(distanceMeters),
    sourceCoordinate: cloneCoordinate(asset.coordinate),
    targetCoordinate: cloneCoordinate(pole.coordinate),
    reason,
    generatedAt,
    evidence: [{
      source: 'spatial',
      ruleId: 'mounting.ambiguous-nearest-pole',
      observedValue: round(distanceMeters),
      normalizedValue: `${round(distanceMeters)}m`,
      explanation: 'Lebih dari satu tiang berada pada jarak yang terlalu berdekatan untuk ditebak otomatis.',
    }],
  }
}

function createMountingOption({ bundle, asset, pole, distanceMeters, generatedAt }) {
  return {
    optionId: deterministicId(
      'mounting-option',
      bundle.datasetVersion?.id,
      asset.id,
      pole.id,
    ),
    datasetVersionId: bundle.datasetVersion?.id ?? null,
    siteId: asset.siteId ?? bundle.site ?? null,
    assetId: asset.id,
    targetAssetId: pole.id,
    optionType: 'mounting_option',
    relationType: MOUNTING_RELATION_TYPE,
    relationKind: MOUNTING_RELATION_KIND,
    optionStatus: 'available',
    distanceMeters: round(distanceMeters),
    sourceCoordinate: cloneCoordinate(asset.coordinate),
    targetCoordinate: cloneCoordinate(pole.coordinate),
    generatedAt,
  }
}

function createNodeResolver(nodes) {
  const aliases = new Map()
  nodes.forEach((node) => {
    [
      node.id,
      node.canonicalAssetId,
      node.assetId,
      node.stableAssetId,
      node.legacyAssetId,
      node.onboardingIdentity,
      node.sourceFeatureId,
      ...Object.values(node.identityAliases ?? {}).flat(),
    ].filter(Boolean).forEach((alias) => {
      if (!aliases.has(String(alias))) aliases.set(String(alias), node)
    })
  })
  return {
    resolve(value) {
      return aliases.get(String(value ?? '')) ?? null
    },
  }
}

function resolvedReferenceId(resolver, value) {
  if (!value) return null
  const resolved = resolver?.resolve(value)
  if (typeof resolved === 'object' && resolved !== null) return resolved.id ?? null
  return resolved ?? value
}

export function sameFacilityScope(left, right, bundle = {}) {
  const leftBranch = normalizedScopeValue(left.branchId ?? bundle.datasetVersion?.branchId ?? bundle.site)
  const rightBranch = normalizedScopeValue(right.branchId ?? bundle.datasetVersion?.branchId ?? bundle.site)
  if (leftBranch && rightBranch && leftBranch !== rightBranch) return false

  const leftSite = normalizedScopeValue(left.siteId ?? bundle.site)
  const rightSite = normalizedScopeValue(right.siteId ?? bundle.site)
  if (leftSite && rightSite && leftSite !== rightSite) return false

  const leftLocation = normalizedScopeValue(left.locationGroupKey)
    ?? facilityScopeKey(left.sourceFolderPath)
  const rightLocation = normalizedScopeValue(right.locationGroupKey)
    ?? facilityScopeKey(right.sourceFolderPath)
  if (leftLocation || rightLocation) return leftLocation === rightLocation
  return true
}

function facilityScopeKey(value) {
  const segments = String(value ?? '')
    .replaceAll('\\', '/')
    .split('/')
    .map(normalizeText)
    .filter(Boolean)
  if (!segments.length) return null
  const rootIndex = segments.findIndex((segment) => segment === 'rjbt')
  if (rootIndex >= 0 && segments[rootIndex + 1]) return segments[rootIndex + 1]
  const layerMarkers = [
    'cable', 'kabel', 'cctv', 'camera', 'junction', 'junction box',
    'tiang', 'pole', 'server', 'switch', 'router', 'lan', 'fiber optic',
  ]
  const layerIndex = segments.findIndex((segment) => layerMarkers.some((marker) => (
    segment === marker || segment.includes(marker)
  )))
  const prefix = segments.slice(0, layerIndex >= 0 ? layerIndex : segments.length)
  return prefix.length ? prefix.join('/') : null
}

function normalizedScopeValue(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function nodeSemanticText(node) {
  return normalizeText([
    node?.canonicalAssetType,
    node?.canonicalCategory,
    node?.assetType,
    node?.category,
    node?.sourceName,
  ].filter(Boolean).join(' '))
}

function hasMatchingMountingIdentity(asset, pole) {
  const assetNumber = mountingAssetNumber(asset, 'asset')
  const poleNumber = mountingAssetNumber(pole, 'pole')
  return Boolean(assetNumber && poleNumber && assetNumber === poleNumber)
}

function mountingAssetNumber(node, role) {
  const name = normalizeText(node?.sourceName ?? node?.name)
  if (!name) return null
  const pattern = role === 'pole'
    ? /^(?:t|tiang|pole)\s*0*(\d+)\b/
    : /^(?:c|cctv|camera|kamera|jb|junction box)\s*0*(\d+)\b/
  const match = name.match(pattern)
  return match ? String(Number(match[1])) : null
}

function objectIdentity(object) {
  return String(
    object?.canonicalAssetId
      ?? object?.assetId
      ?? object?.stableAssetId
      ?? object?.onboardingIdentity
      ?? object?.sourceFeatureId
      ?? '',
  ).trim()
}

function geographicDistanceMeters(left, right) {
  const latitude1 = Number(left[1]) * Math.PI / 180
  const latitude2 = Number(right[1]) * Math.PI / 180
  const deltaLatitude = (Number(right[1]) - Number(left[1])) * Math.PI / 180
  const deltaLongitude = (Number(right[0]) - Number(left[0])) * Math.PI / 180
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
}

function deduplicateRelations(relations) {
  const seen = new Map()
  relations.forEach((relation) => {
    const key = `${relation.sourceAssetId}|${relation.targetAssetId}`
    const previous = seen.get(key)
    if (!previous || previous.provenance !== 'manual_admin') seen.set(key, relation)
  })
  return [...seen.values()].sort((left, right) => left.relationId.localeCompare(right.relationId))
}

function compareMountingCandidates(left, right) {
  return left.assetId.localeCompare(right.assetId)
    || left.distanceMeters - right.distanceMeters
    || left.targetAssetId.localeCompare(right.targetAssetId)
}

function compareMountingOptions(left, right) {
  return left.assetId.localeCompare(right.assetId)
    || left.distanceMeters - right.distanceMeters
    || left.targetAssetId.localeCompare(right.targetAssetId)
}

function normalizeConfig(config) {
  return {
    mountingSearchRadiusMeters: positiveNumber(
      config.mountingSearchRadiusMeters,
      DEFAULT_MOUNTING_CONFIG.mountingSearchRadiusMeters,
    ),
    mountingIdentityRadiusMeters: positiveNumber(
      config.mountingIdentityRadiusMeters,
      DEFAULT_MOUNTING_CONFIG.mountingIdentityRadiusMeters,
    ),
    mountingAmbiguityDeltaMeters: nonNegativeNumber(
      config.mountingAmbiguityDeltaMeters,
      DEFAULT_MOUNTING_CONFIG.mountingAmbiguityDeltaMeters,
    ),
    mountingAmbiguityRatio: positiveNumber(
      config.mountingAmbiguityRatio,
      DEFAULT_MOUNTING_CONFIG.mountingAmbiguityRatio,
    ),
    mountingOptionRadiusMeters: positiveNumber(
      config.mountingOptionRadiusMeters,
      DEFAULT_MOUNTING_CONFIG.mountingOptionRadiusMeters,
    ),
  }
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function validCoordinate(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
    && Number(value[0]) >= -180
    && Number(value[0]) <= 180
    && Number(value[1]) >= -90
    && Number(value[1]) <= 90
}

function cloneCoordinate(value) {
  return [Number(value[0]), Number(value[1])]
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000
}

function deterministicId(prefix, ...parts) {
  return `${prefix}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}
