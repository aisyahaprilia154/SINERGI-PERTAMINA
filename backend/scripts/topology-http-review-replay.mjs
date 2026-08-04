import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { createDatasetVersionRepositoryRuntime } from '../src/database/repository-runtime.js'
import { PostgresDurableJobRepository } from '../src/jobs/postgres-durable-job-repository.js'
import { DurableJobQueue } from '../src/jobs/durable-job-queue.js'
import { TokenAuthenticator } from '../src/security/authorization.js'
import { PostgresAuditLog } from '../src/storage/postgres-audit-log.js'
import { applyArtifacts, TopologyService } from '../src/topology/topology-service.js'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'
import { createBaselineTopologyBundle } from '../tests/fixtures/topology-baseline-fixture.js'

const ADMIN_TOKEN = 'live-http-replay-admin-token'
const GENERATED_AT = '2026-08-04T06:00:00.000Z'
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

export async function runLiveHttpReviewReplay({
  connectionString = process.env.SINERGI_DATABASE_URL,
  runtimeFactory = createDatasetVersionRepositoryRuntime,
  appFactory = createApp,
} = {}) {
  if (!connectionString) {
    throw new Error('SINERGI_DATABASE_URL wajib tersedia untuk live HTTP replay.')
  }

  const datasetVersionId = `live-http-review-${randomUUID().replaceAll('-', '')}`
  const config = createConfig(process.env, {
    storageMode: 'postgres',
    dataRoot: path.resolve(process.cwd(), '.data'),
    database: { databaseUrl: connectionString },
    authTokens: {
      [ADMIN_TOKEN]: { id: 'live-http-review-admin', role: 'Administrator' },
    },
  })
  const runtime = await runtimeFactory({ config })
  if (runtime.mode !== 'postgres') {
    await runtime.close?.()
    throw new Error('Live HTTP replay membutuhkan storage mode postgres.')
  }

  const repository = runtime.repository
  const auditLog = new PostgresAuditLog(runtime.pool)
  const jobRepository = new PostgresDurableJobRepository(runtime.pool)
  const jobQueue = new DurableJobQueue({
    repository: jobRepository,
    workerId: `live-http-review-${process.pid}`,
  })
  const topologyService = new TopologyService({
    repository,
    auditLog,
    config: config.topology,
  })
  const app = appFactory({
    config,
    authenticator: new TokenAuthenticator(config.authTokens),
    repository,
    fileStore: {},
    auditLog,
    jobQueue,
    importPipeline: {},
    lifecycleService: {},
    topologyService,
  })

  let created = false
  let listening = false
  let cleanupCompleted = false
  try {
    const bundle = createReplayBundle(datasetVersionId)
    const initialArtifacts = generateRelationArtifacts(bundle, {
      generatedAt: GENERATED_AT,
    })
    await repository.create(applyArtifacts({
      datasetVersion: {
        id: datasetVersionId,
        datasetId: 'dataset-live-http-review',
        branchId: 'site-baseline',
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
    }, initialArtifacts))
    created = true

    await listen(app)
    listening = true
    const origin = `http://127.0.0.1:${app.address().port}`
    const candidatesResponse = await requestJson(
      `${origin}/api/dataset-versions/${datasetVersionId}/topology/candidates`,
    )
    assert.equal(candidatesResponse.status, 200)
    const candidate = candidatesResponse.body.items.find(({ candidateStatus }) => (
      candidateStatus === 'candidate'
    ))
    assert.ok(candidate, 'Fixture live HTTP tidak memiliki candidate yang dapat direview.')

    const summaryResponse = await requestJson(
      `${origin}/api/dataset-versions/${datasetVersionId}/topology/summary`,
    )
    assert.equal(summaryResponse.status, 200)
    const { graphRevision, candidateRevision } = summaryResponse.body
    assert.ok(graphRevision)
    assert.ok(candidateRevision)
    assert.equal(candidatesResponse.body.graphRevision, graphRevision)
    assert.equal(candidatesResponse.body.candidateRevision, candidateRevision)

    const reviewUrl = `${origin}/api/topology/candidates/${encodeURIComponent(
      candidate.candidateId,
    )}/confirm`
    const reviewBody = {
      reason: 'Live PostgreSQL HTTP concurrency replay.',
      expectedGraphRevision: graphRevision,
      expectedCandidateRevision: candidateRevision,
    }
    const responses = await Promise.all([
      requestJson(reviewUrl, { method: 'POST', body: reviewBody }),
      requestJson(reviewUrl, { method: 'POST', body: reviewBody }),
    ])
    const statuses = responses.map(({ status }) => status).sort((left, right) => left - right)
    if (statuses.join(',') !== '200,409') {
      throw Object.assign(new Error('Concurrent HTTP review tidak menghasilkan satu winner.'), {
        code: 'live_http_review_concurrency_failed',
        details: responses.map(({ status, body }) => ({
          status,
          errorCode: body?.error?.code ?? null,
          errorDetails: body?.error?.details ?? null,
        })),
      })
    }

    const persisted = await repository.get(datasetVersionId)
    const persistedCandidate = persisted.topologyCandidates.find(({ candidateId }) => (
      candidateId === candidate.candidateId
    ))
    assert.equal(persistedCandidate?.candidateStatus, 'confirmed')
    assert.notEqual(persisted.topologyGraph?.graphRevision, initialArtifacts.graph.graphRevision)
    assert.equal(
      persisted.topologyGraph?.edges?.every((edge) => edge.verificationStatus === 'confirmed'),
      true,
    )

    const counts = await runtime.pool.query(
      `SELECT
         (SELECT count(*)::int FROM audit_events WHERE dataset_version_id = $1) AS audit_events,
         (SELECT count(*)::int FROM confirmed_relations
            WHERE dataset_version_id = $1 AND verification_status = 'confirmed')
           AS confirmed_relations,
         (SELECT count(*)::int FROM graph_revisions
            WHERE dataset_version_id = $1 AND status = 'validated')
           AS validated_graph_revisions,
         (SELECT count(*)::int FROM graph_revisions
            WHERE dataset_version_id = $1 AND status = 'active') AS active_graph_revisions`,
      [datasetVersionId],
    )
    const row = counts.rows[0]
    const evidenceCounts = {
      auditEventCount: Number(row.audit_events),
      confirmedRelationCount: Number(row.confirmed_relations),
      validatedGraphRevisionCount: Number(row.validated_graph_revisions),
      activeGraphRevisionCount: Number(row.active_graph_revisions),
    }
    if (evidenceCounts.auditEventCount !== 1
      || evidenceCounts.confirmedRelationCount !== 2
      || evidenceCounts.validatedGraphRevisionCount !== 1
      || evidenceCounts.activeGraphRevisionCount !== 0) {
      throw Object.assign(new Error('Projection evidence live HTTP review tidak konsisten.'), {
        code: 'live_http_review_evidence_failed',
        details: evidenceCounts,
      })
    }

    const cleanupResult = await cleanup(runtime.pool, datasetVersionId)
    cleanupCompleted = true

    return {
      result: 'passed',
      datasetVersionId,
      candidateId: candidate.candidateId,
      concurrentStatuses: statuses,
      winnerCount: 1,
      staleConflictCount: 1,
      ...evidenceCounts,
      cleanup: cleanupResult,
      jsonPrimaryUsed: false,
    }
  } finally {
    if (listening) await close(app)
    await jobQueue.stop().catch(() => {})
    try {
      if (created && !cleanupCompleted) {
        await cleanup(runtime.pool, datasetVersionId)
      }
    } finally {
      await runtime.close?.()
    }
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

async function requestJson(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return {
    status: response.status,
    body: await response.json(),
  }
}

async function listen(app) {
  await new Promise((resolve, reject) => {
    app.once('error', reject)
    app.listen(0, '127.0.0.1', resolve)
  })
}

async function close(app) {
  await new Promise((resolve, reject) => {
    app.close((error) => error ? reject(error) : resolve())
  })
}

async function cleanup(pool, datasetVersionId) {
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

async function main() {
  const result = await runLiveHttpReviewReplay()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[topology-http-review-replay] ${error.code ?? 'failed'}: ${error.message}\n`)
    if (error.details) {
      process.stderr.write(`${JSON.stringify(error.details)}\n`)
    }
    process.exitCode = 1
  })
}
