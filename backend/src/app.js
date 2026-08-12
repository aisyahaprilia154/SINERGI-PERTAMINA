import { createHash, randomUUID } from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { AppError, asAppError } from './errors.js'
import { receiveImportUpload } from './http/multipart-upload.js'
import { createOpenFreeMapProxy } from './http/openfreemap-proxy.js'
import { createProcessingRecord } from './import/import-pipeline.js'
import { readKmzResourceBuffer } from './import/kmz-extractor.js'
import {
  requireAdministrator,
  requireBranchAccess,
  requireDatasetSourceDownload,
} from './security/authorization.js'
import {
  sanitizeSourceFilename,
  validateBranchId,
  validateUploadedFile,
} from './import/upload-validation.js'
import { TOPOLOGY_RULE_SET_VERSION } from './topology/semantic-relation-engine.js'
import {
  createFullTopologyRegenerationJobHandler,
  normalizeTopologyRegenerationReason,
} from './topology/topology-service.js'
import { MAX_CANDIDATE_RESPONSE_BYTES } from './topology/topology-candidate-pagination.js'
import { MetricsRegistry, normalizeHttpRoute } from './observability/metrics.js'

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
  metrics,
}) {
  const openFreeMapProxy = createOpenFreeMapProxy({ fetchImpl: basemapFetch })
  const metricsRegistry = metrics ?? new MetricsRegistry({ clock })
  return http.createServer(async (request, response) => {
    setSecurityHeaders(response)
    const correlationId = resolveCorrelationId(request)
    response.setHeader('x-correlation-id', correlationId)
    const url = new URL(request.url, 'http://localhost')
    const metricRoute = normalizeHttpRoute(url.pathname)
    const requestStartedAt = process.hrtime.bigint()
    let requestMetricRecorded = false
    metricsRegistry.incrementGauge(
      'topology_api_inflight_requests',
      {},
      1,
      'Number of HTTP requests currently being handled.',
    )
    const recordRequestMetric = () => {
      if (requestMetricRecorded) return
      requestMetricRecorded = true
      metricsRegistry.incrementGauge(
        'topology_api_inflight_requests',
        {},
        -1,
        'Number of HTTP requests currently being handled.',
      )
      const durationSeconds = Number(process.hrtime.bigint() - requestStartedAt) / 1e9
      metricsRegistry.recordHttpRequest({
        method: request.method,
        route: metricRoute,
        statusCode: response.writableEnded ? response.statusCode : 499,
        durationSeconds,
      })
    }
    response.once('finish', recordRequestMetric)
    response.once('close', recordRequestMetric)

    try {
      if (request.method === 'GET' && url.pathname === '/metrics') {
        if (config?.observability?.metricsEnabled !== true) {
          throw new AppError('Endpoint metrics belum diaktifkan.', {
            code: 'not_found',
            statusCode: 404,
          })
        }
        requireAdministrator(request, authenticator)
        return sendText(response, 200, await metricsRegistry.renderPrometheus(), {
          contentType: 'text/plain; version=0.0.4; charset=utf-8',
        })
      }
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
          correlationId,
        })
      }
      const activeAssetCollectionMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/datasets\/([a-zA-Z0-9_-]+)\/active\/assets$/)
        : null
      if (activeAssetCollectionMatch) {
        const user = authenticator.authenticate(request)
        const datasetId = activeAssetCollectionMatch[1]
        const branchId = normalizeRequiredActiveBranch(url.searchParams.get('branchId'), config)
        requireBranchAccess(user, { datasetId, branchId })
        const siteId = normalizeRequiredActiveScopeId(url.searchParams.get('siteId'), 'Site ID')
        const query = activeAssetQueryFromUrl(url.searchParams)
        query.siteId = [siteId]
        return sendJson(
          response,
          200,
          await lifecycleService.getActiveAssetSearch({
            datasetId,
            branchId,
            query,
            isAdministrator: isAdministratorUser(user),
            canViewSensitive: canReadSensitiveAsset(user),
          }),
        )
      }
      const activeSitesMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/datasets\/([a-zA-Z0-9_-]+)\/active\/sites$/)
        : null
      if (activeSitesMatch) {
        const user = authenticator.authenticate(request)
        const datasetId = activeSitesMatch[1]
        const branchId = normalizeRequiredActiveBranch(url.searchParams.get('branchId'), config)
        requireBranchAccess(user, { datasetId, branchId })
        return sendJson(
          response,
          200,
          await lifecycleService.getActiveSites({ datasetId, branchId }),
        )
      }
      const activeOverlaysMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/datasets\/([a-zA-Z0-9_-]+)\/active\/overlays$/)
        : null
      if (activeOverlaysMatch) {
        const user = authenticator.authenticate(request)
        const datasetId = activeOverlaysMatch[1]
        const branchId = normalizeRequiredActiveBranch(url.searchParams.get('branchId'), config)
        requireBranchAccess(user, { datasetId, branchId })
        const siteId = url.searchParams.has('siteId')
          ? normalizeRequiredActiveScopeId(url.searchParams.get('siteId'), 'Site ID')
          : null
        return sendJson(
          response,
          200,
          await lifecycleService.getActiveOverlays({ datasetId, branchId, siteId }),
        )
      }
      const activeKmlExportMatch = request.method === 'POST'
        ? url.pathname.match(/^\/api\/datasets\/([a-zA-Z0-9_-]+)\/active\/exports\/kml$/)
        : null
      if (activeKmlExportMatch) {
        const user = authenticator.authenticate(request)
        const datasetId = activeKmlExportMatch[1]
        const body = await readJsonBody(request)
        const branchId = normalizeRequiredActiveBranch(
          body.branchId ?? url.searchParams.get('branchId'),
          config,
        )
        requireBranchAccess(user, { datasetId, branchId })
        const query = normalizeActiveExportBody(body)
        const exported = await lifecycleService.exportActiveDatasetKml({
          datasetId,
          branchId,
          query,
          isAdministrator: isAdministratorUser(user),
        })
        return sendActiveKml(response, exported)
      }
      const activeAssetMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/datasets\/([a-zA-Z0-9_-]+)\/active\/assets\/([^/]+)$/)
        : null
      if (activeAssetMatch) {
        const user = authenticator.authenticate(request)
        const datasetId = activeAssetMatch[1]
        const branchId = normalizeRequiredActiveBranch(url.searchParams.get('branchId'), config)
        requireBranchAccess(user, { datasetId, branchId })
        return sendJson(
          response,
          200,
          await lifecycleService.getActiveAssetDetail({
            datasetId,
            branchId,
            siteId: url.searchParams.has('siteId')
              ? normalizeRequiredActiveScopeId(url.searchParams.get('siteId'), 'Site ID')
              : null,
            assetId: normalizeAssetId(decodePathSegment(activeAssetMatch[2])),
            isAdministrator: isAdministratorUser(user),
            canViewSensitive: canReadSensitiveAsset(user),
          }),
        )
      }
      const activeDatasetMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/datasets\/([a-zA-Z0-9_-]+)\/active$/)
        : null
      if (activeDatasetMatch) {
        const user = authenticator.authenticate(request)
        const datasetId = activeDatasetMatch[1]
        const context = {
          datasetId,
          branchId: normalizeRequiredActiveBranch(url.searchParams.get('branchId'), config),
          siteId: url.searchParams.has('siteId')
            ? normalizeRequiredActiveScopeId(url.searchParams.get('siteId'), 'Site ID')
            : null,
        }
        requireBranchAccess(user, context)
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
      const topologyRootsMatch = request.method === 'GET'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/roots$/,
        )
        : null
      if (topologyRootsMatch) {
        const preview = url.searchParams.get('preview') === 'true'
        const user = preview
          ? requireAdministrator(request, authenticator)
          : authenticator.authenticate(request)
        assertTopologyService(topologyService)
        await assertTopologyVersionAccess(
          repository,
          user,
          topologyRootsMatch[1],
          { preview },
        )
        const roots = await topologyService.getRoots(topologyRootsMatch[1], {
          graphRevision: url.searchParams.get('graphRevision'),
        })
        return sendJson(response, 200, preview
          ? { ...roots, preview: true, publicationStatus: 'unpublished' }
          : roots)
      }
      const topologyTraceMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/trace$/,
        )
        : null
      if (topologyTraceMatch) {
        const preview = url.searchParams.get('preview') === 'true'
        const user = preview
          ? requireAdministrator(request, authenticator)
          : authenticator.authenticate(request)
        assertTopologyService(topologyService)
        await assertTopologyVersionAccess(
          repository,
          user,
          topologyTraceMatch[1],
          { preview },
        )
        const body = await readJsonBody(request)
        const traceArgs = [topologyTraceMatch[1], body, user.id, correlationId]
        if (preview) traceArgs.push({ preview: true, actorRole: user.role })
        return sendJson(
          response,
          200,
          await topologyService.trace(...traceArgs),
        )
      }
      const topologyImpactMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/impact$/,
        )
        : null
      if (topologyImpactMatch) {
        const preview = url.searchParams.get('preview') === 'true'
        const user = preview
          ? requireAdministrator(request, authenticator)
          : authenticator.authenticate(request)
        assertTopologyService(topologyService)
        await assertTopologyVersionAccess(
          repository,
          user,
          topologyImpactMatch[1],
          { preview },
        )
        const body = await readJsonBody(request)
        const impactArgs = [topologyImpactMatch[1], body, user.id, correlationId]
        if (preview) impactArgs.push({ preview: true, actorRole: user.role })
        return sendJson(
          response,
          200,
          await topologyService.impact(...impactArgs),
        )
      }
      const topologyReviewPreviewMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/review-preview$/,
        )
        : null
      if (topologyReviewPreviewMatch) {
        requireAdministrator(request, authenticator)
        assertTopologyService(topologyService)
        const body = await readJsonBody(request)
        return sendJson(
          response,
          200,
          await topologyService.reviewPreview(topologyReviewPreviewMatch[1], body),
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
        assertDurableJobQueue(jobQueue)
        const body = await readJsonBody(request)
        const datasetVersionId = regenerateTopologyMatch[1]
        const current = await repository.get(datasetVersionId)
        const reason = normalizeTopologyRegenerationReason(body.reason)
        const fingerprintInput = JSON.stringify({
          datasetVersionId,
          recordRevision: Number.isInteger(current.recordRevision)
            ? current.recordRevision
            : 0,
          topologyGeneratedAt: current.topologyGeneratedAt ?? null,
          reason,
        })
        const inputFingerprint = `sha256:${createHash('sha256')
          .update(fingerprintInput)
          .digest('hex')}`
        const requestedIdempotencyKey = normalizeOptionalText(
          request.headers['idempotency-key'],
          256,
          'Idempotency-Key',
        )
        const idempotencyKey = requestedIdempotencyKey
          ? `regenerate:${createHash('sha256')
            .update(`${requestedIdempotencyKey}|${inputFingerprint}`)
            .digest('hex')}`
          : undefined
        const queuedJob = await jobQueue.enqueue({
          jobType: 'regenerate_full_topology',
          datasetVersionId,
          inputFingerprint,
          ruleSetVersion: TOPOLOGY_RULE_SET_VERSION,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          payload: {
            actorId: user.id,
            reason,
            correlationId,
          },
          handler: createFullTopologyRegenerationJobHandler(topologyService),
        })
        await auditLog.record('topology.regeneration_queued', {
          actorId: user.id,
          datasetVersionId,
          branchId: current.datasetVersion?.branchId ?? null,
          correlationId,
          outcome: queuedJob.deduplicated ? 'deduplicated' : 'queued',
          details: {
            jobId: queuedJob.jobId,
            jobType: queuedJob.jobType,
            inputFingerprint,
            reason,
            graphRevision: current.topologyGraph?.graphRevision ?? null,
          },
        })
        return sendJson(response, queuedJob.deduplicated ? 200 : 202, {
          datasetVersionId,
          job: await jobQueue.getPublic(queuedJob.jobId),
          statusUrl: `/api/admin/jobs/${queuedJob.jobId}`,
          message: queuedJob.deduplicated
            ? 'Permintaan regenerasi yang sama sudah ada di durable queue.'
            : 'Regenerasi topology diterima dan diproses di background.',
        })
      }
      const bulkTopologyActionMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/dataset-versions\/([a-zA-Z0-9_-]+)\/topology\/(confirm-all|confirm-selected|confirm-line-labels|revoke-all)$/,
        )
        : null
      if (bulkTopologyActionMatch) {
        const user = requireAdministrator(request, authenticator)
        assertTopologyService(topologyService)
        const body = await readJsonBody(request)
        const mutationInput = {
          ...body,
          correlationId,
          ...(request.headers['idempotency-key'] !== undefined
            ? { idempotencyKey: request.headers['idempotency-key'] }
            : {}),
        }
        const method = {
          'confirm-all': 'confirmAllCandidates',
          'confirm-selected': 'confirmSelectedCandidates',
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
          correlationId,
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
          correlationId,
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
          correlationId,
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
          correlationId,
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
      const comparisonMatch = request.method === 'GET'
        ? url.pathname.match(/^\/api\/admin\/imports\/([a-zA-Z0-9_-]+)\/comparison$/)
        : null
      if (comparisonMatch) {
        requireAdministrator(request, authenticator)
        return sendJson(
          response,
          200,
          await lifecycleService.getComparison(comparisonMatch[1], {
            risk: normalizeQueryEnum(url.searchParams.get('risk'), ['low', 'medium', 'high']),
            type: normalizeQueryText(url.searchParams.get('type')),
            limit: normalizeQueryLimit(url.searchParams.get('limit')),
            cursor: normalizeQueryText(url.searchParams.get('cursor')),
          }),
        )
      }
      const identityAssignmentsMatch = request.method === 'POST'
        ? url.pathname.match(
          /^\/api\/admin\/imports\/([a-zA-Z0-9_-]+)\/identity-assignments$/,
        )
        : null
      if (identityAssignmentsMatch) {
        const user = requireAdministrator(request, authenticator)
        const body = await readJsonBody(request)
        return sendJson(
          response,
          200,
          await lifecycleService.assignIdentityAssignments(identityAssignmentsMatch[1], user.id, {
            assignments: body.assignments,
            expectedRecordRevision: normalizeExpectedRecordRevision(body),
            idempotencyKey: request.headers['idempotency-key'] ?? null,
            correlationId,
          }),
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
            expectedRecordRevision: normalizeExpectedRecordRevision(body),
            expectedActivePointerRevision: normalizeExpectedActivePointerRevision(body),
            publicationProfile: normalizePublicationProfileBody(body),
            confirmBreakingChanges: body.confirmBreakingChanges === true,
            correlationId,
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
            {
              expectedActiveVersionId: body.expectedActiveVersionId,
              correlationId,
            },
          ),
        )
      }
      const rejectionMatch = request.method === 'POST'
        ? url.pathname.match(/^\/api\/admin\/imports\/([a-zA-Z0-9_-]+)\/reject$/)
        : null
      if (rejectionMatch) {
        const user = requireAdministrator(request, authenticator)
        const hasJsonBody = Boolean(request.headers['content-type'])
        const body = hasJsonBody
          ? await readJsonBody(request)
          : {}
        return sendJson(
          response,
          200,
          await lifecycleService.reject(rejectionMatch[1], user.id, {
            reason: normalizeRejectReason(body, { allowLegacyDefault: !hasJsonBody }),
            correlationId,
          }),
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
          correlationId,
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
          correlationId,
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

async function assertTopologyVersionAccess(
  repository,
  user,
  datasetVersionId,
  { preview = false } = {},
) {
  if (preview || !repository?.get) return
  const record = await repository.get(datasetVersionId)
  requireBranchAccess(user, {
    datasetId: record.datasetVersion?.datasetId,
    branchId: record.datasetVersion?.branchId,
  })
  if (typeof repository.resolveActiveVersion !== 'function') return
  const active = await repository.resolveActiveVersion({
    datasetId: record.datasetVersion?.datasetId,
    branchId: record.datasetVersion?.branchId,
  })
  if (!active || active.record?.datasetVersion?.id !== datasetVersionId) {
    throw new AppError('Topology viewer hanya dapat membaca dataset version aktif.', {
      code: 'topology_version_not_active',
      statusCode: 409,
      details: {
        datasetVersionId,
        activeDatasetVersionId: active?.record?.datasetVersion?.id ?? null,
      },
    })
  }
}

function assertDurableJobQueue(jobQueue) {
  if (!jobQueue
    || typeof jobQueue.getPublic !== 'function'
    || typeof jobQueue.enqueue !== 'function') {
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

function normalizeRejectReason(body, { allowLegacyDefault = false } = {}) {
  if (body.reason === undefined || body.reason === null || body.reason === '') {
    if (allowLegacyDefault) return 'Ditolak oleh administrator.'
    throw new AppError('Alasan reject wajib diberikan.', {
      code: 'rejection_reason_required',
      statusCode: 400,
    })
  }
  const reason = String(body.reason).trim()
  if (!reason || reason.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) {
    throw new AppError('Alasan reject tidak valid.', {
      code: 'invalid_rejection_reason',
      statusCode: 400,
    })
  }
  return reason
}

function normalizeExpectedRecordRevision(body) {
  if (!Object.hasOwn(body, 'expectedRecordRevision')) return undefined
  const value = Number(body.expectedRecordRevision)
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError('Expected record revision tidak valid.', {
      code: 'invalid_expected_record_revision',
      statusCode: 400,
    })
  }
  return value
}

function normalizeExpectedActivePointerRevision(body) {
  if (!Object.hasOwn(body, 'expectedActivePointerRevision')) return undefined
  if (body.expectedActivePointerRevision === null) return null
  const value = String(body.expectedActivePointerRevision)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value)) {
    throw new AppError('Expected active pointer revision tidak valid.', {
      code: 'invalid_expected_active_pointer_revision',
      statusCode: 400,
    })
  }
  return value
}

function normalizePublicationProfileBody(body) {
  if (!Object.hasOwn(body, 'publicationProfile')) return undefined
  const value = String(body.publicationProfile ?? '').trim().toLowerCase()
  if (!['map_only', 'operational_topology'].includes(value)) {
    throw new AppError('Publication profile tidak valid.', {
      code: 'invalid_publication_profile',
      statusCode: 400,
    })
  }
  return value
}

function normalizeQueryEnum(value, allowed) {
  if (value === null || value === '') return undefined
  return allowed.includes(value) ? value : undefined
}

function normalizeQueryText(value) {
  if (value === null || value === '') return undefined
  return String(value).slice(0, 512)
}

function normalizeQueryLimit(value) {
  if (value === null || value === '') return 50
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new AppError('Limit comparison tidak valid.', {
      code: 'invalid_comparison_limit',
      statusCode: 400,
    })
  }
  return limit
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

function normalizeRequiredActiveBranch(value, config = {}) {
  if (value === null || value === undefined || value === '') {
    if (!config?.allowedBranchIds?.length) return undefined
    throw new AppError('Branch ID wajib untuk membaca dataset aktif.', {
      code: 'branch_required',
      statusCode: 400,
    })
  }
  const branchId = normalizeActiveBranch(String(value))
  if (config?.allowedBranchIds?.length && !config.allowedBranchIds.includes(branchId)) {
    throw new AppError('Branch ID tidak diizinkan.', {
      code: 'branch_not_allowed',
      statusCode: 400,
    })
  }
  return branchId
}

function normalizeRequiredActiveScopeId(value, label) {
  const normalized = String(value ?? '').normalize('NFKC').trim()
  if (!normalized || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(normalized)) {
    throw new AppError(`${label} wajib dan tidak valid.`, {
      code: 'invalid_active_scope',
      statusCode: 400,
    })
  }
  return normalized
}

function activeAssetQueryFromUrl(searchParams) {
  const list = (key) => searchParams.getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => String(value).normalize('NFKC').trim())
    .filter(Boolean)
  const limit = searchParams.get('limit')
  if (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 200)) {
    throw new AppError('Limit asset aktif tidak valid.', {
      code: 'invalid_active_asset_limit',
      statusCode: 400,
    })
  }
  const boundsValue = searchParams.get('bounds')
  const bounds = boundsValue
    ? parseActiveBounds(boundsValue)
    : parseActiveBoundsFromParts(searchParams)
  return {
    q: searchParams.get('q') ?? undefined,
    siteId: list('siteId'),
    networkFamily: list('networkFamily'),
    category: list('category'),
    assetType: list('assetType'),
    sourceStatus: list('sourceStatus'),
    identityStatus: list('identityStatus'),
    topologyStatus: list('topologyStatus'),
    bounds,
    cursor: searchParams.get('cursor') ?? undefined,
    limit: limit === null ? undefined : Number(limit),
    includeVisualOnly: searchParams.get('includeVisualOnly') === 'true',
    assetIds: list('assetId'),
  }
}

function normalizeActiveExportBody(body = {}) {
  const list = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.normalize('NFKC').trim())
    .filter(Boolean)
  return {
    q: body.q,
    siteId: list(body.siteId),
    networkFamily: list(body.networkFamily),
    category: list(body.category),
    assetType: list(body.assetType),
    sourceStatus: list(body.sourceStatus),
    identityStatus: list(body.identityStatus),
    topologyStatus: list(body.topologyStatus),
    bounds: body.bounds ?? null,
    assetIds: list(body.assetIds ?? body.assetId),
    includeVisualOnly: body.includeVisualOnly === true,
  }
}

function parseActiveBounds(value) {
  const values = String(value).split(',').map(Number)
  if (values.length !== 4 || values.some((item) => !Number.isFinite(item))) {
    throw new AppError('Bounds geografis tidak valid.', {
      code: 'invalid_active_bounds',
      statusCode: 400,
    })
  }
  return { west: values[0], south: values[1], east: values[2], north: values[3] }
}

function parseActiveBoundsFromParts(searchParams) {
  const keys = ['west', 'south', 'east', 'north']
  if (!keys.some((key) => searchParams.has(key))) return null
  return parseActiveBounds(keys.map((key) => searchParams.get(key)).join(','))
}

function isAdministratorUser(user) {
  return user?.role?.toLowerCase() === 'administrator'
}

function canReadSensitiveAsset(user) {
  return isAdministratorUser(user)
    || user?.permissions?.includes('asset:network:read')
    || user?.permissions?.includes('dataset:network:read')
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
  correlationId,
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
    const duplicateVersions = (await repository.list()).filter((record) => (
      record.datasetVersion?.datasetId === datasetId
        && record.datasetVersion?.branchId === branchId
        && record.datasetVersion?.checksum === upload.checksum
    ))

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
      ...(duplicateVersions.length ? {
        duplicateSourceChecksum: true,
        duplicateSourceChecksumVersionIds: duplicateVersions.map(({ datasetVersion: version }) => version.id),
      } : {}),
      status: 'processing',
      summary: emptySummary(),
    }
    const processingRecord = createProcessingRecord(datasetVersion, clock)
    await repository.create(processingRecord)
    await auditLog.record('dataset_import.upload_accepted', {
      actorId: user.id,
      datasetVersionId,
      branchId,
      correlationId,
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
          correlationId,
        },
        handler: ({ sourceStorageKey, extension, actorId, correlationId: jobCorrelationId }, {
          job,
          updateProgress,
        }) => importPipeline.process({
          datasetVersionId,
          sourcePath: fileStore.resolveOriginalPath(sourceStorageKey),
          extension,
          actorId,
          correlationId: jobCorrelationId,
          jobId: job.jobId,
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
      correlationId,
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
  correlationId,
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
      correlationId,
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
        correlationId,
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
      publicationProfiles: ['map_only', 'operational_topology'],
      frontendUsesBackendPublishability: true,
      highRiskActivationRequiresConfirmation: true,
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
    publicationStatus: record.datasetVersion.publicationStatus ?? 'unpublished',
    publicationProfile: record.datasetVersion.publicationProfile ?? null,
    publishableProfiles: record.readiness?.publishableProfiles ?? [],
    comparisonSummary: record.comparisonSummary ?? null,
    links: {
      preview: `/api/admin/imports/${encodeURIComponent(record.datasetVersion.id)}/preview`,
      comparison: `/api/admin/imports/${encodeURIComponent(record.datasetVersion.id)}/comparison`,
    },
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

function sendText(response, statusCode, body, {
  contentType = 'text/plain; charset=utf-8',
  cacheControl = 'no-store',
} = {}) {
  if (response.headersSent) return
  const serialized = String(body ?? '')
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': cacheControl,
    'content-length': String(Buffer.byteLength(serialized)),
  })
  response.end(serialized)
}

function sendActiveKml(response, exported) {
  const serialized = String(exported.content ?? '')
  response.writeHead(200, {
    'content-type': 'application/vnd.google-earth.kml+xml; charset=utf-8',
    'content-disposition': contentDisposition(exported.filename),
    'cache-control': 'private, no-store',
    'content-length': String(Buffer.byteLength(serialized)),
    'x-dataset-version-id': String(exported.datasetVersionId ?? ''),
    'x-active-pointer-revision': String(exported.activePointerRevision ?? ''),
  })
  response.end(serialized)
}

function candidateQueryFromUrl(searchParams) {
  return {
    status: searchParams.get('status'),
    site: searchParams.get('site'),
    networkFamily: searchParams.get('networkFamily'),
    candidateType: searchParams.get('candidateType'),
    proposalStatus: searchParams.get('proposalStatus'),
    minScore: searchParams.get('minScore'),
    maxScore: searchParams.get('maxScore'),
    minDistance: searchParams.get('minDistance'),
    maxDistance: searchParams.get('maxDistance'),
    assetSearch: searchParams.get('assetSearch') ?? searchParams.get('q'),
    requiredTopologyOnly: searchParams.get('requiredTopologyOnly'),
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

function resolveCorrelationId(request) {
  const supplied = String(request.headers['x-correlation-id'] ?? '').trim()
  if (/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(supplied)) return supplied
  return randomUUID()
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
