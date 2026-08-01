import { AppError } from '../errors.js'
import {
  generateRelationArtifacts,
  normalizeTopologySummary,
} from './semantic-relation-engine.js'

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
  }

  async regenerate(datasetVersionId, actorId, { reason } = {}) {
    const current = await this.repository.get(datasetVersionId)
    assertTopologyBundle(current)
    const generatedAt = this.clock().toISOString()
    const artifacts = generateRelationArtifacts(current.topologyInputBundle, {
      config: this.config,
      previousCandidates: current.topologyCandidates,
      previousRelations: current.confirmedRelations,
      generatedAt,
    })
    const event = await this.auditLog.record('topology.candidates_regenerated', {
      actorId,
      datasetVersionId,
      branchId: current.datasetVersion.branchId,
      outcome: 'regenerated',
      details: {
        reason: normalizeReason(reason, false),
        topologyRuleSetVersion: artifacts.topologyRuleSetVersion,
        before: current.topologySummary ?? null,
        after: artifacts.summary,
      },
    })
    return this.repository.update(datasetVersionId, (record) => applyArtifacts(record, artifacts, {
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
    }))
  }

  async getSummary(datasetVersionId) {
    const record = await this.repository.get(datasetVersionId)
    return {
      datasetVersionId,
      topologyRuleSetVersion: record.topologyRuleSetVersion ?? null,
      summary: normalizeTopologySummary(
        record.topologySummary ?? emptySummary(),
        record.topologyGraph,
        record.confirmedRelations,
      ),
      readiness: record.topologyReadiness ?? {
        topologyReadiness: 'not_ready',
        blockingReasons: ['topology_not_generated'],
      },
      validation: record.topologyValidation ?? null,
      lastGeneratedAt: record.topologyGeneratedAt ?? null,
    }
  }

  async getCandidates(datasetVersionId) {
    const record = await this.repository.get(datasetVersionId)
    return {
      datasetVersionId,
      topologyRuleSetVersion: record.topologyRuleSetVersion ?? null,
      items: structuredClone(record.topologyCandidates ?? []),
      unresolved: structuredClone(record.topologyUnresolved ?? []),
      eligibilityIssues: structuredClone(record.topologyEligibilityIssues ?? []),
      lineworkIssues: structuredClone(record.topologyLineworkIssues ?? []),
      history: structuredClone(record.topologyCandidateHistory ?? []),
      runs: structuredClone(record.topologyRuns ?? []),
    }
  }

  async getGraph(datasetVersionId) {
    const record = await this.repository.get(datasetVersionId)
    return {
      datasetVersionId,
      graph: structuredClone(record.topologyGraph ?? {
        datasetVersionId,
        nodes: [],
        edges: [],
        components: [],
        degreeByNode: {},
        isolatedNodeIds: [],
      }),
      validation: structuredClone(record.topologyValidation ?? null),
      confirmedRelations: structuredClone(record.confirmedRelations ?? []),
    }
  }

  async confirmCandidate(candidateId, actorId, { reason } = {}) {
    return this.#reviewCandidate(candidateId, actorId, {
      action: 'confirm',
      reason: normalizeReason(reason, false),
    })
  }

  async confirmAllCandidates(datasetVersionId, actorId, { reason } = {}) {
    const current = await this.repository.get(datasetVersionId)
    assertTopologyBundle(current)
    const candidates = current.topologyCandidates ?? []
    const confirmable = candidates.filter(isBulkConfirmableCandidate)
    const normalizedReason = normalizeReason(reason, false)
    if (!confirmable.length) {
      return bulkReviewResponse(current, {
        action: 'confirm_all',
        affectedCount: 0,
      })
    }

    const reviewedAt = this.clock().toISOString()
    const candidateIds = confirmable.map(({ candidateId }) => candidateId)
    const candidateIdSet = new Set(candidateIds)
    const event = await this.auditLog.record('topology.candidates_bulk_confirmed', {
      actorId,
      datasetVersionId,
      branchId: current.datasetVersion.branchId,
      outcome: 'confirmed',
      details: {
        candidateCount: candidateIds.length,
        candidateIds,
        reason: normalizedReason,
        topologyRuleSetVersion: current.topologyRuleSetVersion ?? null,
      },
    })
    const updated = await this.repository.update(datasetVersionId, (record) => {
      const nextCandidates = structuredClone(record.topologyCandidates ?? [])
      nextCandidates.forEach((candidate) => {
        if (!candidateIdSet.has(candidate.candidateId)) return
        if (!isBulkConfirmableCandidate(candidate)) {
          throw new AppError('Daftar kandidat berubah sejak aksi bulk dimulai.', {
            code: 'stale_topology_bulk_review',
            statusCode: 409,
          })
        }
        candidate.candidateStatus = 'confirmed'
        candidate.proposalStatus = 'confirmed_by_admin_bulk'
        candidate.review = reviewRecord({
          actorId,
          reviewedAt,
          reason: normalizedReason,
          action: 'confirm_all',
          auditEventId: event.id,
          before: 'candidate',
          after: 'confirmed',
        })
      })
      return rebuildFromReviewedCandidates(record, nextCandidates, this.config, reviewedAt)
    })
    return bulkReviewResponse(updated, {
      action: 'confirm_all',
      affectedCount: candidateIds.length,
      auditEventId: event.id,
    })
  }

  async rejectCandidate(candidateId, actorId, { reason } = {}) {
    return this.#reviewCandidate(candidateId, actorId, {
      action: 'reject',
      reason: normalizeReason(reason, true),
    })
  }

  async skipCandidate(candidateId, actorId, { reason } = {}) {
    return this.#reviewCandidate(candidateId, actorId, {
      action: 'skip',
      reason: normalizeReason(reason, false),
    })
  }

  async selectTarget(candidateId, actorId, {
    targetCandidateId,
    targetAssetId,
    reason,
  } = {}) {
    const located = await this.#findCandidate(candidateId)
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
    const normalizedReason = normalizeReason(reason, true)
    const event = await this.auditLog.record('topology.candidate_target_selected', {
      actorId,
      datasetVersionId: located.datasetVersionId,
      branchId: located.record.datasetVersion.branchId,
      outcome: 'confirmed',
      details: {
        before: candidateAuditSnapshot(original),
        after: candidateAuditSnapshot(selected, 'confirmed'),
        reason: normalizedReason,
        candidateEvidence: selected.evidence,
        topologyRuleSetVersion: selected.topologyRuleSetVersion,
      },
    })
    const updated = await this.repository.update(located.datasetVersionId, (record) => {
      const nextCandidates = structuredClone(record.topologyCandidates ?? [])
      const currentOriginal = nextCandidates.find(({ candidateId: id }) => id === candidateId)
      const currentSelected = nextCandidates.find(({ candidateId: id }) => (
        id === selected.candidateId
      ))
      assertCurrentCandidateState(currentSelected, selected.candidateStatus)
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
      return rebuildFromReviewedCandidates(record, nextCandidates, this.config, reviewedAt)
    })
    return candidateReviewResponse(updated, selected.candidateId)
  }

  async revokeRelation(relationId, actorId, { reason } = {}) {
    const located = await this.#findRelation(relationId)
    const relation = located.relation
    if (relation.verificationStatus !== 'confirmed') {
      throw invalidTransition(relation.verificationStatus, 'revoked')
    }
    const revokedAt = this.clock().toISOString()
    const normalizedReason = normalizeReason(reason, true)
    const event = await this.auditLog.record('topology.relation_revoked', {
      actorId,
      datasetVersionId: located.datasetVersionId,
      branchId: located.record.datasetVersion.branchId,
      outcome: 'revoked',
      details: {
        before: relation,
        after: {
          relationId,
          verificationStatus: 'revoked',
          revokedBy: actorId,
          revokedAt,
        },
        reason: normalizedReason,
        topologyRuleSetVersion: relation.topologyRuleSetVersion,
      },
    })
    const updated = await this.repository.update(located.datasetVersionId, (record) => {
      const currentRelation = (record.confirmedRelations ?? [])
        .find(({ relationId: id }) => id === relationId)
      if (!currentRelation || currentRelation.verificationStatus !== 'confirmed') {
        throw invalidTransition(currentRelation?.verificationStatus ?? 'missing', 'revoked')
      }
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
      const rebuilt = rebuildFromReviewedCandidates(record, nextCandidates, this.config, revokedAt)
      rebuilt.topologyRelationHistory = [
        ...(record.topologyRelationHistory ?? []),
        revoked,
      ]
      return rebuilt
    })
    return {
      datasetVersionId: located.datasetVersionId,
      relation: {
        ...relation,
        verificationStatus: 'revoked',
        revokedBy: actorId,
        revokedAt,
        auditEventId: event.id,
      },
      graph: updated.topologyGraph,
      readiness: updated.topologyReadiness,
    }
  }

  async revokeAllRelations(datasetVersionId, actorId, { reason } = {}) {
    const current = await this.repository.get(datasetVersionId)
    assertTopologyBundle(current)
    const relations = (current.confirmedRelations ?? [])
      .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
    const normalizedReason = normalizeReason(reason, true)
    if (!relations.length) {
      return bulkReviewResponse(current, {
        action: 'revoke_all',
        affectedCount: 0,
      })
    }

    const revokedAt = this.clock().toISOString()
    const relationIds = relations.map(({ relationId }) => relationId)
    const candidateIds = new Set(relations.map(({ candidateId }) => candidateId).filter(Boolean))
    const event = await this.auditLog.record('topology.relations_bulk_revoked', {
      actorId,
      datasetVersionId,
      branchId: current.datasetVersion.branchId,
      outcome: 'revoked',
      details: {
        relationCount: relationIds.length,
        relationIds,
        candidateCount: candidateIds.size,
        candidateIds: [...candidateIds],
        reason: normalizedReason,
        topologyRuleSetVersion: current.topologyRuleSetVersion ?? null,
      },
    })
    const updated = await this.repository.update(datasetVersionId, (record) => {
      const currentRelations = (record.confirmedRelations ?? [])
        .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
      const currentRelationIds = new Set(currentRelations.map(({ relationId }) => relationId))
      if (relationIds.some((relationId) => !currentRelationIds.has(relationId))) {
        throw new AppError('Daftar relasi berubah sejak aksi bulk dimulai.', {
          code: 'stale_topology_bulk_review',
          statusCode: 409,
        })
      }

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
      )
      rebuilt.topologyRelationHistory = [
        ...(record.topologyRelationHistory ?? []),
        ...revokedRelations,
      ]
      return rebuilt
    })
    return bulkReviewResponse(updated, {
      action: 'revoke_all',
      affectedCount: relationIds.length,
      affectedCandidateCount: candidateIds.size,
      auditEventId: event.id,
    })
  }

  async #reviewCandidate(candidateId, actorId, { action, reason }) {
    const located = await this.#findCandidate(candidateId)
    const candidate = located.candidate
    const targetStatus = {
      confirm: 'confirmed',
      reject: 'rejected',
      skip: 'ambiguous',
    }[action]
    const allowed = action === 'confirm'
      ? ['candidate', 'ambiguous', 'revoked']
      : ['candidate', 'ambiguous']
    if (!allowed.includes(candidate.candidateStatus)) {
      throw invalidTransition(candidate.candidateStatus, targetStatus)
    }
    const reviewedAt = this.clock().toISOString()
    const event = await this.auditLog.record(`topology.candidate_${action}ed`, {
      actorId,
      datasetVersionId: located.datasetVersionId,
      branchId: located.record.datasetVersion.branchId,
      outcome: targetStatus,
      details: {
        before: candidateAuditSnapshot(candidate),
        after: candidateAuditSnapshot(candidate, targetStatus),
        reason,
        candidateEvidence: candidate.evidence,
        topologyRuleSetVersion: candidate.topologyRuleSetVersion,
      },
    })
    const updated = await this.repository.update(located.datasetVersionId, (record) => {
      const nextCandidates = structuredClone(record.topologyCandidates ?? [])
      const current = nextCandidates.find(({ candidateId: id }) => id === candidateId)
      if (!current) throw candidateNotFound(candidateId)
      assertCurrentCandidateState(current, candidate.candidateStatus)
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
        before: candidate.candidateStatus,
        after: targetStatus,
      })
      return rebuildFromReviewedCandidates(record, nextCandidates, this.config, reviewedAt)
    })
    return candidateReviewResponse(updated, candidateId)
  }

  async #findCandidate(candidateId) {
    assertEntityId(candidateId, 'candidate')
    const matches = (await this.repository.list()).flatMap((record) => (
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

  async #findRelation(relationId) {
    assertEntityId(relationId, 'relation')
    const matches = (await this.repository.list()).flatMap((record) => (
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

export function applyArtifacts(record, artifacts, {
  candidateHistory = record.topologyCandidateHistory ?? [],
  topologyRun = null,
} = {}) {
  const legacyRelations = artifacts.graph.edges.map((edge) => ({
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
    topologyGraph: artifacts.graph,
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

function rebuildFromReviewedCandidates(record, candidates, config, generatedAt) {
  const artifacts = generateRelationArtifacts(record.topologyInputBundle, {
    config,
    previousCandidates: candidates,
    previousRelations: record.confirmedRelations,
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
  return {
    datasetVersionId: record.datasetVersion.id,
    candidate: structuredClone(
      record.topologyCandidates.find(({ candidateId: id }) => id === candidateId),
    ),
    confirmedRelations: structuredClone(record.confirmedRelations ?? []),
    graph: structuredClone(record.topologyGraph),
    readiness: structuredClone(record.topologyReadiness),
  }
}

function bulkReviewResponse(record, {
  action,
  affectedCount,
  affectedCandidateCount = affectedCount,
  auditEventId = null,
}) {
  return {
    datasetVersionId: record.datasetVersion.id,
    action,
    affectedCount,
    affectedCandidateCount,
    auditEventId,
    summary: structuredClone(record.topologySummary ?? emptySummary()),
    graph: structuredClone(record.topologyGraph),
    readiness: structuredClone(record.topologyReadiness),
    confirmedRelationCount: (record.confirmedRelations ?? [])
      .filter(({ verificationStatus }) => verificationStatus === 'confirmed').length,
    confirmedDeviceEdgeCount: record.topologyGraph?.edges?.length ?? 0,
    confirmedPathAttachmentCount: record.topologySummary?.confirmedPathAttachmentCount ?? 0,
    confirmedPathContinuationCount: record.topologySummary?.confirmedPathContinuationCount ?? 0,
  }
}

function isBulkConfirmableCandidate(candidate) {
  return candidate.candidateStatus === 'candidate'
    && candidate.proposalStatus === 'recommended'
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
