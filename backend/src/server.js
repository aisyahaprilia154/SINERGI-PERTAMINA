import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { createConfig } from './config.js'
import { DatasetVersionValidationService } from './import/dataset-validation-service.js'
import { DatasetVersionLifecycleService } from './import/dataset-version-lifecycle-service.js'
import { ImportPipeline } from './import/import-pipeline.js'
import { BackgroundJobQueue } from './jobs/background-job-queue.js'
import { TokenAuthenticator } from './security/authorization.js'
import { JsonLinesAuditLog } from './storage/audit-log.js'
import { JsonDatasetVersionRepository } from './storage/dataset-version-repository.js'
import { ImportFileStore } from './storage/file-store.js'
import { TopologyService } from './topology/topology-service.js'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const config = createConfig(process.env, {
  dataRoot: process.env.SINERGI_DATA_ROOT
    ?? path.resolve(moduleDirectory, '../.data'),
})
const authenticator = new TokenAuthenticator(config.authTokens)
const fileStore = new ImportFileStore(config.dataRoot)
const repository = new JsonDatasetVersionRepository(
  path.join(config.dataRoot, 'dataset-versions'),
)
const auditLog = new JsonLinesAuditLog(path.join(config.dataRoot, 'audit', 'imports.jsonl'))
const jobQueue = new BackgroundJobQueue({ concurrency: 1 })
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
})

app.listen(config.port, config.host, () => {
  console.log(`SINERGI import service listening on http://${config.host}:${config.port}`)
})
