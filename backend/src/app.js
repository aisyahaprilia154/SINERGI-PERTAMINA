import http from 'node:http'
import path from 'node:path'
import { AppError, asAppError } from './errors.js'
import { receiveImportUpload } from './http/multipart-upload.js'
import { createProcessingRecord } from './import/import-pipeline.js'
import {
  requireAdministrator,
  requireDatasetSourceDownload,
} from './security/authorization.js'
import {
  sanitizeSourceFilename,
  validateBranchId,
  validateUploadedFile,
} from './import/upload-validation.js'

export function createApp({
  config,
  authenticator,
  repository,
  fileStore,
  auditLog,
  jobQueue,
  importPipeline,
  lifecycleService,
  clock = () => new Date(),
}) {
  return http.createServer(async (request, response) => {
    setSecurityHeaders(response)
    const url = new URL(request.url, 'http://localhost')

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { status: 'ok' })
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
      const relationReviewMatch = request.method === 'GET'
        ? url.pathname.match(
          /^\/api\/admin\/dataset-versions\/([a-zA-Z0-9_-]+)\/relation-review$/,
        )
        : null
      if (relationReviewMatch) {
        requireAdministrator(request, authenticator)
        return sendJson(
          response,
          200,
          await lifecycleService.getRelationReview(relationReviewMatch[1], {
            siteScopeId: normalizeSiteScopeId(url.searchParams.get('siteScopeId')),
          }),
        )
      }
      const relationDecisionMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/admin\/dataset-versions\/([a-zA-Z0-9_-]+)\/relations\/([^/]+)\/review$/,
        )
        : null
      if (relationDecisionMatch) {
        const user = requireAdministrator(request, authenticator)
        const body = await readJsonBody(request)
        return sendJson(
          response,
          200,
          await lifecycleService.reviewRelation(
            relationDecisionMatch[1],
            normalizeRelationId(decodePathSegment(relationDecisionMatch[2])),
            {
              decision: body.decision,
              siteScopeId: normalizeSiteScopeId(body.siteScopeId),
              note: normalizeOptionalReviewNote(body.note),
            },
            user.id,
          ),
        )
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

function normalizeRelationId(value) {
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f/\\]/.test(value)) {
    throw new AppError('Relation ID tidak valid.', {
      code: 'invalid_relation_id',
      statusCode: 400,
    })
  }
  return value
}

function normalizeSiteScopeId(value) {
  const normalized = String(value ?? 'pengapon').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new AppError('Site scope ID tidak valid.', {
      code: 'invalid_site_scope_id',
      statusCode: 400,
    })
  }
  return normalized
}

function normalizeOptionalReviewNote(value) {
  return normalizeOptionalText(value, 500, 'Catatan review')
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

    jobQueue.enqueue(() => importPipeline.process({
      datasetVersionId,
      sourcePath: storedSource.absolutePath,
      extension: validated.extension,
      actorId: user.id,
    }))

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
    canActivate: record.validation?.canActivate === true
      && record.datasetVersion.status === 'valid',
    active: record.datasetVersion.status === 'active',
  }
}

function withoutInternalStorage(datasetVersion) {
  const { sourceStorageKey, ...publicVersion } = datasetVersion
  return publicVersion
}

function sendJson(response, statusCode, body) {
  if (response.headersSent) return
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
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
