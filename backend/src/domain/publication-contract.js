import { createHash } from 'node:crypto'

export const READINESS_SCHEMA_VERSION = '2.0.0'
export const PUBLICATION_POLICY_VERSION = 'publication-policy:1'
export const PUBLICATION_PROFILES = Object.freeze([
  'map_only',
  'operational_topology',
])

export const CONTROLLED_VOCABULARY_VERSION = 'controlled-vocabulary:1'

export const CONTROLLED_VOCABULARY = Object.freeze({
  objectRole: Object.freeze([
    'device_node',
    'cable_path',
    'coverage_area',
    'ground_overlay',
    'visual_only',
    'unknown',
  ]),
  networkFamily: Object.freeze([
    'cctv',
    'fiber_optic',
    'lan',
    'infrastructure',
    'unknown',
  ]),
  sourceStatus: Object.freeze([
    'active',
    'planned',
    'retired',
    'unknown',
  ]),
  category: Object.freeze([
    'cctv',
    'cctv_cable',
    'junction_box',
    'fiber_optic',
    'lan',
    'network_device',
    'server',
    'nvr',
    'peripheral',
    'supporting_infrastructure',
    'coverage_area',
    'visual_only',
    'unknown',
  ]),
  assetType: Object.freeze([
    'cctv_fixed',
    'cctv_ptz',
    'cctv_dome',
    'junction_box',
    'switch',
    'router',
    'server',
    'nvr',
    'rack',
    'pole',
    'fiber_cable',
    'lan_cable',
    'infrastructure_path',
    'peripheral',
    'unknown',
  ]),
})

const VOCABULARY_ALIASES = Object.freeze({
  objectRole: Object.freeze({
    device: 'device_node',
    node: 'device_node',
    asset: 'device_node',
    cable: 'cable_path',
    path: 'cable_path',
    area: 'coverage_area',
    overlay: 'ground_overlay',
    visual: 'visual_only',
  }),
  networkFamily: Object.freeze({
    fibre_optic: 'fiber_optic',
    fiber: 'fiber_optic',
    optic: 'fiber_optic',
    cctv_network: 'cctv',
  }),
  sourceStatus: Object.freeze({
    online: 'active',
    operational: 'active',
    existing: 'active',
    future: 'planned',
    decommissioned: 'retired',
  }),
  category: Object.freeze({
    'cctv cable': 'cctv_cable',
    'kabel cctv': 'cctv_cable',
    'cctv junction box': 'junction_box',
    'junction box cctv': 'junction_box',
    'junction box': 'junction_box',
    'fiber optic': 'fiber_optic',
    'fibre optic': 'fiber_optic',
    'lan cable': 'lan_cable',
    'network device': 'network_device',
    infrastructure: 'supporting_infrastructure',
    supporting: 'supporting_infrastructure',
    area: 'coverage_area',
    'coverage area': 'coverage_area',
    visual: 'visual_only',
  }),
  assetType: Object.freeze({
    camera: 'cctv_fixed',
    cctv: 'cctv_fixed',
    'fixed camera': 'cctv_fixed',
    'fixed cctv': 'cctv_fixed',
    ptz: 'cctv_ptz',
    'ptz outdoor': 'cctv_ptz',
    'outdoor ptz dome': 'cctv_ptz',
    'ptz outdoor dome': 'cctv_ptz',
    dome: 'cctv_dome',
    'dome camera': 'cctv_dome',
    'junction box': 'junction_box',
    'cctv junction box': 'junction_box',
    'network switch': 'switch',
    'lan switch': 'switch',
    'fiber cable': 'fiber_cable',
    'fibre cable': 'fiber_cable',
    'fiber optic': 'fiber_cable',
    'fiber optic cable': 'fiber_cable',
    'lan cable': 'lan_cable',
    'utp cable': 'lan_cable',
    'infrastructure path': 'infrastructure_path',
    'access point': 'peripheral',
  }),
})

const OPERATIONAL_ROLES = new Set(['device_node', 'cable_path'])
const MAP_READY_STATUSES = new Set(['ready', 'ready_with_warnings'])

/**
 * Normalizes one controlled-vocabulary value without making an unknown source
 * value look canonical. The original value is retained by callers as evidence.
 */
export function canonicalVocabularyValue(field, value) {
  const normalizedField = String(field ?? '')
  const normalized = normalizeToken(value)
  if (!normalized) return null
  const allowed = CONTROLLED_VOCABULARY[normalizedField] ?? []
  if (allowed.includes(normalized)) return normalized
  return VOCABULARY_ALIASES[normalizedField]?.[normalized] ?? null
}

export function isCanonicalVocabularyValue(field, value) {
  return CONTROLLED_VOCABULARY[field]?.includes(String(value ?? '')) === true
}

export function normalizePublicationProfile(value, { allowNull = true } = {}) {
  if ((value === null || value === undefined || value === '') && allowNull) return null
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!PUBLICATION_PROFILES.includes(normalized)) return null
  return normalized
}

export function isReadinessUsable(status) {
  return MAP_READY_STATUSES.has(status)
}

export function buildReadinessContract({
  datasetVersion = {},
  issues = [],
  parserCoverage = {},
  sourceFeatures = [],
  sourceGeometries = [],
  sourceOverlays = [],
  classifiedObjects = [],
  topologyReadiness = null,
  topologyGraph = null,
  evaluatedAt = null,
  policyVersion = PUBLICATION_POLICY_VERSION,
} = {}) {
  const normalizedIssues = issues.map((issue) => normalizeIssue(issue, {
    datasetVersionId: datasetVersion.id,
  }))
  const coverage = buildCoverageReport({
    parserCoverage,
    sourceFeatures,
    sourceGeometries,
    sourceOverlays,
    classifiedObjects,
  })

  const parseReasons = reasonsFor(normalizedIssues, 'parse', 'map_only')
  const mapReasons = reasonsFor(normalizedIssues, 'map', 'map_only')
  const inventoryReasons = reasonsFor(normalizedIssues, 'inventory', 'operational_topology')
  const topologyReasons = reasonsFor(normalizedIssues, 'topology', 'operational_topology')
  const parseBlocking = countBlocking(normalizedIssues, 'parse', ['map_only', 'operational_topology'])
  const mapBlocking = countBlocking(normalizedIssues, 'map', ['map_only'])
  const inventoryBlocking = countBlocking(normalizedIssues, 'inventory', ['operational_topology'])

  const packageReady = datasetVersion.validationStatus !== 'invalid'
    && coverage.sourceElementCountReconciled
    && coverage.parserCoverageReconciled
  const parseStatus = parseBlocking > 0 || !packageReady
    ? 'not_ready'
    : warningCount(normalizedIssues, 'parse') > 0
      ? 'ready_with_warnings'
      : 'ready'

  const requiredGeometries = sourceGeometries.filter(({ requiredForMap }) => (
    requiredForMap !== false
  ))
  const invalidRequiredGeometryCount = requiredGeometries.filter((geometry) => (
    geometry.valid === false || !isRenderableSourceGeometry(geometry)
  )).length
  const requiredOverlays = sourceOverlays.filter(({ requiredForMap }) => (
    requiredForMap !== false
  ))
  const unresolvedRequiredOverlayCount = requiredOverlays.filter((overlay) => (
    overlay.valid === false
      || !['resolved', 'not_required'].includes(overlay.resourceResolutionStatus)
  )).length
  const siteKnown = classifiedObjects
    .filter(({ objectRole }) => OPERATIONAL_ROLES.has(objectRole))
    .every((object) => Boolean(object.siteId ?? datasetVersion.branchId))
  const geographicObjectCount = requiredGeometries.length + requiredOverlays.length
  const mapStatus = parseStatus === 'not_ready'
    || mapBlocking > 0
    || invalidRequiredGeometryCount > 0
    || unresolvedRequiredOverlayCount > 0
    || !siteKnown
    || geographicObjectCount === 0
    ? 'not_ready'
    : warningCount(normalizedIssues, 'map') > 0
      || coverage.invalidGeometryCount > 0
      || coverage.nonRequiredUnrenderableGeometryCount > 0
      ? 'ready_with_warnings'
      : 'ready'

  const inventory = evaluateInventory({
    datasetVersion,
    classifiedObjects,
    sourceFeatures,
    sourceGeometries,
  })
  const inventoryStatus = inventory.operationalAssetCount === 0
    ? 'not_applicable'
    : inventoryBlocking > 0 || inventory.blockingIssueCount > 0
      ? 'not_ready'
      : inventory.warningCount > 0
        ? 'ready_with_warnings'
        : 'ready'

  const topologyStatus = evaluateTopologyStatus({
    topologyReadiness,
    topologyGraph,
    classifiedObjects,
  })
  const topology = {
    status: topologyStatus.status,
    blockingIssueCount: topologyStatus.blockingIssueCount,
    warningCount: topologyStatus.warningCount,
    coverage: topologyStatus.coverage,
    reasons: uniqueReasons([
      ...topologyReasons,
      ...topologyStatus.reasons,
    ]),
  }

  const parse = {
    status: parseStatus,
    blockingIssueCount: parseBlocking,
    warningCount: warningCount(normalizedIssues, 'parse'),
    coverage: {
      ...coverage,
      packageSafe: datasetVersion.validationStatus !== 'invalid',
      sourceElementsReconciled: coverage.sourceElementCountReconciled,
    },
    reasons: uniqueReasons(parseReasons),
  }
  const map = {
    status: mapStatus,
    blockingIssueCount: mapBlocking + invalidRequiredGeometryCount + unresolvedRequiredOverlayCount,
    warningCount: warningCount(normalizedIssues, 'map'),
    coverage: {
      ...coverage,
      requiredGeometryCount: requiredGeometries.length,
      requiredGeometryRenderableCount: requiredGeometries.length - invalidRequiredGeometryCount,
      requiredOverlayCount: requiredOverlays.length,
      requiredOverlayResolvedCount: requiredOverlays.length - unresolvedRequiredOverlayCount,
      siteKnown,
    },
    reasons: uniqueReasons([
      ...mapReasons,
      ...(invalidRequiredGeometryCount ? ['required_map_geometry_invalid'] : []),
      ...(unresolvedRequiredOverlayCount ? ['required_overlay_unresolved'] : []),
      ...(!siteKnown ? ['unknown_site'] : []),
      ...(geographicObjectCount === 0 ? ['no_geographic_object'] : []),
    ]),
  }
  const inventoryDimension = {
    status: inventoryStatus,
    blockingIssueCount: inventory.blockingIssueCount + inventoryBlocking,
    warningCount: inventory.warningCount,
    coverage: inventory.coverage,
    reasons: uniqueReasons([
      ...inventoryReasons,
      ...inventory.reasons,
    ]),
  }

  const readiness = {
    schemaVersion: READINESS_SCHEMA_VERSION,
    parse,
    map,
    inventory: inventoryDimension,
    topology,
    publishableProfiles: [],
    evaluatedAt: evaluatedAt
      ?? datasetVersion.readinessEvaluatedAt
      ?? datasetVersion.importedAt
      ?? null,
    policyVersion,
  }
  if (isReadinessUsable(parse.status) && isReadinessUsable(map.status)) {
    readiness.publishableProfiles.push('map_only')
  }
  if (readiness.publishableProfiles.includes('map_only')
    && inventoryStatus === 'ready'
    && topologyStatus.status === 'ready') {
    readiness.publishableProfiles.push('operational_topology')
  }

  // Compatibility fields are projections of this contract. They are kept for
  // existing clients during the migration window and never drive policy.
  readiness.parseReadiness = parse.status
  readiness.mapReadiness = map.status
  readiness.inventoryReadiness = inventoryStatus
  readiness.topologyReadiness = topology.status
  readiness.mapReady = map.status
  readiness.inventoryReady = inventoryStatus
  readiness.topologyReady = topology.status
  readiness.publicationStatus = datasetVersion.publicationStatus ?? 'unpublished'
  readiness.compatibility = {
    deprecatedFields: [
      'parseReadiness',
      'mapReadiness',
      'inventoryReadiness',
      'topologyReadiness',
    ],
    removalMilestone: 'phase-2-active-context-v2',
  }
  return readiness
}

export function normalizeIssue(issue = {}, { datasetVersionId = null } = {}) {
  const issueCode = String(issue.issueCode ?? issue.code ?? 'processing_issue').trim()
  const readinessDimension = normalizeReadinessDimension(
    issue.readinessDimension,
    issueCode,
    issue.scope,
  )
  const blockingProfiles = normalizeBlockingProfiles(
    issue.blockingProfiles,
    issue,
    readinessDimension,
  )
  const focus = issue.focus ?? compact({
    assetId: issue.assetId,
    sourceFeatureId: issue.sourceFeatureId,
    geometryId: issue.geometryId,
    sourceFolderPath: issue.sourceFolderPath,
  })
  return {
    id: issue.id ?? issue.issueId ?? `issue:${datasetVersionId ?? 'unknown'}:${fingerprint(issue).slice(0, 16)}`,
    datasetVersionId: issue.datasetVersionId ?? datasetVersionId,
    severity: ['error', 'warning', 'information'].includes(issue.severity)
      ? issue.severity
      : 'warning',
    issueCode,
    scope: normalizeScope(issue.scope),
    readinessDimension,
    blockingProfiles,
    message: String(issue.message ?? 'Dataset issue tidak mempunyai pesan.'),
    focus: structuredClone(focus ?? {}),
    details: structuredClone(issue.details ?? {}),
    recommendedAction: String(
      issue.recommendedAction
        ?? defaultRecommendedAction(issueCode),
    ),
    ...(issue.sourceIssueCode ? { sourceIssueCode: issue.sourceIssueCode } : {}),
    // Legacy policy flag is derived, never authoritative.
    canPublish: blockingProfiles.includes('map_only'),
    canActivate: blockingProfiles.includes('map_only'),
  }
}

export function isProfilePublishable(record = {}, profile = 'map_only') {
  const normalizedProfile = normalizePublicationProfile(profile, { allowNull: false })
  if (!normalizedProfile) return false
  const readiness = record.readiness ?? record.readinessContract
  if (Array.isArray(readiness?.publishableProfiles)) {
    return readiness.publishableProfiles.includes(normalizedProfile)
  }
  if (normalizedProfile === 'map_only') {
    return record.validation?.canActivate === true
      && record.datasetVersion?.validationStatus === 'valid'
  }
  return false
}

export function publicationCapabilities(record = {}, profile = null) {
  const normalizedProfile = normalizePublicationProfile(
    profile ?? record.datasetVersion?.publicationProfile,
  )
  const mapPublished = normalizedProfile === 'map_only'
    || normalizedProfile === 'operational_topology'
  const topologyPublished = normalizedProfile === 'operational_topology'
  return {
    search: mapPublished,
    assetDetail: mapPublished,
    trace: topologyPublished,
    impact: topologyPublished,
    topologyDiagram: topologyPublished,
    reasonCodes: topologyPublished ? [] : ['topology_not_published'],
  }
}

function evaluateInventory({
  datasetVersion,
  classifiedObjects,
  sourceFeatures,
  sourceGeometries,
}) {
  const operational = classifiedObjects.filter((object) => (
    OPERATIONAL_ROLES.has(object.objectRole)
      && normalizeSourceStatus(object.sourceStatus) !== 'retired'
  ))
  const featureById = new Map(sourceFeatures.map((feature) => [feature.sourceFeatureId, feature]))
  const geometriesByFeature = groupBy(sourceGeometries, 'sourceFeatureId')
  const stable = operational.filter((object) => hasStableIdentity(object, featureById.get(object.sourceFeatureId)))
  const missingName = operational.filter((object) => !readAssetName(object, featureById.get(object.sourceFeatureId)))
  const missingSourceStatus = operational.filter((object) => (
    normalizeSourceStatus(object.sourceStatus) === 'unknown'
  ))
  const invalidVocabulary = operational.filter((object) => (
    !canonicalVocabularyValue('assetType', object.canonicalAssetType ?? object.assetType)
      || !canonicalVocabularyValue('category', object.canonicalCategory ?? object.category)
      || !canonicalVocabularyValue('networkFamily', object.networkFamily)
  ))
  const missingSite = operational.filter((object) => !String(
    object.siteId ?? datasetVersion.branchId ?? '',
  ).trim())
  const identityValues = stable.map((object) => stableIdentityValue(object, featureById.get(object.sourceFeatureId)))
    .filter(Boolean)
  const duplicateIds = duplicateValues(identityValues)
  const conflictCount = operational.filter((object) => (
    ['conflict', 'identity_conflict'].includes(
      String(object.identityResolutionStatus ?? object.identityStatus ?? '').toLowerCase(),
    )
  )).length
  const reasons = []
  if (stable.length < operational.length) reasons.push('missing_stable_asset_id')
  if (missingName.length || missingSourceStatus.length) reasons.push('missing_required_metadata')
  if (invalidVocabulary.length) reasons.push('invalid_vocabulary_value')
  if (missingSite.length) reasons.push('unknown_site')
  if (duplicateIds.length) reasons.push('duplicate_asset_id')
  if (conflictCount) reasons.push('identity_conflict')
  const warningCountValue = operational.length === 0
    ? 0
    : operational.length - stable.length
  return {
    operationalAssetCount: operational.length,
    blockingIssueCount: operational.length - stable.length
      + missingName.length + missingSourceStatus.length
      + invalidVocabulary.length + missingSite.length
      + duplicateIds.length + conflictCount,
    warningCount: warningCountValue,
    reasons,
    coverage: {
      operationalAssetCount: operational.length,
      stableAssetIdCount: stable.length,
      stableAssetIdCoverage: operational.length ? stable.length / operational.length : 0,
      requiredMetadataCompleteCount: operational.length - missingName.length - missingSourceStatus.length,
      canonicalVocabularyCount: operational.length - invalidVocabulary.length,
      siteAssignedCount: operational.length - missingSite.length,
      duplicateStableAssetIdCount: duplicateIds.length,
      identityConflictCount: conflictCount,
      geometryBackedAssetCount: operational.filter((object) => (
        (geometriesByFeature.get(object.sourceFeatureId) ?? []).some(({ valid }) => valid !== false)
      )).length,
    },
  }
}

function evaluateTopologyStatus({ topologyReadiness, topologyGraph, classifiedObjects }) {
  if (!topologyReadiness && !topologyGraph) {
    return {
      status: 'not_applicable',
      blockingIssueCount: 0,
      warningCount: 0,
      coverage: {
        confirmedNodeCount: 0,
        confirmedEdgeCount: 0,
        candidateCount: 0,
      },
      reasons: [],
    }
  }
  const status = topologyReadiness?.topologyReadiness
    ?? topologyReadiness?.status
    ?? (topologyGraph?.edges?.length ? 'not_ready' : 'not_ready')
  const graph = topologyGraph ?? {}
  return {
    status: status === 'ready' ? 'ready' : status === 'not_applicable' ? 'not_applicable' : 'not_ready',
    blockingIssueCount: Number(topologyReadiness?.blockingIssueCount ?? 0),
    warningCount: Number(topologyReadiness?.warningCount ?? 0),
    coverage: {
      confirmedNodeCount: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
      confirmedEdgeCount: Array.isArray(graph.edges) ? graph.edges.length : 0,
      candidateCount: Array.isArray(topologyReadiness?.candidates)
        ? topologyReadiness.candidates.length
        : null,
      eligibleNodeCount: classifiedObjects.filter(({ objectRole }) => objectRole === 'device_node').length,
      eligiblePathCount: classifiedObjects.filter(({ objectRole }) => objectRole === 'cable_path').length,
    },
    reasons: topologyReadiness?.blockingReasons ?? [],
  }
}

function buildCoverageReport({
  parserCoverage,
  sourceFeatures,
  sourceGeometries,
  sourceOverlays,
  classifiedObjects,
}) {
  const sourceElementCounts = {
    ...(parserCoverage.sourceElementCounts ?? {}),
    Placemark: sourceFeatures.filter(({ sourceElementType }) => sourceElementType === 'Placemark').length,
    GroundOverlay: sourceOverlays.length,
  }
  const parsedElementCounts = {
    ...(parserCoverage.parsedElementCounts ?? {}),
    Placemark: Number(parserCoverage.placemarkCount ?? sourceElementCounts.Placemark ?? 0),
    GroundOverlay: Number(parserCoverage.parsedOverlayCount ?? parserCoverage.overlayCount ?? sourceElementCounts.GroundOverlay ?? 0),
  }
  const unsupportedElementCounts = {
    ...(parserCoverage.unsupportedElementCounts ?? {}),
    ...(parserCoverage.unsupportedCountByType ?? {}),
  }
  const renderableGeometryCounts = {
    ...(parserCoverage.renderableGeometryCounts ?? {}),
    ...countBy(sourceGeometries.filter((geometry) => (
      geometry.valid !== false && isRenderableSourceGeometry(geometry)
    )), 'geometryType'),
  }
  const invalidGeometryCounts = {
    ...(parserCoverage.invalidGeometryCounts ?? {}),
    ...countBy(sourceGeometries.filter(({ valid }) => valid === false), 'geometryType'),
  }
  const parsedPlacemarkCount = Number(parsedElementCounts.Placemark ?? 0)
  const canonicalPlacemarkCount = sourceElementCounts.Placemark
  const parsedOverlayCount = Number(parsedElementCounts.GroundOverlay ?? 0)
  const canonicalOverlayCount = sourceElementCounts.GroundOverlay
  return {
    ...structuredClone(parserCoverage),
    sourceElementCounts,
    parsedElementCounts,
    unsupportedElementCounts,
    renderableGeometryCounts,
    invalidGeometryCounts,
    overlayCounts: {
      total: canonicalOverlayCount,
      resolved: sourceOverlays.filter(({ resourceResolutionStatus, valid }) => (
        valid !== false && resourceResolutionStatus === 'resolved'
      )).length,
      missing: sourceOverlays.filter(({ resourceResolutionStatus }) => resourceResolutionStatus === 'missing').length,
      externalBlocked: sourceOverlays.filter(({ resourceResolutionStatus }) => resourceResolutionStatus === 'external').length,
    },
    sourceFeatureCount: sourceFeatures.length,
    sourceGeometryCount: sourceGeometries.length,
    classifiedObjectCount: classifiedObjects.length,
    invalidGeometryCount: sourceGeometries.filter(({ valid }) => valid === false).length,
    nonRequiredUnrenderableGeometryCount: sourceGeometries.filter((geometry) => (
      geometry.requiredForMap === false && (geometry.valid === false || !isRenderableSourceGeometry(geometry))
    )).length,
    sourceElementCountReconciled: parsedPlacemarkCount === canonicalPlacemarkCount
      && parsedOverlayCount === canonicalOverlayCount,
    parserCoverageReconciled: Number(parserCoverage.unpreservedPlacemarkCount ?? 0) === 0
      && Number(parserCoverage.unpreservedOverlayCount ?? 0) === 0,
  }
}

function normalizeIssueDimension(value, issueCode, scope) {
  if (['parse', 'map', 'inventory', 'topology'].includes(value)) return value
  const code = String(issueCode).toLowerCase()
  if (/overlay|coordinate|geometry|site|visual|map/.test(code)) return 'map'
  if (/identity|asset|metadata|vocabulary|classification|category/.test(code)) return 'inventory'
  if (/relation|topology|candidate|graph/.test(code)) return 'topology'
  if (scope === 'asset' || scope === 'metadata') return 'inventory'
  return 'parse'
}

function normalizeScope(scope) {
  const value = String(scope ?? '').trim()
  if (['file', 'structure', 'asset', 'geometry', 'overlay', 'classification', 'relation', 'version_integrity', 'processing'].includes(value)) return value
  if (value === 'identity' || value === 'metadata') return 'asset'
  if (value === 'resource') return 'overlay'
  return 'processing'
}

function normalizeReadinessDimension(value, issueCode, scope) {
  return normalizeIssueDimension(value, issueCode, scope)
}

function normalizeBlockingProfiles(input, issue, dimension) {
  if (Array.isArray(input)) {
    return [...new Set(input.filter((profile) => PUBLICATION_PROFILES.includes(profile)))]
  }
  if (issue.canPublish === false || issue.canActivate === false) {
    if (dimension === 'inventory' || dimension === 'topology') return ['operational_topology']
    return [...PUBLICATION_PROFILES]
  }
  if (issue.severity === 'error') {
    if (dimension === 'inventory' || dimension === 'topology') return ['operational_topology']
    return [...PUBLICATION_PROFILES]
  }
  return []
}

function reasonsFor(issues, dimension, profile) {
  return issues
    .filter((issue) => issue.readinessDimension === dimension
      && issue.blockingProfiles.includes(profile))
    .map((issue) => issue.issueCode)
}

function countBlocking(issues, dimension, profiles) {
  return issues.filter((issue) => issue.readinessDimension === dimension
    && profiles.some((profile) => issue.blockingProfiles.includes(profile))).length
}

function warningCount(issues, dimension) {
  return issues.filter((issue) => issue.readinessDimension === dimension
    && issue.severity === 'warning').length
}

function hasStableIdentity(object, feature) {
  if (object.stableAssetId) return true
  if (['stable_explicit', 'stable_registry'].includes(object.identityResolutionStatus)) return true
  if (object.identityStatus === 'stable' && !object.onboardingIdentity) return true
  if (!object.identityStatus && object.assetId && !object.properties?.sourceIdentityMapping) {
    return Boolean(feature?.sourceKmlId || object.sourceFeatureId)
  }
  return false
}

function stableIdentityValue(object, feature) {
  if (object.stableAssetId) return object.stableAssetId
  if (['stable_explicit', 'stable_registry'].includes(object.identityResolutionStatus)) {
    return object.assetId ?? object.canonicalAssetId
  }
  if (object.identityStatus === 'stable' && !object.onboardingIdentity) return object.assetId
  if (!object.identityStatus && object.assetId && !object.properties?.sourceIdentityMapping) {
    return object.assetId ?? feature?.sourceKmlId
  }
  return null
}

function readAssetName(object, feature) {
  const value = object.assetName ?? object.name ?? feature?.sourceName
  return String(value ?? '').trim()
}

function normalizeSourceStatus(value) {
  return canonicalVocabularyValue('sourceStatus', value) ?? 'unknown'
}

function isRenderableSourceGeometry(geometry) {
  if (!geometry || geometry.valid === false) return false
  const coordinates = geometry.coordinates
  if (geometry.geometryType === 'Point') return isPosition(coordinates)
  if (geometry.geometryType === 'LineString') {
    return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(isPosition)
  }
  if (geometry.geometryType === 'Polygon') {
    return Array.isArray(coordinates) && coordinates.length > 0
      && coordinates.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition))
  }
  return geometry.geometryType === 'MultiGeometry'
}

function isPosition(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
    && Number(value[0]) >= -180
    && Number(value[0]) <= 180
    && Number(value[1]) >= -90
    && Number(value[1]) <= 90
}

function defaultRecommendedAction(issueCode) {
  if (issueCode === 'missing_stable_asset_id') return 'Tetapkan Asset ID resmi melalui identity review.'
  if (issueCode === 'duplicate_asset_id') return 'Resolusi duplicate Asset ID sebelum publikasi topology.'
  if (issueCode === 'unknown_site') return 'Tetapkan site canonical dari konfigurasi pilot.'
  if (issueCode === 'required_overlay_unresolved') return 'Perbaiki resource GroundOverlay pada source package.'
  return 'Periksa evidence sumber dan ulangi validasi dataset version.'
}

function uniqueReasons(values) {
  return [...new Set(values.filter(Boolean))].sort()
}

function duplicateValues(values) {
  const counts = new Map()
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value)
}

function groupBy(values, key) {
  return values.reduce((result, value) => {
    const group = result.get(value[key]) ?? []
    group.push(value)
    result.set(value[key], group)
    return result
  }, new Map())
}

function countBy(values, key) {
  return values.reduce((result, value) => {
    const valueKey = value?.[key] ?? 'unknown'
    result[valueKey] = (result[valueKey] ?? 0) + 1
    return result
  }, {})
}

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null))
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value) {
  if (value === undefined) return '"__undefined__"'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`
}
