export function createReviewLocationIndex({
  assets = [],
  geometries = [],
  locationGroups = [],
} = {}) {
  const byReference = new Map()
  const add = (reference, locationKey) => {
    if (!reference || !locationKey || byReference.has(String(reference))) return
    byReference.set(String(reference), locationKey)
  }

  assets.forEach((asset) => {
    [
      asset.id,
      asset.assetId,
      asset.sourceNodeId,
      asset.sourceFeatureId,
    ].forEach((reference) => add(reference, asset.locationGroupKey))
  })
  geometries.forEach((geometry) => {
    [
      geometry.id,
      geometry.sourceGeometryId,
      geometry.assetId,
      geometry.sourceNodeId,
      geometry.sourceFeatureId,
      geometry.sourceGeometry?.geometryId,
      geometry.sourceGeometry?.sourceFeatureId,
    ].forEach((reference) => add(reference, geometry.locationGroupKey))
  })

  return { byReference, locationGroups }
}

export function attachCandidateMapGeometryIds(candidates = [], geometries = []) {
  const geometryIdsByAssetId = new Map()
  const geometryIdsBySourceId = new Map()
  geometries.forEach((geometry) => {
    const ids = [geometry.id, geometry.sourceGeometryId].filter(Boolean)
    if (geometry.assetId) {
      geometryIdsByAssetId.set(
        geometry.assetId,
        [...(geometryIdsByAssetId.get(geometry.assetId) ?? []), ...ids],
      )
    }
    if (geometry.sourceGeometryId) {
      geometryIdsBySourceId.set(
        geometry.sourceGeometryId,
        [...(geometryIdsBySourceId.get(geometry.sourceGeometryId) ?? []), ...ids],
      )
    }
  })

  return candidates.map((candidate) => {
    const pathAssetIds = [
      candidate.sourcePathAssetId,
      candidate.targetPathAssetId,
      candidate.targetAssetId,
    ].filter(Boolean)
    return {
      ...candidate,
      mapGeometryIds: [...new Set([
        ...(candidate.mapGeometryIds ?? []),
        ...(candidate.sourceGeometryIds ?? []).flatMap(
          (geometryId) => geometryIdsBySourceId.get(geometryId) ?? [],
        ),
        ...pathAssetIds.flatMap((assetId) => geometryIdsByAssetId.get(assetId) ?? []),
      ])],
    }
  })
}

export function candidateLocationKey(candidate, locationIndex) {
  if (!candidate || !locationIndex) return null
  if (candidate.sourceLocationKey) return candidate.sourceLocationKey
  if (candidate.targetLocationKey) return candidate.targetLocationKey
  const references = [
    ...(candidate.sourceGeometryIds ?? []),
    candidate.sourceGeometryId,
    candidate.sourcePathAssetId,
    candidate.targetAssetId,
    candidate.targetPathAssetId,
    candidate.sourceFeatureId,
    candidate.targetFeatureId,
  ].filter(Boolean)
  for (const reference of references) {
    const locationKey = locationIndex.byReference.get(String(reference))
    if (locationKey) return locationKey
  }

  const coordinate = isCoordinate(candidate.sourceCoordinate)
    ? candidate.sourceCoordinate
    : candidate.targetCoordinate
  if (!isCoordinate(coordinate)) return null
  return locationIndex.locationGroups.find(({ bounds }) => (
    Array.isArray(bounds)
    && Number(coordinate[0]) >= Number(bounds[0])
    && Number(coordinate[0]) <= Number(bounds[2])
    && Number(coordinate[1]) >= Number(bounds[1])
    && Number(coordinate[1]) <= Number(bounds[3])
  ))?.key ?? null
}

export function filterCandidatesByLocation(items, locationKey, locationIndex) {
  if (!locationKey) return [...items]
  return items.filter((candidate) => (
    candidateLocationKey(candidate, locationIndex) === locationKey
  ))
}

export function countCandidatesForLocation(items, locationKey, locationIndex) {
  return filterCandidatesByLocation(items, locationKey, locationIndex).length
}

export function selectReviewLocationGroup({
  requestedKey,
  locationGroups = [],
  candidate = null,
  candidates = [],
  locationIndex,
  branchId,
} = {}) {
  const requested = locationGroups.find(({ key }) => key === requestedKey)
  if (requested) return requested

  const candidateKey = candidateLocationKey(candidate, locationIndex)
  const candidateLocation = locationGroups.find(({ key }) => key === candidateKey)
  if (candidateLocation) return candidateLocation

  const normalizedBranch = String(branchId ?? '').trim().toLowerCase()
  const branchLocation = normalizedBranch
    ? locationGroups.find(({ name }) => String(name).toLowerCase().includes(normalizedBranch))
    : null
  if (branchLocation) return branchLocation

  const ranked = locationGroups
    .map((location, index) => ({
      location,
      index,
      count: countCandidatesForLocation(candidates, location.key, locationIndex),
    }))
    .sort((left, right) => right.count - left.count || left.index - right.index)
  if (ranked[0]?.count) return ranked[0].location

  return locationGroups[0] ?? null
}

function isCoordinate(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
}
