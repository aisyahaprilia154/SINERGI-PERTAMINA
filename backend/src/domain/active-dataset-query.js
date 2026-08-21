import { createHash } from 'node:crypto'
import { AppError } from '../errors.js'
import { createAssetIdentityResolver } from './canonical-asset-identity.js'

const DEFAULT_QUERY_LIMIT = 50
const MAX_QUERY_LIMIT = 200
const ACTIVE_QUERY_SCHEMA_VERSION = '1.0.0'
const TOPOLOGY_PROFILES = new Set(['operational_topology'])

export function buildActiveAssetCatalog({
  record = {},
  identityMap = {},
  topologyGraph = {},
  publicationProfile = 'map_only',
} = {}) {
  const resolver = createAssetIdentityResolver(identityMap)
  const classifiedByFeature = new Map(
    (record.classifiedObjects ?? []).map((item) => [item.sourceFeatureId, item]),
  )
  const sourceFeatureById = new Map(
    (record.sourceFeatures ?? []).map((item) => [item.sourceFeatureId, item]),
  )
  const layerById = new Map((record.layers ?? []).map((item) => [item.id, item]))
  const identityByFeature = new Map(
    (identityMap.items ?? [])
      .filter((item) => item.sourceFeatureId)
      .map((item) => [item.sourceFeatureId, item]),
  )
  const geometriesByAssetNode = groupBy(
    (record.geometries ?? []).filter((item) => item?.assetNodeId),
    (item) => item.assetNodeId,
  )
  const geometriesBySourceFeature = groupBy(
    (record.sourceGeometries ?? []).filter((item) => item?.sourceFeatureId),
    (item) => item.sourceFeatureId,
  )

  const items = (record.assets ?? []).map((asset, index) => {
    const sourceFeatureId = asset.sourceFeatureId ?? asset.properties?.sourceFeatureId ?? null
    const classified = classifiedByFeature.get(sourceFeatureId) ?? {}
    const sourceFeature = sourceFeatureById.get(sourceFeatureId) ?? {}
    const identity = identityByFeature.get(sourceFeatureId)
      ?? findIdentityForAsset(asset, identityMap, resolver)
    const canonicalAssetId = identity?.canonicalAssetId
      ?? asset.canonicalAssetId
      ?? asset.assetId
      ?? asset.id
      ?? sourceFeatureId
      ?? `asset:${index + 1}`
    const stableAssetId = identity?.stableAssetId
      ?? asset.stableAssetId
      ?? stableAssetIdForAsset(asset)
      ?? null
    const objectRole = normalizeValue(
      classified.objectRole ?? asset.objectRole ?? 'asset',
    ) || 'asset'
    const sourceProperties = {
      ...(asset.properties ?? {}),
      ...(sourceFeature.properties ?? {}),
    }
    const assetGeometryRecords = geometriesByAssetNode.get(asset.id) ?? []
    const sourceGeometryRecords = geometriesBySourceFeature.get(sourceFeatureId) ?? []
    const preferredGeometryRecords = assetGeometryRecords.some((geometry) => (
      normalizeGeometryType(geometry.geometryType ?? geometry.type) !== 'unknown'
    ))
      ? assetGeometryRecords
      : sourceGeometryRecords
    const geometries = normalizeGeometries(preferredGeometryRecords).map((geometry) => ({
      ...geometry,
      assetNodeId: asset.id ?? canonicalAssetId,
      datasetVersionId: record.datasetVersion?.id ?? null,
      sourceFeatureId: geometry.sourceFeatureId ?? sourceFeatureId,
    }))
    const positions = geometries.flatMap((geometry) => extractPositions(geometry.coordinates))
    const layer = layerById.get(asset.layerId)
    const name = firstValue(
      asset.name,
      classified.assetName,
      classified.name,
      sourceFeature.sourceName,
      sourceFeature.name,
      sourceFeature.sourceKmlId,
      canonicalAssetId,
    )
    const siteId = firstValue(
      asset.siteId,
      classified.siteId,
      sourceProperties.siteId,
      sourceProperties.semanticMetadata?.siteId,
      asset.branchId,
      record.datasetVersion?.branchId,
    )
    const canonicalAssetType = String(firstValue(
      classified.canonicalAssetType,
      classified.assetType,
      asset.type,
      sourceProperties.assetType,
      'Unknown',
    ))
    const locationGroup = locationGroupFor(sourceFeature.sourceFolderPath
      ?? asset.sourceFolderPath
      ?? layer?.sourceFolderPath)
    return {
      nodeId: asset.id ?? canonicalAssetId,
      assetId: firstValue(asset.assetId, stableAssetId, canonicalAssetId),
      stableAssetId,
      canonicalAssetId,
      onboardingIdentity: identity?.onboardingId ?? asset.onboardingIdentity ?? null,
      legacyAssetId: identity?.legacyId ?? asset.legacyAssetId ?? asset.assetId ?? null,
      identityStatus: normalizeIdentityStatus(
        identity?.identityStatus
          ?? asset.identityStatus
          ?? asset.identityResolutionStatus,
      ),
      identityAliases: cloneValue(identity?.aliases ?? asset.identityAliases ?? {}),
      sourceFeatureId,
      name: String(name),
      objectRole,
      topologyRole: classified.topologyRole ?? null,
      category: String(firstValue(
        classified.canonicalCategory,
        classified.category,
        asset.category,
        sourceProperties.category,
        'Uncategorized',
      )),
      assetType: canonicalAssetType,
      canonicalAssetType,
      diagramClass: canonicalDiagramClassFor({
        diagramClass: classified.diagramClass,
        objectRole,
        canonicalAssetType,
        assetType: classified.assetType ?? asset.type,
        jbProfileId: classified.jbProfileId,
      }),
      jbProfileId: classified.jbProfileId ?? null,
      networkFamily: String(firstValue(
        classified.networkFamily,
        asset.networkFamily,
        sourceProperties.networkFamily,
        'unknown',
      )),
      objectStatus: String(firstValue(
        classified.objectStatus,
        asset.objectStatus,
        sourceProperties.objectStatus,
        'unknown',
      )),
      sourceStatus: String(firstValue(
        classified.sourceStatus,
        asset.sourceStatus,
        sourceProperties.sourceStatus,
        sourceProperties.status,
        'unknown',
      )),
      siteId: siteId === null || siteId === undefined ? null : String(siteId),
      branchId: asset.branchId ?? record.datasetVersion?.branchId ?? null,
      locationText: firstValue(
        asset.location,
        classified.locationText,
        sourceProperties.location,
        sourceProperties.semanticMetadata?.location,
        null,
      ),
      hostname: firstValue(
        asset.hostname,
        sourceProperties.hostname,
        sourceProperties.semanticMetadata?.hostname,
        sourceProperties.extendedData?.hostname,
        null,
      ),
      ipAddress: firstValue(
        asset.ipAddress,
        asset.ip,
        sourceProperties.ipAddress,
        sourceProperties.ip,
        sourceProperties.semanticMetadata?.ipAddress,
        sourceProperties.extendedData?.ipAddress,
        null,
      ),
      layerId: asset.layerId ?? null,
      layerName: layer?.name ?? null,
      sourceFolderPath: firstValue(
        asset.sourceFolderPath,
        sourceFeature.sourceFolderPath,
        layer?.sourceFolderPath,
        null,
      ),
      locationGroupKey: locationGroup.key,
      locationGroupName: locationGroup.name,
      sourceKmlId: sourceFeature.sourceKmlId ?? null,
      sourceElementType: sourceFeature.sourceElementType ?? null,
      sourceFingerprint: sourceFeature.sourceFingerprint ?? null,
      geometries,
      geometryReferences: geometries.map((geometry) => ({
        geometryId: geometry.id,
        sourceGeometryId: geometry.sourceGeometryId,
        sourceFeatureId: geometry.sourceFeatureId ?? sourceFeatureId,
        geometryType: geometry.geometryType,
        valid: geometry.valid,
        bounds: geometry.bounds,
      })),
      bounds: boundsForPositions(positions),
      positions,
      rawAsset: asset,
      rawProperties: sourceProperties,
      _aliases: new Set([
        canonicalAssetId,
        stableAssetId,
        asset.assetId,
        asset.id,
        sourceFeatureId,
        ...(identity?.aliases?.assetIds ?? []),
        ...(identity?.aliases?.legacyIds ?? []),
      ].filter(Boolean).map(String)),
    }
  })

  const byAlias = new Map()
  items.forEach((item) => item._aliases.forEach((alias) => {
    if (!byAlias.has(alias)) byAlias.set(alias, item)
  }))
  const resolveItem = (value) => {
    if (value === null || value === undefined) return null
    const resolved = resolver.resolve(value) ?? String(value)
    return byAlias.get(resolved) ?? byAlias.get(String(value)) ?? null
  }
  const topology = buildTopologyIndex({
    record,
    topologyGraph,
    resolveItem,
    publicationProfile,
  })
  return items.map((item) => {
    const topologyItem = topology.byAlias.get(item.canonicalAssetId)
    return {
      ...item,
      topologyStatus: topologyItem?.status ?? 'isolated',
      topologyReason: topologyItem?.reason ?? null,
      candidateCount: topologyItem?.candidateCount ?? 0,
      confirmedConnections: topologyItem?.connections ?? [],
    }
  })
}

export function queryActiveAssets({
  catalog = [],
  revision = null,
  query = {},
  isAdministrator = false,
  canViewSensitive = false,
  allowLargeLimit = false,
} = {}) {
  const normalized = normalizeActiveAssetQuery(query)
  const includeVisualOnly = isAdministrator && normalized.includeVisualOnly === true
  const eligible = catalog.filter((item) => (
    includeVisualOnly || item.objectRole !== 'visual_only'
  ))
  const matched = eligible.filter((item) => matchesFilters(item, normalized))
  const ranked = matched.map((item) => ({
    item,
    rank: normalized.q ? searchRank(item, normalized.q, canViewSensitive) : 0,
  })).filter(({ rank }) => rank !== null)
  ranked.sort((left, right) => compareRankedItems(left, right))
  const queryHash = hashQuery(normalized)
  const offset = decodeQueryCursor(normalized.cursor, { revision, queryHash })
  const defaultLimit = allowLargeLimit ? Math.max(ranked.length, 1) : DEFAULT_QUERY_LIMIT
  const maxLimit = allowLargeLimit ? Math.max(ranked.length, MAX_QUERY_LIMIT) : MAX_QUERY_LIMIT
  const limit = normalizeLimit(normalized.limit ?? defaultLimit, maxLimit)
  const pageItems = ranked.slice(offset, offset + limit)
  const nextOffset = offset + pageItems.length
  const nextCursor = nextOffset < ranked.length
    ? encodeQueryCursor({ revision, queryHash, offset: nextOffset })
    : null
  return {
    schemaVersion: ACTIVE_QUERY_SCHEMA_VERSION,
    query: publicQuery(normalized),
    items: pageItems.map(({ item, rank }) => projectSearchItem(item, rank, canViewSensitive)),
    facets: buildFacets(ranked.map(({ item }) => item)),
    totalMatched: ranked.length,
    pageInfo: {
      limit,
      returned: pageItems.length,
      hasNextPage: Boolean(nextCursor),
    },
    nextCursor,
    activePointerRevision: revision,
  }
}

export function normalizeActiveAssetQuery(query = {}) {
  return {
    q: normalizeSearchText(query.q),
    siteId: normalizeFilterList(query.siteId),
    networkFamily: normalizeFilterList(query.networkFamily),
    category: normalizeFilterList(query.category),
    assetType: normalizeFilterList(query.assetType),
    sourceStatus: normalizeFilterList(query.sourceStatus),
    identityStatus: normalizeFilterList(query.identityStatus),
    topologyStatus: normalizeFilterList(query.topologyStatus),
    bounds: normalizeBounds(query.bounds),
    cursor: query.cursor ? String(query.cursor) : null,
    limit: query.limit === undefined || query.limit === null || query.limit === ''
      ? null
      : Number(query.limit),
    includeVisualOnly: query.includeVisualOnly === true,
    assetIds: normalizeFilterList(query.assetIds),
  }
}

export function buildActiveSites({
  catalog = [],
  record = {},
  siteBoundaries = {},
} = {}) {
  const grouped = new Map()
  catalog.filter((item) => item.objectRole !== 'visual_only').forEach((item) => {
    const siteId = item.siteId ?? item.branchId ?? record.datasetVersion?.branchId ?? 'unknown'
    const items = grouped.get(String(siteId)) ?? []
    items.push(item)
    grouped.set(String(siteId), items)
  })
  Object.keys(siteBoundaries ?? {}).forEach((siteId) => {
    if (!grouped.has(siteId)) grouped.set(siteId, [])
  })
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([
    siteId,
    items,
  ]) => {
    const configured = normalizeSiteBoundary(siteBoundaries?.[siteId])
    const computedBounds = boundsForPositions(items.flatMap((item) => item.positions))
    const bounds = configured?.bounds ?? computedBounds
    const outsideExtentCount = configured?.bounds
      ? items.filter((item) => item.positions.some((position) => (
        !positionWithinBounds(position, configured.bounds)
      ))).length
      : 0
    return {
      siteId,
      name: configured?.name
        ?? record.siteNames?.[siteId]
        ?? record.branchNames?.[siteId]
        ?? siteId,
      branchId: items[0]?.branchId ?? record.datasetVersion?.branchId ?? null,
      assetCount: items.length,
      geometryCount: items.reduce((count, item) => count + item.geometries.length, 0),
      bounds,
      extentSource: configured?.bounds
        ? 'approved_boundary'
        : computedBounds ? 'canonical_geometry' : 'unknown',
      outsideExtentCount,
      issues: outsideExtentCount > 0
        ? [{ code: 'geometry_outside_site_extent', count: outsideExtentCount }]
        : [],
    }
  })
}

export function buildActiveOverlayDescriptors({
  record = {},
  datasetVersionId,
  siteId = null,
} = {}) {
  const featureSites = new Map(
    (record.classifiedObjects ?? []).map((item) => [item.sourceFeatureId, item.siteId]),
  )
  return (record.sourceOverlays ?? [])
    .filter((overlay) => (
      overlay?.valid === true
      && overlay.resourceId
      && overlay.resourceResolutionStatus === 'resolved'
    ))
    .map((overlay) => {
      const overlaySiteId = overlay.siteId
        ?? featureSites.get(overlay.sourceFeatureId)
        ?? record.datasetVersion?.branchId
        ?? null
      return {
        sourceOverlayId: overlay.sourceOverlayId ?? overlay.overlayId ?? overlay.id ?? null,
        sourceFeatureId: overlay.sourceFeatureId ?? null,
        name: safeText(overlay.name ?? overlay.sourceName ?? 'Overlay'),
        sourceFolderPath: safeText(overlay.sourceFolderPath ?? null),
        siteId: overlaySiteId,
        requiredForMap: overlay.requiredForMap === true,
        resourceId: overlay.resourceId,
        resourceResolutionStatus: 'resolved',
        valid: true,
        visibility: overlay.visibility !== false,
        drawOrder: overlay.drawOrder ?? null,
        rotation: overlay.rotation ?? overlay.latLonBox?.rotation ?? 0,
        resourceUrl: `/api/dataset-versions/${encodeURIComponent(datasetVersionId)}`
          + `/overlay-resources/${encodeURIComponent(overlay.resourceId)}`,
        geometryType: overlay.geometryType ?? null,
        bounds: cloneValue(overlay.bounds ?? overlay.latLonBox ?? null),
        latLonBox: cloneValue(overlay.latLonBox ?? null),
        latLonQuad: cloneValue(overlay.latLonQuad ?? null),
      }
    })
    .filter((overlay) => !siteId || overlay.siteId === siteId)
}

export function buildActiveSummary({
  catalog = [],
  sites = [],
  record = {},
  topologyGraph = {},
  overlays = [],
} = {}) {
  const geometryTypeCounts = {}
  let validGeometryCount = 0
  let invalidGeometryCount = 0
  catalog.forEach((item) => item.geometries.forEach((geometry) => {
    if (!geometry.valid) {
      invalidGeometryCount += 1
      return
    }
    validGeometryCount += 1
    geometryTypeCounts[geometry.geometryType] = (geometryTypeCounts[geometry.geometryType] ?? 0) + 1
  }))
  const operationalAssets = catalog.filter((item) => item.objectRole !== 'visual_only')
  return {
    assetCount: operationalAssets.length,
    allObjectCount: catalog.length,
    siteCount: sites.length,
    sourceFeatureCount: (record.sourceFeatures ?? []).length,
    validGeometryCount,
    invalidGeometryCount,
    geometryTypeCounts,
    overlayCount: overlays.length,
    confirmedConnectionCount: (topologyGraph.edges ?? []).length,
    assetsWithoutGeometry: operationalAssets.filter((item) => item.geometries.every(
      (geometry) => !geometry.valid,
    )).length,
    outsideExtentCount: sites.reduce((count, site) => count + site.outsideExtentCount, 0),
  }
}

export function buildActiveCapabilities({
  publicationProfile = 'map_only',
  readiness = {},
} = {}) {
  const topologyPublished = TOPOLOGY_PROFILES.has(publicationProfile)
  const topologyReady = topologyPublished && readiness?.topologyReady === 'ready'
  return {
    search: true,
    assetDetail: true,
    trace: topologyReady,
    impact: false,
    topologyDiagram: topologyReady,
    reasonCodes: topologyReady ? [] : ['topology_not_ready'],
  }
}

export function projectSearchItem(item, rank = 0, canViewSensitive = false) {
  return {
    assetId: item.assetId,
    stableAssetId: item.stableAssetId,
    canonicalAssetId: item.canonicalAssetId,
    identityStatus: item.identityStatus,
    name: safeText(item.name),
    objectRole: item.objectRole,
    diagramClass: item.diagramClass,
    jbProfileId: item.jbProfileId,
    category: safeText(item.category),
    assetType: safeText(item.assetType),
    networkFamily: safeText(item.networkFamily),
    sourceStatus: safeText(item.sourceStatus),
    topologyStatus: item.topologyStatus,
    siteId: item.siteId,
    locationText: safeText(item.locationText),
    hostname: canViewSensitive ? safeText(item.hostname) : null,
    ...(canViewSensitive ? { ipAddress: safeText(item.ipAddress) } : {}),
    hasGeometry: item.geometries.some((geometry) => geometry.valid),
    bounds: cloneValue(item.bounds),
    sourceFeatureId: item.sourceFeatureId,
    sourceFolderPath: safeText(item.sourceFolderPath),
    locationGroupKey: item.locationGroupKey,
    locationGroupName: safeText(item.locationGroupName),
    rank,
  }
}

function buildTopologyIndex({ record, topologyGraph, resolveItem, publicationProfile }) {
  const byAlias = new Map()
  const degree = new Map()
  const connections = new Map()
  const addConnection = (item, connection) => {
    if (!item) return
    const key = item.canonicalAssetId
    const current = connections.get(key) ?? []
    current.push(connection)
    connections.set(key, current)
  }
  ;(topologyGraph.edges ?? []).forEach((edge) => {
    const source = resolveItem(edge.sourceAssetId ?? edge.sourceNodeId)
    const target = resolveItem(edge.targetAssetId ?? edge.targetNodeId)
    if (!source || !target) return
    degree.set(source.canonicalAssetId, (degree.get(source.canonicalAssetId) ?? 0) + 1)
    degree.set(target.canonicalAssetId, (degree.get(target.canonicalAssetId) ?? 0) + 1)
    const base = {
      relationId: edge.id ?? null,
      relationType: edge.relationType ?? 'connected-to',
      relationKind: edge.relationKind ?? 'device_edge',
      direction: edge.direction ?? 'undirected',
    }
    addConnection(source, { ...base, assetId: target.assetId, canonicalAssetId: target.canonicalAssetId })
    addConnection(target, { ...base, assetId: source.assetId, canonicalAssetId: source.canonicalAssetId })
  })
  const candidates = new Map()
  ;(record.topologyCandidates ?? []).forEach((candidate) => {
    if (['rejected', 'skipped', 'revoked'].includes(String(candidate.status).toLowerCase())) return
    const source = resolveItem(
      candidate.sourceAssetId ?? candidate.sourceNodeId ?? candidate.sourceFeatureId,
    )
    const target = resolveItem(
      candidate.targetAssetId ?? candidate.targetNodeId ?? candidate.targetSourceFeatureId,
    )
    if (source) candidates.set(source.canonicalAssetId, (candidates.get(source.canonicalAssetId) ?? 0) + 1)
    if (target) candidates.set(target.canonicalAssetId, (candidates.get(target.canonicalAssetId) ?? 0) + 1)
  })
  const itemKeys = new Set([
    ...degree.keys(),
    ...candidates.keys(),
    ...(topologyGraph.nodes ?? []).map((node) => resolveItem(node.id ?? node.assetId)?.canonicalAssetId),
  ].filter(Boolean))
  itemKeys.forEach((key) => {
    const isPublished = TOPOLOGY_PROFILES.has(publicationProfile)
    const connectionCount = degree.get(key) ?? 0
    const candidateCount = candidates.get(key) ?? 0
    const status = !isPublished
      ? 'not-applicable'
      : connectionCount > 0
        ? 'connected'
        : candidateCount > 0 ? 'pending-review' : 'isolated'
    byAlias.set(key, {
      status,
      reason: !isPublished ? 'topology_not_published' : null,
      candidateCount,
      connections: connections.get(key) ?? [],
    })
  })
  return { byAlias }
}

function matchesFilters(item, query) {
  if (query.assetIds.length && !query.assetIds.some((value) => (
    [...item._aliases].some((alias) => normalizeSearchText(alias) === value)
  ))) return false
  if (!matchesList(item.siteId, query.siteId)) return false
  if (!matchesList(item.networkFamily, query.networkFamily)) return false
  if (!matchesList(item.category, query.category)) return false
  if (!matchesList(item.assetType, query.assetType)) return false
  if (!matchesList(item.sourceStatus, query.sourceStatus)) return false
  if (!matchesList(item.identityStatus, query.identityStatus)) return false
  if (!matchesList(item.topologyStatus, query.topologyStatus)) return false
  if (query.bounds && !boundsIntersect(item.bounds, query.bounds)) return false
  return true
}

function searchRank(item, query, canViewSensitive = false) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return 0
  const exactId = [item.stableAssetId, item.canonicalAssetId, item.assetId]
    .filter(Boolean).map(normalizeSearchText)
  const name = normalizeSearchText(item.name)
  const hostname = normalizeSearchText(item.hostname)
  const ipAddress = canViewSensitive ? normalizeSearchText(item.ipAddress) : ''
  const type = normalizeSearchText(item.assetType)
  const category = normalizeSearchText(item.category)
  const location = normalizeSearchText(item.locationText)
  if (exactId.includes(normalizedQuery)) return 100
  if (normalizedQuery.length < 2) return null
  if (exactId.some((value) => value.startsWith(normalizedQuery))) return 90
  if (name === normalizedQuery) return 80
  if (name.startsWith(normalizedQuery)) return 70
  if (hostname === normalizedQuery || ipAddress === normalizedQuery) return 65
  if (type === normalizedQuery || category === normalizedQuery) return 60
  if (tokenMatch(location, normalizedQuery) || tokenMatch(name, normalizedQuery)) return 50
  if ([name, hostname, ipAddress, type, category, location].some((value) => value.includes(normalizedQuery))) {
    return 40
  }
  return null
}

function compareRankedItems(left, right) {
  const rankDifference = right.rank - left.rank
  if (rankDifference) return rankDifference
  const nameDifference = normalizeSearchText(left.item.name).localeCompare(
    normalizeSearchText(right.item.name),
  )
  if (nameDifference) return nameDifference
  return normalizeSearchText(left.item.assetId).localeCompare(
    normalizeSearchText(right.item.assetId),
  )
}

function buildFacets(items) {
  const fields = ['siteId', 'networkFamily', 'category', 'assetType', 'sourceStatus', 'identityStatus', 'topologyStatus']
  return Object.fromEntries(fields.map((field) => {
    const counts = new Map()
    items.forEach((item) => {
      const value = item[field] ?? 'unknown'
      counts.set(String(value), (counts.get(String(value)) ?? 0) + 1)
    })
    return [field, [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => ({ value, count }))]
  }))
}

function decodeQueryCursor(cursor, { revision, queryHash }) {
  if (!cursor) return 0
  let decoded
  try {
    decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
  } catch {
    throw new AppError('Cursor pencarian dataset aktif tidak valid.', {
      code: 'invalid_active_query_cursor',
      statusCode: 400,
    })
  }
  if (decoded?.revision !== revision || decoded?.queryHash !== queryHash) {
    throw new AppError('Cursor pencarian sudah tidak berlaku karena active pointer berubah.', {
      code: 'active_query_cursor_stale',
      statusCode: 409,
      details: { activePointerRevision: revision },
    })
  }
  const offset = Number(decoded.offset)
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new AppError('Cursor pencarian dataset aktif tidak valid.', {
      code: 'invalid_active_query_cursor',
      statusCode: 400,
    })
  }
  return offset
}

function encodeQueryCursor(value) {
  return Buffer.from(JSON.stringify({
    schemaVersion: ACTIVE_QUERY_SCHEMA_VERSION,
    ...value,
  })).toString('base64url')
}

function hashQuery(query) {
  return createHash('sha256').update(JSON.stringify(publicQuery(query))).digest('hex').slice(0, 24)
}

function publicQuery(query) {
  const { cursor, ...rest } = query
  return { ...rest, cursor: cursor ? '[cursor]' : null }
}

function normalizeFilterList(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return [...new Set(values.flatMap((item) => String(item).split(',')).map((item) => (
    normalizeSearchText(item)
  )).filter(Boolean))]
}

function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase()
}

function normalizeValue(value) {
  return String(value ?? '').normalize('NFKC').trim()
}

function normalizeIdentityStatus(value) {
  const normalized = normalizeSearchText(value)
  if (normalized.includes('conflict')) return 'conflict'
  if (normalized.includes('onboarding') || normalized.includes('candidate')) return 'onboarding'
  if (normalized.includes('not_applicable') || normalized === 'not-applicable') return 'not-applicable'
  if (normalized.includes('stable')) return 'stable'
  return normalized || 'unknown'
}

function normalizeGeometries(geometries) {
  return geometries.map((geometry, index) => {
    const geometryType = normalizeGeometryType(geometry.geometryType ?? geometry.type)
    const coordinates = normalizeGeometryCoordinates(geometry, geometryType)
    const positions = extractPositions(coordinates)
    const valid = geometry.valid !== false && positions.length > 0
      && geometryType !== 'unknown'
    return {
      id: geometry.id ?? geometry.geometryId ?? `geometry:${index + 1}`,
      sourceGeometryId: geometry.sourceGeometryId ?? geometry.id ?? null,
      sourceFeatureId: geometry.sourceFeatureId ?? null,
      geometryType,
      coordinates,
      altitudeMode: geometry.altitudeMode ?? null,
      valid,
      bounds: geometry.bounds ? cloneValue(geometry.bounds) : boundsForPositions(positions),
    }
  })
}

function normalizeGeometryCoordinates(geometry, geometryType) {
  if (geometryType !== 'multi_geometry') return cloneValue(geometry.coordinates)
  const children = geometry.geometries ?? geometry.coordinates ?? []
  return (Array.isArray(children) ? children : [])
    .map((child) => {
      if (!child || typeof child !== 'object') return null
      const childType = normalizeGeometryType(child.geometryType ?? child.type)
      if (childType === 'unknown' || childType === 'multi_geometry') return null
      return {
        geometryType: childType,
        coordinates: cloneValue(child.coordinates),
        sourceGeometryId: child.sourceGeometryId ?? child.geometryId ?? null,
      }
    })
    .filter(Boolean)
}

function normalizeGeometryType(value) {
  const normalized = normalizeSearchText(value).replace(/[-\s]/g, '_')
  return {
    point: 'point',
    linestring: 'line_string',
    line_string: 'line_string',
    line: 'line_string',
    polygon: 'polygon',
    multigeometry: 'multi_geometry',
    multi_geometry: 'multi_geometry',
    multi: 'multi_geometry',
  }[normalized] ?? 'unknown'
}

function extractPositions(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return extractPositions(value.coordinates)
  }
  if (!Array.isArray(value)) return []
  if (isPosition(value)) return [[Number(value[0]), Number(value[1])]]
  return value.flatMap((item) => extractPositions(item))
}

function isPosition(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
    && Number(value[0]) >= -180 && Number(value[0]) <= 180
    && Number(value[1]) >= -90 && Number(value[1]) <= 90
}

function boundsForPositions(positions) {
  if (!positions.length) return null
  const longitudes = positions.map(([longitude]) => longitude)
  const latitudes = positions.map(([, latitude]) => latitude)
  return {
    west: Math.min(...longitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    north: Math.max(...latitudes),
  }
}

function normalizeBounds(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const values = value.split(',').map(Number)
    if (values.length !== 4 || values.some((item) => !Number.isFinite(item))) return null
    return { west: values[0], south: values[1], east: values[2], north: values[3] }
  }
  const bounds = {
    west: Number(value.west),
    south: Number(value.south),
    east: Number(value.east),
    north: Number(value.north),
  }
  return Object.values(bounds).every(Number.isFinite) ? bounds : null
}

function normalizeSiteBoundary(value) {
  if (!value) return null
  const bounds = normalizeBounds(value.bounds ?? value)
  if (!bounds) return null
  return { bounds, name: value.name ? safeText(value.name) : null }
}

function boundsIntersect(left, right) {
  if (!left || !right) return false
  return left.west <= right.east && left.east >= right.west
    && left.south <= right.north && left.north >= right.south
}

function positionWithinBounds(position, bounds) {
  return position[0] >= bounds.west && position[0] <= bounds.east
    && position[1] >= bounds.south && position[1] <= bounds.north
}

function matchesList(value, allowed) {
  if (!allowed.length) return true
  return allowed.includes(normalizeSearchText(value))
}

function normalizeLimit(value, max = MAX_QUERY_LIMIT) {
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1) return Math.min(DEFAULT_QUERY_LIMIT, max)
  return Math.min(limit, max)
}

function canonicalDiagramClassFor({
  diagramClass,
  objectRole,
  canonicalAssetType,
  assetType,
  jbProfileId,
} = {}) {
  const explicit = normalizeSearchText(diagramClass).replaceAll('_', '-')
  const explicitMap = {
    'rack-root': 'rack-root',
    rack: 'rack-root',
    root: 'rack-root',
    core: 'rack-root',
    'junction-peer': 'junction-peer',
    junction: 'junction-peer',
    'junction-regular': 'junction-peer',
    'junction-extended': 'junction-extended',
    'extended-junction': 'junction-extended',
    endpoint: 'endpoint',
    'physical-mount': 'physical-mount',
    mounting: 'physical-mount',
  }
  if (explicitMap[explicit]) return explicitMap[explicit]

  const profile = normalizeSearchText(jbProfileId).replaceAll('_', '-')
  if (profile.includes('server-rack') || profile.includes('rack-server')) return 'rack-root'
  if (profile.includes('extended')) return 'junction-extended'
  if (profile.includes('main-jb') || profile.includes('main-junction')) return 'junction-peer'

  const type = normalizeSearchText([canonicalAssetType, assetType].filter(Boolean).join(' '))
  if (/(^|\s)(pole|tiang|mast|pylon)(\s|$)/.test(type)) return 'physical-mount'
  if (/(^|\s)(junction box|junction|jb)(\s|$)/.test(type)) return 'junction-peer'
  if (/(server rack|rack server|router|switch|core switch|nvr|otb|olt)/.test(type)) {
    return 'rack-root'
  }
  if (/(cctv|camera|access point|endpoint|printer|peripheral)/.test(type)) return 'endpoint'
  if (objectRole === 'device_node' && normalizeSearchText(canonicalAssetType) !== 'unknown') {
    return 'endpoint'
  }
  return null
}

function locationGroupFor(sourceFolderPath) {
  const segments = String(sourceFolderPath ?? '')
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  const rjbtIndex = segments.findIndex((segment) => segment.toUpperCase() === 'RJBT')
  const name = rjbtIndex >= 0 ? segments[rjbtIndex + 1] : null
  if (!name) return { key: 'lainnya', name: 'Lainnya' }
  const key = name.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return { key: key || 'lainnya', name }
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '')
    ?? null
}

function findIdentityForAsset(asset, identityMap, resolver) {
  const sourceFeatureId = asset.sourceFeatureId ?? asset.properties?.sourceFeatureId
  const canonicalAssetId = resolver.resolve(asset.canonicalAssetId ?? asset.assetId ?? asset.id)
  return (identityMap.items ?? []).find((item) => (
    (sourceFeatureId && item.sourceFeatureId === sourceFeatureId)
      || (canonicalAssetId && item.canonicalAssetId === canonicalAssetId)
  )) ?? null
}

function stableAssetIdForAsset(asset = {}) {
  if (asset.stableAssetId) return asset.stableAssetId
  if (asset.identityResolutionStatus === 'stable_explicit'
    || asset.identityResolutionStatus === 'stable_registry') return asset.assetId
  if (asset.identityStatus === 'stable' && !asset.onboardingIdentity) return asset.assetId
  return null
}

function tokenMatch(value, query) {
  return value.split(/[^\p{L}\p{N}._:-]+/u).filter(Boolean).some((token) => token === query)
}

function safeText(value) {
  if (value === null || value === undefined) return null
  return String(value).replace(/[<>]/g, '').normalize('NFKC').trim()
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function groupBy(items, keySelector) {
  const grouped = new Map()
  items.forEach((item) => {
    const key = keySelector(item)
    const values = grouped.get(key) ?? []
    values.push(item)
    grouped.set(key, values)
  })
  return grouped
}
