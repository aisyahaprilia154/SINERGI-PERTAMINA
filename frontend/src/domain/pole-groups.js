export const MOUNTING_RELATION_TYPE = 'mounted_on'
export const DEFAULT_PHYSICAL_MOUNTING_RADIUS_METERS = 15
export const DEFAULT_PHYSICAL_MOUNTING_AMBIGUITY_DELTA_METERS = 0.35
export const DEFAULT_PHYSICAL_MOUNTING_AMBIGUITY_RATIO = 1.5

/**
 * Builds a reference index for the identifiers that can occur in a map
 * payload or in the asset-detail response. The map uses canonical IDs while
 * the detail endpoint may return a source, legacy, or stable alias.
 */
export function createAssetReferenceIndex(assets = []) {
  const index = new Map()
  const conflicts = new Set()
  const register = (reference, assetId) => {
    if (!reference || !assetId || conflicts.has(reference)) return
    if (!index.has(reference)) {
      index.set(reference, assetId)
      return
    }
    if (index.get(reference) !== assetId) {
      index.delete(reference)
      conflicts.add(reference)
    }
  }

  assets.forEach((asset) => {
    const assetId = asset?.id ?? asset?.canonicalAssetId ?? asset?.assetId
    if (!assetId) return
    [
      assetId,
      asset.canonicalAssetId,
      asset.assetId,
      asset.stableAssetId,
      asset.onboardingIdentity,
      asset.legacyAssetId,
      asset.sourceNodeId,
      asset.sourceFeatureId,
      ...Object.values(asset.identityAliases ?? {}).flat(),
    ].forEach((reference) => register(reference, assetId))
  })

  return index
}

export function normalizeMountingRelations(relations = [], assetReferenceIndex = null) {
  const resolve = (reference) => assetReferenceIndex?.get(reference) ?? reference ?? null
  return (Array.isArray(relations) ? relations : []).flatMap((relation) => {
    if (relation?.relationType && relation.relationType !== MOUNTING_RELATION_TYPE) return []
    const sourceAssetId = resolve(relation?.sourceAssetId)
    const targetAssetId = resolve(relation?.targetAssetId)
    if (!sourceAssetId || !targetAssetId || sourceAssetId === targetAssetId) return []
    return [{
      ...structuredClone(relation),
      relationType: MOUNTING_RELATION_TYPE,
      relationKind: relation.relationKind ?? 'installation_attachment',
      sourceAssetId,
      targetAssetId,
      verificationStatus: relation.verificationStatus ?? 'confirmed',
    }]
  })
}

/**
 * Keeps the physical presentation aligned with the DPPU YIA asset map when
 * the active payload omits the known BC-042/T-016 mounting record. This is a
 * scoped presentation correction only; it does not add a logical network edge.
 */
export function ensureDppuYiaKnownMountingRelations(relations = [], assets = []) {
  const dppuAssets = assets.filter((asset) => (
    String(asset?.locationGroupKey ?? asset?.areaKey ?? '').toLowerCase() === 'dppu-yia'
  ))
  const camera = dppuAssets.find((asset) => String(asset?.name ?? '').trim().toUpperCase() === 'BC-042')
  const pole = dppuAssets.find((asset) => String(asset?.name ?? '').trim().toUpperCase() === 'T-016')
  if (!camera || !pole) return relations
  const alreadyPresent = relations.some((relation) => (
    relation?.sourceAssetId === camera.id && relation?.targetAssetId === pole.id
  ))
  if (alreadyPresent) return relations
  return [
    ...relations,
    {
      relationId: `presentation-mounting:dppu-yia:${camera.id}->${pole.id}`,
      sourceAssetId: camera.id,
      targetAssetId: pole.id,
      relationType: MOUNTING_RELATION_TYPE,
      relationKind: 'installation_attachment',
      direction: 'source_to_target',
      provenance: 'facility_topology_correction',
      inferenceRule: 'dppu_yia_bc042_t016',
      verificationStatus: 'confirmed',
      verifiedBy: 'dppu-yia-presentation-policy',
    },
  ]
}

export function mountingRelationsFromAssetProjection(asset, assetReferenceIndex = null) {
  const assetId = asset?.id ?? asset?.canonicalAssetId ?? asset?.assetId
  if (!assetId) return []
  const mountedAssetIds = Array.isArray(asset.mountedAssetIds)
    ? asset.mountedAssetIds
    : []
  const projectedRelations = mountedAssetIds.map((mountedAssetId) => ({
    relationType: MOUNTING_RELATION_TYPE,
    sourceAssetId: mountedAssetId,
    targetAssetId: assetId,
    verificationStatus: 'confirmed',
  }))
  if (asset.mountedOnAssetId) {
    projectedRelations.push({
      relationType: MOUNTING_RELATION_TYPE,
      sourceAssetId: assetId,
      targetAssetId: asset.mountedOnAssetId,
      verificationStatus: 'confirmed',
    })
  }
  return normalizeMountingRelations(projectedRelations, assetReferenceIndex)
}

/**
 * Recovers physical mounting relations that were lost when the source KMZ
 * placed a pole, JB, and camera a few metres apart. This is intentionally a
 * physical-only projection: these relations never become network edges.
 * Existing relations and manual overrides always win over spatial inference.
 */
export function inferSpatialMountingRelations({
  assets = [],
  mountingRelations = [],
  mountingOverrides = [],
  radiusMeters = DEFAULT_PHYSICAL_MOUNTING_RADIUS_METERS,
  ambiguityDeltaMeters = DEFAULT_PHYSICAL_MOUNTING_AMBIGUITY_DELTA_METERS,
  ambiguityRatio = DEFAULT_PHYSICAL_MOUNTING_AMBIGUITY_RATIO,
  assetReferenceIndex = null,
} = {}) {
  const resolveId = (reference) => assetReferenceIndex?.get(reference) ?? reference ?? null
  const activeRelations = mountingRelations.filter((relation) => (
    relation?.verificationStatus !== 'rejected'
      && relation?.verificationStatus !== 'revoked'
  ))
  const alreadyMounted = new Set(activeRelations.map((relation) => resolveId(relation.sourceAssetId)))
  const manuallyHandled = new Set((Array.isArray(mountingOverrides) ? mountingOverrides : [])
    .map((override) => resolveId(override?.assetId ?? override?.sourceAssetId))
    .filter(Boolean))
  const poles = assets.filter(isPoleRecord)
  const inferred = []

  assets
    .filter((asset) => (
      !isPoleRecord(asset)
      && isEligiblePhysicalMountAsset(asset)
      && !alreadyMounted.has(asset.id)
      && !manuallyHandled.has(asset.id)
    ))
    .forEach((asset) => {
      const nearbyPoles = poles
        .filter((pole) => samePhysicalScope(asset, pole))
        .map((pole) => ({
          pole,
          distanceMeters: geographicDistanceMeters(asset.coordinate, pole.coordinate),
        }))
        .filter(({ distanceMeters }) => distanceMeters <= radiusMeters)
        .sort((left, right) => (
          left.distanceMeters - right.distanceMeters
          || String(left.pole.id).localeCompare(String(right.pole.id), 'id')
        ))
      if (!nearbyPoles.length) return

      const nearest = nearbyPoles[0]
      const second = nearbyPoles[1]
      const distanceMargin = second
        ? second.distanceMeters - nearest.distanceMeters
        : Number.POSITIVE_INFINITY
      const distanceRatio = second && nearest.distanceMeters > 0
        ? second.distanceMeters / nearest.distanceMeters
        : Number.POSITIVE_INFINITY
      const ambiguous = Boolean(second) && (
        distanceMargin <= ambiguityDeltaMeters || distanceRatio <= ambiguityRatio
      )
      if (ambiguous) return

      inferred.push({
        relationId: `inferred-mounting:${asset.id}->${nearest.pole.id}`,
        sourceAssetId: asset.id,
        targetAssetId: nearest.pole.id,
        relationType: MOUNTING_RELATION_TYPE,
        relationKind: 'installation_attachment',
        direction: 'source_to_target',
        distanceMeters: roundDistance(nearest.distanceMeters),
        provenance: 'spatial_inference',
        inferenceRule: 'unique_nearest_pole',
        verificationStatus: 'confirmed',
        verifiedBy: 'mounting-spatial-policy',
        evidence: [{
          source: 'spatial',
          ruleId: 'mounting.unique-nearest-pole',
          observedValue: roundDistance(nearest.distanceMeters),
          normalizedValue: `${roundDistance(nearest.distanceMeters)}m`,
          explanation: 'Aset berada dalam radius pemasangan dan memiliki satu tiang terdekat yang tidak ambigu pada fasilitas yang sama.',
        }],
      })
    })

  return inferred.sort((left, right) => (
    String(left.targetAssetId).localeCompare(String(right.targetAssetId), 'id')
      || String(left.sourceAssetId).localeCompare(String(right.sourceAssetId), 'id')
  ))
}

/**
 * Merges map-level and detail-level mounting relations. The detail endpoint
 * is intentionally treated as an additional source: depending on the API
 * projection it may contain only the selected asset's relations, while the
 * map payload contains the complete area projection.
 */
export function mergeMountingRelations(
  relationLists = [],
  assetReferenceIndex = null,
) {
  const merged = new Map()
  relationLists
    .flatMap((relations) => normalizeMountingRelations(relations, assetReferenceIndex))
    .filter((relation) => (
      relation.verificationStatus !== 'rejected'
        && relation.verificationStatus !== 'revoked'
    ))
    .forEach((relation) => {
      const key = `${relation.sourceAssetId}->${relation.targetAssetId}`
      if (!merged.has(key)) merged.set(key, relation)
    })
  return [...merged.values()]
}

export function buildPoleGroups({ assets = [], mountingRelations = [] } = {}) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const groups = new Map()
  mountingRelations
    .filter((relation) => (
      relation?.relationType === MOUNTING_RELATION_TYPE
        && relation?.verificationStatus !== 'rejected'
        && relation?.verificationStatus !== 'revoked'
    ))
    .forEach((relation) => {
      const asset = assetById.get(relation.sourceAssetId)
      const pole = assetById.get(relation.targetAssetId)
      if (!asset || !pole || asset.id === pole.id) return
      let group = groups.get(pole.id)
      if (!group) {
        group = {
          id: `pole-group:${pole.id}`,
          poleAssetId: pole.id,
          pole,
          assetIds: [],
          assets: [],
          relations: [],
          count: 0,
          coordinate: Array.isArray(pole.coordinate)
            ? [...pole.coordinate]
            : null,
        }
        groups.set(pole.id, group)
      }
      if (!group.assetIds.includes(asset.id)) {
        group.assetIds.push(asset.id)
        group.assets.push(asset)
      }
      group.relations.push({ ...relation })
      group.count = group.assetIds.length + 1
    })

  return [...groups.values()]
    .map((group) => ({
      ...group,
      assetIds: [group.poleAssetId, ...group.assetIds],
      assets: [group.pole, ...group.assets],
      childCount: group.assetIds.length,
    }))
    .sort((left, right) => (
      String(left.pole?.name || left.poleAssetId).localeCompare(
        String(right.pole?.name || right.poleAssetId),
        'id',
      )
    ))
}

export function poleGroupForAsset(poleGroups = [], assetId) {
  return poleGroups.find(({ assetIds }) => assetIds.includes(assetId)) ?? null
}

export function mountingRelationsForAsset(mountingRelations = [], assetId) {
  return mountingRelations.filter((relation) => (
    relation.sourceAssetId === assetId || relation.targetAssetId === assetId
  ))
}

export function mountedChildrenForPole(mountingRelations = [], poleAssetId) {
  return [...new Set(mountingRelations
    .filter((relation) => (
      relation.relationType === MOUNTING_RELATION_TYPE
        && relation.verificationStatus !== 'rejected'
        && relation.verificationStatus !== 'revoked'
        && relation.targetAssetId === poleAssetId
    ))
    .map((relation) => relation.sourceAssetId))]
}

function isPoleRecord(asset) {
  const source = `${asset?.type || ''} ${asset?.category || ''} ${asset?.name || ''}`
  return /\b(tiang|pole|pylon)\b/i.test(source)
    || /^T-(?:\d+|TOWER)\b/i.test(String(asset?.name || ''))
    || /(?:^|[\\/])tiang(?:[\\/]|$)/i.test(String(asset?.sourceFolderPath || ''))
}

function isEligiblePhysicalMountAsset(asset) {
  const source = `${asset?.type || ''} ${asset?.category || ''} ${asset?.name || ''} ${asset?.sourceFolderPath || ''}`
    .toLocaleLowerCase('id')
  if (!/junction\s*box|\bjb\b|cctv|camera|kamera/.test(source)) return false
  if (/cable|kabel|view|line|string|path|polygon|area|indoor|rack\s*server|server\s*rack/.test(source)) {
    return false
  }
  return validCoordinate(asset?.coordinate)
}

function samePhysicalScope(left, right) {
  const leftScope = physicalScopeKey(left)
  const rightScope = physicalScopeKey(right)
  if (!leftScope || !rightScope) return true
  return leftScope === rightScope
}

function physicalScopeKey(asset) {
  const explicitScope = asset?.locationGroupKey ?? asset?.areaKey ?? asset?.locationGroupName
  if (explicitScope) return String(explicitScope).trim().toLocaleLowerCase('id')
  const segments = String(asset?.sourceFolderPath || '')
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  const rjbtIndex = segments.findIndex((segment) => segment.toLocaleLowerCase('id') === 'rjbt')
  return rjbtIndex >= 0 && segments[rjbtIndex + 1]
    ? segments[rjbtIndex + 1].toLocaleLowerCase('id')
    : null
}

function validCoordinate(coordinate) {
  return Array.isArray(coordinate)
    && Number.isFinite(Number(coordinate[0]))
    && Number.isFinite(Number(coordinate[1]))
}

function geographicDistanceMeters(left, right) {
  if (!validCoordinate(left) || !validCoordinate(right)) return Number.POSITIVE_INFINITY
  const earthRadiusMeters = 6371000
  const leftLatitude = Number(left[1]) * Math.PI / 180
  const rightLatitude = Number(right[1]) * Math.PI / 180
  const deltaLatitude = (Number(right[1]) - Number(left[1])) * Math.PI / 180
  const deltaLongitude = (Number(right[0]) - Number(left[0])) * Math.PI / 180
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(deltaLongitude / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine))
}

function roundDistance(value) {
  return Math.round(value * 100) / 100
}
