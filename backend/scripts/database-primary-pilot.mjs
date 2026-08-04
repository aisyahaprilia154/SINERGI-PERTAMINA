import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createConfig } from '../src/config.js'
import { createDatasetVersionRepositoryRuntime } from '../src/database/repository-runtime.js'
import { PostgresDurableJobRepository } from '../src/jobs/postgres-durable-job-repository.js'

const PROJECTION_TABLES = [
  'graph_edges',
  'graph_nodes',
  'graph_revisions',
  'confirmed_relations',
  'topology_candidates',
  'classified_objects',
  'source_geometries',
  'source_features',
]

export async function runDatabasePrimaryPilot({
  config = createConfig(process.env, { storageMode: 'postgres' }),
  runtimeFactory = createDatasetVersionRepositoryRuntime,
} = {}) {
  const runtime = await runtimeFactory({ config })
  if (runtime.mode !== 'postgres') {
    await runtime.close?.()
    throw new Error('Primary pilot membutuhkan storage mode postgres.')
  }
  const datasetVersionId = `live-primary-${randomUUID().replaceAll('-', '')}`
  const repository = runtime.repository
  const jobRepository = new PostgresDurableJobRepository(runtime.pool)
  let created = false
  try {
    const existing = await repository.get('dv-pilot-parity')
    const record = createPrimaryRecord(datasetVersionId)
    await repository.create(record)
    created = true
    const updated = await repository.update(datasetVersionId, (current) => ({
      ...current,
      primaryPilotMarker: 'postgres-primary',
    }), { expectedRevision: 0 })
    const stored = await repository.get(datasetVersionId)

    const job = await jobRepository.create({
      jobType: 'parse_source',
      datasetVersionId,
      inputFingerprint: `primary-pilot:${datasetVersionId}`,
      payload: { marker: 'postgres-primary' },
    })
    const claimed = await jobRepository.claimNext({
      workerId: 'primary-pilot-worker',
      leaseMilliseconds: 60_000,
    })
    if (!claimed || claimed.jobId !== job.jobId) {
      throw new Error('Primary pilot tidak berhasil claim durable job PostgreSQL.')
    }
    const completed = await jobRepository.complete(
      claimed.jobId,
      'primary-pilot-worker',
      { marker: 'postgres-primary' },
    )

    return {
      result: 'passed',
      storageMode: runtime.mode,
      existingPilotVersionId: existing.datasetVersion.id,
      datasetVersionId,
      repositoryClass: repository.constructor.name,
      updateRevision: updated.recordRevision,
      storedMarker: stored.primaryPilotMarker,
      jobStatus: completed.status,
      jobRevision: completed.revision,
      jsonPrimaryUsed: false,
    }
  } finally {
    try {
      if (created) await cleanup(runtime.pool, datasetVersionId)
    } finally {
      await runtime.close?.()
    }
  }
}

function createPrimaryRecord(id) {
  return {
    contractVersion: '1.0.0',
    datasetVersion: {
      id,
      datasetId: 'dataset-live-primary',
      branchId: 'branch-live-primary',
      versionName: id,
      validationStatus: 'valid',
      publicationStatus: 'unpublished',
      status: 'valid',
    },
    validation: {
      status: 'valid',
      canActivate: true,
      summary: { errors: 0 },
    },
    sourceFeatures: [],
    sourceGeometries: [],
    classifiedObjects: [],
    topologyCandidates: [],
    confirmedRelations: [],
    topologyGraph: null,
  }
}

async function cleanup(pool, datasetVersionId) {
  await pool.query('DELETE FROM topology_jobs WHERE dataset_version_id = $1', [
    datasetVersionId,
  ])
  for (const table of PROJECTION_TABLES) {
    await pool.query(`DELETE FROM ${table} WHERE dataset_version_id = $1`, [
      datasetVersionId,
    ])
  }
  await pool.query('DELETE FROM dataset_versions WHERE id = $1', [datasetVersionId])
}

async function main() {
  const result = await runDatabasePrimaryPilot()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[database-primary-pilot] ${error.code ?? 'failed'}: ${error.message}\n`)
    process.exitCode = 1
  })
}
