import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { createConfig } from './config.js'
import { DatasetVersionValidationService } from './import/dataset-validation-service.js'
import { DatasetVersionLifecycleService } from './import/dataset-version-lifecycle-service.js'
import { ImportPipeline } from './import/import-pipeline.js'
import { createDatasetVersionRepositoryRuntime } from './database/repository-runtime.js'
import { DurableJobQueue } from './jobs/durable-job-queue.js'
import { JsonDurableJobRepository } from './jobs/durable-job-repository.js'
import { PostgresDurableJobRepository } from './jobs/postgres-durable-job-repository.js'
import { TokenAuthenticator } from './security/authorization.js'
import { JsonLinesAuditLog } from './storage/audit-log.js'
import { ImportFileStore } from './storage/file-store.js'
import { PostgresAuditLog } from './storage/postgres-audit-log.js'
import {
  createFullTopologyRegenerationJobHandler,
  TopologyService,
} from './topology/topology-service.js'

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
const lifecycleService = new DatasetVersionLifecycleService({
  repository,
  auditLog,
})
const topologyService = new TopologyService({
  repository,
  auditLog,
  config: config.topology,
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
})
jobQueue.registerHandler(
  'regenerate_full_topology',
  createFullTopologyRegenerationJobHandler(topologyService),
)
jobQueue.registerHandler('parse_source', (
  { sourceStorageKey, extension, actorId },
  { job, updateProgress },
) => (
  importPipeline.process({
    datasetVersionId: job.datasetVersionId,
    sourcePath: fileStore.resolveOriginalPath(sourceStorageKey),
    extension,
    actorId,
    progressReporter: updateProgress,
  })
))

await fileStore.initialize()
await jobQueue.start()
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
