import { createHash } from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { AppError, asAppError } from './errors.js'
import { receiveImportUpload } from './http/multipart-upload.js'
import { createOpenFreeMapProxy } from './http/openfreemap-proxy.js'
import { createProcessingRecord } from './import/import-pipeline.js'
import { readKmzResourceBuffer } from './import/kmz-extractor.js'
import {
  requireAdministrator,
  requireDatasetSourceDownload,
} from './security/authorization.js'
import {
  sanitizeSourceFilename,
  validateBranchId,
  validateUploadedFile,
} from './import/upload-validation.js'
import { TOPOLOGY_RULE_SET_VERSION } from './topology/semantic-relation-engine.js'
import { MAX_CANDIDATE_RESPONSE_BYTES } from './topology/topology-candidate-pagination.js'

export function createApp({
  config,
  authenticator,
  repository,
  fileStore,
  auditLog,
  jobQueue,
  importPipeline,
  lifecycleService,
  topologyService,
  basemapFetch = globalThis.fetch,
  clock = () => new Date(),
}) {
  const openFreeMapProxy = createOpenFreeMapProxy({ fetchImpl: basemapFetch })
  return http.createServer(async (request, response) => {
    setSecurityHeaders(response)
    const url = new URL(request.url, 'http://localhost')

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { status: 'ok' })
      }
      if (request.method === 'GET'
        && url.pathname.startsWith('/api/basemap/openfreemap/')
        && await openFreeMapProxy.handle(url.pathname, response)) {
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/import-config') {
        requireAdministrator(request, authenticator)
        return sendJson(response, 200, toImportConfigResponse(config))
      }
      const sourceDownloadMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/source-file$/)
        : null
      if (sourceDownloadMatch) {
        return await handleSourceFileDownload({
          request,
          response,
          datasetVersionId: sourceDownloadMatch[1],
          authenticator,
          repository,
          fileStore,
          auditLog,
        })
      }
      const activeAssetMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/datasets\/([a-zA-Z0-9_-]+)\/active\/assets\/([^/]+)$/)
        : null
      if (activeAssetMatch) {
        authenticator.authenticate(request)
        return sendJson(
          response,
          200,
          await lifecycleService.getActiveAssetDetail({
            datasetId: activeAssetMatch[1],
            branchId: normalizeActiveBranch(url.searchParams.get('branchId')),
            assetId: normalizeAssetId(decodePathSegment(activeAssetMatch[2])),
          }),
        )
      }
      const activeDatasetMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/datasets\/([a-zA-Z0-9_-]+)\/active$/)
        : null
      if (activeDatasetMatch) {
        authenticator.authenticate(request)
        const context = {
          datasetId: activeDatasetMatch[1],
          branchId: normalizeActiveBranch(url.searchParams.get('branchId')),
        }
        return sendJson(
          response,
          200,
          url.searchParams.get('view') === 'map'
            ? await lifecycleService.getActiveMapDataset(context)
            : await lifecycleService.getActiveDataset(context),
        )
      }
      const parserProjectionMatch = request.method === 'GET'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/(readiness|source-features|geometries|overlays|classification-issues)$/,
        )
        : null
      const overlayResourceMatch = request.method === 'GET'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/overlay-resources\/([^/]+)$/,
        )
        : null
      if (overlayResourceMatch) {
        authenticator.authenticate(request)
        const record = await repository.get(overlayResourceMatch[1])
        const resourceId = decodePathSegment(overlayResourceMatch[2])
        const resource = (record.sourceResources ?? []).find(({ resourceId: id }) => (
          id === resourceId
        ))
        const referenced = (record.sourceOverlays ?? []).some((overlay) => (
          overlay.resourceId === resourceId
          && overlay.resourceResolutionStatus === 'resolved'
        ))
        if (!resource || !referenced) {
          throw new AppError('Resource overlay tidak ditemukan.', {
            code: 'overlay_resource_not_found',
            statusCode: 404,
          })
        }
        if (!String(record.datasetVersion.sourceFilename ?? '').toLowerCase().endsWith('.kmz')) {
          throw new AppError('Resource overlay hanya tersedia dari package KMZ.', {
            code: 'overlay_resource_package_unavailable',
            statusCode: 404,
          })
        }
        const source = await fileStore.readVerifiedOriginal({
          storageKey: record.datasetVersion.sourceStorageKey,
          expectedSize: record.datasetVersion.sourceSize,
          expectedChecksum: record.datasetVersion.checksum,
        })
        const extracted = await readKmzResourceBuffer(
          source.bytes,
          resource.relativePaths ?? [resource.relativePath],
          config.upload,
        )
        response.writeHead(200, {
          'content-type': imageContentType(extracted.extension),
          'content-length': String(extracted.size),
          'cache-control': 'private, max-age=3600',
          'x-content-type-options': 'nosniff',
        })
        response.end(extracted.bytes)
        return
      }
      if (parserProjectionMatch) {
        if (parserProjectionMatch[2] === 'overlays') {
          authenticator.authenticate(request)
        } else {
          requireAdministrator(request, authenticator)
        }
        const record = await repository.get(parserProjectionMatch[1])
        return sendJson(
          response,
          200,
          parserProjection(record, parserProjectionMatch[2]),
        )
      }
      const topologyProjectionMatch = request.method === 'GET'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/(summary|candidates|graph)$/,
        )
        : null
      if (topologyProjectionMatch) {
        const isCandidateProjection = topologyProjectionMatch[2] === 'candidates'
        if (isCandidateProjection) {
          requireAdministrator(request, authenticator)
        } else {
          authenticator.authenticate(request)
        }
        assertTopologyService(topologyService)
        const method = {
          summary: 'getSummary',
          candidates: 'getCandidates',
          graph: 'getGraph',
        }[topologyProjectionMatch[2]]
        const projection = await topologyService[method](
          topologyProjectionMatch[1],
          isCandidateProjection ? candidateQueryFromUrl(url.searchParams) : undefined,
        )
        if (!isCandidateProjection) return sendJson(response, 200, projection)
        const etag = entityTagForJson(projection)
        if (ifNoneMatchMatches(request.headers['if-none-match'], etag)) {
          response.writeHead(304, {
            ETag: etag,
            Vary: 'Authorization',
            'cache-control': 'private, no-cache',
          })
          response.end()
          return
        }
        return sendJson(response, 200, projection, {
          maxBytes: MAX_CANDIDATE_RESPONSE_BYTES,
          cacheControl: 'private, no-cache',
          headers: {
            ETag: etag,
            Vary: 'Authorization',
          },
        })
      }
      const topologyTraceMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/trace$/,
        )
        : null
      if (topologyTraceMatch) {
        const user = authenticator.authenticate(request)
        assertTopologyService(topologyService)
        const body = await readJsonBody(request)
        return sendJson(
          response,
          200,
          await topologyService.trace(topologyTraceMatch[1], body, user.id),
        )
      }
      const regenerateTopologyMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/regenerate$/,
        )
        : null
      if (regenerateTopologyMatch) {
        const user = requireAdministrator(request, authenticator)
        assertTopologyService(topologyService)
        const body = await readJsonBody(request)
        const record = await topologyService.regenerate(
          regenerateTopologyMatch[1],
          user.id,
          body,
        )
        return sendJson(response, 200, {
          datasetVersionId: record.datasetVersion.id,
          summary: record.topologySummary,
          readiness: record.topologyReadiness,
          topologyRuleSetVersion: record.topologyRuleSetVersion,
        })
      }
      const bulkTopologyActionMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/(confirm-all|confirm-line-labels|revoke-all)$/,
        )
        : null
      if (bulkTopologyActionMatch) {
        const user = requireAdministrator(request, authenticator)
        assertTopologyService(topologyService)
        const body = await readJsonBody(request)
        const mutationInput = {
          ...body,
          ...(request.headers['idempotency-key'] !== undefined
            ? { idempotencyKey: request.headers['idempotency-key'] }
            : {}),
        }
        const method = {
          'confirm-all': 'confirmAllCandidates',
          'confirm-line-labels': 'confirmLineLabelCandidates',
          'revoke-all': 'revokeAllRelations',
        }[bulkTopologyActionMatch[2]]
        return sendJson(
          response,
          200,
          await topologyService[method](bulkTopologyActionMatch[1], user.id, mutationInput),
        )
      }
      const manualTopologyRelationMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/relations$/,
        )
        : null
      if (manualTopologyRelationMatch) {
        const user = requireAdministrator(request, authenticator)
        assertTopologyService(topologyService)
        const body = await readJsonBody(request)
        const mutationInput = {
          ...body,
          ...(request.headers['idempotency-key'] !== undefined
            ? { idempotencyKey: request.headers['idempotency-key'] }
            : {}),
        }
        return sendJson(
          response,
          200,
          await topologyService.createDeviceRelation(
            manualTopologyRelationMatch[1],
            user.id,
            mutationInput,
          ),
        )
      }
      const candidateActionMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/topology\/candidates\/([^/]+)\/(confirm|reject|skip|select-target)$/,
        )
        : null
      if (candidateActionMatch) {
        const user = requireAdministrator(request, authenticator)
        assertTopologyService(topologyService)
        const candidateId = decodePathSegment(candidateActionMatch[1])
        const body = await readJsonBody(request)
        const action = candidateActionMatch[2]
        const mutationInput = {
          ...body,
          ...(request.headers['idempotency-key'] !== undefined
            ? { idempotencyKey: request.headers['idempotency-key'] }
            : {}),
        }
        const result = action === 'select-target'
          ? await topologyService.selectTarget(candidateId, user.id, mutationInput)
          : await topologyService[{
            confirm: 'confirmCandidate',
            reject: 'rejectCandidate',
            skip: 'skipCandidate',
          }[action]](candidateId, user.id, mutationInput)
        return sendJson(response, 200, result)
      }
      const revokeRelationMatch = request.method === 'POST'
        ? url.pathname.match(/^\/api\/topology\/relations\/([^/]+)\/revoke$/)
        : null
      if (revokeRelationMatch) {
        const user = requireAdministrator(request, authenticator)
        assertTopologyService(topologyService)
        const body = await readJsonBody(request)
        const mutationInput = {
          ...body,
          ...(request.headers['idempotency-key'] !== undefined
            ? { idempotencyKey: request.headers['idempotency-key'] }
            : {}),
        }
        return sendJson(
          response,
          200,
          await topologyService.revokeRelation(
            decodePathSegment(revokeRelationMatch[1]),
            user.id,
            mutationInput,
          ),
        )
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/imports') {
        const user = requireAdministrator(request, authenticator)
        return await handleCreateImport({
          request,
          response,
          user,
          config,
          repository,
          fileStore,
          auditLog,
          jobQueue,
          importPipeline,
          clock,
        })
      }
      const previewMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/admin\/imports\/([a-zA-Z0-9_-]+)\/preview$/)
        : null
      if (previewMatch) {
        requireAdministrator(request, authenticator)
        return sendJson(
          response,
          200,
          await lifecycleService.getPreview(previewMatch[1]),
        )
      }
      const activationMatch = request.method === 'POST'
        ? url.pathname.match(/^\/api\/admin\/imports\/([a-zA-Z0-9_-]+)\/activate$/)
        : null
      if (activationMatch) {
        const user = requireAdministrator(request, authenticator)
        const body = await readJsonBody(request)
        if (body.confirmArchiveCurrent !== true) {
          throw new AppError('Konfirmasi pengarsipan dataset aktif wajib diberikan.', {
            code: 'activation_confirmation_required',
            statusCode: 400,
          })
        }
        const expectedActiveVersionId = normalizeExpectedActiveVersion(body)
        return sendJson(
          response,
          200,
          await lifecycleService.activate(activationMatch[1], user.id, {
            expectedActiveVersionId,
          }),
        )
      }
      const rollbackMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/admin\/datasets\/([a-zA-Z0-9_-]+)\/branches\/([a-zA-Z0-9_-]+)\/rollback$/,
        )
        : null
      if (rollbackMatch) {
        const user = requireAdministrator(request, authenticator)
        const body = await readJsonBody(request)
        return sendJson(
          response,
          200,
          await lifecycleService.rollbackToPrevious(
            rollbackMatch[1],
            rollbackMatch[2],
            user.id,
            { expectedActiveVersionId: body.expectedActiveVersionId },
          ),
        )
      }
      const rejectionMatch = request.method === 'POST'
        ? url.pathname.match(/^\/api\/admin\/imports\/([a-zA-Z0-9_-]+)\/reject$/)
        : null
      if (rejectionMatch) {
        const user = requireAdministrator(request, authenticator)
        return sendJson(
          response,
          200,
          await lifecycleService.reject(rejectionMatch[1], user.id),
        )
      }
      const jobMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/admin\/jobs\/([a-zA-Z0-9_-]+)$/)
        : null
      if (jobMatch) {
        requireAdministrator(request, authenticator)
        assertDurableJobQueue(jobQueue)
        return sendJson(response, 200, {
          job: await jobQueue.getPublic(jobMatch[1]),
        })
      }
      const jobActionMatch = request.method === 'POST'
        ? url.pathname.match(/^\/api\/admin\/jobs\/([a-zA-Z0-9_-]+)\/(retry|cancel)$/)
        : null
      if (jobActionMatch) {
        const user = requireAdministrator(request, authenticator)
        assertDurableJobQueue(jobQueue)
        const job = jobActionMatch[2] === 'retry'
          ? await jobQueue.retry(jobActionMatch[1])
          : await jobQueue.cancel(jobActionMatch[1])
        await auditLog.record(`durable_job.${jobActionMatch[2]}`, {
          actorId: user.id,
          datasetVersionId: job.datasetVersionId,
          outcome: job.status,
          details: { jobId: job.jobId, jobType: job.jobType },
        })
        return sendJson(response, 200, {
          job: jobQueue.getPublic ? await jobQueue.getPublic(job.jobId) : job,
        })
      }
      const statusMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/admin\/imports\/([a-zA-Z0-9_-]+)$/)
        : null
      if (statusMatch) {
        requireAdministrator(request, authenticator)
        const record = await repository.get(statusMatch[1])
        return sendJson(response, 200, toStatusResponse(record))
      }

      throw new AppError('Endpoint tidak ditemukan.', {
        code: 'not_found',
        statusCode: 404,
      })
    } catch (error) {
      request.resume()
      const appError = asAppError(error)
      if (['authentication_required', 'invalid_token', 'forbidden'].includes(appError.code)) {
        await auditLog.record('dataset_import.authorization_denied', {
          outcome: appError.code,
          details: {
            method: request.method,
            path: url.pathname,
          },
        }).catch(() => {})
      }
      sendJson(response, appError.statusCode, {
        error: {
          code: appError.code,
          message: appError.expose ? appError.message : 'Terjadi kesalahan internal.',
          ...(appError.expose && appError.details ? { details: appError.details } : {}),
        },
      })
    }
  })
}

function assertTopologyService(topologyService) {
  if (!topologyService) {
    throw new AppError('Topology service belum dikonfigurasi.', {
      code: 'topology_service_unavailable',
      statusCode: 503,
    })
  }
}

function assertDurableJobQueue(jobQueue) {
  if (!jobQueue || typeof jobQueue.getPublic !== 'function') {
    throw new AppError('Durable job queue belum dikonfigurasi.', {
      code: 'durable_job_queue_unavailable',
      statusCode: 503,
    })
  }
}

function parserProjection(record, projection) {
  if (projection === 'readiness') {
    return {
      datasetVersionId: record.datasetVersion.id,
      readiness: record.readiness ?? null,
      coverage: record.parserCoverage ?? null,
      versions: record.parserVersions ?? null,
    }
  }
  if (projection === 'source-features') {
    return {
      datasetVersionId: record.datasetVersion.id,
      items: record.sourceFeatures ?? [],
    }
  }
  if (projection === 'geometries') {
    return {
      datasetVersionId: record.datasetVersion.id,
      items: record.sourceGeometries ?? [],
    }
  }
  if (projection === 'overlays') {
    return {
      datasetVersionId: record.datasetVersion.id,
      items: (record.sourceOverlays ?? []).map((overlay) => ({
        ...structuredClone(overlay),
        ...(overlay.resourceResolutionStatus === 'resolved' && overlay.resourceId
          ? {
            resourceUrl: `/api/dataset-versions/${encodeURIComponent(
              record.datasetVersion.id,
            )}/overlay-resources/${encodeURIComponent(overlay.resourceId)}`,
          }
          : {}),
      })),
      resources: record.sourceResources ?? [],
    }
  }
  return {
    datasetVersionId: record.datasetVersion.id,
    items: (record.classifiedObjects ?? []).filter(({ classificationStatus }) => (
      classificationStatus !== 'classified'
    )),
    issues: (record.canonicalParser?.issues ?? []).filter(({ scope }) => (
      scope === 'classification'
    )),
  }
}

function normalizeExpectedActiveVersion(body) {
  if (!Object.hasOwn(body, 'expectedActiveVersionId')) return undefined
  if (body.expectedActiveVersionId === null) return null
  const value = String(body.expectedActiveVersionId)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new AppError('Expected active version ID tidak valid.', {
      code: 'invalid_expected_active_version_id',
      statusCode: 400,
    })
  }
  return value
}

function normalizeActiveBranch(value) {
  if (value === null) return undefined
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new AppError('Branch ID tidak valid.', {
      code: 'invalid_branch_id',
      statusCode: 400,
    })
  }
  return value
}

function normalizeAssetId(value) {
  if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AppError('Asset ID tidak valid.', {
      code: 'invalid_asset_id',
      statusCode: 400,
    })
  }
  return value
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new AppError('Asset ID tidak valid.', {
      code: 'invalid_asset_id',
      statusCode: 400,
    })
  }
}

async function handleCreateImport({
  request,
  response,
  user,
  config,
  repository,
  fileStore,
  auditLog,
  jobQueue,
  importPipeline,
  clock,
}) {
  let temporaryPath = null
  try {
    const upload = await receiveImportUpload(request, {
      fileStore,
      maxFileSize: config.upload.maxFileSize,
    })
    temporaryPath = upload.temporaryPath
    const branchId = validateBranchId(upload.fields.branchId, config.allowedBranchIds)
    const datasetId = config.datasetIdsByBranch[branchId]
    if (!datasetId) {
      throw new AppError('Dataset untuk kantor cabang belum dikonfigurasi.', {
        code: 'branch_dataset_not_configured',
        statusCode: 409,
      })
    }
    const requestedDatasetId = normalizeOptionalText(
      upload.fields.datasetId,
      128,
      'Dataset tujuan',
    )
    if (requestedDatasetId && requestedDatasetId !== datasetId) {
      throw new AppError('Dataset tujuan tidak sesuai dengan kantor cabang.', {
        code: 'dataset_branch_mismatch',
        statusCode: 400,
      })
    }
    const requestedVersionName = normalizeOptionalText(
      upload.fields.versionName,
      120,
      'Identitas versi',
    )
    const versionNote = normalizeOptionalText(
      upload.fields.versionNote,
      1000,
      'Catatan versi',
    )
    const officialSourceConfirmed = upload.fields.officialSourceConfirmed === 'true'
    const validated = await validateUploadedFile({
      filePath: temporaryPath,
      filename: upload.filename,
      mimeType: upload.mimeType,
      size: upload.size,
      maxFileSize: config.upload.maxFileSize,
    })

    const datasetVersionId = `dv-${crypto.randomUUID()}`
    const importedAt = clock().toISOString()
    const storedSource = await fileStore.commitOriginal(
      temporaryPath,
      datasetVersionId,
      validated.extension,
    )
    temporaryPath = null

    const datasetVersion = {
      id: datasetVersionId,
      datasetId,
      branchId,
      versionName: requestedVersionName ?? createVersionName(importedAt),
      ...(versionNote ? { versionNote } : {}),
      officialSourceConfirmed,
      sourceFilename: validated.sourceFilename,
      sourceMimeType: validated.sourceMimeType,
      sourceSize: upload.size,
      checksum: upload.checksum,
      sourceStorageKey: storedSource.storageKey,
      importedBy: user.id,
      importedAt,
      validationStatus: 'pending',
      publicationStatus: 'unpublished',
      status: 'processing',
      summary: emptySummary(),
    }
    const processingRecord = createProcessingRecord(datasetVersion, clock)
    await repository.create(processingRecord)
    await auditLog.record('dataset_import.upload_accepted', {
      actorId: user.id,
      datasetVersionId,
      branchId,
      outcome: 'processing',
      details: {
        sourceFilename: validated.sourceFilename,
        sourceMimeType: validated.sourceMimeType,
        sourceSize: upload.size,
        checksum: upload.checksum,
      },
    })

    let queuedJob
    try {
      queuedJob = await jobQueue.enqueue({
        jobType: 'parse_source',
        datasetVersionId,
        inputFingerprint: `${upload.checksum}:${upload.size}`,
        ruleSetVersion: TOPOLOGY_RULE_SET_VERSION,
        payload: {
          sourceStorageKey: storedSource.storageKey,
          extension: validated.extension,
          actorId: user.id,
        },
        handler: ({ sourceStorageKey, extension, actorId }, { updateProgress }) => importPipeline.process({
          datasetVersionId,
          sourcePath: fileStore.resolveOriginalPath(sourceStorageKey),
          extension,
          actorId,
          progressReporter: updateProgress,
        }),
      })
    } catch (error) {
      await repository.update(datasetVersionId, (record) => ({
        ...record,
        datasetVersion: {
          ...record.datasetVersion,
          validationStatus: 'invalid',
          status: 'invalid',
        },
        processing: {
          ...record.processing,
          progress: 100,
          stage: 'invalid',
          completedAt: clock().toISOString(),
          errorCode: error.code ?? 'durable_job_enqueue_failed',
        },
      })).catch(() => {})
      throw error
    }

    if (queuedJob?.jobId) {
      await repository.update(datasetVersionId, (record) => ({
        ...record,
        processing: {
          ...record.processing,
          jobId: queuedJob.jobId,
          jobStatus: queuedJob.status,
        },
      }))
      processingRecord.processing.jobId = queuedJob.jobId
      processingRecord.processing.jobStatus = queuedJob.status
    }

    return sendJson(response, 202, {
      datasetVersion: withoutInternalStorage(datasetVersion),
      processing: processingRecord.processing,
      statusUrl: `/api/admin/imports/${datasetVersionId}`,
      message: 'File diterima dan diproses di background. Dataset belum aktif.',
    })
  } catch (error) {
    await fileStore.removeTemporary(temporaryPath)
    await auditLog.record('dataset_import.upload_rejected', {
      actorId: user.id,
      outcome: 'rejected',
      details: {
        errorCode: error.code ?? 'internal_error',
        message: error.expose ? error.message : 'Internal upload error',
      },
    }).catch(() => {})
    throw error
  }
}

async function handleSourceFileDownload({
  request,
  response,
  datasetVersionId,
  authenticator,
  repository,
  fileStore,
  auditLog,
}) {
  const user = authenticator.authenticate(request)
  let datasetVersion = null
  try {
    const record = await repository.get(datasetVersionId)
    datasetVersion = record.datasetVersion
    requireDatasetSourceDownload(user, datasetVersion)
    const source = await fileStore.readVerifiedOriginal({
      storageKey: datasetVersion.sourceStorageKey,
      expectedSize: datasetVersion.sourceSize,
      expectedChecksum: datasetVersion.checksum,
    })
    const filename = safeDownloadFilename(datasetVersion)
    await auditLog.record('dataset_version.source_file_downloaded', {
      actorId: user.id,
      datasetVersionId,
      branchId: datasetVersion.branchId,
      outcome: 'success',
      details: {
        datasetId: datasetVersion.datasetId,
        sourceFilename: filename,
        sourceSize: source.size,
        checksum: source.checksum,
      },
    })
    response.writeHead(200, {
      'content-type': sourceContentType(datasetVersion),
      'content-length': String(source.size),
      'content-disposition': contentDisposition(filename),
      'cache-control': 'private, no-store',
    })
    response.end(source.bytes)
  } catch (error) {
    const appError = asAppError(error)
    const incident = [
      'source_file_missing',
      'source_file_integrity_failed',
      'source_file_reference_invalid',
      'source_file_metadata_invalid',
    ].includes(appError.code)
    await auditLog.record(
      incident
        ? 'dataset_version.source_file_incident'
        : 'dataset_version.source_file_download_failed',
      {
        actorId: user.id,
        datasetVersionId,
        branchId: datasetVersion?.branchId ?? null,
        outcome: incident ? 'incident' : 'denied',
        details: {
          datasetId: datasetVersion?.datasetId ?? null,
          errorCode: appError.code,
        },
      },
    ).catch(() => {})
    throw error
  }
}

function safeDownloadFilename(datasetVersion) {
  try {
    const filename = sanitizeSourceFilename(datasetVersion.sourceFilename)
    const extension = path.extname(filename).toLowerCase()
    if (!['.kml', '.kmz'].includes(extension)) throw new Error('Invalid source extension')
    return filename
  } catch {
    throw new AppError('Metadata nama file sumber tidak valid.', {
      code: 'source_file_metadata_invalid',
      statusCode: 409,
    })
  }
}

function sourceContentType(datasetVersion) {
  return path.extname(datasetVersion.sourceFilename).toLowerCase() === '.kmz'
    ? 'application/vnd.google-earth.kmz'
    : 'application/vnd.google-earth.kml+xml'
}

function imageContentType(extension) {
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  }[String(extension).toLowerCase()] ?? 'application/octet-stream'
}

function contentDisposition(filename) {
  const asciiFilename = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
  const encodedFilename = encodeURIComponent(filename)
    .replace(/['()*]/g, (character) => (
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ))
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
}

function toImportConfigResponse(config) {
  return {
    branches: config.allowedBranchIds.map((branchId) => ({
      id: branchId,
      name: formatBranchName(branchId),
      datasetId: config.datasetIdsByBranch[branchId] ?? null,
    })),
    limits: {
      maxFileSize: config.upload.maxFileSize,
      acceptedExtensions: ['.kml', '.kmz'],
    },
    workflow: {
      requiresOfficialSourceConfirmation: true,
      activatesAutomatically: false,
      supportsCancellationAfterAccepted: false,
    },
  }
}

function toStatusResponse(record) {
  return {
    datasetVersion: withoutInternalStorage(record.datasetVersion),
    processing: record.processing,
    issues: record.issues ?? [],
    validation: record.validation ?? {
      schemaVersion: '1.0.0',
      status: 'pending',
      canActivate: false,
      summary: {
        total: 0,
        errors: 0,
        warnings: 0,
        information: 0,
        blocking: 0,
      },
      facets: {
        severity: {},
        scope: {},
        issueCode: {},
      },
      integrity: {
        datasetVersionId: record.datasetVersion.id,
        branchId: record.datasetVersion.branchId,
        activeVersionUnchanged: true,
        userVisible: false,
        publicationStatus: 'unpublished',
      },
    },
    sourceSelection: record.sourceSelection ?? null,
    sourceStyles: record.sourceStyles ?? { styles: [], styleMaps: [] },
    parserCoverage: record.parserCoverage ?? null,
    readiness: record.readiness ?? null,
    parserVersions: record.parserVersions ?? null,
    sourceOverlays: record.sourceOverlays ?? [],
    sourceResources: record.sourceResources ?? [],
    canActivate: record.validation?.canActivate === true
      && record.datasetVersion.status === 'valid',
    active: record.datasetVersion.status === 'active',
  }
}

function withoutInternalStorage(datasetVersion) {
  const { sourceStorageKey, ...publicVersion } = datasetVersion
  return publicVersion
}

function sendJson(response, statusCode, body, {
  cacheControl = 'no-store',
  headers = {},
  maxBytes,
} = {}) {
  if (response.headersSent) return
  const serialized = JSON.stringify(body)
  const contentLength = Buffer.byteLength(serialized)
  if (maxBytes !== undefined && contentLength > maxBytes) {
    throw new AppError('Response candidate terlalu besar; kurangi limit halaman.', {
      code: 'topology_candidate_response_too_large',
      statusCode: 413,
      details: {
        maxBytes,
        requestedBytes: contentLength,
      },
    })
  }
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl,
    'content-length': String(contentLength),
    ...headers,
  })
  response.end(serialized)
}

function candidateQueryFromUrl(searchParams) {
  return {
    status: searchParams.get('status'),
    site: searchParams.get('site'),
    networkFamily: searchParams.get('networkFamily'),
    minScore: searchParams.get('minScore'),
    cursor: searchParams.get('cursor'),
    limit: searchParams.get('limit'),
  }
}

function entityTagForJson(body) {
  return `"${createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex')
    .slice(0, 32)}"`
}

function ifNoneMatchMatches(header, etag) {
  const value = String(header ?? '').trim()
  return value === '*'
    || value.split(',').map((item) => item.trim()).includes(etag)
}

async function readJsonBody(request) {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    throw new AppError('Request harus menggunakan application/json.', {
      code: 'invalid_content_type',
      statusCode: 415,
    })
  }
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16 * 1024) {
      throw new AppError('Request body terlalu besar.', {
        code: 'request_too_large',
        statusCode: 413,
      })
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new AppError('Request JSON tidak valid.', {
      code: 'invalid_json',
      statusCode: 400,
    })
  }
}

function setSecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
  response.setHeader('referrer-policy', 'no-referrer')
}

function createVersionName(importedAt) {
  return `Import ${importedAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`
}

function formatBranchName(branchId) {
  return String(branchId)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function normalizeOptionalText(value, maxLength, label) {
  const normalized = String(value ?? '').normalize('NFKC').trim()
  if (!normalized) return undefined
  if (normalized.length > maxLength) {
    throw new AppError(`${label} melebihi panjang maksimum.`, {
      code: 'field_too_long',
      statusCode: 400,
      details: { field: label, maxLength },
    })
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AppError(`${label} mengandung karakter yang tidak diperbolehkan.`, {
      code: 'invalid_field_value',
      statusCode: 400,
      details: { field: label },
    })
  }
  return normalized
}

function emptySummary() {
  return {
    totalFolders: 0,
    totalPlacemarks: 0,
    totalAssets: 0,
    totalPoints: 0,
    totalLines: 0,
    totalPolygons: 0,
    totalRelations: 0,
    newAssets: 0,
    updatedAssets: 0,
    unchangedAssets: 0,
    removedAssets: 0,
    errors: 0,
    warnings: 0,
  }
}
