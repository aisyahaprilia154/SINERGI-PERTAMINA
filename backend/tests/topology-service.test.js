import assert from 'node:assert/strict'
import test from 'node:test'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'
import {
  applyArtifacts,
  classifyReviewValidationIssues,
  TopologyService,
} from '../src/topology/topology-service.js'

test('bulk preview distinguishes baseline topology issues from errors introduced by review', () => {
  const baseline = [{
    issueId: 'topology-issue:existing-dangling-relation',
    severity: 'error',
    issueCode: 'dangling_confirmed_relation',
    entityReference: 'relation:legacy',
  }]
  const classified = classifyReviewValidationIssues(baseline, [
    { ...baseline[0] },
    {
      issueId: 'topology-issue:new-cross-site-edge',
      severity: 'error',
      issueCode: 'cross_site_edge',
      entityReference: 'relation:new',
    },
  ])

  assert.equal(classified[0].reviewImpact, 'baseline')
  assert.equal(classified[1].reviewImpact, 'introduced')
})

test('candidate review is audited, materializes confirmed graph, and can be revoked/reconfirmed', async () => {
  const bundle = reviewBundle()
  const sourceGeometryBefore = structuredClone(bundle.geometries)
  const initial = generateRelationArtifacts(bundle, {
    generatedAt: '2026-07-29T01:00:00.000Z',
  })
  const repository = new MemoryRepository([
    applyArtifacts(baseRecord(bundle), initial),
  ])
  const auditLog = new MemoryAuditLog()
  const times = [
    '2026-07-29T02:00:00.000Z',
    '2026-07-29T03:00:00.000Z',
    '2026-07-29T04:00:00.000Z',
    '2026-07-29T05:00:00.000Z',
  ]
  const service = new TopologyService({
    repository,
    auditLog,
    clock: () => new Date(times.shift()),
  })
  const candidate = initial.candidates.find(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
  ))
  const endCandidate = initial.candidates.find(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:end'
  ))

  const firstConfirmation = await service.confirmCandidate(candidate.candidateId, 'admin-1', {
    reason: 'Endpoint telah diverifikasi pada peta sumber.',
    correlationId: 'topology-review-correlation',
  })
  assert.equal(firstConfirmation.candidate.candidateStatus, 'confirmed')
  assert.equal(firstConfirmation.confirmedRelations.length, 1)
  assert.equal(firstConfirmation.graph.edges.length, 0)
  assert.equal(firstConfirmation.confirmedRelations[0].relationKind, 'path_termination')
  assert.equal(auditLog.entries[0].correlationId, 'topology-review-correlation')
  const confirmed = await service.confirmCandidate(endCandidate.candidateId, 'admin-1', {
    reason: 'Endpoint kedua telah diverifikasi pada peta sumber.',
  })
  assert.equal(confirmed.candidate.candidateStatus, 'confirmed')
  assert.equal(confirmed.confirmedRelations.length, 2)
  assert.equal(confirmed.graph.edges.length, 1)
  assert.equal(confirmed.confirmedRelations.every(({ relationKind }) => (
    relationKind === 'path_termination'
  )), true)
  const confirmedRecord = await repository.get('dv-review')
  assert.equal(confirmedRecord.topologySummary.confirmedPathAttachmentCount, 2)
  assert.equal(confirmedRecord.topologySummary.confirmedDeviceEdgeCount, 1)
  assert.equal(confirmed.confirmedRelations[0].verificationStatus, 'confirmed')
  assert.equal(confirmed.confirmedRelations[0].verifiedBy, 'admin-1')
  assert.ok(confirmed.confirmedRelations[0].auditEventId)

  const relationId = confirmed.confirmedRelations.find(({ candidateId }) => (
    candidateId === candidate.candidateId
  )).relationId
  const revoked = await service.revokeRelation(relationId, 'admin-2', {
    reason: 'Verifikasi lapangan membuktikan target berbeda.',
  })
  assert.equal(revoked.relation.verificationStatus, 'revoked')
  assert.equal(revoked.graph.edges.length, 0)
  const afterRevoke = await repository.get('dv-review')
  assert.equal(afterRevoke.topologyRelationHistory.at(-1).verificationStatus, 'revoked')
  assert.equal(
    afterRevoke.topologyCandidates.find(({ candidateId }) => (
      candidateId === candidate.candidateId
    )).candidateStatus,
    'revoked',
  )

  const reconfirmed = await service.confirmCandidate(candidate.candidateId, 'admin-3', {
    reason: 'Bukti tambahan mengonfirmasi kembali koneksi.',
  })
  assert.equal(reconfirmed.candidate.candidateStatus, 'confirmed')
  assert.equal(reconfirmed.graph.edges.length, 1)
  assert.deepEqual((await repository.get('dv-review')).topologyInputBundle.geometries, (
    sourceGeometryBefore
  ))
  assert.deepEqual(
    auditLog.entries.map(({ event }) => event),
    [
      'topology.cable_termination_selected',
      'topology.cable_termination_selected',
      'topology.relation_revoked',
      'topology.cable_termination_selected',
    ],
  )
})

test('bulk review confirms recommended candidates and revokes every confirmed relation atomically', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const times = [
    '2026-07-29T06:00:00.000Z',
    '2026-07-29T07:00:00.000Z',
  ]
  const service = new TopologyService({
    repository,
    auditLog,
    clock: () => new Date(times.shift()),
  })

  const confirmed = await service.confirmAllCandidates('dv-review', 'admin-1', {
    reason: 'Kandidat recommended disetujui untuk dataset pilot.',
  })
  assert.equal(confirmed.action, 'confirm_all')
  assert.equal(confirmed.affectedCount, 2)
  assert.equal(confirmed.confirmedRelationCount, 2)
  assert.equal(confirmed.graph.edges.length, 1)

  await assert.rejects(
    service.revokeAllRelations('dv-review', 'admin-2', { reason: '' }),
    (error) => error.code === 'topology_review_reason_required',
  )
  const revoked = await service.revokeAllRelations('dv-review', 'admin-2', {
    reason: 'Dataset perlu diverifikasi ulang secara menyeluruh.',
  })
  assert.equal(revoked.action, 'revoke_all')
  assert.equal(revoked.affectedCount, 2)
  assert.equal(revoked.confirmedRelationCount, 0)
  assert.equal(revoked.graph.edges.length, 0)
  const record = await repository.get('dv-review')
  assert.equal(record.topologyRelationHistory.length, 2)
  assert.ok(record.topologyCandidates.every(({ candidateStatus }) => (
    candidateStatus === 'revoked'
  )))
  assert.deepEqual(
    auditLog.entries.map(({ event }) => event),
    ['topology.candidates_bulk_confirmed', 'topology.relations_bulk_revoked'],
  )
})

test('bulk confirmation excludes ambiguous alternatives', async () => {
  const bundle = reviewBundle({ secondNode: true })
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
  })

  const result = await service.confirmAllCandidates('dv-review', 'admin-1', {
    reason: 'Kandidat recommended telah diverifikasi oleh reviewer.',
  })
  const record = await repository.get('dv-review')
  assert.equal(result.affectedCount, 1)
  assert.equal(
    record.topologyCandidates.filter(({ candidateStatus }) => (
      candidateStatus === 'ambiguous'
    )).length,
    2,
  )
})

test('bulk review preview predicts graph changes and rejects endpoint conflicts', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
  })
  const recommended = initial.candidates
    .filter(({ candidateStatus, proposalStatus }) => (
      candidateStatus === 'candidate' && proposalStatus === 'recommended'
    ))
    .map(({ candidateId }) => candidateId)
  const snapshot = await service.getSummary('dv-review')
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.confirmable, true)
  assert.equal(snapshot.userMessage, null)
  const preview = await service.reviewPreview('dv-review', {
    candidateIds: recommended,
    expectedGraphRevision: snapshot.graphRevision,
    expectedCandidateRevision: snapshot.candidateRevision,
  })
  assert.equal(preview.safeToApply, true)
  assert.equal(preview.predictedSummary.confirmedRelationDelta, 2)
  assert.equal(preview.predictedSummary.componentCountAfter, 1)
  assert.equal(preview.validationPreview.summary.errors, 0)

  const conflictBundle = reviewBundle({ secondNode: true })
  const conflictArtifacts = generateRelationArtifacts(conflictBundle)
  const conflictCandidates = conflictArtifacts.candidates
    .filter(({ candidateType, sourceEndpointId }) => (
      candidateType === 'cable_termination'
        && sourceEndpointId === 'endpoint:geometry:CBL-01:start'
    ))
  assert.ok(conflictCandidates.length >= 2)
  const conflictRecord = applyArtifacts(baseRecord(conflictBundle), conflictArtifacts)
  const conflictIds = conflictCandidates.slice(0, 2).map(({ candidateId }) => candidateId)
  conflictRecord.topologyCandidates = conflictRecord.topologyCandidates.map((candidate) => (
    conflictIds.includes(candidate.candidateId)
      ? { ...candidate, candidateStatus: 'candidate', proposalStatus: 'recommended' }
      : candidate
  ))
  const conflictRepository = new MemoryRepository([conflictRecord])
  const conflictService = new TopologyService({
    repository: conflictRepository,
    auditLog: new MemoryAuditLog(),
  })
  const conflictPreview = await conflictService.reviewPreview('dv-review', {
    candidateIds: conflictIds,
  })
  assert.equal(conflictPreview.safeToApply, false)
  assert.ok(conflictPreview.ineligible.length === 0)
  assert.ok(conflictPreview.validationPreview.issues.some(({ issueCode }) => (
    issueCode === 'endpoint_conflict'
  )))
  await assert.rejects(
    conflictService.confirmSelectedCandidates('dv-review', 'admin-1', {
      candidateIds: conflictIds,
      reason: 'Konflik endpoint harus ditolak oleh safe batch gate.',
    }),
    (error) => error.code === 'topology_bulk_review_not_safe',
  )
})

test('bulk review never treats a pole as an inline cable anchor', async () => {
  const bundle = inlineReviewBundle()
  const initial = generateRelationArtifacts(bundle)
  assert.equal(initial.candidates.some(({ candidateType }) => candidateType === 'inline_device'), false)
  assert.equal(initial.candidates.some(({ candidateType, targetAssetId }) => (
    candidateType === 'cable_termination' && targetAssetId === 'T-021'
  )), false)
  assert.ok(initial.topologyDiagnostics.some(({ issueCode }) => (
    issueCode === 'cable_terminated_at_pole'
  )))
})

test('stale onboarding candidates are blocked until identity assignment and regeneration', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const record = applyArtifacts(baseRecord(bundle), initial)
  const onboardingId = (value) => value && !String(value).startsWith('onboarding-identity:')
    ? `onboarding-identity:${value}`
    : value
  const onboardingObject = (object) => ({
    ...object,
    assetId: null,
    canonicalAssetId: onboardingId(object.assetId),
    stableAssetId: null,
    onboardingIdentity: onboardingId(object.assetId),
    identityStatus: 'onboarding',
    identityResolutionStatus: 'onboarding_candidate',
  })
  record.topologyInputBundle = {
    ...record.topologyInputBundle,
    classifiedNodes: record.topologyInputBundle.classifiedNodes.map(onboardingObject),
    classifiedPaths: record.topologyInputBundle.classifiedPaths.map(onboardingObject),
  }
  record.topologyCandidates = record.topologyCandidates.map((candidate) => ({
    ...candidate,
    sourcePathAssetId: onboardingId(candidate.sourcePathAssetId),
    targetAssetId: onboardingId(candidate.targetAssetId),
    targetPathAssetId: onboardingId(candidate.targetPathAssetId),
  }))
  const repository = new MemoryRepository([record])
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
  })
  const candidate = (await service.getCandidates('dv-review')).items.find(({ proposalStatus }) => (
    proposalStatus === 'recommended'
  ))
  assert.equal(candidate.reviewEligibility.identityReady, false)
  assert.equal(candidate.reviewEligibility.confirmable, false)
  assert.equal(candidate.reviewEligibility.code, 'missing_stable_asset_id')

  const preview = await service.reviewPreview('dv-review', {
    candidateIds: [candidate.candidateId],
  })
  assert.equal(preview.safeToApply, false)
  assert.equal(preview.ineligible[0].reason, 'candidate_stable_asset_id_required')
  assert.equal(preview.diagnostics.recommendation.code, 'assign_identity_and_regenerate')

  await assert.rejects(
    service.confirmCandidate(candidate.candidateId, 'admin-1', {
      reason: 'Konfirmasi tidak boleh melewati identity gate.',
    }),
    (error) => error.code === 'topology_candidate_identity_required'
      && error.statusCode === 422,
  )
})

test('selected bulk confirmation confirms exactly the selected candidates atomically', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })
  const selected = initial.candidates
    .filter(({ candidateStatus }) => candidateStatus === 'candidate')
    .slice(0, 2)
  const selectedIds = new Set(selected.map(({ candidateId }) => candidateId))

  assert.equal(selected.length, 2)
  const result = await service.confirmSelectedCandidates('dv-review', 'admin-1', {
    candidateIds: [...selectedIds],
    reason: 'Dua koneksi terpilih sudah diverifikasi bersama.',
  })

  assert.equal(result.action, 'confirm_selected')
  assert.equal(result.affectedCount, 2)
  assert.deepEqual(new Set(result.candidateIds), selectedIds)
  const record = await repository.get('dv-review')
  assert.equal(
    record.topologyCandidates.filter(({ candidateId, candidateStatus }) => (
      selectedIds.has(candidateId) && candidateStatus === 'confirmed'
    )).length,
    2,
  )
  assert.equal(
    record.topologyCandidates.filter(({ candidateId, candidateStatus }) => (
      !selectedIds.has(candidateId) && candidateStatus === 'confirmed'
    )).length,
    0,
  )
  assert.deepEqual(
    auditLog.entries.map(({ event }) => event),
    ['topology.candidates_selected_bulk_confirmed'],
  )
})

test('bulk topology mutations reject a concurrent retry for the same dataset', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  let releaseFirst
  let firstAuditStarted
  const auditStarted = new Promise((resolve) => {
    firstAuditStarted = resolve
  })
  const firstAuditMayContinue = new Promise((resolve) => {
    releaseFirst = resolve
  })
  let paused = false
  const auditLog = new MemoryAuditLog({
    beforeRecord: async () => {
      if (paused) return
      paused = true
      firstAuditStarted()
      await firstAuditMayContinue
    },
  })
  const service = new TopologyService({ repository, auditLog })
  const first = service.confirmAllCandidates('dv-review', 'admin-1', {
    reason: 'Konfirmasi pertama sedang diproses.',
  })
  await auditStarted
  await assert.rejects(
    service.confirmAllCandidates('dv-review', 'admin-2', {
      reason: 'Percobaan ulang paralel.',
    }),
    (error) => error.code === 'topology_mutation_in_progress'
      && error.statusCode === 409,
  )
  releaseFirst()
  const result = await first
  assert.equal(result.affectedCount, 2)
  assert.equal(auditLog.entries.length, 1)
})

test('line label bulk action confirms only connections read from line names', async () => {
  const bundle = lineLabelReviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })

  const result = await service.confirmLineLabelCandidates('dv-review', 'admin-1', {
    reason: 'Nama endpoint garis diverifikasi dari sumber resmi.',
  })
  assert.equal(result.action, 'confirm_line_labels')
  assert.equal(result.affectedCount, 2)
  assert.equal(result.graph.edges.length, 1)
  assert.equal(result.confirmedDeviceEdgeCount, 1)
  assert.deepEqual(
    auditLog.entries.map(({ event }) => event),
    ['topology.line_label_connections_bulk_confirmed'],
  )
})

test('reject requires reason and rejected candidates never enter operational graph', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
  })
  const candidate = initial.candidates.find(({ candidateType }) => (
    candidateType === 'cable_termination'
  ))

  await assert.rejects(
    service.rejectCandidate(candidate.candidateId, 'admin-1', { reason: '' }),
    (error) => error.code === 'topology_review_reason_required',
  )
  const rejected = await service.rejectCandidate(candidate.candidateId, 'admin-1', {
    reason: 'Candidate salah secara semantik.',
  })
  assert.equal(rejected.candidate.candidateStatus, 'rejected')
  assert.equal(rejected.confirmedRelations.length, 0)
  assert.equal(rejected.graph.edges.length, 0)
  await assert.rejects(
    service.confirmCandidate(candidate.candidateId, 'admin-1', {
      reason: 'Tidak boleh langsung.',
    }),
    (error) => error.code === 'invalid_topology_state_transition',
  )
})

test('select-target confirms only an alternative from the same endpoint', async () => {
  const bundle = reviewBundle({
    secondNode: true,
  })
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
  })
  const candidates = initial.candidates.filter(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
  ))
  assert.equal(candidates.length, 2)

  const selected = await service.selectTarget(
    candidates[0].candidateId,
    'admin-1',
    {
      targetCandidateId: candidates[1].candidateId,
      reason: 'Target kedua sesuai label dan foto lapangan.',
    },
  )
  assert.equal(selected.candidate.candidateId, candidates[1].candidateId)
  assert.equal(selected.candidate.candidateStatus, 'confirmed')
  assert.deepEqual(
    selected.updatedCandidates.map(({ candidateStatus }) => candidateStatus).sort(),
    ['confirmed', 'rejected'],
  )
  const record = await repository.get('dv-review')
  assert.equal(
    record.topologyCandidates.find(({ candidateId }) => (
      candidateId === candidates[0].candidateId
  )).candidateStatus,
    'rejected',
  )
})

test('select-target retry replays one committed mutation receipt', async () => {
  const bundle = reviewBundle({ secondNode: true })
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })
  const candidates = initial.candidates.filter(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
  ))
  const input = {
    targetCandidateId: candidates[1].candidateId,
    reason: 'Target alternatif dikonfirmasi dari bukti lapangan.',
    idempotencyKey: 'select-target-retry-2026-08-04-001',
  }

  const first = await service.selectTarget(candidates[0].candidateId, 'admin-1', input)
  const retry = await service.selectTarget(candidates[0].candidateId, 'admin-1', input)

  assert.deepEqual(retry, first)
  assert.equal(auditLog.entries.length, 1)
  const record = await repository.get('dv-review')
  assert.equal(record.topologyMutationReceipts.length, 1)
  assert.equal(record.topologyCandidates.filter(({ candidateStatus }) => (
    candidateStatus === 'confirmed'
  )).length, 1)
})

test('regeneration reconciles decisions and records topology runs without deleting audit history', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })
  const candidate = initial.candidates.find(({ candidateType }) => (
    candidateType === 'cable_termination'
  ))
  await service.confirmCandidate(candidate.candidateId, 'admin-1', {
    reason: 'Confirmed before regeneration.',
  })
  const regenerated = await service.regenerate('dv-review', 'admin-1', {
    reason: 'Rule-set regeneration test.',
  })

  assert.equal(
    regenerated.topologyCandidates.find(({ candidateId }) => (
      candidateId === candidate.candidateId
    )).candidateStatus,
    'confirmed',
  )
  assert.equal(regenerated.confirmedRelations.length, 1)
  assert.equal(regenerated.topologyRuns.length, 1)
  const reviewProjection = await service.getCandidates('dv-review')
  assert.equal(reviewProjection.runs.length, 1)
  assert.ok(Array.isArray(reviewProjection.history))
  assert.ok(auditLog.entries.some(({ event }) => event === 'topology.candidates_regenerated'))
})

test('candidate projection returns only history for the current page', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const record = applyArtifacts(baseRecord(bundle), initial)
  const pageCandidate = initial.candidates
    .slice()
    .sort((left, right) => right.score - left.score || left.candidateId.localeCompare(right.candidateId))[0]
  record.topologyCandidateHistory = [
    { candidateId: 'historical-candidate', evidence: [{ explanation: 'large' }] },
    { candidateId: pageCandidate.candidateId, supersededAt: '2026-08-13T00:00:00.000Z' },
  ]
  const service = new TopologyService({
    repository: new MemoryRepository([record]),
    auditLog: new MemoryAuditLog(),
  })

  const projection = await service.getCandidates('dv-review', { limit: 1 })

  assert.deepEqual(projection.history, [{
    candidateId: pageCandidate.candidateId,
    supersededAt: '2026-08-13T00:00:00.000Z',
    supersededByRunId: null,
  }])
})

test('regeneration keeps the previous graph active when the new artifact is invalid', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const record = applyArtifacts(baseRecord(bundle), initial)
  const duplicatePath = structuredClone(bundle.classifiedPaths[0])
  const duplicateGeometry = structuredClone(bundle.geometries.find(({ geometryId }) => (
    geometryId === duplicatePath.geometryIds[0]
  )))
  duplicatePath.assetId = 'CBL-DUPLICATE'
  duplicatePath.sourceFeatureId = 'feature:CBL-DUPLICATE'
  duplicatePath.geometryIds = ['geometry:CBL-DUPLICATE']
  duplicateGeometry.geometryId = 'geometry:CBL-DUPLICATE'
  duplicateGeometry.sourceFeatureId = 'feature:CBL-DUPLICATE'
  record.topologyInputBundle.classifiedPaths.push(duplicatePath)
  record.topologyInputBundle.geometries.push(duplicateGeometry)

  const repository = new MemoryRepository([record])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })
  const before = await repository.get('dv-review')

  await assert.rejects(
    service.regenerate('dv-review', 'admin-1', {
      reason: 'Invalid artifact must not replace the active graph.',
    }),
    (error) => error.code === 'topology_artifact_validation_failed'
      && error.retryable === false
      && error.details.issueCodes.includes('duplicate_linework'),
  )

  const after = await repository.get('dv-review')
  assert.deepEqual(after.topologyGraph, before.topologyGraph)
  assert.deepEqual(after.topologyCandidates, before.topologyCandidates)
  assert.deepEqual(after.topologyRuns, before.topologyRuns)
  assert.equal(auditLog.entries.length, 0)
})

test('manual device relation is audited, materialized, and retained across regeneration', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle, {
    config: { autoConfirmExplicitMetadata: false },
  })
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const times = [
    '2026-08-03T01:00:00.000Z',
    '2026-08-03T02:00:00.000Z',
  ]
  const service = new TopologyService({
    repository,
    auditLog,
    config: { autoConfirmExplicitMetadata: false },
    clock: () => new Date(times.shift()),
  })

  const created = await service.createDeviceRelation('dv-review', 'admin-1', {
    sourceAssetId: 'CAM-01',
    targetAssetId: 'CAM-END',
    reason: 'Diverifikasi berdasarkan dokumentasi lapangan.',
  })

  assert.equal(created.relation.relationKind, 'device_edge')
  assert.equal(created.relation.provenance, 'manual_admin')
  assert.equal(created.relation.verifiedBy, 'admin-1')
  assert.equal(created.relation.auditEventId, 'audit-1')
  assert.equal(created.graph.edges.length, 1)
  assert.equal(created.summary.confirmedDeviceEdgeCount, 1)
  assert.equal(created.readiness.blockingReasons.includes('confirmed_graph_invalid'), false)
  assert.equal(
    (await repository.get('dv-review')).topologyInputBundle.explicitRelations.length,
    1,
  )
  assert.equal(auditLog.entries[0].event, 'topology.manual_device_relation_confirmed')

  const regenerated = await service.regenerate('dv-review', 'admin-1', {
    reason: 'Pastikan relasi manual tetap persisten.',
  })
  assert.equal(regenerated.confirmedRelations.length, 1)
  assert.equal(regenerated.confirmedRelations[0].provenance, 'manual_admin')
  assert.equal(regenerated.topologyGraph.edges.length, 1)

  await assert.rejects(
    service.createDeviceRelation('dv-review', 'admin-1', {
      sourceAssetId: 'CAM-END',
      targetAssetId: 'CAM-01',
      reason: 'Percobaan relasi duplikat.',
    }),
    (error) => error.code === 'topology_manual_relation_exists',
  )
})

test('ambiguous endpoint requires selecting exactly one target', async () => {
  const bundle = reviewBundle({ secondNode: true })
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
  })
  const candidates = initial.candidates.filter(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
  ))
  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].candidateStatus, 'ambiguous')

  await assert.rejects(
    service.confirmCandidate(candidates[0].candidateId, 'admin-1', {
      reason: 'Mencoba konfirmasi tanpa memilih target.',
    }),
    (error) => error.code === 'topology_candidate_target_selection_required',
  )

  const selected = await service.selectTarget(candidates[0].candidateId, 'admin-1', {
    targetCandidateId: candidates[0].candidateId,
    reason: 'Target pertama cocok dengan bukti lapangan.',
  })
  assert.equal(selected.candidate.candidateStatus, 'confirmed')
  assert.equal(
    selected.updatedCandidates.find(({ candidateId }) => (
      candidateId === candidates[1].candidateId
    )).candidateStatus,
    'rejected',
  )
})

test('manual relation preserves path and geometry evidence through the graph projection', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle, {
    config: { autoConfirmExplicitMetadata: false },
  })
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
    config: { autoConfirmExplicitMetadata: false },
  })

  const created = await service.createDeviceRelation('dv-review', 'admin-1', {
    sourceAssetId: 'CAM-01',
    targetAssetId: 'CAM-END',
    relationKind: 'service_link',
    pathAssetIds: ['CBL-01'],
    sourceGeometryIds: ['geometry:CBL-01'],
    evidenceRefs: ['document:network-plan:page-3'],
    reason: 'Diverifikasi dari dokumentasi jaringan resmi.',
  })

  assert.equal(created.relation.relationKind, 'service_link')
  assert.deepEqual(created.relation.pathAssetIds, ['CBL-01'])
  assert.deepEqual(created.relation.sourceGeometryIds, ['geometry:CBL-01'])
  assert.deepEqual(created.relation.evidenceRefs, ['document:network-plan:page-3'])
  assert.equal(created.graph.edges[0].relationKind, 'service_link')
  assert.deepEqual(created.graph.edges[0].pathAssetIds, ['CBL-01'])
  await assert.rejects(
    service.createDeviceRelation('dv-review', 'admin-1', {
      sourceAssetId: 'CAM-01',
      targetAssetId: 'CAM-END',
      pathAssetIds: ['CBL-MISSING'],
      reason: 'Referensi path tidak valid.',
    }),
    (error) => error.code === 'topology_manual_relation_path_not_found',
  )
})

test('manual relation retry does not create a duplicate relation or audit event', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle, {
    config: { autoConfirmExplicitMetadata: false },
  })
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({
    repository,
    auditLog,
    config: { autoConfirmExplicitMetadata: false },
  })
  const input = {
    sourceAssetId: 'CAM-01',
    targetAssetId: 'CAM-END',
    reason: 'Relasi diverifikasi oleh administrator lapangan.',
    idempotencyKey: 'manual-relation-retry-2026-08-04-001',
  }

  const first = await service.createDeviceRelation('dv-review', 'admin-1', input)
  const retry = await service.createDeviceRelation('dv-review', 'admin-1', input)

  assert.deepEqual(retry, first)
  assert.equal(auditLog.entries.length, 1)
  const record = await repository.get('dv-review')
  assert.equal(record.topologyInputBundle.explicitRelations.length, 1)
  assert.equal(record.confirmedRelations.filter(({ provenance }) => (
    provenance === 'manual_admin'
  )).length, 1)
  assert.equal(record.topologyMutationReceipts.length, 1)
})

test('concurrent manual relation retry audits only the lock winner', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle, {
    config: { autoConfirmExplicitMetadata: false },
  })
  const repository = new SerializedMemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  let releaseAudit
  let firstAuditStartedResolve
  const firstAuditStarted = new Promise((resolve) => {
    firstAuditStartedResolve = resolve
  })
  const auditLog = new MemoryAuditLog({
    beforeRecord: async ({ index }) => {
      if (index !== 1) return
      firstAuditStartedResolve()
      await new Promise((resolve) => {
        releaseAudit = resolve
      })
    },
  })
  const firstService = new TopologyService({
    repository,
    auditLog,
    config: { autoConfirmExplicitMetadata: false },
  })
  const secondService = new TopologyService({
    repository,
    auditLog,
    config: { autoConfirmExplicitMetadata: false },
  })
  const input = {
    sourceAssetId: 'CAM-01',
    targetAssetId: 'CAM-END',
    reason: 'Concurrent retry dikonfirmasi oleh administrator.',
    idempotencyKey: 'manual-relation-concurrent-2026-08-04-001',
  }

  const firstPromise = firstService.createDeviceRelation('dv-review', 'admin-1', input)
  await firstAuditStarted
  const secondPromise = secondService.createDeviceRelation('dv-review', 'admin-1', input)
  releaseAudit()
  const [first, second] = await Promise.all([firstPromise, secondPromise])

  assert.deepEqual(second, first)
  assert.equal(auditLog.entries.length, 1)
  const record = await repository.get('dv-review')
  assert.equal(record.topologyInputBundle.explicitRelations.length, 1)
  assert.equal(record.topologyMutationReceipts.length, 1)
})

test('revoke retry replays after the revoked relation leaves the active relation set', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })
  const startCandidate = initial.candidates.find(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
  ))
  const endCandidate = initial.candidates.find(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:end'
  ))
  await service.confirmCandidate(startCandidate.candidateId, 'admin-1', {
    reason: 'Endpoint awal telah diverifikasi.',
  })
  const confirmed = await service.confirmCandidate(endCandidate.candidateId, 'admin-1', {
    reason: 'Endpoint akhir telah diverifikasi.',
  })
  const relationId = confirmed.confirmedRelations.find(({ candidateId }) => (
    candidateId === startCandidate.candidateId
  )).relationId
  const input = {
    reason: 'Relasi dibatalkan setelah verifikasi lapangan.',
    idempotencyKey: 'revoke-retry-2026-08-04-001',
  }

  const first = await service.revokeRelation(relationId, 'admin-2', input)
  const retry = await service.revokeRelation(relationId, 'admin-2', input)

  assert.deepEqual(retry, first)
  assert.equal(auditLog.entries.filter(({ event }) => event === 'topology.relation_revoked').length, 1)
  const record = await repository.get('dv-review')
  assert.equal(record.topologyMutationReceipts.length, 1)
  assert.equal(record.confirmedRelations.some(({ relationId: id }) => id === relationId), false)
})

test('bulk confirm and revoke retries commit one audit event per action', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })

  const confirmInput = {
    reason: 'Kandidat recommended disetujui setelah review bersama.',
    idempotencyKey: 'bulk-confirm-retry-2026-08-04-001',
  }
  const firstConfirm = await service.confirmAllCandidates('dv-review', 'admin-1', confirmInput)
  const retryConfirm = await service.confirmAllCandidates('dv-review', 'admin-1', confirmInput)
  assert.deepEqual(retryConfirm, firstConfirm)

  const revokeInput = {
    reason: 'Seluruh relasi perlu ditinjau ulang oleh operator.',
    idempotencyKey: 'bulk-revoke-retry-2026-08-04-001',
  }
  const firstRevoke = await service.revokeAllRelations('dv-review', 'admin-2', revokeInput)
  const retryRevoke = await service.revokeAllRelations('dv-review', 'admin-2', revokeInput)
  assert.deepEqual(retryRevoke, firstRevoke)

  assert.deepEqual(auditLog.entries.map(({ event }) => event), [
    'topology.candidates_bulk_confirmed',
    'topology.relations_bulk_revoked',
  ])
  assert.equal((await repository.get('dv-review')).topologyMutationReceipts.length, 2)
})

test('authoritative trace follows confirmed edges, returns geometry evidence, and protects revision', async () => {
  const repository = new MemoryRepository([traceRecord()])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })
  const graphProjection = await service.getGraph('dv-trace')
  const graphRevision = graphProjection.graph.graphRevision

  const destinations = await service.trace('dv-trace', {
    sourceAssetId: 'asset-a',
    graphRevision,
  }, 'viewer-1')
  assert.equal(destinations.status, 'destinations')
  assert.deepEqual(destinations.destinations, [
    { assetId: 'asset-b', distance: 1 },
    { assetId: 'asset-c', distance: 2 },
  ])

  const scopedDestinations = await service.trace('dv-trace', {
    sourceAssetId: 'asset-a',
    graphRevision,
    scopeAssetIds: ['asset-a', 'asset-b'],
  })
  assert.deepEqual(scopedDestinations.destinations, [
    { assetId: 'asset-b', distance: 1 },
  ])

  const result = await service.trace('dv-trace', {
    sourceAssetId: 'asset-a',
    targetAssetId: 'asset-c',
    graphRevision,
    direction: 'both',
  }, 'viewer-1')
  assert.equal(result.status, 'found')
  assert.deepEqual(result.nodeIds, ['asset-a', 'asset-b', 'asset-c'])
  assert.equal(result.hopCount, 2)
  assert.equal(result.totalLengthMeters, 30)
  assert.deepEqual(result.edges.map(({ edgeId, sourceGeometryIds, pathAssetIds }) => ({
    edgeId,
    sourceGeometryIds,
    pathAssetIds,
  })), [
    {
      edgeId: 'edge-a-b',
      sourceGeometryIds: ['geometry-cable-1'],
      pathAssetIds: ['cable-1'],
    },
    {
      edgeId: 'edge-b-c',
      sourceGeometryIds: ['geometry-cable-2'],
      pathAssetIds: ['cable-2'],
    },
  ])
  assert.equal(result.graphRevision, graphRevision)

  const candidateResult = await service.trace('dv-trace', {
    sourceAssetId: 'asset-a',
    targetAssetId: 'asset-d',
    graphRevision,
  })
  assert.equal(candidateResult.status, 'unreachable')
  assert.equal(candidateResult.reason, 'candidate_pending_review')

  const invalidSource = await service.trace('dv-trace', {
    sourceAssetId: 'not-a-node',
    graphRevision,
  })
  assert.equal(invalidSource.status, 'invalid-source')

  await assert.rejects(
    service.trace('dv-trace', {
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-c',
      graphRevision: 'topology-graph:stale',
    }),
    (error) => error.code === 'topology_graph_stale'
      && error.details.currentGraphRevision === graphRevision,
  )
  assert.ok(auditLog.entries.some(({ event, outcome }) => (
    event === 'topology.trace_requested' && outcome === 'found'
  )))
})

test('authoritative trace stops when the confirmed graph has blocking validation errors', async () => {
  const record = traceRecord()
  record.topologyValidation = {
    summary: { errors: 1, warnings: 0 },
    issues: [{ severity: 'error', issueCode: 'duplicate_confirmed_edge' }],
  }
  const service = new TopologyService({
    repository: new MemoryRepository([record]),
    auditLog: new MemoryAuditLog(),
  })
  const graph = await service.getGraph('dv-trace')

  await assert.rejects(
    service.trace('dv-trace', {
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-c',
      graphRevision: graph.graph.graphRevision,
    }),
    (error) => error.code === 'topology_graph_invalid'
      && error.details.validationErrorCount === 1,
  )
})

test('reviewed path is traceable and revoke invalidates the next graph revision', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
  })
  const startCandidate = initial.candidates.find(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
  ))
  const endCandidate = initial.candidates.find(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:end'
  ))

  await service.confirmCandidate(startCandidate.candidateId, 'admin-1', {
    reason: 'Endpoint awal diverifikasi.',
  })
  await service.confirmCandidate(endCandidate.candidateId, 'admin-1', {
    reason: 'Endpoint akhir diverifikasi.',
  })
  const beforeRevoke = await service.getGraph('dv-review')
  const traced = await service.trace('dv-review', {
    sourceAssetId: 'CAM-01',
    targetAssetId: 'CAM-END',
    graphRevision: beforeRevoke.graph.graphRevision,
  })
  assert.equal(traced.status, 'found')
  assert.equal(traced.hopCount, 1)
  assert.deepEqual(traced.edges[0].sourceGeometryIds, ['geometry:CBL-01'])

  const relation = (await repository.get('dv-review')).confirmedRelations.find(({ candidateId }) => (
    candidateId === startCandidate.candidateId
  ))
  await service.revokeRelation(relation.relationId, 'admin-2', {
    reason: 'Verifikasi lapangan membatalkan jalur.',
  })
  const afterRevoke = await service.getGraph('dv-review')
  assert.notEqual(afterRevoke.graph.graphRevision, beforeRevoke.graph.graphRevision)
  await assert.rejects(
    service.trace('dv-review', {
      sourceAssetId: 'CAM-01',
      targetAssetId: 'CAM-END',
      graphRevision: beforeRevoke.graph.graphRevision,
    }),
    (error) => error.code === 'topology_graph_stale',
  )
  const unavailable = await service.trace('dv-review', {
    sourceAssetId: 'CAM-01',
    targetAssetId: 'CAM-END',
    graphRevision: afterRevoke.graph.graphRevision,
  })
  assert.equal(unavailable.status, 'unreachable')
})

function reviewBundle({ secondNode = false } = {}) {
  const nodes = [
    nodeRecord('CAM-01', [110.00001, -7]),
    nodeRecord('CAM-END', [110.001, -7]),
    ...(secondNode ? [nodeRecord('CAM-02', [109.99999, -7])] : []),
  ]
  const path = pathRecord('CBL-01', [[110, -7], [110.001, -7]])
  return {
    datasetVersion: {
      id: 'dv-review',
      sourceChecksum: `sha256:${'c'.repeat(64)}`,
    },
    site: 'site-1',
    classifiedNodes: nodes.map(({ object }) => object),
    classifiedPaths: [path.object],
    geometries: [...nodes.map(({ geometry }) => geometry), path.geometry],
    explicitRelations: [],
    topologyPolicy: { requireJbTermination: false },
    semanticRuleSetVersion: 'semantic-classifier/1.0.0',
    topologyRuleSetVersion: null,
  }
}

function inlineReviewBundle() {
  const node = {
    assetId: 'T-021',
    sourceFeatureId: 'feature:T-021',
    siteId: 'site-1',
    objectRole: 'device_node',
    networkFamily: 'fiber_optic',
    assetType: 'Tiang',
    category: 'infrastructure',
    classificationStatus: 'classified',
    classificationEvidence: [],
    geometryIds: ['geometry:T-021'],
  }
  const nodeGeometry = {
    geometryId: 'geometry:T-021',
    datasetVersionId: 'dv-inline-review',
    sourceFeatureId: 'feature:T-021',
    geometryType: 'Point',
    coordinates: [110.00005, -7],
    valid: true,
  }
  const paths = [
    {
      assetId: 'FO-JB-011',
      sourceFeatureId: 'feature:FO-JB-011',
      geometryId: 'geometry:FO-JB-011',
      coordinates: [[110, -7], [110.00005, -7], [110.001, -7]],
    },
    {
      assetId: 'FO-JB-011.1',
      sourceFeatureId: 'feature:FO-JB-011.1',
      geometryId: 'geometry:FO-JB-011.1',
      coordinates: [[110.00005, -7.001], [110.00005, -7], [110.00005, -6.999]],
    },
  ]
  return {
    datasetVersion: {
      id: 'dv-inline-review',
      sourceChecksum: `sha256:${'d'.repeat(64)}`,
    },
    site: 'site-1',
    classifiedNodes: [node],
    classifiedPaths: paths.map((path) => ({
      assetId: path.assetId,
      sourceFeatureId: path.sourceFeatureId,
      siteId: 'site-1',
      objectRole: 'cable_path',
      networkFamily: 'fiber_optic',
      assetType: 'Fiber Optic',
      category: 'fiber_optic',
      classificationStatus: 'classified',
      classificationEvidence: [],
      geometryIds: [path.geometryId],
    })),
    geometries: [
      nodeGeometry,
      ...paths.map((path) => ({
        geometryId: path.geometryId,
        datasetVersionId: 'dv-inline-review',
        sourceFeatureId: path.sourceFeatureId,
        geometryType: 'LineString',
        coordinates: path.coordinates,
        valid: true,
      })),
    ],
    explicitRelations: [],
    semanticRuleSetVersion: 'semantic-classifier/1.0.0',
    topologyRuleSetVersion: null,
  }
}

function lineLabelReviewBundle() {
  const bundle = reviewBundle()
  bundle.classifiedNodes[0].sourceName = 'Cam-01'
  bundle.classifiedNodes[0].sourceFolderPath = '/site/CCTV'
  bundle.classifiedNodes[1].sourceName = 'Cam-END'
  bundle.classifiedNodes[1].sourceFolderPath = '/site/CCTV'
  bundle.classifiedPaths[0].sourceName = 'Jalur Cam-01 - Cam-END'
  bundle.classifiedPaths[0].sourceFolderPath = '/site/Cable'
  return bundle
}

function traceRecord() {
  const nodes = ['asset-a', 'asset-b', 'asset-c', 'asset-d'].map((id) => ({
    id,
    assetId: id,
    canonicalAssetId: id,
    stableAssetId: id,
    identityStatus: 'stable',
    objectRole: 'device_node',
    networkFamily: 'cctv',
  }))
  return {
    datasetVersion: {
      id: 'dv-trace',
      datasetId: 'dataset-trace',
      branchId: 'site-trace',
      publicationStatus: 'published',
    },
    assets: nodes,
    topologyGraph: {
      datasetVersionId: 'dv-trace',
      nodes,
      edges: [
        {
          id: 'edge-a-b',
          sourceAssetId: 'asset-a',
          targetAssetId: 'asset-b',
          sourceNodeId: 'asset-a',
          targetNodeId: 'asset-b',
          pathAssetIds: ['cable-1'],
          sourceGeometryIds: ['geometry-cable-1'],
          relationType: 'connected-via-path',
          verificationStatus: 'confirmed',
          relationStatus: 'confirmed',
          lengthMeters: 10,
        },
        {
          id: 'edge-b-c',
          sourceAssetId: 'asset-b',
          targetAssetId: 'asset-c',
          sourceNodeId: 'asset-b',
          targetNodeId: 'asset-c',
          pathAssetIds: ['cable-2'],
          sourceGeometryIds: ['geometry-cable-2'],
          relationType: 'connected-via-path',
          verificationStatus: 'confirmed',
          relationStatus: 'confirmed',
          lengthMeters: 20,
        },
        {
          id: 'candidate-edge-a-d',
          sourceAssetId: 'asset-a',
          targetAssetId: 'asset-d',
          candidateStatus: 'candidate',
        },
      ],
      components: [],
      degreeByNode: {},
      isolatedNodeIds: [],
    },
    topologyCandidates: [{
      candidateId: 'candidate-a-d',
      sourcePathAssetId: 'asset-a',
      targetAssetId: 'asset-d',
      candidateStatus: 'candidate',
    }],
    topologyValidation: {
      summary: { errors: 0, warnings: 1 },
      issues: [{ severity: 'warning', issueCode: 'isolated_device' }],
    },
    topologyGeneratedAt: '2026-08-03T00:00:00.000Z',
    topologyReadiness: {
      topologyReadiness: 'not_ready',
      blockingReasons: ['held_out_accuracy_not_proven'],
    },
  }
}

function nodeRecord(assetId, coordinates) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId: 'site-1',
      objectRole: 'device_node',
      networkFamily: 'cctv',
      assetType: 'CCTV Camera',
      category: 'CCTV',
      classificationStatus: 'classified',
      classificationEvidence: [],
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId: 'dv-review',
      sourceFeatureId,
      geometryType: 'Point',
      coordinates,
      valid: true,
    },
  }
}

function pathRecord(assetId, coordinates) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId: 'site-1',
      objectRole: 'cable_path',
      networkFamily: 'cctv',
      assetType: 'CCTV Cable',
      category: 'CCTV Cable',
      classificationStatus: 'classified',
      classificationEvidence: [],
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId: 'dv-review',
      sourceFeatureId,
      geometryType: 'LineString',
      coordinates,
      valid: true,
    },
  }
}

function baseRecord(bundle) {
  return {
    datasetVersion: {
      id: bundle.datasetVersion.id,
      datasetId: 'dataset-1',
      branchId: 'site-1',
      summary: {},
    },
    topologyInputBundle: structuredClone(bundle),
    relations: [],
    readiness: {},
  }
}

class MemoryRepository {
  constructor(records) {
    this.records = new Map(records.map((record) => [record.datasetVersion.id, record]))
  }

  async get(id) {
    const record = this.records.get(id)
    if (!record) throw new Error(`missing record ${id}`)
    return structuredClone(record)
  }

  async list() {
    return [...this.records.values()].map((record) => structuredClone(record))
  }

  async update(id, updater) {
    const current = await this.get(id)
    const next = await updater(current)
    this.records.set(id, structuredClone(next))
    return structuredClone(next)
  }
}

class SerializedMemoryRepository extends MemoryRepository {
  constructor(records) {
    super(records)
    this.lockTailById = new Map()
  }

  async update(id, updater, { expectedRevision } = {}) {
    const previous = this.lockTailById.get(id) ?? Promise.resolve()
    let release
    const currentLock = new Promise((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => currentLock)
    this.lockTailById.set(id, queued)
    await previous
    try {
      const current = await this.get(id)
      const currentRevision = Number.isInteger(current.recordRevision)
        ? current.recordRevision
        : 0
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw Object.assign(new Error('stale record'), {
          code: 'dataset_version_stale_revision',
          statusCode: 409,
        })
      }
      const next = typeof updater === 'function'
        ? await updater(current)
        : { ...current, ...updater }
      const normalized = {
        ...next,
        recordRevision: currentRevision + 1,
      }
      this.records.set(id, structuredClone(normalized))
      return structuredClone(normalized)
    } finally {
      release()
      if (this.lockTailById.get(id) === queued) this.lockTailById.delete(id)
    }
  }
}

class MemoryAuditLog {
  constructor({ beforeRecord = null } = {}) {
    this.entries = []
    this.beforeRecord = beforeRecord
  }

  async record(event, input) {
    const entry = {
      id: `audit-${this.entries.length + 1}`,
      event,
      ...structuredClone(input),
    }
    await this.beforeRecord?.({ index: this.entries.length + 1, event })
    this.entries.push(entry)
    return entry
  }
}
