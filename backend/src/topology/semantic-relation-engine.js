import { createHash } from 'node:crypto'
import { AppError } from '../errors.js'
import {
  evaluateAccuracyGate,
  MINIMUM_HELD_OUT_SAMPLE_SIZE,
} from './topology-accuracy.js'
import { deriveTopologyDimensions } from '../domain/parser-contract.js'
import { topologyCandidateDecisionKey } from './topology-cardinality.js'

const EARTH_RADIUS_METERS = 6371008.8

export const TOPOLOGY_RULE_SET_VERSION = 'semantic-relation-engine/2.1.0'
export const TOPOLOGY_POLICY_VERSION = 'topology-policy/1.0.0'

export const DEFAULT_TOPOLOGY_POLICY = Object.freeze({
  version: TOPOLOGY_POLICY_VERSION,
  requireJbTermination: true,
  allowDirectCameraTermination: true,
  allowCableToPole: false,
  allowOpaqueJbInternalBridge: false,
  allowDirectRackEnclosureTermination: false,
})

const BUILTIN_JB_PROFILES = Object.freeze({
  main_jb: Object.freeze({
    profileId: 'builtin:main_jb',
    version: 'builtin-jb-profile/1.0.0',
    profileKind: 'main_jb',
  }),
  extended_passive: Object.freeze({
    profileId: 'builtin:extended_passive',
    version: 'builtin-jb-profile/1.0.0',
    profileKind: 'extended_passive',
  }),
  extended_poe: Object.freeze({
    profileId: 'builtin:extended_poe',
    version: 'builtin-jb-profile/1.0.0',
    profileKind: 'extended_poe',
  }),
  server_rack: Object.freeze({
    profileId: 'builtin:server_rack',
    version: 'builtin-jb-profile/1.0.0',
    profileKind: 'server_rack',
  }),
})

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
  requiredHeldOutSampleSize: MINIMUM_HELD_OUT_SAMPLE_SIZE,
  accuracyArtifact: null,
  engineBuildSha: null,
  heldOutPrecision: null,
  pathAccuracy: null,
  maxCandidateCount: 50000,
  maxGenerationMilliseconds: 60000,
  topologyPolicy: DEFAULT_TOPOLOGY_POLICY,
})

const SCORE_WEIGHTS = Object.freeze({
  interfaceCompatibility: 0.30,
  explicitEvidence: 0.25,
  distance: 0.15,
  labelCorrespondence: 0.15,
  siteContext: 0.05,
  endpointRoleConsistency: 0.05,
  capacityAvailability: 0.05,
})

/**
 * Generates reviewable relation candidates and a confirmed-only operational graph.
 * Source geometries are cloned/read only and are never snapped, split, or rewritten.
 */
export function generateRelationArtifacts(topologyInputBundle, {
  config = {},
  previousCandidates = [],
  previousRelations = [],
  previousInterfaceRegistry = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const settings = normalizeConfig(config)
  const bundle = normalizeAndValidateBundle(topologyInputBundle)
  const topologyPolicy = normalizeTopologyPolicy(
    bundle.topologyPolicy ?? settings.topologyPolicy,
  )
  const candidateBudget = createCandidateBudget(settings, bundle)
  const eligibilityIssues = []
  const lineworkIssues = []
  const nodes = prepareNodes(bundle, eligibilityIssues)
  const paths = preparePaths(bundle, eligibilityIssues, lineworkIssues)
  const interfaceRegistry = buildInterfaceRegistry(bundle, nodes, {
    paths,
    previousInterfaceRegistry,
    generatedAt,
  })
  const interfaceContext = createInterfaceContext({
    bundle,
    nodes,
    paths,
    interfaceRegistry,
    topologyPolicy,
  })
  detectDuplicateAndOverlappingLinework(paths, lineworkIssues, bundle, settings)
  assertGenerationBudget(candidateBudget, 'linework_validation')
  const spatialIndexes = buildSpatialIndexes(nodes, paths, settings)
  assertGenerationBudget(candidateBudget, 'spatial_index')
  const accuracyGate = evaluateTopologyAccuracyGate(bundle, nodes, paths, settings, generatedAt)

  const rawCandidates = [
    ...generateCableTerminationCandidates(
      paths,
      spatialIndexes,
      settings,
      interfaceContext,
      candidateBudget,
    ),
    ...generateInlineCableTerminationCandidates(
      paths,
      spatialIndexes,
      settings,
      interfaceContext,
      candidateBudget,
    ),
    ...generateMountingCandidates(nodes, spatialIndexes, settings, interfaceContext, candidateBudget),
    ...generateEndpointEndpointCandidates(spatialIndexes, settings, candidateBudget),
    ...generateIntersectionTerminationCandidates(
      spatialIndexes,
      settings,
      interfaceContext,
      candidateBudget,
    ),
    ...generateLineLabelAttachmentCandidates(
      nodes,
      paths,
      settings,
      interfaceContext,
      candidateBudget,
    ),
    ...generateInternalConnectionCandidates(interfaceContext, candidateBudget),
    ...generateExplicitCandidates(
      bundle,
      nodes,
      paths,
      eligibilityIssues,
      interfaceContext,
      candidateBudget,
    ),
  ]
  const terminationEndpointIds = new Set(rawCandidates
    .filter(({ candidateType, targetInterfaceId, targetInterface }) => (
      candidateType === 'cable_termination'
        && Boolean(targetInterfaceId ?? targetInterface?.interfaceId)
    ))
    .map(({ sourceEndpointId }) => sourceEndpointId))
  paths.flatMap(lineEndpoints).filter(({ id }) => !terminationEndpointIds.has(id))
    .forEach((endpoint) => {
      pushCandidate(rawCandidates, unresolvedTerminationCandidate(endpoint), candidateBudget, 'unresolved_termination')
    })
  const candidates = scoreAndProposeCandidates(
    rawCandidates,
    settings,
    generatedAt,
    bundle.datasetVersion.id,
    topologyPolicy,
  )
  candidates.forEach((candidate) => {
    candidate.datasetVersionId = bundle.datasetVersion.id
  })
  const reopenedReviewHistory = reconcilePreviousDecisions(candidates, previousCandidates, {
    generatedAt,
  })
  applyTopologyPolicyConstraints(
    candidates,
    paths,
    interfaceContext,
    settings,
    eligibilityIssues,
  )
  applyCapacityConstraints(
    candidates,
    nodes,
    settings,
    eligibilityIssues,
    accuracyGate,
    interfaceContext,
    previousRelations,
  )

  const confirmedRelations = buildConfirmedRelations({
    bundle,
    candidates,
    previousRelations,
    settings,
    generatedAt,
    interfaceContext,
  })
  refreshInterfaceOccupancy(interfaceRegistry, confirmedRelations)
  const graph = buildConfirmedGraph({
    bundle,
    nodes,
    paths,
    confirmedRelations,
    interfaceRegistry,
  })
  const validation = validateConfirmedGraph({
    bundle,
    nodes,
    paths,
    candidates,
    confirmedRelations,
    graph,
    lineworkIssues,
    interfaceContext,
  })
  mergeValidationIssues(validation, eligibilityIssues)
  const unresolved = buildUnresolvedEndpoints(paths, candidates)
  const summary = buildSummary({
    nodes,
    paths,
    candidates,
    confirmedRelations,
    graph,
    unresolved,
    validation,
  })
  const readiness = evaluateTopologyReadiness({
    bundle,
    nodes,
    paths,
    candidates,
    confirmedRelations,
    validation,
    settings,
    unresolved,
    accuracyGate,
  })

  return {
    schemaVersion: '1.0.0',
    datasetVersionId: bundle.datasetVersion.id,
    siteId: bundle.site,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    topologyPolicy,
    interfaceRegistry: interfaceRegistry.interfaces,
    componentRegistry: interfaceRegistry.components,
    installationGraph: graph.installationGraph,
    physicalTerminationGraph: graph.physicalTerminationGraph,
    serviceGraph: graph.serviceGraph,
    semanticRuleSetVersion: bundle.semanticRuleSetVersion,
    generatedAt,
    config: settings,
    candidates,
    confirmedRelations,
    graph,
    eligibilityIssues,
    topologyDiagnostics: interfaceContext.diagnostics,
    lineworkIssues,
    validation,
    unresolved,
    summary,
    readiness,
    reopenedReviewHistory,
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
  previousInterfaceRegistry = [],
  affectedAssetIds = [],
  eligibilityIssues = [],
  lineworkIssues = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const settings = normalizeConfig(config)
  const bundle = normalizeAndValidateBundle(topologyInputBundle)
  const topologyPolicy = normalizeTopologyPolicy(
    bundle.topologyPolicy ?? settings.topologyPolicy,
  )
  const computedEligibilityIssues = []
  const computedLineworkIssues = []
  const nodes = prepareNodes(bundle, computedEligibilityIssues)
  const paths = preparePaths(bundle, computedEligibilityIssues, computedLineworkIssues)
  const interfaceRegistry = buildInterfaceRegistry(bundle, nodes, {
    paths,
    previousInterfaceRegistry,
    generatedAt,
  })
  const interfaceContext = createInterfaceContext({
    bundle,
    nodes,
    paths,
    interfaceRegistry,
    topologyPolicy,
  })
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
    interfaceContext,
  })
  refreshInterfaceOccupancy(interfaceRegistry, confirmedRelations)
  const graph = rebuildConfirmedGraphIncrementally({
    bundle,
    nodes,
    paths,
    confirmedRelations,
    previousGraph,
    affectedAssetIds,
    interfaceRegistry,
  })
  const validation = validateConfirmedGraph({
    bundle,
    nodes,
    paths,
    candidates: normalizedCandidates,
    confirmedRelations,
    graph,
    lineworkIssues: nextLineworkIssues,
    interfaceContext,
  })
  mergeValidationIssues(validation, nextEligibilityIssues)
  const unresolved = buildUnresolvedEndpoints(paths, normalizedCandidates)
  const accuracyGate = evaluateTopologyAccuracyGate(bundle, nodes, paths, settings, generatedAt)
  const summary = buildSummary({
    nodes,
    paths,
    candidates: normalizedCandidates,
    confirmedRelations,
    graph,
    unresolved,
    validation,
  })
  const readiness = evaluateTopologyReadiness({
    bundle,
    nodes,
    paths,
    candidates: normalizedCandidates,
    confirmedRelations,
    validation,
    settings,
    unresolved,
    accuracyGate,
  })

  return {
    schemaVersion: '1.0.0',
    datasetVersionId: bundle.datasetVersion.id,
    siteId: bundle.site,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    topologyPolicy,
    interfaceRegistry: interfaceRegistry.interfaces,
    componentRegistry: interfaceRegistry.components,
    installationGraph: graph.installationGraph,
    physicalTerminationGraph: graph.physicalTerminationGraph,
    serviceGraph: graph.serviceGraph,
    semanticRuleSetVersion: bundle.semanticRuleSetVersion,
    generatedAt,
    config: settings,
    candidates: normalizedCandidates,
    confirmedRelations,
    graph,
    eligibilityIssues: nextEligibilityIssues,
    topologyDiagnostics: interfaceContext.diagnostics,
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
  const topologyPolicy = normalizeTopologyPolicy(
    bundle.topologyPolicy ?? settings.topologyPolicy,
  )
  const interfaceRegistry = buildInterfaceRegistry(bundle, nodes, {
    paths,
    previousInterfaceRegistry: bundle.interfaceRegistry ?? [],
    generatedAt,
  })
  const interfaceContext = createInterfaceContext({
    bundle,
    nodes,
    paths,
    interfaceRegistry,
    topologyPolicy,
  })
  const candidateBudget = createCandidateBudget(settings, bundle)
  const rawCandidates = generateExplicitCandidates(
    bundle,
    nodes,
    paths,
    eligibilityIssues,
    interfaceContext,
    candidateBudget,
  )
  const candidates = scoreAndProposeCandidates(
    rawCandidates,
    settings,
    generatedAt,
    bundle.datasetVersion.id,
    topologyPolicy,
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
  interfaceRegistry = { interfaces: [], components: [] },
} = {}) {
  const allNodes = asArray(nodes)
  const previousNodes = asArray(previousGraph.nodes)
  const currentNodeIds = new Set(allNodes.map(({ id }) => id))
  const previousNodeIds = new Set(previousNodes.map(({ id }) => id))
  const graphShapeChanged = currentNodeIds.size !== previousNodeIds.size
    || [...currentNodeIds].some((id) => !previousNodeIds.has(id))
  if (asArray(interfaceRegistry?.interfaces).length || previousGraph.serviceGraph) {
    return buildConfirmedGraph({
      bundle,
      nodes: allNodes,
      paths,
      confirmedRelations,
      interfaceRegistry,
    })
  }
  if (!previousNodes.length || graphShapeChanged) {
    return buildConfirmedGraph({
      bundle,
      nodes: allNodes,
      paths,
      confirmedRelations,
      interfaceRegistry,
    })
  }

  const scopeAssets = incrementalScopeAssets({
    previousGraph,
    confirmedRelations,
    affectedAssetIds,
  })
  if (!scopeAssets.size) return structuredClone(previousGraph)

  const affectedNodeIds = new Set([...scopeAssets].filter((id) => currentNodeIds.has(id)))
  if (!affectedNodeIds.size || affectedNodeIds.size === currentNodeIds.size) {
    return buildConfirmedGraph({
      bundle,
      nodes: allNodes,
      paths,
      confirmedRelations,
      interfaceRegistry,
    })
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
    interfaceRegistry,
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
    interfaceRegistry,
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
  interfaceRegistry = { interfaces: [], components: [] },
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
    interfaceRegistry: structuredClone(interfaceRegistry.interfaces ?? []),
    componentRegistry: structuredClone(interfaceRegistry.components ?? []),
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
    confirmedPathAttachmentCount: (kindCounts.path_attachment ?? 0)
      + (kindCounts.path_termination ?? 0),
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
  const legacyTopologyVersions = new Set(['semantic-relation-engine/1.0.0'])
  if (suppliedTopologyVersion
    && suppliedTopologyVersion !== TOPOLOGY_RULE_SET_VERSION
    && !legacyTopologyVersions.has(suppliedTopologyVersion)) {
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
    topologyPolicy: bundle.topologyPolicy
      ? normalizeTopologyPolicy(bundle.topologyPolicy)
      : null,
    interfaceRegistry: asArray(bundle.interfaceRegistry),
    componentInventory: asArray(bundle.componentInventory),
    jbProfiles: asArray(bundle.jbProfiles),
    internalConnections: asArray(bundle.internalConnections),
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

function mergeValidationIssues(validation, ...issueGroups) {
  if (!validation || typeof validation !== 'object') return validation
  validation.issues = mergeIssues(validation.issues, ...issueGroups)
  validation.summary = {
    total: validation.issues.length,
    errors: validation.issues.filter(({ severity }) => severity === 'error').length,
    warnings: validation.issues.filter(({ severity }) => severity === 'warning').length,
  }
  validation.status = validation.summary.errors > 0
    ? 'invalid'
    : validation.summary.total > 0 ? 'valid_with_warnings' : 'valid'
  return validation
}

export function createTopologyCandidateEligibilityContext(bundle) {
  const objects = [
    ...asArray(bundle?.classifiedNodes),
    ...asArray(bundle?.classifiedPaths),
  ]
  const objectByAlias = new Map()
  objects.forEach((object) => {
    const canonicalAssetId = objectIdentity(object)
    const aliases = [
      canonicalAssetId,
      object.assetId,
      object.stableAssetId,
      object.onboardingIdentity,
      object.legacyAssetId,
      object.sourceFeatureId,
      ...Object.values(object.identityAliases ?? {}).flat(),
    ]
    aliases.filter(Boolean).forEach((alias) => {
      if (!objectByAlias.has(alias)) objectByAlias.set(alias, object)
    })
  })
  return { objectByAlias }
}

export function evaluateTopologyCandidateEligibility(bundle, candidate, context = null) {
  const objectByAlias = context?.objectByAlias
    ? context.objectByAlias
    : createTopologyCandidateEligibilityContext(bundle).objectByAlias

  const references = [
    candidate?.sourcePathAssetId,
    candidate?.targetAssetId,
    candidate?.targetPathAssetId,
    ...asArray(candidate?.pathAssetIds),
  ].filter(Boolean).map(String)
  const issues = []
  if (candidate?.topologyRuleSetVersion
    && candidate.topologyRuleSetVersion !== TOPOLOGY_RULE_SET_VERSION) {
    issues.push({
      code: 'obsolete_rule_set',
      message: `Candidate memakai rule-set ${candidate.topologyRuleSetVersion}; regenerasi topology v2 diperlukan.`,
      currentRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
      candidateRuleSetVersion: candidate.topologyRuleSetVersion,
    })
  }
  if (!references.length) {
    issues.push({
      code: 'topology_candidate_reference_missing',
      message: 'Candidate tidak memiliki referensi topology yang dapat divalidasi.',
    })
  }
  references.forEach((reference) => {
    const object = objectByAlias.get(reference)
    if (!object) {
      issues.push({
        code: 'topology_candidate_reference_not_found',
        message: `Referensi topology ${reference} tidak ditemukan pada input terkini.`,
        reference,
      })
      return
    }
    const eligibility = topologyObjectEligibility(object)
    const currentAssetId = objectIdentity(object)
    if (eligibility) {
      issues.push({
        ...eligibility,
        reference,
        currentAssetId,
        sourceFeatureId: object.sourceFeatureId ?? null,
      })
      return
    }
    if (reference !== currentAssetId) {
      issues.push({
        code: 'topology_candidate_identity_stale',
        message: `Candidate masih memakai identity ${reference}; identity terkini adalah ${currentAssetId}.`,
        reference,
        currentAssetId,
        sourceFeatureId: object.sourceFeatureId ?? null,
      })
    }
  })
  const firstIssue = issues[0] ?? null
  return {
    eligible: issues.length === 0,
    code: firstIssue?.code ?? null,
    message: firstIssue?.message ?? null,
    references,
    issues,
  }
}

function topologyObjectEligibility(object) {
  const identityStatus = String(
    object.identityStatus ?? object.identityResolutionStatus ?? '',
  ).trim().toLowerCase()
  const stableIdentity = Boolean(readString(object.stableAssetId))
    || ['stable', 'stable_explicit', 'stable_registry'].includes(identityStatus)
    || (object.identityStatus === undefined && Boolean(readString(object.assetId)))
  if (!stableIdentity || ['onboarding', 'onboarding_candidate', 'conflict'].includes(identityStatus)) {
    return {
      code: 'missing_stable_asset_id',
      message: `Object ${object.sourceFeatureId ?? 'unknown'} belum memiliki stable Asset ID.`,
    }
  }
  if (object.sourceStatus === 'retired') {
    return {
      code: 'retired_topology_object',
      message: `Object ${object.sourceFeatureId ?? 'unknown'} berstatus retired.`,
    }
  }
  if (!readString(object.siteId)) {
    return {
      code: 'missing_topology_site',
      message: `Object ${object.sourceFeatureId ?? 'unknown'} belum memiliki site.`,
    }
  }
  if (!readString(object.networkFamily) || object.networkFamily === 'unknown') {
    return {
      code: 'unknown_network_family',
      message: `Object ${object.sourceFeatureId ?? 'unknown'} belum memiliki network family.`,
    }
  }
  return null
}

function prepareNodes(bundle, issues) {
  const geometryById = new Map(bundle.geometries.map((geometry) => [geometry.geometryId, geometry]))
  return bundle.classifiedNodes.flatMap((object) => {
    const identity = objectIdentity(object)
    const eligibility = topologyObjectEligibility(object)
    if (eligibility) {
      issues.push(topologyIssue(bundle, {
        severity: eligibility.code === 'missing_stable_asset_id' ? 'warning' : 'error',
        issueCode: eligibility.code,
        scope: 'eligibility',
        message: eligibility.message,
        entityReference: object.sourceFeatureId,
        readinessImpact: eligibility.code === 'missing_stable_asset_id' ? 'warning' : 'blocking',
      }))
      return []
    }
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
      sourceStatus: object.sourceStatus ?? 'unknown',
      topologyRequired: object.topologyRequired === true,
      sourceName: object.sourceName ?? null,
      sourceFolderPath: object.sourceFolderPath ?? null,
      networkFamily: object.networkFamily,
      serviceDomain: object.serviceDomain ?? deriveTopologyDimensions(object).serviceDomain,
      serviceDomains: structuredClone(
        object.serviceDomains ?? deriveTopologyDimensions(object).serviceDomains,
      ),
      mediaType: object.mediaType ?? deriveTopologyDimensions(object).mediaType,
      cableRole: object.cableRole ?? deriveTopologyDimensions(object).cableRole,
      objectRole: 'device_node',
      topologyRole: object.topologyRole ?? 'unknown',
      assetType: object.assetType ?? 'unknown',
      category: object.category ?? 'unknown',
      coordinate: cloneCoordinate(point.coordinates),
      geometryId: point.geometryId,
      geometryFingerprint: point.geometryFingerprint
        ?? coordinateSequenceKey([point.coordinates]),
      classificationEvidence: structuredClone(object.classificationEvidence ?? []),
      semanticDimensionEvidence: structuredClone(object.semanticDimensionEvidence ?? []),
      jbProfileId: object.jbProfileId ?? null,
      componentInventory: structuredClone(object.componentInventory ?? []),
      interfaceDefinitions: structuredClone(object.interfaceDefinitions ?? []),
      mountingRole: object.mountingRole ?? 'default',
      sourceContext: evidenceContext(object.classificationEvidence),
    }]
  }).sort(compareId)
}

function preparePaths(bundle, issues, lineworkIssues) {
  const geometryById = new Map(bundle.geometries.map((geometry) => [geometry.geometryId, geometry]))
  return bundle.classifiedPaths.flatMap((object) => {
    const identity = objectIdentity(object)
    const eligibility = topologyObjectEligibility(object)
    if (eligibility) {
      issues.push(topologyIssue(bundle, {
        severity: eligibility.code === 'missing_stable_asset_id' ? 'warning' : 'error',
        issueCode: eligibility.code,
        scope: 'eligibility',
        message: eligibility.message,
        entityReference: object.sourceFeatureId,
        readinessImpact: eligibility.code === 'missing_stable_asset_id' ? 'warning' : 'blocking',
      }))
      return []
    }
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
        sourceStatus: object.sourceStatus ?? 'unknown',
        topologyRequired: object.topologyRequired === true,
        sourceName: object.sourceName ?? null,
        sourceFolderPath: object.sourceFolderPath ?? null,
      networkFamily: object.networkFamily,
      serviceDomain: object.serviceDomain ?? deriveTopologyDimensions(object).serviceDomain,
      serviceDomains: structuredClone(
        object.serviceDomains ?? deriveTopologyDimensions(object).serviceDomains,
      ),
      mediaType: object.mediaType ?? deriveTopologyDimensions(object).mediaType,
      cableRole: object.cableRole ?? deriveTopologyDimensions(object).cableRole,
      objectRole: 'cable_path',
        assetType: object.assetType ?? 'unknown',
        category: object.category ?? 'unknown',
        geometryId: geometry.geometryId,
        geometryFingerprint: geometry.geometryFingerprint
          ?? coordinateSequenceKey(geometry.coordinates),
        coordinates,
        segmentLengths,
        cumulativeLengths,
        totalLengthMeters,
      classificationEvidence: structuredClone(object.classificationEvidence ?? []),
      semanticDimensionEvidence: structuredClone(object.semanticDimensionEvidence ?? []),
        sourceContext: evidenceContext(object.classificationEvidence),
      }]
    })
  }).sort((left, right) => (
    left.id.localeCompare(right.id) || left.geometryId.localeCompare(right.geometryId)
  ))
}

function createInterfaceContext({
  bundle,
  nodes,
  paths,
  interfaceRegistry,
  topologyPolicy,
}) {
  const interfaceById = new Map(
    asArray(interfaceRegistry?.interfaces).map((item) => [item.interfaceId, item]),
  )
  const interfacesByAssetId = new Map()
  asArray(interfaceRegistry?.interfaces).forEach((item) => {
    if (item.status === 'retired') return
    const list = interfacesByAssetId.get(item.ownerAssetId) ?? []
    list.push(item)
    interfacesByAssetId.set(item.ownerAssetId, list)
  })
  interfacesByAssetId.forEach((list) => list.sort(compareInterface))
  return {
    bundle,
    nodes,
    paths,
    topologyPolicy,
    interfaceRegistry,
    interfaceById,
    interfacesByAssetId,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    lineLabelNodesByGeometryId: new Map(),
    diagnostics: [],
  }
}

function buildInterfaceRegistry(bundle, nodes, {
  paths = [],
  previousInterfaceRegistry = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const supplied = asArray(bundle.interfaceRegistry)
  const previous = asArray(previousInterfaceRegistry)
  const previousById = new Map(
    [...previous, ...supplied]
      .filter((item) => item?.interfaceId)
      .map((item) => [String(item.interfaceId), item]),
  )
  const profileById = new Map([
    ...Object.values(BUILTIN_JB_PROFILES),
    ...asArray(bundle.jbProfiles),
  ].map((profile) => [
    String(profile.profileId ?? profile.id ?? ''),
    profile,
  ]))
  const profileByAssetType = new Map(asArray(bundle.jbProfiles)
    .flatMap((profile) => asArray(profile.assetTypes ?? profile.assetType)
      .filter(Boolean)
      .map((assetType) => [normalizeToken(assetType), profile])))
  const inventoryByAssetId = new Map()
  asArray(bundle.componentInventory).forEach((component) => {
    const ownerAssetId = component.ownerAssetId ?? component.assetId
    if (!ownerAssetId) return
    const records = inventoryByAssetId.get(String(ownerAssetId)) ?? []
    records.push(component)
    inventoryByAssetId.set(String(ownerAssetId), records)
  })
  const activeIds = new Set()
  const interfaces = []
  const components = new Map()

  nodes.slice().sort(compareId).forEach((node) => {
    const profile = profileById.get(String(node.jbProfileId ?? ''))
      ?? profileByAssetType.get(normalizeToken(node.assetType))
      ?? profileByAssetType.get(normalizeToken(node.category))
      ?? builtinProfileForNode(node)
    const suppliedRecords = supplied
      .filter((item) => item.ownerAssetId === node.id && item.status !== 'retired')
      .sort(compareInterface)
    const inventoryRecords = inventoryByAssetId.get(node.id) ?? []
    inventoryRecords.forEach((inventory) => {
      const componentId = inventory.componentId
      if (!componentId) return
      components.set(String(componentId), {
        componentId: String(componentId),
        ownerAssetId: node.id,
        componentType: inventory.componentType ?? 'device_component',
        componentName: inventory.componentName ?? null,
        profileId: inventory.profileId ?? profile?.profileId ?? profile?.id ?? null,
        status: inventory.status ?? 'active',
        assignmentSource: inventory.assignmentSource ?? 'component_inventory',
      })
    })
    const inventoryDefinitions = inventoryRecords.flatMap((inventory) => (
      asArray(inventory.interfaces ?? inventory.interfaceDefinitions)
      .map((definition) => ({
        ...definition,
        componentId: definition.componentId
          ?? inventory.componentId,
        componentType: definition.componentType
          ?? inventory.componentType,
        componentName: definition.componentName
          ?? inventory.componentName,
      }))
    ))
    const definitions = (suppliedRecords.length
      ? suppliedRecords
      : inventoryDefinitions.length
        ? inventoryDefinitions
      : interfaceDefinitionsForNode(node, profile, { paths }))
      .slice()
      .sort(compareInterfaceDefinitions)
    const usedKeys = new Set()
    definitions.flatMap((definition, definitionIndex) => {
      const normalized = normalizeInterfaceDefinition(definition, {
        node,
        profile,
        definitionIndex,
      })
      if (!normalized) return []
      return normalized._expandedDefinitions ?? [normalized]
    }).forEach((normalized) => {
      const key = `${normalized.interfaceType}|${normalized.ordinal}`
      if (usedKeys.has(key)) return
      usedKeys.add(key)
      const previousMatch = previousInterfaceFor(
        previousById,
        node.id,
        normalized,
      )
      const interfaceId = String(
        normalized.interfaceId
          ?? previousMatch?.interfaceId
          ?? `${node.id}/interface/${interfaceTypeSlug(normalized.interfaceType)}/${String(normalized.ordinal).padStart(2, '0')}`,
      )
      if (activeIds.has(interfaceId)) return
      activeIds.add(interfaceId)
      const componentId = String(
        normalized.componentId
          ?? previousMatch?.componentId
          ?? `${node.id}/component/${componentSlug(normalized.componentType ?? normalized.interfaceType)}`,
      )
      const component = {
        componentId,
        ownerAssetId: node.id,
        componentType: normalized.componentType ?? defaultComponentType(node),
        componentName: normalized.componentName ?? null,
        profileId: normalized.profileId ?? profile?.profileId ?? profile?.id ?? null,
        status: 'active',
        assignmentSource: normalized.assignmentSource
          ?? (suppliedRecords.length ? 'persisted_registry' : profile ? 'approved_profile' : 'default_site_policy'),
      }
      components.set(componentId, component)
      interfaces.push({
        interfaceId,
        ownerAssetId: node.id,
        componentId,
        interfaceType: normalized.interfaceType,
        serviceDomain: normalized.serviceDomain,
        mediaType: normalized.mediaType,
        direction: normalized.direction,
        capacity: normalized.capacity,
        occupancy: Number.isFinite(Number(previousMatch?.occupancy))
          ? Number(previousMatch.occupancy)
          : Number(normalized.occupancy ?? 0),
        profileId: normalized.profileId ?? profile?.profileId ?? profile?.id ?? null,
        assignmentSource: normalized.assignmentSource
          ?? (suppliedRecords.length ? 'persisted_registry' : profile ? 'approved_profile' : 'default_site_policy'),
        sourceFeatureId: node.sourceFeatureId ?? null,
        virtual: normalized.virtual === true,
        isProxy: normalized.isProxy === true,
        status: 'active',
        createdAt: previousMatch?.createdAt ?? generatedAt,
      })
    })
  })

  // Existing assignments are never silently re-identified. Retain missing
  // records as retired so relation history can still resolve their IDs.
  previousById.forEach((record, interfaceId) => {
    if (activeIds.has(interfaceId) || !record.ownerAssetId) return
    if (record.componentId && !components.has(record.componentId)) {
      components.set(record.componentId, {
        componentId: record.componentId,
        ownerAssetId: record.ownerAssetId,
        componentType: record.componentType ?? 'device_component',
        componentName: record.componentName ?? null,
        profileId: record.profileId ?? null,
        status: 'retired',
        assignmentSource: record.assignmentSource ?? 'persisted_registry',
      })
    }
    interfaces.push({
      ...structuredClone(record),
      interfaceId,
      status: 'retired',
      retiredAt: record.retiredAt ?? generatedAt,
    })
  })
  const sortedInterfaces = interfaces.sort(compareInterface)
  return {
    interfaces: sortedInterfaces,
    components: [...components.values()].sort((left, right) => (
      left.componentId.localeCompare(right.componentId)
    )),
  }
}

function refreshInterfaceOccupancy(interfaceRegistry, confirmedRelations = []) {
  const occupancyByInterface = new Map()
  asArray(confirmedRelations)
    .filter((relation) => (
      relation.verificationStatus === 'confirmed'
        && (relation.relationKind ?? persistedRelationKind(relation)) === 'path_termination'
        && relation.targetInterfaceId
    ))
    .forEach((relation) => {
      const interfaceId = String(relation.targetInterfaceId)
      occupancyByInterface.set(interfaceId, (occupancyByInterface.get(interfaceId) ?? 0) + 1)
    })
  interfaceRegistry.interfaces = asArray(interfaceRegistry.interfaces).map((item) => ({
    ...item,
    occupancy: occupancyByInterface.get(item.interfaceId) ?? 0,
  }))
  return interfaceRegistry
}

function interfaceDefinitionsForNode(node, profile, { paths = [] } = {}) {
  if (asArray(node.interfaceDefinitions).length) return node.interfaceDefinitions
  if (asArray(profile?.interfaces ?? profile?.interfaceDefinitions).length) {
    return profile.interfaces ?? profile.interfaceDefinitions
  }
  const text = nodeSemanticText(node)
  const type = normalizeToken(node.assetType ?? node.category)
  if (isPoleNode(node)) return []
  if (isRackNode(node) || profileKind(profile) === 'server_rack') {
    const evidence = interfaceEvidenceForNode(node, paths)
    return [
      {
        interfaceType: 'lan_port',
        ordinal: 1,
        count: evidence.lanCount,
        serviceDomain: 'data',
        mediaType: 'copper_lan',
        virtual: true,
        isProxy: true,
      },
      {
        interfaceType: 'fiber_port',
        ordinal: 1,
        count: evidence.fiberCount,
        serviceDomain: 'data',
        mediaType: 'fiber',
        virtual: true,
        isProxy: true,
      },
    ]
  }
  if (isOtbNode(node) || /otb|optical/.test(text) || type === 'otb') {
    return [{ interfaceType: 'fiber_port', ordinal: 1, count: 24, serviceDomain: 'data', mediaType: 'fiber' }]
  }
  if (isExtendedJunctionBoxNode(node) || ['extended_passive', 'extended_poe'].includes(profileKind(profile))) {
    const evidence = interfaceEvidenceForNode(node, paths)
    const definitions = [
      {
        interfaceType: 'lan_port',
        ordinal: 1,
        count: 1,
        capacity: profileKind(profile) === 'extended_poe' ? 1 : 2,
        serviceDomain: 'data',
        mediaType: 'copper_lan',
      },
    ]
    if (evidence.fiber) {
      definitions.push({
        interfaceType: 'fiber_port',
        ordinal: 1,
        count: 1,
        serviceDomain: 'data',
        mediaType: 'fiber',
      })
    }
    if (evidence.power || profileKind(profile) === 'extended_poe') {
      definitions.push(
        { interfaceType: 'power_in', ordinal: 1, count: 1, serviceDomain: 'power', mediaType: 'power_copper', direction: 'input' },
        { interfaceType: 'power_out', ordinal: 1, count: 1, serviceDomain: 'power', mediaType: 'power_copper', direction: 'output' },
      )
    }
    return definitions
  }
  if (/junction box|\bjb\b/.test(text) || type === 'junction_box') {
    return [
      { interfaceType: 'uplink_port', ordinal: 1, count: 1, serviceDomain: 'data', mediaType: 'copper_lan' },
      { interfaceType: 'lan_port', ordinal: 1, count: 8, serviceDomain: 'data', mediaType: 'copper_lan' },
      { interfaceType: 'fiber_port', ordinal: 1, count: 1, serviceDomain: 'data', mediaType: 'fiber' },
      { interfaceType: 'power_in', ordinal: 1, count: 1, serviceDomain: 'power', mediaType: 'power_copper', direction: 'input' },
      { interfaceType: 'power_out', ordinal: 1, count: 4, serviceDomain: 'power', mediaType: 'power_copper', direction: 'output' },
    ]
  }
  if (/patch.?panel/.test(text) || type === 'patch_panel') {
    return [{ interfaceType: 'patch_port', ordinal: 1, count: 24, serviceDomain: 'data', mediaType: 'copper_lan' }]
  }
  if (/switch|router|core/.test(text) || ['switch', 'router'].includes(type)) {
    return [
      { interfaceType: 'lan_port', ordinal: 1, count: 48, serviceDomain: 'data', mediaType: 'copper_lan' },
      { interfaceType: 'uplink_port', ordinal: 1, count: 4, serviceDomain: 'data', mediaType: 'copper_lan' },
      { interfaceType: 'fiber_port', ordinal: 1, count: 4, serviceDomain: 'data', mediaType: 'fiber' },
    ]
  }
  if (/pln|power source|power panel/.test(text) || ['pln_source', 'power_panel'].includes(type)) {
    return [{ interfaceType: 'power_out', ordinal: 1, count: 1, serviceDomain: 'power', mediaType: 'power_copper', direction: 'output' }]
  }
  if (/camera|cctv|nvr|server|peripheral/.test(text)
    || ['cctv_camera', 'cctv_fixed', 'cctv_ptz', 'cctv_dome', 'nvr', 'server'].includes(type)) {
    return [
      { interfaceType: 'lan_port', ordinal: 1, count: 1, serviceDomain: 'data', mediaType: 'copper_lan' },
      { interfaceType: 'power_in', ordinal: 1, count: 1, serviceDomain: 'power', mediaType: 'power_copper', direction: 'input' },
    ]
  }
  return []
}

function builtinProfileForNode(node) {
  if (isRackNode(node)) return BUILTIN_JB_PROFILES.server_rack
  if (isExtendedJunctionBoxNode(node)) {
    return /poe|power over ethernet|switch|extender/.test(nodeSemanticText(node))
      ? BUILTIN_JB_PROFILES.extended_poe
      : BUILTIN_JB_PROFILES.extended_passive
  }
  if (isJunctionBoxNode(node)) return BUILTIN_JB_PROFILES.main_jb
  return null
}

function profileKind(profile) {
  return normalizeToken(profile?.profileKind ?? profile?.kind ?? profile?.profileId)
    .replaceAll('builtin ', '')
    .replaceAll(':', ' ')
    .replaceAll(' ', '_')
}

function interfaceEvidenceForNode(node, paths) {
  const nearbyPaths = asArray(paths).filter((path) => {
    if (path.siteId !== node.siteId) return false
    if (pathLabelMatchesNode(path, node)) return true
    if (!validCoordinate(node.coordinate) || !validLineCoordinates(path.coordinates)) return false
    return nearestPointOnLine(node.coordinate, path).distanceMeters
      <= DEFAULT_RELATION_ENGINE_CONFIG.searchRadiusMeters
  })
  const evidencePaths = [...new Map(nearbyPaths.map((path) => [
    path.id ?? path.geometryId,
    path,
  ])).values()]
  const dataPaths = evidencePaths.filter((path) => (
    (path.serviceDomain ?? deriveTopologyDimensions(path).serviceDomain) === 'data'
  ))
  const fiberPaths = dataPaths.filter((path) => (
    (path.mediaType ?? deriveTopologyDimensions(path).mediaType) === 'fiber'
      || path.networkFamily === 'fiber_optic'
  ))
  const lanPaths = dataPaths.filter((path) => !fiberPaths.includes(path)
    && (path.mediaType ?? deriveTopologyDimensions(path).mediaType) !== 'power_copper')
  return {
    fiber: fiberPaths.length > 0,
    power: evidencePaths.some((path) => (
      (path.serviceDomain ?? deriveTopologyDimensions(path).serviceDomain) === 'power'
    )),
    data: dataPaths.length > 0,
    fiberCount: Math.max(1, fiberPaths.length),
    lanCount: Math.max(1, lanPaths.length),
  }
}

function normalizeInterfaceDefinition(definition, { node, profile, definitionIndex }) {
  if (!definition || typeof definition !== 'object') return null
  const interfaceType = normalizeInterfaceType(
    definition.interfaceType ?? definition.type ?? definition.kind,
  )
  if (!interfaceType) return null
  const count = Math.max(1, Number.isInteger(Number(definition.count))
    ? Number(definition.count)
    : 1)
  const ordinal = Number.isInteger(Number(definition.ordinal))
    ? Number(definition.ordinal)
    : definitionIndex + 1
  const serviceDomain = normalizeServiceDomain(
    definition.serviceDomain ?? defaultServiceDomainForInterface(interfaceType),
  )
  const mediaType = normalizeMediaType(
    definition.mediaType ?? defaultMediaTypeForInterface(interfaceType),
  )
  const direction = normalizeInterfaceDirection(
    definition.direction ?? defaultDirectionForInterface(interfaceType),
  )
  const capacity = Math.max(1, Number(definition.capacity ?? 1))
  const records = []
  for (let offset = 0; offset < count; offset += 1) {
    records.push({
      ...definition,
      interfaceId: count === 1 && definition.interfaceId
        ? definition.interfaceId
        : count === 1 ? null : null,
      interfaceType,
      serviceDomain,
      mediaType,
      direction,
      capacity,
      ordinal: ordinal + offset,
      profileId: definition.profileId ?? profile?.profileId ?? profile?.id ?? null,
      virtual: definition.virtual === true,
      isProxy: definition.isProxy === true,
      componentType: definition.componentType,
      componentName: definition.componentName,
      assignmentSource: definition.assignmentSource,
    })
  }
  // The caller expects one definition per generated record. Return the first
  // and attach expansion metadata for deterministic expansion below.
  return records.length === 1
    ? records[0]
    : { ...records[0], _expandedDefinitions: records }
}

function previousInterfaceFor(previousById, ownerAssetId, definition) {
  return [...previousById.values()]
    .filter((record) => (
      record.ownerAssetId === ownerAssetId
        && record.interfaceType === definition.interfaceType
        && Number(record.ordinal) === Number(definition.ordinal)
    ))
    .sort(compareInterface)[0] ?? null
}

function normalizeInterfaceType(value) {
  const normalized = normalizeToken(value).replaceAll(' ', '_')
  return {
    lan: 'lan_port',
    ethernet: 'lan_port',
    ethernet_port: 'lan_port',
    lan_port: 'lan_port',
    fiber: 'fiber_port',
    fibre: 'fiber_port',
    fiber_port: 'fiber_port',
    uplink: 'uplink_port',
    uplink_port: 'uplink_port',
    power_in: 'power_in',
    power_input: 'power_in',
    power_out: 'power_out',
    power_output: 'power_out',
    splice: 'splice_slot',
    splice_slot: 'splice_slot',
    patch: 'patch_port',
    patch_port: 'patch_port',
    server_nic: 'server_nic',
    nic: 'server_nic',
  }[normalized] ?? null
}

function interfaceTypeSlug(value) {
  return {
    lan_port: 'lan',
    fiber_port: 'fiber',
    uplink_port: 'uplink',
    power_in: 'power-in',
    power_out: 'power-out',
    splice_slot: 'splice',
    patch_port: 'patch',
    server_nic: 'nic',
  }[value] ?? String(value).replaceAll('_', '-').replace(/[^a-z0-9-]/gi, '')
}

function componentSlug(value) {
  return normalizeToken(value).replaceAll(' ', '-') || 'component'
}

function defaultComponentType(node) {
  if (isJunctionBoxNode(node)) return 'opaque_jb_profile'
  if (isRackNode(node)) return 'rack_proxy'
  return 'device'
}

function compareInterface(left, right) {
  return String(left.interfaceId ?? '').localeCompare(String(right.interfaceId ?? ''))
}

function compareInterfaceDefinitions(left, right) {
  return Number(left?.ordinal ?? Number.MAX_SAFE_INTEGER)
    - Number(right?.ordinal ?? Number.MAX_SAFE_INTEGER)
    || String(left?.interfaceType ?? left?.type ?? '').localeCompare(
      String(right?.interfaceType ?? right?.type ?? ''),
    )
    || stableStringify(left).localeCompare(stableStringify(right))
}

function normalizeInterfaceDirection(value) {
  const normalized = String(value ?? 'undirected').trim().toLowerCase()
  return ['input', 'output', 'undirected', 'bidirectional'].includes(normalized)
    ? normalized
    : 'undirected'
}

function defaultDirectionForInterface(interfaceType) {
  if (interfaceType === 'power_in') return 'input'
  if (interfaceType === 'power_out') return 'output'
  return 'bidirectional'
}

function defaultServiceDomainForInterface(interfaceType) {
  return ['power_in', 'power_out'].includes(interfaceType) ? 'power' : 'data'
}

function defaultMediaTypeForInterface(interfaceType) {
  if (['power_in', 'power_out'].includes(interfaceType)) return 'power_copper'
  if (['fiber_port', 'splice_slot'].includes(interfaceType)) return 'fiber'
  return 'copper_lan'
}

function normalizeServiceDomain(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ['data', 'power', 'mounting', 'unknown'].includes(normalized)
    ? normalized
    : 'unknown'
}

function normalizeMediaType(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replaceAll('-', '_')
  return ['copper_lan', 'fiber', 'power_copper', 'none', 'unknown'].includes(normalized)
    ? normalized
    : 'unknown'
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

function generateCableTerminationCandidates(
  paths,
  spatialIndexes,
  settings,
  interfaceContext,
  candidateBudget,
) {
  const candidates = []
  paths.filter((path) => !path.duplicateOfGeometryId).forEach((path) => {
    assertGenerationBudget(candidateBudget, 'cable_termination')
    const labelNodes = path.sourceName
      ? lineLabelNodesForPath(path, interfaceContext)
      : []
    lineEndpoints(path).forEach((endpoint) => {
      spatialIndexes.nodes.queryPoint(
        endpoint.coordinate,
        settings.searchRadiusMeters,
      ).forEach((node) => {
        const distanceMeters = geographicDistanceMeters(endpoint.coordinate, node.coordinate)
        if (distanceMeters > settings.searchRadiusMeters) return
        if (isPoleNode(node) && interfaceContext.topologyPolicy.allowCableToPole !== true) {
          recordForbiddenTargetDiagnostic(interfaceContext, {
            path,
            endpoint,
            node,
            distanceMeters,
          })
          return
        }
        const compatible = compatibleInterfacesForPath(
          path,
          node,
          interfaceContext,
          labelEndpointRole(node, labelNodes, endpoint.role),
        )
        if (!compatible.length) {
          if (nodeHasTopologyInterface(node, interfaceContext)) {
            interfaceContext.diagnostics.push({
              code: 'incompatible_interface',
              issueCode: 'interface_media_mismatch',
              severity: 'warning',
              sourceEndpointId: endpoint.id,
              targetAssetId: node.id,
              message: `Tidak ada interface ${path.mediaType}/${path.serviceDomain} yang compatible pada ${node.id}.`,
            })
          }
          return
        }
        compatible.forEach(({ item, score, ruleId, explanation, capacityAvailable }) => {
          pushCandidate(candidates, baseCandidate({
            candidateType: 'cable_termination',
            sourceEndpointId: endpoint.id,
            sourcePath: path,
            targetAssetId: node.id,
            targetNode: node,
            distanceMeters,
            sourceCoordinate: endpoint.coordinate,
            targetCoordinate: node.coordinate,
            measureMeters: endpoint.measureMeters,
            semanticCompatibility: score,
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
              ruleId,
              observedValue: `${path.serviceDomain}:${path.mediaType}:${item.interfaceType}`,
              normalizedValue: true,
              weight: SCORE_WEIGHTS.interfaceCompatibility,
              explanation,
            }],
            targetInterface: item,
            serviceDomain: path.serviceDomain,
            mediaType: path.mediaType,
            cableRole: path.cableRole,
            capacityAvailable,
          }), candidateBudget, 'cable_termination')
        })
      })
    })
  })
  return candidates
}

function generateInlineCableTerminationCandidates(
  paths,
  spatialIndexes,
  settings,
  interfaceContext,
  candidateBudget,
) {
  const candidates = []
  interfaceContext.nodes.filter(inlineNodeAllowed).forEach((node) => {
    assertGenerationBudget(candidateBudget, 'inline_cable_termination')
    spatialIndexes.segments.queryPoint(node.coordinate, settings.inlineSearchRadiusMeters)
      .filter((path) => !path.duplicateOfGeometryId)
      .forEach((path) => {
        const nearest = nearestPointOnLine(node.coordinate, path)
        if (nearest.distanceMeters > settings.inlineSearchRadiusMeters) return
        if (nearest.measureMeters <= settings.minimumInlineEndpointDistanceMeters
          || path.totalLengthMeters - nearest.measureMeters
            <= settings.minimumInlineEndpointDistanceMeters) return
        const compatible = compatibleInterfacesForPath(
          path,
          node,
          interfaceContext,
          'inline',
        )
        compatible.forEach(({ item, score, ruleId, explanation, capacityAvailable }) => {
          pushCandidate(candidates, baseCandidate({
            candidateType: 'cable_termination',
            sourceEndpointId: `inline:${path.geometryId}:${node.id}`,
            sourcePath: path,
            targetAssetId: node.id,
            targetNode: node,
            targetInterface: item,
            distanceMeters: nearest.distanceMeters,
            sourceCoordinate: nearest.projectedCoordinate,
            targetCoordinate: node.coordinate,
            measureMeters: nearest.measureMeters,
            semanticCompatibility: score,
            endpointRole: endpointRoleScore(node, true),
            sourceContext: contextScore(path.sourceContext, node.sourceContext),
            styleConsistency: styleConsistencyScore(path, node),
            angleScore: 1,
            graphConsistency: 1,
            serviceDomain: path.serviceDomain,
            mediaType: path.mediaType,
            cableRole: path.cableRole,
            capacityAvailable,
            provenance: 'inline_device_inference',
            evidence: [{
              source: 'spatial',
              ruleId: 'inline.closest-point-derived-anchor',
              observedValue: nearest.distanceMeters,
              normalizedValue: `${nearest.distanceMeters.toFixed(3)}m`,
              weight: SCORE_WEIGHTS.distance,
              explanation: 'JB Extended berada di tengah geometri kabel dan diproyeksikan ke measure kabel.',
            }, {
              source: 'semantic',
              ruleId,
              observedValue: `${path.serviceDomain}:${path.mediaType}:${item.interfaceType}`,
              normalizedValue: true,
              weight: SCORE_WEIGHTS.interfaceCompatibility,
              explanation,
            }],
          }), candidateBudget, 'inline_cable_termination')
        })
      })
  })
  return candidates
}

function generateMountingCandidates(
  nodes,
  spatialIndexes,
  settings,
  interfaceContext,
  candidateBudget,
) {
  const candidates = []
  nodes.filter(isMountableAsset).forEach((child) => {
    assertGenerationBudget(candidateBudget, 'mounting_attachment')
    spatialIndexes.nodes.queryPoint(child.coordinate, settings.searchRadiusMeters)
      .filter((host) => isPoleNode(host) && host.id !== child.id)
      .forEach((host) => {
        const distanceMeters = geographicDistanceMeters(child.coordinate, host.coordinate)
        if (distanceMeters > settings.searchRadiusMeters) return
        const base = baseCandidate({
          candidateType: 'mounting_attachment',
          sourceEndpointId: `mounting:${child.id}:${child.mountingRole ?? 'default'}`,
          sourcePath: child,
          targetAssetId: host.id,
          targetNode: host,
          distanceMeters,
          sourceCoordinate: child.coordinate,
          targetCoordinate: host.coordinate,
          measureMeters: null,
          semanticCompatibility: 1,
          endpointRole: 1,
          sourceContext: contextScore(child.sourceContext, host.sourceContext),
          styleConsistency: styleConsistencyScore(child, host),
          angleScore: 1,
          graphConsistency: 1,
          evidence: [{
            source: 'spatial',
            ruleId: 'mounting.host-within-search-radius',
            observedValue: distanceMeters,
            normalizedValue: `${distanceMeters.toFixed(3)}m`,
            weight: SCORE_WEIGHTS.distance,
            explanation: 'Asset yang dapat dipasang berada dekat tiang host.',
          }, {
            source: 'semantic',
            ruleId: 'mounting.host-role-pole',
            observedValue: host.assetType,
            normalizedValue: true,
            weight: SCORE_WEIGHTS.interfaceCompatibility,
            explanation: 'Tiang hanya digunakan sebagai host pemasangan.',
          }],
          serviceDomain: 'mounting',
          mediaType: 'none',
          cableRole: 'mounting',
        })
        base.relationKind = 'installation_attachment'
        base.relationType = 'mounted_on'
        base.mountingRole = child.mountingRole ?? 'default'
        pushCandidate(candidates, base, candidateBudget, 'mounting_attachment')
      })
  })
  return candidates
}

function generateInternalConnectionCandidates(interfaceContext, candidateBudget) {
  const candidates = []
  internalConnectionDefinitions(interfaceContext).forEach((definition) => {
    assertGenerationBudget(candidateBudget, 'jb_internal_connection')
    const source = interfaceContext.interfaceById.get(definition.sourceInterfaceId)
    const target = interfaceContext.interfaceById.get(definition.targetInterfaceId)
    if (!source || !target || source.status === 'retired' || target.status === 'retired') return
    if (source.ownerAssetId !== target.ownerAssetId) return
    const sourceNode = interfaceContext.nodeById.get(source.ownerAssetId)
    if (!sourceNode) return
    const serviceDomain = normalizeServiceDomain(
      definition.serviceDomain ?? source.serviceDomain,
    )
    if (serviceDomain === 'mounting') return
    candidates.push({
      candidateType: 'jb_internal_connection',
      candidateId: null,
      datasetVersionId: null,
      siteId: sourceNode.siteId,
      sourceEndpointId: `internal:${source.interfaceId}:${target.interfaceId}`,
      sourcePathAssetId: null,
      targetAssetId: target.ownerAssetId,
      sourceAssetId: source.ownerAssetId,
      sourceInterfaceId: source.interfaceId,
      targetInterfaceId: target.interfaceId,
      sourceObjectRole: 'device_node',
      targetObjectRole: 'device_node',
      topologyRequired: false,
      relationKind: 'internal_connection',
      relationType: 'internally_connected_to',
      serviceDomain,
      mediaType: normalizeMediaType(definition.mediaType ?? source.mediaType),
      cableRole: 'unknown',
      provenance: definition.provenance ?? 'approved_jb_profile',
      profileVersion: definition.profileVersion ?? null,
      autoConfirm: definition.approved === true || definition.provenance === 'approved_jb_profile',
      components: {
        interfaceCompatibility: 1,
        explicitEvidence: definition.approved === true ? 1 : 0.9,
        distance: 1,
        labelCorrespondence: 1,
        siteContext: 1,
        endpointRoleConsistency: 1,
        capacityAvailability: 1,
      },
      evidence: [{
        source: definition.provenance ?? 'approved_jb_profile',
        ruleId: 'jb.internal-connection.approved-evidence',
        observedValue: `${source.interfaceId}->${target.interfaceId}`,
        normalizedValue: serviceDomain,
        weight: SCORE_WEIGHTS.explicitEvidence,
        explanation: 'Hubungan internal hanya dibuat dari profile/evidence yang disetujui.',
      }],
      sourceGeometryIds: [],
      sourceGeometryFingerprints: [],
      sourceCoordinate: sourceNode.coordinate,
      targetCoordinate: sourceNode.coordinate,
      networkFamily: sourceNode.networkFamily,
    })
  })
  return candidates
}

function internalConnectionDefinitions(interfaceContext) {
  const bundle = interfaceContext.bundle
  const definitions = [
    ...asArray(bundle.internalConnections),
    ...asArray(bundle.componentInventory).flatMap((component) => (
      asArray(component.internalConnections ?? component.internalConnectionDefinitions).map((connection) => ({
        ...connection,
        ownerAssetId: connection.ownerAssetId
          ?? component.ownerAssetId
          ?? component.assetId,
        provenance: connection.provenance ?? 'component_inventory',
      }))
    )),
    ...asArray(bundle.jbProfiles).flatMap((profile) => (
      profile.approved === true || profile.status === 'approved'
        ? asArray(profile.internalConnections).map((connection) => ({
          ...connection,
          profileVersion: connection.profileVersion ?? profile.version ?? profile.profileVersion ?? null,
          provenance: connection.provenance ?? 'approved_jb_profile',
          approved: true,
          profileId: connection.profileId ?? profile.profileId ?? profile.id ?? null,
        }))
        : []
    )),
  ]
  return definitions.flatMap((definition) => (
    expandInternalConnectionDefinition(definition, interfaceContext)
  ))
}

function expandInternalConnectionDefinition(definition, interfaceContext) {
  const sourceReference = definition.sourceInterfaceId ?? definition.source
  const targetReference = definition.targetInterfaceId ?? definition.target
  const ownerAssetId = definition.ownerAssetId ?? definition.assetId ?? null
  const candidateNodes = ownerAssetId
    ? [interfaceContext.nodeById.get(String(ownerAssetId))].filter(Boolean)
    : interfaceContext.nodes.filter((node) => profileMatchesNode(definition, node))
  if (!candidateNodes.length && sourceReference && targetReference) {
    return [{
      ...definition,
      sourceInterfaceId: sourceReference,
      targetInterfaceId: targetReference,
    }]
  }
  return candidateNodes.flatMap((node) => {
    const interfaces = interfaceContext.interfacesByAssetId.get(node.id) ?? []
    const sourceInterfaceId = resolveInternalInterfaceReference(
      sourceReference,
      definition.sourceInterfaceType ?? definition.sourceType,
      definition.sourceInterfaceOrdinal ?? definition.sourceOrdinal,
      node,
      interfaces,
    )
    const targetInterfaceId = resolveInternalInterfaceReference(
      targetReference,
      definition.targetInterfaceType ?? definition.targetType,
      definition.targetInterfaceOrdinal ?? definition.targetOrdinal,
      node,
      interfaces,
    )
    if (!sourceInterfaceId || !targetInterfaceId) return []
    return [{
      ...definition,
      sourceInterfaceId,
      targetInterfaceId,
    }]
  })
}

function profileMatchesNode(definition, node) {
  if (!definition.profileId && !definition.profileKind) return true
  const nodeProfileId = String(node.jbProfileId ?? '')
  const profile = builtinProfileForNode(node)
  const nodeProfileKind = profileKind(profile)
  const expectedId = String(definition.profileId ?? '')
  const expectedKind = normalizeToken(definition.profileKind ?? '').replaceAll(' ', '_')
  return (expectedId && nodeProfileId === expectedId)
    || (expectedKind && nodeProfileKind === expectedKind)
}

function resolveInternalInterfaceReference(reference, interfaceType, ordinal, node, interfaces) {
  const normalizedType = normalizeInterfaceType(interfaceType ?? reference)
  const normalizedOrdinal = Number.isInteger(Number(ordinal)) ? Number(ordinal) : 1
  if (reference) {
    const raw = String(reference)
    const expanded = raw
      .replaceAll('{assetId}', node.id)
      .replaceAll('{ownerAssetId}', node.id)
      .replaceAll('$assetId', node.id)
    const candidates = [
      expanded,
      expanded.startsWith('interface/') ? `${node.id}/${expanded}` : null,
      expanded.includes('/') && !expanded.startsWith(`${node.id}/`)
        ? `${node.id}/interface/${expanded}` : null,
    ].filter(Boolean)
    const exact = candidates.find((candidate) => (
      interfaces.some(({ interfaceId }) => interfaceId === candidate)
    ))
    if (exact) return exact
  }
  if (!normalizedType) return null
  return interfaces.find((item) => (
    item.interfaceType === normalizedType
      && Number(item.ordinal) === normalizedOrdinal
      && item.status !== 'retired'
  ))?.interfaceId ?? null
}

function recordForbiddenTargetDiagnostic(interfaceContext, {
  path,
  endpoint,
  node,
  distanceMeters,
}) {
  const key = `${endpoint.id}|${node.id}`
  if (interfaceContext.diagnostics.some((item) => item.key === key)) return
  interfaceContext.diagnostics.push({
    key,
    code: 'forbidden_target_role',
    issueCode: 'cable_terminated_at_pole',
    severity: 'warning',
    sourceEndpointId: endpoint.id,
    sourcePathAssetId: path.id,
    targetAssetId: node.id,
    targetRole: 'pole',
    distanceMeters,
    message: `Tiang ${node.id} diabaikan sebagai target kabel; tiang hanya host pemasangan.`,
  })
}

function unresolvedTerminationCandidate(endpoint) {
  const path = endpoint.path
  const dimensions = deriveTopologyDimensions(path)
  return {
    candidateType: 'unresolved_termination',
    siteId: path.siteId,
    networkFamily: path.networkFamily,
    sourceEndpointId: endpoint.id,
    sourcePathAssetId: path.id,
    sourceFeatureId: path.sourceFeatureId,
    sourceObjectRole: 'cable_path',
    targetObjectRole: null,
    topologyRequired: path.topologyRequired === true,
    distanceMeters: null,
    measureMeters: endpoint.measureMeters,
    sourceCoordinate: cloneCoordinate(endpoint.coordinate),
    targetCoordinate: null,
    serviceDomain: path.serviceDomain ?? dimensions.serviceDomain,
    mediaType: path.mediaType ?? dimensions.mediaType,
    cableRole: path.cableRole ?? dimensions.cableRole,
    components: {
      interfaceCompatibility: 0,
      explicitEvidence: 0,
      distance: 0,
      labelCorrespondence: 0,
      siteContext: 1,
      endpointRoleConsistency: 0,
      capacityAvailability: 0,
    },
    evidence: [{
      source: 'diagnostic',
      ruleId: 'termination.no-compatible-interface',
      observedValue: endpoint.id,
      normalizedValue: 'unresolved',
      weight: 1,
      explanation: 'Tidak ada target interface yang lolos semantic hard gate.',
    }],
    sourceGeometryIds: [path.geometryId],
    sourceGeometryFingerprints: [path.geometryFingerprint].filter(Boolean),
  }
}

function generateEndpointDeviceCandidates(paths, spatialIndexes, settings, candidateBudget) {
  const candidates = []
  paths.filter((path) => !path.duplicateOfGeometryId).forEach((path) => {
    assertGenerationBudget(candidateBudget, 'endpoint_device')
    lineEndpoints(path).forEach((endpoint) => {
      spatialIndexes.nodes.queryPoint(
        endpoint.coordinate,
        settings.searchRadiusMeters,
      ).forEach((node) => {
        const compatibility = compatiblePathNode(path, node)
        if (!compatibility.compatible) return
        const distanceMeters = geographicDistanceMeters(endpoint.coordinate, node.coordinate)
        if (distanceMeters > settings.searchRadiusMeters) return
        pushCandidate(candidates, baseCandidate({
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
        }), candidateBudget, 'endpoint_device')
      })
    })
  })
  return candidates
}

function generateInlineDeviceCandidates(nodes, spatialIndexes, settings, candidateBudget) {
  const candidates = []
  nodes.filter(inlineNodeAllowed).forEach((node) => {
    assertGenerationBudget(candidateBudget, 'inline_device')
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
      pushCandidate(candidates, baseCandidate({
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
      }), candidateBudget, 'inline_device')
    })
  })
  return candidates
}

function generateEndpointEndpointCandidates(spatialIndexes, settings, candidateBudget) {
  const endpointRecords = spatialIndexes.endpointRecords
  const candidates = []
  const seenPairs = new Set()
  endpointRecords.forEach((left) => {
    assertGenerationBudget(candidateBudget, 'endpoint_endpoint')
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
      pushCandidate(candidates, baseCandidate({
        candidateType: 'path_continuation',
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
      }), candidateBudget, 'path_continuation')
    })
  })
  return candidates
}

function generateIntersectionTerminationCandidates(
  spatialIndexes,
  settings,
  interfaceContext,
  candidateBudget,
) {
  const candidates = []
  spatialIndexes.segments.pathPairs().forEach(([left, right]) => {
    assertGenerationBudget(candidateBudget, 'intersection_termination')
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
          && compatibleInterfacesForPath(left, node, interfaceContext).length
          && compatibleInterfacesForPath(right, node, interfaceContext).length
        ))
        .map((node) => ({
          node,
          distanceMeters: geographicDistanceMeters(intersection.coordinate, node.coordinate),
        }))
        .filter(({ distanceMeters }) => distanceMeters <= settings.intersectionToleranceMeters)
        .sort((a, b) => a.distanceMeters - b.distanceMeters || compareId(a.node, b.node))
      if (!junctions.length) return
      const selected = junctions[0]
      ;[
        {
          path: left,
          measureMeters: intersection.leftMeasureMeters,
          side: 'left',
          interfaces: compatibleInterfacesForPath(
            left,
            selected.node,
            interfaceContext,
            labelEndpointRole(
              selected.node,
              left.sourceName ? lineLabelNodesForPath(left, interfaceContext) : [],
              null,
            ),
          ),
        },
        {
          path: right,
          measureMeters: intersection.rightMeasureMeters,
          side: 'right',
          interfaces: compatibleInterfacesForPath(
            right,
            selected.node,
            interfaceContext,
            labelEndpointRole(
              selected.node,
              right.sourceName ? lineLabelNodesForPath(right, interfaceContext) : [],
              null,
            ),
          ),
        },
      ].filter(({ path, measureMeters }) => (
        !isRackLabelledEndpointIntersection(path, measureMeters, selected.node, interfaceContext)
      )).forEach(({ path, measureMeters, side, interfaces }) => {
        interfaces.forEach(({ item, score, ruleId, explanation, capacityAvailable }) => {
          pushCandidate(candidates, baseCandidate({
            candidateType: 'cable_termination',
            sourceEndpointId: `intersection:${left.geometryId}:${right.geometryId}:${intersectionIndex}:${side}`,
            sourcePath: path,
            targetAssetId: selected.node.id,
            targetNode: selected.node,
            distanceMeters: selected.distanceMeters,
            sourceCoordinate: intersection.coordinate,
            targetCoordinate: selected.node.coordinate,
            measureMeters,
            semanticCompatibility: score,
            endpointRole: 1,
            sourceContext: contextScore(path.sourceContext, selected.node.sourceContext),
            styleConsistency: 1,
            angleScore: 1,
            graphConsistency: 1,
            targetInterface: item,
            serviceDomain: path.serviceDomain,
            mediaType: path.mediaType,
            cableRole: path.cableRole,
            capacityAvailable,
            provenance: 'intersection_junction_inference',
            evidence: [{
              source: 'junction',
              ruleId: 'intersection.classified-junction-required',
              observedValue: selected.node.assetType,
              normalizedValue: selected.node.id,
              weight: SCORE_WEIGHTS.explicitEvidence,
              explanation: 'Persilangan hanya menjadi termination karena ada classified junction.',
            }, {
              source: 'semantic',
              ruleId,
              observedValue: `${path.serviceDomain}:${path.mediaType}:${item.interfaceType}`,
              normalizedValue: true,
              weight: SCORE_WEIGHTS.interfaceCompatibility,
              explanation,
            }],
          }), candidateBudget, 'intersection_termination')
        })
      })
    })
  })
  return candidates
}

function isRackLabelledEndpointIntersection(path, measureMeters, node, interfaceContext) {
  if (!isRackNode(node) || !path.sourceName) return false
  const endpointDistance = Math.min(measureMeters, path.totalLengthMeters - measureMeters)
  if (endpointDistance > 0.01) return false
  return lineLabelNodesForPath(path, interfaceContext)
    .some(({ id }) => id === node.id)
}

function generateLineLabelConnectionCandidates(nodes, paths, candidateBudget) {
  const candidates = []
  paths.filter((path) => path.sourceName).forEach((path) => {
    assertGenerationBudget(candidateBudget, 'line_label_connection')
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
      pushCandidate(candidates, candidate, candidateBudget, 'line_label_connection')
    }
  })
  return candidates
}

function generateLineLabelAttachmentCandidates(
  nodes,
  paths,
  settings,
  interfaceContext,
  candidateBudget,
) {
  const candidates = []
  const labeledPathRecords = paths
    .filter((path) => path.sourceName)
    .map((path) => ({
      path,
      matchedNodes: lineLabelNodesForPath(path, interfaceContext),
    }))
  const proxyInterfaceAssignments = buildLineLabelProxyInterfaceAssignments(
    labeledPathRecords,
    interfaceContext,
  )
  labeledPathRecords.forEach(({ path, matchedNodes }) => {
    assertGenerationBudget(candidateBudget, 'line_label_attachment')
    if (matchedNodes.length < 2) return
    assignLineLabelNodes(path, matchedNodes).forEach(({ node: targetNode, endpoint, nearest }) => {
      const compatibility = compatiblePathNode(path, targetNode)
      if (!compatibility.compatible) return
      const distanceMeters = endpoint
        ? geographicDistanceMeters(endpoint.coordinate, targetNode.coordinate)
        : nearest.distanceMeters
      if (distanceMeters > settings.searchRadiusMeters) return
      const compatibleInterfaces = compatibleInterfacesForPath(
        path,
        targetNode,
        interfaceContext,
        labelEndpointRole(targetNode, matchedNodes, endpoint?.role ?? 'inline'),
      )
      const sourceEndpointId = endpoint?.id ?? `inline:${path.geometryId}:${targetNode.id}`
      const selectedInterfaces = lineLabelInterfacesForTarget(
        path,
        targetNode,
        sourceEndpointId,
        compatibleInterfaces,
        proxyInterfaceAssignments,
      )
      selectedInterfaces.forEach(({ item, score, ruleId, explanation, capacityAvailable }) => {
        const candidate = baseCandidate({
          candidateType: 'cable_termination',
          sourceEndpointId,
          sourcePath: path,
          targetAssetId: targetNode.id,
          targetNode,
          targetInterface: item,
          distanceMeters,
          sourceCoordinate: endpoint?.coordinate ?? nearest.projectedCoordinate,
          targetCoordinate: targetNode.coordinate,
          measureMeters: endpoint?.measureMeters ?? nearest.measureMeters,
          semanticCompatibility: Math.min(compatibility.score, score),
          endpointRole: endpointRoleScore(targetNode, false),
          sourceContext: 1,
          styleConsistency: 1,
          angleScore: 1,
          graphConsistency: 1,
          serviceDomain: path.serviceDomain,
          mediaType: path.mediaType,
          cableRole: path.cableRole,
          capacityAvailable,
          provenance: 'line_label_inference',
          evidence: [{
            source: 'line_label',
            ruleId: 'line.name.endpoint-attachment',
            observedValue: path.sourceName,
            normalizedValue: `${endpoint?.role ?? 'inline'}:${targetNode.id}:${item.interfaceId}`,
            weight: SCORE_WEIGHTS.labelCorrespondence,
            explanation: 'Nama device pada garis menentukan target interface kabel.',
          }, {
            source: 'semantic',
            ruleId,
            observedValue: `${path.serviceDomain}:${path.mediaType}:${item.interfaceType}`,
            normalizedValue: true,
            weight: SCORE_WEIGHTS.interfaceCompatibility,
            explanation,
          }, {
            source: 'spatial',
            ruleId: 'line.endpoint.within-search-radius',
            observedValue: distanceMeters,
            normalizedValue: `${distanceMeters.toFixed(3)}m`,
            weight: SCORE_WEIGHTS.distance,
            explanation: `Endpoint garis berada dalam radius ${settings.searchRadiusMeters} meter dari device hasil pembacaan nama garis.`,
          }],
        })
        candidate.lineLabelEvidence = true
        pushCandidate(candidates, candidate, candidateBudget, 'line_label_attachment')
      })
    })
  })
  return candidates
}

function buildLineLabelProxyInterfaceAssignments(pathRecords, interfaceContext) {
  const groups = new Map()
  pathRecords.forEach(({ path, matchedNodes }) => {
    if (matchedNodes.length < 2) return
    assignLineLabelNodes(path, matchedNodes).forEach(({ node: targetNode, endpoint }) => {
      if (!isRackNode(targetNode)) return
      const endpointRole = labelEndpointRole(
        targetNode,
        matchedNodes,
        endpoint?.role ?? 'inline',
      )
      const compatibleInterfaces = compatibleInterfacesForPath(
        path,
        targetNode,
        interfaceContext,
        endpointRole,
      )
      const proxyInterfaces = compatibleInterfaces.filter(({ item }) => (
        item.isProxy === true || item.virtual === true
      ))
      if (!proxyInterfaces.length) return
      const sourceEndpointId = endpoint?.id ?? `inline:${path.geometryId}:${targetNode.id}`
      const recordKey = lineLabelProxyAllocationKey(path, targetNode, sourceEndpointId)
      const interfaceClass = unique(proxyInterfaces.map(({ item }) => (
        `${item.interfaceType}:${item.serviceDomain}:${item.mediaType}`
      ))).sort().join(',')
      const groupKey = [
        targetNode.id,
        path.serviceDomain ?? 'unknown',
        path.mediaType ?? 'unknown',
        interfaceClass,
      ].join('|')
      const records = groups.get(groupKey) ?? []
      if (records.some((record) => record.recordKey === recordKey)) return
      records.push({
        recordKey,
        pathId: path.id,
        geometryId: path.geometryId,
        proxyInterfaces,
      })
      groups.set(groupKey, records)
    })
  })

  const assignments = new Map()
  groups.forEach((records) => {
    const commonInterfaceIds = new Set(
      records[0].proxyInterfaces.map(({ item }) => item.interfaceId),
    )
    records.slice(1).forEach((record) => {
      const recordInterfaceIds = new Set(
        record.proxyInterfaces.map(({ item }) => item.interfaceId),
      )
      commonInterfaceIds.forEach((interfaceId) => {
        if (!recordInterfaceIds.has(interfaceId)) commonInterfaceIds.delete(interfaceId)
      })
    })
    const orderedInterfaces = records[0].proxyInterfaces
      .filter(({ item }) => commonInterfaceIds.has(item.interfaceId))
      .sort((left, right) => compareInterface(left.item, right.item))
    records.sort((left, right) => (
      left.pathId.localeCompare(right.pathId)
        || left.geometryId.localeCompare(right.geometryId)
        || left.recordKey.localeCompare(right.recordKey)
    ))
    records.forEach((record, index) => {
      const selected = orderedInterfaces[index]
      if (selected) assignments.set(record.recordKey, selected)
    })
  })
  return assignments
}

function lineLabelInterfacesForTarget(
  path,
  targetNode,
  sourceEndpointId,
  compatibleInterfaces,
  proxyInterfaceAssignments,
) {
  const hasProxyInterfaces = compatibleInterfaces.some(({ item }) => (
    item.isProxy === true || item.virtual === true
  ))
  if (!isRackNode(targetNode) || !hasProxyInterfaces) return compatibleInterfaces
  const selected = proxyInterfaceAssignments.get(
    lineLabelProxyAllocationKey(path, targetNode, sourceEndpointId),
  )
  return selected ? [selected] : []
}

function lineLabelProxyAllocationKey(path, targetNode, sourceEndpointId) {
  return [
    path.id,
    path.geometryId,
    sourceEndpointId,
    targetNode.id,
  ].join('|')
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

function lineLabelNodesForPath(path, interfaceContext) {
  if (!path?.sourceName) return []
  const cache = interfaceContext?.lineLabelNodesByGeometryId
  const cacheKey = `${path.id}|${path.geometryId}`
  if (cache?.has(cacheKey)) return cache.get(cacheKey)
  const matchedNodes = lineLabelNodeSequence(path, interfaceContext.nodes)
  cache?.set(cacheKey, matchedNodes)
  return matchedNodes
}

function lineLabelNodeSequence(path, nodes) {
  const pathTokens = normalizeLabelTokens(path.sourceName)
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
  const labelNodes = accepted.map(({ node }) => node)
  if (labelNodes.length < 2) return labelNodes
  return insertInlineJunctionBoxes(path, labelNodes, localNodes)
}

function insertInlineJunctionBoxes(path, labelNodes, localNodes) {
  const output = []
  const labelIds = new Set(labelNodes.map(({ id }) => id))
  labelNodes.forEach((node, index) => {
    output.push(node)
    if (index === labelNodes.length - 1) return
    const start = nearestPointOnLine(node.coordinate, path)
    const end = nearestPointOnLine(labelNodes[index + 1].coordinate, path)
    const minimumMeasure = Math.min(start.measureMeters, end.measureMeters)
    const maximumMeasure = Math.max(start.measureMeters, end.measureMeters)
    const direction = start.measureMeters <= end.measureMeters ? 1 : -1
    const inlineNodes = localNodes
      .filter((candidate) => (
        !labelIds.has(candidate.id)
          && isExtendedJunctionBoxNode(candidate)
          && !isPoleNode(candidate)
      ))
      .map((candidate) => ({
        candidate,
        nearest: nearestPointOnLine(candidate.coordinate, path),
      }))
      .filter(({ nearest }) => (
        nearest.distanceMeters <= DEFAULT_RELATION_ENGINE_CONFIG.inlineSearchRadiusMeters
          && nearest.measureMeters > minimumMeasure
          && nearest.measureMeters < maximumMeasure
      ))
      .sort((left, right) => (
        direction * (left.nearest.measureMeters - right.nearest.measureMeters)
        || left.candidate.id.localeCompare(right.candidate.id)
      ))
    inlineNodes.forEach(({ candidate }) => output.push(candidate))
  })
  return output
}

function topologyLabelAliases(sourceName) {
  const tokens = normalizeLabelTokens(sourceName)
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
  if (isGenericRackServerLabel(sourceName)) {
    // Kabel lapangan memakai alias lokasi rack, sedangkan node KMZ sering
    // hanya bernama "JB-Rack Server".
    aliases.push(['rs'], ['cr'], ['svr', 'office'])
  }
  return [...new Map(aliases.map((alias) => [alias.join(' '), alias])).values()]
}

function normalizeLabelTokens(value) {
  return normalizeToken(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => /^\d+$/.test(token)
      ? token.replace(/^0+(?=\d)/, '')
      : token)
}

function labelEndpointRole(node, labelNodes, fallback = null) {
  if (!node || !asArray(labelNodes).length) return fallback
  const index = labelNodes.findIndex(({ id }) => id === node.id)
  if (index < 0) return fallback
  if (index === 0) return 'start'
  if (index === labelNodes.length - 1) return 'end'
  return 'inline'
}

function pathLabelMatchesNode(path, node) {
  const pathTokens = normalizeLabelTokens(path?.sourceName)
  if (!pathTokens.length) return false
  if (!sameSourceLocation(path?.sourceFolderPath, node?.sourceFolderPath)) return false
  return topologyLabelAliases(node?.sourceName)
    .some((alias) => tokenSequencePositions(pathTokens, alias).length > 0)
}

function isGenericRackServerLabel(value) {
  const normalized = normalizeToken(value)
  return /(?:^|\s)(?:jb\s+)?rack\s+server(?:\s|$)/.test(normalized)
    || /(?:^|\s)(?:jb\s+)?server\s+rack(?:\s|$)/.test(normalized)
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

function generateExplicitCandidates(bundle, nodes, paths, issues, interfaceContext, candidateBudget) {
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
  const candidates = []
  bundle.explicitRelations.forEach((relation) => {
    assertGenerationBudget(candidateBudget, 'explicit_metadata')
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
      return
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
      return
    }
    const explicitRelationType = String(relation.relationType ?? '').trim().toLowerCase()
    const isMounting = relation.relationKind === 'installation_attachment'
      || explicitRelationType === 'mounted_on'
    const isTermination = relation.relationKind === 'path_termination'
      || explicitRelationType === 'terminates_at'
    if (!isMounting
      && (isPoleNode(source) || isPoleNode(target))
      && interfaceContext.topologyPolicy.allowCableToPole !== true) {
      issues.push(topologyIssue(bundle, {
        severity: 'error',
        issueCode: 'cable_terminated_at_pole',
        scope: 'explicit_relation',
        message: 'Relasi kabel menuju tiang ditolak; gunakan mounted_on untuk pemasangan.',
        entityReference: relation.explicitRelationEvidenceId,
        readinessImpact: 'blocking',
      }))
      return
    }
    const targetInterfaceId = relation.targetInterfaceId
      ?? relation.targetInterfaceReference
      ?? (isTermination ? null : undefined)
    const targetInterface = targetInterfaceId
      ? interfaceContext.interfaceById.get(String(targetInterfaceId))
      : null
    let hardGateStatus = null
    if (isTermination && !targetInterfaceId) {
      hardGateStatus = 'incompatible_interface'
      issues.push(topologyIssue(bundle, {
        severity: 'error',
        issueCode: 'dangling_interface_reference',
        scope: 'explicit_relation',
        message: `Relasi terminasi ${relation.explicitRelationEvidenceId} belum memiliki interface target yang tervalidasi.`,
        entityReference: relation.explicitRelationEvidenceId,
        readinessImpact: 'blocking',
      }))
    }
    if (isTermination && targetInterface
      && (targetInterface.ownerAssetId !== target.id
        || source.objectRole !== 'cable_path'
        || !interfaceCompatibility(source, target, targetInterface, interfaceContext.topologyPolicy))) {
      hardGateStatus = 'incompatible_interface'
      issues.push(topologyIssue(bundle, {
        severity: 'error',
        issueCode: targetInterface.ownerAssetId !== target.id
          ? 'dangling_interface_reference'
          : 'interface_media_mismatch',
        scope: 'explicit_relation',
        message: `Interface ${targetInterface.interfaceId} tidak compatible dengan terminasi ${source.id}.`,
        entityReference: relation.explicitRelationEvidenceId,
        readinessImpact: 'blocking',
      }))
    }
    if (isTermination && targetInterfaceId && !targetInterface) {
      issues.push(topologyIssue(bundle, {
        severity: 'error',
        issueCode: 'dangling_interface_reference',
        scope: 'explicit_relation',
        message: `Interface ${targetInterfaceId} pada relasi eksplisit tidak ditemukan.`,
        entityReference: relation.explicitRelationEvidenceId,
        readinessImpact: 'blocking',
      }))
      return
    }
    const candidateType = isMounting
      ? 'mounting_attachment'
      : isTermination ? 'cable_termination' : relation.source === 'manual_admin'
        ? 'manual_relation'
        : 'explicit_metadata'
    const base = baseCandidate({
        candidateType,
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
        targetInterface,
        serviceDomain: relation.serviceDomain ?? source.serviceDomain ?? 'unknown',
        mediaType: relation.mediaType ?? source.mediaType ?? 'unknown',
        cableRole: relation.cableRole ?? source.cableRole ?? 'unknown',
        capacityAvailable: true,
    })
    const candidate = {
      ...base,
      sourceGeometryIds: asArray(relation.sourceGeometryIds).length
        ? unique(asArray(relation.sourceGeometryIds).filter(Boolean))
        : base.sourceGeometryIds,
      sourceGeometryFingerprints: unique([
        ...base.sourceGeometryFingerprints,
        ...asArray(relation.sourceGeometryIds).map((geometryId) => {
          const geometry = bundle.geometries.find((item) => item.geometryId === geometryId)
          return geometry?.geometryFingerprint
            ?? (geometry?.coordinates ? coordinateSequenceKey(geometry.coordinates) : null)
        }),
      ].filter(Boolean)),
      explicitRelationEvidenceId: relation.explicitRelationEvidenceId,
      explicitRelationType: relation.relationType,
      direction: normalizeDirection(relation.direction),
      targetInterfaceId: targetInterfaceId ?? undefined,
      sourceInterfaceId: relation.sourceInterfaceId ?? undefined,
      serviceDomain: relation.serviceDomain ?? source.serviceDomain ?? 'unknown',
      mediaType: relation.mediaType ?? source.mediaType ?? 'unknown',
      cableRole: relation.cableRole ?? source.cableRole ?? 'unknown',
      relationType: relation.relationType,
      relationKind: relation.relationKind
        ?? (isMounting ? 'installation_attachment' : isTermination ? 'path_termination' : undefined),
      traversable: isMounting ? false : relation.traversable !== false,
      provenance: relation.provenance
        ?? (relation.source === 'manual_admin' ? 'manual_admin' : 'explicit_kml_metadata'),
      ...compact({
        relationKind: relation.relationKind,
        pathAssetIds: unique(asArray(relation.pathAssetIds).filter(Boolean)),
        evidenceRefs: unique(asArray(relation.evidenceRefs).filter(Boolean)),
      }),
      manualConfirmation: relation.source === 'manual_admin'
        ? structuredClone(relation.manualConfirmation ?? null)
        : null,
      hardGateStatus,
    }
    pushCandidate(candidates, candidate, candidateBudget, candidate.candidateType)
  })
  return candidates
}

function assignLineLabelNodes(path, matchedNodes) {
  const [start, end] = lineEndpoints(path)
  const firstNearest = nearestPointOnLine(matchedNodes[0].coordinate, path)
  const lastNearest = nearestPointOnLine(matchedNodes.at(-1).coordinate, path)
  const ordered = firstNearest.measureMeters <= lastNearest.measureMeters
    ? matchedNodes
    : [...matchedNodes].reverse()
  return ordered.map((node, index) => {
    if (index === 0) return { node, endpoint: start, nearest: null }
    if (index === ordered.length - 1) return { node, endpoint: end, nearest: null }
    return {
      node,
      endpoint: null,
      nearest: nearestPointOnLine(node.coordinate, path),
    }
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
  targetInterface,
  targetInterfaceId,
  sourceInterfaceId,
  serviceDomain,
  mediaType,
  cableRole,
  capacityAvailable = true,
  provenance,
  profileVersion,
  relationType,
  relationKind,
  direction,
  traversable,
  mountingRole,
}) {
  const derivedDimensions = deriveTopologyDimensions(sourcePath ?? {})
  return {
    candidateType,
    siteId: sourcePath.siteId,
    networkFamily: sourcePath.networkFamily,
    serviceDomain: serviceDomain ?? sourcePath.serviceDomain ?? derivedDimensions.serviceDomain,
    mediaType: mediaType ?? sourcePath.mediaType ?? derivedDimensions.mediaType,
    cableRole: cableRole ?? sourcePath.cableRole ?? derivedDimensions.cableRole,
    sourceEndpointId,
    sourceAssetId: sourcePath?.id,
    sourcePathAssetId: sourcePath.id,
    sourceFeatureId: sourcePath.sourceFeatureId,
    sourceGeometryIds: unique([
      sourcePath.geometryId,
      targetPath?.geometryId,
    ].filter(Boolean)),
    sourceGeometryFingerprints: unique([
      sourcePath.geometryFingerprint,
      targetPath?.geometryFingerprint,
      targetNode?.geometryFingerprint,
    ].filter(Boolean)),
    targetAssetId,
    targetEndpointId,
    targetPathAssetId: targetPath?.id,
    targetInterfaceId: targetInterfaceId ?? targetInterface?.interfaceId,
    sourceInterfaceId,
    targetInterface: targetInterface ? structuredClone(targetInterface) : null,
    provenance: provenance ?? null,
    profileVersion: profileVersion ?? null,
    relationType: relationType ?? null,
    relationKind: relationKind ?? null,
    direction: direction ?? null,
    traversable: traversable !== false,
    mountingRole: mountingRole ?? null,
    targetFeatureId: targetNode?.sourceFeatureId ?? targetPath?.sourceFeatureId,
    sourceObjectRole: sourcePath?.objectRole ?? null,
    targetObjectRole: targetNode?.objectRole ?? targetPath?.objectRole ?? null,
    topologyRequired: sourcePath?.topologyRequired === true
      || targetNode?.topologyRequired === true
      || targetPath?.topologyRequired === true,
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
      interfaceCompatibility: semanticCompatibility,
      explicitEvidence: 0,
      distance: distanceMeters == null ? 1 : undefined,
      labelCorrespondence: sourceContext,
      siteContext: sourceContext,
      endpointRoleConsistency: endpointRole,
      capacityAvailability: capacityAvailable ? 1 : 0,
    },
    evidence,
  }
}

function createCandidateBudget(settings, bundle) {
  return {
    count: 0,
    maxCount: settings.maxCandidateCount,
    startedAt: Date.now(),
    timeoutMilliseconds: settings.maxGenerationMilliseconds,
    datasetVersionId: bundle.datasetVersion.id,
    siteId: bundle.site,
  }
}

function pushCandidate(candidates, candidate, budget, stage) {
  assertGenerationBudget(budget, stage)
  if (budget.count >= budget.maxCount) {
    throw candidateLimitExceeded(budget, stage)
  }
  budget.count += 1
  candidates.push(candidate)
}

function assertGenerationBudget(budget, stage) {
  const elapsedMilliseconds = Date.now() - budget.startedAt
  if (elapsedMilliseconds <= budget.timeoutMilliseconds) return
  throw new AppError(
    `Topology generation melewati timeout ${budget.timeoutMilliseconds} ms.`,
    {
      code: 'topology_generation_timeout',
      statusCode: 504,
      expose: true,
      details: {
        elapsedMilliseconds,
        timeoutMilliseconds: budget.timeoutMilliseconds,
        stage,
        candidateCount: budget.count,
        maxCandidateCount: budget.maxCount,
        datasetVersionId: budget.datasetVersionId,
        siteId: budget.siteId,
      },
    },
  )
}

function scoreAndProposeCandidates(
  rawCandidates,
  settings,
  generatedAt,
  datasetVersionId,
  topologyPolicy = settings.topologyPolicy,
) {
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
      ...candidate.components,
      distance: candidate.components?.distance ?? distanceScore,
      interfaceCompatibility: candidate.components?.interfaceCompatibility
        ?? candidate.components?.semanticCompatibility
        ?? 0,
      explicitEvidence: candidate.components?.explicitEvidence
        ?? (['explicit_metadata', 'manual_relation', 'jb_internal_connection'].includes(candidate.candidateType)
          ? 1 : 0),
      labelCorrespondence: candidate.components?.labelCorrespondence
        ?? candidate.components?.sourceContext
        ?? 0,
      siteContext: candidate.components?.siteContext
        ?? candidate.components?.sourceContext
        ?? 0,
      endpointRoleConsistency: candidate.components?.endpointRoleConsistency
        ?? candidate.components?.endpointRole
        ?? 0,
      capacityAvailability: candidate.components?.capacityAvailability ?? 1,
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
      sourceAssetId: candidate.sourceAssetId,
      targetAssetId: candidate.targetAssetId,
      targetEndpointId: candidate.targetEndpointId,
      targetInterfaceId: candidate.targetInterfaceId ?? candidate.targetInterface?.interfaceId,
      sourceInterfaceId: candidate.sourceInterfaceId,
      sourceGeometryIds: candidate.sourceGeometryIds,
      provenance: candidate.provenance ?? null,
      lineLabelEvidence: candidate.lineLabelEvidence === true,
    })
    return {
      candidateId,
      datasetVersionId: null,
      siteId: candidate.siteId,
      sourceAssetId: candidate.sourceAssetId ?? candidate.sourcePathAssetId,
      sourceEndpointId: candidate.sourceEndpointId,
      sourcePathAssetId: candidate.sourcePathAssetId,
      ...compact({
        targetAssetId: candidate.targetAssetId,
        targetEndpointId: candidate.targetEndpointId,
        targetPathAssetId: candidate.targetPathAssetId,
        targetInterfaceId: candidate.targetInterfaceId ?? candidate.targetInterface?.interfaceId,
        sourceInterfaceId: candidate.sourceInterfaceId,
        sourceFeatureId: candidate.sourceFeatureId,
        targetFeatureId: candidate.targetFeatureId,
        distanceMeters: candidate.distanceMeters,
        measureMeters: candidate.measureMeters,
        targetMeasureMeters: candidate.targetMeasureMeters,
      }),
      candidateType: candidate.candidateType,
      candidateKind: candidate.candidateType,
      legacyCandidateType: legacyCandidateTypeFor(candidate.candidateType),
      sourceObjectRole: candidate.sourceObjectRole,
      targetObjectRole: candidate.targetObjectRole,
      topologyRequired: candidate.topologyRequired === true,
      relationKind: candidate.relationKind ?? relationKindForCandidate(candidate),
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
      sourceGeometryFingerprints: candidate.sourceGeometryFingerprints,
      sourceCoordinate: candidate.sourceCoordinate,
      targetCoordinate: candidate.targetCoordinate,
      networkFamily: candidate.networkFamily,
      serviceDomain: candidate.serviceDomain ?? 'unknown',
      mediaType: candidate.mediaType ?? 'unknown',
      cableRole: candidate.cableRole ?? 'unknown',
      targetInterface: candidate.targetInterface
        ? structuredClone(candidate.targetInterface)
        : null,
      targetInterfaceId: candidate.targetInterfaceId
        ?? candidate.targetInterface?.interfaceId
        ?? null,
      sourceInterfaceId: candidate.sourceInterfaceId ?? null,
      relationType: candidate.relationType,
      traversable: candidate.traversable !== false,
      provenance: candidate.provenance ?? null,
      profileVersion: candidate.profileVersion ?? null,
      mountingRole: candidate.mountingRole ?? null,
      lineLabelEvidence: candidate.lineLabelEvidence === true,
      hardGateStatus: candidate.hardGateStatus ?? null,
      constraintEvidence: {
        interfaceCapacityAvailable: components.capacityAvailability >= 1,
        serviceDomain: candidate.serviceDomain ?? 'unknown',
        mediaType: candidate.mediaType ?? 'unknown',
        requiresJbTermination: topologyPolicy?.requireJbTermination !== false,
      },
      manualConfirmation: candidate.manualConfirmation ?? null,
      ...compact({
        explicitRelationEvidenceId: candidate.explicitRelationEvidenceId,
        relationType: candidate.explicitRelationType,
        direction: candidate.direction,
        pathAssetIds: candidate.pathAssetIds,
        evidenceRefs: candidate.evidenceRefs,
      }),
    }
  })

  const groups = groupBy(candidates, topologyCandidateDecisionKey)
  groups.forEach((group) => {
    group.sort((left, right) => right.score - left.score || compareCandidate(left, right))
    const best = group[0]
    const second = group[1]
    best.scoreMargin = second ? round(best.score - second.score, 6) : best.score
    group.slice(1).forEach((candidate, index) => {
      const next = group[index + 2]
      candidate.scoreMargin = next ? round(candidate.score - next.score, 6) : candidate.score
    })
    if (best.hardGateStatus) {
      group.forEach((candidate) => {
        candidate.candidateStatus = 'ambiguous'
        candidate.proposalStatus = best.hardGateStatus
      })
      return
    }
    if (['explicit_metadata', 'manual_relation'].includes(best.candidateType)
      || (best.candidateType === 'jb_internal_connection'
        && best.provenance === 'approved_jb_profile')) {
      const manualConfirmation = best.manualConfirmation
      const shouldConfirm = Boolean(manualConfirmation)
        || (best.candidateType === 'explicit_metadata' && settings.autoConfirmExplicitMetadata)
        || (best.candidateType === 'jb_internal_connection'
          && best.provenance === 'approved_jb_profile')
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
            action: best.candidateType === 'jb_internal_connection'
              ? 'auto_confirm_approved_jb_profile'
              : 'auto_confirm_explicit',
            before: 'candidate',
            after: 'confirmed',
          }
      }
      return
    }
    const lineLabelCandidates = group.filter(isLineLabelCandidate)
    const lineLabelCandidate = lineLabelCandidates.length === 1
      ? lineLabelCandidates[0]
      : null
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
    if (best.candidateType === 'unresolved_termination') {
      best.proposalStatus = 'unresolved'
      best.candidateStatus = 'candidate'
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

function applyTopologyPolicyConstraints(
  candidates,
  paths,
  interfaceContext,
  settings,
  issues,
) {
  const policy = interfaceContext.topologyPolicy
  const terminationCandidates = candidates.filter(({ candidateType }) => (
    candidateType === 'cable_termination'
  ))
  const byPath = groupBy(terminationCandidates, ({ sourcePathAssetId }) => sourcePathAssetId)
  paths.forEach((path) => {
    const pathCandidates = byPath.get(path.id) ?? []
    const jbCandidates = pathCandidates.filter(({ targetAssetId, targetInterfaceId, proposalStatus }) => (
      Boolean(targetInterfaceId)
        && !['incompatible_interface', 'interface_unavailable', 'missing_jb_termination']
          .includes(proposalStatus)
        && isJunctionBoxNode(interfaceContext.nodeById.get(targetAssetId))
    ))
    if (policy.requireJbTermination && !jbCandidates.length) {
      const issue = {
        issueId: deterministicId('topology-issue', interfaceContext.bundle.datasetVersion.id, 'required_jb_termination_missing', path.id),
        datasetVersionId: interfaceContext.bundle.datasetVersion.id,
        severity: 'error',
        issueCode: 'required_jb_termination_missing',
        scope: 'policy',
        message: `Cable ${path.id} belum memiliki target interface JB yang compatible.`,
        entityReference: path.id,
        readinessImpact: 'blocking',
      }
      issues.push(issue)
      pathCandidates.forEach((candidate) => {
        if (!['incompatible_interface', 'interface_unavailable', 'forbidden_target_role']
          .includes(candidate.proposalStatus)) {
          candidate.proposalStatus = 'missing_jb_termination'
        }
        candidate.constraintEvidence = {
          ...(candidate.constraintEvidence ?? {}),
          requiresJbTermination: true,
          jbTerminationSatisfied: false,
        }
      })
    } else {
      pathCandidates.forEach((candidate) => {
        candidate.constraintEvidence = {
          ...(candidate.constraintEvidence ?? {}),
          requiresJbTermination: policy.requireJbTermination,
          jbTerminationSatisfied: !policy.requireJbTermination || jbCandidates.length > 0,
        }
      })
    }
  })
  interfaceContext.diagnostics.forEach((diagnostic) => {
    const issueCode = diagnostic.issueCode ?? diagnostic.code
    if (issues.some((issue) => issue.issueCode === issueCode
      && issue.entityReference === (diagnostic.sourceEndpointId ?? diagnostic.sourcePathAssetId))) return
    issues.push({
      issueId: deterministicId(
        'topology-issue',
        interfaceContext.bundle.datasetVersion.id,
        issueCode,
        diagnostic.sourceEndpointId ?? diagnostic.sourcePathAssetId,
        diagnostic.targetAssetId,
      ),
      datasetVersionId: interfaceContext.bundle.datasetVersion.id,
      severity: diagnostic.severity ?? 'warning',
      issueCode,
      scope: 'candidate_hard_gate',
      message: diagnostic.message,
      entityReference: diagnostic.sourceEndpointId ?? diagnostic.sourcePathAssetId,
      readinessImpact: issueCode === 'cable_terminated_at_pole' ? 'blocking' : 'warning',
      details: structuredClone(diagnostic),
    })
  })
}

function applyCapacityConstraints(
  candidates,
  nodes,
  settings,
  issues,
  accuracyGate,
  interfaceContext,
  previousRelations = [],
) {
  const interfaceById = interfaceContext.interfaceById
  const occupied = new Map(
    [...interfaceById.entries()].map(([interfaceId, item]) => [
      interfaceId,
      Math.max(0, Number(item.occupancy ?? 0)),
    ]),
  )
  const previousOccupancy = new Map()
  asArray(previousRelations)
    .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
    .map((relation) => relation.targetInterfaceId)
    .filter(Boolean)
    .forEach((interfaceId) => previousOccupancy.set(
      interfaceId,
      (previousOccupancy.get(interfaceId) ?? 0) + 1,
    ))
  previousOccupancy.forEach((count, interfaceId) => {
    occupied.set(interfaceId, Math.max(occupied.get(interfaceId) ?? 0, count))
  })
  const recommended = candidates
    .filter((candidate) => (
      candidate.proposalStatus === 'recommended'
      && candidate.candidateStatus === 'candidate'
      && !['explicit_metadata', 'manual_relation', 'jb_internal_connection'].includes(candidate.candidateType)
    ))
    .sort((left, right) => right.score - left.score || compareCandidate(left, right))
  recommended.forEach((candidate) => {
    if (candidate.candidateType === 'mounting_attachment') return
    const interfaceId = candidate.targetInterfaceId
    const item = interfaceId ? interfaceById.get(interfaceId) : null
    if (!item) {
      candidate.candidateStatus = 'ambiguous'
      candidate.proposalStatus = 'incompatible_interface'
      issues.push({
        issueId: deterministicId('topology-issue', candidate.candidateId, 'interface_missing'),
        datasetVersionId: candidate.datasetVersionId,
        severity: 'error',
        issueCode: 'dangling_asset_component_interface_reference',
        scope: 'constraint',
        message: `Candidate ${candidate.candidateId} tidak memiliki interface target yang terdaftar.`,
        entityReference: candidate.candidateId,
        readinessImpact: 'blocking',
      })
      return
    }
    const count = occupied.get(interfaceId) ?? 0
    const capacity = Math.max(1, Number(item.capacity ?? 1))
    if (count >= capacity) {
      candidate.candidateStatus = 'ambiguous'
      candidate.proposalStatus = 'interface_unavailable'
      candidate.constraintEvidence = {
        ...(candidate.constraintEvidence ?? {}),
        interfaceCapacityAvailable: false,
        interfaceCapacity: capacity,
        interfaceOccupancy: count,
      }
      issues.push({
        issueId: deterministicId('topology-issue', candidate.candidateId, 'interface_capacity'),
        datasetVersionId: candidate.datasetVersionId,
        severity: 'error',
        issueCode: 'interface_capacity_exceeded',
        scope: 'constraint',
        message: `Interface ${interfaceId} penuh (${count}/${capacity}).`,
        entityReference: candidate.candidateId,
        readinessImpact: 'blocking',
      })
      return
    }
    occupied.set(interfaceId, count + 1)
    candidate.constraintEvidence = {
      ...(candidate.constraintEvidence ?? {}),
      interfaceCapacityAvailable: true,
      interfaceCapacity: capacity,
      interfaceOccupancy: count,
    }
  })
  if (settings.autoConfirmSpatialInference && accuracyGate.approved) {
    recommended.filter(({ proposalStatus }) => proposalStatus === 'recommended')
      .forEach((candidate) => {
        candidate.candidateStatus = 'confirmed'
        candidate.review = {
          actorId: 'publication-policy',
          reviewedAt: candidate.generatedAt,
          reason: 'Accuracy artifact approved dan auto-confirm policy terpenuhi.',
          accuracyEvaluationId: accuracyGate.evaluationId,
        }
      })
  }
}

function reconcilePreviousDecisions(candidates, previousCandidates, { generatedAt } = {}) {
  const previousById = new Map(asArray(previousCandidates).map((candidate) => [
    candidate.candidateId,
    candidate,
  ]))
  const reopenedReviewHistory = []
  candidates.forEach((candidate) => {
    const previous = previousById.get(candidate.candidateId)
    if (!previous) return
    if (!['confirmed', 'rejected', 'revoked'].includes(previous.candidateStatus)) return
    if (!sameCandidateReviewInput(candidate, previous)) {
      reopenedReviewHistory.push({
        ...structuredClone(previous),
        supersededAt: generatedAt ?? new Date().toISOString(),
        supersededReason: 'topology_input_changed_review_reopened',
        reissuedCandidateId: candidate.candidateId,
      })
      return
    }
    candidate.candidateStatus = previous.candidateStatus
    candidate.proposalStatus = previous.proposalStatus ?? candidate.proposalStatus
    candidate.review = structuredClone(previous.review)
    candidate.supersedesCandidateId = previous.supersedesCandidateId
  })
  return reopenedReviewHistory
}

function sameCandidateReviewInput(candidate, previous) {
  const fields = [
    'candidateType',
    'relationKind',
    'siteId',
    'networkFamily',
    'sourcePathAssetId',
    'targetAssetId',
    'targetInterfaceId',
    'sourceInterfaceId',
    'targetPathAssetId',
    'serviceDomain',
    'mediaType',
    'cableRole',
    'topologyRuleSetVersion',
    'topologyRequired',
  ]
  if (fields.some((field) => candidate[field] !== previous[field])) return false
  const currentFingerprints = [...(candidate.sourceGeometryFingerprints ?? [])].sort()
  const previousFingerprints = [...(previous.sourceGeometryFingerprints ?? [])].sort()
  if (!currentFingerprints.length && !previousFingerprints.length) return true
  return stableStringify(currentFingerprints) === stableStringify(previousFingerprints)
}

function buildConfirmedRelations({
  bundle,
  candidates,
  previousRelations,
  settings,
  generatedAt,
  interfaceContext,
}) {
  const previousByCandidate = new Map(asArray(previousRelations)
    .filter(({ candidateId }) => Boolean(candidateId))
    .map((relation) => [relation.candidateId, relation]))
  const relations = candidates.flatMap((candidate) => {
    const explicitlyConfirmed = (
      candidate.candidateType === 'explicit_metadata'
        || (candidate.candidateType === 'cable_termination'
          && candidate.provenance === 'explicit_kml_metadata')
    )
      && settings.autoConfirmExplicitMetadata
      && !['rejected', 'revoked', 'ambiguous'].includes(candidate.candidateStatus)
    const blockedProposalStatuses = [
      'missing_jb_termination',
      'incompatible_interface',
      'interface_unavailable',
      'forbidden_target_role',
      'unresolved',
    ]
    const confirmed = (candidate.candidateStatus === 'confirmed' || explicitlyConfirmed)
      && !blockedProposalStatuses.includes(candidate.proposalStatus)
      && candidate.topologyRuleSetVersion === TOPOLOGY_RULE_SET_VERSION
    if (!confirmed) return []
    if (candidate.targetInterfaceId) {
      const targetInterface = interfaceContext?.interfaceById?.get(candidate.targetInterfaceId)
      if (!targetInterface || targetInterface.status === 'retired') return []
    }
    const previous = previousByCandidate.get(candidate.candidateId)
    if (previous?.verificationStatus === 'revoked'
      && candidate.candidateStatus !== 'confirmed') return []
    const verifiedBy = candidate.review?.actorId
      ?? (candidate.provenance === 'approved_jb_profile'
        ? 'approved-jb-profile-policy'
        : explicitlyConfirmed ? 'explicit-metadata-policy' : 'publication-policy')
    const verifiedAt = candidate.review?.reviewedAt ?? generatedAt
    const provenance = candidate.manualConfirmation
      ? 'manual_admin'
      : candidate.provenance
        ?? (candidate.candidateType === 'explicit_metadata'
          ? 'explicit_kml_metadata'
          : ['line_label_connection', 'line_label_attachment'].includes(candidate.candidateType)
            ? 'line_label_inference'
            : 'spatial_inference')
    const relationKind = candidate.relationKind ?? relationKindForCandidate(candidate)
    const sourceAssetId = candidate.candidateType === 'mounting_attachment'
      ? candidate.sourcePathAssetId
      : candidate.sourceAssetId ?? candidate.sourcePathAssetId
    const targetAssetId = candidate.targetAssetId ?? candidate.targetPathAssetId
    const baseRelation = {
      datasetVersionId: bundle.datasetVersion.id,
      sourceAssetId,
      targetAssetId,
      relationType: candidate.relationType ?? relationTypeForCandidate(candidate.candidateType),
      direction: candidate.direction ?? 'undirected',
      networkFamily: candidate.networkFamily ?? null,
      serviceDomain: candidate.serviceDomain ?? 'unknown',
      mediaType: candidate.mediaType ?? 'unknown',
      cableRole: candidate.cableRole ?? 'unknown',
      sourceEndpointId: candidate.sourceEndpointId ?? null,
      targetInterfaceId: candidate.targetInterfaceId ?? candidate.targetInterface?.interfaceId ?? null,
      sourceInterfaceId: candidate.sourceInterfaceId ?? null,
      traversable: candidate.traversable !== false,
      profileVersion: candidate.profileVersion ?? null,
      mountingRole: candidate.mountingRole ?? null,
      ...compact({
        pathAssetId: [
          'cable_termination',
          'endpoint_device',
          'inline_device',
          'line_label_attachment',
        ].includes(candidate.candidateType)
          ? candidate.sourcePathAssetId
          : undefined,
        pathAssetIds: candidate.pathAssetIds,
        evidenceRefs: candidate.evidenceRefs,
      }),
      sourceGeometryIds: structuredClone(candidate.sourceGeometryIds),
      ...compact({
        anchorMeasureMeters: candidate.measureMeters,
        targetAnchorMeasureMeters: candidate.targetMeasureMeters,
      }),
      relationKind,
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
    if (relationKind === 'path_termination') {
      const key = [
        relationKind,
        relation.sourceAssetId,
        relation.sourceEndpointId,
        relation.targetInterfaceId,
      ].join('|')
      materialized.set(key, relation)
      return
    }
    if (relationKind === 'installation_attachment') {
      const key = [
        relationKind,
        relation.sourceAssetId,
        relation.mountingRole ?? 'default',
      ].join('|')
      materialized.set(key, relation)
      return
    }
    if (relationKind === 'internal_connection') {
      const key = [
        relationKind,
        ...[relation.sourceInterfaceId, relation.targetInterfaceId].sort(),
        relation.serviceDomain ?? 'unknown',
      ].join('|')
      materialized.set(key, relation)
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

export function buildConfirmedGraph({
  bundle,
  nodes,
  paths,
  confirmedRelations,
  interfaceRegistry = { interfaces: [], components: [] },
}) {
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
      serviceDomain: node.serviceDomain ?? 'unknown',
      serviceDomains: structuredClone(node.serviceDomains ?? [node.serviceDomain ?? 'unknown']),
      mediaType: node.mediaType ?? 'unknown',
      cableRole: node.cableRole ?? 'unknown',
      objectRole: 'device_node',
      topologyRole: node.topologyRole ?? 'unknown',
      topologyRequired: node.topologyRequired === true,
      assetType: node.assetType,
      category: node.category,
      sourceStatus: node.sourceStatus ?? 'unknown',
    })).sort(compareId)
  const deviceIds = new Set(graphNodes.map(({ id }) => id))
  const pathIds = new Set(paths.map(({ id }) => id))
  const adjacency = new Map([...deviceIds, ...pathIds].map((id) => [id, []]))
  confirmedRelations
    .filter(({ verificationStatus, relationKind }) => (
      verificationStatus === 'confirmed'
        && relationKind !== 'installation_attachment'
        && relationKind !== 'internal_connection'
    ))
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
  const graph = {
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
  const projections = buildGraphProjections({
    bundle,
    nodes,
    paths,
    confirmedRelations,
    interfaceRegistry,
  })
  return {
    ...graph,
    installationGraph: projections.installationGraph,
    physicalTerminationGraph: projections.physicalTerminationGraph,
    serviceGraph: projections.serviceGraph,
    interfaceRegistry: structuredClone(interfaceRegistry.interfaces ?? []),
    componentRegistry: structuredClone(interfaceRegistry.components ?? []),
  }
}

function buildGraphProjections({
  bundle,
  nodes,
  paths,
  confirmedRelations,
  interfaceRegistry,
}) {
  const confirmed = confirmedRelations.filter(({ verificationStatus }) => (
    verificationStatus === 'confirmed'
  ))
  const assetNodes = nodes.map((node) => ({
    id: node.id,
    canonicalAssetId: node.id,
    assetId: node.id,
    siteId: node.siteId,
    networkFamily: node.networkFamily,
    serviceDomain: node.serviceDomain ?? 'unknown',
    mediaType: node.mediaType ?? 'unknown',
    objectRole: 'device_node',
    assetType: node.assetType,
    category: node.category,
    topologyRole: node.topologyRole ?? 'unknown',
  })).sort(compareId)
  const pathNodes = paths.map((path) => ({
    id: path.id,
    canonicalAssetId: path.id,
    assetId: path.id,
    siteId: path.siteId,
    networkFamily: path.networkFamily,
    serviceDomain: path.serviceDomain ?? 'unknown',
    mediaType: path.mediaType ?? 'unknown',
    cableRole: path.cableRole ?? 'unknown',
    objectRole: 'cable_path',
    assetType: path.assetType,
    category: path.category,
  })).sort(compareId)
  const registryInterfaces = asArray(interfaceRegistry?.interfaces)
    .filter(({ status }) => status !== 'retired')
    .map((item) => ({
      id: item.interfaceId,
      interfaceId: item.interfaceId,
      ownerAssetId: item.ownerAssetId,
      componentId: item.componentId,
      interfaceType: item.interfaceType,
      serviceDomain: item.serviceDomain,
      mediaType: item.mediaType,
      direction: item.direction,
      capacity: item.capacity,
      occupancy: item.occupancy,
      objectRole: 'interface',
      nodeType: 'interface',
    }))
    .sort(compareId)
  const interfaceById = new Map(registryInterfaces.map((item) => [item.id, item]))
  const nodesById = new Map(assetNodes.map((item) => [item.id, item]))
  const pathById = new Map(pathNodes.map((item) => [item.id, item]))
  const installationEdges = confirmed
    .filter(({ relationKind }) => relationKind === 'installation_attachment')
    .map((relation) => ({
      id: relation.relationId,
      datasetVersionId: bundle.datasetVersion.id,
      sourceAssetId: relation.sourceAssetId,
      targetAssetId: relation.targetAssetId,
      relationType: 'mounted_on',
      relationKind: 'installation_attachment',
      serviceDomain: 'mounting',
      mediaType: 'none',
      traversable: false,
      verificationStatus: 'confirmed',
      relationId: relation.relationId,
      candidateId: relation.candidateId,
    }))
    .filter((edge) => nodesById.has(edge.sourceAssetId) && nodesById.has(edge.targetAssetId))
    .sort(compareGraphEdge)
  const physicalEdges = confirmed.flatMap((relation) => {
    if (relation.relationKind === 'path_termination' && relation.targetInterfaceId) {
      return [{
        id: deterministicId('physical-termination-edge', relation.relationId),
        datasetVersionId: bundle.datasetVersion.id,
        sourceAssetId: relation.sourceAssetId,
        targetAssetId: relation.targetInterfaceId,
        ownerAssetId: relation.targetAssetId,
        relationType: 'terminates_at',
        relationKind: 'path_termination',
        serviceDomain: relation.serviceDomain,
        mediaType: relation.mediaType,
        cableRole: relation.cableRole,
        verificationStatus: 'confirmed',
        relationId: relation.relationId,
        candidateId: relation.candidateId,
      }]
    }
    if (relation.relationKind === 'path_attachment') {
      return [{
        id: deterministicId('physical-attachment-edge', relation.relationId),
        datasetVersionId: bundle.datasetVersion.id,
        sourceAssetId: relation.sourceAssetId,
        targetAssetId: relation.targetAssetId,
        relationType: relation.relationType,
        relationKind: 'path_attachment',
        serviceDomain: relation.serviceDomain ?? 'unknown',
        mediaType: relation.mediaType ?? 'unknown',
        verificationStatus: 'confirmed',
        relationId: relation.relationId,
        candidateId: relation.candidateId,
      }]
    }
    return []
  }).filter((edge) => (
    pathById.has(edge.sourceAssetId)
      && (interfaceById.has(edge.targetAssetId) || nodesById.has(edge.targetAssetId))
  )).sort(compareGraphEdge)
  const serviceEdges = []
  const addServiceEdge = (edge) => {
    if (!edge.sourceAssetId || !edge.targetAssetId || edge.sourceAssetId === edge.targetAssetId) return
    serviceEdges.push({
      id: edge.id ?? deterministicId('service-edge', edge.sourceAssetId, edge.targetAssetId, edge.relationId),
      datasetVersionId: bundle.datasetVersion.id,
      sourceAssetId: edge.sourceAssetId,
      targetAssetId: edge.targetAssetId,
      sourceNodeId: edge.sourceAssetId,
      targetNodeId: edge.targetAssetId,
      relationType: edge.relationType,
      relationKind: edge.relationKind,
      serviceDomain: edge.serviceDomain ?? 'unknown',
      mediaType: edge.mediaType ?? 'unknown',
      cableRole: edge.cableRole ?? 'unknown',
      direction: edge.direction ?? 'undirected',
      traversable: edge.traversable !== false,
      verificationStatus: 'confirmed',
      relationId: edge.relationId ?? null,
      candidateId: edge.candidateId ?? null,
    })
  }
  confirmed.forEach((relation) => {
    if (relation.relationKind === 'installation_attachment') return
    if (relation.relationKind === 'internal_connection') {
      addServiceEdge({
        id: deterministicId('service-internal-edge', relation.relationId),
        sourceAssetId: relation.sourceInterfaceId,
        targetAssetId: relation.targetInterfaceId,
        relationType: relation.relationType,
        relationKind: relation.relationKind,
        serviceDomain: relation.serviceDomain,
        mediaType: relation.mediaType,
        direction: relation.direction,
        relationId: relation.relationId,
        candidateId: relation.candidateId,
      })
      return
    }
    if (relation.relationKind === 'path_termination' && relation.targetInterfaceId) {
      addServiceEdge({
        id: deterministicId('service-termination-edge', relation.relationId),
        sourceAssetId: relation.sourceAssetId,
        targetAssetId: relation.targetInterfaceId,
        relationType: relation.relationType,
        relationKind: relation.relationKind,
        serviceDomain: relation.serviceDomain,
        mediaType: relation.mediaType,
        cableRole: relation.cableRole,
        direction: relation.direction,
        relationId: relation.relationId,
        candidateId: relation.candidateId,
      })
      return
    }
    if (relation.sourceAssetId && relation.targetAssetId) {
      addServiceEdge(relation)
    }
  })
  registryInterfaces.forEach((item) => {
    const owner = nodesById.get(item.ownerAssetId)
    if (!owner || isJunctionBoxNode(owner) || isRackNode(owner) || isPoleNode(owner)) return
    addServiceEdge({
      id: deterministicId('service-interface-owner-edge', item.interfaceId),
      sourceAssetId: item.ownerAssetId,
      targetAssetId: item.interfaceId,
      relationType: 'interface_of',
      relationKind: 'interface_attachment',
      serviceDomain: item.serviceDomain,
      mediaType: item.mediaType,
      direction: 'bidirectional',
      traversable: true,
    })
  })
  const serviceNodes = [...assetNodes, ...pathNodes, ...registryInterfaces]
    .sort(compareId)
  const serviceGraph = finalizeProjectionGraph({
    datasetVersionId: bundle.datasetVersion.id,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    graphType: 'service',
    nodes: serviceNodes,
    edges: serviceEdges,
    extra: {
      assetNodeIds: assetNodes.map(({ id }) => id),
      pathNodeIds: pathNodes.map(({ id }) => id),
      interfaceNodeIds: registryInterfaces.map(({ id }) => id),
      traversalDomains: ['data', 'power'],
    },
  })
  return {
    installationGraph: finalizeProjectionGraph({
      datasetVersionId: bundle.datasetVersion.id,
      topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
      graphType: 'installation',
      nodes: assetNodes,
      edges: installationEdges,
      extra: { traversable: false },
    }),
    physicalTerminationGraph: finalizeProjectionGraph({
      datasetVersionId: bundle.datasetVersion.id,
      topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
      graphType: 'physical_termination',
      nodes: [...assetNodes, ...pathNodes, ...registryInterfaces].sort(compareId),
      edges: physicalEdges,
      extra: { traversableRelationKinds: ['path_termination', 'path_attachment'] },
    }),
    serviceGraph,
  }
}

function finalizeProjectionGraph({
  datasetVersionId,
  topologyRuleSetVersion,
  graphType,
  nodes,
  edges,
  extra = {},
}) {
  const degreeByNode = Object.fromEntries(nodes.map(({ id }) => [id, 0]))
  edges.forEach((edge) => {
    if (degreeByNode[edge.sourceAssetId] !== undefined) degreeByNode[edge.sourceAssetId] += 1
    if (degreeByNode[edge.targetAssetId] !== undefined) degreeByNode[edge.targetAssetId] += 1
  })
  return {
    datasetVersionId,
    topologyRuleSetVersion,
    graphType,
    nodes,
    edges: edges.slice().sort(compareGraphEdge),
    components: connectedComponents(nodes, edges),
    degreeByNode,
    isolatedNodeIds: Object.entries(degreeByNode)
      .filter(([, degree]) => degree === 0)
      .map(([nodeId]) => nodeId)
      .sort(),
    ...extra,
  }
}

function compareGraphEdge(left, right) {
  return String(left.id ?? '').localeCompare(String(right.id ?? ''))
}

function collapseConfirmedPath(bundle, sourceAssetId, targetAssetId, relations) {
  const sourceGeometryIds = unique(relations.flatMap(({ sourceGeometryIds }) => (
    sourceGeometryIds ?? []
  )))
  const pathAssetIds = unique(relations.flatMap((relation) => [
    relation.pathAssetId,
    ...(relation.pathAssetIds ?? []),
    ...(relation.relationType === 'path-continuation'
      ? [relation.sourceAssetId, relation.targetAssetId]
      : []),
  ].filter(Boolean)))
  const candidateIds = unique(relations.map(({ candidateId }) => candidateId).filter(Boolean))
  const pathById = new Map((bundle.paths ?? []).map((path) => [path.id, path]))
  const pathLengths = pathAssetIds.map((pathAssetId) => (
    Number(pathById.get(pathAssetId)?.totalLengthMeters)
  ))
  const lengthMeters = pathLengths.length === pathAssetIds.length
    && pathLengths.every(Number.isFinite)
    ? pathLengths.reduce((total, length) => total + length, 0)
    : undefined
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
    serviceDomain: unique(relations.map(({ serviceDomain }) => serviceDomain).filter(Boolean)).length === 1
      ? relations.find(({ serviceDomain }) => serviceDomain)?.serviceDomain
      : 'unknown',
    mediaType: unique(relations.map(({ mediaType }) => mediaType).filter(Boolean)).length === 1
      ? relations.find(({ mediaType }) => mediaType)?.mediaType
      : 'unknown',
    cableRole: unique(relations.map(({ cableRole }) => cableRole).filter(Boolean)).length === 1
      ? relations.find(({ cableRole }) => cableRole)?.cableRole
      : 'unknown',
    networkFamily: unique(relations.map(({ networkFamily }) => networkFamily).filter(Boolean)).length === 1
      ? relations.find(({ networkFamily }) => networkFamily)?.networkFamily
      : null,
    lengthMeters,
    pathAssetId: pathAssetIds.length === 1 ? pathAssetIds[0] : undefined,
    pathAssetIds,
    targetInterfaceIds: unique(relations.map(({ targetInterfaceId }) => targetInterfaceId).filter(Boolean)),
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
    relationKind: relations.length === 1
      ? relations[0].relationKind ?? 'device_edge'
      : 'device_edge',
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
  interfaceContext = null,
}) {
  const issues = [...lineworkIssues]
  const objectById = new Map([
    ...nodes.map((node) => [node.id, node]),
    ...paths.map((path) => [path.id, path]),
    ...asArray(interfaceContext?.interfaceRegistry?.interfaces)
      .filter(({ status }) => status !== 'retired')
      .map((item) => [item.interfaceId, {
        ...item,
        id: item.interfaceId,
        siteId: interfaceContext?.nodeById?.get(item.ownerAssetId)?.siteId ?? null,
        objectRole: 'interface',
        networkFamily: interfaceContext?.nodeById?.get(item.ownerAssetId)?.networkFamily ?? 'unknown',
      }]),
  ])
  const edgeKeys = new Set()
  const interfaceOccupancy = new Map()
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
    if (relation.topologyRuleSetVersion !== TOPOLOGY_RULE_SET_VERSION) {
      issues.push(graphIssue(bundle, relation, 'mixed_topology_rule_set', 'error'))
    }
    if (relation.relationKind === 'path_termination') {
      if (isPoleNode(target)
        && interfaceContext?.topologyPolicy?.allowCableToPole !== true) {
        issues.push(graphIssue(bundle, relation, 'cable_terminated_at_pole', 'error'))
      }
      const targetInterface = interfaceContext?.interfaceById?.get(relation.targetInterfaceId)
      if (!targetInterface || targetInterface.ownerAssetId !== target.id) {
        issues.push(graphIssue(bundle, relation, 'dangling_asset_component_interface_reference', 'error'))
      } else {
        interfaceOccupancy.set(
          targetInterface.interfaceId,
          (interfaceOccupancy.get(targetInterface.interfaceId) ?? 0) + 1,
        )
        if (targetInterface.serviceDomain !== relation.serviceDomain
          && relation.serviceDomain !== 'unknown') {
          issues.push(graphIssue(bundle, relation, 'interface_service_domain_mismatch', 'error'))
        }
        if (targetInterface.mediaType !== relation.mediaType
          && relation.mediaType !== 'unknown') {
          issues.push(graphIssue(bundle, relation, 'interface_media_mismatch', 'error'))
        }
      }
      if (relation.serviceDomain === 'power'
        && relation.cableRole === 'feeder'
        && (!isJunctionBoxNode(target) || targetInterface?.interfaceType !== 'power_in')) {
        issues.push(graphIssue(bundle, relation, 'power_direction_invalid', 'error'))
      }
    }
    if (relation.relationKind === 'internal_connection') {
      const sourceInterface = interfaceContext?.interfaceById?.get(relation.sourceInterfaceId)
      const targetInterface = interfaceContext?.interfaceById?.get(relation.targetInterfaceId)
      if (!sourceInterface || !targetInterface
        || sourceInterface.status === 'retired'
        || targetInterface.status === 'retired'
        || sourceInterface.ownerAssetId !== source.id
        || targetInterface.ownerAssetId !== target.id
        || sourceInterface.ownerAssetId !== targetInterface.ownerAssetId) {
        issues.push(graphIssue(bundle, relation, 'dangling_asset_component_interface_reference', 'error'))
      }
      if (relation.serviceDomain === 'power'
        && !['power_in', 'power_out'].includes(sourceInterface?.interfaceType)
        && !['power_in', 'power_out'].includes(targetInterface?.interfaceType)) {
        issues.push(graphIssue(bundle, relation, 'interface_service_domain_mismatch', 'error'))
      }
    }
    if (!['installation_attachment', 'path_termination', 'internal_connection']
      .includes(relation.relationKind)
      && !familiesCompatibleForRelation(source, target)
      && !['manual_admin', 'line_label_inference'].includes(relation.provenance)) {
      issues.push(graphIssue(bundle, relation, 'incompatible_family_edge', 'error'))
    }
    if (relation.sourceAssetId === relation.targetAssetId
      && relation.relationKind !== 'internal_connection') {
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
    }
  })
  interfaceOccupancy.forEach((occupancy, interfaceId) => {
    const item = interfaceContext?.interfaceById?.get(interfaceId)
    if (!item || occupancy <= Number(item.capacity ?? 1)) return
    issues.push(topologyIssue(bundle, {
      severity: 'error',
      issueCode: 'interface_capacity_exceeded',
      scope: 'interface',
      message: `Interface ${interfaceId} menerima ${occupancy}/${item.capacity} termination.`,
      entityReference: interfaceId,
      readinessImpact: 'blocking',
    }))
  })
  uniqueBy(paths, 'id').forEach((path) => {
    const attachmentCount = confirmedRelations.filter((relation) => (
      relation.verificationStatus === 'confirmed'
      && (relation.sourceAssetId === path.id || relation.targetAssetId === path.id)
      && ['path_termination', 'path_attachment', 'path_continuation']
        .includes(relation.relationKind ?? persistedRelationKind(relation))
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
  const candidateEndpointIds = new Set(candidates
    .filter(({ candidateType, proposalStatus, targetInterfaceId }) => (
      (candidateType === 'cable_termination' || candidateType === 'line_label_attachment')
        && Boolean(targetInterfaceId)
        && !['missing_jb_termination', 'incompatible_interface', 'interface_unavailable']
          .includes(proposalStatus)
    ))
    .map(({ sourceEndpointId }) => sourceEndpointId))
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

function buildSummary({
  nodes,
  paths,
  candidates,
  confirmedRelations,
  graph,
  unresolved,
  validation,
}) {
  const confirmed = confirmedRelations.filter(({ verificationStatus }) => (
    verificationStatus === 'confirmed'
  ))
  const evidenceDiagnostics = buildEvidenceDiagnostics({
    nodes,
    paths,
    candidates,
    confirmedRelations: confirmed,
  })
  return {
    candidateCount: candidates.filter(({ candidateStatus }) => candidateStatus === 'candidate').length,
    confirmedEdgeCount: graph.edges.length,
    confirmedDeviceEdgeCount: graph.edges.length,
    confirmedRelationCount: confirmed.length,
    confirmedPathAttachmentCount: confirmed.filter(({ relationKind }) => (
      ['path_attachment', 'path_termination'].includes(relationKind)
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
    ...evidenceDiagnostics,
    falseComponentMergeCount: validation.issues.filter(({ issueCode }) => (
      ['cross_site_edge', 'incompatible_family_edge'].includes(issueCode)
    )).length,
    cableTerminationCandidateCount: candidates.filter(({ candidateType }) => (
      candidateType === 'cable_termination'
    )).length,
    mountingCandidateCount: candidates.filter(({ candidateType }) => (
      candidateType === 'mounting_attachment'
    )).length,
    internalConnectionCandidateCount: candidates.filter(({ candidateType }) => (
      candidateType === 'jb_internal_connection'
    )).length,
    missingJbTerminationCount: candidates.filter(({ proposalStatus }) => (
      proposalStatus === 'missing_jb_termination'
    )).length,
    interfaceCapacityConflictCount: validation.issues.filter(({ issueCode }) => (
      issueCode === 'interface_capacity_exceeded'
    )).length,
    cableToPoleDiagnosticCount: validation.issues.filter(({ issueCode }) => (
      issueCode === 'cable_terminated_at_pole'
    )).length,
  }
}

function evaluateTopologyReadiness({
  bundle,
  nodes,
  paths,
  candidates,
  confirmedRelations,
  validation,
  settings,
  unresolved,
  accuracyGate,
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
  const accuracyReady = accuracyGate.approved
  const requiredTopology = evaluateRequiredTopologyReadiness({
    bundle,
    nodes,
    paths,
    candidates,
    confirmedRelations,
  })
  const blockingReasons = []
  if (stableIdentityCoverage < 1) blockingReasons.push('stable_identity_coverage')
  if (validation.summary.errors > 0) blockingReasons.push('confirmed_graph_invalid')
  if (!accuracyReady) blockingReasons.push('held_out_accuracy_not_proven')
  if (!TOPOLOGY_RULE_SET_VERSION) blockingReasons.push('rule_set_version_missing')
  if (candidates.some(({ candidateStatus }) => candidateStatus === 'confirmed')
    && !confirmedRelations.length) blockingReasons.push('confirmed_decision_not_materialized')
  if (requiredTopology.unresolvedNodeCount > 0) {
    blockingReasons.push('topology_required_node_unresolved')
  }
  if (requiredTopology.unresolvedEndpointCount > 0) {
    blockingReasons.push('topology_required_endpoint_unresolved')
  }
  if (requiredTopology.ambiguousCount > 0) {
    blockingReasons.push('topology_required_ambiguous')
  }
  return {
    topologyReadiness: blockingReasons.length ? 'not_ready' : 'ready',
    stableIdentityCoverage,
    heldOutPrecision: accuracyGate.metrics.heldOutPrecision,
    requiredHeldOutPrecision: settings.requiredHeldOutPrecision,
    pathAccuracy: accuracyGate.metrics.pathAccuracy,
    requiredPathAccuracy: settings.requiredPathAccuracy,
    heldOutSampleSize: accuracyGate.metrics.sampleSize,
    requiredHeldOutSampleSize: settings.requiredHeldOutSampleSize,
    accuracyGate: {
      approved: accuracyGate.approved,
      evaluationId: accuracyGate.evaluationId,
      status: accuracyGate.status,
      blockingReasons: accuracyGate.blockingReasons,
    },
    unresolvedCount: unresolved.length,
    ambiguousCount: candidates.filter(({ candidateStatus }) => candidateStatus === 'ambiguous').length,
    requiredTopology,
    blockingReasons,
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
  }
}

function buildEvidenceDiagnostics({ nodes, paths, candidates, confirmedRelations }) {
  const deviceIds = new Set(nodes.map(({ id }) => id))
  const pathIds = new Set(paths.map(({ id }) => id))
  const allIds = new Set([...deviceIds, ...pathIds])
  const confirmedIds = new Set()
  const adjacency = new Map([...allIds].map((id) => [id, new Set()]))
  confirmedRelations.forEach((relation) => {
    const sourceId = relation.sourceAssetId
    const targetId = relation.targetAssetId
    if (!allIds.has(sourceId) || !allIds.has(targetId)) return
    confirmedIds.add(sourceId)
    confirmedIds.add(targetId)
    adjacency.get(sourceId).add(targetId)
    adjacency.get(targetId).add(sourceId)
  })
  const reviewIds = new Set()
  candidates
    .filter(({ candidateStatus }) => ['candidate', 'ambiguous'].includes(candidateStatus))
    .forEach((candidate) => {
      for (const id of [
        candidate.sourceAssetId,
        candidate.sourcePathAssetId,
        candidate.targetAssetId,
        candidate.targetPathAssetId,
      ]) {
        if (allIds.has(id) && !confirmedIds.has(id)) reviewIds.add(id)
      }
    })
  const unresolvedAssetIds = [...allIds]
    .filter((id) => !confirmedIds.has(id) && !reviewIds.has(id))
    .sort()
  const components = []
  const visited = new Set()
  ;[...confirmedIds].sort().forEach((id) => {
    if (visited.has(id)) return
    const queue = [id]
    const component = []
    visited.add(id)
    while (queue.length) {
      const current = queue.shift()
      component.push(current)
      ;[...(adjacency.get(current) ?? [])].sort().forEach((neighbor) => {
        if (visited.has(neighbor)) return
        visited.add(neighbor)
        queue.push(neighbor)
      })
    }
    components.push(component)
  })
  return {
    totalTopologyObjectCount: allIds.size,
    deviceNodeCount: deviceIds.size,
    pathNodeCount: pathIds.size,
    evidenceResolvedAssetCount: confirmedIds.size,
    reviewAssetCount: reviewIds.size,
    unresolvedAssetCount: unresolvedAssetIds.length,
    unresolvedAssetIds,
    unmatchedPathCount: unresolvedAssetIds.filter((id) => pathIds.has(id)).length,
    evidenceComponentCount: components.length,
  }
}

function evaluateRequiredTopologyReadiness({
  bundle,
  nodes,
  paths,
  candidates,
  confirmedRelations,
}) {
  const requiredNodes = asArray(nodes).filter(({ topologyRequired }) => topologyRequired === true)
  const requiredPaths = asArray(paths).filter(({ topologyRequired }) => topologyRequired === true)
  const approvedExceptions = asArray(bundle.topologyExceptions).filter((exception) => (
    exception?.approved === true && String(exception.reason ?? '').trim().length >= 3
  ))
  const exceptionKeys = new Set(approvedExceptions.flatMap((exception) => [
    exception.entityReference,
    exception.assetId,
    exception.sourceFeatureId,
    exception.sourceEndpointId,
  ].filter(Boolean).map(String)))
  const confirmedAssetIds = new Set(
    asArray(confirmedRelations)
      .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
      .flatMap((relation) => [relation.sourceAssetId, relation.targetAssetId])
      .filter(Boolean)
      .map(String),
  )
  const unresolvedNodeIds = requiredNodes
    .map((node) => node.id)
    .filter((id) => !confirmedAssetIds.has(String(id)) && !exceptionKeys.has(String(id)))
  const candidateByEndpoint = new Map()
  asArray(candidates).forEach((candidate) => {
    if (!candidate.sourceEndpointId) return
    const list = candidateByEndpoint.get(candidate.sourceEndpointId) ?? []
    list.push(candidate)
    candidateByEndpoint.set(candidate.sourceEndpointId, list)
  })
  const requiredEndpointIds = requiredPaths.flatMap((path) => (
    lineEndpoints(path).map(({ id }) => id)
  ))
  const unresolvedEndpointIds = []
  const ambiguousEndpointIds = []
  const confirmedCandidateIds = new Set(
    asArray(confirmedRelations)
      .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
      .map(({ candidateId }) => candidateId)
      .filter(Boolean),
  )
  requiredEndpointIds.forEach((endpointId) => {
    if (exceptionKeys.has(endpointId)) return
    const endpointCandidates = candidateByEndpoint.get(endpointId) ?? []
    const hasConfirmed = endpointCandidates.some((candidate) => (
      candidate.candidateStatus === 'confirmed'
        && confirmedCandidateIds.has(candidate.candidateId)
    ))
    if (hasConfirmed) return
    if (endpointCandidates.some(({ candidateStatus, proposalStatus }) => (
      candidateStatus === 'ambiguous' || proposalStatus === 'ambiguous'
    ))) {
      ambiguousEndpointIds.push(endpointId)
    }
    unresolvedEndpointIds.push(endpointId)
  })
  return {
    requiredNodeCount: requiredNodes.length,
    requiredPathCount: requiredPaths.length,
    requiredEndpointCount: requiredEndpointIds.length,
    unresolvedNodeCount: unresolvedNodeIds.length,
    unresolvedEndpointCount: unresolvedEndpointIds.length,
    ambiguousCount: ambiguousEndpointIds.length,
    approvedExceptionCount: approvedExceptions.length,
    unresolvedNodeIds,
    unresolvedEndpointIds,
    ambiguousEndpointIds,
  }
}

function topologyAccuracyScope(bundle, nodes, paths) {
  const siteIds = [...new Set([
    bundle.site,
    ...nodes.map(({ siteId }) => siteId),
    ...paths.map(({ siteId }) => siteId),
  ].filter((value) => typeof value === 'string' && value.trim()))]
  const networkFamilies = [...new Set([
    ...paths.map(({ networkFamily }) => networkFamily),
  ].filter((value) => typeof value === 'string' && value.trim()))]
  return {
    siteId: siteIds.length === 1 ? siteIds[0] : null,
    networkFamilies,
  }
}

function evaluateTopologyAccuracyGate(bundle, nodes, paths, settings, generatedAt) {
  return evaluateAccuracyGate({
    artifact: settings.accuracyArtifact,
    requiredRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    requiredEngineBuildSha: settings.engineBuildSha,
    requiredHeldOutPrecision: settings.requiredHeldOutPrecision,
    requiredPathAccuracy: settings.requiredPathAccuracy,
    requiredHeldOutSampleSize: settings.requiredHeldOutSampleSize,
    scope: topologyAccuracyScope(bundle, nodes, paths),
    now: new Date(generatedAt),
  })
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
  if (isPoleNode(node)) {
    return {
      compatible: false,
      score: 0,
      ruleId: 'hard-gate.forbidden-target-role',
      explanation: 'Tiang adalah host pemasangan dan bukan endpoint kabel.',
    }
  }
  const type = nodeSemanticText(node)
  const pathDomain = path.serviceDomain ?? deriveTopologyDimensions(path).serviceDomain
  const nodeDomain = node.serviceDomain ?? deriveTopologyDimensions(node).serviceDomain
  const nodeServiceDomains = unique([
    ...asArray(node.serviceDomains),
    nodeDomain,
  ].map((value) => normalizeServiceDomain(value)))
  if (pathDomain !== 'unknown' && nodeDomain !== 'unknown'
    && pathDomain !== 'mounting' && nodeDomain !== 'mounting'
    && pathDomain === nodeDomain
    && path.networkFamily === node.networkFamily) {
    return {
      compatible: true,
      score: 1,
      ruleId: 'compatibility.same-domain-family',
      explanation: 'Path dan device berada pada service domain serta network family yang sama.',
    }
  }
  if (pathDomain !== 'unknown'
    && pathDomain !== 'mounting'
    && nodeServiceDomains.includes(pathDomain)
    && (isJunctionBoxNode(node) || (pathDomain === 'data' && isRackNode(node)))) {
    return {
      compatible: true,
      score: 0.95,
      ruleId: 'compatibility.service-domain-cross-family',
      explanation: 'Device mendukung service domain path meskipun network family canonical berbeda; interface compatibility menjadi hard gate berikutnya.',
    }
  }
  const approved = {
    cctv: /junction|\bjb\b|switch|nvr|server|router|camera|cctv/,
    fiber_optic: /otb|junction|\bjb\b|switch|router|core|fiber|\bfo\b/,
    lan: /switch|router|access point|\bap\b|printer|server|device|lan/,
    infrastructure: /switch|router|server|junction|\bjb\b|otb|core|patch|rack|pln|power/,
  }[path.networkFamily]
  const compatible = (
    node.networkFamily === 'infrastructure' && approved?.test(type)
  ) || (isRackNode(node) && pathDomain === 'data') || (
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
  if (isPoleNode(source) || isPoleNode(target)) return false
  if (source.networkFamily === target.networkFamily) return true
  if (source.objectRole === 'cable_path') return compatiblePathNode(source, target).compatible
  if (target.objectRole === 'cable_path') return compatiblePathNode(target, source).compatible
  return false
}

function inlineNodeAllowed(node) {
  return !isPoleNode(node) && (
    isRackNode(node)
      || /junction|\bjb\b|switch|router|otb|splitter|coupler|core|patch|rack/
        .test(nodeSemanticText(node))
  )
}

function nodeCapacity(node) {
  const type = nodeSemanticText(node)
  if (isRackNode(node)) return 48
  if (/core|switch|router|nvr|server/.test(type)) return 48
  if (/junction|\bjb\b|otb|splitter|coupler/.test(type)) return 12
  if (/camera|cctv|access point|\bap\b|printer|terminal/.test(type)) return 1
  return 4
}

function endpointRoleScore(node, inline) {
  const type = nodeSemanticText(node)
  if (inline) return inlineNodeAllowed(node) ? 1 : 0
  if (/camera|cctv|access point|\bap\b|printer|terminal/.test(type)) return 1
  if (isRackNode(node) || /junction|\bjb\b|switch|router|otb|core|nvr/.test(type)) return 0.9
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
    cable_termination: 'terminates_at',
    mounting_attachment: 'mounted_on',
    jb_internal_connection: 'internally_connected_to',
    path_continuation: 'path-continuation',
    unresolved_termination: 'unresolved',
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
  if (candidate.candidateType === 'cable_termination') return 'path_termination'
  if (candidate.candidateType === 'mounting_attachment') return 'installation_attachment'
  if (candidate.candidateType === 'jb_internal_connection') return 'internal_connection'
  if (candidate.candidateType === 'path_continuation') return 'path_continuation'
  if (candidate.sourceObjectRole === 'device_node'
    && candidate.targetObjectRole === 'device_node') {
    return 'device_edge'
  }
  if (candidate.candidateType === 'endpoint_endpoint') return 'path_continuation'
  return 'path_attachment'
}

function persistedRelationKind(relation) {
  if (relation.relationType === 'terminates_at') return 'path_termination'
  if (relation.relationType === 'mounted_on') return 'installation_attachment'
  if (relation.relationType === 'internally_connected_to') return 'internal_connection'
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

function legacyCandidateTypeFor(candidateType) {
  return {
    cable_termination: 'endpoint_device',
    mounting_attachment: 'mounting_attachment',
    jb_internal_connection: 'jb_internal_connection',
    path_continuation: 'endpoint_endpoint',
    unresolved_termination: 'unresolved_termination',
  }[candidateType] ?? candidateType
}

function candidateLimitExceeded(budget, stage) {
  return new AppError(
    `Candidate generation melewati hard limit ${budget.maxCount}.`,
    {
      code: 'topology_candidate_limit_exceeded',
      statusCode: 422,
      details: {
        attemptedCandidateCount: budget.count + 1,
        maxCandidateCount: budget.maxCount,
        stage,
        datasetVersionId: budget.datasetVersionId,
        siteId: budget.siteId,
      },
    },
  )
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
    requiredHeldOutSampleSize: positiveInteger(
      value.requiredHeldOutSampleSize,
      DEFAULT_RELATION_ENGINE_CONFIG.requiredHeldOutSampleSize,
    ),
    accuracyArtifact: normalizeAccuracyArtifact(value.accuracyArtifact),
    engineBuildSha: readString(value.engineBuildSha) ?? null,
    heldOutPrecision: optionalUnitNumber(value.heldOutPrecision),
    pathAccuracy: optionalUnitNumber(value.pathAccuracy),
    maxCandidateCount: positiveInteger(
      value.maxCandidateCount,
      DEFAULT_RELATION_ENGINE_CONFIG.maxCandidateCount,
    ),
    maxGenerationMilliseconds: positiveInteger(
      value.maxGenerationMilliseconds,
      DEFAULT_RELATION_ENGINE_CONFIG.maxGenerationMilliseconds,
    ),
    topologyPolicy: normalizeTopologyPolicy(value.topologyPolicy),
  }
}

function normalizeTopologyPolicy(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
  return {
    ...DEFAULT_TOPOLOGY_POLICY,
    ...structuredClone(input),
    version: readString(input.version, input.policyVersion) ?? TOPOLOGY_POLICY_VERSION,
    requireJbTermination: input.requireJbTermination !== false,
    allowDirectCameraTermination: input.allowDirectCameraTermination !== false,
    allowCableToPole: input.allowCableToPole === true,
    allowOpaqueJbInternalBridge: input.allowOpaqueJbInternalBridge === true,
    allowDirectRackEnclosureTermination: input.allowDirectRackEnclosureTermination === true,
  }
}

function compatibleInterfacesForPath(path, node, interfaceContext, endpointRole = null) {
  if (path.siteId !== node.siteId
    || (isPoleNode(node) && interfaceContext.topologyPolicy.allowCableToPole !== true)) return []
  const interfaces = interfaceContext.interfacesByAssetId.get(node.id) ?? []
  return interfaces.flatMap((item) => {
    const compatibility = interfaceCompatibility(
      path,
      node,
      item,
      interfaceContext.topologyPolicy,
      endpointRole,
    )
    return compatibility ? [{ item, ...compatibility }] : []
  }).sort((left, right) => (
    right.score - left.score || compareInterface(left.item, right.item)
  ))
}

function interfaceCompatibility(path, node, item, policy, endpointRole = null) {
  const serviceDomain = normalizeServiceDomain(
    path.serviceDomain ?? deriveTopologyDimensions(path).serviceDomain,
  )
  const mediaType = normalizeMediaType(
    path.mediaType ?? deriveTopologyDimensions(path).mediaType,
  )
  const cableRole = path.cableRole ?? deriveTopologyDimensions(path).cableRole
  if (serviceDomain === 'mounting' || item.serviceDomain !== serviceDomain) return null
  if (mediaType !== 'unknown' && item.mediaType !== 'unknown' && item.mediaType !== mediaType) {
    return null
  }
  if (isRackNode(node) && !item.isProxy && policy.allowDirectRackEnclosureTermination !== true) {
    return null
  }
  const interfaceType = item.interfaceType
  if (serviceDomain === 'power') {
    if (cableRole === 'feeder') {
      if (isJunctionBoxNode(node) && interfaceType === 'power_in') {
        return interfaceMatch(item, 'compatibility.power-feeder-to-jb-input')
      }
      if (isPowerSourceNode(node) && interfaceType === 'power_out') {
        return interfaceMatch(item, 'compatibility.power-origin-output')
      }
      return null
    }
    if (cableRole === 'distribution') {
      if (isJunctionBoxNode(node)) {
        const expectedInterfaceType = endpointRole === 'end'
          ? 'power_in'
          : endpointRole === 'start'
            ? 'power_out'
            : isExtendedJunctionBoxNode(node) ? 'power_in' : 'power_out'
        if (interfaceType === expectedInterfaceType) {
          return interfaceMatch(
            item,
            expectedInterfaceType === 'power_in'
              ? 'compatibility.power-distribution-to-jb-input'
              : 'compatibility.power-jb-output',
          )
        }
        return null
      }
      if (interfaceType === 'power_in') {
        return interfaceMatch(item, 'compatibility.power-load-input')
      }
      return null
    }
    if (interfaceType === 'power_in' || interfaceType === 'power_out') {
      return interfaceMatch(item, 'compatibility.power-domain')
    }
    return null
  }
  if (mediaType === 'fiber') {
    if (!['fiber_port', 'splice_slot', 'patch_port'].includes(interfaceType)) return null
    if (cableRole === 'access' && isJunctionBoxNode(node) && interfaceType === 'splice_slot') return null
    return interfaceMatch(item, 'compatibility.fiber-interface')
  }
  if (cableRole === 'backbone' || cableRole === 'uplink') {
    if (!['uplink_port', 'fiber_port', 'patch_port', 'lan_port', 'server_nic'].includes(interfaceType)) return null
    return interfaceMatch(item, 'compatibility.data-uplink-interface')
  }
  if (!['lan_port', 'uplink_port', 'patch_port', 'server_nic'].includes(interfaceType)) return null
  if (isJunctionBoxNode(node) && interfaceType === 'uplink_port' && cableRole === 'access') return null
  if (isCameraNode(node) && !policy.allowDirectCameraTermination) return null
  return interfaceMatch(item, 'compatibility.data-access-interface')
}

function interfaceMatch(item, ruleId) {
  return {
    score: item.virtual || item.isProxy ? 0.85 : 1,
    ruleId,
    explanation: `Interface ${item.interfaceType} compatible dengan service domain/media kabel.`,
    capacityAvailable: Number(item.occupancy ?? 0) < Number(item.capacity ?? 1),
  }
}

function nodeHasTopologyInterface(node, interfaceContext) {
  return (interfaceContext.interfacesByAssetId.get(node.id) ?? []).length > 0
}

function isPoleNode(node) {
  const type = normalizeToken([
    node?.assetType,
    node?.category,
    node?.sourceName,
  ].filter(Boolean).join(' '))
  return node?.assetType === 'pole'
    || /(^|\s)(tiang|pole|pylon)(\s|$)/.test(type)
}

function isJunctionBoxNode(node) {
  const type = normalizeToken([
    node?.assetType,
    node?.category,
    node?.sourceName,
  ].filter(Boolean).join(' '))
  if (isOtbNode(node) || isRackNode(node)) return false
  return node?.assetType === 'junction_box'
    || /junction|\bjb\b/.test(type)
}

function isExtendedJunctionBoxNode(node) {
  if (!isJunctionBoxNode(node)) return false
  const type = normalizeToken([
    node?.assetType,
    node?.category,
    node?.sourceName,
  ].filter(Boolean).join(' '))
  const rawName = String(node?.sourceName ?? '')
  const profile = normalizeToken(node?.jbProfileId)
  return /\bextended\b/.test(type)
    || isExtendedFolderPath(node?.sourceFolderPath)
    || /\bjb\s*[-_ ]*\d+\s*\.\s*\d+(?:\s|[-_]|$)/i.test(rawName)
    || /\bextended(?:\s|_|-)?(?:passive|poe)?\b/.test(profile)
}

function isOtbNode(node) {
  const type = normalizeToken([
    node?.assetType,
    node?.category,
    node?.sourceName,
  ].filter(Boolean).join(' '))
  return node?.assetType === 'otb'
    || /(^|\s)(otb|optical termination box)(\s|$)/.test(type)
}

function isRackNode(node) {
  const type = normalizeToken([
    node?.assetType,
    node?.category,
    node?.sourceName,
  ].filter(Boolean).join(' '))
  return ['rack', 'server_rack'].includes(node?.assetType)
    || /server.?rack|rack.?server/.test(type)
    || isRackServerAlias(node?.sourceName)
    || isRackServerAlias(node?.assetType)
    || isRackServerAlias(node?.category)
}

function isRackServerAlias(value) {
  const normalized = normalizeToken(value)
  return /^(rs|cr)(?:\s|$)/.test(normalized)
    || /^svr\s+office(?:\s|$)/.test(normalized)
}

function isExtendedFolderPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => normalizeToken(segment))
    .some((segment) => segment === 'extended')
}

function isCameraNode(node) {
  const type = normalizeToken([
    node?.assetType,
    node?.category,
    node?.sourceName,
  ].filter(Boolean).join(' '))
  return ['cctv_fixed', 'cctv_camera', 'cctv_ptz', 'cctv_dome'].includes(node?.assetType)
    || /camera|cctv|kamera/.test(type)
}

function isPowerSourceNode(node) {
  const type = normalizeToken([
    node?.assetType,
    node?.category,
    node?.sourceName,
  ].filter(Boolean).join(' '))
  return ['pln_source', 'power_panel'].includes(node?.assetType)
    || /pln|power source|power panel/.test(type)
}

function isMountableAsset(node) {
  return isCameraNode(node) || isJunctionBoxNode(node)
}

function normalizeAccuracyArtifact(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value)
    : null
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

function isLineLabelCandidate(candidate) {
  return ['line_label_connection', 'line_label_attachment'].includes(candidate.candidateType)
    || candidate.lineLabelEvidence === true
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

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
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
