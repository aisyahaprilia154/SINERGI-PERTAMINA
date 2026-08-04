import { createHash } from 'node:crypto'
import { AppError } from '../errors.js'

const EARTH_RADIUS_METERS = 6371008.8

export const TOPOLOGY_RULE_SET_VERSION = 'semantic-relation-engine/1.0.0'

export const DEFAULT_RELATION_ENGINE_CONFIG = Object.freeze({
  searchRadiusMeters: 6,
  inlineSearchRadiusMeters: 2,
  intersectionToleranceMeters: 1,
  minimumInlineEndpointDistanceMeters: 5,
  endpointContinuationAngleDegrees: 30,
  distanceSigmaMeters: 2.5,
  acceptanceThreshold: 0.55,
  ambiguityScoreMargin: 0.12,
  autoConfirmSpatialInference: false,
  autoConfirmExplicitMetadata: true,
  requiredHeldOutPrecision: 0.99,
  requiredPathAccuracy: 0.95,
  heldOutPrecision: null,
  pathAccuracy: null,
})

const SCORE_WEIGHTS = Object.freeze({
  distance: 0.35,
  semanticCompatibility: 0.25,
  sourceContext: 0.1,
  endpointRole: 0.1,
  styleConsistency: 0.05,
  angle: 0.1,
  graphConsistency: 0.05,
})

/**
 * Generates reviewable relation candidates and a confirmed-only operational graph.
 * Source geometries are cloned/read only and are never snapped, split, or rewritten.
 */
export function generateRelationArtifacts(topologyInputBundle, {
  config = {},
  previousCandidates = [],
  previousRelations = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const settings = normalizeConfig(config)
  const bundle = normalizeAndValidateBundle(topologyInputBundle)
  const eligibilityIssues = []
  const lineworkIssues = []
  const nodes = prepareNodes(bundle, eligibilityIssues)
  const paths = preparePaths(bundle, eligibilityIssues, lineworkIssues)
  detectDuplicateAndOverlappingLinework(paths, lineworkIssues, bundle, settings)
  const spatialIndexes = buildSpatialIndexes(nodes, paths, settings)

  const rawCandidates = [
    ...generateEndpointDeviceCandidates(paths, spatialIndexes, settings),
    ...generateInlineDeviceCandidates(nodes, spatialIndexes, settings),
    ...generateEndpointEndpointCandidates(spatialIndexes, settings),
    ...generateIntersectionCandidates(spatialIndexes, settings),
    ...generateLineLabelConnectionCandidates(nodes, paths),
    ...generateLineLabelAttachmentCandidates(nodes, paths, settings),
    ...generateExplicitCandidates(bundle, nodes, paths, eligibilityIssues),
  ]
  const candidates = scoreAndProposeCandidates(
    rawCandidates,
    settings,
    generatedAt,
    bundle.datasetVersion.id,
  )
  candidates.forEach((candidate) => {
    candidate.datasetVersionId = bundle.datasetVersion.id
  })
  reconcilePreviousDecisions(candidates, previousCandidates)
  applyCapacityConstraints(candidates, nodes, settings, eligibilityIssues)

  const confirmedRelations = buildConfirmedRelations({
    bundle,
    candidates,
    previousRelations,
    settings,
    generatedAt,
  })
  const graph = buildConfirmedGraph({
    bundle,
    nodes,
    paths,
    confirmedRelations,
  })
  const validation = validateConfirmedGraph({
    bundle,
    nodes,
    paths,
    candidates,
    confirmedRelations,
    graph,
    lineworkIssues,
  })
  const unresolved = buildUnresolvedEndpoints(paths, candidates)
  const summary = buildSummary({
    candidates,
    confirmedRelations,
    graph,
    unresolved,
    validation,
  })
  const readiness = evaluateTopologyReadiness({
    bundle,
    candidates,
    confirmedRelations,
    validation,
    settings,
    unresolved,
  })

  return {
    schemaVersion: '1.0.0',
    datasetVersionId: bundle.datasetVersion.id,
    siteId: bundle.site,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    semanticRuleSetVersion: bundle.semanticRuleSetVersion,
    generatedAt,
    config: settings,
    candidates,
    confirmedRelations,
    graph,
    eligibilityIssues,
    lineworkIssues,
    validation,
    unresolved,
    summary,
    readiness,
  }
}

/**
 * Rebuilds review-derived artifacts without running candidate discovery.
 * Candidate review changes state on an already generated candidate collection;
 * it should not rescan every spatial pair just to publish the resulting graph.
 */
export function rebuildConfirmedRelationArtifacts(topologyInputBundle, {
  config = {},
  candidates = [],
  previousRelations = [],
  previousGraph = {},
  affectedAssetIds = [],
  eligibilityIssues = [],
  lineworkIssues = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const settings = normalizeConfig(config)
  const bundle = normalizeAndValidateBundle(topologyInputBundle)
  const computedEligibilityIssues = []
  const computedLineworkIssues = []
  const nodes = prepareNodes(bundle, computedEligibilityIssues)
  const paths = preparePaths(bundle, computedEligibilityIssues, computedLineworkIssues)
  detectDuplicateAndOverlappingLinework(paths, computedLineworkIssues, bundle, settings)
  const nextEligibilityIssues = mergeIssues(
    eligibilityIssues,
    computedEligibilityIssues,
  )
  const nextLineworkIssues = mergeIssues(
    lineworkIssues,
    computedLineworkIssues,
  )
  const normalizedCandidates = structuredClone(asArray(candidates))
  const confirmedRelations = buildConfirmedRelations({
    bundle,
    candidates: normalizedCandidates,
    previousRelations,
    settings,
    generatedAt,
  })
  const graph = rebuildConfirmedGraphIncrementally({
    bundle,
    nodes,
    paths,
    confirmedRelations,
    previousGraph,
    affectedAssetIds,
  })
  const validation = validateConfirmedGraph({
    bundle,
    nodes,
    paths,
    candidates: normalizedCandidates,
    confirmedRelations,
    graph,
    lineworkIssues: nextLineworkIssues,
  })
  const unresolved = buildUnresolvedEndpoints(paths, normalizedCandidates)
  const summary = buildSummary({
    candidates: normalizedCandidates,
    confirmedRelations,
    graph,
    unresolved,
    validation,
  })
  const readiness = evaluateTopologyReadiness({
    bundle,
    candidates: normalizedCandidates,
    confirmedRelations,
    validation,
    settings,
    unresolved,
  })

  return {
    schemaVersion: '1.0.0',
    datasetVersionId: bundle.datasetVersion.id,
    siteId: bundle.site,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    semanticRuleSetVersion: bundle.semanticRuleSetVersion,
    generatedAt,
    config: settings,
    candidates: normalizedCandidates,
    confirmedRelations,
    graph,
    eligibilityIssues: nextEligibilityIssues,
    lineworkIssues: nextLineworkIssues,
    validation,
    unresolved,
    summary,
    readiness,
  }
}

/**
 * Creates only the explicit candidate needed by a manual device relation.
 * This keeps a manual review action off the spatial candidate discovery path.
 */
export function createManualExplicitCandidate(topologyInputBundle, {
  relation,
  config = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const settings = normalizeConfig(config)
  const bundle = normalizeAndValidateBundle({
    ...topologyInputBundle,
    explicitRelations: [structuredClone(relation)],
  })
  const eligibilityIssues = []
  const lineworkIssues = []
  const nodes = prepareNodes(bundle, eligibilityIssues)
  const paths = preparePaths(bundle, eligibilityIssues, lineworkIssues)
  const rawCandidates = generateExplicitCandidates(bundle, nodes, paths, eligibilityIssues)
  const candidates = scoreAndProposeCandidates(
    rawCandidates,
    settings,
    generatedAt,
    bundle.datasetVersion.id,
  )
  candidates.forEach((candidate) => {
    candidate.datasetVersionId = bundle.datasetVersion.id
  })
  return {
    candidate: candidates[0] ?? null,
    eligibilityIssues: mergeIssues(eligibilityIssues, lineworkIssues),
  }
}

/**
 * Rebuilds only the device components touched by a review mutation and merges
 * them with the previous graph. The candidate collection is intentionally not
 * regenerated here; callers pass the already-reviewed candidates.
 */
export function rebuildConfirmedGraphIncrementally({
  bundle,
  nodes,
  paths,
  confirmedRelations,
  previousGraph = {},
  affectedAssetIds = [],
} = {}) {
  const allNodes = asArray(nodes)
  const previousNodes = asArray(previousGraph.nodes)
  const currentNodeIds = new Set(allNodes.map(({ id }) => id))
  const previousNodeIds = new Set(previousNodes.map(({ id }) => id))
  const graphShapeChanged = currentNodeIds.size !== previousNodeIds.size
    || [...currentNodeIds].some((id) => !previousNodeIds.has(id))
  if (!previousNodes.length || graphShapeChanged) {
    return buildConfirmedGraph({ bundle, nodes: allNodes, paths, confirmedRelations })
  }

  const scopeAssets = incrementalScopeAssets({
    previousGraph,
    confirmedRelations,
    affectedAssetIds,
  })
  if (!scopeAssets.size) return structuredClone(previousGraph)

  const affectedNodeIds = new Set([...scopeAssets].filter((id) => currentNodeIds.has(id)))
  if (!affectedNodeIds.size || affectedNodeIds.size === currentNodeIds.size) {
    return buildConfirmedGraph({ bundle, nodes: allNodes, paths, confirmedRelations })
  }

  const scopedRelations = confirmedRelations.filter((relation) => (
    scopeAssets.has(relation.sourceAssetId)
      && scopeAssets.has(relation.targetAssetId)
  ))
  const scopedPaths = paths.filter((path) => scopeAssets.has(path.id))
  const rebuilt = buildConfirmedGraph({
    bundle,
    nodes: allNodes.filter(({ id }) => affectedNodeIds.has(id)),
    paths: scopedPaths,
    confirmedRelations: scopedRelations,
  })
  const retainedNodes = previousNodes.filter(({ id }) => !affectedNodeIds.has(id))
  const retainedEdges = asArray(previousGraph.edges).filter((edge) => (
    !affectedNodeIds.has(edge.sourceAssetId)
      && !affectedNodeIds.has(edge.targetAssetId)
  ))
  const edges = [...retainedEdges, ...rebuilt.edges]
    .sort((left, right) => left.id.localeCompare(right.id))
  const graphNodes = [...retainedNodes, ...rebuilt.nodes]
    .sort(compareId)
  return finalizeConfirmedGraph({
    datasetVersionId: bundle.datasetVersion.id,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    nodes: graphNodes,
    edges,
  })
}

function incrementalScopeAssets({
  previousGraph,
  confirmedRelations,
  affectedAssetIds,
}) {
  const scope = new Set(asArray(affectedAssetIds).filter(Boolean).map(String))
  const previousEdges = asArray(previousGraph.edges)
  previousEdges.forEach((edge) => {
    if (!edgeTouchesAnyAsset(edge, scope)) return
    scope.add(edge.sourceAssetId)
    scope.add(edge.targetAssetId)
  })
  asArray(previousGraph.components).forEach((component) => {
    if (!asArray(component.nodeIds).some((nodeId) => scope.has(nodeId))) return
    asArray(component.nodeIds).forEach((nodeId) => scope.add(nodeId))
  })

  let changed = true
  while (changed) {
    changed = false
    confirmedRelations.forEach((relation) => {
      if (!scope.has(relation.sourceAssetId) && !scope.has(relation.targetAssetId)) return
      const beforeSize = scope.size
      scope.add(relation.sourceAssetId)
      scope.add(relation.targetAssetId)
      changed ||= scope.size !== beforeSize
    })
  }
  return scope
}

function edgeTouchesAnyAsset(edge, assets) {
  return [
    edge.sourceAssetId,
    edge.targetAssetId,
    edge.pathAssetId,
    ...asArray(edge.pathAssetIds),
    ...asArray(edge.sourceGeometryIds),
  ].filter(Boolean).some((value) => assets.has(String(value)))
}

function finalizeConfirmedGraph({
  datasetVersionId,
  topologyRuleSetVersion,
  nodes,
  edges,
}) {
  const degreeByNode = Object.fromEntries(nodes.map((node) => [
    node.id,
    edges.filter((edge) => (
      edge.sourceAssetId === node.id || edge.targetAssetId === node.id
    )).length,
  ]))
  return {
    datasetVersionId,
    topologyRuleSetVersion,
    nodes,
    edges,
    components: connectedComponents(nodes, edges),
    degreeByNode,
    isolatedNodeIds: Object.entries(degreeByNode)
      .filter(([, degree]) => degree === 0)
      .map(([nodeId]) => nodeId)
      .sort(),
  }
}

function mergeIssues(...groups) {
  const seen = new Set()
  return groups.flatMap((group) => asArray(group)).filter((issue) => {
    const key = issue?.issueId ?? stableStringify(issue)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeTopologySummary(
  summary = {},
  graph = {},
  confirmedRelations = [],
) {
  const confirmed = asArray(confirmedRelations).filter(({ verificationStatus }) => (
    verificationStatus === 'confirmed'
  ))
  const kindCounts = confirmed.reduce((counts, relation) => {
    const kind = relation.relationKind ?? persistedRelationKind(relation)
    counts[kind] = (counts[kind] ?? 0) + 1
    return counts
  }, {})
  const deviceEdgeCount = asArray(graph.edges).length
  return {
    ...structuredClone(summary ?? {}),
    confirmedEdgeCount: deviceEdgeCount,
    confirmedDeviceEdgeCount: deviceEdgeCount,
    confirmedRelationCount: confirmed.length,
    confirmedPathAttachmentCount: kindCounts.path_attachment ?? 0,
    confirmedPathContinuationCount: kindCounts.path_continuation ?? 0,
  }
}

export function normalizeAndValidateBundle(input) {
  if (!input || typeof input !== 'object') {
    throw invalidBundle('TopologyInputBundle wajib berupa object.')
  }
  const bundle = structuredClone(input)
  const datasetVersionId = readString(bundle.datasetVersion?.id)
  const site = readString(bundle.site)
  const semanticRuleSetVersion = readString(bundle.semanticRuleSetVersion)
  const suppliedTopologyVersion = readString(bundle.topologyRuleSetVersion)
  if (!datasetVersionId) throw invalidBundle('Dataset version tidak tersedia.')
  if (!site) throw invalidBundle('Site TopologyInputBundle tidak tersedia.')
  if (!semanticRuleSetVersion) {
    throw invalidBundle('Semantic rule-set version tidak tersedia.')
  }
  if (suppliedTopologyVersion && suppliedTopologyVersion !== TOPOLOGY_RULE_SET_VERSION) {
    throw invalidBundle('Topology rule-set version input tidak kompatibel.', {
      suppliedTopologyVersion,
      expectedTopologyVersion: TOPOLOGY_RULE_SET_VERSION,
    })
  }

  const geometries = asArray(bundle.geometries)
  const geometryById = new Map()
  geometries.forEach((geometry) => {
    if (!geometry?.geometryId || geometry.datasetVersionId !== datasetVersionId) {
      throw invalidBundle('Geometry mencampur atau tidak memiliki dataset version.', {
        geometryId: geometry?.geometryId,
      })
    }
    if (geometryById.has(geometry.geometryId)) {
      throw invalidBundle('Geometry reference duplikat.', { geometryId: geometry.geometryId })
    }
    geometryById.set(geometry.geometryId, geometry)
  })

  for (const [kind, records] of [
    ['classified_node', asArray(bundle.classifiedNodes)],
    ['classified_path', asArray(bundle.classifiedPaths)],
  ]) {
    records.forEach((record) => {
      if (!readString(record.assetId, record.onboardingIdentity)) {
        throw invalidBundle(`${kind} tidak memiliki stable/candidate identity.`)
      }
      if (record.siteId !== site) {
        throw invalidBundle(`${kind} mencampur site.`, {
          sourceFeatureId: record.sourceFeatureId,
          siteId: record.siteId,
          expectedSiteId: site,
        })
      }
      if (!record.networkFamily || record.networkFamily === 'unknown') {
        throw invalidBundle(`${kind} memiliki network family yang tidak eligible.`, {
          sourceFeatureId: record.sourceFeatureId,
        })
      }
      asArray(record.geometryIds).forEach((geometryId) => {
        const geometry = geometryById.get(geometryId)
        if (!geometry) {
          throw invalidBundle(`${kind} merujuk geometry yang tidak ditemukan.`, {
            sourceFeatureId: record.sourceFeatureId,
            geometryId,
          })
        }
        if (geometry.sourceFeatureId !== record.sourceFeatureId) {
          throw invalidBundle(`${kind} merujuk geometry milik feature lain.`, {
            sourceFeatureId: record.sourceFeatureId,
            geometryId,
          })
        }
      })
    })
  }

  asArray(bundle.explicitRelations).forEach((relation) => {
    if (relation.datasetVersionId !== datasetVersionId) {
      throw invalidBundle('Explicit relation mencampur dataset version.')
    }
  })

  validateIdentityAliases([
    ...asArray(bundle.classifiedNodes),
    ...asArray(bundle.classifiedPaths),
  ])

  return {
    ...bundle,
    datasetVersion: {
      ...bundle.datasetVersion,
      id: datasetVersionId,
    },
    site,
    semanticRuleSetVersion,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    classifiedNodes: asArray(bundle.classifiedNodes),
    classifiedPaths: asArray(bundle.classifiedPaths),
    geometries,
    explicitRelations: asArray(bundle.explicitRelations),
  }
}

function validateIdentityAliases(objects) {
  const aliasOwner = new Map()
  objects.forEach((object) => {
    const canonicalAssetId = readString(
      object.canonicalAssetId,
      object.assetId,
      object.onboardingIdentity,
    )
    if (!canonicalAssetId) {
      throw invalidBundle('Topology object tidak memiliki canonical asset identity.', {
        sourceFeatureId: object.sourceFeatureId,
      })
    }
    const aliases = [
      canonicalAssetId,
      object.assetId,
      object.stableAssetId,
      object.legacyAssetId,
      object.onboardingIdentity,
      object.sourceFeatureId,
      ...Object.values(object.identityAliases ?? {}).flat(),
    ].filter(Boolean)
    aliases.forEach((alias) => {
      const previous = aliasOwner.get(alias)
      if (previous && previous !== canonicalAssetId) {
        throw invalidBundle('Topology bundle memiliki alias identity duplikat.', {
          alias,
          previousCanonicalAssetId: previous,
          canonicalAssetId,
        })
      }
      aliasOwner.set(alias, canonicalAssetId)
    })
  })
}

function prepareNodes(bundle, issues) {
  const geometryById = new Map(bundle.geometries.map((geometry) => [geometry.geometryId, geometry]))
  return bundle.classifiedNodes.flatMap((object) => {
    const identity = objectIdentity(object)
    const geometries = asArray(object.geometryIds)
      .map((id) => geometryById.get(id))
      .filter(Boolean)
    const point = geometries.find((geometry) => (
      geometry.valid === true
      && geometry.geometryType === 'Point'
      && validCoordinate(geometry.coordinates)
    ))
    if (!point) {
      issues.push(topologyIssue(bundle, {
        severity: 'error',
        issueCode: 'node_geometry_ineligible',
        scope: 'eligibility',
        message: `Node ${identity} tidak memiliki Point geometry valid.`,
        entityReference: object.sourceFeatureId,
        readinessImpact: 'blocking',
      }))
      return []
    }
    return [{
      id: identity,
      canonicalAssetId: identity,
      assetId: object.stableAssetId ?? object.assetId ?? null,
      legacyAssetId: object.legacyAssetId ?? null,
      onboardingIdentity: object.onboardingIdentity,
      identityStatus: object.identityStatus ?? (object.assetId ? 'stable' : 'onboarding'),
      identityAliases: structuredClone(object.identityAliases ?? {}),
      sourceFeatureId: object.sourceFeatureId,
      siteId: object.siteId,
      sourceName: object.sourceName ?? null,
      sourceFolderPath: object.sourceFolderPath ?? null,
      networkFamily: object.networkFamily,
      objectRole: 'device_node',
      assetType: object.assetType ?? 'unknown',
      category: object.category ?? 'unknown',
      coordinate: cloneCoordinate(point.coordinates),
      geometryId: point.geometryId,
      classificationEvidence: structuredClone(object.classificationEvidence ?? []),
      sourceContext: evidenceContext(object.classificationEvidence),
    }]
  }).sort(compareId)
}

function preparePaths(bundle, issues, lineworkIssues) {
  const geometryById = new Map(bundle.geometries.map((geometry) => [geometry.geometryId, geometry]))
  return bundle.classifiedPaths.flatMap((object) => {
    const identity = objectIdentity(object)
    const validLines = asArray(object.geometryIds)
      .map((id) => geometryById.get(id))
      .filter((geometry) => (
        geometry?.valid === true
        && geometry.geometryType === 'LineString'
        && validLineCoordinates(geometry.coordinates)
      ))
    if (!validLines.length) {
      issues.push(topologyIssue(bundle, {
        severity: 'error',
        issueCode: 'path_geometry_ineligible',
        scope: 'eligibility',
        message: `Path ${identity} tidak memiliki LineString geometry valid.`,
        entityReference: object.sourceFeatureId,
        readinessImpact: 'blocking',
      }))
      return []
    }
    return validLines.flatMap((geometry) => {
      const coordinates = geometry.coordinates.map(cloneCoordinate)
      const segmentLengths = coordinates.slice(1).map((coordinate, index) => (
        geographicDistanceMeters(coordinates[index], coordinate)
      ))
      const cumulativeLengths = [0]
      segmentLengths.forEach((length) => {
        cumulativeLengths.push(cumulativeLengths.at(-1) + length)
      })
      const totalLengthMeters = cumulativeLengths.at(-1)
      if (totalLengthMeters <= Number.EPSILON) {
        lineworkIssues.push(topologyIssue(bundle, {
          severity: 'error',
          issueCode: 'zero_length_linework',
          scope: 'linework',
          message: `Geometry ${geometry.geometryId} memiliki panjang nol.`,
          entityReference: geometry.geometryId,
          readinessImpact: 'blocking',
        }))
        return []
      }
      return [{
        id: identity,
        canonicalAssetId: identity,
        assetId: object.stableAssetId ?? object.assetId ?? null,
        legacyAssetId: object.legacyAssetId ?? null,
        onboardingIdentity: object.onboardingIdentity,
        identityStatus: object.identityStatus ?? (object.assetId ? 'stable' : 'onboarding'),
        identityAliases: structuredClone(object.identityAliases ?? {}),
        sourceFeatureId: object.sourceFeatureId,
        siteId: object.siteId,
        sourceName: object.sourceName ?? null,
        sourceFolderPath: object.sourceFolderPath ?? null,
        networkFamily: object.networkFamily,
        objectRole: 'cable_path',
        assetType: object.assetType ?? 'unknown',
        category: object.category ?? 'unknown',
        geometryId: geometry.geometryId,
        geometryFingerprint: geometry.geometryFingerprint,
        coordinates,
        segmentLengths,
        cumulativeLengths,
        totalLengthMeters,
        classificationEvidence: structuredClone(object.classificationEvidence ?? []),
        sourceContext: evidenceContext(object.classificationEvidence),
      }]
    })
  }).sort((left, right) => (
    left.id.localeCompare(right.id) || left.geometryId.localeCompare(right.geometryId)
  ))
}

function detectDuplicateAndOverlappingLinework(paths, issues, bundle, settings) {
  const exact = new Map()
  paths.forEach((path) => {
    const forward = coordinateSequenceKey(path.coordinates)
    const reverse = coordinateSequenceKey([...path.coordinates].reverse())
    const key = forward < reverse ? forward : reverse
    const duplicate = exact.get(key)
    if (duplicate) {
      issues.push(topologyIssue(bundle, {
        severity: 'error',
        issueCode: 'duplicate_linework',
        scope: 'linework',
        message: `Geometry ${path.geometryId} identik dengan ${duplicate.geometryId}.`,
        entityReference: path.geometryId,
        readinessImpact: 'blocking',
      }))
      path.duplicateOfGeometryId = duplicate.geometryId
    } else {
      exact.set(key, path)
    }
  })

  buildSegmentIndex(paths, settings).pathPairs().forEach(([left, right]) => {
    if (left.duplicateOfGeometryId || right.duplicateOfGeometryId) return
    if (left.siteId !== right.siteId || left.networkFamily !== right.networkFamily) return
    if (!linesHaveCollinearOverlap(left, right)) return
    issues.push(topologyIssue(bundle, {
      severity: 'warning',
      issueCode: 'overlapping_linework',
      scope: 'linework',
      message: `Geometry ${left.geometryId} dan ${right.geometryId} overlap tanpa digabung.`,
      entityReference: `${left.geometryId}|${right.geometryId}`,
      readinessImpact: 'warning',
    }))
    left.overlaps = [...(left.overlaps ?? []), right.geometryId]
    right.overlaps = [...(right.overlaps ?? []), left.geometryId]
  })
}

function generateEndpointDeviceCandidates(paths, spatialIndexes, settings) {
  const candidates = []
  paths.filter((path) => !path.duplicateOfGeometryId).forEach((path) => {
    lineEndpoints(path).forEach((endpoint) => {
      spatialIndexes.nodes.queryPoint(
        endpoint.coordinate,
        settings.searchRadiusMeters,
      ).forEach((node) => {
        const compatibility = compatiblePathNode(path, node)
        if (!compatibility.compatible) return
        const distanceMeters = geographicDistanceMeters(endpoint.coordinate, node.coordinate)
        if (distanceMeters > settings.searchRadiusMeters) return
        candidates.push(baseCandidate({
          candidateType: 'endpoint_device',
          sourceEndpointId: endpoint.id,
          sourcePath: path,
          targetAssetId: node.id,
          targetNode: node,
          distanceMeters,
          sourceCoordinate: endpoint.coordinate,
          targetCoordinate: node.coordinate,
          measureMeters: endpoint.measureMeters,
          semanticCompatibility: compatibility.score,
          endpointRole: endpointRoleScore(node, false),
          sourceContext: contextScore(path.sourceContext, node.sourceContext),
          styleConsistency: styleConsistencyScore(path, node),
          angleScore: 1,
          graphConsistency: 1,
          evidence: [{
            source: 'spatial',
            ruleId: 'endpoint.within-search-radius',
            observedValue: distanceMeters,
            normalizedValue: `${distanceMeters.toFixed(3)}m`,
            weight: SCORE_WEIGHTS.distance,
            explanation: `Endpoint berada dalam radius ${settings.searchRadiusMeters} meter.`,
          }, {
            source: 'semantic',
            ruleId: compatibility.ruleId,
            observedValue: `${path.networkFamily}:${node.assetType}`,
            normalizedValue: compatibility.compatible,
            weight: SCORE_WEIGHTS.semanticCompatibility,
            explanation: compatibility.explanation,
          }],
        }))
      })
    })
  })
  return candidates
}

function generateInlineDeviceCandidates(nodes, spatialIndexes, settings) {
  const candidates = []
  nodes.filter(inlineNodeAllowed).forEach((node) => {
    spatialIndexes.segments.queryPoint(
      node.coordinate,
      settings.inlineSearchRadiusMeters,
    ).filter((path) => !path.duplicateOfGeometryId).forEach((path) => {
      const compatibility = compatiblePathNode(path, node)
      if (!compatibility.compatible) return
      const nearest = nearestPointOnLine(node.coordinate, path)
      if (nearest.distanceMeters > settings.inlineSearchRadiusMeters) return
      if (nearest.measureMeters <= settings.minimumInlineEndpointDistanceMeters
        || path.totalLengthMeters - nearest.measureMeters
          <= settings.minimumInlineEndpointDistanceMeters) return
      candidates.push(baseCandidate({
        candidateType: 'inline_device',
        sourceEndpointId: `inline:${node.id}`,
        sourcePath: path,
        targetAssetId: node.id,
        targetNode: node,
        distanceMeters: nearest.distanceMeters,
        sourceCoordinate: nearest.projectedCoordinate,
        targetCoordinate: node.coordinate,
        measureMeters: nearest.measureMeters,
        semanticCompatibility: compatibility.score,
        endpointRole: endpointRoleScore(node, true),
        sourceContext: contextScore(path.sourceContext, node.sourceContext),
        styleConsistency: styleConsistencyScore(path, node),
        angleScore: 1,
        graphConsistency: 1,
        evidence: [{
          source: 'spatial',
          ruleId: 'inline.closest-point-derived-anchor',
          observedValue: nearest.distanceMeters,
          normalizedValue: `${nearest.distanceMeters.toFixed(3)}m`,
          weight: SCORE_WEIGHTS.distance,
          explanation: 'Closest point dan line measure dibuat pada derived copy.',
        }, {
          source: 'semantic',
          ruleId: 'inline.approved-device-type',
          observedValue: node.assetType,
          normalizedValue: true,
          weight: SCORE_WEIGHTS.endpointRole,
          explanation: 'Device type diizinkan menjadi anchor di tengah jalur.',
        }],
      }))
    })
  })
  return candidates
}

function generateEndpointEndpointCandidates(spatialIndexes, settings) {
  const endpointRecords = spatialIndexes.endpointRecords
  const candidates = []
  const seenPairs = new Set()
  endpointRecords.forEach((left) => {
    spatialIndexes.endpoints.queryPoint(
      left.coordinate,
      settings.searchRadiusMeters,
    ).forEach((right) => {
      const pairKey = [left.id, right.id].sort().join('|')
      if (left.id === right.id || seenPairs.has(pairKey)) return
      seenPairs.add(pairKey)
      if (left.path.id === right.path.id
        || left.path.siteId !== right.path.siteId
        || left.path.networkFamily !== right.path.networkFamily) return
      const distanceMeters = geographicDistanceMeters(left.coordinate, right.coordinate)
      if (distanceMeters > settings.searchRadiusMeters) return
      if (hasCompatibleDeviceNearEndpoint(left, spatialIndexes.nodes, settings)
        || hasCompatibleDeviceNearEndpoint(right, spatialIndexes.nodes, settings)) return
      const continuationAngle = endpointContinuationAngle(left, right)
      const deviation = Math.abs(180 - continuationAngle)
      if (deviation > settings.endpointContinuationAngleDegrees) return
      const angleScore = Math.max(
        0,
        1 - deviation / settings.endpointContinuationAngleDegrees,
      )
      candidates.push(baseCandidate({
        candidateType: 'endpoint_endpoint',
        sourceEndpointId: left.id,
        sourcePath: left.path,
        targetAssetId: right.path.id,
        targetEndpointId: right.id,
        targetPath: right.path,
        distanceMeters,
        sourceCoordinate: left.coordinate,
        targetCoordinate: right.coordinate,
        measureMeters: left.measureMeters,
        semanticCompatibility: 1,
        endpointRole: 0.8,
        sourceContext: contextScore(left.path.sourceContext, right.path.sourceContext),
        styleConsistency: styleConsistencyScore(left.path, right.path),
        angleScore,
        graphConsistency: 1,
        evidence: [{
          source: 'angle',
          ruleId: 'endpoint.continuation-angle',
          observedValue: continuationAngle,
          normalizedValue: `${continuationAngle.toFixed(2)}deg`,
          weight: SCORE_WEIGHTS.angle,
          explanation: 'Arah segmen ujung mendekati kontinuitas dan tidak memiliki device penghubung.',
        }],
      }))
    })
  })
  return candidates
}

function generateIntersectionCandidates(spatialIndexes, settings) {
  const candidates = []
  spatialIndexes.segments.pathPairs().forEach(([left, right]) => {
      if (left.duplicateOfGeometryId) return
      if (right.duplicateOfGeometryId
        || left.id === right.id
        || left.siteId !== right.siteId
        || left.networkFamily !== right.networkFamily) return
      intersections(left, right).forEach((intersection, intersectionIndex) => {
        const junctions = spatialIndexes.nodes
          .queryPoint(intersection.coordinate, settings.intersectionToleranceMeters)
          .filter((node) => (
            inlineNodeAllowed(node)
            && compatiblePathNode(left, node).compatible
            && compatiblePathNode(right, node).compatible
          ))
          .map((node) => ({
            node,
            distanceMeters: geographicDistanceMeters(intersection.coordinate, node.coordinate),
          }))
          .filter(({ distanceMeters }) => distanceMeters <= settings.intersectionToleranceMeters)
          .sort((a, b) => a.distanceMeters - b.distanceMeters || compareId(a.node, b.node))
        if (!junctions.length) return
        const selected = junctions[0]
        candidates.push(baseCandidate({
          candidateType: 'intersection_with_junction',
          sourceEndpointId: `intersection:${left.geometryId}:${right.geometryId}:${intersectionIndex}`,
          sourcePath: left,
          targetAssetId: selected.node.id,
          targetNode: selected.node,
          targetPath: right,
          distanceMeters: selected.distanceMeters,
          sourceCoordinate: intersection.coordinate,
          targetCoordinate: selected.node.coordinate,
          measureMeters: intersection.leftMeasureMeters,
          targetMeasureMeters: intersection.rightMeasureMeters,
          semanticCompatibility: 1,
          endpointRole: 1,
          sourceContext: Math.max(
            contextScore(left.sourceContext, selected.node.sourceContext),
            contextScore(right.sourceContext, selected.node.sourceContext),
          ),
          styleConsistency: 1,
          angleScore: 1,
          graphConsistency: 1,
          evidence: [{
            source: 'junction',
            ruleId: 'intersection.classified-junction-required',
            observedValue: selected.node.assetType,
            normalizedValue: selected.node.id,
            weight: SCORE_WEIGHTS.semanticCompatibility,
            explanation: 'Persilangan hanya menjadi candidate karena ada classified junction.',
          }],
        }))
      })
  })
  return candidates
}

function generateLineLabelConnectionCandidates(nodes, paths) {
  const candidates = []
  paths.filter((path) => path.sourceName).forEach((path) => {
    const matchedNodes = lineLabelNodeSequence(path, nodes)
    for (let index = 0; index < matchedNodes.length - 1; index += 1) {
      const sourceNode = matchedNodes[index]
      const targetNode = matchedNodes[index + 1]
      if (sourceNode.id === targetNode.id || sourceNode.siteId !== targetNode.siteId) continue
      const sourceCompatibility = compatiblePathNode(path, sourceNode)
      const targetCompatibility = compatiblePathNode(path, targetNode)
      if (!sourceCompatibility.compatible || !targetCompatibility.compatible) continue
      const candidate = baseCandidate({
        candidateType: 'line_label_connection',
        sourceEndpointId: `line-label:${path.sourceFeatureId}:${index}:${sourceNode.id}:${targetNode.id}`,
        sourcePath: sourceNode,
        targetAssetId: targetNode.id,
        targetNode,
        distanceMeters: null,
        sourceCoordinate: sourceNode.coordinate,
        targetCoordinate: targetNode.coordinate,
        measureMeters: null,
        semanticCompatibility: Math.min(sourceCompatibility.score, targetCompatibility.score),
        endpointRole: 1,
        sourceContext: 1,
        styleConsistency: 1,
        angleScore: 1,
        graphConsistency: 1,
        evidence: [{
          source: 'line_label',
          ruleId: 'line.name.endpoint-sequence',
          observedValue: path.sourceName,
          normalizedValue: `${sourceNode.id}->${targetNode.id}`,
          weight: SCORE_WEIGHTS.semanticCompatibility,
          explanation: 'Urutan nama device pada garis dipakai sebagai evidence koneksi.',
        }, {
          source: 'spatial',
          ruleId: 'line.name.same-source-location',
          observedValue: path.sourceFolderPath ?? null,
          normalizedValue: sourceLocationKey(path.sourceFolderPath),
          weight: SCORE_WEIGHTS.sourceContext,
          explanation: 'Device dibatasi ke lokasi sumber garis yang sama.',
        }],
      })
      candidate.networkFamily = path.networkFamily
      candidate.sourceFeatureId = path.sourceFeatureId
      candidate.sourceGeometryIds = unique([
        path.geometryId,
        sourceNode.geometryId,
        targetNode.geometryId,
      ].filter(Boolean))
      candidate.lineSourcePathAssetId = path.id
      candidates.push(candidate)
    }
  })
  return candidates
}

function generateLineLabelAttachmentCandidates(nodes, paths, settings) {
  const candidates = []
  paths.filter((path) => path.sourceName).forEach((path) => {
    const matchedNodes = lineLabelNodeSequence(path, nodes)
    if (matchedNodes.length < 2) return
    const [startNode, endNode] = assignLineLabelEndpoints(path, matchedNodes)
    lineEndpoints(path).forEach((endpoint, index) => {
      const targetNode = index === 0 ? startNode : endNode
      const compatibility = compatiblePathNode(path, targetNode)
      if (!compatibility.compatible) return
      const distanceMeters = geographicDistanceMeters(endpoint.coordinate, targetNode.coordinate)
      if (distanceMeters > settings.searchRadiusMeters) return
      candidates.push(baseCandidate({
        candidateType: 'line_label_attachment',
        sourceEndpointId: endpoint.id,
        sourcePath: path,
        targetAssetId: targetNode.id,
        targetNode,
        distanceMeters,
        sourceCoordinate: endpoint.coordinate,
        targetCoordinate: targetNode.coordinate,
        measureMeters: endpoint.measureMeters,
        semanticCompatibility: compatibility.score,
        endpointRole: endpointRoleScore(targetNode, false),
        sourceContext: 1,
        styleConsistency: 1,
        angleScore: 1,
        graphConsistency: 1,
        evidence: [{
          source: 'line_label',
          ruleId: 'line.name.endpoint-attachment',
          observedValue: path.sourceName,
          normalizedValue: `${endpoint.role}:${targetNode.id}`,
          weight: SCORE_WEIGHTS.semanticCompatibility,
          explanation: 'Nama device pada garis menentukan device yang dipasang pada endpoint kabel.',
        }, {
          source: 'spatial',
          ruleId: 'line.endpoint.within-search-radius',
          observedValue: distanceMeters,
          normalizedValue: `${distanceMeters.toFixed(3)}m`,
          weight: SCORE_WEIGHTS.distance,
          explanation: `Endpoint garis berada dalam radius ${settings.searchRadiusMeters} meter dari device hasil pembacaan nama garis.`,
        }],
      }))
    })
  })
  return candidates
}

function assignLineLabelEndpoints(path, matchedNodes) {
  const first = matchedNodes[0]
  const last = matchedNodes.at(-1)
  const [start, end] = lineEndpoints(path)
  const forwardDistance = geographicDistanceMeters(start.coordinate, first.coordinate)
    + geographicDistanceMeters(end.coordinate, last.coordinate)
  const reverseDistance = geographicDistanceMeters(start.coordinate, last.coordinate)
    + geographicDistanceMeters(end.coordinate, first.coordinate)
  return forwardDistance <= reverseDistance ? [first, last] : [last, first]
}

function lineLabelNodeSequence(path, nodes) {
  const pathTokens = normalizeToken(path.sourceName).split(' ').filter(Boolean)
  if (!pathTokens.length) return []
  const localNodes = nodes.filter((node) => (
    node.siteId === path.siteId
      && sameSourceLocation(node.sourceFolderPath, path.sourceFolderPath)
  ))
  const matches = localNodes.flatMap((node) => {
    const occurrences = topologyLabelAliases(node.sourceName)
      .flatMap((alias) => tokenSequencePositions(pathTokens, alias)
        .map((position) => ({ node, position, length: alias.length })))
    if (!occurrences.length) return []
    occurrences.sort((left, right) => right.length - left.length || left.position - right.position)
    return [occurrences[0]]
  }).sort((left, right) => left.position - right.position || right.length - left.length)

  const accepted = []
  matches.forEach((match) => {
    const overlaps = accepted.some((previous) => (
      match.position < previous.position + previous.length
        && previous.position < match.position + match.length
    ))
    if (overlaps) return
    if (accepted.some(({ node }) => node.id === match.node.id)) return
    accepted.push(match)
  })
  return accepted.map(({ node }) => node)
}

function topologyLabelAliases(sourceName) {
  const tokens = normalizeToken(sourceName).split(' ').filter(Boolean)
  if (!tokens.length) return []
  const aliases = [tokens]
  const baseTokens = stripDeviceLabelDecorators(tokens)
  if (baseTokens.join(' ') !== tokens.join(' ')) aliases.push(baseTokens)
  if (baseTokens[0] === 'jb' && baseTokens.length > 1) {
    // Some source lines abbreviate the second endpoint, e.g. JB-004_005.
    aliases.push(baseTokens.slice(1))
    if (baseTokens[1] === 'cctv' && baseTokens.length > 2) {
      aliases.push(['jb', ...baseTokens.slice(2)])
    }
  }
  if (['cam', 'camera', 'kamera'].includes(baseTokens[0]) && baseTokens.length > 1) {
    aliases.push(['c', ...baseTokens.slice(1)])
  }
  if (baseTokens[0] === 'server') aliases.push(['svr'])
  return [...new Map(aliases.map((alias) => [alias.join(' '), alias])).values()]
}

function stripDeviceLabelDecorators(tokens) {
  const suffixes = new Set([
    'exp',
    'extended',
    'wp',
    'rekomendasi',
    'recommendation',
  ])
  let end = tokens.length
  while (end > 2 && suffixes.has(tokens[end - 1])) end -= 1
  return tokens.slice(0, end)
}

function tokenSequencePositions(tokens, sequence) {
  const positions = []
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      positions.push(index)
    }
  }
  return positions
}

function sameSourceLocation(left, right) {
  const leftKey = sourceLocationKey(left)
  const rightKey = sourceLocationKey(right)
  return leftKey && rightKey ? leftKey === rightKey : true
}

function sourceLocationKey(value) {
  const segments = String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map(normalizeToken)
    .filter(Boolean)
  if (!segments.length) return ''
  const layerMarkers = [
    'cable',
    'kabel',
    'cctv',
    'camera',
    'junction box',
    'juction box',
    'jucntion box',
    'tiang',
    'server',
    'switch',
    'router',
  ]
  const layerIndex = segments.findIndex((segment) => layerMarkers.some((marker) => (
    segment === marker || segment.includes(marker)
  )))
  return segments.slice(0, layerIndex > 0 ? layerIndex : Math.min(2, segments.length)).join('/')
}

function generateExplicitCandidates(bundle, nodes, paths, issues) {
  const objectByFeature = new Map([
    ...nodes.map((node) => [node.sourceFeatureId, node]),
    ...paths.map((path) => [path.sourceFeatureId, path]),
  ])
  const objectByIdentity = new Map()
  ;[...nodes, ...paths].forEach((object) => {
    const aliases = [
      object.id,
      object.canonicalAssetId,
      object.assetId,
      object.legacyAssetId,
      object.onboardingIdentity,
      object.sourceFeatureId,
      ...Object.values(object.identityAliases ?? {}).flat(),
    ].filter(Boolean)
    aliases.forEach((alias) => {
      if (!objectByIdentity.has(alias)) objectByIdentity.set(alias, object)
    })
  })
  return bundle.explicitRelations.flatMap((relation) => {
    const source = relation.sourceReference
      ? objectByIdentity.get(relation.sourceReference)
      : objectByFeature.get(relation.sourceFeatureId)
    const target = objectByIdentity.get(relation.targetReference)
    if (!source || !target) {
      issues.push(topologyIssue(bundle, {
        severity: 'error',
        issueCode: 'explicit_relation_dangling',
        scope: 'explicit_relation',
        message: `Explicit relation ${relation.explicitRelationEvidenceId} tidak dapat di-resolve.`,
        entityReference: relation.explicitRelationEvidenceId,
        readinessImpact: 'blocking',
      }))
      return []
    }
    if (source.siteId !== target.siteId) {
      issues.push(topologyIssue(bundle, {
        severity: 'error',
        issueCode: 'explicit_relation_cross_site',
        scope: 'explicit_relation',
        message: 'Explicit relation lintas site ditolak tanpa approved mapping.',
        entityReference: relation.explicitRelationEvidenceId,
        readinessImpact: 'blocking',
      }))
      return []
    }
    return [{
      ...baseCandidate({
        candidateType: 'explicit_metadata',
        sourceEndpointId: `explicit:${relation.explicitRelationEvidenceId}`,
        sourcePath: source,
        targetAssetId: target.id,
        targetNode: target,
        distanceMeters: null,
        sourceCoordinate: null,
        targetCoordinate: target.coordinate,
        measureMeters: null,
        semanticCompatibility: 1,
        endpointRole: 1,
        sourceContext: 1,
        styleConsistency: 1,
        angleScore: 1,
        graphConsistency: 1,
        evidence: [{
          source: 'ExtendedData',
          ruleId: 'explicit.metadata-relation',
          observedValue: relation.targetReference,
          normalizedValue: target.id,
          weight: 1,
          explanation: 'Relasi dinyatakan eksplisit pada metadata sumber.',
        }],
      }),
      explicitRelationEvidenceId: relation.explicitRelationEvidenceId,
      explicitRelationType: relation.relationType,
      direction: normalizeDirection(relation.direction),
      manualConfirmation: relation.source === 'manual_admin'
        ? structuredClone(relation.manualConfirmation ?? null)
        : null,
    }]
  })
}

function baseCandidate({
  candidateType,
  sourceEndpointId,
  sourcePath,
  targetAssetId,
  targetEndpointId,
  targetNode,
  targetPath,
  distanceMeters,
  sourceCoordinate,
  targetCoordinate,
  measureMeters,
  targetMeasureMeters,
  semanticCompatibility,
  endpointRole,
  sourceContext,
  styleConsistency,
  angleScore,
  graphConsistency,
  evidence,
}) {
  return {
    candidateType,
    siteId: sourcePath.siteId,
    networkFamily: sourcePath.networkFamily,
    sourceEndpointId,
    sourcePathAssetId: sourcePath.id,
    sourceFeatureId: sourcePath.sourceFeatureId,
    sourceGeometryIds: unique([
      sourcePath.geometryId,
      targetPath?.geometryId,
    ].filter(Boolean)),
    targetAssetId,
    targetEndpointId,
    targetPathAssetId: targetPath?.id,
    targetFeatureId: targetNode?.sourceFeatureId ?? targetPath?.sourceFeatureId,
    sourceObjectRole: sourcePath?.objectRole ?? null,
    targetObjectRole: targetNode?.objectRole ?? targetPath?.objectRole ?? null,
    distanceMeters,
    sourceCoordinate: sourceCoordinate ? cloneCoordinate(sourceCoordinate) : null,
    targetCoordinate: targetCoordinate ? cloneCoordinate(targetCoordinate) : null,
    measureMeters,
    targetMeasureMeters,
    components: {
      semanticCompatibility,
      endpointRole,
      sourceContext,
      styleConsistency,
      angle: angleScore,
      graphConsistency,
    },
    evidence,
  }
}

function scoreAndProposeCandidates(rawCandidates, settings, generatedAt, datasetVersionId) {
  const candidates = rawCandidates.map((candidate) => {
    const distanceScore = [
      'explicit_metadata',
      'line_label_connection',
      'line_label_attachment',
    ].includes(candidate.candidateType)
      ? 1
      : Math.exp(
        -(candidate.distanceMeters ** 2) / (2 * settings.distanceSigmaMeters ** 2),
      )
    const components = {
      distance: distanceScore,
      ...candidate.components,
    }
    const score = Object.entries(SCORE_WEIGHTS).reduce((total, [field, weight]) => (
      total + weight * clamp(components[field] ?? 0, 0, 1)
    ), 0)
    const candidateId = deterministicId('candidate', {
      datasetVersionId,
      type: candidate.candidateType,
      siteId: candidate.siteId,
      sourceEndpointId: candidate.sourceEndpointId,
      sourcePathAssetId: candidate.sourcePathAssetId,
      targetAssetId: candidate.targetAssetId,
      targetEndpointId: candidate.targetEndpointId,
      sourceGeometryIds: candidate.sourceGeometryIds,
    })
    return {
      candidateId,
      datasetVersionId: null,
      siteId: candidate.siteId,
      sourceEndpointId: candidate.sourceEndpointId,
      sourcePathAssetId: candidate.sourcePathAssetId,
      ...compact({
        targetAssetId: candidate.targetAssetId,
        targetEndpointId: candidate.targetEndpointId,
        targetPathAssetId: candidate.targetPathAssetId,
        sourceFeatureId: candidate.sourceFeatureId,
        targetFeatureId: candidate.targetFeatureId,
        distanceMeters: candidate.distanceMeters,
        measureMeters: candidate.measureMeters,
        targetMeasureMeters: candidate.targetMeasureMeters,
      }),
      candidateType: candidate.candidateType,
      sourceObjectRole: candidate.sourceObjectRole,
      targetObjectRole: candidate.targetObjectRole,
      relationKind: relationKindForCandidate(candidate),
      score: round(score, 6),
      scoreMargin: null,
      evidence: [
        ...candidate.evidence,
        ...scoreEvidence(components),
      ],
      scoreComponents: Object.fromEntries(
        Object.entries(components).map(([key, value]) => [key, round(value, 6)]),
      ),
      candidateStatus: 'candidate',
      proposalStatus: 'not_selected',
      topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
      generatedAt,
      sourceGeometryIds: candidate.sourceGeometryIds,
      sourceCoordinate: candidate.sourceCoordinate,
      targetCoordinate: candidate.targetCoordinate,
      networkFamily: candidate.networkFamily,
      manualConfirmation: candidate.manualConfirmation ?? null,
      ...compact({
        explicitRelationEvidenceId: candidate.explicitRelationEvidenceId,
        relationType: candidate.explicitRelationType,
        direction: candidate.direction,
      }),
    }
  })

  const groups = groupBy(candidates, candidateGroupKey)
  groups.forEach((group) => {
    group.sort((left, right) => right.score - left.score || compareCandidate(left, right))
    const best = group[0]
    const second = group[1]
    best.scoreMargin = second ? round(best.score - second.score, 6) : best.score
    group.slice(1).forEach((candidate, index) => {
      const next = group[index + 2]
      candidate.scoreMargin = next ? round(candidate.score - next.score, 6) : candidate.score
    })
    if (best.candidateType === 'explicit_metadata') {
      const manualConfirmation = best.manualConfirmation
      const shouldConfirm = settings.autoConfirmExplicitMetadata || Boolean(manualConfirmation)
      best.proposalStatus = shouldConfirm
        ? manualConfirmation ? 'confirmed_by_admin' : 'confirmed_by_explicit_policy'
        : 'recommended'
      if (shouldConfirm) {
        best.candidateStatus = 'confirmed'
        best.review = manualConfirmation
          ? {
            actorId: manualConfirmation.actorId,
            reviewedAt: manualConfirmation.reviewedAt ?? generatedAt,
            reason: manualConfirmation.reason,
            action: 'manual_device_relation',
            auditEventId: manualConfirmation.auditEventId ?? null,
            before: 'candidate',
            after: 'confirmed',
          }
          : {
            actorId: 'explicit-metadata-policy',
            reviewedAt: generatedAt,
            reason: 'Explicit metadata valid sesuai publication policy.',
            action: 'auto_confirm_explicit',
            before: 'candidate',
            after: 'confirmed',
          }
      }
      return
    }
    const lineLabelCandidate = group.find(isLineLabelCandidate)
    if (lineLabelCandidate) {
      group.forEach((candidate) => {
        if (candidate === lineLabelCandidate) return
        candidate.candidateStatus = 'candidate'
        candidate.proposalStatus = 'not_selected'
      })
      lineLabelCandidate.candidateStatus = 'candidate'
      lineLabelCandidate.proposalStatus = 'recommended'
      lineLabelCandidate.scoreMargin = lineLabelCandidate.score
      return
    }
    if (best.score < settings.acceptanceThreshold) {
      best.proposalStatus = 'below_threshold'
      return
    }
    if (second && best.scoreMargin < settings.ambiguityScoreMargin) {
      group.forEach((candidate) => {
        candidate.candidateStatus = 'ambiguous'
        candidate.proposalStatus = 'ambiguous'
      })
      return
    }
    best.proposalStatus = 'recommended'
  })

  return candidates.sort(compareCandidate)
}

function applyCapacityConstraints(candidates, nodes, settings, issues) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const recommended = candidates
    .filter((candidate) => (
      candidate.proposalStatus === 'recommended'
      && candidate.candidateStatus === 'candidate'
      && candidate.candidateType !== 'explicit_metadata'
    ))
    .sort((left, right) => right.score - left.score || compareCandidate(left, right))
  const capacityConstrained = recommended.filter((candidate) => (
    !['line_label_connection', 'line_label_attachment'].includes(candidate.candidateType)
  ))
  const targetCounts = new Map()
  capacityConstrained.forEach((candidate) => {
    const node = nodeById.get(candidate.targetAssetId)
    if (!node) return
    const count = targetCounts.get(node.id) ?? 0
    const capacity = nodeCapacity(node)
    if (count >= capacity) {
      candidate.candidateStatus = 'ambiguous'
      candidate.proposalStatus = 'capacity_conflict'
      issues.push({
        issueId: deterministicId('topology-issue', candidate.candidateId, 'capacity'),
        datasetVersionId: candidate.datasetVersionId,
        severity: 'warning',
        issueCode: 'device_capacity_conflict',
        scope: 'constraint',
        message: `Candidate ${candidate.candidateId} melebihi capacity ${capacity} untuk ${node.id}.`,
        entityReference: candidate.candidateId,
        readinessImpact: 'warning',
      })
      return
    }
    targetCounts.set(node.id, count + 1)
  })
  if (settings.autoConfirmSpatialInference) {
    // The setting is intentionally ignored until accuracy gates pass.
    const accuracyApproved = Number.isFinite(settings.heldOutPrecision)
      && settings.heldOutPrecision >= settings.requiredHeldOutPrecision
      && Number.isFinite(settings.pathAccuracy)
      && settings.pathAccuracy >= settings.requiredPathAccuracy
    if (accuracyApproved) {
      recommended.filter(({ proposalStatus }) => proposalStatus === 'recommended')
        .forEach((candidate) => {
          candidate.candidateStatus = 'confirmed'
          candidate.review = {
            actorId: 'publication-policy',
            reviewedAt: candidate.generatedAt,
            reason: 'Accuracy gate dan auto-confirm policy terpenuhi.',
          }
        })
    }
  }
}

function reconcilePreviousDecisions(candidates, previousCandidates) {
  const previousById = new Map(asArray(previousCandidates).map((candidate) => [
    candidate.candidateId,
    candidate,
  ]))
  candidates.forEach((candidate) => {
    const previous = previousById.get(candidate.candidateId)
    if (!previous) return
    if (!['confirmed', 'rejected', 'revoked'].includes(previous.candidateStatus)) return
    candidate.candidateStatus = previous.candidateStatus
    candidate.proposalStatus = previous.proposalStatus ?? candidate.proposalStatus
    candidate.review = structuredClone(previous.review)
    candidate.supersedesCandidateId = previous.supersedesCandidateId
  })
}

function buildConfirmedRelations({
  bundle,
  candidates,
  previousRelations,
  settings,
  generatedAt,
}) {
  const previousByCandidate = new Map(asArray(previousRelations)
    .filter(({ candidateId }) => Boolean(candidateId))
    .map((relation) => [relation.candidateId, relation]))
  const relations = candidates.flatMap((candidate) => {
    const explicitlyConfirmed = candidate.candidateType === 'explicit_metadata'
      && settings.autoConfirmExplicitMetadata
      && !['rejected', 'revoked'].includes(candidate.candidateStatus)
    const confirmed = candidate.candidateStatus === 'confirmed' || explicitlyConfirmed
    if (!confirmed) return []
    const previous = previousByCandidate.get(candidate.candidateId)
    if (previous?.verificationStatus === 'revoked'
      && candidate.candidateStatus !== 'confirmed') return []
    const verifiedBy = candidate.review?.actorId
      ?? (explicitlyConfirmed ? 'explicit-metadata-policy' : 'publication-policy')
    const verifiedAt = candidate.review?.reviewedAt ?? generatedAt
    const provenance = candidate.manualConfirmation
      ? 'manual_admin'
      : candidate.candidateType === 'explicit_metadata'
        ? 'explicit_kml_metadata'
        : ['line_label_connection', 'line_label_attachment'].includes(candidate.candidateType)
          ? 'line_label_inference'
          : 'spatial_inference'
    const baseRelation = {
      datasetVersionId: bundle.datasetVersion.id,
      sourceAssetId: candidate.sourcePathAssetId,
      targetAssetId: candidate.targetAssetId ?? candidate.targetPathAssetId,
      relationType: candidate.relationType ?? relationTypeForCandidate(candidate.candidateType),
      direction: candidate.direction ?? 'undirected',
      ...compact({
        pathAssetId: [
          'endpoint_device',
          'inline_device',
          'line_label_attachment',
        ].includes(candidate.candidateType)
          ? candidate.sourcePathAssetId
          : undefined,
      }),
      sourceGeometryIds: structuredClone(candidate.sourceGeometryIds),
      ...compact({
        anchorMeasureMeters: candidate.measureMeters,
        targetAnchorMeasureMeters: candidate.targetMeasureMeters,
      }),
      relationKind: candidate.relationKind ?? relationKindForCandidate(candidate),
      provenance,
      verificationStatus: 'confirmed',
      candidateId: candidate.candidateId,
      verifiedBy,
      verifiedAt,
      auditEventId: candidate.review?.auditEventId ?? previous?.auditEventId ?? null,
      evidence: structuredClone(candidate.evidence),
      topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    }
    const sources = candidate.candidateType === 'intersection_with_junction'
      && candidate.targetPathAssetId
      ? [{
        sourceAssetId: candidate.sourcePathAssetId,
        anchorMeasureMeters: candidate.measureMeters,
        relationSuffix: 'left',
      }, {
        sourceAssetId: candidate.targetPathAssetId,
        anchorMeasureMeters: candidate.targetMeasureMeters,
        relationSuffix: 'right',
      }]
      : [{
        sourceAssetId: baseRelation.sourceAssetId,
        anchorMeasureMeters: baseRelation.anchorMeasureMeters,
        relationSuffix: 'primary',
      }]
    return sources.map((source) => ({
      ...baseRelation,
      relationId: previous?.relationId && sources.length === 1
        ? previous.relationId
        : deterministicId(
          'relation',
          bundle.datasetVersion.id,
          candidate.candidateId,
          source.relationSuffix,
        ),
      sourceAssetId: source.sourceAssetId,
      anchorMeasureMeters: source.anchorMeasureMeters,
    }))
  })
  return deduplicateRedundantConfirmedRelations(relations)
    .sort((left, right) => left.relationId.localeCompare(right.relationId))
}

function deduplicateRedundantConfirmedRelations(relations) {
  const materialized = new Map()
  relations.forEach((relation) => {
    const relationKind = relation.relationKind ?? persistedRelationKind(relation)
    if (['device_edge', 'path_attachment', 'path_continuation'].includes(relationKind)) {
      // A single operational edge may be supported by more than one generated
      // candidate (for example, a path can intersect several other paths at
      // the same junction). Keep one materialized relation per logical pair;
      // the candidate history still preserves every reviewable piece of evidence.
      const key = `${relationKind}|${undirectedKey(
        relation.sourceAssetId,
        relation.targetAssetId,
        relation.relationType,
      )}`
      const previous = materialized.get(key)
      if (!previous || confirmedRelationPreference(relation, previous) > 0) {
        materialized.set(key, relation)
      }
      return
    }
    materialized.set(relation.relationId, relation)
  })
  return [...materialized.values()]
}

function confirmedRelationPreference(left, right) {
  const provenancePriority = {
    manual_admin: 4,
    explicit_kml_metadata: 3,
    line_label_inference: 2,
    spatial_inference: 1,
  }
  const leftScore = Number(left.evidence?.find(({ source }) => source === 'scoring')?.observedValue)
  const rightScore = Number(right.evidence?.find(({ source }) => source === 'scoring')?.observedValue)
  const normalizedLeftScore = Number.isFinite(leftScore) ? leftScore : -1
  const normalizedRightScore = Number.isFinite(rightScore) ? rightScore : -1
  return (provenancePriority[left.provenance] ?? 0)
    - (provenancePriority[right.provenance] ?? 0)
    || normalizedLeftScore - normalizedRightScore
    || String(right.verifiedAt ?? '').localeCompare(String(left.verifiedAt ?? ''))
    || String(right.relationId ?? '').localeCompare(String(left.relationId ?? ''))
}

export function buildConfirmedGraph({ bundle, nodes, paths, confirmedRelations }) {
  const graphNodes = nodes.map((node) => ({
      id: node.id,
      canonicalAssetId: node.id,
      assetId: node.id,
      stableAssetId: node.assetId,
      legacyAssetId: node.legacyAssetId,
      onboardingIdentity: node.onboardingIdentity,
      identityStatus: node.identityStatus,
      identityAliases: structuredClone(node.identityAliases ?? {}),
      sourceFeatureId: node.sourceFeatureId,
      siteId: node.siteId,
      networkFamily: node.networkFamily,
      objectRole: 'device_node',
      assetType: node.assetType,
    })).sort(compareId)
  const deviceIds = new Set(graphNodes.map(({ id }) => id))
  const pathIds = new Set(paths.map(({ id }) => id))
  const adjacency = new Map([...deviceIds, ...pathIds].map((id) => [id, []]))
  confirmedRelations
    .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
    .forEach((relation) => {
      if (!adjacency.has(relation.sourceAssetId) || !adjacency.has(relation.targetAssetId)) return
      adjacency.get(relation.sourceAssetId).push({
        targetId: relation.targetAssetId,
        relation,
      })
      adjacency.get(relation.targetAssetId).push({
        targetId: relation.sourceAssetId,
        relation,
      })
    })
  const edgeByPair = new Map()
  graphNodes.forEach((sourceNode) => {
    const queue = (adjacency.get(sourceNode.id) ?? []).map((step) => ({
      currentId: step.targetId,
      relations: [step.relation],
      visitedPaths: new Set(),
    }))
    while (queue.length) {
      const current = queue.shift()
      if (deviceIds.has(current.currentId)) {
        if (current.currentId !== sourceNode.id) {
          const pair = undirectedKey(sourceNode.id, current.currentId, 'connected')
          const edge = collapseConfirmedPath(
            bundle,
            sourceNode.id,
            current.currentId,
            current.relations,
          )
          const existing = edgeByPair.get(pair)
          if (!existing || edge.sourceGeometryIds.length < existing.sourceGeometryIds.length) {
            edgeByPair.set(pair, edge)
          }
        }
        continue
      }
      if (!pathIds.has(current.currentId) || current.visitedPaths.has(current.currentId)) continue
      const visitedPaths = new Set(current.visitedPaths)
      visitedPaths.add(current.currentId)
      for (const next of adjacency.get(current.currentId) ?? []) {
        if (current.relations.some(({ relationId }) => (
          relationId === next.relation.relationId
        ))) continue
        queue.push({
          currentId: next.targetId,
          relations: [...current.relations, next.relation],
          visitedPaths,
        })
      }
    }
  })
  const edges = [...edgeByPair.values()].sort((left, right) => left.id.localeCompare(right.id))
  const components = connectedComponents(graphNodes, edges)
  const degreeByNode = Object.fromEntries(graphNodes.map((node) => [
    node.id,
    edges.filter((edge) => (
      edge.sourceAssetId === node.id || edge.targetAssetId === node.id
    )).length,
  ]))
  return {
    datasetVersionId: bundle.datasetVersion.id,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    nodes: graphNodes,
    edges,
    components,
    degreeByNode,
    isolatedNodeIds: Object.entries(degreeByNode)
      .filter(([, degree]) => degree === 0)
      .map(([nodeId]) => nodeId)
      .sort(),
  }
}

function collapseConfirmedPath(bundle, sourceAssetId, targetAssetId, relations) {
  const sourceGeometryIds = unique(relations.flatMap(({ sourceGeometryIds }) => (
    sourceGeometryIds ?? []
  )))
  const pathAssetIds = unique(relations.flatMap((relation) => [
    relation.pathAssetId,
    ...(relation.relationType === 'path-continuation'
      ? [relation.sourceAssetId, relation.targetAssetId]
      : []),
  ].filter(Boolean)))
  const candidateIds = unique(relations.map(({ candidateId }) => candidateId).filter(Boolean))
  const allManual = relations.every(({ provenance }) => provenance === 'manual_admin')
  const allExplicit = relations.every(({ provenance }) => (
    provenance === 'explicit_kml_metadata'
  ))
  const allLineLabel = relations.every(({ provenance }) => (
    provenance === 'line_label_inference'
  ))
  return {
    id: deterministicId(
      'topology-edge',
      bundle.datasetVersion.id,
      ...[sourceAssetId, targetAssetId].sort(),
      sourceGeometryIds,
    ),
    datasetVersionId: bundle.datasetVersion.id,
    sourceAssetId,
    targetAssetId,
    sourceNodeId: sourceAssetId,
    targetNodeId: targetAssetId,
    relationType: relations.length === 1
      ? relations[0].relationType
      : 'connected-via-path',
    direction: relations.length === 1 ? relations[0].direction : 'undirected',
    pathAssetId: pathAssetIds.length === 1 ? pathAssetIds[0] : undefined,
    pathAssetIds,
    sourceGeometryIds,
    provenance: allManual
      ? 'manual_admin'
      : allExplicit
        ? 'explicit_kml_metadata'
        : allLineLabel ? 'line_label_inference' : 'spatial_inference',
    verificationStatus: 'confirmed',
    relationStatus: 'confirmed',
    relationSource: allManual
      ? 'manual_admin'
      : allExplicit
        ? 'explicit_kml_metadata'
        : allLineLabel ? 'line_label_inference' : 'spatial_inference',
    relationKind: 'device_edge',
    candidateId: candidateIds.length === 1 ? candidateIds[0] : undefined,
    candidateIds,
    sourceRelationIds: relations.map(({ relationId }) => relationId),
  }
}

export function validateConfirmedGraph({
  bundle,
  nodes,
  paths,
  candidates,
  confirmedRelations,
  graph,
  lineworkIssues = [],
}) {
  const issues = [...lineworkIssues]
  const objectById = new Map([
    ...nodes.map((node) => [node.id, node]),
    ...paths.map((path) => [path.id, path]),
  ])
  const edgeKeys = new Set()
  confirmedRelations.forEach((relation) => {
    const source = objectById.get(relation.sourceAssetId)
    const target = objectById.get(relation.targetAssetId)
    if (relation.verificationStatus !== 'confirmed') {
      issues.push(graphIssue(bundle, relation, 'non_confirmed_edge_in_graph', 'error'))
      return
    }
    if (!source || !target) {
      issues.push(graphIssue(bundle, relation, 'dangling_confirmed_relation', 'error'))
      return
    }
    if (source.siteId !== target.siteId) {
      issues.push(graphIssue(bundle, relation, 'cross_site_edge', 'error'))
    }
    if (!familiesCompatibleForRelation(source, target)
      && !['manual_admin', 'line_label_inference'].includes(relation.provenance)) {
      issues.push(graphIssue(bundle, relation, 'incompatible_family_edge', 'error'))
    }
    if (relation.sourceAssetId === relation.targetAssetId) {
      issues.push(graphIssue(bundle, relation, 'accidental_self_loop', 'error'))
    }
    const key = undirectedKey(relation.sourceAssetId, relation.targetAssetId, relation.relationType)
    if (edgeKeys.has(key)) {
      issues.push(graphIssue(bundle, relation, 'duplicate_confirmed_edge', 'error'))
    }
    edgeKeys.add(key)
  })

  graph.nodes.filter(({ objectRole }) => objectRole === 'device_node').forEach((node) => {
    const degree = graph.degreeByNode[node.id] ?? 0
    const source = objectById.get(node.id)
    if (degree === 0) {
      issues.push(topologyIssue(bundle, {
        severity: 'warning',
        issueCode: 'isolated_device',
        scope: 'graph',
        message: `Device ${node.id} terisolasi pada confirmed graph.`,
        entityReference: node.id,
        readinessImpact: 'warning',
      }))
    } else if (degree > nodeCapacity(source)) {
      issues.push(topologyIssue(bundle, {
        severity: 'warning',
        issueCode: 'device_degree_anomaly',
        scope: 'graph',
        message: `Degree ${degree} untuk ${node.id} melewati capacity rule.`,
        entityReference: node.id,
        readinessImpact: 'warning',
      }))
    }
  })
  uniqueBy(paths, 'id').forEach((path) => {
    const attachmentCount = confirmedRelations.filter((relation) => (
      relation.verificationStatus === 'confirmed'
      && (relation.sourceAssetId === path.id || relation.targetAssetId === path.id)
    )).length
    if (attachmentCount < 2) {
      issues.push(topologyIssue(bundle, {
        severity: 'warning',
        issueCode: 'dangling_cable',
        scope: 'graph',
        message: `Cable ${path.id} belum memiliki dua confirmed attachment.`,
        entityReference: path.id,
        readinessImpact: 'warning',
      }))
    }
  })

  const leakedCandidate = candidates.some(({ candidateStatus }) => (
    ['candidate', 'ambiguous', 'rejected', 'revoked'].includes(candidateStatus)
  )) && candidates.some((candidate) => (
    ['candidate', 'ambiguous', 'rejected', 'revoked'].includes(candidate.candidateStatus)
    && graph.edges.some((edge) => edge.candidateId === candidate.candidateId)
  ))
  if (leakedCandidate) {
    issues.push(topologyIssue(bundle, {
      severity: 'error',
      issueCode: 'unconfirmed_candidate_in_operational_graph',
      scope: 'graph',
      message: 'Operational graph memuat candidate yang belum confirmed.',
      readinessImpact: 'blocking',
    }))
  }
  return {
    status: issues.some(({ severity }) => severity === 'error')
      ? 'invalid'
      : issues.length ? 'valid_with_warnings' : 'valid',
    issues,
    summary: {
      total: issues.length,
      errors: issues.filter(({ severity }) => severity === 'error').length,
      warnings: issues.filter(({ severity }) => severity === 'warning').length,
    },
  }
}

function buildUnresolvedEndpoints(paths, candidates) {
  const candidateEndpointIds = new Set(candidates.map(({ sourceEndpointId }) => sourceEndpointId))
  return paths.flatMap(lineEndpoints)
    .filter(({ id }) => !candidateEndpointIds.has(id))
    .map((endpoint) => ({
      sourceEndpointId: endpoint.id,
      sourcePathAssetId: endpoint.path.id,
      sourceGeometryId: endpoint.path.geometryId,
      endpointRole: endpoint.role,
      coordinate: cloneCoordinate(endpoint.coordinate),
      reason: 'no_eligible_candidate',
    }))
}

function buildSummary({ candidates, confirmedRelations, graph, unresolved, validation }) {
  const confirmed = confirmedRelations.filter(({ verificationStatus }) => (
    verificationStatus === 'confirmed'
  ))
  return {
    candidateCount: candidates.filter(({ candidateStatus }) => candidateStatus === 'candidate').length,
    confirmedEdgeCount: graph.edges.length,
    confirmedDeviceEdgeCount: graph.edges.length,
    confirmedRelationCount: confirmed.length,
    confirmedPathAttachmentCount: confirmed.filter(({ relationKind }) => (
      relationKind === 'path_attachment'
    )).length,
    confirmedPathContinuationCount: confirmed.filter(({ relationKind }) => (
      relationKind === 'path_continuation'
    )).length,
    ambiguousCount: candidates.filter(({ candidateStatus }) => candidateStatus === 'ambiguous').length,
    rejectedCount: candidates.filter(({ candidateStatus }) => candidateStatus === 'rejected').length,
    revokedCount: candidates.filter(({ candidateStatus }) => candidateStatus === 'revoked').length,
    unresolvedCount: unresolved.length,
    componentCount: graph.components.length,
    isolatedNodeCount: graph.isolatedNodeIds.length,
    falseComponentMergeCount: validation.issues.filter(({ issueCode }) => (
      ['cross_site_edge', 'incompatible_family_edge'].includes(issueCode)
    )).length,
  }
}

function evaluateTopologyReadiness({
  bundle,
  candidates,
  confirmedRelations,
  validation,
  settings,
  unresolved,
}) {
  const identities = [
    ...bundle.classifiedNodes,
    ...bundle.classifiedPaths,
  ]
  const stableIdentityCoverage = identities.length
    ? identities.filter(({ stableAssetId, identityStatus, assetId }) => (
      Boolean(stableAssetId)
        || identityStatus === 'stable'
        || (identityStatus === undefined && Boolean(assetId))
    )).length / identities.length
    : 0
  const accuracyReady = Number.isFinite(settings.heldOutPrecision)
    && settings.heldOutPrecision >= settings.requiredHeldOutPrecision
    && Number.isFinite(settings.pathAccuracy)
    && settings.pathAccuracy >= settings.requiredPathAccuracy
  const blockingReasons = []
  if (stableIdentityCoverage < 1) blockingReasons.push('stable_identity_coverage')
  if (validation.summary.errors > 0) blockingReasons.push('confirmed_graph_invalid')
  if (!accuracyReady) blockingReasons.push('held_out_accuracy_not_proven')
  if (!TOPOLOGY_RULE_SET_VERSION) blockingReasons.push('rule_set_version_missing')
  if (candidates.some(({ candidateStatus }) => candidateStatus === 'confirmed')
    && !confirmedRelations.length) blockingReasons.push('confirmed_decision_not_materialized')
  return {
    topologyReadiness: blockingReasons.length ? 'not_ready' : 'ready',
    stableIdentityCoverage,
    heldOutPrecision: settings.heldOutPrecision,
    requiredHeldOutPrecision: settings.requiredHeldOutPrecision,
    pathAccuracy: settings.pathAccuracy,
    requiredPathAccuracy: settings.requiredPathAccuracy,
    unresolvedCount: unresolved.length,
    ambiguousCount: candidates.filter(({ candidateStatus }) => candidateStatus === 'ambiguous').length,
    blockingReasons,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
  }
}

function lineEndpoints(path) {
  return [{
    id: `endpoint:${path.geometryId}:start`,
    role: 'start',
    coordinate: path.coordinates[0],
    directionCoordinate: path.coordinates[1],
    measureMeters: 0,
    path,
  }, {
    id: `endpoint:${path.geometryId}:end`,
    role: 'end',
    coordinate: path.coordinates.at(-1),
    directionCoordinate: path.coordinates.at(-2),
    measureMeters: path.totalLengthMeters,
    path,
  }]
}

function nearestPointOnLine(coordinate, path) {
  let nearest = {
    distanceMeters: Number.POSITIVE_INFINITY,
    measureMeters: 0,
    projectedCoordinate: cloneCoordinate(path.coordinates[0]),
  }
  path.coordinates.slice(1).forEach((end, index) => {
    const start = path.coordinates[index]
    const projection = projectPointToSegment(coordinate, start, end)
    if (projection.distanceMeters >= nearest.distanceMeters) return
    nearest = {
      distanceMeters: projection.distanceMeters,
      measureMeters: path.cumulativeLengths[index]
        + path.segmentLengths[index] * projection.t,
      projectedCoordinate: projection.coordinate,
    }
  })
  return nearest
}

function projectPointToSegment(point, start, end) {
  const referenceLatitude = (Number(start[1]) + Number(end[1]) + Number(point[1])) / 3
  const pointXY = localMeters(point, start, referenceLatitude)
  const endXY = localMeters(end, start, referenceLatitude)
  const lengthSquared = endXY.x ** 2 + endXY.y ** 2
  const t = lengthSquared
    ? clamp((pointXY.x * endXY.x + pointXY.y * endXY.y) / lengthSquared, 0, 1)
    : 0
  return {
    t,
    distanceMeters: Math.hypot(pointXY.x - endXY.x * t, pointXY.y - endXY.y * t),
    coordinate: [
      Number(start[0]) + (Number(end[0]) - Number(start[0])) * t,
      Number(start[1]) + (Number(end[1]) - Number(start[1])) * t,
    ],
  }
}

function intersections(left, right) {
  const results = []
  for (let leftIndex = 0; leftIndex < left.coordinates.length - 1; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.coordinates.length - 1; rightIndex += 1) {
      const intersection = segmentIntersection(
        left.coordinates[leftIndex],
        left.coordinates[leftIndex + 1],
        right.coordinates[rightIndex],
        right.coordinates[rightIndex + 1],
      )
      if (!intersection) continue
      results.push({
        coordinate: intersection.coordinate,
        leftMeasureMeters: left.cumulativeLengths[leftIndex]
          + left.segmentLengths[leftIndex] * intersection.leftT,
        rightMeasureMeters: right.cumulativeLengths[rightIndex]
          + right.segmentLengths[rightIndex] * intersection.rightT,
      })
    }
  }
  return uniqueBy(results.map((item) => ({
    ...item,
    key: coordinateKey(item.coordinate),
  })), 'key')
}

function segmentIntersection(leftStart, leftEnd, rightStart, rightEnd) {
  const leftX = Number(leftEnd[0]) - Number(leftStart[0])
  const leftY = Number(leftEnd[1]) - Number(leftStart[1])
  const rightX = Number(rightEnd[0]) - Number(rightStart[0])
  const rightY = Number(rightEnd[1]) - Number(rightStart[1])
  const denominator = cross(leftX, leftY, rightX, rightY)
  if (Math.abs(denominator) < 1e-12) return null
  const offsetX = Number(rightStart[0]) - Number(leftStart[0])
  const offsetY = Number(rightStart[1]) - Number(leftStart[1])
  const leftT = cross(offsetX, offsetY, rightX, rightY) / denominator
  const rightT = cross(offsetX, offsetY, leftX, leftY) / denominator
  if (leftT < -1e-10 || leftT > 1 + 1e-10
    || rightT < -1e-10 || rightT > 1 + 1e-10) return null
  return {
    leftT: clamp(leftT, 0, 1),
    rightT: clamp(rightT, 0, 1),
    coordinate: [
      Number(leftStart[0]) + leftX * leftT,
      Number(leftStart[1]) + leftY * leftT,
    ],
  }
}

function endpointContinuationAngle(left, right) {
  const origin = left.coordinate
  const referenceLatitude = (Number(left.coordinate[1]) + Number(right.coordinate[1])) / 2
  const leftDirection = localMeters(left.directionCoordinate, origin, referenceLatitude)
  const rightOrigin = right.coordinate
  const rightDirection = localMeters(right.directionCoordinate, rightOrigin, referenceLatitude)
  const dot = leftDirection.x * rightDirection.x + leftDirection.y * rightDirection.y
  const magnitude = Math.hypot(leftDirection.x, leftDirection.y)
    * Math.hypot(rightDirection.x, rightDirection.y)
  if (!magnitude) return 0
  return Math.acos(clamp(dot / magnitude, -1, 1)) * 180 / Math.PI
}

function hasCompatibleDeviceNearEndpoint(endpoint, nodeIndex, settings) {
  return nodeIndex.queryPoint(endpoint.coordinate, settings.searchRadiusMeters).some((node) => (
    compatiblePathNode(endpoint.path, node).compatible
    && geographicDistanceMeters(endpoint.coordinate, node.coordinate)
      <= settings.searchRadiusMeters
  ))
}

function buildSpatialIndexes(nodes, paths, settings) {
  const coordinates = [
    ...nodes.map(({ coordinate }) => coordinate),
    ...paths.flatMap(({ coordinates: lineCoordinates }) => lineCoordinates),
  ]
  const referenceLatitude = coordinates.length
    ? coordinates.reduce((total, coordinate) => total + Number(coordinate[1]), 0)
      / coordinates.length
    : 0
  const cellSizeMeters = Math.max(
    25,
    settings.searchRadiusMeters,
    settings.inlineSearchRadiusMeters,
    settings.intersectionToleranceMeters,
  )
  const nodeIndex = new MeterGridIndex(referenceLatitude, cellSizeMeters)
  nodes.forEach((node) => nodeIndex.insertPoint(node, node.coordinate))
  const endpointRecords = paths
    .filter((path) => !path.duplicateOfGeometryId && !(path.overlaps?.length))
    .flatMap(lineEndpoints)
  const endpointIndex = new MeterGridIndex(referenceLatitude, cellSizeMeters)
  endpointRecords.forEach((endpoint) => endpointIndex.insertPoint(
    endpoint,
    endpoint.coordinate,
  ))
  const segmentIndex = new MeterGridIndex(referenceLatitude, cellSizeMeters)
  paths.forEach((path) => {
    path.coordinates.slice(1).forEach((end, index) => {
      segmentIndex.insertBounds(path, path.coordinates[index], end)
    })
  })
  return {
    nodes: nodeIndex,
    endpoints: endpointIndex,
    endpointRecords,
    segments: segmentIndex,
  }
}

function buildSegmentIndex(paths, settings) {
  const coordinates = paths.flatMap(({ coordinates: lineCoordinates }) => lineCoordinates)
  const referenceLatitude = coordinates.length
    ? coordinates.reduce((total, coordinate) => total + Number(coordinate[1]), 0)
      / coordinates.length
    : 0
  const cellSizeMeters = Math.max(
    25,
    settings.searchRadiusMeters,
    settings.inlineSearchRadiusMeters,
    settings.intersectionToleranceMeters,
  )
  const segmentIndex = new MeterGridIndex(referenceLatitude, cellSizeMeters)
  paths.forEach((path) => {
    path.coordinates.slice(1).forEach((end, index) => {
      segmentIndex.insertBounds(path, path.coordinates[index], end)
    })
  })
  return segmentIndex
}

class MeterGridIndex {
  constructor(referenceLatitude, cellSizeMeters) {
    this.referenceLatitude = referenceLatitude
    this.cellSizeMeters = cellSizeMeters
    this.buckets = new Map()
  }

  insertPoint(record, coordinate) {
    this.#insert(this.#cell(coordinate), record)
  }

  insertBounds(record, start, end) {
    const left = this.#meters(start)
    const right = this.#meters(end)
    const minX = Math.floor(Math.min(left.x, right.x) / this.cellSizeMeters)
    const maxX = Math.floor(Math.max(left.x, right.x) / this.cellSizeMeters)
    const minY = Math.floor(Math.min(left.y, right.y) / this.cellSizeMeters)
    const maxY = Math.floor(Math.max(left.y, right.y) / this.cellSizeMeters)
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) this.#insert(`${x}:${y}`, record)
    }
  }

  queryPoint(coordinate, radiusMeters) {
    const meters = this.#meters(coordinate)
    const centerX = Math.floor(meters.x / this.cellSizeMeters)
    const centerY = Math.floor(meters.y / this.cellSizeMeters)
    const range = Math.max(1, Math.ceil(radiusMeters / this.cellSizeMeters))
    const records = new Set()
    for (let x = centerX - range; x <= centerX + range; x += 1) {
      for (let y = centerY - range; y <= centerY + range; y += 1) {
        for (const record of this.buckets.get(`${x}:${y}`) ?? []) records.add(record)
      }
    }
    return [...records].sort((left, right) => (
      String(left.id ?? left.geometryId).localeCompare(String(right.id ?? right.geometryId))
    ))
  }

  pathPairs() {
    const pairs = new Map()
    this.buckets.forEach((records) => {
      const uniqueRecords = [...new Set(records)]
      for (let left = 0; left < uniqueRecords.length; left += 1) {
        for (let right = left + 1; right < uniqueRecords.length; right += 1) {
          const first = uniqueRecords[left]
          const second = uniqueRecords[right]
          if (first.geometryId === second.geometryId) continue
          const key = [first.geometryId, second.geometryId].sort().join('|')
          if (!pairs.has(key)) {
            pairs.set(key, first.geometryId < second.geometryId
              ? [first, second]
              : [second, first])
          }
        }
      }
    })
    return [...pairs.values()].sort((left, right) => (
      left[0].geometryId.localeCompare(right[0].geometryId)
      || left[1].geometryId.localeCompare(right[1].geometryId)
    ))
  }

  #insert(key, record) {
    this.buckets.set(key, [...(this.buckets.get(key) ?? []), record])
  }

  #cell(coordinate) {
    const meters = this.#meters(coordinate)
    return `${Math.floor(meters.x / this.cellSizeMeters)}`
      + `:${Math.floor(meters.y / this.cellSizeMeters)}`
  }

  #meters(coordinate) {
    return {
      x: radians(Number(coordinate[0])) * EARTH_RADIUS_METERS
        * Math.cos(radians(this.referenceLatitude)),
      y: radians(Number(coordinate[1])) * EARTH_RADIUS_METERS,
    }
  }
}

function compatiblePathNode(path, node) {
  if (path.siteId !== node.siteId) {
    return { compatible: false, score: 0, ruleId: 'hard-gate.site' }
  }
  const type = nodeSemanticText(node)
  if (path.networkFamily === node.networkFamily) {
    return {
      compatible: true,
      score: 1,
      ruleId: 'compatibility.same-family',
      explanation: 'Path dan device berada pada network family yang sama.',
    }
  }
  const approved = {
    cctv: /junction|\bjb\b|switch|nvr|server|router|camera|cctv|tiang|pole/,
    fiber_optic: /otb|junction|\bjb\b|switch|router|core|fiber|\bfo\b|tiang|pole/,
    lan: /switch|router|access point|\bap\b|printer|server|device|lan|tiang|pole/,
    infrastructure: /switch|router|server|junction|\bjb\b|otb|core|tiang|pole/,
  }[path.networkFamily]
  const compatible = (
    node.networkFamily === 'infrastructure' && approved?.test(type)
  ) || (
    path.networkFamily === 'lan'
      && node.networkFamily === 'cctv'
      && /camera|cctv|junction|\bjb\b|nvr/.test(type)
  ) || (
    path.networkFamily === 'fiber_optic'
      && node.networkFamily === 'cctv'
      && /junction|\bjb\b|otb|fiber|switch/.test(type)
  )
  return {
    compatible: Boolean(compatible),
    score: compatible ? 0.9 : 0,
    ruleId: compatible ? 'compatibility.approved-matrix' : 'hard-gate.incompatible-family',
    explanation: compatible
      ? 'Pasangan lintas family diizinkan oleh compatibility matrix versioned.'
      : 'Pasangan ditolak oleh compatibility matrix.',
  }
}

function familiesCompatibleForRelation(source, target) {
  if (source.networkFamily === target.networkFamily) return true
  if (source.objectRole === 'cable_path') return compatiblePathNode(source, target).compatible
  if (target.objectRole === 'cable_path') return compatiblePathNode(target, source).compatible
  return false
}

function inlineNodeAllowed(node) {
  return /junction|\bjb\b|switch|router|otb|splitter|coupler|core|tiang|pole/
    .test(nodeSemanticText(node))
}

function nodeCapacity(node) {
  const type = nodeSemanticText(node)
  if (/core|switch|router|nvr|server/.test(type)) return 48
  if (/junction|\bjb\b|otb|splitter|coupler/.test(type)) return 12
  if (/camera|cctv|access point|\bap\b|printer|terminal/.test(type)) return 1
  return 4
}

function endpointRoleScore(node, inline) {
  const type = nodeSemanticText(node)
  if (inline) return inlineNodeAllowed(node) ? 1 : 0
  if (/camera|cctv|access point|\bap\b|printer|terminal/.test(type)) return 1
  if (/junction|\bjb\b|switch|router|otb|core|nvr/.test(type)) return 0.9
  return 0.5
}

function nodeSemanticText(node) {
  return normalizeToken([
    node?.assetType,
    node?.category,
    node?.sourceName,
    node?.sourceFolderPath,
  ].filter(Boolean).join(' '))
}

function evidenceContext(evidence = []) {
  const folder = evidence.find(({ source }) => source === 'folder')?.observedValue
  const style = evidence.find(({ source }) => source === 'style')?.observedValue
  const name = evidence.find(({ source }) => source === 'name')?.observedValue
  return {
    folder: normalizeToken(folder),
    style: normalizeToken(style),
    name: normalizeToken(name),
  }
}

function contextScore(left, right) {
  if (left.folder && right.folder && left.folder === right.folder) return 1
  if (left.folder && right.folder && (
    left.folder.includes(right.folder) || right.folder.includes(left.folder)
  )) return 0.8
  if (left.name && right.name && sharedTokens(left.name, right.name) > 0) return 0.6
  return 0.3
}

function styleConsistencyScore(left, right) {
  const leftStyle = left.sourceContext?.style
  const rightStyle = right.sourceContext?.style
  if (!leftStyle || !rightStyle) return 0.5
  return leftStyle === rightStyle ? 1 : 0.25
}

function scoreEvidence(components) {
  return Object.entries(SCORE_WEIGHTS).map(([component, weight]) => ({
    source: 'scoring',
    ruleId: `score.${component}`,
    observedValue: components[component],
    normalizedValue: round(components[component] ?? 0, 6),
    weight,
    explanation: `Komponen ${component} dihitung secara deterministik.`,
  }))
}

function relationTypeForCandidate(type) {
  return {
    endpoint_device: 'path-endpoint',
    inline_device: 'path-inline-device',
    endpoint_endpoint: 'path-continuation',
    intersection_with_junction: 'path-junction',
    line_label_connection: 'connected-to',
    line_label_attachment: 'path-endpoint',
    explicit_metadata: 'connected-to',
  }[type] ?? 'connected-to'
}

function relationKindForCandidate(candidate) {
  if (candidate.sourceObjectRole === 'device_node'
    && candidate.targetObjectRole === 'device_node') {
    return 'device_edge'
  }
  if (candidate.candidateType === 'endpoint_endpoint') return 'path_continuation'
  return 'path_attachment'
}

function persistedRelationKind(relation) {
  if (relation.relationType === 'path-continuation') return 'path_continuation'
  if (String(relation.relationType ?? '').startsWith('path-')) return 'path_attachment'
  return 'device_edge'
}

function normalizeDirection(value) {
  return ['undirected', 'source_to_target', 'target_to_source', 'bidirectional']
    .includes(value) ? value : 'undirected'
}

function topologyIssue(bundle, {
  severity,
  issueCode,
  scope,
  message,
  entityReference,
  readinessImpact,
}) {
  return {
    issueId: deterministicId(
      'topology-issue',
      bundle.datasetVersion.id,
      issueCode,
      entityReference,
    ),
    datasetVersionId: bundle.datasetVersion.id,
    severity,
    issueCode,
    scope,
    message,
    entityReference,
    readinessImpact,
  }
}

function graphIssue(bundle, relation, issueCode, severity) {
  return topologyIssue(bundle, {
    severity,
    issueCode,
    scope: 'graph',
    message: `Relation ${relation.relationId} melanggar ${issueCode}.`,
    entityReference: relation.relationId,
    readinessImpact: severity === 'error' ? 'blocking' : 'warning',
  })
}

function invalidBundle(message, details) {
  return new AppError(message, {
    code: 'invalid_topology_input_bundle',
    statusCode: 422,
    details,
  })
}

function normalizeConfig(config) {
  const value = { ...DEFAULT_RELATION_ENGINE_CONFIG, ...config }
  return {
    searchRadiusMeters: positiveNumber(
      value.searchRadiusMeters ?? value.endpointToleranceMeters,
      DEFAULT_RELATION_ENGINE_CONFIG.searchRadiusMeters,
    ),
    inlineSearchRadiusMeters: positiveNumber(
      value.inlineSearchRadiusMeters ?? value.pointOnLineToleranceMeters,
      DEFAULT_RELATION_ENGINE_CONFIG.inlineSearchRadiusMeters,
    ),
    intersectionToleranceMeters: positiveNumber(
      value.intersectionToleranceMeters,
      DEFAULT_RELATION_ENGINE_CONFIG.intersectionToleranceMeters,
    ),
    minimumInlineEndpointDistanceMeters: nonNegativeNumber(
      value.minimumInlineEndpointDistanceMeters,
      DEFAULT_RELATION_ENGINE_CONFIG.minimumInlineEndpointDistanceMeters,
    ),
    endpointContinuationAngleDegrees: positiveNumber(
      value.endpointContinuationAngleDegrees,
      DEFAULT_RELATION_ENGINE_CONFIG.endpointContinuationAngleDegrees,
    ),
    distanceSigmaMeters: positiveNumber(
      value.distanceSigmaMeters,
      DEFAULT_RELATION_ENGINE_CONFIG.distanceSigmaMeters,
    ),
    acceptanceThreshold: unitNumber(
      value.acceptanceThreshold,
      DEFAULT_RELATION_ENGINE_CONFIG.acceptanceThreshold,
    ),
    ambiguityScoreMargin: unitNumber(
      value.ambiguityScoreMargin,
      DEFAULT_RELATION_ENGINE_CONFIG.ambiguityScoreMargin,
    ),
    autoConfirmSpatialInference: value.autoConfirmSpatialInference === true,
    autoConfirmExplicitMetadata: value.autoConfirmExplicitMetadata !== false,
    requiredHeldOutPrecision: unitNumber(
      value.requiredHeldOutPrecision,
      DEFAULT_RELATION_ENGINE_CONFIG.requiredHeldOutPrecision,
    ),
    requiredPathAccuracy: unitNumber(
      value.requiredPathAccuracy,
      DEFAULT_RELATION_ENGINE_CONFIG.requiredPathAccuracy,
    ),
    heldOutPrecision: optionalUnitNumber(value.heldOutPrecision),
    pathAccuracy: optionalUnitNumber(value.pathAccuracy),
  }
}

function linesHaveCollinearOverlap(left, right) {
  return left.coordinates.slice(1).some((leftEnd, leftIndex) => (
    right.coordinates.slice(1).some((rightEnd, rightIndex) => (
      collinearOverlap(
        left.coordinates[leftIndex],
        leftEnd,
        right.coordinates[rightIndex],
        rightEnd,
      )
    ))
  ))
}

function collinearOverlap(a, b, c, d) {
  const ab = [Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1])]
  const ac = [Number(c[0]) - Number(a[0]), Number(c[1]) - Number(a[1])]
  const ad = [Number(d[0]) - Number(a[0]), Number(d[1]) - Number(a[1])]
  if (Math.abs(cross(ab[0], ab[1], ac[0], ac[1])) > 1e-10
    || Math.abs(cross(ab[0], ab[1], ad[0], ad[1])) > 1e-10) return false
  const dominant = Math.abs(ab[0]) >= Math.abs(ab[1]) ? 0 : 1
  const leftMin = Math.min(Number(a[dominant]), Number(b[dominant]))
  const leftMax = Math.max(Number(a[dominant]), Number(b[dominant]))
  const rightMin = Math.min(Number(c[dominant]), Number(d[dominant]))
  const rightMax = Math.max(Number(c[dominant]), Number(d[dominant]))
  return Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin) > 1e-10
}

function connectedComponents(nodes, edges) {
  const adjacency = new Map(nodes.map(({ id }) => [id, []]))
  edges.forEach((edge) => {
    adjacency.get(edge.sourceAssetId)?.push({ nodeId: edge.targetAssetId, edgeId: edge.id })
    adjacency.get(edge.targetAssetId)?.push({ nodeId: edge.sourceAssetId, edgeId: edge.id })
  })
  const visited = new Set()
  const components = []
  nodes.forEach(({ id }) => {
    if (visited.has(id)) return
    const nodeIds = []
    const edgeIds = new Set()
    const queue = [id]
    visited.add(id)
    while (queue.length) {
      const current = queue.shift()
      nodeIds.push(current)
      for (const adjacent of adjacency.get(current) ?? []) {
        edgeIds.add(adjacent.edgeId)
        if (visited.has(adjacent.nodeId)) continue
        visited.add(adjacent.nodeId)
        queue.push(adjacent.nodeId)
      }
    }
    components.push({
      componentId: `component:${components.length + 1}`,
      nodeIds: nodeIds.sort(),
      edgeIds: [...edgeIds].sort(),
    })
  })
  return components
}

function candidateGroupKey(candidate) {
  if (candidate.candidateType === 'inline_device') {
    return `inline:${candidate.targetAssetId}|${candidate.sourcePathAssetId}`
  }
  return candidate.sourceEndpointId
}

function isLineLabelCandidate(candidate) {
  return ['line_label_connection', 'line_label_attachment'].includes(candidate.candidateType)
}

function coordinateSequenceKey(coordinates) {
  return coordinates.map((coordinate) => (
    coordinate.slice(0, 3).map((value) => Number(value).toFixed(10)).join(',')
  )).join('|')
}

function coordinateKey(coordinate) {
  return `${Number(coordinate[0]).toFixed(9)},${Number(coordinate[1]).toFixed(9)}`
}

function geographicDistanceMeters(left, right) {
  const leftLatitude = radians(Number(left[1]))
  const rightLatitude = radians(Number(right[1]))
  const latitudeDelta = rightLatitude - leftLatitude
  const longitudeDelta = radians(Number(right[0]) - Number(left[0]))
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude)
      * Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

function localMeters(coordinate, origin, referenceLatitude) {
  return {
    x: radians(Number(coordinate[0]) - Number(origin[0]))
      * EARTH_RADIUS_METERS * Math.cos(radians(referenceLatitude)),
    y: radians(Number(coordinate[1]) - Number(origin[1])) * EARTH_RADIUS_METERS,
  }
}

function objectIdentity(object) {
  return readString(object.canonicalAssetId, object.assetId, object.onboardingIdentity)
}

function validCoordinate(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return false
  const longitude = Number(coordinate[0])
  const latitude = Number(coordinate[1])
  return Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90
}

function validLineCoordinates(coordinates) {
  return Array.isArray(coordinates)
    && coordinates.length >= 2
    && coordinates.every(validCoordinate)
}

function cloneCoordinate(coordinate) {
  return coordinate.slice(0, 3).map(Number)
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

function sharedTokens(left, right) {
  const leftTokens = new Set(left.split(' ').filter((token) => token.length > 2))
  return right.split(' ').filter((token) => leftTokens.has(token)).length
}

function normalizeToken(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function compareCandidate(left, right) {
  return left.candidateId.localeCompare(right.candidateId)
}

function compareId(left, right) {
  return left.id.localeCompare(right.id)
}

function groupBy(records, keySelector) {
  const result = new Map()
  records.forEach((record) => {
    const key = keySelector(record)
    result.set(key, [...(result.get(key) ?? []), record])
  })
  return result
}

function uniqueBy(records, field) {
  return [...new Map(records.map((record) => [record[field], record])).values()]
}

function unique(values) {
  return [...new Set(values)]
}

function undirectedKey(source, target, type) {
  return [...[source, target].sort(), type].join('|')
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function readString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim()
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function unitNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback
}

function optionalUnitNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function cross(leftX, leftY, rightX, rightY) {
  return leftX * rightY - leftY * rightX
}

function radians(degrees) {
  return degrees * Math.PI / 180
}
