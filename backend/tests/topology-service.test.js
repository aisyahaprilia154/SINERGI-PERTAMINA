import assert from 'node:assert/strict'
import test from 'node:test'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'
import { applyArtifacts, TopologyService } from '../src/topology/topology-service.js'

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
  })
  assert.equal(firstConfirmation.candidate.candidateStatus, 'confirmed')
  assert.equal(firstConfirmation.confirmedRelations.length, 1)
  assert.equal(firstConfirmation.graph.edges.length, 0)
  assert.equal(firstConfirmation.confirmedRelations[0].relationKind, 'path_attachment')
  const confirmed = await service.confirmCandidate(endCandidate.candidateId, 'admin-1', {
    reason: 'Endpoint kedua telah diverifikasi pada peta sumber.',
  })
  assert.equal(confirmed.candidate.candidateStatus, 'confirmed')
  assert.equal(confirmed.confirmedRelations.length, 2)
  assert.equal(confirmed.graph.edges.length, 1)
  assert.equal(confirmed.confirmedRelations.every(({ relationKind }) => (
    relationKind === 'path_attachment'
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
      'topology.candidate_confirmed',
      'topology.candidate_confirmed',
      'topology.relation_revoked',
      'topology.candidate_confirmed',
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

  const result = await service.confirmAllCandidates('dv-review', 'admin-1')
  const record = await repository.get('dv-review')
  assert.equal(result.affectedCount, 1)
  assert.equal(
    record.topologyCandidates.filter(({ candidateStatus }) => (
      candidateStatus === 'ambiguous'
    )).length,
    2,
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
    candidateType === 'endpoint_device'
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
  const record = await repository.get('dv-review')
  assert.equal(
    record.topologyCandidates.find(({ candidateId }) => (
      candidateId === candidates[0].candidateId
    )).candidateStatus,
    'rejected',
  )
})

test('regeneration reconciles decisions and records topology runs without deleting audit history', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new MemoryRepository([applyArtifacts(baseRecord(bundle), initial)])
  const auditLog = new MemoryAuditLog()
  const service = new TopologyService({ repository, auditLog })
  const candidate = initial.candidates.find(({ candidateType }) => (
    candidateType === 'endpoint_device'
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
    semanticRuleSetVersion: 'semantic-classifier/1.0.0',
    topologyRuleSetVersion: null,
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

class MemoryAuditLog {
  constructor() {
    this.entries = []
  }

  async record(event, input) {
    const entry = {
      id: `audit-${this.entries.length + 1}`,
      event,
      ...structuredClone(input),
    }
    this.entries.push(entry)
    return entry
  }
}
