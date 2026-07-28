import { AppError } from '../errors.js'

export class DatasetVersionLifecycleService {
  constructor({
    repository,
    auditLog,
    activeDatasetCache = null,
    clock = () => new Date(),
  }) {
    this.repository = repository
    this.auditLog = auditLog
    this.activeDatasetCache = activeDatasetCache
    this.clock = clock
  }

  async getPreview(datasetVersionId) {
    const candidate = await this.repository.get(datasetVersionId)
    const active = await this.repository.findActive(
      candidate.datasetVersion.datasetId,
      { excludeId: datasetVersionId },
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
      sourceSelection: candidate.sourceSelection ?? null,
      comparison,
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

  async getActiveDataset({ datasetId, branchId } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    const record = resolved.record
    return {
      activePointer: resolved.pointer,
      datasetVersion: {
        ...record.datasetVersion,
        status: 'active',
        publicationStatus: 'published',
        activePointerRevision: resolved.pointer.revision,
      },
      layers: record.layers ?? [],
      assets: record.assets ?? [],
      geometries: record.geometries ?? [],
      relations: record.relations ?? [],
    }
  }

  async getActiveMapDataset({ datasetId, branchId } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    return toActiveMapDataset(resolved)
  }

  async getActiveAssetDetail({ datasetId, branchId, assetId } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    const record = resolved.record
    const asset = (record.assets ?? []).find((item) => item.assetId === assetId)
    if (!asset) {
      throw new AppError('Aset tidak ditemukan pada dataset aktif.', {
        code: 'active_asset_not_found',
        statusCode: 404,
      })
    }
    const relations = filterResolvedRelations(record)
      .filter((relation) => (
        relation.sourceAssetId === assetId || relation.targetAssetId === assetId
      ))
    return {
      activePointer: resolved.pointer,
      datasetVersion: publicDatasetVersion(record.datasetVersion, resolved.pointer),
      asset: structuredClone(asset),
      geometries: (record.geometries ?? [])
        .filter((geometry) => geometry.assetNodeId === asset.id)
        .map((geometry) => structuredClone(geometry)),
      relations: relations.map((relation) => structuredClone(relation)),
    }
  }

  async #resolveActive(datasetId, branchId) {
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
  }

  async activate(datasetVersionId, actorId, {
    expectedActiveVersionId,
  } = {}) {
    let target = null
    const activatedAt = this.clock().toISOString()
    try {
      target = await this.repository.get(datasetVersionId)
      const transaction = await this.repository.activateVersionAtomically({
        datasetVersionId,
        actorId,
        activatedAt,
        expectedActiveVersionId,
        validateTarget(record) {
          if (!canActivate(record)) {
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
            outcome: 'failed',
            details: {
              datasetId: transaction.pointer.datasetId,
              revision: transaction.pointer.revision,
              errorCode: cacheError.code ?? cacheError.name,
            },
          }).catch(() => {})
        }
      }

      await this.auditLog.record('dataset_version.activated', {
        actorId,
        datasetVersionId,
        branchId: transaction.pointer.branchId,
        outcome: 'active',
        details: {
          datasetId: transaction.pointer.datasetId,
          previousVersionId: transaction.pointer.previousVersionId,
          newVersionId: datasetVersionId,
          activatedBy: actorId,
          activatedAt,
          validationSummary: transaction.activated.validation?.summary ?? {},
          result: 'committed',
          activePointerRevision: transaction.pointer.revision,
        },
      }).catch(() => {})
      return {
        datasetVersion: withoutInternalStorage(transaction.activated.datasetVersion),
        archivedDatasetVersion: transaction.previous
          ? withoutInternalStorage(transaction.previous.datasetVersion)
          : null,
        activePointer: transaction.pointer,
        cacheInvalidated,
        mapUrl: `/map?datasetId=${encodeURIComponent(transaction.pointer.datasetId)}`
          + `&branchId=${encodeURIComponent(transaction.pointer.branchId)}`,
      }
    } catch (error) {
      const context = error.activationContext ?? {}
      await this.auditLog.record('dataset_version.activation_failed', {
        actorId,
        datasetVersionId,
        branchId: context.branchId ?? target?.datasetVersion.branchId ?? null,
        outcome: 'failed',
        details: {
          datasetId: context.datasetId ?? target?.datasetVersion.datasetId ?? null,
          previousVersionId: context.previousVersionId ?? null,
          newVersionId: datasetVersionId,
          activatedBy: actorId,
          activatedAt,
          validationSummary: target?.validation?.summary ?? {},
          result: 'rolled_back',
          errorCode: error.code ?? error.name,
        },
      }).catch(() => {})
      throw error
    }
  }

  async reject(datasetVersionId, actorId) {
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
      },
    }))
    await this.auditLog.record('dataset_version.rejected', {
      actorId,
      datasetVersionId,
      branchId: rejected.datasetVersion.branchId,
      outcome: 'archived',
    })
    return { datasetVersion: withoutInternalStorage(rejected.datasetVersion) }
  }
}

export function compareDatasetVersions(candidate, active) {
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

function toActiveMapDataset(resolved) {
  const record = resolved.record
  const renderableGeometries = (record.geometries ?? []).filter(isRenderableGeometry)
  const renderableNodeIds = new Set(renderableGeometries.map(({ assetNodeId }) => assetNodeId))
  const relations = filterResolvedRelations(record)
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
    assets: (record.assets ?? []).map((asset) => ({
      id: asset.id,
      datasetVersionId: asset.datasetVersionId,
      layerId: asset.layerId,
      assetId: asset.assetId,
      name: asset.name,
      category: asset.category,
      type: asset.type,
      branchId: asset.branchId,
      location: asset.location,
      status: readAssetProperty(asset, 'status') ?? null,
      visibility: readAssetProperty(asset, 'visibility') ?? null,
      hasRenderableGeometry: renderableNodeIds.has(asset.id),
    })),
    geometries: renderableGeometries.map((geometry) => ({
      id: geometry.id,
      assetNodeId: geometry.assetNodeId,
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
      relationType: relation.relationType,
      pathAssetId: relation.pathAssetId,
      layerId: relation.layerId,
      relationSource: relation.relationSource
        ?? relation.metadata?.topology?.relationSource
        ?? 'explicit',
      relationStatus: relation.relationStatus ?? 'confirmed',
      sourceGeometryId: relation.sourceGeometryId,
      distanceMeters: relation.distanceMeters,
      metadata: relation.metadata ? structuredClone(relation.metadata) : undefined,
    })),
    renderingSummary: {
      totalAssets: (record.assets ?? []).length,
      assetsWithoutGeometry: (record.assets ?? []).length - renderableNodeIds.size,
      renderedGeometries: renderableGeometries.length,
      invalidGeometriesOmitted: (record.geometries ?? []).length - renderableGeometries.length,
      resolvedRelations: relations.length,
      unresolvedRelationsOmitted: (record.relations ?? []).length - relations.length,
    },
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
    status: 'active',
    publicationStatus: 'published',
    activePointerRevision: pointer.revision,
  }
}

function withoutInternalStorage(datasetVersion) {
  const { sourceStorageKey, ...publicVersion } = datasetVersion
  return publicVersion
}

function filterResolvedRelations(record) {
  const assetIds = new Set((record.assets ?? []).map(({ assetId }) => assetId))
  return (record.relations ?? []).filter((relation) => (
    (!relation.datasetVersionId || relation.datasetVersionId === record.datasetVersion.id)
    && assetIds.has(relation.sourceAssetId)
    && assetIds.has(relation.targetAssetId)
    && relation.sourceAssetId !== relation.targetAssetId
  ))
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

function canActivate(record) {
  return record.datasetVersion.status === 'valid'
    && record.datasetVersion.validationStatus === 'valid'
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
