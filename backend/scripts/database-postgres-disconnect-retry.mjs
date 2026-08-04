import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createConfig } from '../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  POSTGRES_RUNTIME_REQUIRED_COLUMNS,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'
import { PostgresAuditLog } from '../src/storage/postgres-audit-log.js'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'
import {
  applyArtifacts,
  TopologyService,
} from '../src/topology/topology-service.js'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'
import { createBaselineTopologyBundle } from '../tests/fixtures/topology-baseline-fixture.js'

const GENERATED_AT = '2026-08-04T07:00:00.000Z'
const PROJECTION_DELETE_ORDER = [
  'graph_edges',
  'graph_nodes',
  'graph_revisions',
  'confirmed_relations',
  'topology_candidates',
  'classified_objects',
  'source_geometries',
  'source_features',
]

/**
 * Simulates a database connection drop immediately before COMMIT, then
 * retries the same topology mutation with one idempotency key. The raw pool
 * remains available for the retry and for evidence/cleanup queries.
 */
export async function runPostgresDisconnectRetryCheck({
  connectionString = createConfig(process.env).database.databaseUrl,
  poolFactory = createPostgresPool,
} = {}) {
  const rawPool = await poolFactory({ connectionString })
  const faultPool = createCommitDisconnectingPool(rawPool)
  const repository = new PostgresDatasetVersionRepository(faultPool)
  const auditLog = new PostgresAuditLog(faultPool)
  const config = createConfig(process.env, {
    storageMode: 'postgres',
    database: { databaseUrl: connectionString },
  })
  const topologyService = new TopologyService({
    repository,
    auditLog,
    config: config.topology,
  })
  const datasetVersionId = `live-db-disconnect-${randomUUID().replaceAll('-', '')}`
  const idempotencyKey = `live-db-disconnect-retry-${randomUUID().replaceAll('-', '')}`
  let created = false
  let cleanupCompleted = false
  try {
    const schema = await verifyOperationalSchema(rawPool, {
      requiredColumns: POSTGRES_RUNTIME_REQUIRED_COLUMNS,
    })
    const bundle = createReplayBundle(datasetVersionId)
    const initialArtifacts = generateRelationArtifacts(bundle, {
      generatedAt: GENERATED_AT,
    })
    const initialRecord = applyArtifacts({
      datasetVersion: {
        id: datasetVersionId,
        datasetId: 'dataset-live-db-disconnect',
        branchId: 'site-disconnect',
        versionName: datasetVersionId,
        sourceChecksum: bundle.datasetVersion.sourceChecksum,
        validationStatus: 'valid',
        publicationStatus: 'unpublished',
        status: 'valid',
      },
      validation: {
        status: 'valid',
        canActivate: true,
        summary: { errors: 0 },
      },
      topologyInputBundle: bundle,
      sourceFeatures: [],
      sourceGeometries: [],
      classifiedObjects: [],
      relations: [],
      readiness: {},
    }, initialArtifacts)
    await repository.create(initialRecord)
    created = true

    const preview = await topologyService.getCandidates(datasetVersionId)
    const candidate = preview.items.find(({ candidateStatus }) => (
      candidateStatus === 'candidate'
    ))
    assert.ok(candidate, 'Fixture disconnect tidak memiliki candidate reviewable.')
    const reviewInput = {
      reason: 'PostgreSQL disconnect retry probe.',
      expectedGraphRevision: preview.graphRevision,
      expectedCandidateRevision: preview.candidateRevision,
      idempotencyKey,
    }
    const actorId = 'live-db-disconnect-admin'

    faultPool.armCommitDisconnect()
    const firstOutcome = await captureOutcome(() => (
      topologyService.confirmCandidate(candidate.candidateId, actorId, reviewInput)
    ))
    if (!faultPool.wasCommitDisconnectInjected()) {
      throw probeError(
        'database_disconnect_fault_not_injected',
        'Fault injection tidak mencapai COMMIT transaksi review.',
      )
    }

    const retryResponse = await topologyService.confirmCandidate(
      candidate.candidateId,
      actorId,
      reviewInput,
    )
    const replayResponse = await topologyService.confirmCandidate(
      candidate.candidateId,
      actorId,
      reviewInput,
    )
    assert.deepEqual(replayResponse, retryResponse)

    const persisted = await repository.get(datasetVersionId)
    const persistedCandidate = persisted.topologyCandidates.find(({ candidateId }) => (
      candidateId === candidate.candidateId
    ))
    assert.equal(persistedCandidate?.candidateStatus, 'confirmed')
    const initialRelationIds = new Set(
      initialArtifacts.confirmedRelations.map(({ relationId }) => relationId),
    )
    const finalConfirmedRelations = (persisted.confirmedRelations ?? [])
      .filter(({ verificationStatus }) => verificationStatus === 'confirmed')
    const finalRelationIds = finalConfirmedRelations.map(({ relationId }) => relationId)
    const newRelationIds = finalRelationIds.filter((relationId) => (
      !initialRelationIds.has(relationId)
    ))
    if (newRelationIds.length !== 1 || new Set(finalRelationIds).size !== finalRelationIds.length) {
      throw probeError(
        'database_disconnect_duplicate_relation',
        'Retry setelah database disconnect menghasilkan relation ganda atau jumlah relation baru tidak tepat.',
        { finalRelationIds, newRelationIds },
      )
    }

    const counts = await rawPool.query(
      `SELECT
         (SELECT count(*)::int FROM audit_events WHERE dataset_version_id = $1)
           AS audit_events,
         (SELECT count(*)::int FROM confirmed_relations
            WHERE dataset_version_id = $1 AND verification_status = 'confirmed')
           AS confirmed_relations,
         (SELECT count(DISTINCT relation_id)::int FROM confirmed_relations
            WHERE dataset_version_id = $1 AND verification_status = 'confirmed')
           AS unique_confirmed_relations,
         (SELECT count(*)::int FROM graph_revisions
            WHERE dataset_version_id = $1 AND status = 'validated')
           AS validated_graph_revisions`,
      [datasetVersionId],
    )
    const countRow = counts.rows[0]
    const evidenceCounts = {
      auditEventCount: Number(countRow.audit_events),
      confirmedRelationCount: Number(countRow.confirmed_relations),
      uniqueConfirmedRelationCount: Number(countRow.unique_confirmed_relations),
      validatedGraphRevisionCount: Number(countRow.validated_graph_revisions),
    }
    if (evidenceCounts.auditEventCount !== 1
      || evidenceCounts.confirmedRelationCount !== finalConfirmedRelations.length
      || evidenceCounts.uniqueConfirmedRelationCount !== finalConfirmedRelations.length
      || evidenceCounts.validatedGraphRevisionCount !== 1) {
      throw probeError(
        'database_disconnect_evidence_mismatch',
        'Projection evidence setelah database disconnect retry tidak konsisten.',
        evidenceCounts,
      )
    }

    const cleanup = await cleanupDataset(rawPool, datasetVersionId)
    cleanupCompleted = true
    return {
      result: 'passed',
      schema,
      datasetVersionId,
      candidateId: candidate.candidateId,
      firstOutcome,
      faultInjected: faultPool.wasCommitDisconnectInjected(),
      retryResponseRecordRevision: retryResponse.recordRevision,
      replayMatchesRetry: true,
      newRelationCount: newRelationIds.length,
      ...evidenceCounts,
      cleanup,
      jsonPrimaryUsed: false,
    }
  } finally {
    if (created && !cleanupCompleted) {
      await cleanupDataset(rawPool, datasetVersionId).catch(() => {})
    }
    await closePostgresPool(rawPool)
  }
}

function createCommitDisconnectingPool(pool) {
  let armed = false
  let injected = false
  return {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect()
      let released = false
      client.once?.('error', () => {})
      return {
        async query(...args) {
          const queryText = typeof args[0] === 'string'
            ? args[0]
            : args[0]?.text
          if (armed && !injected && String(queryText ?? '').trim().toUpperCase() === 'COMMIT') {
            injected = true
            const stream = client.connection?.stream
            if (!stream || typeof stream.destroy !== 'function') {
              throw probeError(
                'database_disconnect_stream_unavailable',
                'Client PostgreSQL tidak menyediakan stream untuk fault injection.',
              )
            }
            stream.destroy()
          }
          return client.query(...args)
        },
        release(destroy = false) {
          if (released) return
          released = true
          return client.release(destroy)
        },
      }
    },
    armCommitDisconnect() {
      armed = true
    },
    wasCommitDisconnectInjected() {
      return injected
    },
  }
}

function createReplayBundle(datasetVersionId) {
  const bundle = structuredClone(createBaselineTopologyBundle())
  bundle.datasetVersion.id = datasetVersionId
  bundle.classifiedNodes = bundle.classifiedNodes.map((node) => structuredClone(node))
  bundle.classifiedPaths = bundle.classifiedPaths.map((pathObject) => structuredClone(pathObject))
  bundle.geometries = bundle.geometries.map((geometry) => ({
    ...geometry,
    datasetVersionId,
  }))
  bundle.explicitRelations = bundle.explicitRelations.map((relation) => ({
    ...relation,
    datasetVersionId,
  }))
  return bundle
}

async function captureOutcome(operation) {
  try {
    const response = await operation()
    return { status: 'succeeded', recordRevision: response.recordRevision ?? null }
  } catch (error) {
    return {
      status: 'failed',
      code: error?.code ?? error?.name ?? 'unknown_failure',
      message: String(error?.message ?? error).slice(0, 240),
    }
  }
}

async function cleanupDataset(pool, datasetVersionId) {
  const auditResult = await pool.query(
    'SELECT count(*)::int AS count FROM audit_events WHERE dataset_version_id = $1',
    [datasetVersionId],
  )
  const auditEventCount = Number(auditResult.rows[0]?.count ?? 0)
  if (auditEventCount > 0) {
    return {
      mode: 'retained_append_only_audit',
      auditEventCount,
      datasetVersionRetained: true,
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM topology_jobs WHERE dataset_version_id = $1', [
      datasetVersionId,
    ])
    for (const table of PROJECTION_DELETE_ORDER) {
      await client.query(`DELETE FROM ${table} WHERE dataset_version_id = $1`, [
        datasetVersionId,
      ])
    }
    await client.query('DELETE FROM dataset_versions WHERE id = $1', [datasetVersionId])
    await client.query('COMMIT')
    return {
      mode: 'deleted_without_audit',
      auditEventCount: 0,
      datasetVersionRetained: false,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release?.()
  }
}

function probeError(code, message, details = undefined) {
  const error = new Error(message)
  error.code = code
  if (details) error.details = details
  return error
}

async function main() {
  const config = createConfig(process.env, { storageMode: 'postgres' })
  const result = await runPostgresDisconnectRetryCheck({
    connectionString: config.database.databaseUrl,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[database-postgres-disconnect-retry] ${error.code ?? 'failed'}: ${error.message}\n`)
    if (error.details) process.stderr.write(`${JSON.stringify(error.details)}\n`)
    process.exitCode = 1
  })
}
