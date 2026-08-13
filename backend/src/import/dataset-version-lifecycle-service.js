import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '../errors.js'
import {
  AUTOMATIC_IDENTITY_ACTOR,
  buildCanonicalAssetIdentityMap,
  buildAssetIdentityMapFromRecord,
  createAssetIdentityResolver,
  createAutomaticIdentityRegistry,
} from '../domain/canonical-asset-identity.js'
import {
  buildIdentityIssues,
  buildTopologyInputBundle,
} from '../domain/parser-contract.js'

import {
  buildReadinessContract as buildPublicationReadinessContract,
  isProfilePublishable,
  normalizePublicationProfile,
  publicationCapabilities,
} from '../domain/publication-contract.js'
import {
  compareCanonicalDatasetVersions,
  paginateDatasetDiff,
} from '../domain/dataset-version-diff.js'
import { normalizeTopologySummary } from '../topology/semantic-relation-engine.js'
import { withTopologyGraphRevision } from '../topology/topology-graph-revision.js'
import {
  buildActiveAssetCatalog,
  buildActiveCapabilities,
  buildActiveOverlayDescriptors,
  buildActiveSites,
  buildActiveSummary,
  queryActiveAssets,
} from '../domain/active-dataset-query.js'
import {
  safeActiveKmlFilename,
  serializeActiveDatasetKml,
} from '../domain/active-dataset-kml.js'

const AUTOMATIC_IDENTITY_ASSIGNMENT_LIMIT = 5000

export class DatasetVersionLifecycleService {
  constructor({
    repository,
    auditLog,
    activeDatasetCache = null,
    clock = () => new Date(),
    siteBoundaries = {},
  }) {
    this.repository = repository
    this.auditLog = auditLog
    this.activeDatasetCache = activeDatasetCache
    this.clock = clock
    this.siteBoundaries = siteBoundaries
  }

  async getPreview(datasetVersionId) {
    const candidate = await this.repository.get(datasetVersionId)
    const active = await this.repository.findActive(
      candidate.datasetVersion.datasetId,
      {
        excludeId: datasetVersionId,
        branchId: candidate.datasetVersion.branchId,
      },
    )
    const comparison = compareDatasetVersions(candidate, active)
    return {
      datasetVersion: withoutInternalStorage(candidate.datasetVersion),
      validation: candidate.validation,
      issues: candidate.issues ?? [],
      layers: candidate.layers ?? [],
      assets: candidate.assets ?? [],
      geometries: candidate.geometries ?? [],
      relations: candidate.relations ?? [],
      sourceStyles: candidate.sourceStyles ?? { styles: [], styleMaps: [] },
      sourceFeatures: candidate.sourceFeatures ?? [],
      sourceGeometries: candidate.sourceGeometries ?? [],
      sourceMetadataEntries: candidate.sourceMetadataEntries ?? [],
      sourceOverlays: candidate.sourceOverlays ?? [],
      sourceResources: candidate.sourceResources ?? [],
      classifiedObjects: candidate.classifiedObjects ?? [],
      assetIdentityMap: candidate.assetIdentityMap
        ?? candidate.canonicalParser?.assetIdentityMap
        ?? null,
      topologyInputBundle: candidate.topologyInputBundle ?? null,
      parserCoverage: candidate.parserCoverage ?? null,
      readiness: candidate.readiness ?? null,
      parserVersions: candidate.parserVersions ?? null,
      sourceSelection: candidate.sourceSelection ?? null,
      comparison,
      comparisonSummary: comparison.summary,
      publishableProfiles: candidate.readiness?.publishableProfiles ?? [],
      publicationStatus: candidate.datasetVersion.publicationStatus ?? 'unpublished',
      publicationProfile: candidate.datasetVersion.publicationProfile ?? null,
      links: {
        comparison: `/api/admin/imports/${encodeURIComponent(datasetVersionId)}/comparison`,
        readiness: `/api/dataset-versions/${encodeURIComponent(datasetVersionId)}/readiness`,
      },
      activeDatasetVersion: active
        ? {
          datasetVersion: withoutInternalStorage(active.datasetVersion),
          layers: active.layers ?? [],
          assets: active.assets ?? [],
          geometries: active.geometries ?? [],
          relations: active.relations ?? [],
        }
        : null,
      canActivate: canActivate(candidate),
      readOnly: true,
    }
  }

  async getComparison(datasetVersionId, filters = {}) {
    const candidate = await this.repository.get(datasetVersionId)
    const active = await this.repository.findActive(
      candidate.datasetVersion.datasetId,
      {
        excludeId: datasetVersionId,
        branchId: candidate.datasetVersion.branchId,
      },
    )
    return paginateDatasetDiff(
      compareDatasetVersions(candidate, active),
      filters,
    )
  }

  async assignIdentityAssignments(datasetVersionId, actorId, {
    assignments = [],
    expectedRecordRevision,
    idempotencyKey = null,
    correlationId = null,
    maxItems = 500,
  } = {}) {
    const normalizedAssignments = normalizeIdentityAssignments(assignments, { maxItems })
    const requestFingerprint = fingerprint(normalizedAssignments)
    const current = await this.repository.get(datasetVersionId)
    const existingReceipt = findIdentityAssignmentReceipt(
      current.identityAssignmentReceipts,
      idempotencyKey,
    )
    if (existingReceipt) {
      if (existingReceipt.fingerprint !== requestFingerprint) {
        throw new AppError('Idempotency key sudah digunakan untuk batch berbeda.', {
          code: 'idempotency_key_reused',
          statusCode: 409,
          details: { idempotencyKey },
        })
      }
      return structuredClone(existingReceipt.response)
    }

    validateIdentityAssignmentBatch(current, normalizedAssignments)
    const auditEventId = randomUUID()
    let committed = null
    try {
      committed = await this.repository.update(
        datasetVersionId,
        (record) => applyIdentityAssignmentBatch({
          record,
          assignments: normalizedAssignments,
          actorId,
          approvedAt: this.clock().toISOString(),
          auditEventId,
          idempotencyKey,
          requestFingerprint,
        }),
        {
          expectedRevision: expectedRecordRevision
            ?? normalizeRecordRevision(current.recordRevision),
        },
      )
    } catch (error) {
      if (error.code === 'dataset_version_stale_revision') {
        const latest = await this.repository.get(datasetVersionId)
        const replay = findIdentityAssignmentReceipt(
          latest.identityAssignmentReceipts,
          idempotencyKey,
        )
        if (replay?.fingerprint === requestFingerprint) {
          return structuredClone(replay.response)
        }
      }
      await this.auditLog.record('dataset_version.identity_assignment_failed', {
        actorId,
        datasetVersionId,
        branchId: current.datasetVersion.branchId,
        correlationId,
        outcome: 'failed',
        details: {
          auditEventId,
          idempotencyKey,
          errorCode: error.code ?? error.name,
          assignmentCount: normalizedAssignments.length,
        },
      }).catch(() => {})
      throw error
    }

    const audit = await this.auditLog.record('dataset_version.identity_assigned', {
      eventId: auditEventId,
      actorId,
      datasetVersionId,
      branchId: committed.datasetVersion.branchId,
      correlationId,
      outcome: 'committed',
      details: {
        auditEventId,
        idempotencyKey,
        assignmentCount: normalizedAssignments.length,
        affectedSourceFeatureIds: normalizedAssignments.map(({ sourceFeatureId }) => sourceFeatureId),
        recordRevision: committed.recordRevision,
      },
    }).catch(() => null)
    const response = {
      datasetVersionId,
      recordRevision: committed.recordRevision,
      state: 'updated',
      affectedSourceFeatureIds: normalizedAssignments.map(({ sourceFeatureId }) => sourceFeatureId),
      affectedAssetIds: affectedAssetIds(committed, normalizedAssignments),
      identityRegistry: structuredClone(
        committed.assetIdentityRegistry ?? committed.identityRegistry ?? [],
      ),
      identityCoverage: committed.readiness?.inventory?.coverage ?? {},
      readiness: committed.readiness ?? null,
      auditEventId: audit?.id ?? auditEventId,
    }
    return response
  }

  async autoAssignUniqueIdentityAssignments(datasetVersionId, {
    expectedRecordRevision,
    idempotencyKey = null,
    correlationId = null,
  } = {}) {
    const current = await this.repository.get(datasetVersionId)
    const proposal = createAutomaticIdentityRegistry({
      datasetVersion: current.datasetVersion,
      sourceFeatures: current.sourceFeatures ?? [],
      classifiedObjects: current.classifiedObjects ?? [],
      identityRegistry: current.assetIdentityRegistry ?? current.identityRegistry ?? [],
    })
    const assignments = [
      ...proposal.assignments,
      ...proposal.linkedAssignments,
      ...proposal.backfillAssignments,
    ]
    if (!assignments.length) {
      return {
        datasetVersionId,
        recordRevision: normalizeRecordRevision(current.recordRevision),
        state: 'no_changes',
        automaticIdentity: {
          generatedCount: 0,
          linkedCount: 0,
          backfilledCount: 0,
          skipped: structuredClone(proposal.skipped),
        },
        identityCoverage: current.readiness?.inventory?.coverage ?? {},
        readiness: current.readiness ?? null,
      }
    }
    const requestKey = idempotencyKey
      ?? `identity-auto:${datasetVersionId}:${normalizeRecordRevision(current.recordRevision)}:${fingerprint(
        assignments,
      )}`
    const result = await this.assignIdentityAssignments(
      datasetVersionId,
      AUTOMATIC_IDENTITY_ACTOR,
      {
        assignments,
        expectedRecordRevision: expectedRecordRevision
          ?? normalizeRecordRevision(current.recordRevision),
        idempotencyKey: requestKey,
        correlationId,
        maxItems: AUTOMATIC_IDENTITY_ASSIGNMENT_LIMIT,
      },
    )
    return {
      ...result,
      automaticIdentity: {
        generatedCount: proposal.assignments.length,
        linkedCount: proposal.linkedAssignments.length,
        backfilledCount: proposal.backfillAssignments.length,
        skipped: structuredClone(proposal.skipped),
      },
    }
  }

  async getActiveDataset({ datasetId, branchId } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    const record = resolved.record
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const resolver = createAssetIdentityResolver(identityMap)
    const topology = normalizeTopologyGraph(record, identityMap)
    const readinessContract = buildReadinessContract(record, topology.graph)
    const publicationProfile = activePublicationProfile(record, resolved.pointer)
    const catalog = buildActiveAssetCatalog({
      record,
      identityMap,
      topologyGraph: topology.graph,
      publicationProfile,
    })
    const sites = buildActiveSites({
      catalog,
      record,
      siteBoundaries: this.siteBoundaries,
    })
    const overlays = buildActiveOverlayDescriptors({
      record,
      datasetVersionId: record.datasetVersion.id,
    })
    const capabilities = buildActiveCapabilities({
      publicationProfile,
      readiness: readinessContract,
    })
    return {
      activePointer: resolved.pointer,
      datasetVersion: publicDatasetVersion(record.datasetVersion, resolved.pointer),
      layers: record.layers ?? [],
      assets: (record.assets ?? []).map((asset) => (
        projectAssetIdentity(asset, identityMap, resolver)
      )),
      geometries: record.geometries ?? [],
      relations: filterResolvedRelations(record, resolver),
      topologyGraph: topology.graph,
      topologySummary: normalizeTopologySummary(
        record.topologySummary,
        topology.graph,
        record.confirmedRelations,
      ),
      topologyReadiness: record.topologyReadiness ?? null,
      topologyIdentity: topology.identity,
      assetIdentityMap: identityMap,
      readiness: record.readiness ?? null,
      readinessContract,
      mapReady: readinessContract.mapReady !== 'not_ready',
      inventoryReady: readinessContract.inventoryReady !== 'not_ready',
      topologyReady: readinessContract.topologyReady === 'ready',
      publicationStatus: readinessContract.publicationStatus,
      context: activeContext(record, resolved.pointer, null, publicationProfile),
      publicationProfile,
      sites,
      overlays,
      summary: buildActiveSummary({
        catalog,
        sites,
        record,
        topologyGraph: topology.graph,
        overlays,
      }),
      capabilities,
    }
  }

  async getActiveMapDataset({ datasetId, branchId, siteId = null } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    return toActiveMapDataset(resolved, {
      siteId,
      siteBoundaries: this.siteBoundaries,
    })
  }

  async getActiveAssetDetail({
    datasetId,
    branchId,
    assetId,
    siteId = null,
    isAdministrator = false,
    canViewSensitive = false,
  } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    const record = resolved.record
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const resolver = createAssetIdentityResolver(identityMap)
    const topology = normalizeTopologyGraph(record, identityMap)
    const readinessContract = buildReadinessContract(record, topology.graph)
    const publicationProfile = activePublicationProfile(record, resolved.pointer)
    const catalog = buildActiveAssetCatalog({
      record,
      identityMap,
      topologyGraph: topology.graph,
      publicationProfile,
    })
    const item = catalog.find((candidate) => candidate._aliases.has(String(assetId)))
    if (!item) {
      throw new AppError('Aset tidak ditemukan pada dataset aktif.', {
        code: 'asset_not_present_in_active_version',
        statusCode: 404,
      })
    }
    if (siteId && item.siteId !== siteId) {
      throw new AppError('Aset tidak tersedia pada site aktif yang dipilih.', {
        code: 'active_asset_not_present_in_site',
        statusCode: 404,
      })
    }
    const canonicalAssetId = item.canonicalAssetId
    const asset = item.rawAsset
    const relations = filterResolvedRelations(record, resolver)
      .filter((relation) => (
        relation.sourceAssetId === canonicalAssetId
          || relation.targetAssetId === canonicalAssetId
      ))
    const directConnections = publicationProfile === 'operational_topology'
      ? item.confirmedConnections
      : []
    const capabilities = buildActiveCapabilities({
      publicationProfile,
      readiness: readinessContract,
    })
    return {
      activePointer: resolved.pointer,
      datasetVersion: publicDatasetVersion(record.datasetVersion, resolved.pointer),
      asset: sanitizePublicObject({
        ...projectAssetIdentity(asset, identityMap, resolver),
        assetId: item.assetId,
        canonicalAssetId: item.canonicalAssetId,
        stableAssetId: item.stableAssetId,
        identityStatus: item.identityStatus,
        name: item.name,
        category: item.category,
        type: item.assetType,
        networkFamily: item.networkFamily,
        siteId: item.siteId,
        location: item.locationText,
        hostname: canViewSensitive ? item.hostname : null,
        ipAddress: canViewSensitive ? item.ipAddress : null,
        sourceStatus: item.sourceStatus,
        objectRole: item.objectRole,
      }),
      identity: sanitizePublicObject(structuredClone(
        identityMap.items.find(({ canonicalAssetId: id }) => id === canonicalAssetId) ?? null,
      )),
      geometries: item.geometries.map((geometry) => sanitizePublicObject(geometry)),
      geometryReferences: item.geometryReferences.map((geometry) => sanitizePublicObject(geometry)),
      relations: relations.map((relation) => sanitizePublicObject(relation)),
      directConnections: sanitizePublicObject(directConnections),
      connectionAvailabilityReason: publicationProfile === 'operational_topology'
        ? null
        : 'topology_not_published',
      candidateCount: isAdministrator ? item.candidateCount : undefined,
      provenance: sanitizePublicObject({
        datasetVersionId: record.datasetVersion.id,
        versionName: record.datasetVersion.versionName,
        sourceFeatureId: item.sourceFeatureId,
        sourceKmlId: item.sourceKmlId,
        sourceFingerprint: item.sourceFingerprint,
        sourceFolderPath: item.sourceFolderPath,
        sourceElementType: item.sourceElementType,
        layerId: item.layerId,
        layerName: item.layerName,
      }),
      fieldAvailability: {
        hostname: canViewSensitive
          ? item.hostname ? 'available' : 'not_available_in_source'
          : 'not_authorized',
        ipAddress: canViewSensitive
          ? item.ipAddress ? 'available' : 'not_available_in_source'
          : 'not_authorized',
        location: item.locationText ? 'available' : 'not_available_in_source',
      },
      topologyReadiness: record.topologyReadiness ?? null,
      topologyIdentity: topology.identity,
      readiness: record.readiness ?? null,
      readinessContract,
      context: activeContext(record, resolved.pointer, siteId, publicationProfile),
      capabilities,
    }
  }

  async getActiveAssetSearch({
    datasetId,
    branchId,
    query = {},
    isAdministrator = false,
    canViewSensitive = false,
  } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    const record = resolved.record
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const topology = normalizeTopologyGraph(record, identityMap)
    const publicationProfile = activePublicationProfile(record, resolved.pointer)
    const catalog = buildActiveAssetCatalog({
      record,
      identityMap,
      topologyGraph: topology.graph,
      publicationProfile,
    })
    return queryActiveAssets({
      catalog,
      revision: resolved.pointer.revision,
      query,
      isAdministrator,
      canViewSensitive,
    })
  }

  async getActiveSites({ datasetId, branchId } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    const record = resolved.record
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const topology = normalizeTopologyGraph(record, identityMap)
    const catalog = buildActiveAssetCatalog({
      record,
      identityMap,
      topologyGraph: topology.graph,
      publicationProfile: activePublicationProfile(record, resolved.pointer),
    })
    return {
      datasetVersionId: record.datasetVersion.id,
      activePointerRevision: resolved.pointer.revision,
      sites: buildActiveSites({
        catalog,
        record,
        siteBoundaries: this.siteBoundaries,
      }),
    }
  }

  async getActiveOverlays({ datasetId, branchId, siteId = null } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    return {
      datasetVersionId: resolved.record.datasetVersion.id,
      activePointerRevision: resolved.pointer.revision,
      overlays: buildActiveOverlayDescriptors({
        record: resolved.record,
        datasetVersionId: resolved.record.datasetVersion.id,
        siteId,
      }),
    }
  }

  async exportActiveDatasetKml({
    datasetId,
    branchId,
    query = {},
    isAdministrator = false,
  } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    const record = resolved.record
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const topology = normalizeTopologyGraph(record, identityMap)
    const publicationProfile = activePublicationProfile(record, resolved.pointer)
    const catalog = buildActiveAssetCatalog({
      record,
      identityMap,
      topologyGraph: topology.graph,
      publicationProfile,
    })
    const result = queryActiveAssets({
      catalog,
      revision: resolved.pointer.revision,
      query: { ...query, limit: Math.max(catalog.length, 1) },
      isAdministrator,
      allowLargeLimit: true,
    })
    const selectedIds = new Set(result.items.map((item) => item.canonicalAssetId))
    const items = catalog.filter((item) => selectedIds.has(item.canonicalAssetId))
    const datasetVersion = {
      ...record.datasetVersion,
      publicationProfile,
    }
    const generatedAt = this.clock().toISOString()
    return {
      content: serializeActiveDatasetKml({
        datasetVersion,
        activePointer: resolved.pointer,
        items,
        filter: query,
        generatedAt,
      }),
      filename: safeActiveKmlFilename({
        datasetVersion,
        siteId: query.siteId ?? null,
      }),
      datasetVersionId: record.datasetVersion.id,
      activePointerRevision: resolved.pointer.revision,
      generatedAt,
      totalMatched: result.totalMatched,
    }
  }

  async #resolveActive(datasetId, branchId) {
    try {
      const resolved = await this.repository.resolveActiveVersion({
        datasetId,
        branchId,
      })
      if (!resolved) {
        throw new AppError('Dataset aktif belum tersedia.', {
          code: 'active_dataset_not_found',
          statusCode: 404,
        })
      }
      return resolved
    } catch (error) {
      if (['active_pointer_integrity_error', 'active_version_integrity_error']
        .includes(error?.code)) {
        throw new AppError('Pointer dataset aktif tidak konsisten.', {
          code: 'active_dataset_integrity_error',
          statusCode: 409,
          details: error.details,
        })
      }
      throw error
    }
  }

  async activate(datasetVersionId, actorId, {
    expectedActiveVersionId,
    expectedRecordRevision,
    expectedActivePointerRevision,
    publicationProfile = 'map_only',
    confirmBreakingChanges = false,
    allowArchived = false,
    operation = 'activate',
    correlationId = null,
  } = {}) {
    let target = null
    const activatedAt = this.clock().toISOString()
    try {
      target = await this.repository.get(datasetVersionId)
      const active = await this.repository.findActive(
        target.datasetVersion.datasetId,
        {
          excludeId: datasetVersionId,
          branchId: target.datasetVersion.branchId,
        },
      )
      const comparison = compareDatasetVersions(target, active)
      const normalizedProfile = normalizePublicationProfile(
        publicationProfile ?? target.datasetVersion.publicationProfile ?? 'map_only',
        { allowNull: false },
      )
      if (!normalizedProfile) {
        throw new AppError('Publication profile tidak valid.', {
          code: 'invalid_publication_profile',
          statusCode: 400,
        })
      }
      if (comparison.summary.requiresBreakingChangeConfirmation
        && confirmBreakingChanges !== true) {
        throw new AppError('Aktivasi memerlukan konfirmasi breaking change.', {
          code: 'breaking_change_confirmation_required',
          statusCode: 409,
          details: {
            comparisonRevision: comparison.comparisonRevision,
            highRiskChangeCount: comparison.summary.byRisk?.high ?? 0,
          },
        })
      }
      const transaction = await this.repository.activateVersionAtomically({
        datasetVersionId,
        actorId,
        activatedAt,
        expectedActiveVersionId,
        expectedRecordRevision,
        expectedActivePointerRevision,
        publicationProfile: normalizedProfile,
        archiveReason: operation === 'rollback' ? 'rollback' : 'superseded',
        validateTarget(record) {
          if (!canActivate(record, {
            allowArchived,
            publicationProfile: normalizedProfile,
          })) {
            throw new AppError(
              'Dataset version tidak dapat diaktifkan karena belum valid atau masih mempunyai blocking error.',
              {
                code: 'dataset_version_not_activatable',
                statusCode: 409,
              },
            )
          }
        },
      })
      let cacheInvalidated = false
      if (this.activeDatasetCache) {
        try {
          await this.activeDatasetCache.invalidate({
            datasetId: transaction.pointer.datasetId,
            branchId: transaction.pointer.branchId,
            revision: transaction.pointer.revision,
          })
          cacheInvalidated = true
        } catch (cacheError) {
          await this.auditLog.record('dataset_version.cache_invalidation_failed', {
            actorId,
            datasetVersionId,
            branchId: transaction.pointer.branchId,
            correlationId,
            outcome: 'failed',
            details: {
              datasetId: transaction.pointer.datasetId,
              revision: transaction.pointer.revision,
              errorCode: cacheError.code ?? cacheError.name,
            },
          }).catch(() => {})
        }
      }

      const event = operation === 'rollback'
        ? 'dataset_version.rolled_back'
        : 'dataset_version.activated'
      const auditEntry = await this.auditLog.record(event, {
        actorId,
        datasetVersionId,
        branchId: transaction.pointer.branchId,
        correlationId,
        outcome: 'active',
        details: {
          datasetId: transaction.pointer.datasetId,
          previousVersionId: transaction.pointer.previousVersionId,
          newVersionId: datasetVersionId,
          graphRevision: transaction.activated.topologyGraph?.graphRevision ?? null,
          activatedBy: actorId,
          activatedAt,
          validationSummary: transaction.activated.validation?.summary ?? {},
          result: 'committed',
          activePointerRevision: transaction.pointer.revision,
          operation,
          publicationProfile: normalizedProfile,
          comparisonRevision: comparison.comparisonRevision,
          highRiskChangeCount: comparison.summary.byRisk?.high ?? 0,
        },
      }).catch(() => null)
      return {
        operation,
        datasetVersion: withoutInternalStorage(transaction.activated.datasetVersion),
        archivedDatasetVersion: transaction.previous
          ? withoutInternalStorage(transaction.previous.datasetVersion)
          : null,
        activePointer: transaction.pointer,
        datasetVersionId,
        auditEventId: auditEntry?.id ?? null,
        publicationProfile: normalizedProfile,
        capabilities: publicationCapabilities(
          transaction.activated,
          normalizedProfile,
        ),
        comparisonRevision: comparison.comparisonRevision,
        cacheInvalidated,
        mapUrl: `/map?datasetId=${encodeURIComponent(transaction.pointer.datasetId)}`
          + `&branchId=${encodeURIComponent(transaction.pointer.branchId)}`,
      }
    } catch (error) {
      const context = error.activationContext ?? {}
      await this.auditLog.record(
        operation === 'rollback'
          ? 'dataset_version.rollback_failed'
          : 'dataset_version.activation_failed',
        {
          actorId,
          datasetVersionId,
          branchId: context.branchId ?? target?.datasetVersion.branchId ?? null,
          correlationId,
          outcome: 'failed',
          details: {
            datasetId: context.datasetId ?? target?.datasetVersion.datasetId ?? null,
            previousVersionId: context.previousVersionId ?? null,
            newVersionId: datasetVersionId,
            graphRevision: target?.topologyGraph?.graphRevision ?? null,
            activatedBy: actorId,
            activatedAt,
            validationSummary: target?.validation?.summary ?? {},
            result: 'rolled_back',
            errorCode: error.code ?? error.name,
            operation,
          },
        },
      ).catch(() => {})
      throw error
    }
  }

  async rollbackToPrevious(datasetId, branchId, actorId, {
    expectedActiveVersionId,
    correlationId = null,
  } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    const previousVersionId = resolved.pointer.previousVersionId
    if (!previousVersionId) {
      throw new AppError('Tidak ada dataset version sebelumnya untuk rollback.', {
        code: 'previous_dataset_version_not_found',
        statusCode: 409,
        details: {
          datasetId,
          branchId,
          activeVersionId: resolved.record.datasetVersion.id,
        },
      })
    }
    const previous = await this.repository.get(previousVersionId)
    return this.activate(previousVersionId, actorId, {
      expectedActiveVersionId: expectedActiveVersionId
        ?? resolved.record.datasetVersion.id,
      allowArchived: true,
      operation: 'rollback',
      confirmBreakingChanges: true,
      publicationProfile: previous.datasetVersion.publicationProfile ?? 'map_only',
      correlationId,
    })
  }

  async reject(datasetVersionId, actorId, {
    reason,
    correlationId = null,
  } = {}) {
    const normalizedReason = normalizeRejectionReason(reason)
    const current = await this.repository.get(datasetVersionId)
    if (current.datasetVersion.status === 'active') {
      throw new AppError('Dataset version aktif tidak dapat ditolak.', {
        code: 'active_dataset_cannot_be_rejected',
        statusCode: 409,
      })
    }
    const rejectedAt = this.clock().toISOString()
    const rejected = await this.repository.update(datasetVersionId, (record) => ({
      ...record,
      datasetVersion: {
        ...record.datasetVersion,
        status: 'archived',
        publicationStatus: 'archived',
        rejectedBy: actorId,
        rejectedAt,
        archiveReason: 'rejected',
        rejectionReason: normalizedReason,
      },
    }))
    const auditEntry = await this.auditLog.record('dataset_version.rejected', {
      actorId,
      datasetVersionId,
      branchId: rejected.datasetVersion.branchId,
      correlationId,
      outcome: 'archived',
    })
    return {
      datasetVersionId,
      datasetVersion: withoutInternalStorage(rejected.datasetVersion),
      recordRevision: rejected.recordRevision,
      auditEventId: auditEntry?.id ?? null,
      state: 'archived',
    }
  }
}

function normalizeRejectionReason(reason) {
  const normalized = String(reason ?? '').trim()
  if (!normalized || normalized.length > 1000
    || /[ --]/.test(normalized)) {
    throw new AppError('Alasan reject wajib diberikan.', {
      code: 'rejection_reason_required',
      statusCode: 400,
    })
  }
  return normalized
}

export function compareDatasetVersions(candidate, active) {
  const hasCanonicalEvidence = Boolean(
    candidate?.classifiedObjects?.length
      || active?.classifiedObjects?.length
      || candidate?.sourceFeatures?.length
      || active?.sourceFeatures?.length
      || candidate?.sourceOverlays?.length
      || active?.sourceOverlays?.length,
  )
  if (hasCanonicalEvidence) {
    const comparison = compareCanonicalDatasetVersions(candidate, active)
    const candidateAssets = candidate.assets ?? []
    const activeAssets = active?.assets ?? []
    const changesByAssetId = new Map(
      comparison.items
        .filter(({ assetId }) => assetId)
        .map((item) => [item.assetId, item]),
    )
    const candidateIds = new Set(candidateAssets.map(stableAssetIdForAsset).filter(Boolean))
    const activeIds = new Set(activeAssets.map(stableAssetIdForAsset).filter(Boolean))
    const assetChanges = candidateAssets.map((asset) => {
      const assetId = stableAssetIdForAsset(asset) ?? asset.assetId
      const change = changesByAssetId.get(assetId)
      return {
        assetId,
        status: change
          ? change.changeType === 'asset_added' ? 'new' : 'updated'
          : 'unchanged',
        previousAssetId: activeIds.has(assetId) ? assetId : null,
      }
    })
    const removedAssets = activeAssets
      .filter((asset) => {
        const assetId = stableAssetIdForAsset(asset)
        return assetId && !candidateIds.has(assetId)
      })
      .map((asset) => ({
        asset: structuredClone(asset),
        geometries: structuredClone((active.geometries ?? []).filter((geometry) => (
          geometry.assetNodeId === asset.id
        ))),
        status: 'removed',
      }))
    const unchangedAssets = assetChanges.filter(({ status }) => status === 'unchanged').length
    return {
      ...comparison,
      assetChanges,
      removedAssets,
      summary: {
        ...comparison.summary,
        unchangedAssets,
        removedAssets: removedAssets.length,
      },
    }
  }
  const candidateAssets = candidate.assets ?? []
  const activeAssets = active?.assets ?? []
  const activeByAssetId = new Map(activeAssets.map((asset) => [asset.assetId, asset]))
  const candidateByAssetId = new Map(candidateAssets.map((asset) => [asset.assetId, asset]))
  const candidateGeometryByNode = groupBy(candidate.geometries ?? [], 'assetNodeId')
  const activeGeometryByNode = groupBy(active?.geometries ?? [], 'assetNodeId')
  const assetChanges = []

  candidateAssets.forEach((asset) => {
    const previous = activeByAssetId.get(asset.assetId)
    const status = !previous
      ? 'new'
      : assetFingerprint(asset, candidateGeometryByNode.get(asset.id) ?? [])
        === assetFingerprint(previous, activeGeometryByNode.get(previous.id) ?? [])
        ? 'unchanged'
        : 'updated'
    assetChanges.push({
      assetId: asset.assetId,
      status,
      previousAssetId: previous?.assetId ?? null,
    })
  })

  const removedAssets = activeAssets
    .filter((asset) => !candidateByAssetId.has(asset.assetId))
    .map((asset) => ({
      asset: structuredClone(asset),
      geometries: structuredClone(activeGeometryByNode.get(asset.id) ?? []),
      status: 'removed',
    }))

  return {
    hasActiveDataset: Boolean(active),
    activeDatasetVersionId: active?.datasetVersion.id ?? null,
    assetChanges,
    removedAssets,
    summary: {
      newAssets: assetChanges.filter(({ status }) => status === 'new').length,
      updatedAssets: assetChanges.filter(({ status }) => status === 'updated').length,
      unchangedAssets: assetChanges.filter(({ status }) => status === 'unchanged').length,
      removedAssets: removedAssets.length,
    },
  }
}

function toActiveMapDataset(resolved, { siteId = null, siteBoundaries = {} } = {}) {
  const record = resolved.record
  const assetIdentityMap = buildAssetIdentityMapFromRecord(record)
  const resolver = createAssetIdentityResolver(assetIdentityMap)
  const topology = normalizeTopologyGraph(record, assetIdentityMap)
  const publicationProfile = activePublicationProfile(record, resolved.pointer)
  const catalog = buildActiveAssetCatalog({
    record,
    identityMap: assetIdentityMap,
    topologyGraph: topology.graph,
    publicationProfile,
  })
  const visibleCatalog = siteId
    ? catalog.filter((item) => item.siteId === siteId)
    : catalog
  const visibleNodeIds = new Set(visibleCatalog.map((item) => item.nodeId))
  const visibleCanonicalIds = new Set(visibleCatalog.map((item) => item.canonicalAssetId))
  const renderableGeometries = visibleCatalog
    .flatMap((item) => item.geometries)
    .filter(isRenderableGeometry)
  const visibleGeometries = renderableGeometries.filter((geometry) => (
    !siteId || visibleNodeIds.has(geometry.assetNodeId)
  ))
  const renderableNodeIds = new Set(visibleGeometries.map(({ assetNodeId }) => assetNodeId))
  const relations = filterResolvedRelations(record, resolver).filter((relation) => (
    !siteId || (
      visibleCanonicalIds.has(relation.sourceAssetId)
      && visibleCanonicalIds.has(relation.targetAssetId)
    )
  ))
  const mapTopologyGraph = siteId
    ? filterTopologyGraphByCanonicalIds(topology.graph, visibleCanonicalIds)
    : topology.graph
  const readinessContract = buildReadinessContract(record, topology.graph)
  const sites = buildActiveSites({ catalog, record, siteBoundaries })
  const overlays = buildActiveOverlayDescriptors({
    record,
    datasetVersionId: record.datasetVersion.id,
    siteId,
  })
  const capabilities = buildActiveCapabilities({
    publicationProfile,
    readiness: readinessContract,
  })
  const baseAssets = (record.assets ?? []).map((asset) => {
    const identity = identityForAsset(asset, assetIdentityMap, resolver)
    return {
      id: asset.id,
      datasetVersionId: asset.datasetVersionId,
      layerId: asset.layerId,
      assetId: asset.assetId,
      canonicalAssetId: identity?.canonicalAssetId ?? asset.canonicalAssetId ?? asset.assetId,
      stableAssetId: identity?.stableAssetId ?? asset.stableAssetId ?? null,
      onboardingIdentity: identity?.onboardingId ?? asset.onboardingIdentity ?? null,
      legacyAssetId: identity?.legacyId ?? asset.legacyAssetId ?? asset.assetId,
      identityStatus: identity?.identityStatus ?? asset.identityStatus ?? 'legacy',
      identityAliases: structuredClone(identity?.aliases ?? asset.identityAliases ?? {}),
      sourceFeatureId: asset.sourceFeatureId ?? asset.properties?.sourceFeatureId,
      name: asset.name,
      category: asset.category,
      type: asset.type,
      branchId: asset.branchId,
      location: asset.location,
      status: readAssetProperty(asset, 'status') ?? null,
      visibility: readAssetProperty(asset, 'visibility') ?? null,
      hasRenderableGeometry: renderableNodeIds.has(asset.id),
    }
  })
  return {
    mapView: true,
    activePointer: resolved.pointer,
    datasetVersion: publicDatasetVersion(record.datasetVersion, resolved.pointer),
    layers: (record.layers ?? []).map((layer) => ({
      id: layer.id,
      datasetVersionId: layer.datasetVersionId,
      parentLayerId: layer.parentLayerId,
      sourceFolderPath: layer.sourceFolderPath,
      name: layer.name,
      category: layer.category,
      displayOrder: layer.displayOrder,
      defaultVisible: layer.defaultVisible,
    })),
    assets: baseAssets.filter((asset) => (
      !siteId || visibleCanonicalIds.has(asset.canonicalAssetId) || visibleNodeIds.has(asset.id)
    )),
    geometries: visibleGeometries.map((geometry) => ({
      id: geometry.id,
      assetNodeId: geometry.assetNodeId,
      sourceGeometryId: geometry.sourceGeometryId,
      sourceFeatureId: geometry.sourceFeatureId,
      geometryType: geometry.geometryType,
      coordinates: structuredClone(geometry.coordinates),
      altitudeMode: geometry.altitudeMode,
      bounds: geometry.bounds ? structuredClone(geometry.bounds) : undefined,
    })),
    relations: relations.map((relation) => ({
      id: relation.id,
      datasetVersionId: relation.datasetVersionId,
      sourceAssetId: relation.sourceAssetId,
      targetAssetId: relation.targetAssetId,
      canonicalSourceAssetId: relation.sourceAssetId,
      canonicalTargetAssetId: relation.targetAssetId,
      relationType: relation.relationType,
      pathAssetId: relation.pathAssetId,
      layerId: relation.layerId,
      relationSource: relation.relationSource
        ?? relation.metadata?.topology?.relationSource
        ?? 'explicit',
      relationKind: relation.relationKind ?? 'device_edge',
      relationStatus: relation.relationStatus ?? 'confirmed',
      sourceGeometryId: relation.sourceGeometryId,
      distanceMeters: relation.distanceMeters,
      metadata: relation.metadata ? structuredClone(relation.metadata) : undefined,
    })),
    topologyGraph: mapTopologyGraph,
    topologySummary: normalizeTopologySummary(
      record.topologySummary,
      mapTopologyGraph,
      record.confirmedRelations,
    ),
    topologyReadiness: record.topologyReadiness ?? null,
    topologyIdentity: topology.identity,
    assetIdentityMap,
    readiness: {
      ...(record.readiness ?? {}),
      mapReady: readinessContract.mapReady,
      inventoryReady: readinessContract.inventoryReady,
      topologyReady: readinessContract.topologyReady,
      publicationStatus: readinessContract.publicationStatus,
    },
    readinessContract,
    mapReady: readinessContract.mapReady !== 'not_ready',
    inventoryReady: readinessContract.inventoryReady !== 'not_ready',
    topologyReady: readinessContract.topologyReady === 'ready',
    publicationStatus: readinessContract.publicationStatus,
    renderingSummary: {
      totalAssets: visibleCatalog.length,
      assetsWithoutGeometry: visibleCatalog.length - renderableNodeIds.size,
      renderedGeometries: visibleGeometries.length,
      invalidGeometriesOmitted: visibleCatalog.reduce(
        (count, item) => count + item.geometries.filter((geometry) => !geometry.valid).length,
        0,
      ),
      resolvedRelations: relations.length,
      unresolvedRelationsOmitted: (record.relations ?? []).length - relations.length,
      topologyNodes: mapTopologyGraph.nodes.length,
      topologyEdges: mapTopologyGraph.edges.length,
      topologyIdentityUnresolved: topology.identity.unresolvedNodeCount
        + topology.identity.unresolvedEdgeCount,
    },
    context: activeContext(record, resolved.pointer, siteId, publicationProfile),
    publicationProfile,
    sites,
    overlays,
    summary: buildActiveSummary({
      catalog: visibleCatalog,
      sites: siteId ? sites.filter((site) => site.siteId === siteId) : sites,
      record,
      topologyGraph: mapTopologyGraph,
      overlays,
    }),
    capabilities,
  }
}

function identityForAsset(asset, identityMap, resolver) {
  const sourceFeatureId = asset.sourceFeatureId ?? asset.properties?.sourceFeatureId
  const canonicalAssetId = resolver.resolve(
    asset.canonicalAssetId ?? asset.assetId ?? asset.id,
  )
  return (identityMap.items ?? []).find((item) => (
    (sourceFeatureId && item.sourceFeatureId === sourceFeatureId)
      || (canonicalAssetId && item.canonicalAssetId === canonicalAssetId)
  )) ?? null
}

function projectAssetIdentity(asset, identityMap, resolver) {
  const identity = identityForAsset(asset, identityMap, resolver)
  return {
    ...structuredClone(asset),
    canonicalAssetId: identity?.canonicalAssetId
      ?? asset.canonicalAssetId
      ?? asset.assetId
      ?? asset.id,
    stableAssetId: identity?.stableAssetId ?? asset.stableAssetId ?? null,
    onboardingIdentity: identity?.onboardingId ?? asset.onboardingIdentity ?? null,
    legacyAssetId: identity?.legacyId ?? asset.legacyAssetId ?? asset.assetId ?? null,
    identityStatus: identity?.identityStatus ?? asset.identityStatus ?? 'legacy',
    identityAliases: structuredClone(identity?.aliases ?? asset.identityAliases ?? {}),
    sourceFeatureId: asset.sourceFeatureId ?? asset.properties?.sourceFeatureId ?? null,
  }
}

function normalizeTopologyGraph(record, identityMap) {
  const resolver = createAssetIdentityResolver(identityMap)
  const sourceGraph = record.topologyGraph ?? {
    datasetVersionId: record.datasetVersion?.id,
    nodes: (record.assets ?? []).map((asset) => ({
      id: asset.canonicalAssetId ?? asset.assetId ?? asset.id,
      assetId: asset.canonicalAssetId ?? asset.assetId ?? asset.id,
      sourceFeatureId: asset.sourceFeatureId ?? asset.properties?.sourceFeatureId,
    })),
    edges: (record.confirmedRelations ?? []).map((relation) => ({
      ...relation,
      sourceNodeId: relation.sourceAssetId,
      targetNodeId: relation.targetAssetId,
    })),
    components: [],
    degreeByNode: {},
    isolatedNodeIds: [],
  }
  const unresolvedNodes = []
  const nodes = []
  const canonicalNodeIds = new Set()
  const originalNodeToCanonical = new Map()
  ;(sourceGraph.nodes ?? []).forEach((node) => {
    const originalId = node.canonicalAssetId ?? node.assetId ?? node.id
    const canonicalAssetId = resolver.resolve(originalId)
    if (!canonicalAssetId) {
      unresolvedNodes.push(originalId ?? null)
      return
    }
    if (canonicalNodeIds.has(canonicalAssetId)) {
      unresolvedNodes.push(originalId)
      return
    }
    canonicalNodeIds.add(canonicalAssetId)
    originalNodeToCanonical.set(originalId, canonicalAssetId)
    nodes.push({
      ...structuredClone(node),
      id: canonicalAssetId,
      canonicalAssetId,
      assetId: canonicalAssetId,
      sourceNodeId: originalId,
    })
  })

  const unresolvedEdges = []
  const edges = []
  ;(sourceGraph.edges ?? []).forEach((edge) => {
    const originalSource = edge.sourceAssetId ?? edge.sourceNodeId
    const originalTarget = edge.targetAssetId ?? edge.targetNodeId
    const sourceAssetId = resolver.resolve(originalSource)
      ?? originalNodeToCanonical.get(originalSource)
    const targetAssetId = resolver.resolve(originalTarget)
      ?? originalNodeToCanonical.get(originalTarget)
    if (!sourceAssetId || !targetAssetId
      || !canonicalNodeIds.has(sourceAssetId)
      || !canonicalNodeIds.has(targetAssetId)
      || sourceAssetId === targetAssetId) {
      unresolvedEdges.push({
        edgeId: edge.id ?? null,
        sourceAssetId: originalSource ?? null,
        targetAssetId: originalTarget ?? null,
      })
      return
    }
    edges.push({
      ...structuredClone(edge),
      sourceAssetId,
      targetAssetId,
      sourceNodeId: sourceAssetId,
      targetNodeId: targetAssetId,
      canonicalSourceAssetId: sourceAssetId,
      canonicalTargetAssetId: targetAssetId,
    })
  })

  const degreeByNode = Object.fromEntries(nodes.map(({ id }) => [id, 0]))
  edges.forEach((edge) => {
    degreeByNode[edge.sourceAssetId] += 1
    degreeByNode[edge.targetAssetId] += 1
  })
  const components = normalizeComponents(
    sourceGraph.components,
    resolver,
    canonicalNodeIds,
    edges,
  )
  const graph = withTopologyGraphRevision({
      ...structuredClone(sourceGraph),
      datasetVersionId: record.datasetVersion?.id ?? sourceGraph.datasetVersionId,
      nodes,
      edges,
      components,
      degreeByNode,
      isolatedNodeIds: nodes
        .filter(({ id }) => degreeByNode[id] === 0)
        .map(({ id }) => id)
        .sort(),
    })
  return {
    graph,
    identity: {
      version: identityMap.version,
      migratedFromLegacyRecord: identityMap.migratedFromLegacyRecord === true,
      sourceNodeCount: (sourceGraph.nodes ?? []).length,
      resolvedNodeCount: nodes.length,
      unresolvedNodeCount: unresolvedNodes.length,
      sourceEdgeCount: (sourceGraph.edges ?? []).length,
      resolvedEdgeCount: edges.length,
      unresolvedEdgeCount: unresolvedEdges.length,
      unresolvedNodes: unresolvedNodes.slice(0, 25),
      unresolvedEdges: unresolvedEdges.slice(0, 25),
    },
  }
}

function normalizeComponents(sourceComponents, resolver, canonicalNodeIds, edges) {
  const components = (sourceComponents ?? []).map((component, index) => ({
    ...structuredClone(component),
    componentId: component.componentId ?? component.id ?? `component:${index + 1}`,
    nodeIds: [...new Set((component.nodeIds ?? [])
      .map((id) => resolver.resolve(id))
      .filter((id) => canonicalNodeIds.has(id)))].sort(),
    edgeIds: (component.edgeIds ?? [])
      .filter((edgeId) => edges.some((edge) => edge.id === edgeId))
      .sort(),
  })).filter(({ nodeIds }) => nodeIds.length)
  if (components.length) return components
  return connectedComponents(canonicalNodeIds, edges)
}

function connectedComponents(nodeIds, edges) {
  const adjacency = new Map([...nodeIds].map((id) => [id, []]))
  edges.forEach((edge) => {
    adjacency.get(edge.sourceAssetId)?.push(edge.targetAssetId)
    adjacency.get(edge.targetAssetId)?.push(edge.sourceAssetId)
  })
  const visited = new Set()
  const components = []
  ;[...nodeIds].sort().forEach((start) => {
    if (visited.has(start)) return
    const queue = [start]
    const componentNodes = []
    const componentNodeSet = new Set()
    while (queue.length) {
      const current = queue.shift()
      if (visited.has(current)) continue
      visited.add(current)
      componentNodeSet.add(current)
      componentNodes.push(current)
      ;(adjacency.get(current) ?? []).forEach((next) => {
        if (!visited.has(next)) queue.push(next)
      })
    }
    components.push({
      componentId: `component:${components.length + 1}`,
      nodeIds: componentNodes.sort(),
      edgeIds: edges.filter((edge) => (
        componentNodeSet.has(edge.sourceAssetId)
          && componentNodeSet.has(edge.targetAssetId)
      )).map(({ id }) => id).filter(Boolean).sort(),
    })
  })
  return components
}

function buildReadinessContract(record, topologyGraph) {
  const parserReadiness = record.readiness ?? {}
  const publicationTopologyStatus = record.topologyReadiness?.topologyReadiness
    ?? parserReadiness.topologyReadiness
    ?? 'not_ready'
  const topologyValidation = record.topologyValidation ?? {}
  const validationIssues = topologyValidation.issues ?? []
  const validationErrorCount = Number(topologyValidation.summary?.errors)
    || validationIssues.filter(({ severity }) => severity === 'error').length
  const validationWarningCount = Number(topologyValidation.summary?.warnings)
    || validationIssues.filter(({ severity }) => severity === 'warning').length
  const graphAvailable = topologyGraph.edges.length > 0
  const graphValid = validationErrorCount === 0
  const generated = Boolean(
    record.topologyGeneratedAt
      || record.topologyGraph
      || record.topologyCandidates
      || record.topologyInputBundle,
  )
  const traceAvailable = graphAvailable && graphValid
  const topologyReady = publicationTopologyStatus === 'ready' && traceAvailable
  const topologyStatus = !generated
    ? 'not_generated'
    : !graphValid
      ? 'invalid'
      : topologyReady
        ? 'ready'
        : traceAvailable
          ? 'partial_ready'
          : 'review_required'
  const blockingReasons = [...(record.topologyReadiness?.blockingReasons ?? [])]
  if (validationErrorCount > 0 && !blockingReasons.includes('confirmed_graph_invalid')) {
    blockingReasons.push('confirmed_graph_invalid')
  }
  if (generated && !graphAvailable && !blockingReasons.includes('no_confirmed_device_edge')) {
    blockingReasons.push('no_confirmed_device_edge')
  }
  const traceableComponentCount = (topologyGraph.components ?? [])
    .filter((component) => (component.edgeIds ?? []).length > 0).length
  const nodeCount = topologyGraph.nodes.length
  const connectedDeviceCount = nodeCount - (topologyGraph.isolatedNodeIds ?? []).length
  const canonicalReadiness = buildPublicationReadinessContract({
    datasetVersion: record.datasetVersion,
    issues: record.issues ?? [],
    parserCoverage: record.parserCoverage ?? {},
    sourceFeatures: record.sourceFeatures ?? [],
    sourceGeometries: record.sourceGeometries ?? [],
    sourceOverlays: record.sourceOverlays ?? [],
    classifiedObjects: record.classifiedObjects ?? [],
    topologyReadiness: record.topologyReadiness ?? null,
    topologyGraph,
    evaluatedAt: record.datasetVersion?.readinessEvaluatedAt
      ?? record.datasetVersion?.importedAt
      ?? null,
  })
  return {
    ...canonicalReadiness,
    mapReady: parserReadiness.mapReadiness ?? 'not_ready',
    inventoryReady: parserReadiness.inventoryReadiness ?? 'not_ready',
    topologyReady: topologyReady ? 'ready' : 'not_ready',
    topologyStatus,
    graphRevision: topologyGraph.graphRevision ?? null,
    validation: {
      status: validationErrorCount > 0
        ? 'invalid'
        : validationWarningCount > 0 ? 'valid_with_warnings' : 'valid',
      errorCount: validationErrorCount,
      warningCount: validationWarningCount,
    },
    coverage: {
      stableIdentity: record.topologyReadiness?.stableIdentityCoverage ?? 0,
      deviceCount: nodeCount,
      connectedDeviceCount,
      traceableComponentCount,
      unresolvedEndpointCount: record.topologyReadiness?.unresolvedCount
        ?? record.topologySummary?.unresolvedCount
        ?? 0,
    },
    accuracy: {
      heldOutPrecision: record.topologyReadiness?.heldOutPrecision ?? null,
      pathAccuracy: record.topologyReadiness?.pathAccuracy ?? null,
      autoConfirmAllowed: publicationTopologyStatus === 'ready' && traceAvailable,
    },
    capabilities: {
      viewTopology: generated,
      reviewTopology: Boolean(record.topologyInputBundle),
      trace: traceAvailable,
      diagram: traceAvailable,
      autoConfirm: publicationTopologyStatus === 'ready' && traceAvailable,
    },
    blockers: blockingReasons.map((code) => ({
      code,
      scope: ['confirmed_graph_invalid', 'no_confirmed_device_edge'].includes(code)
        ? 'graph'
        : 'publication',
    })),
    publicationStatus: record.datasetVersion?.publicationStatus ?? 'unpublished',
  }
}

function publicDatasetVersion(datasetVersion, pointer) {
  return {
    id: datasetVersion.id,
    datasetId: datasetVersion.datasetId,
    branchId: datasetVersion.branchId,
    versionName: datasetVersion.versionName,
    sourceFilename: datasetVersion.sourceFilename,
    activatedAt: datasetVersion.activatedAt ?? pointer.activatedAt,
    publishedAt: datasetVersion.publishedAt
      ?? datasetVersion.activatedAt
      ?? pointer.activatedAt
      ?? null,
    publicationProfile: datasetVersion.publicationProfile
      ?? pointer.publicationProfile
      ?? 'map_only',
    status: 'active',
    publicationStatus: 'published',
    activePointerRevision: pointer.revision,
  }
}

function activePublicationProfile(record, pointer) {
  return record.datasetVersion?.publicationProfile
    ?? pointer?.publicationProfile
    ?? 'map_only'
}

function activeContext(record, pointer, siteId, publicationProfile) {
  return {
    datasetId: record.datasetVersion?.datasetId ?? pointer?.datasetId ?? null,
    datasetVersionId: record.datasetVersion?.id ?? pointer?.datasetVersionId ?? null,
    branchId: record.datasetVersion?.branchId ?? pointer?.branchId ?? null,
    siteId: siteId ?? null,
    publicationProfile,
    activePointerRevision: pointer?.revision ?? null,
  }
}

function filterTopologyGraphByCanonicalIds(graph, allowedIds) {
  const nodes = (graph.nodes ?? []).filter((node) => allowedIds.has(
    node.canonicalAssetId ?? node.assetId ?? node.id,
  ))
  const edges = (graph.edges ?? []).filter((edge) => (
    allowedIds.has(edge.sourceAssetId ?? edge.sourceNodeId)
      && allowedIds.has(edge.targetAssetId ?? edge.targetNodeId)
  ))
  const degreeByNode = Object.fromEntries(nodes.map(({ id, canonicalAssetId, assetId }) => [
    canonicalAssetId ?? assetId ?? id,
    0,
  ]))
  edges.forEach((edge) => {
    const source = edge.sourceAssetId ?? edge.sourceNodeId
    const target = edge.targetAssetId ?? edge.targetNodeId
    if (source in degreeByNode) degreeByNode[source] += 1
    if (target in degreeByNode) degreeByNode[target] += 1
  })
  return {
    ...structuredClone(graph),
    nodes,
    edges,
    components: (graph.components ?? []).map((component) => ({
      ...structuredClone(component),
      nodeIds: (component.nodeIds ?? []).filter((id) => allowedIds.has(id)),
      edgeIds: (component.edgeIds ?? []).filter((id) => edges.some((edge) => edge.id === id)),
    })).filter((component) => component.nodeIds.length),
    degreeByNode,
    isolatedNodeIds: nodes
      .map((node) => node.canonicalAssetId ?? node.assetId ?? node.id)
      .filter((id) => degreeByNode[id] === 0),
  }
}

function sanitizePublicObject(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicObject)
  if (!value || typeof value !== 'object') {
    return typeof value === 'string'
      ? value.replace(/[<>]/g, '').normalize('NFKC')
      : value
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sanitizePublicObject(child),
  ]))
}

function withoutInternalStorage(datasetVersion) {
  const { sourceStorageKey, ...publicVersion } = datasetVersion
  return publicVersion
}

function filterResolvedRelations(record, resolver = createAssetIdentityResolver(
  buildAssetIdentityMapFromRecord(record),
)) {
  return (record.relations ?? []).filter((relation) => (
    (!relation.datasetVersionId || relation.datasetVersionId === record.datasetVersion.id)
    && (relation.verificationStatus === 'confirmed'
      || (!relation.verificationStatus && relation.relationStatus === 'confirmed'))
    && resolver.resolve(relation.sourceAssetId)
    && resolver.resolve(relation.targetAssetId)
    && resolver.resolve(relation.sourceAssetId) !== resolver.resolve(relation.targetAssetId)
  )).map((relation) => ({
    ...structuredClone(relation),
    sourceAssetId: resolver.resolve(relation.sourceAssetId),
    targetAssetId: resolver.resolve(relation.targetAssetId),
    ...(relation.pathAssetId
      ? { pathAssetId: resolver.resolve(relation.pathAssetId) ?? relation.pathAssetId }
      : {}),
  }))
}

function isRenderableGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return false
  if (geometry.geometryType === 'point') return isPosition(geometry.coordinates)
  if (geometry.geometryType === 'line_string') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.length >= 2
      && geometry.coordinates.every(isPosition)
  }
  if (geometry.geometryType === 'polygon') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0
      && geometry.coordinates.every((ring) => (
        Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition)
      ))
  }
  if (geometry.geometryType === 'multi_geometry') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0
      && geometry.coordinates.every(isRenderableGeometry)
  }
  return false
}

function isPosition(position) {
  if (!Array.isArray(position) || position.length < 2) return false
  const longitude = Number(position[0])
  const latitude = Number(position[1])
  return Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90
}

function readAssetProperty(asset, key) {
  return asset.properties?.semanticMetadata?.[key]
    ?? asset.properties?.extendedData?.[key]
    ?? asset.properties?.[key]
}

function canActivate(record, {
  allowArchived = false,
  publicationProfile = 'map_only',
} = {}) {
  const statusValid = record.datasetVersion.status === 'valid'
    || (allowArchived && record.datasetVersion.status === 'archived')
  if (!statusValid) return false
  if (allowArchived
    && record.datasetVersion.status === 'archived'
    && record.datasetVersion.archiveReason
    && !['superseded', 'rollback'].includes(record.datasetVersion.archiveReason)) {
    return false
  }
  if (record.readiness?.publishableProfiles) {
    return isProfilePublishable(record, publicationProfile)
      && !(record.issues ?? []).some((issue) => (
        Array.isArray(issue.blockingProfiles)
          && issue.blockingProfiles.includes(publicationProfile)
      ))
  }
  return record.datasetVersion.validationStatus === 'valid'
    && record.validation?.canActivate === true
    && !(record.issues ?? []).some((issue) => issue.canActivate === false)
}

function groupBy(records, key) {
  const grouped = new Map()
  records.forEach((record) => {
    const values = grouped.get(record[key]) ?? []
    values.push(record)
    grouped.set(record[key], values)
  })
  return grouped
}

function assetFingerprint(asset, geometries) {
  return JSON.stringify({
    name: asset.name,
    category: asset.category,
    type: asset.type,
    branchId: asset.branchId,
    location: asset.location ?? null,
    properties: asset.properties ?? {},
    geometries: geometries.map((geometry) => ({
      geometryType: geometry.geometryType,
      coordinates: geometry.coordinates,
      altitudeMode: geometry.altitudeMode ?? null,
    })),
  })
}

function stableAssetIdForAsset(asset = {}) {
  if (asset.stableAssetId) return asset.stableAssetId
  if (asset.identityResolutionStatus === 'stable_explicit'
    || asset.identityResolutionStatus === 'stable_registry') {
    return asset.assetId
  }
  if (asset.identityStatus === 'stable' && !asset.onboardingIdentity) return asset.assetId
  return null
}

function normalizeIdentityAssignments(assignments, { maxItems = 500 } = {}) {
  if (!Array.isArray(assignments) || assignments.length === 0 || assignments.length > maxItems) {
    throw new AppError(`Identity assignment harus berisi 1 sampai ${maxItems} item.`, {
      code: 'invalid_identity_assignment_batch',
      statusCode: 400,
    })
  }
  return assignments.map((assignment, index) => {
    const sourceFeatureId = normalizeBoundedText(
      assignment?.sourceFeatureId,
      'sourceFeatureId',
    )
    const action = String(assignment?.action ?? '').trim().toLowerCase()
    if (!['assign', 'mark_non_asset', 'reject_match'].includes(action)) {
      throw new AppError(`Action identity assignment pada index ${index} tidak valid.`, {
        code: 'invalid_identity_assignment_action',
        statusCode: 400,
      })
    }
    const reason = normalizeBoundedText(assignment?.reason, 'reason')
    const assetId = assignment?.assetId === undefined || assignment?.assetId === null
      ? null
      : normalizeBoundedText(assignment.assetId, 'assetId')
    const proposedAssetId = assignment?.proposedAssetId === undefined
      || assignment?.proposedAssetId === null
      ? null
      : normalizeBoundedText(assignment.proposedAssetId, 'proposedAssetId')
    if (action === 'assign' && !assetId) {
      throw new AppError(`Asset ID wajib untuk assignment index ${index}.`, {
        code: 'identity_assignment_asset_id_required',
        statusCode: 400,
      })
    }
    return {
      sourceFeatureId,
      action,
      assetId,
      proposedAssetId,
      reason,
      evidenceRefs: normalizeEvidenceRefs(assignment?.evidenceRefs),
    }
  })
}

function validateIdentityAssignmentBatch(record, assignments) {
  const sourceFeatureIds = new Set(
    (record.sourceFeatures ?? []).map(({ sourceFeatureId }) => sourceFeatureId),
  )
  const seenFeatures = new Set()
  const knownAssetIds = new Set(
    (record.assetIdentityRegistry ?? record.identityRegistry ?? [])
      .filter(({ status }) => status === 'active')
      .map(({ assetId }) => assetId),
  )
  assignments.forEach((assignment) => {
    if (!sourceFeatureIds.has(assignment.sourceFeatureId)) {
      throw new AppError('Source feature identity tidak ditemukan.', {
        code: 'identity_source_feature_not_found',
        statusCode: 404,
        details: { sourceFeatureId: assignment.sourceFeatureId },
      })
    }
    if (seenFeatures.has(assignment.sourceFeatureId)) {
      throw new AppError('Satu source feature hanya boleh muncul sekali per batch.', {
        code: 'duplicate_identity_assignment_source',
        statusCode: 400,
        details: { sourceFeatureId: assignment.sourceFeatureId },
      })
    }
    seenFeatures.add(assignment.sourceFeatureId)
    if (assignment.action === 'assign') {
      if (knownAssetIds.has(assignment.assetId)) {
        const sourceFeature = (record.sourceFeatures ?? []).find(({ sourceFeatureId }) => (
          sourceFeatureId === assignment.sourceFeatureId
        ))
        const sourceMatchValues = identitySourceMatches(
          sourceFeature,
          assignment.sourceFeatureId,
        ).map(({ sourceMatchValue }) => sourceMatchValue)
        const previous = (record.assetIdentityRegistry ?? record.identityRegistry ?? [])
          .find(({ assetId, status, sourceMatchValue }) => (
            assetId === assignment.assetId
              && status === 'active'
              && sourceMatchValues.includes(sourceMatchValue)
          ))
        if (!previous) {
          throw new AppError('Asset ID sudah dipakai oleh source feature lain.', {
            code: 'identity_asset_id_conflict',
            statusCode: 409,
            details: {
              assetId: assignment.assetId,
              sourceFeatureId: assignment.sourceFeatureId,
            },
          })
        }
      }
      knownAssetIds.add(assignment.assetId)
    }
  })
}

function applyIdentityAssignmentBatch({
  record,
  assignments,
  actorId,
  approvedAt,
  auditEventId,
  idempotencyKey,
  requestFingerprint,
}) {
  const sourceFeatures = structuredClone(record.sourceFeatures ?? [])
  const classifiedObjects = structuredClone(record.classifiedObjects ?? [])
  const featureById = new Map(sourceFeatures.map((feature) => [feature.sourceFeatureId, feature]))
  const objectByFeature = new Map(
    classifiedObjects.map((object) => [object.sourceFeatureId, object]),
  )
  const registry = structuredClone(record.assetIdentityRegistry ?? record.identityRegistry ?? [])
    .map((entry, index) => ({
      ...entry,
      registryId: entry.registryId
        ?? `identity-registry:legacy-${fingerprint([entry, index]).slice(0, 24)}`,
    }))
  const registryById = new Map(
    registry.filter(({ registryId }) => registryId).map((entry) => [entry.registryId, entry]),
  )
  const registryBySource = new Map(
    registry.map((entry) => [identityRegistryKey(entry.sourceMatchType, entry.sourceMatchValue), entry]),
  )
  assignments.forEach((assignment) => {
    const feature = featureById.get(assignment.sourceFeatureId)
    const object = objectByFeature.get(assignment.sourceFeatureId)
    const sourceMatches = identitySourceMatches(feature, assignment.sourceFeatureId)
    sourceMatches.forEach(({ sourceMatchType, sourceMatchValue }) => {
      const key = identityRegistryKey(sourceMatchType, sourceMatchValue)
      const existing = registryBySource.get(key)
      if (existing && assignment.action !== 'reject_match') {
        existing.status = 'superseded'
        existing.validToDatasetVersionId = record.datasetVersion.id
      }
      if (assignment.action === 'assign') {
        const entry = {
          registryId: `identity-registry:${randomUUID()}`,
          datasetId: record.datasetVersion.datasetId,
          branchId: record.datasetVersion.branchId,
          assetId: assignment.assetId,
          sourceMatchType,
          sourceMatchValue,
          validFromDatasetVersionId: record.datasetVersion.id,
          validToDatasetVersionId: null,
          status: 'active',
          approvedBy: actorId,
          approvedAt,
          evidence: {
            reason: assignment.reason,
            evidenceRefs: assignment.evidenceRefs,
            sourceFeatureId: assignment.sourceFeatureId,
          },
          auditEventId,
        }
        registryById.set(entry.registryId, entry)
        registryBySource.set(key, entry)
      } else if (assignment.action === 'mark_non_asset') {
        registryBySource.delete(key)
      }
    })
    if (assignment.action === 'assign') {
      if (object) {
        object.assetId = null
        object.identityResolutionStatus = 'stable_registry'
      }
    } else if (assignment.action === 'mark_non_asset') {
      registryBySource.delete(key)
      if (object) {
        object.objectRole = 'visual_only'
        object.identityResolutionStatus = 'not_applicable'
        object.identityReviewDecision = {
          action: assignment.action,
          reason: assignment.reason,
          evidenceRefs: assignment.evidenceRefs,
          decidedBy: actorId,
          decidedAt: approvedAt,
          auditEventId,
        }
      }
    } else {
      if (object) {
        object.identityReviewDecision = {
          action: assignment.action,
          proposedAssetId: assignment.proposedAssetId,
          reason: assignment.reason,
          evidenceRefs: assignment.evidenceRefs,
          decidedBy: actorId,
          decidedAt: approvedAt,
          auditEventId,
        }
      }
    }
  })
  const identityRegistry = [...registryById.values()]
    .sort((left, right) => (
      String(left.sourceMatchValue).localeCompare(String(right.sourceMatchValue))
    ))
  const assetIdentityMap = buildCanonicalAssetIdentityMap({
    datasetVersion: record.datasetVersion,
    sourceFeatures,
    classifiedObjects,
    identityRegistry,
  })
  const identityByFeature = new Map(assetIdentityMap.items.map((item) => [
    item.sourceFeatureId,
    item,
  ]))
  const resolvedClassifiedObjects = classifiedObjects.map((object) => {
    const identity = identityByFeature.get(object.sourceFeatureId)
    if (!identity) return object
    return {
      ...object,
      canonicalAssetId: identity.canonicalAssetId,
      stableAssetId: identity.stableAssetId,
      onboardingIdentity: identity.onboardingId,
      legacyAssetId: identity.legacyId,
      identityStatus: identity.identityStatus,
      identityResolutionStatus: identity.identityResolutionStatus,
      sourceMatchType: identity.sourceMatchType,
      sourceMatchValue: identity.sourceMatchValue,
      registryId: identity.registryId,
      identityAliases: structuredClone(identity.aliases),
    }
  })
  const issues = buildIdentityIssues(assetIdentityMap, resolvedClassifiedObjects)
  const topologyInputBundle = record.topologyInputBundle
    ? buildTopologyInputBundle({
      datasetVersion: record.datasetVersion,
      classifiedObjects: resolvedClassifiedObjects,
      sourceFeatures,
      sourceGeometries: record.sourceGeometries ?? [],
      explicitRelationEvidence: record.canonicalParser?.explicitRelationEvidence ?? [],
    })
    : record.topologyInputBundle
  const readiness = buildPublicationReadinessContract({
    datasetVersion: record.datasetVersion,
    issues: [...(record.issues ?? []), ...issues],
    parserCoverage: record.parserCoverage ?? {},
    sourceFeatures,
    sourceGeometries: record.sourceGeometries ?? [],
    sourceOverlays: record.sourceOverlays ?? [],
    classifiedObjects: resolvedClassifiedObjects,
    topologyReadiness: record.topologyReadiness ?? null,
    topologyGraph: record.topologyGraph ?? null,
    evaluatedAt: approvedAt,
  })
  const updated = {
    ...record,
    sourceFeatures,
    classifiedObjects: resolvedClassifiedObjects,
    assetIdentityMap,
    assetIdentityRegistry: identityRegistry,
    identityRegistry,
    topologyInputBundle,
    readiness,
    identityAssignmentReceipts: [
      ...(record.identityAssignmentReceipts ?? []),
      ...(idempotencyKey ? [{
        key: idempotencyKey,
        fingerprint: requestFingerprint,
        auditEventId,
        response: {
          datasetVersionId: record.datasetVersion.id,
          recordRevision: normalizeRecordRevision(record.recordRevision) + 1,
          state: 'updated',
          affectedSourceFeatureIds: assignments.map(({ sourceFeatureId }) => sourceFeatureId),
          affectedAssetIds: assignments
            .filter(({ action, assetId }) => action === 'assign' && assetId)
            .map(({ assetId }) => assetId),
          identityCoverage: readiness.inventory?.coverage ?? {},
          readiness,
          auditEventId,
        },
      }] : []),
    ],
  }
  return updated
}

function findIdentityAssignmentReceipt(receipts, idempotencyKey) {
  if (!idempotencyKey) return null
  return (receipts ?? []).find(({ key }) => key === idempotencyKey) ?? null
}

function affectedAssetIds(record, assignments) {
  const byFeature = new Map(
    (record.classifiedObjects ?? []).map((object) => [object.sourceFeatureId, object]),
  )
  return assignments.map(({ sourceFeatureId, assetId }) => (
    assetId ?? byFeature.get(sourceFeatureId)?.stableAssetId ?? null
  )).filter(Boolean)
}

function identitySourceMatches(feature, sourceFeatureId) {
  const primary = feature?.sourceKmlId
    ? { sourceMatchType: 'source_kml_id', sourceMatchValue: feature.sourceKmlId }
    : feature?.sourceIdentityKey
      ? { sourceMatchType: 'source_feature_key', sourceMatchValue: feature.sourceIdentityKey }
      : { sourceMatchType: 'source_feature_id', sourceMatchValue: sourceFeatureId }
  if (primary.sourceMatchType === 'source_feature_id') return [primary]
  return [
    primary,
    { sourceMatchType: 'source_feature_id', sourceMatchValue: sourceFeatureId },
  ]
}

function identityRegistryKey(type, value) {
  return `${type ?? ''}:${value ?? ''}`
}

function normalizeRecordRevision(value) {
  const revision = Number(value)
  return Number.isInteger(revision) && revision >= 0 ? revision : 0
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 50)
}

function normalizeBoundedText(value, field) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AppError(`Field ${field} identity assignment tidak valid.`, {
      code: 'invalid_identity_assignment_field',
      statusCode: 400,
      details: { field },
    })
  }
  return normalized
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value) {
  if (value === undefined) return '"__undefined__"'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`
}
