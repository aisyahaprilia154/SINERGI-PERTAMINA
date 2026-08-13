import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '../errors.js'
import {
  buildAssetIdentityMapFromRecord,
  createAssetIdentityResolver,
} from '../domain/canonical-asset-identity.js'
import {
  rebuildStoredTopologyInputBundle,
} from '../domain/parser-contract.js'
import {
  createManualExplicitCandidate,
  createTopologyCandidateEligibilityContext,
  evaluateTopologyCandidateEligibility,
  generateRelationArtifacts,
  normalizeTopologySummary,
  rebuildConfirmedRelationArtifacts,
} from './semantic-relation-engine.js'
import {
  withTopologyGraphRevision,
} from './topology-graph-revision.js'
import {
  createCandidateCollectionRevision,
  normalizeCandidateQuery,
  paginateCandidates,
  summarizeCandidates,
  TopologyCandidateQueryIndex,
} from './topology-candidate-pagination.js'
import {
  appendTopologyMutationReceipt,
  assertTopologyMutationFingerprint,
  canonicalizeJsonValue,
  createTopologyMutationFingerprint,
  findTopologyMutationReceipt,
  normalizeTopologyIdempotencyKey,
} from './topology-idempotency.js'

const MAX_SELECTED_CANDIDATE_IDS = 5000
const MAX_MANUAL_REFERENCE_IDS = 256

export class TopologyService {
  constructor({
    repository,
    auditLog,
    config = {},
    clock = () => new Date(),
  }) {
    this.repository = repository
    this.auditLog = auditLog
    this.config = config
    this.clock = clock
    this.candidateQueryIndexes = new Map()
    this.traceResultCache = new Map()
    this.impactResultCache = new Map()
    this.traceGraphCache = new Map()
    this.traceGraphObjectCache = new WeakMap()
    // Bulk review rewrites a large aggregate and its indexed graph projection.
    // Keep one such mutation in flight per dataset so a browser retry cannot
    // multiply the 35MB+ JSONB working set until Node exhausts its heap.
    this.activeMutationDatasetIds = new Set()
  }

  normalizedTraceGraph(record, identityMap = buildAssetIdentityMapFromRecord(record)) {
    return normalizedTraceGraphFromCache(
      this.traceGraphCache,
      this.traceGraphObjectCache,
      record,
      identityMap,
    )
  }

  async regenerate(datasetVersionId, actorId, {
    reason,
    correlationId = null,
    jobId = null,
  } = {}) {
    return this.#withMutationTransaction(async ({ repository, auditLog }) => {
      const current = await repository.get(datasetVersionId)
      assertTopologyBundle(current)
      const repaired = rebuildStoredTopologyInputBundle(current)
      const topologyInputBundle = repaired.topologyInputBundle ?? current.topologyInputBundle
      const generatedAt = this.clock().toISOString()
      const artifacts = generateRelationArtifacts(topologyInputBundle, {
        config: this.config,
        previousCandidates: current.topologyCandidates,
        previousRelations: current.confirmedRelations,
        generatedAt,
      })
      assertPublishableTopologyArtifacts(artifacts, datasetVersionId)
      const event = await auditLog.record('topology.candidates_regenerated', {
        actorId,
        datasetVersionId,
        branchId: current.datasetVersion.branchId,
        correlationId,
        outcome: 'regenerated',
        details: {
          reason: normalizeReason(reason, false),
          ...(jobId ? { jobId } : {}),
          graphRevision: artifacts.graph?.graphRevision ?? null,
          classificationRepair: {
            changed: repaired.changed,
            repairedCount: repaired.repairedCount,
          },
          topologyRuleSetVersion: artifacts.topologyRuleSetVersion,
          before: current.topologySummary ?? null,
          after: artifacts.summary,
        },
      })
      return repository.update(datasetVersionId, (record) => applyArtifacts({
        ...record,
        topologyInputBundle,
        ...(repaired.changed ? {
          classifiedObjects: repaired.classifiedObjects,
          canonicalParser: record.canonicalParser
            ? {
              ...record.canonicalParser,
              classifiedObjects: repaired.classifiedObjects,
              topologyInputBundle,
              classificationRuleSetVersion: topologyInputBundle.semanticRuleSetVersion,
            }
            : record.canonicalParser,
          parserVersions: record.parserVersions
            ? {
              ...record.parserVersions,
              classificationRuleSetVersion: topologyInputBundle.semanticRuleSetVersion,
            }
            : record.parserVersions,
        } : {}),
      }, artifacts, {
        candidateHistory: reconcileCandidateHistory(record, artifacts, {
          eventId: event.id,
          generatedAt,
        }),
        topologyRun: {
          runId: event.id,
          actorId,
          generatedAt,
          reason: normalizeReason(reason, false),
          topologyRuleSetVersion: artifacts.topologyRuleSetVersion,
          summary: artifacts.summary,
        },
      }), {
        expectedRevision: recordRevision(current),
      })
    })
  }

  async getSummary(datasetVersionId) {
    const record = await this.repository.get(datasetVersionId)
    const graph = this.normalizedTraceGraph(record)
    return {
      datasetVersionId,
      topologyRuleSetVersion: record.topologyRuleSetVersion ?? null,
      summary: normalizeTopologySummary(
        record.topologySummary ?? emptySummary(),
        graph,
        record.confirmedRelations,
      ),
      readiness: record.topologyReadiness ?? {
        topologyReadiness: 'not_ready',
        blockingReasons: ['topology_not_generated'],
      },
      validation: record.topologyValidation ?? null,
      lastGeneratedAt: record.topologyGeneratedAt ?? null,
      graphRevision: graph.graphRevision,
      reviewCapabilities: {
        contractVersion: '2.0.0',
        safePreview: true,
        deltaValidation: true,
        confirmSelected: true,
        confirmAll: true,
        confirmLineLabels: true,
        manualRelation: true,
        maxBatchSize: MAX_SELECTED_CANDIDATE_IDS,
      },
      roots: verifiedRootNodes(graph).map(({ id, topologyRole }) => ({
        assetId: id,
        topologyRole: topologyRole ?? 'unknown',
      })),
      directionCoverage: directionCoverageForGraph(graph),
      candidateRevision: createCandidateCollectionRevision(record.topologyCandidates ?? []),
      recordRevision: recordRevision(record),
    }
  }

  async getCandidates(datasetVersionId, query = {}) {
    const record = await this.repository.get(datasetVersionId)
    const candidates = record.topologyCandidates ?? []
    const graph = this.normalizedTraceGraph(record)
    const candidateRevision = createCandidateCollectionRevision(candidates)
    const cached = this.candidateQueryIndexes.get(datasetVersionId)
    const index = cached?.revision === candidateRevision
      ? cached.index
      : new TopologyCandidateQueryIndex(candidates)
    if (cached?.revision !== candidateRevision) {
      this.candidateQueryIndexes.set(datasetVersionId, {
        revision: candidateRevision,
        index,
      })
    }
    const normalizedQuery = normalizeCandidateQuery(query ?? {})
    const eligibilityContext = createTopologyCandidateEligibilityContext(
      record.topologyInputBundle,
    )
    const page = paginateCandidates(index, {
      ...normalizedQuery,
      graphRevision: graph.graphRevision,
      candidateRevision,
    })
    const reviewItems = page.items.map((candidate) => (
      annotateTopologyCandidateForReview(record, candidate, eligibilityContext)
    ))
    const filteredReviewCandidates = page.filteredCandidates.map((candidate) => (
      annotateTopologyCandidateForReview(record, candidate, eligibilityContext)
    ))
    const reviewCandidates = candidates.map((candidate) => (
      annotateTopologyCandidateForReview(record, candidate, eligibilityContext)
    ))
    return {
      datasetVersionId,
      topologyRuleSetVersion: record.topologyRuleSetVersion ?? null,
      items: reviewItems,
      nextCursor: page.nextCursor,
      pageInfo: page.pageInfo,
      summary: summarizeCandidates(filteredReviewCandidates),
      datasetSummary: summarizeCandidates(reviewCandidates),
      query: {
        status: normalizedQuery.status,
        site: normalizedQuery.site,
        networkFamily: normalizedQuery.networkFamily,
        candidateType: normalizedQuery.candidateType,
        proposalStatus: normalizedQuery.proposalStatus,
        minScore: normalizedQuery.minScore,
        maxScore: normalizedQuery.maxScore,
        minDistance: normalizedQuery.minDistance,
        maxDistance: normalizedQuery.maxDistance,
        assetSearch: normalizedQuery.assetSearch,
        requiredTopologyOnly: normalizedQuery.requiredTopologyOnly,
      },
      graphRevision: graph.graphRevision,
      candidateRevision,
      unresolved: structuredClone(record.topologyUnresolved ?? []),
      eligibilityIssues: structuredClone(record.topologyEligibilityIssues ?? []),
      lineworkIssues: structuredClone(record.topologyLineworkIssues ?? []),
      history: structuredClone(record.topologyCandidateHistory ?? []),
      runs: structuredClone(record.topologyRuns ?? []),
      recordRevision: recordRevision(record),
    }
  }

  async reviewPreview(datasetVersionId, {
    candidateIds,
    expectedGraphRevision,
    expectedCandidateRevision,
  } = {}) {
    const normalizedCandidateIds = normalizeCandidateIds(candidateIds)
    const record = await this.repository.get(datasetVersionId)
    assertTopologyBundle(record)
    assertReviewSnapshot(record, {
      expectedGraphRevision,
      expectedCandidateRevision,
    })
    return buildBulkReviewPreview(record, normalizedCandidateIds, this.config)
  }

  async getGraph(datasetVersionId) {
    const record = await this.repository.get(datasetVersionId)
    const graph = this.normalizedTraceGraph(record)
    return {
      datasetVersionId,
      graph: structuredClone(graph),
      validation: structuredClone(record.topologyValidation ?? null),
      confirmedRelations: structuredClone(record.confirmedRelations ?? []),
    }
  }

  async trace(
    datasetVersionId,
    request = {},
    actorId = null,
    correlationId = null,
    traceContext = {},
  ) {
    const startedAt = Date.now()
    const normalized = normalizeTraceRequest(request)
    normalized.correlationId = correlationId
    const record = await this.repository.get(datasetVersionId)
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const resolver = createAssetIdentityResolver(identityMap)
    const graph = this.normalizedTraceGraph(record, identityMap)

    if (normalized.graphRevision !== graph.graphRevision) {
      const error = new AppError(
        'Graph topology berubah sejak peta dimuat. Muat ulang dataset aktif sebelum tracing.',
        {
          code: 'topology_graph_stale',
          statusCode: 409,
          details: {
            requestedGraphRevision: normalized.graphRevision,
            currentGraphRevision: graph.graphRevision,
            datasetVersionId,
          },
        },
      )
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result: { status: 'stale', graphRevision: graph.graphRevision },
        durationMilliseconds: Date.now() - startedAt,
      })
      throw error
    }

    const validationErrors = graphValidationErrorCount(record.topologyValidation)
    if (validationErrors > 0) {
      const error = new AppError(
        'Tracing dihentikan karena confirmed graph tidak valid.',
        {
          code: 'topology_graph_invalid',
          statusCode: 409,
          details: {
            datasetVersionId,
            graphRevision: graph.graphRevision,
            validationErrorCount: validationErrors,
          },
        },
      )
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result: { status: 'invalid', graphRevision: graph.graphRevision },
        durationMilliseconds: Date.now() - startedAt,
      })
      throw error
    }

    const unavailablePublication = record.datasetVersion?.publicationProfile
      && record.datasetVersion.publicationProfile !== 'operational_topology'
    if (unavailablePublication && !isTopologyPreviewAllowed(traceContext)) {
      const result = traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId: normalized.sourceAssetId,
        targetAssetId: normalized.targetAssetId,
        mode: normalized.mode,
        direction: normalized.direction,
        status: 'unavailable',
        reason: 'topology_not_published',
        message: traceMessageForReason('topology_not_published'),
      })
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result,
        durationMilliseconds: Date.now() - startedAt,
      })
      return result
    }

    const cacheKey = topologyResultCacheKey(
      'trace',
      datasetVersionId,
      graph.graphRevision,
      normalized,
    )
    const cached = readTopologyResultCache(this.traceResultCache, cacheKey)
    if (cached) {
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result: cached,
        durationMilliseconds: Date.now() - startedAt,
        cacheHit: true,
      })
      return cached
    }
    const finalize = async (result) => {
      const finalized = decorateTopologyPreviewResult(result, traceContext, record)
      if (!isTopologyPreviewAllowed(traceContext)) {
        writeTopologyResultCache(this.traceResultCache, cacheKey, finalized)
      }
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result: finalized,
        durationMilliseconds: Date.now() - startedAt,
      })
      return finalized
    }

    const scopeNodeIds = normalized.scopeAssetIds === null
      ? null
      : new Set(normalized.scopeAssetIds
        .map((assetId) => resolveTraceAssetId(resolver, graph, assetId))
        .filter(Boolean))
    const traversalGraph = scopeNodeIds === null
      ? graph
      : restrictTraceGraph(graph, scopeNodeIds)
    const nodeIds = new Set(traversalGraph.nodes.map(({ id }) => id))
    const sourceAssetId = resolveTraceAssetId(
      resolver,
      graph,
      normalized.sourceAssetId,
    )
    if (!sourceAssetId) {
      return finalize(traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId: normalized.sourceAssetId,
        targetAssetId: normalized.targetAssetId,
        mode: normalized.mode,
        direction: normalized.direction,
        status: 'invalid-source',
        reason: 'source_not_topology_node',
        message: traceMessageForReason('source_not_topology_node'),
      }))
    }
    if (!nodeIds.has(sourceAssetId)) {
      return finalize(traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId,
        targetAssetId: normalized.targetAssetId,
        mode: normalized.mode,
        direction: normalized.direction,
        status: 'unreachable',
        reason: 'scope_excludes_path',
        message: traceMessageForReason('scope_excludes_path'),
      }))
    }

    const targetAssetId = normalized.targetAssetId === null
      ? null
      : resolveTraceAssetId(resolver, graph, normalized.targetAssetId)
    if (normalized.targetAssetId !== null && !targetAssetId) {
      return finalize(traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId,
        targetAssetId: normalized.targetAssetId,
        mode: normalized.mode,
        direction: normalized.direction,
        status: 'invalid-target',
        reason: 'target_not_topology_node',
        message: traceMessageForReason('target_not_topology_node'),
      }))
    }
    if (targetAssetId !== null && !nodeIds.has(targetAssetId)) {
      return finalize(traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId,
        targetAssetId,
        mode: normalized.mode,
        direction: normalized.direction,
        status: 'unreachable',
        reason: 'scope_excludes_path',
        message: traceMessageForReason('scope_excludes_path'),
      }))
    }

    const traversal = buildTraceTraversal(traversalGraph, normalized)
    const adjacency = traversal.adjacency
    const physicalAdjacency = buildTraceAdjacency(traversalGraph, {
      mode: 'connectivity',
      direction: 'both',
    })
    const componentId = componentIdForNode(traversalGraph, sourceAssetId)
    const availabilityReason = traceAvailabilityReason(
      traversalGraph,
      physicalAdjacency,
      normalized,
      sourceAssetId,
    )
    if (availabilityReason) {
      return finalize(traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId,
        targetAssetId,
        componentId,
        mode: normalized.mode,
        direction: normalized.direction,
        status: 'unreachable',
        reason: availabilityReason,
        message: traceMessageForReason(availabilityReason),
      }))
    }

    if (targetAssetId === null) {
      const traversalResult = reachableDestinations(
        adjacency,
        sourceAssetId,
        normalized.maxDepth,
      )
      const destinations = traversalResult.destinations
      const reason = destinations.length
        ? null
        : traversalResult.truncated
          ? 'max_depth_reached'
          : traversalGraph.degreeByNode?.[sourceAssetId] === 0
            ? 'isolated_source'
            : 'unreachable'
      const result = destinations.length
        ? {
          status: 'destinations',
          datasetVersionId,
          graphRevision: graph.graphRevision,
          sourceAssetId,
          componentId,
          mode: normalized.mode,
          direction: normalized.direction,
          maxDepth: normalized.maxDepth,
          truncated: traversalResult.truncated,
          destinations,
          explanation: 'Tujuan dihitung dari confirmed operational graph.',
        }
        : traceState({
          datasetVersionId,
          graphRevision: graph.graphRevision,
          sourceAssetId,
          componentId,
          mode: normalized.mode,
          direction: normalized.direction,
          status: 'unreachable',
          reason,
          message: traceMessageForReason(reason),
        })
      return finalize(result)
    }

    if (sourceAssetId === targetAssetId) {
      return finalize({
        status: 'found',
        datasetVersionId,
        graphRevision: graph.graphRevision,
        mode: normalized.mode,
        componentId,
        sourceAssetId,
        targetAssetId,
        nodeIds: [sourceAssetId],
        edges: [],
        hopCount: 0,
        totalLengthMeters: null,
        networkFamily: networkFamilyForNodes(traversalGraph, [sourceAssetId]),
        direction: normalized.direction,
        maxDepth: normalized.maxDepth,
        verifiedAt: record.topologyGeneratedAt ?? null,
        explanation: 'Titik awal dan tujuan adalah aset yang sama.',
      })
    }

    const pathResult = findTracePath(
      adjacency,
      sourceAssetId,
      targetAssetId,
      normalized.maxDepth,
    )
    if (!pathResult.path) {
      const targetComponentId = componentIdForNode(traversalGraph, targetAssetId)
      const physicalPath = findTracePath(
        physicalAdjacency,
        sourceAssetId,
        targetAssetId,
        normalized.maxDepth,
      )
      const reason = pathResult.truncated
        ? 'max_depth_reached'
        : normalized.scopeAssetIds !== null
          ? 'scope_excludes_path'
          : hasUnavailableDirectionOnPhysicalPath(traversalGraph, physicalPath)
            ? 'direction_not_available'
            : traversalGraph.degreeByNode?.[sourceAssetId] === 0
              ? 'isolated_source'
              : hasPendingCandidate(record, resolver, sourceAssetId, targetAssetId)
                ? 'candidate_pending_review'
                : componentId !== targetComponentId
                  ? 'different_component'
                  : 'unreachable'
      return finalize(traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId,
        targetAssetId,
        componentId,
        mode: normalized.mode,
        direction: normalized.direction,
        status: 'unreachable',
        reason,
        message: traceMessageForReason(reason),
      }))
    }

    const edges = pathResult.path.map(({ edge, source, target }) => (
      traceEdge(edge, source, target)
    ))
    return finalize({
      status: 'found',
      datasetVersionId,
      graphRevision: graph.graphRevision,
      mode: normalized.mode,
      componentId,
      sourceAssetId,
      targetAssetId,
      nodeIds: [sourceAssetId, ...pathResult.path.map(({ target }) => target)],
      edges,
      hopCount: edges.length,
      totalLengthMeters: sumLength(edges),
      networkFamily: networkFamilyForNodes(traversalGraph, [
        sourceAssetId,
        ...pathResult.path.map(({ target }) => target),
      ]),
      direction: normalized.direction,
      maxDepth: normalized.maxDepth,
      verifiedAt: record.topologyGeneratedAt ?? null,
      explanation: 'Jalur menggunakan confirmed operational graph.',
    })
  }

  async getRoots(datasetVersionId, request = {}) {
    const graphRevision = request?.graphRevision === undefined
      || request?.graphRevision === null
      ? null
      : normalizeTraceId(request.graphRevision, 'graphRevision', true)
    const record = await this.repository.get(datasetVersionId)
    const graph = this.normalizedTraceGraph(
      record,
      buildAssetIdentityMapFromRecord(record),
    )
    if (graphRevision !== null && graphRevision !== graph.graphRevision) {
      throw new AppError(
        'Graph topology berubah sejak root dimuat. Muat ulang dataset aktif.',
        {
          code: 'topology_graph_stale',
          statusCode: 409,
          details: {
            requestedGraphRevision: graphRevision,
            currentGraphRevision: graph.graphRevision,
            datasetVersionId,
          },
        },
      )
    }
    const validationErrors = graphValidationErrorCount(record.topologyValidation)
    if (validationErrors > 0) {
      throw new AppError('Root topology tidak dapat dibaca dari graph invalid.', {
        code: 'topology_graph_invalid',
        statusCode: 409,
        details: {
          datasetVersionId,
          graphRevision: graph.graphRevision,
          validationErrorCount: validationErrors,
        },
      })
    }
    const roots = verifiedRootNodes(graph).map((node) => ({
      assetId: node.id,
      topologyRole: node.topologyRole,
      siteId: node.siteId ?? null,
      networkFamily: node.networkFamily ?? null,
      category: node.category ?? null,
      componentId: componentIdForNode(graph, node.id),
    }))
    return {
      datasetVersionId,
      graphRevision: graph.graphRevision,
      roots,
      rootAssetIds: roots.map(({ assetId }) => assetId),
      directionCoverage: directionCoverageForGraph(graph),
      status: roots.length ? 'ready' : 'unavailable',
      reason: roots.length ? null : 'root_not_defined',
    }
  }

  async impact(
    datasetVersionId,
    request = {},
    actorId = null,
    correlationId = null,
    impactContext = {},
  ) {
    const startedAt = Date.now()
    const normalized = normalizeImpactRequest(request)
    normalized.correlationId = correlationId
    const record = await this.repository.get(datasetVersionId)
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const resolver = createAssetIdentityResolver(identityMap)
    const graph = this.normalizedTraceGraph(record, identityMap)

    if (normalized.graphRevision !== graph.graphRevision) {
      const error = new AppError(
        'Graph topology berubah sejak peta dimuat. Muat ulang dataset aktif sebelum impact analysis.',
        {
          code: 'topology_graph_stale',
          statusCode: 409,
          details: {
            requestedGraphRevision: normalized.graphRevision,
            currentGraphRevision: graph.graphRevision,
            datasetVersionId,
          },
        },
      )
      await recordImpactAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result: { status: 'stale', graphRevision: graph.graphRevision },
        durationMilliseconds: Date.now() - startedAt,
      })
      throw error
    }

    const validationErrors = graphValidationErrorCount(record.topologyValidation)
    if (validationErrors > 0) {
      const error = new AppError(
        'Impact analysis dihentikan karena confirmed graph tidak valid.',
        {
          code: 'topology_graph_invalid',
          statusCode: 409,
          details: {
            datasetVersionId,
            graphRevision: graph.graphRevision,
            validationErrorCount: validationErrors,
          },
        },
      )
      await recordImpactAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result: { status: 'invalid', graphRevision: graph.graphRevision },
        durationMilliseconds: Date.now() - startedAt,
      })
      throw error
    }

    const unavailablePublication = record.datasetVersion?.publicationProfile
      && record.datasetVersion.publicationProfile !== 'operational_topology'
    if (unavailablePublication && !isTopologyPreviewAllowed(impactContext)) {
      const result = impactUnavailable({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        normalized,
        reason: 'topology_not_published',
        limitation: 'Impact analysis hanya tersedia pada profile operational_topology.',
      })
      await recordImpactAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result,
        durationMilliseconds: Date.now() - startedAt,
      })
      return result
    }

    const cacheKey = topologyResultCacheKey(
      'impact',
      datasetVersionId,
      graph.graphRevision,
      normalized,
    )
    const cached = readTopologyResultCache(this.impactResultCache, cacheKey)
    if (cached) {
      await recordImpactAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result: cached,
        durationMilliseconds: Date.now() - startedAt,
        cacheHit: true,
      })
      return cached
    }
    const finalize = async (result) => {
      const finalized = decorateTopologyPreviewResult(result, impactContext, record)
      if (!isTopologyPreviewAllowed(impactContext)) {
        writeTopologyResultCache(this.impactResultCache, cacheKey, finalized)
      }
      await recordImpactAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result: finalized,
        durationMilliseconds: Date.now() - startedAt,
      })
      return finalized
    }

    let scopedGraph = graph
    if (normalized.scopeAssetIds !== null) {
      const scopeNodeIds = new Set(normalized.scopeAssetIds
        .map((assetId) => resolveTraceAssetId(resolver, graph, assetId))
        .filter(Boolean))
      scopedGraph = restrictTraceGraph(graph, scopeNodeIds)
    }
    if (normalized.networkFamily !== null) {
      const familyNodeIds = new Set(scopedGraph.nodes
        .filter(({ networkFamily }) => networkFamily === normalized.networkFamily)
        .map(({ id }) => id))
      scopedGraph = restrictTraceGraph(scopedGraph, familyNodeIds)
    }

    const failure = resolveImpactFailure(scopedGraph, normalized, resolver)
    if (!failure) {
      return finalize(impactUnavailable({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        normalized,
        reason: normalized.scopeAssetIds !== null
          ? 'scope_excludes_path'
          : 'failure_not_in_graph',
        limitation: 'Failure ID tidak ditemukan pada confirmed graph yang dianalisis.',
      }))
    }

    const roots = resolveImpactRoots(
      scopedGraph,
      resolver,
      normalized.rootAssetIds,
    )
    if (!roots.length) {
      return finalize(impactUnavailable({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        normalized,
        failure,
        reason: normalized.rootAssetIds ? 'root_not_defined' : 'root_not_defined',
        limitation: 'Minimal satu verified root diperlukan untuk impact analysis.',
      }))
    }

    const serviceAdjacency = buildTraceAdjacency(scopedGraph, {
      mode: 'reachable',
      direction: 'downstream',
    })
    const physicalAdjacency = buildTraceAdjacency(scopedGraph, {
      mode: 'connectivity',
      direction: 'both',
    })
    const baselineReachable = reachableSet(serviceAdjacency, roots.map(({ id }) => id))
    const physicalReachable = reachableSet(physicalAdjacency, roots.map(({ id }) => id))
    const incompleteDirectionNodes = reachableViaUndirectedEdge(
      physicalAdjacency,
      roots.map(({ id }) => id),
    )
    const simulatedGraph = simulateImpactFailure(scopedGraph, failure)
    const afterAdjacency = buildTraceAdjacency(simulatedGraph, {
      mode: 'reachable',
      direction: 'downstream',
    })
    const remainingRoots = roots
      .map(({ id }) => id)
      .filter((id) => simulatedGraph.nodes.some((node) => node.id === id))
    const afterReachable = reachableSet(afterAdjacency, remainingRoots)
    const confirmedImpactedIds = [...baselineReachable]
      .filter((id) => !afterReachable.has(id))
      .sort()
    const potentialIds = [...physicalReachable]
      .filter((id) => !baselineReachable.has(id) && incompleteDirectionNodes.has(id))
      .sort()
    const confirmedImpacted = impactNodes(
      scopedGraph,
      confirmedImpactedIds,
      'lost_root_reachability',
    )
    const potentiallyImpacted = impactNodes(
      scopedGraph,
      potentialIds,
      'direction_incomplete',
    )
    const cutEdges = failure.edges.map((edge) => ({
      ...traceEdge(edge, edge.sourceAssetId, edge.targetAssetId),
      failureType: normalized.failureType,
      failureId: normalized.failureId,
    }))
    const limitations = []
    const incompleteDirection = hasIncompleteDirectionOnRootArea(
      scopedGraph,
      physicalReachable,
      baselineReachable,
      incompleteDirectionNodes,
    )
    if (incompleteDirection) {
      limitations.push('Sebagian area hanya terhubung melalui edge undirected; potential impact dipisahkan.')
    }
    if (normalized.scopeAssetIds !== null) {
      limitations.push('Analisis dibatasi oleh scopeAssetIds yang diminta.')
    }
    const result = {
      status: incompleteDirection ? 'partial' : 'completed',
      datasetVersionId,
      graphRevision: graph.graphRevision,
      failure: {
        type: normalized.failureType,
        id: normalized.failureId,
        resolvedAssetId: failure.resolvedAssetId ?? null,
      },
      roots: roots.map(({ id }) => id),
      confirmedImpacted,
      potentiallyImpacted,
      confirmedTopologyImpact: confirmedImpacted,
      potentialTopologyImpact: potentiallyImpacted,
      confirmedGroups: groupImpactItems(confirmedImpacted),
      potentialGroups: groupImpactItems(potentiallyImpacted),
      cutEdges,
      summary: {
        baselineReachable: baselineReachable.size,
        reachableAfterFailure: afterReachable.size,
        confirmedImpacted: confirmedImpacted.length,
        potentiallyImpacted: potentiallyImpacted.length,
      },
      limitations,
      computedAt: this.clock().toISOString(),
    }
    return finalize(result)
  }

  async confirmCandidate(candidateId, actorId, {
    datasetVersionId,
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    return this.#reviewCandidate(candidateId, actorId, {
      action: 'confirm',
      datasetVersionId,
      reason: normalizeReason(reason, false),
      expectedGraphRevision,
      expectedCandidateRevision,
      idempotencyKey,
      correlationId,
    })
  }

  async confirmAllCandidates(datasetVersionId, actorId, {
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    return this.#confirmCandidatesBulk(datasetVersionId, actorId, {
      reason,
      action: 'confirm_all',
      eventName: 'topology.candidates_bulk_confirmed',
      predicate: isBulkConfirmableCandidate,
      requireSafePreview: true,
      expectedGraphRevision,
      expectedCandidateRevision,
      idempotencyKey,
      correlationId,
    })
  }

  async confirmSelectedCandidates(datasetVersionId, actorId, {
    candidateIds,
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    return this.#confirmCandidatesBulk(datasetVersionId, actorId, {
      reason,
      action: 'confirm_selected',
      eventName: 'topology.candidates_selected_bulk_confirmed',
      predicate: isBulkConfirmableCandidate,
      selectedCandidateIds: normalizeCandidateIds(candidateIds),
      requireSafePreview: true,
      expectedGraphRevision,
      expectedCandidateRevision,
      idempotencyKey,
      correlationId,
    })
  }

  async confirmLineLabelCandidates(datasetVersionId, actorId, {
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    return this.#confirmCandidatesBulk(datasetVersionId, actorId, {
      reason,
      action: 'confirm_line_labels',
      eventName: 'topology.line_label_connections_bulk_confirmed',
      predicate: isLineLabelConfirmableCandidate,
      requireSafePreview: true,
      expectedGraphRevision,
      expectedCandidateRevision,
      idempotencyKey,
      correlationId,
    })
  }

  async #confirmCandidatesBulk(datasetVersionId, actorId, {
    reason,
    action,
    eventName,
    predicate,
    selectedCandidateIds = null,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
    requireSafePreview = false,
  }) {
    const normalizedIdempotencyKey = normalizeTopologyIdempotencyKey(idempotencyKey)
    const normalizedReason = normalizeReason(reason, true)
    const fingerprint = normalizedIdempotencyKey
      ? createTopologyMutationFingerprint({
        action,
        resourceId: datasetVersionId,
        actorId,
        input: {
          reason: normalizedReason,
          ...(selectedCandidateIds ? { candidateIds: selectedCandidateIds } : {}),
          expectedGraphRevision: expectedGraphRevision ?? null,
          expectedCandidateRevision: expectedCandidateRevision ?? null,
        },
      })
      : null
    try {
      return await this.#withDatasetMutationLock(datasetVersionId, () => (
        this.#withMutationTransaction(async ({ repository, auditLog }) => {
        const replay = await findMutationReceipt(repository, normalizedIdempotencyKey, fingerprint)
        if (replay) return replay
        const current = await repository.get(datasetVersionId)
        assertTopologyBundle(current)
        assertReviewSnapshot(current, { expectedGraphRevision, expectedCandidateRevision })
        const candidates = current.topologyCandidates ?? []
        const selectedCandidateIdSet = selectedCandidateIds
          ? new Set(selectedCandidateIds)
          : null
        const confirmable = candidates.filter((candidate) => (
          (!selectedCandidateIdSet || selectedCandidateIdSet.has(candidate.candidateId))
          && predicate(candidate)
        ))
        if (selectedCandidateIds
          && confirmable.length !== selectedCandidateIds.length) {
          const currentById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]))
          const invalidCandidateIds = selectedCandidateIds.filter((candidateId) => (
            !currentById.has(candidateId) || !predicate(currentById.get(candidateId))
          ))
          throw new AppError('Sebagian koneksi yang dipilih sudah berubah sejak review dimuat.', {
            code: 'stale_topology_bulk_review',
            statusCode: 409,
            details: { candidateIds: invalidCandidateIds },
          })
        }
        if (!confirmable.length) {
          const response = bulkReviewResponse({
            ...current,
            recordRevision: recordRevision(current) + (normalizedIdempotencyKey ? 1 : 0),
          }, {
            action,
            affectedCount: 0,
          })
          if (!normalizedIdempotencyKey) return response
          await repository.update(datasetVersionId, (record) => (
            appendTopologyMutationReceipt(record, {
              key: normalizedIdempotencyKey,
              fingerprint,
              action,
              resourceId: datasetVersionId,
              actorId,
              response,
              createdAt: this.clock().toISOString(),
            })
          ), {
            expectedRevision: recordRevision(current),
            projectionMode: 'topology-review',
          })
          return response
        }
        if (requireSafePreview) {
          const previewCandidateIds = selectedCandidateIds
            ?? confirmable.map(({ candidateId }) => candidateId)
          const preview = buildBulkReviewPreview(current, previewCandidateIds, this.config)
          if (!preview.safeToApply) {
            throw new AppError(
              'Bulk review ditolak karena preview topology tidak aman untuk diterapkan.',
              {
                code: 'topology_bulk_review_not_safe',
                statusCode: 422,
                details: preview,
              },
            )
          }
        }

        const reviewedAt = this.clock().toISOString()
        const candidateIds = confirmable.map(({ candidateId }) => candidateId)
        const candidateIdSet = new Set(candidateIds)
        let event = null
        const updated = await repository.update(datasetVersionId, async (record) => {
          assertReviewSnapshot(record, { expectedGraphRevision, expectedCandidateRevision })
          const nextCandidates = structuredClone(record.topologyCandidates ?? [])
          nextCandidates.forEach((candidate) => {
            if (!candidateIdSet.has(candidate.candidateId)) return
            if (!predicate(candidate)) {
              throw new AppError('Daftar kandidat berubah sejak aksi bulk dimulai.', {
                code: 'stale_topology_bulk_review',
                statusCode: 409,
              })
            }
          })
          event = await auditLog.record(eventName, {
            actorId,
            datasetVersionId,
            branchId: record.datasetVersion.branchId,
            correlationId,
            outcome: 'confirmed',
            details: {
              graphRevision: record.topologyGraph?.graphRevision ?? null,
              candidateCount: candidateIds.length,
              candidateIds,
              reason: normalizedReason,
              topologyRuleSetVersion: record.topologyRuleSetVersion ?? null,
            },
          })
          nextCandidates.forEach((candidate) => {
            if (!candidateIdSet.has(candidate.candidateId)) return
            candidate.candidateStatus = 'confirmed'
            candidate.proposalStatus = 'confirmed_by_admin_bulk'
            candidate.review = reviewRecord({
              actorId,
              reviewedAt,
              reason: normalizedReason,
              action,
              auditEventId: event.id,
              before: 'candidate',
              after: 'confirmed',
            })
          })
          const rebuilt = rebuildFromReviewedCandidates(
            record,
            nextCandidates,
            this.config,
            reviewedAt,
            confirmable.flatMap(candidateAssetReferences),
          )
          if (!normalizedIdempotencyKey) return rebuilt
          const response = bulkReviewResponse({
            ...rebuilt,
            recordRevision: recordRevision(record) + 1,
          }, {
            action,
            affectedCount: candidateIds.length,
            candidateIds,
            auditEventId: event.id,
          })
          return appendTopologyMutationReceipt(rebuilt, {
            key: normalizedIdempotencyKey,
            fingerprint,
            action,
            resourceId: datasetVersionId,
            actorId,
            response,
            createdAt: reviewedAt,
          })
        }, {
          expectedRevision: recordRevision(current),
          projectionMode: 'topology-review',
        })
        if (normalizedIdempotencyKey) {
          const receipt = findTopologyMutationReceipt(updated, normalizedIdempotencyKey)
          if (receipt) return structuredClone(receipt.response)
        }
        return bulkReviewResponse(updated, {
          action,
          affectedCount: candidateIds.length,
          candidateIds,
          auditEventId: event.id,
        })
        })
      ))
    } catch (error) {
      if (!normalizedIdempotencyKey || error?.code !== 'dataset_version_stale_revision') {
        throw error
      }
      const replay = await findMutationReceipt(this.repository, normalizedIdempotencyKey, fingerprint)
      if (replay) return replay
      throw error
    }
  }

  async rejectCandidate(candidateId, actorId, {
    datasetVersionId,
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    return this.#reviewCandidate(candidateId, actorId, {
      action: 'reject',
      datasetVersionId,
      reason: normalizeReason(reason, true),
      expectedGraphRevision,
      expectedCandidateRevision,
      idempotencyKey,
      correlationId,
    })
  }

  async skipCandidate(candidateId, actorId, {
    datasetVersionId,
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    return this.#reviewCandidate(candidateId, actorId, {
      action: 'skip',
      datasetVersionId,
      reason: normalizeReason(reason, false),
      expectedGraphRevision,
      expectedCandidateRevision,
      idempotencyKey,
      correlationId,
    })
  }

  async selectTarget(candidateId, actorId, {
    datasetVersionId,
    targetCandidateId,
    targetAssetId,
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    const normalizedIdempotencyKey = normalizeTopologyIdempotencyKey(idempotencyKey)
    const normalizedReason = normalizeReason(reason, true)
    const fingerprint = normalizedIdempotencyKey
      ? createTopologyMutationFingerprint({
        action: 'select_target',
        resourceId: candidateId,
        actorId,
        input: {
          targetCandidateId: targetCandidateId ?? null,
          targetAssetId: targetAssetId ?? null,
          reason: normalizedReason,
          expectedGraphRevision: expectedGraphRevision ?? null,
          expectedCandidateRevision: expectedCandidateRevision ?? null,
        },
      })
      : null
    try {
      return await this.#withMutationTransaction(async ({ repository, auditLog }) => {
        const replay = await findMutationReceipt(repository, normalizedIdempotencyKey, fingerprint)
        if (replay) return replay
        const located = await this.#findCandidate(candidateId, repository, datasetVersionId)
        assertReviewSnapshot(located.record, { expectedGraphRevision, expectedCandidateRevision })
        const candidates = located.record.topologyCandidates ?? []
        const original = candidates.find((candidate) => candidate.candidateId === candidateId)
        const selected = targetCandidateId
          ? candidates.find((candidate) => candidate.candidateId === targetCandidateId)
          : candidates.find((candidate) => (
            candidate.sourceEndpointId === original.sourceEndpointId
            && candidate.targetAssetId === targetAssetId
          ))
        if (!selected) {
          throw new AppError('Candidate target pengganti tidak ditemukan.', {
            code: 'topology_target_candidate_not_found',
            statusCode: 404,
          })
        }
        if (selected.sourceEndpointId !== original.sourceEndpointId) {
          throw new AppError('Candidate target bukan milik endpoint yang sama.', {
            code: 'topology_target_candidate_mismatch',
            statusCode: 409,
          })
        }
        if (!['candidate', 'ambiguous', 'revoked'].includes(selected.candidateStatus)) {
          throw invalidTransition(selected.candidateStatus, 'confirmed')
        }
        const reviewedAt = this.clock().toISOString()
        let event = null
        const updated = await repository.update(located.datasetVersionId, async (record) => {
          assertReviewSnapshot(record, { expectedGraphRevision, expectedCandidateRevision })
          const nextCandidates = structuredClone(record.topologyCandidates ?? [])
          const currentOriginal = nextCandidates.find(({ candidateId: id }) => id === candidateId)
          const currentSelected = nextCandidates.find(({ candidateId: id }) => (
            id === selected.candidateId
          ))
          assertCurrentCandidateState(currentSelected, selected.candidateStatus)
          assertCandidateTopologyEligible(record, currentSelected)
          event = await auditLog.record('topology.candidate_target_selected', {
            actorId,
            datasetVersionId: located.datasetVersionId,
            branchId: record.datasetVersion.branchId,
            correlationId,
            outcome: 'confirmed',
            details: {
              graphRevision: record.topologyGraph?.graphRevision ?? null,
              before: candidateAuditSnapshot(currentOriginal),
              after: candidateAuditSnapshot(currentSelected, 'confirmed'),
              reason: normalizedReason,
              candidateEvidence: currentSelected.evidence,
              topologyRuleSetVersion: currentSelected.topologyRuleSetVersion,
            },
          })
          currentOriginal.candidateStatus = 'rejected'
          currentOriginal.proposalStatus = 'target_replaced'
          currentOriginal.review = reviewRecord({
            actorId,
            reviewedAt,
            reason: normalizedReason,
            action: 'select_target_replaced',
            auditEventId: event.id,
            before: original.candidateStatus,
            after: 'rejected',
          })
          currentSelected.candidateStatus = 'confirmed'
          currentSelected.proposalStatus = 'selected_by_admin'
          currentSelected.review = reviewRecord({
            actorId,
            reviewedAt,
            reason: normalizedReason,
            action: 'select_target',
            auditEventId: event.id,
            before: selected.candidateStatus,
            after: 'confirmed',
          })
          const rebuilt = rebuildFromReviewedCandidates(
            record,
            nextCandidates,
            this.config,
            reviewedAt,
            [
              ...candidateAssetReferences(original),
              ...candidateAssetReferences(selected),
            ],
          )
          if (!normalizedIdempotencyKey) return rebuilt
          const response = candidateReviewResponse({
            ...rebuilt,
            recordRevision: recordRevision(record) + 1,
          }, selected.candidateId)
          return appendTopologyMutationReceipt(rebuilt, {
            key: normalizedIdempotencyKey,
            fingerprint,
            action: 'select_target',
            resourceId: candidateId,
            actorId,
            response,
            createdAt: reviewedAt,
          })
        }, {
          expectedRevision: recordRevision(located.record),
          projectionMode: 'topology-review',
        })
        if (normalizedIdempotencyKey) {
          const receipt = findTopologyMutationReceipt(updated, normalizedIdempotencyKey)
          if (receipt) return structuredClone(receipt.response)
        }
        return candidateReviewResponse(updated, selected.candidateId)
      })
    } catch (error) {
      if (!normalizedIdempotencyKey || error?.code !== 'dataset_version_stale_revision') {
        throw error
      }
      const replay = await findMutationReceipt(this.repository, normalizedIdempotencyKey, fingerprint)
      if (replay) return replay
      throw error
    }
  }

  async createDeviceRelation(datasetVersionId, actorId, {
    sourceAssetId,
    targetAssetId,
    relationType = 'connected-to',
    relationKind,
    direction = 'undirected',
    pathAssetIds,
    sourceGeometryIds,
    reason,
    evidenceRefs,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    const normalizedSourceReference = normalizeTopologyAssetReference(
      sourceAssetId,
      'sourceAssetId',
    )
    const normalizedTargetReference = normalizeTopologyAssetReference(
      targetAssetId,
      'targetAssetId',
    )
    const normalizedRelationType = normalizeManualRelationType(relationType)
    const normalizedRelationKind = normalizeManualRelationKind(relationKind)
    const normalizedDirection = normalizeManualDirection(direction)
    const normalizedPathAssetIds = normalizeManualReferenceList(pathAssetIds, 'pathAssetIds')
    const normalizedSourceGeometryIds = normalizeManualReferenceList(
      sourceGeometryIds,
      'sourceGeometryIds',
    )
    const normalizedReason = normalizeReason(reason, true)
    const normalizedEvidenceRefs = normalizeManualReferenceList(evidenceRefs, 'evidenceRefs')
    const normalizedIdempotencyKey = normalizeTopologyIdempotencyKey(idempotencyKey)
    const fingerprint = normalizedIdempotencyKey
      ? createTopologyMutationFingerprint({
        action: 'create_device_relation',
        resourceId: datasetVersionId,
        actorId,
        input: {
          sourceAssetId: normalizedSourceReference,
          targetAssetId: normalizedTargetReference,
          relationType: normalizedRelationType,
          relationKind: normalizedRelationKind,
          direction: normalizedDirection,
          pathAssetIds: normalizedPathAssetIds,
          sourceGeometryIds: normalizedSourceGeometryIds,
          reason: normalizedReason,
          evidenceRefs: normalizedEvidenceRefs,
          expectedGraphRevision: expectedGraphRevision ?? null,
          expectedCandidateRevision: expectedCandidateRevision ?? null,
        },
      })
      : null
    try {
    return await this.#withMutationTransaction(async ({ repository, auditLog }) => {
    const replay = await findMutationReceipt(repository, normalizedIdempotencyKey, fingerprint)
    if (replay) return replay
    const current = await repository.get(datasetVersionId)
    assertTopologyBundle(current)
    assertReviewSnapshot(current, { expectedGraphRevision, expectedCandidateRevision })
    const initialSource = resolveManualDevice(current, normalizedSourceReference, 'sourceAssetId')
    const initialTarget = resolveManualDevice(current, normalizedTargetReference, 'targetAssetId')
    assertDistinctManualDevices(initialSource, initialTarget)
    assertSameManualDeviceSite(initialSource, initialTarget)
    assertManualEvidenceReferences(current, {
      source: initialSource,
      target: initialTarget,
      pathAssetIds: normalizedPathAssetIds,
      sourceGeometryIds: normalizedSourceGeometryIds,
    })
    assertNoConfirmedManualDevicePair(current, initialSource, initialTarget)

    const createdAt = this.clock().toISOString()
    const explicitRelationEvidenceId = `manual:${randomUUID()}`
    let event = null
    const updated = await repository.update(datasetVersionId, async (record) => {
      assertReviewSnapshot(record, { expectedGraphRevision, expectedCandidateRevision })
      const source = resolveManualDevice(record, normalizedSourceReference, 'sourceAssetId')
      const target = resolveManualDevice(record, normalizedTargetReference, 'targetAssetId')
      assertDistinctManualDevices(source, target)
      assertSameManualDeviceSite(source, target)
      assertManualEvidenceReferences(record, {
        source,
        target,
        pathAssetIds: normalizedPathAssetIds,
        sourceGeometryIds: normalizedSourceGeometryIds,
      })
      assertNoConfirmedManualDevicePair(record, source, target)
      event = await auditLog.record('topology.manual_device_relation_confirmed', {
        actorId,
        datasetVersionId,
        branchId: record.datasetVersion.branchId,
        correlationId,
        outcome: 'confirmed',
        details: {
          graphRevision: record.topologyGraph?.graphRevision ?? null,
          sourceAssetId: source.canonicalAssetId,
          targetAssetId: target.canonicalAssetId,
          sourceTopologyAssetId: source.topologyAssetId,
          targetTopologyAssetId: target.topologyAssetId,
          relationType: normalizedRelationType,
          relationKind: normalizedRelationKind,
          direction: normalizedDirection,
          pathAssetIds: normalizedPathAssetIds,
          sourceGeometryIds: normalizedSourceGeometryIds,
          reason: normalizedReason,
          evidenceRefs: normalizedEvidenceRefs,
          explicitRelationEvidenceId,
        },
      })

      const nextBundle = structuredClone(record.topologyInputBundle)
      nextBundle.explicitRelations = [
        ...(nextBundle.explicitRelations ?? []),
        {
          explicitRelationEvidenceId,
          datasetVersionId: record.datasetVersion.id,
          sourceReference: source.topologyAssetId,
          targetReference: target.topologyAssetId,
          relationType: normalizedRelationType,
          ...(normalizedRelationKind ? { relationKind: normalizedRelationKind } : {}),
          direction: normalizedDirection,
          pathAssetIds: structuredClone(normalizedPathAssetIds),
          sourceGeometryIds: structuredClone(normalizedSourceGeometryIds),
          evidenceRefs: structuredClone(normalizedEvidenceRefs),
          source: 'manual_admin',
          sourceKey: 'manual_device_connection',
          manualConfirmation: {
            actorId,
            reviewedAt: createdAt,
            reason: normalizedReason,
            auditEventId: event.id,
          },
        },
      ]
      const manualCandidate = createManualExplicitCandidate(nextBundle, {
        relation: nextBundle.explicitRelations.at(-1),
        config: this.config,
        generatedAt: createdAt,
      })
      if (!manualCandidate.candidate) {
        throw new AppError('Koneksi manual tidak dapat dibuat menjadi candidate explicit.', {
          code: 'topology_manual_relation_candidate_missing',
          statusCode: 409,
        })
      }
      const artifacts = rebuildConfirmedRelationArtifacts(nextBundle, {
        config: this.config,
        candidates: [
          ...(record.topologyCandidates ?? []),
          manualCandidate.candidate,
        ],
        previousRelations: record.confirmedRelations,
        previousGraph: record.topologyGraph,
        affectedAssetIds: [source.topologyAssetId, target.topologyAssetId],
        eligibilityIssues: [
          ...(record.topologyEligibilityIssues ?? []),
          ...manualCandidate.eligibilityIssues,
        ],
        lineworkIssues: record.topologyLineworkIssues,
        generatedAt: createdAt,
      })
      const materialized = artifacts.confirmedRelations.find((relation) => (
        relation.provenance === 'manual_admin'
          && relation.auditEventId === event.id
          && relation.verificationStatus === 'confirmed'
      ))
      if (!materialized) {
        throw new AppError('Koneksi manual tidak berhasil dimaterialisasi ke confirmed graph.', {
          code: 'topology_manual_relation_not_materialized',
          statusCode: 409,
        })
      }
      const rebuilt = applyArtifacts({
        ...record,
        topologyInputBundle: nextBundle,
      }, artifacts)
      if (!normalizedIdempotencyKey) return rebuilt
      const response = manualRelationResponse(rebuilt, event.id)
      return appendTopologyMutationReceipt(rebuilt, {
        key: normalizedIdempotencyKey,
        fingerprint,
        action: 'create_device_relation',
        resourceId: datasetVersionId,
        actorId,
        response,
        createdAt,
      })
    }, {
      expectedRevision: recordRevision(current),
      projectionMode: 'topology-review',
    })
    if (normalizedIdempotencyKey) {
      const receipt = findTopologyMutationReceipt(updated, normalizedIdempotencyKey)
      if (receipt) return structuredClone(receipt.response)
    }
    return manualRelationResponse(updated, event.id)
    })
    } catch (error) {
      if (!normalizedIdempotencyKey || error?.code !== 'dataset_version_stale_revision') {
        throw error
      }
      const replay = await findMutationReceipt(this.repository, normalizedIdempotencyKey, fingerprint)
      if (replay) return replay
      throw error
    }
  }

  async revokeRelation(relationId, actorId, {
    datasetVersionId,
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    const normalizedReason = normalizeReason(reason, true)
    const normalizedIdempotencyKey = normalizeTopologyIdempotencyKey(idempotencyKey)
    const fingerprint = normalizedIdempotencyKey
      ? createTopologyMutationFingerprint({
        action: 'revoke_relation',
        resourceId: relationId,
        actorId,
        input: {
          reason: normalizedReason,
          expectedGraphRevision: expectedGraphRevision ?? null,
          expectedCandidateRevision: expectedCandidateRevision ?? null,
        },
      })
      : null
    try {
    return await this.#withMutationTransaction(async ({ repository, auditLog }) => {
    const replay = await findMutationReceipt(repository, normalizedIdempotencyKey, fingerprint)
    if (replay) return replay
    const located = await this.#findRelation(relationId, repository, datasetVersionId)
    assertReviewSnapshot(located.record, { expectedGraphRevision, expectedCandidateRevision })
    const relation = located.relation
    if (relation.verificationStatus !== 'confirmed') {
      throw invalidTransition(relation.verificationStatus, 'revoked')
    }
    const revokedAt = this.clock().toISOString()
    let event = null
    const updated = await repository.update(located.datasetVersionId, async (record) => {
      assertReviewSnapshot(record, { expectedGraphRevision, expectedCandidateRevision })
      const currentRelation = (record.confirmedRelations ?? [])
        .find(({ relationId: id }) => id === relationId)
      if (!currentRelation || currentRelation.verificationStatus !== 'confirmed') {
        throw invalidTransition(currentRelation?.verificationStatus ?? 'missing', 'revoked')
      }
      event = await auditLog.record('topology.relation_revoked', {
        actorId,
        datasetVersionId: located.datasetVersionId,
        branchId: record.datasetVersion.branchId,
        correlationId,
        outcome: 'revoked',
        details: {
          graphRevision: record.topologyGraph?.graphRevision ?? null,
          before: currentRelation,
          after: {
            relationId,
            verificationStatus: 'revoked',
            revokedBy: actorId,
            revokedAt,
          },
          reason: normalizedReason,
          topologyRuleSetVersion: currentRelation.topologyRuleSetVersion,
        },
      })
      const revoked = {
        ...structuredClone(currentRelation),
        verificationStatus: 'revoked',
        revokedBy: actorId,
        revokedAt,
        revokeReason: normalizedReason,
        auditEventId: event.id,
      }
      const nextCandidates = structuredClone(record.topologyCandidates ?? [])
      const candidate = nextCandidates.find(({ candidateId }) => (
        candidateId === currentRelation.candidateId
      ))
      if (candidate) {
        candidate.candidateStatus = 'revoked'
        candidate.proposalStatus = 'revoked'
        candidate.review = reviewRecord({
          actorId,
          reviewedAt: revokedAt,
          reason: normalizedReason,
          action: 'revoke',
          auditEventId: event.id,
          before: 'confirmed',
          after: 'revoked',
        })
      }
      const rebuilt = rebuildFromReviewedCandidates(
        record,
        nextCandidates,
        this.config,
        revokedAt,
        [
          relation.sourceAssetId,
          relation.targetAssetId,
          relation.pathAssetId,
          ...(relation.pathAssetIds ?? []),
          ...(relation.sourceGeometryIds ?? []),
        ],
      )
      rebuilt.topologyRelationHistory = [
        ...(record.topologyRelationHistory ?? []),
        revoked,
      ]
      if (normalizedIdempotencyKey) {
        const response = revokedRelationResponse({
          datasetVersionId: located.datasetVersionId,
          relation: revoked,
          graph: rebuilt.topologyGraph,
          summary: rebuilt.topologySummary,
          confirmedRelations: rebuilt.confirmedRelations,
          candidate: rebuilt.topologyCandidates?.find(({ candidateId }) => (
            candidateId === revoked.candidateId
          )),
          readiness: rebuilt.topologyReadiness,
          ...reviewSnapshot(rebuilt),
        })
        return appendTopologyMutationReceipt(rebuilt, {
          key: normalizedIdempotencyKey,
          fingerprint,
          action: 'revoke_relation',
          resourceId: relationId,
          actorId,
          response,
          createdAt: revokedAt,
        })
      }
      return rebuilt
    }, {
      expectedRevision: recordRevision(located.record),
      projectionMode: 'topology-review',
    })
    if (normalizedIdempotencyKey) {
      const receipt = findTopologyMutationReceipt(updated, normalizedIdempotencyKey)
      if (receipt) return structuredClone(receipt.response)
    }
    return revokedRelationResponse({
      datasetVersionId: located.datasetVersionId,
      relation: {
        ...relation,
        verificationStatus: 'revoked',
        revokedBy: actorId,
        revokedAt,
        auditEventId: event.id,
      },
      graph: updated.topologyGraph,
      summary: updated.topologySummary,
      confirmedRelations: updated.confirmedRelations,
      candidate: updated.topologyCandidates?.find(({ candidateId }) => (
        candidateId === relation.candidateId
      )),
      readiness: updated.topologyReadiness,
      ...reviewSnapshot(updated),
    })
    })
    } catch (error) {
      if (!normalizedIdempotencyKey || error?.code !== 'dataset_version_stale_revision') {
        throw error
      }
      const replay = await findMutationReceipt(this.repository, normalizedIdempotencyKey, fingerprint)
      if (replay) return replay
      throw error
    }
  }

  async revokeAllRelations(datasetVersionId, actorId, {
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  } = {}) {
    const normalizedReason = normalizeReason(reason, true)
    const normalizedIdempotencyKey = normalizeTopologyIdempotencyKey(idempotencyKey)
    const fingerprint = normalizedIdempotencyKey
      ? createTopologyMutationFingerprint({
        action: 'revoke_all',
        resourceId: datasetVersionId,
        actorId,
        input: {
          reason: normalizedReason,
          expectedGraphRevision: expectedGraphRevision ?? null,
          expectedCandidateRevision: expectedCandidateRevision ?? null,
        },
      })
      : null
    try {
    return await this.#withMutationTransaction(async ({ repository, auditLog }) => {
    const replay = await findMutationReceipt(repository, normalizedIdempotencyKey, fingerprint)
    if (replay) return replay
    const current = await repository.get(datasetVersionId)
    assertTopologyBundle(current)
    assertReviewSnapshot(current, { expectedGraphRevision, expectedCandidateRevision })
    const relations = (current.confirmedRelations ?? [])
      .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
    if (!relations.length) {
      const response = bulkReviewResponse({
        ...current,
        recordRevision: recordRevision(current) + (normalizedIdempotencyKey ? 1 : 0),
      }, {
        action: 'revoke_all',
        affectedCount: 0,
      })
      if (!normalizedIdempotencyKey) return response
      await repository.update(datasetVersionId, (record) => (
        appendTopologyMutationReceipt(record, {
          key: normalizedIdempotencyKey,
          fingerprint,
          action: 'revoke_all',
          resourceId: datasetVersionId,
          actorId,
          response,
          createdAt: this.clock().toISOString(),
        })
      ), {
        expectedRevision: recordRevision(current),
        projectionMode: 'topology-review',
      })
      return response
    }

    const revokedAt = this.clock().toISOString()
    const relationIds = relations.map(({ relationId }) => relationId)
    const candidateIds = new Set(relations.map(({ candidateId }) => candidateId).filter(Boolean))
    let event = null
    const updated = await repository.update(datasetVersionId, async (record) => {
      assertReviewSnapshot(record, { expectedGraphRevision, expectedCandidateRevision })
      const currentRelations = (record.confirmedRelations ?? [])
        .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
      const currentRelationIds = new Set(currentRelations.map(({ relationId }) => relationId))
      if (relationIds.some((relationId) => !currentRelationIds.has(relationId))) {
        throw new AppError('Daftar relasi berubah sejak aksi bulk dimulai.', {
          code: 'stale_topology_bulk_review',
          statusCode: 409,
        })
      }
      event = await auditLog.record('topology.relations_bulk_revoked', {
        actorId,
        datasetVersionId,
        branchId: record.datasetVersion.branchId,
        correlationId,
        outcome: 'revoked',
        details: {
          graphRevision: record.topologyGraph?.graphRevision ?? null,
          relationCount: relationIds.length,
          relationIds,
          candidateCount: candidateIds.size,
          candidateIds: [...candidateIds],
          reason: normalizedReason,
          topologyRuleSetVersion: record.topologyRuleSetVersion ?? null,
        },
      })

      const nextCandidates = structuredClone(record.topologyCandidates ?? [])
      nextCandidates.forEach((candidate) => {
        if (!candidateIds.has(candidate.candidateId)) return
        candidate.candidateStatus = 'revoked'
        candidate.proposalStatus = 'revoked'
        candidate.review = reviewRecord({
          actorId,
          reviewedAt: revokedAt,
          reason: normalizedReason,
          action: 'revoke_all',
          auditEventId: event.id,
          before: 'confirmed',
          after: 'revoked',
        })
      })
      const revokedRelations = currentRelations.map((relation) => ({
        ...structuredClone(relation),
        verificationStatus: 'revoked',
        revokedBy: actorId,
        revokedAt,
        revokeReason: normalizedReason,
        auditEventId: event.id,
      }))
      const rebuilt = rebuildFromReviewedCandidates(
        record,
        nextCandidates,
        this.config,
        revokedAt,
        currentRelations.flatMap((relation) => [
          relation.sourceAssetId,
          relation.targetAssetId,
          relation.pathAssetId,
          ...(relation.pathAssetIds ?? []),
          ...(relation.sourceGeometryIds ?? []),
        ]),
      )
      rebuilt.topologyRelationHistory = [
        ...(record.topologyRelationHistory ?? []),
        ...revokedRelations,
      ]
      if (normalizedIdempotencyKey) {
        const response = bulkReviewResponse({
          ...rebuilt,
          recordRevision: recordRevision(record) + 1,
        }, {
          action: 'revoke_all',
          affectedCount: relationIds.length,
          affectedCandidateCount: candidateIds.size,
          candidateIds: [...candidateIds],
          auditEventId: event.id,
        })
        return appendTopologyMutationReceipt(rebuilt, {
          key: normalizedIdempotencyKey,
          fingerprint,
          action: 'revoke_all',
          resourceId: datasetVersionId,
          actorId,
          response,
          createdAt: revokedAt,
        })
      }
      return rebuilt
    }, {
      expectedRevision: recordRevision(current),
      projectionMode: 'topology-review',
    })
    if (normalizedIdempotencyKey) {
      const receipt = findTopologyMutationReceipt(updated, normalizedIdempotencyKey)
      if (receipt) return structuredClone(receipt.response)
    }
    return bulkReviewResponse(updated, {
      action: 'revoke_all',
      affectedCount: relationIds.length,
      affectedCandidateCount: candidateIds.size,
      candidateIds: [...candidateIds],
      auditEventId: event.id,
    })
    })
    } catch (error) {
      if (!normalizedIdempotencyKey || error?.code !== 'dataset_version_stale_revision') {
        throw error
      }
      const replay = await findMutationReceipt(this.repository, normalizedIdempotencyKey, fingerprint)
      if (replay) return replay
      throw error
    }
  }

  async #reviewCandidate(candidateId, actorId, {
    action,
    datasetVersionId,
    reason,
    expectedGraphRevision,
    expectedCandidateRevision,
    idempotencyKey,
    correlationId,
  }) {
    const normalizedIdempotencyKey = normalizeTopologyIdempotencyKey(idempotencyKey)
    const fingerprint = normalizedIdempotencyKey
      ? createTopologyMutationFingerprint({
        action,
        resourceId: candidateId,
        actorId,
        input: {
          reason,
          expectedGraphRevision: expectedGraphRevision ?? null,
          expectedCandidateRevision: expectedCandidateRevision ?? null,
        },
      })
      : null
    try {
      return await this.#withMutationTransaction(async ({ repository, auditLog }) => {
        const replay = await findMutationReceipt(repository, normalizedIdempotencyKey, fingerprint)
        if (replay) return replay
        const located = await this.#findCandidate(candidateId, repository, datasetVersionId)
        const updated = await repository.update(located.datasetVersionId, async (record) => {
          assertReviewSnapshot(record, { expectedGraphRevision, expectedCandidateRevision })
          const nextCandidates = structuredClone(record.topologyCandidates ?? [])
          const current = nextCandidates.find(({ candidateId: id }) => id === candidateId)
          if (!current) throw candidateNotFound(candidateId)
          if (action === 'confirm') {
            assertCandidateTopologyEligible(record, current)
          }
          const targetStatus = {
            confirm: 'confirmed',
            reject: 'rejected',
            skip: 'ambiguous',
          }[action]
          const allowed = action === 'confirm'
            ? ['candidate', 'ambiguous', 'revoked']
            : ['candidate', 'ambiguous']
          if (!allowed.includes(current.candidateStatus)) {
            throw invalidTransition(current.candidateStatus, targetStatus)
          }
          const reviewedAt = this.clock().toISOString()
          const event = await auditLog.record(`topology.candidate_${action}ed`, {
            actorId,
            datasetVersionId: located.datasetVersionId,
            branchId: record.datasetVersion.branchId,
            correlationId,
            outcome: targetStatus,
            details: {
              graphRevision: record.topologyGraph?.graphRevision ?? null,
              before: candidateAuditSnapshot(current),
              after: candidateAuditSnapshot(current, targetStatus),
              reason,
              candidateEvidence: current.evidence,
              topologyRuleSetVersion: current.topologyRuleSetVersion,
            },
          })
          const beforeStatus = current.candidateStatus
          current.candidateStatus = targetStatus
          current.proposalStatus = action === 'confirm'
            ? 'confirmed_by_admin'
            : action === 'reject' ? 'rejected_by_admin' : 'skipped_by_admin'
          current.review = reviewRecord({
            actorId,
            reviewedAt,
            reason,
            action,
            auditEventId: event.id,
            before: beforeStatus,
            after: targetStatus,
          })
          const rebuilt = rebuildFromReviewedCandidates(
            record,
            nextCandidates,
            this.config,
            reviewedAt,
            candidateAssetReferences(current),
          )
          if (!normalizedIdempotencyKey) return rebuilt
          const response = candidateReviewResponse({
            ...rebuilt,
            recordRevision: recordRevision(record) + 1,
          }, candidateId)
          return appendTopologyMutationReceipt(rebuilt, {
            key: normalizedIdempotencyKey,
            fingerprint,
            action,
            resourceId: candidateId,
            actorId,
            response,
            createdAt: reviewedAt,
          })
        }, {
          ...(normalizedIdempotencyKey
            ? { expectedRevision: recordRevision(located.record) }
            : {}),
          projectionMode: 'topology-review',
        })
        return candidateReviewResponse(updated, candidateId)
      })
    } catch (error) {
      if (!normalizedIdempotencyKey || error?.code !== 'dataset_version_stale_revision') {
        throw error
      }
      const replay = await findMutationReceipt(this.repository, normalizedIdempotencyKey, fingerprint)
      if (!replay) throw error
      return replay
    }
  }

  async #withMutationTransaction(operation) {
    if (typeof this.repository.withTransaction !== 'function') {
      return operation({
        repository: this.repository,
        auditLog: this.auditLog,
      })
    }
    if (typeof this.auditLog.withExecutor !== 'function') {
      throw new AppError('Audit log transaksional belum dikonfigurasi.', {
        code: 'transactional_audit_unavailable',
        statusCode: 503,
      })
    }
    return this.repository.withTransaction(async ({ client, repository }) => (
      operation({
        repository,
        auditLog: this.auditLog.withExecutor(client),
      })
    ))
  }

  async #withDatasetMutationLock(datasetVersionId, operation) {
    const key = String(datasetVersionId ?? '').trim()
    if (!key || typeof operation !== 'function') return operation()
    if (this.activeMutationDatasetIds.has(key)) {
      throw new AppError(
        'Aksi topology untuk dataset ini masih diproses. Tunggu sampai selesai sebelum mencoba lagi.',
        {
          code: 'topology_mutation_in_progress',
          statusCode: 409,
          details: { datasetVersionId: key },
        },
      )
    }
    this.activeMutationDatasetIds.add(key)
    try {
      return await operation()
    } finally {
      this.activeMutationDatasetIds.delete(key)
    }
  }

  async #findCandidate(candidateId, repository = this.repository, datasetVersionId = null) {
    assertEntityId(candidateId, 'candidate')
    const records = datasetVersionId
      ? [await repository.get(datasetVersionId)]
      : await repository.list()
    const matches = records.flatMap((record) => (
      (record.topologyCandidates ?? [])
        .filter(({ candidateId: id }) => id === candidateId)
        .map((candidate) => ({
          datasetVersionId: record.datasetVersion.id,
          record,
          candidate,
        }))
    ))
    if (!matches.length) throw candidateNotFound(candidateId)
    if (matches.length > 1) {
      throw new AppError('Candidate ID tidak unik antar dataset version.', {
        code: 'topology_candidate_identity_conflict',
        statusCode: 409,
      })
    }
    return matches[0]
  }

  async #findRelation(relationId, repository = this.repository, datasetVersionId = null) {
    assertEntityId(relationId, 'relation')
    const records = datasetVersionId
      ? [await repository.get(datasetVersionId)]
      : await repository.list()
    const matches = records.flatMap((record) => (
      (record.confirmedRelations ?? [])
        .filter(({ relationId: id }) => id === relationId)
        .map((relation) => ({
          datasetVersionId: record.datasetVersion.id,
          record,
          relation,
        }))
    ))
    if (!matches.length) {
      throw new AppError('Topology relation tidak ditemukan.', {
        code: 'topology_relation_not_found',
        statusCode: 404,
      })
    }
    if (matches.length > 1) {
      throw new AppError('Relation ID tidak unik antar dataset version.', {
        code: 'topology_relation_identity_conflict',
        statusCode: 409,
      })
    }
    return matches[0]
  }
}

export function createFullTopologyRegenerationJobHandler(topologyService) {
  if (!topologyService || typeof topologyService.regenerate !== 'function') {
    throw new TypeError('Topology service untuk durable regeneration tidak valid.')
  }
  return async (
    { actorId, reason, correlationId } = {},
    { job, updateProgress } = {},
  ) => {
    const datasetVersionId = String(job?.datasetVersionId ?? '').trim()
    if (!datasetVersionId) {
      throw new Error('Durable regeneration tidak memiliki dataset version ID.')
    }
    await updateProgress?.(10, 'topology_loading')
    const regenerated = await topologyService.regenerate(datasetVersionId, actorId, {
      reason: normalizeTopologyRegenerationReason(reason),
      correlationId,
      jobId: job?.jobId ?? null,
    })
    await updateProgress?.(90, 'topology_persisting')
    return summarizeTopologyRegeneration(regenerated)
  }
}

export function summarizeTopologyRegeneration(record) {
  const runs = record?.topologyRuns ?? []
  return {
    datasetVersionId: record?.datasetVersion?.id ?? null,
    topologyRuleSetVersion: record?.topologyRuleSetVersion ?? null,
    graphRevision: record?.topologyGraph?.graphRevision ?? null,
    topologyRunId: runs.at(-1)?.runId ?? null,
    recordRevision: recordRevision(record),
    summary: structuredClone(record?.topologySummary ?? null),
    readiness: structuredClone(record?.topologyReadiness ?? null),
  }
}

export function normalizeTopologyRegenerationReason(value) {
  const reason = String(value ?? '').trim()
  if (reason.length > 1000 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new AppError('Alasan regenerasi topology tidak valid.', {
      code: 'invalid_topology_regeneration_reason',
      statusCode: 400,
    })
  }
  return reason || null
}

export function applyArtifacts(record, artifacts, {
  candidateHistory = record.topologyCandidateHistory ?? [],
  topologyRun = null,
} = {}) {
  const graph = withTopologyGraphRevision(artifacts.graph)
  const legacyRelations = graph.edges.map((edge) => ({
    id: edge.id,
    datasetVersionId: edge.datasetVersionId,
    sourceAssetId: edge.sourceAssetId,
    targetAssetId: edge.targetAssetId,
    relationType: edge.relationType,
    direction: edge.direction,
    pathAssetId: edge.pathAssetId,
    pathAssetIds: structuredClone(edge.pathAssetIds ?? []),
    sourceGeometryIds: structuredClone(edge.sourceGeometryIds),
    relationSource: edge.relationSource,
    relationKind: edge.relationKind ?? 'device_edge',
    relationStatus: 'confirmed',
    provenance: edge.provenance,
    verificationStatus: 'confirmed',
    candidateId: edge.candidateId,
  }))
  return {
    ...record,
    topologyRuleSetVersion: artifacts.topologyRuleSetVersion,
    topologyGeneratedAt: artifacts.generatedAt,
    topologyCandidates: artifacts.candidates,
    confirmedRelations: artifacts.confirmedRelations,
    topologyGraph: graph,
    topologyValidation: artifacts.validation,
    topologyUnresolved: artifacts.unresolved,
    topologyEligibilityIssues: artifacts.eligibilityIssues,
    topologyLineworkIssues: artifacts.lineworkIssues,
    topologySummary: artifacts.summary,
    topologyReadiness: artifacts.readiness,
    topologyCandidateHistory: candidateHistory,
    topologyRuns: topologyRun
      ? [...(record.topologyRuns ?? []), topologyRun]
      : record.topologyRuns ?? [],
    relations: legacyRelations,
    readiness: {
      ...(record.readiness ?? {}),
      topologyReadiness: artifacts.readiness.topologyReadiness,
      topologyEligibility: {
        ...(record.readiness?.topologyEligibility ?? {}),
        candidateCount: artifacts.summary.candidateCount,
        confirmedEdgeCount: artifacts.summary.confirmedEdgeCount,
        confirmedDeviceEdgeCount: artifacts.summary.confirmedDeviceEdgeCount,
        confirmedRelationCount: artifacts.summary.confirmedRelationCount,
        confirmedPathAttachmentCount: artifacts.summary.confirmedPathAttachmentCount,
        confirmedPathContinuationCount: artifacts.summary.confirmedPathContinuationCount,
        ambiguousCount: artifacts.summary.ambiguousCount,
        unresolvedCount: artifacts.summary.unresolvedCount,
        decisionOwner: 'relation_engine',
      },
    },
    datasetVersion: {
      ...record.datasetVersion,
      summary: {
        ...(record.datasetVersion.summary ?? {}),
        totalRelations: legacyRelations.length,
      },
    },
  }
}

function assertPublishableTopologyArtifacts(artifacts, datasetVersionId) {
  const validationIssues = [
    ...(artifacts?.validation?.issues ?? []),
    ...(artifacts?.eligibilityIssues ?? []),
  ]
  const errorIssues = validationIssues.filter(({ severity }) => severity === 'error')
  const validationErrors = Number(artifacts?.validation?.summary?.errors ?? 0)
  if (!errorIssues.length && validationErrors === 0 && artifacts?.validation?.status !== 'invalid') {
    return
  }
  const error = new AppError(
    'Artifact topology tidak tervalidasi; graph revision aktif dipertahankan.',
    {
      code: 'topology_artifact_validation_failed',
      statusCode: 422,
      details: {
        datasetVersionId,
        validationErrors,
        issueCodes: [...new Set(errorIssues.map(({ issueCode }) => issueCode).filter(Boolean))]
          .slice(0, 50),
        issueCount: errorIssues.length,
      },
    },
  )
  error.retryable = false
  throw error
}

function rebuildFromReviewedCandidates(
  record,
  candidates,
  config,
  generatedAt,
  affectedAssetIds = [],
) {
  const artifacts = rebuildConfirmedRelationArtifacts(record.topologyInputBundle, {
    config,
    candidates,
    previousRelations: record.confirmedRelations,
    previousGraph: record.topologyGraph,
    affectedAssetIds,
    eligibilityIssues: record.topologyEligibilityIssues,
    lineworkIssues: record.topologyLineworkIssues,
    generatedAt,
  })
  return applyArtifacts(record, artifacts)
}

function reconcileCandidateHistory(record, artifacts, { eventId, generatedAt }) {
  const nextIds = new Set(artifacts.candidates.map(({ candidateId }) => candidateId))
  const superseded = (record.topologyCandidates ?? [])
    .filter(({ candidateId }) => !nextIds.has(candidateId))
    .map((candidate) => ({
      ...structuredClone(candidate),
      supersededAt: generatedAt,
      supersededByRunId: eventId,
    }))
  const reopened = (artifacts.reopenedReviewHistory ?? []).map((candidate) => ({
    ...structuredClone(candidate),
    supersededByRunId: eventId,
  }))
  return [...(record.topologyCandidateHistory ?? []), ...superseded, ...reopened]
}

function candidateReviewResponse(record, candidateId) {
  return canonicalizeJsonValue({
    datasetVersionId: record.datasetVersion.id,
    candidate: structuredClone(
      record.topologyCandidates.find(({ candidateId: id }) => id === candidateId),
    ),
    confirmedRelations: structuredClone(record.confirmedRelations ?? []),
    graph: structuredClone(record.topologyGraph),
    summary: structuredClone(record.topologySummary ?? emptySummary()),
    readiness: structuredClone(record.topologyReadiness),
    ...reviewSnapshot(record),
  })
}

function manualRelationResponse(record, auditEventId) {
  const relation = record.confirmedRelations.find((item) => (
    item.provenance === 'manual_admin'
      && item.auditEventId === auditEventId
      && item.verificationStatus === 'confirmed'
  ))
  return canonicalizeJsonValue({
    datasetVersionId: record.datasetVersion.id,
    relation: structuredClone(relation),
    candidate: structuredClone(
      (record.topologyCandidates ?? []).find(({ candidateId }) => (
        candidateId === relation?.candidateId
      )),
    ),
    confirmedRelations: structuredClone(record.confirmedRelations ?? []),
    graph: structuredClone(record.topologyGraph),
    summary: structuredClone(record.topologySummary),
    readiness: structuredClone(record.topologyReadiness),
    auditEventId,
    ...reviewSnapshot(record),
  })
}

function revokedRelationResponse({
  datasetVersionId,
  relation,
  graph,
  readiness,
  summary,
  confirmedRelations,
  candidate,
  graphRevision,
  candidateRevision,
  recordRevision,
}) {
  return canonicalizeJsonValue({
    datasetVersionId,
    relation: structuredClone(relation),
    ...(candidate ? { candidate: structuredClone(candidate) } : {}),
    ...(confirmedRelations ? { confirmedRelations: structuredClone(confirmedRelations) } : {}),
    graph: structuredClone(graph),
    ...(summary ? { summary: structuredClone(summary) } : {}),
    readiness: structuredClone(readiness),
    ...(graphRevision !== undefined ? { graphRevision } : {}),
    ...(candidateRevision !== undefined ? { candidateRevision } : {}),
    ...(recordRevision !== undefined ? { recordRevision } : {}),
  })
}

async function findMutationReceipt(repository, key, fingerprint) {
  if (!key) return null
  if (typeof repository?.findTopologyMutationReceipt === 'function') {
    const receipt = await repository.findTopologyMutationReceipt(key)
    if (!receipt) return null
    assertTopologyMutationFingerprint(receipt, fingerprint)
    return structuredClone(receipt.response)
  }
  if (typeof repository?.list !== 'function') return null
  const records = await repository.list()
  for (const record of records) {
    const receipt = findTopologyMutationReceipt(record, key)
    if (!receipt) continue
    assertTopologyMutationFingerprint(receipt, fingerprint)
    return structuredClone(receipt.response)
  }
  return null
}

function bulkReviewResponse(record, {
  action,
  affectedCount,
  affectedCandidateCount = affectedCount,
  candidateIds = [],
  auditEventId = null,
}) {
  const eligibilityContext = createTopologyCandidateEligibilityContext(
    record.topologyInputBundle,
  )
  const changedCandidateIds = new Set(candidateIds)
  return {
    datasetVersionId: record.datasetVersion.id,
    action,
    affectedCount,
    affectedCandidateCount,
    candidateIds: [...candidateIds],
    auditEventId,
    summary: structuredClone(record.topologySummary ?? emptySummary()),
    graph: structuredClone(record.topologyGraph),
    readiness: structuredClone(record.topologyReadiness),
    confirmedRelations: structuredClone(record.confirmedRelations ?? []),
    updatedCandidates: (record.topologyCandidates ?? [])
      .filter(({ candidateId }) => changedCandidateIds.has(candidateId))
      .map((candidate) => structuredClone(candidate)),
    confirmedRelationCount: (record.confirmedRelations ?? [])
      .filter(({ verificationStatus }) => verificationStatus === 'confirmed').length,
    confirmedDeviceEdgeCount: record.topologyGraph?.edges?.length ?? 0,
    confirmedPathAttachmentCount: record.topologySummary?.confirmedPathAttachmentCount ?? 0,
    confirmedPathContinuationCount: record.topologySummary?.confirmedPathContinuationCount ?? 0,
    remainingRecommendedCount: (record.topologyCandidates ?? [])
      .filter((candidate) => (
        isBulkConfirmableCandidate(candidate)
          && candidateReviewEligibility(record, candidate, eligibilityContext).eligible
      )).length,
    remainingLineLabelCount: (record.topologyCandidates ?? [])
      .filter((candidate) => (
        isLineLabelConfirmableCandidate(candidate)
          && candidateReviewEligibility(record, candidate, eligibilityContext).eligible
      )).length,
    ...reviewSnapshot(record),
  }
}

function annotateTopologyCandidateForReview(record, candidate, eligibilityContext = null) {
  const eligibility = evaluateTopologyCandidateEligibility(
    record.topologyInputBundle,
    candidate,
    eligibilityContext,
  )
  return {
    ...structuredClone(candidate),
    reviewEligibility: {
      identityReady: eligibility.eligible,
      confirmable: eligibility.eligible && isCandidateConfirmable(candidate),
      code: eligibility.code,
      message: eligibility.message,
      recommendedAction: eligibility.eligible
        ? null
        : 'assign_identity_and_regenerate',
    },
  }
}

function candidateReviewEligibility(record, candidate, eligibilityContext = null) {
  return evaluateTopologyCandidateEligibility(
    record.topologyInputBundle,
    candidate,
    eligibilityContext,
  )
}

function candidateReviewEligibilityReason(eligibility) {
  if (eligibility.issues.some(({ code }) => code === 'missing_stable_asset_id')) {
    return 'candidate_stable_asset_id_required'
  }
  if (eligibility.issues.some(({ code }) => code === 'topology_candidate_identity_stale')) {
    return 'candidate_topology_identity_stale'
  }
  if (eligibility.issues.some(({ code }) => code === 'topology_candidate_reference_not_found')) {
    return 'candidate_topology_reference_not_found'
  }
  return 'candidate_topology_object_ineligible'
}

function candidateReviewEligibilityDetails(eligibility) {
  return {
    code: eligibility.code,
    message: eligibility.message,
    issues: structuredClone(eligibility.issues),
    recommendedAction: 'assign_identity_and_regenerate',
  }
}

function buildBulkReviewPreview(record, candidateIds, config = {}) {
  const normalizedCandidateIds = [...candidateIds].map(String).sort()
  const candidates = record.topologyCandidates ?? []
  const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]))
  const eligibilityContext = createTopologyCandidateEligibilityContext(
    record.topologyInputBundle,
  )
  const eligibleCandidateIds = []
  const ineligible = []
  normalizedCandidateIds.forEach((candidateId) => {
    const candidate = byId.get(candidateId)
    if (!candidate) {
      ineligible.push({ candidateId, reason: 'candidate_not_found' })
      return
    }
    if (candidate.candidateStatus !== 'candidate') {
      ineligible.push({
        candidateId,
        reason: 'candidate_status_not_candidate',
        currentStatus: candidate.candidateStatus ?? null,
      })
      return
    }
    if (candidate.proposalStatus !== 'recommended') {
      ineligible.push({
        candidateId,
        reason: 'proposal_not_recommended',
        currentProposalStatus: candidate.proposalStatus ?? null,
      })
      return
    }
    const reviewEligibility = candidateReviewEligibility(record, candidate, eligibilityContext)
    if (!reviewEligibility.eligible) {
      ineligible.push({
        candidateId,
        reason: candidateReviewEligibilityReason(reviewEligibility),
        reviewEligibility: candidateReviewEligibilityDetails(reviewEligibility),
      })
      return
    }
    eligibleCandidateIds.push(candidateId)
  })

  const eligibleSet = new Set(eligibleCandidateIds)
  const conflicts = []
  const selectedByEndpoint = new Map()
  eligibleCandidateIds.forEach((candidateId) => {
    const candidate = byId.get(candidateId)
    const endpoint = candidate.sourceEndpointId
    if (!endpoint) return
    const group = selectedByEndpoint.get(endpoint) ?? []
    group.push(candidateId)
    selectedByEndpoint.set(endpoint, group)
  })
  selectedByEndpoint.forEach((group, sourceEndpointId) => {
    if (group.length < 2) return
    conflicts.push({
      reason: 'endpoint_conflict',
      sourceEndpointId,
      candidateIds: group,
    })
  })

  const confirmedEndpointOwners = new Map()
  candidates
    .filter(({ candidateStatus, candidateId }) => (
      candidateStatus === 'confirmed' && !eligibleSet.has(candidateId)
    ))
    .forEach((candidate) => {
      if (!candidate.sourceEndpointId) return
      confirmedEndpointOwners.set(candidate.sourceEndpointId, candidate.candidateId)
    })
  eligibleCandidateIds.forEach((candidateId) => {
    const candidate = byId.get(candidateId)
    const owner = confirmedEndpointOwners.get(candidate.sourceEndpointId)
    if (!owner) return
    conflicts.push({
      reason: 'endpoint_already_confirmed',
      sourceEndpointId: candidate.sourceEndpointId,
      candidateIds: [candidateId, owner],
    })
  })

  const beforeGraph = normalizedTraceGraphFromCache(
    new Map(),
    new WeakMap(),
    record,
    buildAssetIdentityMapFromRecord(record),
  )
  let simulated = null
  let simulationError = null
  if (eligibleCandidateIds.length > 0 && record.topologyInputBundle) {
    const nextCandidates = structuredClone(candidates)
    nextCandidates.forEach((candidate) => {
      if (!eligibleSet.has(candidate.candidateId)) return
      candidate.candidateStatus = 'confirmed'
      candidate.proposalStatus = 'confirmed_by_admin_bulk_preview'
    })
    try {
      simulated = rebuildFromReviewedCandidates(
        record,
        nextCandidates,
        config,
        record.topologyGeneratedAt ?? new Date().toISOString(),
        eligibleCandidateIds.flatMap((candidateId) => (
          candidateAssetReferences(byId.get(candidateId))
        )),
      )
    } catch (error) {
      simulationError = error
    }
  }

  const simulatedValidation = simulated?.topologyValidation ?? null
  const baselineValidationIssues = record.topologyValidation?.issues ?? []
  const simulatedValidationIssues = classifyReviewValidationIssues(
    baselineValidationIssues,
    simulatedValidation?.issues ?? [],
  )
  const validationIssues = [
    ...simulatedValidationIssues,
    ...conflicts.map((conflict) => ({
      severity: 'error',
      issueCode: conflict.reason,
      entityReference: conflict.candidateIds.join('|'),
      details: conflict,
      reviewImpact: 'introduced',
    })),
  ]
  if (simulationError) {
    validationIssues.push({
      severity: 'error',
      issueCode: 'review_preview_build_failed',
      message: simulationError.message,
      reviewImpact: 'introduced',
    })
  } else if (eligibleCandidateIds.length > 0 && !simulated) {
    validationIssues.push({
      severity: 'error',
      issueCode: 'review_preview_input_unavailable',
      message: 'Topology input bundle belum tersedia untuk dry-run review.',
      reviewImpact: 'introduced',
    })
  }
  const blockingValidationIssues = validationIssues.filter(({ severity, reviewImpact }) => (
    severity === 'error' && reviewImpact !== 'baseline'
  ))
  const baselineErrorCount = validationIssues.filter(({ severity, reviewImpact }) => (
    severity === 'error' && reviewImpact === 'baseline'
  )).length
  const introducedWarningCount = validationIssues.filter(({ severity, reviewImpact }) => (
    severity === 'warning' && reviewImpact !== 'baseline'
  )).length
  const baselineWarningCount = validationIssues.filter(({ severity, reviewImpact }) => (
    severity === 'warning' && reviewImpact === 'baseline'
  )).length
  const validationSummary = {
    errors: blockingValidationIssues.length,
    warnings: validationIssues.filter(({ severity }) => severity === 'warning').length,
    total: validationIssues.length,
    introducedErrors: blockingValidationIssues.length,
    introducedWarnings: introducedWarningCount,
    baselineErrors: baselineErrorCount,
    baselineWarnings: baselineWarningCount,
  }
  const beforeConfirmedRelationCount = (record.confirmedRelations ?? [])
    .filter(({ verificationStatus }) => verificationStatus === 'confirmed').length
  const afterConfirmedRelationCount = (simulated?.confirmedRelations ?? [])
    .filter(({ verificationStatus }) => verificationStatus === 'confirmed').length
  const predictedGraph = simulated?.topologyGraph ?? beforeGraph
  const conflictingCandidateIds = new Set(conflicts.flatMap(({ candidateIds }) => candidateIds))
  const blockingReasonCodes = [...new Set([
    ...ineligible.map(({ reason }) => reason),
    ...blockingValidationIssues.map(({ issueCode }) => issueCode),
  ].filter(Boolean))]
  return {
    datasetVersionId: record.datasetVersion.id,
    candidateIds: normalizedCandidateIds,
    eligibleCandidateIds,
    ineligible,
    predictedSummary: {
      confirmedRelationDelta: afterConfirmedRelationCount - beforeConfirmedRelationCount,
      componentCountBefore: beforeGraph.components?.length ?? 0,
      componentCountAfter: predictedGraph.components?.length ?? 0,
      confirmedRelationCountBefore: beforeConfirmedRelationCount,
      confirmedRelationCountAfter: afterConfirmedRelationCount,
    },
    validationPreview: {
      status: validationSummary.errors > 0
        ? 'invalid'
        : baselineErrorCount > 0
          ? 'valid_with_baseline_issues'
          : validationSummary.warnings > 0 ? 'valid_with_warnings' : 'valid',
      summary: validationSummary,
      issues: validationIssues,
    },
    safeToApply: normalizedCandidateIds.length > 0
      && ineligible.length === 0
      && conflicts.length === 0
      && !simulationError
      && Boolean(simulated)
      && validationSummary.errors === 0,
    diagnostics: {
      blockingReasonCodes,
      conflictCount: conflicts.length,
      conflicts,
      blockedCandidateIds: [...new Set([
        ...ineligible.map(({ candidateId }) => candidateId),
        ...conflictingCandidateIds,
      ].filter(Boolean))].sort(),
      baselineIssuesPreserved: baselineErrorCount + baselineWarningCount,
      recommendation: reviewPreviewRecommendation({
        ineligible,
        conflicts,
        blockingValidationIssues,
      }),
    },
    graphRevision: beforeGraph.graphRevision,
    candidateRevision: createCandidateCollectionRevision(candidates),
    recordRevision: recordRevision(record),
  }
}

export function classifyReviewValidationIssues(baselineIssues = [], simulatedIssues = []) {
  const baselineIds = new Set(baselineIssues.map(reviewValidationIssueIdentity))
  return simulatedIssues.map((issue) => ({
    ...issue,
    reviewImpact: baselineIds.has(reviewValidationIssueIdentity(issue))
      ? 'baseline'
      : 'introduced',
  }))
}

function reviewValidationIssueIdentity(issue) {
  return issue?.issueId
    ?? [issue?.issueCode, issue?.scope, issue?.entityReference, issue?.severity]
      .map((value) => String(value ?? ''))
      .join('|')
}

function reviewPreviewRecommendation({
  ineligible,
  conflicts,
  blockingValidationIssues,
}) {
  if (ineligible.length > 0) {
    const identityBlocked = ineligible.some(({ reason }) => (
      ['candidate_stable_asset_id_required', 'candidate_topology_identity_stale']
        .includes(reason)
    ))
    if (identityBlocked) {
      return {
        code: 'assign_identity_and_regenerate',
        message: 'Sistem sudah mencoba membuat Asset ID internal. Tinjau identity ambigu atau duplikat; isi Asset ID resmi hanya bila aset wajib mengikuti nomor perusahaan.',
      }
    }
    return {
      code: 'refresh_review_queue',
      message: 'Muat ulang antrean karena sebagian kandidat sudah berubah atau tidak eligible.',
    }
  }
  if (conflicts.length > 0) {
    return {
      code: 'resolve_endpoint_conflicts',
      message: 'Pilih tepat satu kandidat untuk setiap endpoint yang konflik.',
    }
  }
  const issueCodes = new Set(blockingValidationIssues.map(({ issueCode }) => issueCode))
  if (issueCodes.has('review_preview_input_unavailable')) {
    return {
      code: 'regenerate_topology',
      message: 'Regenerate topology untuk membangun input dry-run sebelum bulk review.',
    }
  }
  if (issueCodes.has('review_preview_build_failed')) {
    return {
      code: 'inspect_preview_build_failure',
      message: 'Periksa kegagalan rebuild preview sebelum menyimpan relasi.',
    }
  }
  if (blockingValidationIssues.length > 0) {
    return {
      code: 'review_introduced_validation_errors',
      message: 'Batch memperkenalkan validation error baru dan perlu dipecah atau diperiksa manual.',
    }
  }
  return {
    code: 'ready_to_apply',
    message: 'Batch tidak memperkenalkan konflik atau validation error baru.',
  }
}

function candidateAssetReferences(candidate) {
  return [
    candidate?.sourcePathAssetId,
    candidate?.targetAssetId,
    candidate?.targetPathAssetId,
    ...(candidate?.pathAssetIds ?? []),
    ...(candidate?.sourceGeometryIds ?? []),
  ].filter(Boolean)
}

function reviewSnapshot(record) {
  const graph = normalizedTraceGraphFromCache(
    new Map(),
    new WeakMap(),
    record,
    buildAssetIdentityMapFromRecord(record),
  )
  return {
    graphRevision: graph.graphRevision,
    candidateRevision: createCandidateCollectionRevision(record.topologyCandidates ?? []),
    recordRevision: recordRevision(record),
  }
}

function recordRevision(record) {
  const revision = Number(record?.recordRevision)
  return Number.isInteger(revision) && revision >= 0 ? revision : 0
}

function assertReviewSnapshot(record, {
  expectedGraphRevision,
  expectedCandidateRevision,
} = {}) {
  const current = reviewSnapshot(record)
  const graphMatches = expectedGraphRevision === undefined
    || expectedGraphRevision === current.graphRevision
  const candidateMatches = expectedCandidateRevision === undefined
    || expectedCandidateRevision === current.candidateRevision
  if (graphMatches && candidateMatches) return
  throw new AppError('State topology berubah sejak review dimuat.', {
    code: 'stale_topology_review',
    statusCode: 409,
    details: {
      expectedGraphRevision: expectedGraphRevision ?? null,
      currentGraphRevision: current.graphRevision,
      expectedCandidateRevision: expectedCandidateRevision ?? null,
      currentCandidateRevision: current.candidateRevision,
      currentRecordRevision: current.recordRevision,
    },
  })
}

function isBulkConfirmableCandidate(candidate) {
  return candidate.candidateStatus === 'candidate'
    && candidate.proposalStatus === 'recommended'
}

function isCandidateConfirmable(candidate) {
  return ['candidate', 'ambiguous', 'revoked'].includes(candidate.candidateStatus)
}

function isLineLabelConfirmableCandidate(candidate) {
  return isBulkConfirmableCandidate(candidate)
    && ['line_label_connection', 'line_label_attachment'].includes(candidate.candidateType)
}

function candidateAuditSnapshot(candidate, status = candidate.candidateStatus) {
  return {
    candidateId: candidate.candidateId,
    candidateStatus: status,
    sourceEndpointId: candidate.sourceEndpointId,
    sourcePathAssetId: candidate.sourcePathAssetId,
    targetAssetId: candidate.targetAssetId,
    targetEndpointId: candidate.targetEndpointId,
    score: candidate.score,
    scoreMargin: candidate.scoreMargin,
  }
}

function reviewRecord({
  actorId,
  reviewedAt,
  reason,
  action,
  auditEventId,
  before,
  after,
}) {
  return {
    actorId,
    reviewedAt,
    reason,
    action,
    auditEventId,
    before,
    after,
  }
}

function assertTopologyBundle(record) {
  if (!record.topologyInputBundle) {
    throw new AppError('TopologyInputBundle belum tersedia untuk dataset version.', {
      code: 'topology_input_bundle_missing',
      statusCode: 409,
    })
  }
}

function assertCurrentCandidateState(candidate, expectedStatus) {
  if (!candidate) throw candidateNotFound()
  if (candidate.candidateStatus !== expectedStatus) {
    throw new AppError('Candidate berubah sejak review dimuat.', {
      code: 'stale_topology_review',
      statusCode: 409,
      details: {
        expectedStatus,
        currentStatus: candidate.candidateStatus,
      },
    })
  }
}

function assertCandidateTopologyEligible(record, candidate) {
  const eligibility = candidateReviewEligibility(record, candidate)
  if (eligibility.eligible) return
  const reason = candidateReviewEligibilityReason(eligibility)
  const identityBlocked = [
    'candidate_stable_asset_id_required',
    'candidate_topology_identity_stale',
  ].includes(reason)
  throw new AppError(
    identityBlocked
      ? 'Kandidat tidak dapat dikonfirmasi karena identity aset belum stabil atau ambigu. Tinjau identity; isi Asset ID resmi hanya jika diperlukan, lalu regenerasi topology.'
      : 'Kandidat tidak lagi eligible terhadap topology input terkini; muat ulang dan regenerate topology.',
    {
      code: identityBlocked
        ? 'topology_candidate_identity_required'
        : 'topology_candidate_not_eligible',
      statusCode: 422,
      details: {
        candidateId: candidate.candidateId,
        reason,
        reviewEligibility: candidateReviewEligibilityDetails(eligibility),
      },
    },
  )
}

function normalizeReason(value, required) {
  const reason = String(value ?? '').trim()
  if (required && reason.length < 3) {
    throw new AppError('Alasan review minimal tiga karakter.', {
      code: 'topology_review_reason_required',
      statusCode: 400,
    })
  }
  if (reason.length > 1000 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new AppError('Alasan review tidak valid.', {
      code: 'invalid_topology_review_reason',
      statusCode: 400,
    })
  }
  return reason || null
}

function normalizeCandidateIds(value) {
  if (!Array.isArray(value) || value.length === 0
    || value.length > MAX_SELECTED_CANDIDATE_IDS) {
    throw new AppError('Pilih minimal satu koneksi dan jangan melebihi batas pilihan.', {
      code: 'invalid_topology_candidate_ids',
      statusCode: 400,
      details: { max: MAX_SELECTED_CANDIDATE_IDS },
    })
  }
  const ids = [...new Set(value.map((candidateId) => String(candidateId)))]
  ids.forEach((candidateId) => assertEntityId(candidateId, 'candidate'))
  return ids.sort()
}

function normalizeTopologyAssetReference(value, field) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > 256
    || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AppError(`Field ${field} untuk koneksi manual tidak valid.`, {
      code: `invalid_topology_manual_${field}`,
      statusCode: 400,
      details: { field },
    })
  }
  return normalized
}

function normalizeManualRelationType(value) {
  const normalized = String(value ?? 'connected-to').trim().toLowerCase()
  if (normalized !== 'connected-to') {
    throw new AppError('Jenis koneksi manual tidak didukung.', {
      code: 'invalid_topology_manual_relation_type',
      statusCode: 400,
      details: { supportedRelationTypes: ['connected-to'] },
    })
  }
  return normalized
}

function normalizeManualRelationKind(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (!['device_edge', 'service_link'].includes(normalized)) {
    throw new AppError('Kind koneksi manual tidak didukung.', {
      code: 'invalid_topology_manual_relation_kind',
      statusCode: 400,
      details: { supportedRelationKinds: ['device_edge', 'service_link'] },
    })
  }
  return normalized
}

function normalizeManualReferenceList(value, field) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_MANUAL_REFERENCE_IDS) {
    throw new AppError(`Daftar ${field} untuk koneksi manual tidak valid.`, {
      code: `invalid_topology_manual_${field}`,
      statusCode: 400,
      details: { field, max: MAX_MANUAL_REFERENCE_IDS },
    })
  }
  return uniqueValues(value.map((item) => {
    const normalized = String(item ?? '').trim()
    if (!normalized || normalized.length > 256
      || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new AppError(`Referensi ${field} untuk koneksi manual tidak valid.`, {
        code: `invalid_topology_manual_${field}`,
        statusCode: 400,
        details: { field },
      })
    }
    return normalized
  }))
}

function normalizeManualDirection(value) {
  const normalized = String(value ?? 'undirected').trim().toLowerCase()
  if (!['undirected', 'source_to_target', 'target_to_source', 'bidirectional']
    .includes(normalized)) {
    throw new AppError('Arah koneksi manual tidak didukung.', {
      code: 'invalid_topology_manual_direction',
      statusCode: 400,
      details: {
        supportedDirections: [
          'undirected',
          'source_to_target',
          'target_to_source',
          'bidirectional',
        ],
      },
    })
  }
  return normalized
}

function resolveManualDevice(record, reference, field) {
  const identityMap = buildAssetIdentityMapFromRecord(record)
  const resolver = createAssetIdentityResolver(identityMap)
  const objects = manualTopologyObjects(record, identityMap, resolver)
  const canonicalReference = resolver.resolve(reference)
  const match = objects.find((item) => (
    item.canonicalAssetId === canonicalReference
      || item.topologyAssetId === reference
      || item.aliases.includes(reference)
  ))
  if (!match) {
    throw new AppError(`Device untuk ${field} tidak ditemukan pada topology dataset.`, {
      code: 'topology_manual_relation_asset_not_found',
      statusCode: 404,
      details: { field, assetId: reference },
    })
  }
  if (match.object.objectRole !== 'device_node') {
    throw new AppError('Koneksi manual hanya dapat dibuat antar device, bukan kabel atau path.', {
      code: 'topology_manual_relation_device_required',
      statusCode: 400,
      details: { field, assetId: reference, objectRole: match.object.objectRole },
    })
  }
  const identityStatus = String(
    match.object.identityStatus ?? match.object.identityResolutionStatus ?? '',
  ).trim().toLowerCase()
  if ((!match.object.stableAssetId && !match.object.assetId)
    || ['onboarding', 'onboarding_candidate', 'conflict'].includes(identityStatus)) {
    throw new AppError('Koneksi manual membutuhkan device dengan stable Asset ID.', {
      code: 'topology_manual_relation_stable_asset_required',
      statusCode: 409,
      details: { field, assetId: reference },
    })
  }
  return match
}

function assertManualEvidenceReferences(record, {
  source,
  target,
  pathAssetIds = [],
  sourceGeometryIds = [],
}) {
  const identityMap = buildAssetIdentityMapFromRecord(record)
  const resolver = createAssetIdentityResolver(identityMap)
  const objects = manualTopologyObjects(record, identityMap, resolver)
  const sameSite = source.object.siteId
  const resolveObject = (reference) => {
    const canonicalReference = resolver.resolve(reference)
    return objects.find((item) => (
      item.canonicalAssetId === canonicalReference
        || item.topologyAssetId === reference
        || item.aliases.includes(reference)
    ))
  }

  pathAssetIds.forEach((reference) => {
    const match = resolveObject(reference)
    if (!match || match.object.objectRole !== 'cable_path') {
      throw new AppError('Path evidence untuk koneksi manual tidak ditemukan.', {
        code: 'topology_manual_relation_path_not_found',
        statusCode: 404,
        details: { pathAssetId: reference },
      })
    }
    if (match.object.siteId !== sameSite || match.object.siteId !== target.object.siteId) {
      throw new AppError('Path evidence koneksi manual harus berada pada site yang sama.', {
        code: 'topology_manual_relation_path_cross_site',
        statusCode: 400,
        details: { pathAssetId: reference, siteId: match.object.siteId },
      })
    }
  })

  const geometryById = new Map(
    (record.topologyInputBundle?.geometries ?? []).map((geometry) => [
      geometry.geometryId,
      geometry,
    ]),
  )
  sourceGeometryIds.forEach((reference) => {
    const geometry = geometryById.get(reference)
    const owner = geometry
      ? objects.find(({ object }) => object.sourceFeatureId === geometry.sourceFeatureId)
      : null
    if (!geometry || !owner) {
      throw new AppError('Geometry evidence untuk koneksi manual tidak ditemukan.', {
        code: 'topology_manual_relation_geometry_not_found',
        statusCode: 404,
        details: { sourceGeometryId: reference },
      })
    }
    if (geometry.datasetVersionId !== record.datasetVersion.id
      || owner.object.siteId !== sameSite
      || owner.object.siteId !== target.object.siteId) {
      throw new AppError('Geometry evidence koneksi manual harus berada pada version/site yang sama.', {
        code: 'topology_manual_relation_geometry_scope_invalid',
        statusCode: 400,
        details: {
          sourceGeometryId: reference,
          datasetVersionId: geometry.datasetVersionId,
          siteId: owner.object.siteId,
        },
      })
    }
  })
}

function manualTopologyObjects(record, identityMap, resolver) {
  const objects = [
    ...(record.topologyInputBundle?.classifiedNodes ?? []),
    ...(record.topologyInputBundle?.classifiedPaths ?? []),
  ]
  return objects.map((object) => {
    const topologyAssetId = objectIdentityForManualRelation(object)
    const identityItem = (identityMap.items ?? []).find((item) => (
      item.canonicalAssetId === resolver.resolve(topologyAssetId)
        || (item.aliasValues ?? []).includes(topologyAssetId)
        || item.sourceFeatureId === object.sourceFeatureId
    ))
    const canonicalAssetId = resolver.resolve(topologyAssetId)
      ?? identityItem?.canonicalAssetId
      ?? topologyAssetId
    return {
      object,
      topologyAssetId,
      canonicalAssetId,
      aliases: uniqueValues([
        topologyAssetId,
        object.canonicalAssetId,
        object.assetId,
        object.stableAssetId,
        object.legacyAssetId,
        object.onboardingIdentity,
        object.sourceFeatureId,
        ...Object.values(object.identityAliases ?? {}).flat(),
        ...(identityItem?.aliasValues ?? []),
      ]),
    }
  }).filter(({ topologyAssetId }) => Boolean(topologyAssetId))
}

function objectIdentityForManualRelation(object) {
  return String(
    object?.canonicalAssetId
      ?? object?.assetId
      ?? object?.onboardingIdentity
      ?? '',
  ).trim()
}

function assertDistinctManualDevices(source, target) {
  if (source.canonicalAssetId !== target.canonicalAssetId
    && source.topologyAssetId !== target.topologyAssetId) return
  throw new AppError('Source dan target device harus berbeda.', {
    code: 'topology_manual_relation_self_loop',
    statusCode: 400,
  })
}

function assertSameManualDeviceSite(source, target) {
  if (source.object.siteId === target.object.siteId) return
  throw new AppError('Koneksi manual lintas site tidak diizinkan.', {
    code: 'topology_manual_relation_cross_site',
    statusCode: 400,
    details: {
      sourceSiteId: source.object.siteId,
      targetSiteId: target.object.siteId,
    },
  })
}

function assertNoConfirmedManualDevicePair(record, source, target) {
  const identityMap = buildAssetIdentityMapFromRecord(record)
  const graph = normalizedTraceGraphFromCache(
    new Map(),
    new WeakMap(),
    record,
    identityMap,
  )
  const hasGraphPair = graph.edges.some((edge) => sameUndirectedPair(
    edge.sourceAssetId,
    edge.targetAssetId,
    source.canonicalAssetId,
    target.canonicalAssetId,
  ))
  const resolver = createAssetIdentityResolver(identityMap)
  const hasRelationPair = (record.confirmedRelations ?? [])
    .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
    .some((relation) => sameUndirectedPair(
      resolver.resolve(relation.sourceAssetId) ?? relation.sourceAssetId,
      resolver.resolve(relation.targetAssetId) ?? relation.targetAssetId,
      source.canonicalAssetId,
      target.canonicalAssetId,
    ))
  const hasManualEvidencePair = (record.topologyInputBundle?.explicitRelations ?? [])
    .filter(({ source }) => source === 'manual_admin')
    .some((relation) => {
      const relationSource = resolver.resolve(relation.sourceReference) ?? relation.sourceReference
      const relationTarget = resolver.resolve(relation.targetReference) ?? relation.targetReference
      return sameUndirectedPair(
        relationSource,
        relationTarget,
        source.canonicalAssetId,
        target.canonicalAssetId,
      )
    })
  if (!hasGraphPair && !hasRelationPair && !hasManualEvidencePair) return
  throw new AppError('Koneksi antar device tersebut sudah terkonfirmasi.', {
    code: 'topology_manual_relation_exists',
    statusCode: 409,
    details: {
      sourceAssetId: source.canonicalAssetId,
      targetAssetId: target.canonicalAssetId,
    },
  })
}

function sameUndirectedPair(leftSource, leftTarget, rightSource, rightTarget) {
  return (leftSource === rightSource && leftTarget === rightTarget)
    || (leftSource === rightTarget && leftTarget === rightSource)
}

function assertEntityId(value, kind) {
  if (!new RegExp(`^${kind}:[a-f0-9]{24}$`).test(String(value))) {
    throw new AppError(`Identifier ${kind} tidak valid.`, {
      code: `invalid_topology_${kind}_id`,
      statusCode: 400,
    })
  }
}

function candidateNotFound(candidateId) {
  return new AppError('Topology candidate tidak ditemukan.', {
    code: 'topology_candidate_not_found',
    statusCode: 404,
    details: candidateId ? { candidateId } : undefined,
  })
}

function invalidTransition(before, after) {
  return new AppError(`Transisi topology ${before} → ${after} tidak diizinkan.`, {
    code: 'invalid_topology_state_transition',
    statusCode: 409,
    details: { before, after },
  })
}

function emptySummary() {
  return {
    candidateCount: 0,
    confirmedEdgeCount: 0,
    confirmedDeviceEdgeCount: 0,
    confirmedRelationCount: 0,
    confirmedPathAttachmentCount: 0,
    confirmedPathContinuationCount: 0,
    ambiguousCount: 0,
    rejectedCount: 0,
    revokedCount: 0,
    unresolvedCount: 0,
    componentCount: 0,
    isolatedNodeCount: 0,
    falseComponentMergeCount: 0,
  }
}

function normalizeTraceRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new AppError('Request tracing tidak valid.', {
      code: 'invalid_topology_trace_request',
      statusCode: 400,
    })
  }
  const sourceAssetId = normalizeTraceId(request.sourceAssetId, 'sourceAssetId', true)
  const targetAssetId = request.targetAssetId === undefined || request.targetAssetId === null
    ? null
    : normalizeTraceId(request.targetAssetId, 'targetAssetId', false)
  const graphRevision = normalizeTraceId(request.graphRevision, 'graphRevision', true)
  const scopeAssetIds = request.scopeAssetIds === undefined || request.scopeAssetIds === null
    ? null
    : normalizeTraceScope(request.scopeAssetIds)
  const requestedMode = request.mode === undefined || request.mode === null
    ? null
    : String(request.mode).trim().toLowerCase()
  const mode = requestedMode ?? (targetAssetId === null ? 'reachable' : 'point_to_point')
  if (!['connectivity', 'point_to_point', 'upstream', 'downstream', 'reachable'].includes(mode)) {
    throw new AppError('Mode tracing tidak valid.', {
      code: 'invalid_topology_trace_mode',
      statusCode: 400,
      details: {
        mode,
        supportedModes: ['connectivity', 'point_to_point', 'upstream', 'downstream', 'reachable'],
      },
    })
  }
  const requestedDirection = request.direction === undefined || request.direction === null
    ? null
    : String(request.direction).trim().toLowerCase()
  let direction = requestedDirection ?? (
    mode === 'upstream' ? 'upstream' : mode === 'downstream' ? 'downstream' : 'both'
  )
  if (!['upstream', 'downstream', 'both'].includes(direction)) {
    throw new AppError('Direction tracing tidak valid.', {
      code: 'unsupported_topology_trace_direction',
      statusCode: 400,
      details: {
        direction,
        supportedDirections: ['upstream', 'downstream', 'both'],
      },
    })
  }
  if (mode === 'connectivity' && direction !== 'both') {
    throw new AppError('Mode connectivity hanya mendukung direction both.', {
      code: 'unsupported_topology_trace_direction',
      statusCode: 400,
      details: { mode, direction, supportedDirections: ['both'] },
    })
  }
  if (['upstream', 'downstream'].includes(mode) && direction === 'both') {
    direction = mode
  }
  if (['upstream', 'downstream'].includes(mode) && direction !== mode) {
    throw new AppError(`Mode ${mode} harus memakai direction ${mode}.`, {
      code: 'unsupported_topology_trace_direction',
      statusCode: 400,
      details: { mode, direction, supportedDirections: [mode] },
    })
  }
  if (mode === 'point_to_point' && targetAssetId === null) {
    throw new AppError('Target asset wajib untuk mode point_to_point.', {
      code: 'invalid_topology_trace_targetAssetId',
      statusCode: 400,
      details: { field: 'targetAssetId', mode },
    })
  }
  const maxDepth = normalizeTraceMaxDepth(request.maxDepth)
  return {
    sourceAssetId,
    targetAssetId: mode === 'point_to_point' ? targetAssetId : null,
    mode,
    direction,
    graphRevision,
    scopeAssetIds,
    maxDepth,
  }
}

function normalizeImpactRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new AppError('Request impact analysis tidak valid.', {
      code: 'invalid_topology_impact_request',
      statusCode: 400,
    })
  }
  const failureType = String(request.failureType ?? '').trim().toLowerCase()
  if (!['asset', 'relation', 'path'].includes(failureType)) {
    throw new AppError('Failure type impact tidak valid.', {
      code: 'invalid_topology_impact_failure_type',
      statusCode: 400,
      details: { failureType, supportedFailureTypes: ['asset', 'relation', 'path'] },
    })
  }
  const failureId = normalizeTraceId(request.failureId, 'failureId', true)
  const graphRevision = normalizeTraceId(request.graphRevision, 'graphRevision', true)
  const rootAssetIds = request.rootAssetIds === undefined || request.rootAssetIds === null
    ? null
    : normalizeTraceScope(request.rootAssetIds)
  const scopeAssetIds = request.scopeAssetIds === undefined || request.scopeAssetIds === null
    ? null
    : normalizeTraceScope(request.scopeAssetIds)
  const networkFamily = request.networkFamily === undefined || request.networkFamily === null
    ? null
    : normalizeTraceId(request.networkFamily, 'networkFamily', false)
  return {
    failureType,
    failureId,
    graphRevision,
    rootAssetIds,
    networkFamily,
    scopeAssetIds,
  }
}

function normalizeTraceMaxDepth(value) {
  if (value === undefined || value === null || value === '') return 100
  const maxDepth = Number(value)
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 10000) {
    throw new AppError('maxDepth tracing harus integer 1 sampai 10000.', {
      code: 'invalid_topology_trace_max_depth',
      statusCode: 400,
      details: { maxDepth: value, minimum: 1, maximum: 10000 },
    })
  }
  return maxDepth
}

function normalizeTraceScope(value) {
  if (!Array.isArray(value) || value.length > 10000) {
    throw new AppError('Scope asset tracing tidak valid.', {
      code: 'invalid_topology_trace_scope',
      statusCode: 400,
    })
  }
  return value.map((item) => normalizeTraceId(item, 'scopeAssetId', true))
}

function normalizeTraceId(value, field, required) {
  const normalized = String(value ?? '').trim()
  if ((!normalized && required) || normalized.length > 256
    || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AppError(`Field ${field} untuk tracing tidak valid.`, {
      code: `invalid_topology_trace_${field}`,
      statusCode: 400,
      details: { field },
    })
  }
  return normalized || null
}

function normalizedTraceGraphFromCache(cache, objectCache, record, identityMap) {
  const sourceGraph = record.topologyGraph
  const datasetVersionId = record.datasetVersion?.id ?? 'unknown'
  const sourceRevision = sourceGraph?.graphRevision ?? null
  const cacheKey = sourceRevision ? `${datasetVersionId}:${sourceRevision}` : null
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)
  const objectCached = sourceGraph && typeof sourceGraph === 'object'
    ? objectCache.get(sourceGraph)
    : null
  if (objectCached && objectCached.sourceRevision === sourceRevision) {
    return objectCached.graph
  }
  const graph = normalizeTraceGraph(record, identityMap)
  if (cacheKey) {
    cache.set(cacheKey, graph)
    while (cache.size > 64) cache.delete(cache.keys().next().value)
  }
  if (sourceGraph && typeof sourceGraph === 'object') {
    objectCache.set(sourceGraph, { sourceRevision, graph })
  }
  return graph
}

function normalizeTraceGraph(record, identityMap) {
  const resolver = createAssetIdentityResolver(identityMap)
  const sourceGraph = record.topologyGraph ?? {
    datasetVersionId: record.datasetVersion?.id,
    nodes: (record.assets ?? []).map((asset) => ({
      id: asset.canonicalAssetId ?? asset.assetId ?? asset.id,
      assetId: asset.canonicalAssetId ?? asset.assetId ?? asset.id,
    })),
    edges: (record.confirmedRelations ?? []).map((relation) => ({
      ...relation,
      id: relation.id ?? relation.relationId,
      sourceNodeId: relation.sourceAssetId,
      targetNodeId: relation.targetAssetId,
    })),
    components: [],
    degreeByNode: {},
    isolatedNodeIds: [],
  }
  const originalToCanonical = new Map()
  const nodes = (sourceGraph.nodes ?? []).flatMap((node) => {
    const originalId = node.canonicalAssetId ?? node.assetId ?? node.id
    const canonicalAssetId = resolver.resolve(originalId) ?? originalId
    if (!canonicalAssetId) return []
    if (originalToCanonical.has(originalId)
      && originalToCanonical.get(originalId) !== canonicalAssetId) return []
    originalToCanonical.set(originalId, canonicalAssetId)
    return [{
      ...structuredClone(node),
      id: canonicalAssetId,
      assetId: canonicalAssetId,
      canonicalAssetId,
      sourceNodeId: originalId,
    }]
  })
  const nodeIds = new Set(nodes.map(({ id }) => id))
  const resolveNodeId = (value) => resolver.resolve(value)
    ?? originalToCanonical.get(value)
    ?? (nodeIds.has(value) ? value : null)
  const edges = (sourceGraph.edges ?? []).flatMap((edge) => {
    if (!isConfirmedGraphEdge(edge)) return []
    const originalSource = edge.sourceAssetId ?? edge.sourceNodeId
    const originalTarget = edge.targetAssetId ?? edge.targetNodeId
    const sourceAssetId = resolveNodeId(originalSource)
    const targetAssetId = resolveNodeId(originalTarget)
    if (!sourceAssetId || !targetAssetId || sourceAssetId === targetAssetId
      || !nodeIds.has(sourceAssetId) || !nodeIds.has(targetAssetId)) return []
    return [{
      ...structuredClone(edge),
      sourceAssetId,
      targetAssetId,
      sourceNodeId: sourceAssetId,
      targetNodeId: targetAssetId,
      canonicalSourceAssetId: sourceAssetId,
      canonicalTargetAssetId: targetAssetId,
    }]
  })
  const degreeByNode = Object.fromEntries([...nodeIds].map((id) => [id, 0]))
  edges.forEach((edge) => {
    degreeByNode[edge.sourceAssetId] += 1
    degreeByNode[edge.targetAssetId] += 1
  })
  const components = normalizeTraceComponents(
    sourceGraph.components,
    resolveNodeId,
    nodeIds,
    edges,
  )
  return withTopologyGraphRevision({
    ...structuredClone(sourceGraph),
    datasetVersionId: record.datasetVersion?.id ?? sourceGraph.datasetVersionId,
    nodes,
    edges,
    components,
    degreeByNode,
    isolatedNodeIds: [...nodeIds].filter((id) => degreeByNode[id] === 0).sort(),
  })
}

function normalizeTraceComponents(sourceComponents, resolveNodeId, nodeIds, edges) {
  const edgeIds = new Set(edges.map(({ id }) => id).filter(Boolean))
  const components = (sourceComponents ?? []).map((component, index) => ({
    ...structuredClone(component),
    componentId: component.componentId ?? component.id ?? `component:${index + 1}`,
    nodeIds: [...new Set((component.nodeIds ?? [])
      .map(resolveNodeId)
      .filter((id) => nodeIds.has(id)))].sort(),
    edgeIds: (component.edgeIds ?? [])
      .filter((edgeId) => edgeIds.has(edgeId))
      .sort(),
  })).filter(({ nodeIds: componentNodeIds }) => componentNodeIds.length)
  return components.length ? components : traceConnectedComponents(nodeIds, edges)
}

function traceConnectedComponents(nodeIds, edges) {
  const adjacency = new Map([...nodeIds].map((id) => [id, []]))
  edges.forEach((edge) => {
    adjacency.get(edge.sourceAssetId)?.push(edge.targetAssetId)
    adjacency.get(edge.targetAssetId)?.push(edge.sourceAssetId)
  })
  const visited = new Set()
  const components = []
  for (const start of [...nodeIds].sort()) {
    if (visited.has(start)) continue
    const queue = [start]
    const componentNodeIds = []
    const componentNodeSet = new Set()
    while (queue.length) {
      const current = queue.shift()
      if (visited.has(current)) continue
      visited.add(current)
      componentNodeSet.add(current)
      componentNodeIds.push(current)
      ;(adjacency.get(current) ?? []).sort().forEach((next) => {
        if (!visited.has(next)) queue.push(next)
      })
    }
    components.push({
      componentId: `component:${components.length + 1}`,
      nodeIds: componentNodeIds.sort(),
      edgeIds: edges.filter((edge) => (
        componentNodeSet.has(edge.sourceAssetId)
          && componentNodeSet.has(edge.targetAssetId)
      )).map(({ id }) => id).filter(Boolean).sort(),
    })
  }
  return components
}

function isConfirmedGraphEdge(edge) {
  if (edge.verificationStatus !== undefined) {
    return edge.verificationStatus === 'confirmed'
  }
  if (edge.candidateStatus !== undefined) return edge.candidateStatus === 'confirmed'
  if (edge.relationStatus !== undefined) return edge.relationStatus === 'confirmed'
  return true
}

function resolveTraceAssetId(resolver, graph, value) {
  return resolver.resolve(value)
    ?? (graph.nodes.some(({ id }) => id === value) ? value : null)
}

function restrictTraceGraph(graph, nodeIds) {
  const nodes = graph.nodes.filter(({ id }) => nodeIds.has(id))
  const edges = graph.edges.filter((edge) => (
    nodeIds.has(edge.sourceAssetId) && nodeIds.has(edge.targetAssetId)
  ))
  const degreeByNode = Object.fromEntries(nodes.map(({ id }) => [id, 0]))
  edges.forEach((edge) => {
    degreeByNode[edge.sourceAssetId] += 1
    degreeByNode[edge.targetAssetId] += 1
  })
  const scopedNodeIds = new Set(nodes.map(({ id }) => id))
  return {
    ...graph,
    nodes,
    edges,
    components: normalizeTraceComponents(
      graph.components,
      (id) => id,
      scopedNodeIds,
      edges,
    ),
    degreeByNode,
    isolatedNodeIds: nodes
      .filter(({ id }) => degreeByNode[id] === 0)
      .map(({ id }) => id)
      .sort(),
  }
}

function buildTraceTraversal(graph, normalized) {
  return {
    adjacency: buildTraceAdjacency(graph, normalized),
    directionCoverage: directionCoverageForGraph(graph),
  }
}

function buildTraceAdjacency(graph, {
  mode = 'connectivity',
  direction = 'both',
} = {}) {
  const adjacency = new Map(graph.nodes.map(({ id }) => [id, []]))
  const usePhysical = mode === 'connectivity' || direction === 'both'
  const add = (source, target, edge) => {
    if (!adjacency.has(source) || !adjacency.has(target)) return
    adjacency.get(source).push({ target, edge })
  }
  graph.edges.forEach((edge) => {
    const source = edge.sourceAssetId
    const target = edge.targetAssetId
    if (!adjacency.has(source) || !adjacency.has(target)) return
    if (usePhysical) {
      add(source, target, edge)
      add(target, source, edge)
      return
    }
    const serviceDirection = normalizeRelationDirection(edge.direction)
    const serviceForward = serviceDirection === 'source_to_target'
      || serviceDirection === 'bidirectional'
    const serviceReverse = serviceDirection === 'target_to_source'
      || serviceDirection === 'bidirectional'
    if (direction === 'downstream') {
      if (serviceForward) add(source, target, edge)
      if (serviceReverse) add(target, source, edge)
    } else if (direction === 'upstream') {
      if (serviceForward) add(target, source, edge)
      if (serviceReverse) add(source, target, edge)
    }
  })
  adjacency.forEach((relations) => relations.sort((left, right) => (
    String(left.edge.id ?? '').localeCompare(String(right.edge.id ?? ''))
      || left.target.localeCompare(right.target)
  )))
  return adjacency
}

function reachableDestinations(adjacency, sourceAssetId, maxDepth = 100) {
  if (!adjacency.has(sourceAssetId)) return { destinations: [], truncated: false }
  const visited = new Set([sourceAssetId])
  const queue = [{ assetId: sourceAssetId, distance: 0 }]
  const destinations = []
  let cursor = 0
  let truncated = false
  while (cursor < queue.length) {
    const current = queue[cursor]
    cursor += 1
    const relations = adjacency.get(current.assetId) ?? []
    if (current.distance >= maxDepth) {
      if (relations.some(({ target }) => !visited.has(target))) truncated = true
      continue
    }
    for (const relation of relations) {
      if (visited.has(relation.target)) continue
      visited.add(relation.target)
      destinations.push({ assetId: relation.target, distance: current.distance + 1 })
      queue.push({ assetId: relation.target, distance: current.distance + 1 })
    }
  }
  return { destinations, truncated }
}

function findTracePath(adjacency, sourceAssetId, targetAssetId, maxDepth = 100) {
  if (!adjacency.has(sourceAssetId)) return { path: null, truncated: false }
  const visited = new Set([sourceAssetId])
  const queue = [{ assetId: sourceAssetId, distance: 0 }]
  const predecessor = new Map()
  let cursor = 0
  let truncated = false
  while (cursor < queue.length) {
    const current = queue[cursor]
    cursor += 1
    const relations = adjacency.get(current.assetId) ?? []
    if (current.distance >= maxDepth) {
      if (relations.some(({ target }) => !visited.has(target))) truncated = true
      continue
    }
    for (const relation of relations) {
      if (visited.has(relation.target)) continue
      visited.add(relation.target)
      predecessor.set(relation.target, {
        source: current.assetId,
        edge: relation.edge,
      })
      if (relation.target === targetAssetId) {
        const path = []
        let target = targetAssetId
        while (target !== sourceAssetId) {
          const previous = predecessor.get(target)
          if (!previous) return { path: null, truncated }
          path.unshift({ source: previous.source, target, edge: previous.edge })
          target = previous.source
        }
        return { path, truncated }
      }
      queue.push({ assetId: relation.target, distance: current.distance + 1 })
    }
  }
  return { path: null, truncated }
}

function reachableSet(adjacency, sourceAssetIds) {
  const visited = new Set()
  const queue = [...new Set(sourceAssetIds)].filter((id) => adjacency.has(id))
  queue.forEach((id) => visited.add(id))
  let cursor = 0
  while (cursor < queue.length) {
    const current = queue[cursor]
    cursor += 1
    for (const relation of adjacency.get(current) ?? []) {
      if (visited.has(relation.target)) continue
      visited.add(relation.target)
      queue.push(relation.target)
    }
  }
  return visited
}

function normalizeRelationDirection(value) {
  const normalized = String(value ?? 'undirected').trim().toLowerCase()
    .replaceAll('-', '_')
  return ['source_to_target', 'target_to_source', 'bidirectional', 'undirected']
    .includes(normalized)
    ? normalized
    : 'undirected'
}

function directionCoverageForGraph(graph) {
  const edges = graph.edges ?? []
  const undirectedEdgeCount = edges.filter(({ direction }) => (
    normalizeRelationDirection(direction) === 'undirected'
  )).length
  const directedEdgeCount = edges.length - undirectedEdgeCount
  return {
    confirmedEdgeCount: edges.length,
    directedEdgeCount,
    undirectedEdgeCount,
    coverageStatus: edges.length === 0
      ? 'none'
      : undirectedEdgeCount === 0 ? 'complete' : directedEdgeCount === 0 ? 'none' : 'partial',
  }
}

function verifiedRootNodes(graph) {
  return graph.nodes.filter((node) => (
    ['root', 'core'].includes(
      String(node.topologyRole ?? '').trim().toLowerCase(),
    )
  ))
}

function traceAvailabilityReason(graph, physicalAdjacency, normalized, sourceAssetId) {
  const directionalMode = ['upstream', 'downstream'].includes(normalized.mode)
    || (['point_to_point', 'reachable'].includes(normalized.mode)
      && normalized.direction !== 'both')
  if (!directionalMode) return null
  if (!verifiedRootNodes(graph).length) return 'root_not_defined'
  const physicalComponent = reachableSet(physicalAdjacency, [sourceAssetId])
  if (physicalComponent.size <= 1) return null
  const hasServiceEdge = graph.edges.some((edge) => (
    physicalComponent.has(edge.sourceAssetId)
      && physicalComponent.has(edge.targetAssetId)
      && normalizeRelationDirection(edge.direction) !== 'undirected'
  ))
  return hasServiceEdge ? null : 'direction_not_available'
}

function hasUnavailableDirectionOnPhysicalPath(graph, physicalPathResult) {
  return Boolean(physicalPathResult?.path?.some(({ edge }) => (
    normalizeRelationDirection(edge.direction) === 'undirected'
  )))
}

function hasIncompleteDirectionOnRootArea(
  graph,
  physicalReachable,
  baselineReachable,
  incompleteDirectionNodes,
) {
  if ([...incompleteDirectionNodes].some((id) => !baselineReachable.has(id))) return true
  return graph.edges.some((edge) => (
    physicalReachable.has(edge.sourceAssetId)
      && physicalReachable.has(edge.targetAssetId)
      && normalizeRelationDirection(edge.direction) === 'undirected'
  ))
}

function reachableViaUndirectedEdge(adjacency, sourceAssetIds) {
  const incomplete = new Set()
  const bestState = new Map()
  const queue = [...new Set(sourceAssetIds)]
    .filter((id) => adjacency.has(id))
    .map((assetId) => ({ assetId, incomplete: false }))
  queue.forEach(({ assetId }) => bestState.set(assetId, false))
  let cursor = 0
  while (cursor < queue.length) {
    const current = queue[cursor]
    cursor += 1
    if (current.incomplete) incomplete.add(current.assetId)
    for (const relation of adjacency.get(current.assetId) ?? []) {
      const nextIncomplete = current.incomplete
        || normalizeRelationDirection(relation.edge.direction) === 'undirected'
      const previous = bestState.get(relation.target)
      if (previous === true || (previous === false && !nextIncomplete)) continue
      bestState.set(relation.target, nextIncomplete)
      queue.push({ assetId: relation.target, incomplete: nextIncomplete })
    }
  }
  return incomplete
}

function resolveImpactFailure(graph, normalized, resolver = null) {
  if (normalized.failureType === 'asset') {
    const resolvedAssetId = resolver?.resolve(normalized.failureId) ?? normalized.failureId
    const node = graph.nodes.find(({ id }) => id === resolvedAssetId)
    return node
      ? {
        type: 'asset',
        id: normalized.failureId,
        resolvedAssetId: node.id,
        edges: graph.edges.filter((edge) => (
          edge.sourceAssetId === node.id || edge.targetAssetId === node.id
        )),
      }
      : null
  }
  const matches = graph.edges.filter((edge) => {
    const identifiers = [
      edge.id,
      edge.relationId,
      edge.candidateId,
      ...(edge.sourceRelationIds ?? []),
    ].filter(Boolean)
    if (normalized.failureType === 'relation') return identifiers.includes(normalized.failureId)
    return [
      edge.pathAssetId,
      ...(edge.pathAssetIds ?? []),
      ...(edge.sourceGeometryIds ?? []),
    ].filter(Boolean).includes(normalized.failureId)
  })
  return matches.length
    ? { type: normalized.failureType, id: normalized.failureId, edges: matches }
    : null
}

function resolveImpactRoots(graph, resolver, requestedRootAssetIds) {
  const rootIds = requestedRootAssetIds === null
    ? verifiedRootNodes(graph).map(({ id }) => id)
    : requestedRootAssetIds
      .map((assetId) => resolver.resolve(assetId) ?? assetId)
  return graph.nodes
    .filter(({ id }) => rootIds.includes(id))
    .filter((node, index, nodes) => nodes.findIndex(({ id }) => id === node.id) === index)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function simulateImpactFailure(graph, failure) {
  const failedNodeIds = failure.type === 'asset'
    ? new Set([failure.resolvedAssetId])
    : new Set()
  const failedEdgeIds = new Set(failure.edges.map(({ id }) => id).filter(Boolean))
  const nodes = graph.nodes.filter(({ id }) => !failedNodeIds.has(id))
  const nodeIds = new Set(nodes.map(({ id }) => id))
  const edges = graph.edges.filter((edge) => (
    !failedEdgeIds.has(edge.id)
      && nodeIds.has(edge.sourceAssetId)
      && nodeIds.has(edge.targetAssetId)
  ))
  return restrictTraceGraph({ ...graph, nodes, edges }, nodeIds)
}

function impactNodes(graph, ids, reason) {
  return ids.map((assetId) => {
    const node = graph.nodes.find(({ id }) => id === assetId)
    return {
      assetId,
      siteId: node?.siteId ?? null,
      category: node?.category ?? node?.networkFamily ?? null,
      networkFamily: node?.networkFamily ?? null,
      topologyRole: node?.topologyRole ?? 'unknown',
      componentId: componentIdForNode(graph, assetId),
      reason,
    }
  })
}

function impactUnavailable({
  datasetVersionId,
  graphRevision,
  normalized,
  failure = null,
  reason,
  limitation,
}) {
  const empty = []
  return {
    status: 'unavailable',
    datasetVersionId,
    graphRevision,
    failure: failure
      ? {
        type: normalized.failureType,
        id: normalized.failureId,
        resolvedAssetId: failure.resolvedAssetId ?? null,
      }
      : {
        type: normalized.failureType,
        id: normalized.failureId,
        resolvedAssetId: null,
      },
    roots: [],
    confirmedImpacted: empty,
    potentiallyImpacted: empty,
    confirmedTopologyImpact: empty,
    potentialTopologyImpact: empty,
    confirmedGroups: [],
    potentialGroups: [],
    cutEdges: [],
    summary: {
      baselineReachable: 0,
      reachableAfterFailure: 0,
      confirmedImpacted: 0,
      potentiallyImpacted: 0,
    },
    reason,
    limitations: [limitation],
    computedAt: new Date().toISOString(),
  }
}

function isTopologyPreviewAllowed(context) {
  return context?.preview === true
    && String(context.actorRole ?? '').toLowerCase() === 'administrator'
}

function decorateTopologyPreviewResult(result, context, record) {
  if (!isTopologyPreviewAllowed(context)) return result
  return {
    ...result,
    preview: true,
    publicationStatus: record.datasetVersion?.publicationStatus ?? 'unpublished',
    publicationProfile: record.datasetVersion?.publicationProfile ?? null,
  }
}

function groupImpactItems(items) {
  const groups = new Map()
  items.forEach((item) => {
    const key = [item.siteId ?? '', item.category ?? '', item.componentId ?? ''].join('|')
    const group = groups.get(key) ?? {
      siteId: item.siteId ?? null,
      category: item.category ?? null,
      componentId: item.componentId ?? null,
      assetIds: [],
      count: 0,
    }
    group.assetIds.push(item.assetId)
    group.count += 1
    groups.set(key, group)
  })
  return [...groups.values()]
    .map((group) => ({ ...group, assetIds: group.assetIds.sort() }))
    .sort((left, right) => (
      String(left.siteId ?? '').localeCompare(String(right.siteId ?? ''))
        || String(left.category ?? '').localeCompare(String(right.category ?? ''))
        || String(left.componentId ?? '').localeCompare(String(right.componentId ?? ''))
    ))
}

function traceEdge(edge, sourceAssetId, targetAssetId) {
  const sourceGeometryIds = Array.isArray(edge.sourceGeometryIds)
    ? edge.sourceGeometryIds
    : edge.sourceGeometryId ? [edge.sourceGeometryId] : []
  const pathAssetIds = Array.isArray(edge.pathAssetIds)
    ? edge.pathAssetIds
    : edge.pathAssetId ? [edge.pathAssetId] : []
  return {
    edgeId: edge.id,
    relationId: edge.relationId ?? edge.sourceRelationIds?.[0] ?? null,
    sourceAssetId,
    targetAssetId,
    pathAssetIds: uniqueValues(pathAssetIds),
    sourceGeometryIds: uniqueValues(sourceGeometryIds),
    relationType: edge.relationType ?? 'connected-via-path',
    direction: orientedTraceDirection(edge, sourceAssetId, targetAssetId),
    relationDirection: normalizeRelationDirection(edge.direction),
    provenance: edge.provenance ?? edge.relationSource ?? 'manual_review',
    relationSource: edge.relationSource ?? edge.provenance ?? 'manual_review',
    verificationStatus: 'confirmed',
    networkFamily: edge.networkFamily ?? null,
    lengthMeters: finiteNumber(edge.lengthMeters ?? edge.distanceMeters),
  }
}

function componentIdForNode(graph, nodeId) {
  return graph.components.find(({ nodeIds }) => nodeIds.includes(nodeId))?.componentId ?? null
}

function networkFamilyForNodes(graph, nodeIds) {
  const families = uniqueValues(nodeIds.map((nodeId) => (
    graph.nodes.find((node) => node.id === nodeId)?.networkFamily
  )).filter(Boolean))
  if (!families.length) return null
  return families.length === 1 ? families[0] : 'mixed'
}

function sumLength(edges) {
  const lengths = edges.map(({ lengthMeters }) => lengthMeters).filter(Number.isFinite)
  return lengths.length === edges.length
    ? lengths.reduce((total, length) => total + length, 0)
    : null
}

function graphValidationErrorCount(validation) {
  return Number(validation?.summary?.errors)
    || (validation?.issues ?? []).filter(({ severity }) => severity === 'error').length
}

function hasPendingCandidate(record, resolver, sourceAssetId, targetAssetId) {
  return (record.topologyCandidates ?? [])
    .filter(({ candidateStatus }) => ['candidate', 'ambiguous'].includes(candidateStatus))
    .some((candidate) => {
      const sourceIds = [candidate.sourcePathAssetId, candidate.targetPathAssetId]
        .map((id) => resolver.resolve(id) ?? id)
        .filter(Boolean)
      const targetIds = [candidate.targetAssetId, candidate.targetPathAssetId, candidate.sourcePathAssetId]
        .map((id) => resolver.resolve(id) ?? id)
        .filter(Boolean)
      return (sourceIds.includes(sourceAssetId) && targetIds.includes(targetAssetId))
        || (sourceIds.includes(targetAssetId) && targetIds.includes(sourceAssetId))
    })
}

function traceMessageForReason(reason) {
  return {
    source_not_topology_node: 'Aset ini belum terdaftar sebagai node topology.',
    target_not_topology_node: 'Aset tujuan belum terdaftar sebagai node topology.',
    isolated_source: 'Belum ada koneksi terkonfirmasi dari aset ini.',
    'isolated-source': 'Belum ada koneksi terkonfirmasi dari aset ini.',
    different_component: 'Target berada di luar komponen yang sudah diverifikasi.',
    'different-component': 'Target berada di luar komponen yang sudah diverifikasi.',
    candidate_pending_review: 'Jalur mungkin tersedia tetapi masih menunggu review topology.',
    direction_not_available: 'Direction service belum cukup terverifikasi; lengkapi review arah relation.',
    root_not_defined: 'Verified root/core belum ditetapkan untuk directional traversal.',
    scope_excludes_path: 'Scope yang diminta mengecualikan sebagian jalur topology.',
    max_depth_reached: 'Batas kedalaman traversal tercapai; naikkan maxDepth atau gunakan scope yang lebih tepat.',
    unreachable: 'Tidak ada jalur topologi terkonfirmasi antara aset awal dan tujuan.',
    topology_not_published: 'Topology trace/impact belum dipublikasikan pada profile dataset aktif.',
  }[reason] ?? 'Jalur topologi tidak dapat ditemukan.'
}

function traceState({
  datasetVersionId,
  graphRevision,
  sourceAssetId,
  targetAssetId = null,
  componentId = null,
  mode = null,
  direction = null,
  status,
  reason = null,
  message,
}) {
  return {
    status,
    datasetVersionId,
    graphRevision,
    sourceAssetId,
    targetAssetId,
    componentId,
    mode,
    direction,
    reason,
    message,
    nodeIds: [],
    edges: [],
    hopCount: 0,
    totalLengthMeters: null,
  }
}

async function recordTraceAudit(auditLog, {
  actorId,
  datasetVersionId,
  request,
  result,
  durationMilliseconds = null,
  cacheHit = false,
}) {
  if (!auditLog?.record) return
  try {
    await auditLog.record('topology.trace_requested', {
      actorId,
      datasetVersionId,
      correlationId: request.correlationId ?? null,
      outcome: result.status,
      details: {
        sourceAssetId: request.sourceAssetId,
        targetAssetId: request.targetAssetId,
        mode: request.mode,
        direction: request.direction,
        requestedGraphRevision: request.graphRevision,
        graphRevision: result.graphRevision ?? null,
        resultStatus: result.status,
        reason: result.reason ?? null,
        hopCount: result.hopCount ?? null,
        impactCount: null,
        durationMilliseconds,
        cacheHit,
      },
    })
  } catch {
    // Tracing must remain available if telemetry storage is temporarily down.
  }
}

function orientedTraceDirection(edge, sourceAssetId, targetAssetId) {
  const relationDirection = normalizeRelationDirection(edge.direction)
  if (relationDirection === 'bidirectional' || relationDirection === 'undirected') {
    return relationDirection
  }
  const followsStoredOrientation = sourceAssetId === edge.sourceAssetId
    && targetAssetId === edge.targetAssetId
  if (followsStoredOrientation) return relationDirection
  return relationDirection === 'source_to_target'
    ? 'target_to_source'
    : 'source_to_target'
}

async function recordImpactAudit(auditLog, {
  actorId,
  datasetVersionId,
  request,
  result,
  durationMilliseconds = null,
  cacheHit = false,
}) {
  if (!auditLog?.record) return
  try {
    await auditLog.record('topology.impact_requested', {
      actorId,
      datasetVersionId,
      correlationId: request.correlationId ?? null,
      outcome: result.status,
      details: {
        failureType: request.failureType,
        failureId: request.failureId,
        requestedGraphRevision: request.graphRevision,
        graphRevision: result.graphRevision ?? null,
        resultStatus: result.status,
        reason: result.reason ?? null,
        impactCount: result.summary?.confirmedImpacted ?? null,
        potentialImpactCount: result.summary?.potentiallyImpacted ?? null,
        durationMilliseconds,
        cacheHit,
      },
    })
  } catch {
    // Impact calculation remains available if audit storage is temporarily down.
  }
}

function topologyResultCacheKey(kind, datasetVersionId, graphRevision, request) {
  const normalizedRequest = canonicalizeTopologyRequest(request)
  const requestHash = createHash('sha256')
    .update(JSON.stringify(normalizedRequest))
    .digest('hex')
  return `${kind}:${datasetVersionId}:${graphRevision}:${requestHash}`
}

function canonicalizeTopologyRequest(request) {
  return Object.fromEntries(Object.entries(request ?? {})
    .filter(([key]) => key !== 'correlationId')
    .map(([key, value]) => [
      key,
      Array.isArray(value) ? [...new Set(value)].sort() : value,
    ])
    .sort(([left], [right]) => left.localeCompare(right)))
}

function readTopologyResultCache(cache, key) {
  const value = cache.get(key)
  return value ? structuredClone(value) : null
}

function writeTopologyResultCache(cache, key, value) {
  cache.set(key, structuredClone(value))
  while (cache.size > 256) {
    const oldestKey = cache.keys().next().value
    cache.delete(oldestKey)
  }
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))]
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}
