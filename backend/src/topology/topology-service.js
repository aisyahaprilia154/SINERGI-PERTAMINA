import { randomUUID } from 'node:crypto'
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
    const graph = normalizeTraceGraph(record, buildAssetIdentityMapFromRecord(record))
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
      candidateRevision: createCandidateCollectionRevision(record.topologyCandidates ?? []),
      recordRevision: recordRevision(record),
    }
  }

  async getCandidates(datasetVersionId, query = {}) {
    const record = await this.repository.get(datasetVersionId)
    const candidates = record.topologyCandidates ?? []
    const graph = normalizeTraceGraph(record, buildAssetIdentityMapFromRecord(record))
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
    const page = paginateCandidates(index, {
      ...normalizedQuery,
      graphRevision: graph.graphRevision,
      candidateRevision,
    })
    return {
      datasetVersionId,
      topologyRuleSetVersion: record.topologyRuleSetVersion ?? null,
      items: page.items,
      nextCursor: page.nextCursor,
      pageInfo: page.pageInfo,
      summary: summarizeCandidates(page.filteredCandidates),
      datasetSummary: summarizeCandidates(candidates),
      query: {
        status: normalizedQuery.status,
        site: normalizedQuery.site,
        networkFamily: normalizedQuery.networkFamily,
        minScore: normalizedQuery.minScore,
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

  async getGraph(datasetVersionId) {
    const record = await this.repository.get(datasetVersionId)
    const graph = normalizeTraceGraph(record, buildAssetIdentityMapFromRecord(record))
    return {
      datasetVersionId,
      graph,
      validation: structuredClone(record.topologyValidation ?? null),
      confirmedRelations: structuredClone(record.confirmedRelations ?? []),
    }
  }

  async trace(datasetVersionId, request = {}, actorId = null, correlationId = null) {
    const normalized = normalizeTraceRequest(request)
    normalized.correlationId = correlationId
    const record = await this.repository.get(datasetVersionId)
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const resolver = createAssetIdentityResolver(identityMap)
    const graph = normalizeTraceGraph(record, identityMap)

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
      })
      throw error
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
    if (!sourceAssetId || !nodeIds.has(sourceAssetId)) {
      const result = traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId: normalized.sourceAssetId,
        targetAssetId: normalized.targetAssetId,
        status: 'invalid-source',
        reason: 'source_not_topology_node',
        message: 'Aset ini belum terdaftar sebagai node topology.',
      })
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result,
      })
      return result
    }

    const targetAssetId = normalized.targetAssetId === null
      ? null
      : resolveTraceAssetId(resolver, graph, normalized.targetAssetId)
    if (normalized.targetAssetId !== null && (!targetAssetId || !nodeIds.has(targetAssetId))) {
      const result = traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId,
        targetAssetId: normalized.targetAssetId,
        status: 'invalid-target',
        reason: 'target_not_topology_node',
        message: 'Aset tujuan belum terdaftar sebagai node topology.',
      })
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result,
      })
      return result
    }

    const adjacency = buildTraceAdjacency(traversalGraph)
    const componentId = componentIdForNode(traversalGraph, sourceAssetId)
    if (targetAssetId === null) {
      const destinations = reachableDestinations(adjacency, sourceAssetId)
      const result = destinations.length
        ? {
          status: 'destinations',
          datasetVersionId,
          graphRevision: graph.graphRevision,
          sourceAssetId,
          componentId,
          destinations,
          direction: normalized.direction,
          explanation: 'Tujuan dihitung dari confirmed operational graph.',
        }
        : traceState({
          datasetVersionId,
          graphRevision: graph.graphRevision,
          sourceAssetId,
          componentId,
          status: 'unreachable',
          reason: 'isolated-source',
          message: 'Belum ada koneksi terkonfirmasi dari aset ini.',
        })
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result,
      })
      return result
    }

    if (sourceAssetId === targetAssetId) {
      const result = {
        status: 'found',
        datasetVersionId,
        graphRevision: graph.graphRevision,
        componentId,
        sourceAssetId,
        targetAssetId,
        nodeIds: [sourceAssetId],
        edges: [],
        hopCount: 0,
        totalLengthMeters: null,
        networkFamily: networkFamilyForNodes(traversalGraph, [sourceAssetId]),
        direction: normalized.direction,
        verifiedAt: record.topologyGeneratedAt ?? null,
        explanation: 'Titik awal dan tujuan adalah aset yang sama.',
      }
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result,
      })
      return result
    }

    const path = findTracePath(adjacency, sourceAssetId, targetAssetId)
    if (!path) {
      const targetComponentId = componentIdForNode(traversalGraph, targetAssetId)
      const reason = traversalGraph.degreeByNode?.[sourceAssetId] === 0
        ? 'isolated-source'
        : hasPendingCandidate(record, resolver, sourceAssetId, targetAssetId)
          ? 'candidate_pending_review'
          : componentId !== targetComponentId
            ? 'different-component'
            : 'unreachable'
      const result = traceState({
        datasetVersionId,
        graphRevision: graph.graphRevision,
        sourceAssetId,
        targetAssetId,
        componentId,
        status: 'unreachable',
        reason,
        message: traceMessageForReason(reason),
      })
      await recordTraceAudit(this.auditLog, {
        actorId,
        datasetVersionId,
        request: normalized,
        result,
      })
      return result
    }

    const edges = path.map(({ edge, source, target }) => traceEdge(edge, source, target))
    const result = {
      status: 'found',
      datasetVersionId,
      graphRevision: graph.graphRevision,
      componentId,
      sourceAssetId,
      targetAssetId,
      nodeIds: [sourceAssetId, ...path.map(({ target }) => target)],
      edges,
      hopCount: edges.length,
      totalLengthMeters: sumLength(edges),
      networkFamily: networkFamilyForNodes(traversalGraph, [
        sourceAssetId,
        ...path.map(({ target }) => target),
      ]),
      direction: normalized.direction,
      verifiedAt: record.topologyGeneratedAt ?? null,
      explanation: 'Jalur menggunakan confirmed operational graph.',
    }
    await recordTraceAudit(this.auditLog, {
      actorId,
      datasetVersionId,
      request: normalized,
      result,
    })
    return result
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
      predicate: isCandidateConfirmable,
      selectedCandidateIds: normalizeCandidateIds(candidateIds),
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
  }) {
    const normalizedIdempotencyKey = normalizeTopologyIdempotencyKey(idempotencyKey)
    const normalizedReason = normalizeReason(reason, false)
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
      return await this.#withMutationTransaction(async ({ repository, auditLog }) => {
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
    direction = 'undirected',
    reason,
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
    const normalizedDirection = normalizeManualDirection(direction)
    const normalizedReason = normalizeReason(reason, true)
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
          direction: normalizedDirection,
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
    const initialSource = resolveManualDevice(current, normalizedSourceReference, 'sourceAssetId')
    const initialTarget = resolveManualDevice(current, normalizedTargetReference, 'targetAssetId')
    assertDistinctManualDevices(initialSource, initialTarget)
    assertSameManualDeviceSite(initialSource, initialTarget)
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
          direction: normalizedDirection,
          reason: normalizedReason,
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
          direction: normalizedDirection,
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
  return [...(record.topologyCandidateHistory ?? []), ...superseded]
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
  if (!key || typeof repository?.list !== 'function') return null
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
      .filter(isBulkConfirmableCandidate).length,
    remainingLineLabelCount: (record.topologyCandidates ?? [])
      .filter(isLineLabelConfirmableCandidate).length,
    ...reviewSnapshot(record),
  }
}

function candidateAssetReferences(candidate) {
  return [
    candidate?.sourcePathAssetId,
    candidate?.targetAssetId,
    candidate?.targetPathAssetId,
    ...(candidate?.sourceGeometryIds ?? []),
  ].filter(Boolean)
}

function reviewSnapshot(record) {
  const graph = normalizeTraceGraph(record, buildAssetIdentityMapFromRecord(record))
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
  return match
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
  const graph = normalizeTraceGraph(record, identityMap)
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
  const direction = String(request.direction ?? 'both').trim().toLowerCase()
  if (direction !== 'both') {
    throw new AppError(
      'Tracing saat ini hanya mendukung physical connectivity dua arah.',
      {
        code: 'unsupported_topology_trace_direction',
        statusCode: 400,
        details: { direction, supportedDirections: ['both'] },
      },
    )
  }
  return { sourceAssetId, targetAssetId, graphRevision, direction, scopeAssetIds }
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
  const components = (sourceComponents ?? []).map((component, index) => ({
    ...structuredClone(component),
    componentId: component.componentId ?? component.id ?? `component:${index + 1}`,
    nodeIds: [...new Set((component.nodeIds ?? [])
      .map(resolveNodeId)
      .filter((id) => nodeIds.has(id)))].sort(),
    edgeIds: (component.edgeIds ?? [])
      .filter((edgeId) => edges.some((edge) => edge.id === edgeId))
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

function buildTraceAdjacency(graph) {
  const adjacency = new Map(graph.nodes.map(({ id }) => [id, []]))
  graph.edges.forEach((edge) => {
    if (!adjacency.has(edge.sourceAssetId) || !adjacency.has(edge.targetAssetId)) return
    adjacency.get(edge.sourceAssetId).push({
      target: edge.targetAssetId,
      edge,
    })
    adjacency.get(edge.targetAssetId).push({
      target: edge.sourceAssetId,
      edge,
    })
  })
  adjacency.forEach((relations) => relations.sort((left, right) => (
    String(left.edge.id ?? '').localeCompare(String(right.edge.id ?? ''))
      || left.target.localeCompare(right.target)
  )))
  return adjacency
}

function reachableDestinations(adjacency, sourceAssetId) {
  if (!adjacency.has(sourceAssetId)) return []
  const visited = new Set([sourceAssetId])
  const queue = [{ assetId: sourceAssetId, distance: 0 }]
  const destinations = []
  while (queue.length) {
    const current = queue.shift()
    for (const relation of adjacency.get(current.assetId) ?? []) {
      if (visited.has(relation.target)) continue
      visited.add(relation.target)
      destinations.push({ assetId: relation.target, distance: current.distance + 1 })
      queue.push({ assetId: relation.target, distance: current.distance + 1 })
    }
  }
  return destinations
}

function findTracePath(adjacency, sourceAssetId, targetAssetId) {
  const visited = new Set([sourceAssetId])
  const queue = [sourceAssetId]
  const predecessor = new Map()
  while (queue.length) {
    const current = queue.shift()
    for (const relation of adjacency.get(current) ?? []) {
      if (visited.has(relation.target)) continue
      visited.add(relation.target)
      predecessor.set(relation.target, {
        source: current,
        edge: relation.edge,
      })
      if (relation.target === targetAssetId) {
        const path = []
        let target = targetAssetId
        while (target !== sourceAssetId) {
          const previous = predecessor.get(target)
          if (!previous) return null
          path.unshift({ source: previous.source, target, edge: previous.edge })
          target = previous.source
        }
        return path
      }
      queue.push(relation.target)
    }
  }
  return null
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
    sourceAssetId,
    targetAssetId,
    pathAssetIds: uniqueValues(pathAssetIds),
    sourceGeometryIds: uniqueValues(sourceGeometryIds),
    relationType: edge.relationType ?? 'connected-via-path',
    direction: edge.direction ?? 'undirected',
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
    'isolated-source': 'Belum ada koneksi terkonfirmasi dari aset ini.',
    'different-component': 'Target berada di luar komponen yang sudah diverifikasi.',
    candidate_pending_review: 'Jalur mungkin tersedia tetapi masih menunggu review topology.',
    unreachable: 'Tidak ada jalur topologi terkonfirmasi antara aset awal dan tujuan.',
  }[reason] ?? 'Jalur topologi tidak dapat ditemukan.'
}

function traceState({
  datasetVersionId,
  graphRevision,
  sourceAssetId,
  targetAssetId = null,
  componentId = null,
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
        direction: request.direction,
        requestedGraphRevision: request.graphRevision,
        graphRevision: result.graphRevision ?? null,
        resultStatus: result.status,
        reason: result.reason ?? null,
        hopCount: result.hopCount ?? null,
      },
    })
  } catch {
    // Tracing must remain available if telemetry storage is temporarily down.
  }
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))]
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}
