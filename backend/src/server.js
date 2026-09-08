import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { createConfig } from './config.js'
import { DatasetVersionValidationService } from './import/dataset-validation-service.js'
import { DatasetVersionLifecycleService } from './import/dataset-version-lifecycle-service.js'
import { ImportPipeline, summarizeImportJobResult } from './import/import-pipeline.js'
import { createDatasetVersionRepositoryRuntime } from './database/repository-runtime.js'
import { DurableJobQueue } from './jobs/durable-job-queue.js'
import { JsonDurableJobRepository } from './jobs/durable-job-repository.js'
import { PostgresDurableJobRepository } from './jobs/postgres-durable-job-repository.js'
import { TokenAuthenticator } from './security/authorization.js'
import { JsonLinesAuditLog } from './storage/audit-log.js'
import { ImportFileStore } from './storage/file-store.js'
import { PostgresAuditLog } from './storage/postgres-audit-log.js'
import { MetricsRegistry } from './observability/metrics.js'
import {
  createFullTopologyRegenerationJobHandler,
  TopologyService,
} from './topology/topology-service.js'
import { rebuildStoredTopologyInputBundle } from './domain/parser-contract.js'
import { TOPOLOGY_RULE_SET_VERSION } from './topology/semantic-relation-engine.js'
import { topologyInputFingerprint } from './topology/topology-publication-gate.js'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const config = createConfig(process.env, {
  dataRoot: process.env.SINERGI_DATA_ROOT
    ?? path.resolve(moduleDirectory, '../.data'),
})
const authenticator = new TokenAuthenticator(config.authTokens)
const fileStore = new ImportFileStore(config.dataRoot)
const repositoryRuntime = await createDatasetVersionRepositoryRuntime({ config })
const repository = repositoryRuntime.repository
const auditLog = repositoryRuntime.mode === 'postgres'
  ? new PostgresAuditLog(repositoryRuntime.pool)
  : new JsonLinesAuditLog(path.join(config.dataRoot, 'audit', 'imports.jsonl'))
const jobRepository = repositoryRuntime.mode === 'postgres'
  ? new PostgresDurableJobRepository(repositoryRuntime.pool)
  : new JsonDurableJobRepository(path.join(config.dataRoot, 'jobs'), {
    staleLockMilliseconds: config.jobs?.lockStaleMilliseconds,
  })
const metrics = new MetricsRegistry()
const lifecycleService = new DatasetVersionLifecycleService({
  repository,
  auditLog,
  siteBoundaries: config.siteBoundaries,
})
const topologyService = new TopologyService({
  repository,
  auditLog,
  config: config.topology,
  metrics,
})
const importPipeline = new ImportPipeline({
  repository,
  fileStore,
  auditLog,
  limits: config.upload,
  metadataAliases: config.metadataAliases,
  sourceIdentityFallback: config.sourceIdentityFallback,
  folderMappings: config.folderMappings,
  relationMappings: config.relationMappings,
  topology: config.topology,
  validationService: new DatasetVersionValidationService({
    ...config.validation,
    maxFileSize: config.upload.maxFileSize,
  }),
})
const jobQueue = new DurableJobQueue({
  repository: jobRepository,
  concurrency: config.jobs?.concurrency ?? 1,
  leaseMilliseconds: config.jobs?.leaseMilliseconds,
  pollMilliseconds: config.jobs?.pollMilliseconds,
  metrics,
  metricsRefreshMilliseconds: config.jobs?.metricsRefreshMilliseconds,
})
jobQueue.registerHandler(
  'regenerate_full_topology',
  createFullTopologyRegenerationJobHandler(topologyService),
)
jobQueue.registerHandler('parse_source', async (
  { sourceStorageKey, extension, actorId, correlationId },
  { job, updateProgress },
) => {
  const result = summarizeImportJobResult(await importPipeline.process({
    datasetVersionId: job.datasetVersionId,
    sourcePath: fileStore.resolveOriginalPath(sourceStorageKey),
    extension,
    actorId,
    correlationId,
    jobId: job.jobId,
    progressReporter: updateProgress,
  }))
  await queueAutonomousTopologyJob(job.datasetVersionId, {
    actorId,
    correlationId,
    reason: 'Import selesai; shadow topology dibuat otomatis.',
  })
  return result
})

await fileStore.initialize()
const app = createApp({
  config,
  authenticator,
  repository,
  fileStore,
  auditLog,
  jobQueue,
  importPipeline,
  lifecycleService,
  topologyService,
  metrics,
})

const httpServer = app.listen(config.port, config.host, () => {
  console.log(`SINERGI import service listening on http://${config.host}:${config.port}`)
})

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await jobQueue.stop().catch(() => {})
  await repositoryRuntime.close().catch(() => {})
  await new Promise((resolve) => httpServer.close(resolve))
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

try {
  await jobQueue.start()
  await queueStaleTopologyRuleSets()
} catch (error) {
  await shutdown()
  throw error
}

async function queueAutonomousTopologyJob(datasetVersionId, {
  actorId = 'topology-autonomous-worker',
  correlationId = null,
  reason,
} = {}) {
  const record = await repository.get(datasetVersionId)
  if (!record.topologyInputBundle) return null
  const repaired = rebuildStoredTopologyInputBundle(record)
  const inputFingerprint = topologyInputFingerprint(
    repaired.topologyInputBundle ?? record.topologyInputBundle,
    { ruleSetVersion: TOPOLOGY_RULE_SET_VERSION, config: config.topology },
  )
  const queued = await jobQueue.enqueue({
    jobType: 'regenerate_full_topology',
    datasetVersionId,
    inputFingerprint,
    ruleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    idempotencyKey: `autonomous-topology:${inputFingerprint}`,
    payload: { actorId, correlationId, reason },
    handler: createFullTopologyRegenerationJobHandler(topologyService),
  })
  await auditLog.record('topology.regeneration_queued', {
    actorId,
    datasetVersionId,
    branchId: record.datasetVersion?.branchId ?? null,
    correlationId,
    outcome: queued.deduplicated ? 'deduplicated' : 'queued',
    details: {
      trigger: 'autonomous_rule_or_import_change',
      jobId: queued.jobId,
      inputFingerprint,
      ruleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    },
  })
  return queued
}

async function queueStaleTopologyRuleSets() {
  const records = await repository.list()
  for (const record of records) {
    if (!record.topologyInputBundle
      || record.topologyRuleSetVersion === TOPOLOGY_RULE_SET_VERSION) continue
    // A failed shadow run is already durable in topologyPublication. Do not
    // enqueue the same stale dataset again on every dev-server restart; that
    // creates a regeneration storm while the active graph correctly remains
    // protected behind the publication gate. Operators can explicitly retry
    // after resolving the recorded gate blockers.
    if (record.topologyPublication?.ruleSetVersion === TOPOLOGY_RULE_SET_VERSION
      && record.topologyPublication?.lastShadowRunId) continue
    await queueAutonomousTopologyJob(record.datasetVersion.id, {
      reason: `Topology rules berubah ke ${TOPOLOGY_RULE_SET_VERSION}.`,
    })
  }
}
