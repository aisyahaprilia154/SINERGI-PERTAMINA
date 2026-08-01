import { AppError } from '../errors.js'
import {
  buildAssetIdentityMapFromRecord,
  createAssetIdentityResolver,
} from '../domain/canonical-asset-identity.js'
import { normalizeTopologySummary } from '../topology/semantic-relation-engine.js'

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
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const resolver = createAssetIdentityResolver(identityMap)
    const topology = normalizeTopologyGraph(record, identityMap)
    const readinessContract = buildReadinessContract(record, topology.graph)
    return {
      activePointer: resolved.pointer,
      datasetVersion: {
        ...record.datasetVersion,
        status: 'active',
        publicationStatus: 'published',
        activePointerRevision: resolved.pointer.revision,
      },
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
    }
  }

  async getActiveMapDataset({ datasetId, branchId } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    return toActiveMapDataset(resolved)
  }

  async getActiveAssetDetail({ datasetId, branchId, assetId } = {}) {
    const resolved = await this.#resolveActive(datasetId, branchId)
    const record = resolved.record
    const identityMap = buildAssetIdentityMapFromRecord(record)
    const resolver = createAssetIdentityResolver(identityMap)
    const canonicalAssetId = resolver.resolve(assetId)
    const asset = (record.assets ?? []).find((item) => (
      resolver.resolve(item.canonicalAssetId ?? item.assetId ?? item.id) === canonicalAssetId
    ))
    if (!asset) {
      throw new AppError('Aset tidak ditemukan pada dataset aktif.', {
        code: 'active_asset_not_found',
        statusCode: 404,
      })
    }
    const relations = filterResolvedRelations(record, resolver)
      .filter((relation) => (
        relation.sourceAssetId === canonicalAssetId
          || relation.targetAssetId === canonicalAssetId
      ))
    const topology = normalizeTopologyGraph(record, identityMap)
    const readinessContract = buildReadinessContract(record, topology.graph)
    return {
      activePointer: resolved.pointer,
      datasetVersion: publicDatasetVersion(record.datasetVersion, resolved.pointer),
      asset: projectAssetIdentity(asset, identityMap, resolver),
      identity: structuredClone(
        identityMap.items.find(({ canonicalAssetId: id }) => id === canonicalAssetId) ?? null,
      ),
      geometries: (record.geometries ?? [])
        .filter((geometry) => geometry.assetNodeId === asset.id)
        .map((geometry) => structuredClone(geometry)),
      relations: relations.map((relation) => structuredClone(relation)),
      topologyReadiness: record.topologyReadiness ?? null,
      topologyIdentity: topology.identity,
      readiness: record.readiness ?? null,
      readinessContract,
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
  const assetIdentityMap = buildAssetIdentityMapFromRecord(record)
  const resolver = createAssetIdentityResolver(assetIdentityMap)
  const topology = normalizeTopologyGraph(record, assetIdentityMap)
  const renderableGeometries = (record.geometries ?? []).filter(isRenderableGeometry)
  const renderableNodeIds = new Set(renderableGeometries.map(({ assetNodeId }) => assetNodeId))
  const relations = filterResolvedRelations(record, resolver)
  const readinessContract = buildReadinessContract(record, topology.graph)
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
    assets: (record.assets ?? []).map((asset) => {
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
    }),
    geometries: renderableGeometries.map((geometry) => ({
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
    topologyGraph: topology.graph,
    topologySummary: normalizeTopologySummary(
      record.topologySummary,
      topology.graph,
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
      totalAssets: (record.assets ?? []).length,
      assetsWithoutGeometry: (record.assets ?? []).length - renderableNodeIds.size,
      renderedGeometries: renderableGeometries.length,
      invalidGeometriesOmitted: (record.geometries ?? []).length - renderableGeometries.length,
      resolvedRelations: relations.length,
      unresolvedRelationsOmitted: (record.relations ?? []).length - relations.length,
      topologyNodes: topology.graph.nodes.length,
      topologyEdges: topology.graph.edges.length,
      topologyIdentityUnresolved: topology.identity.unresolvedNodeCount
        + topology.identity.unresolvedEdgeCount,
    },
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
  return {
    graph: {
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
    },
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
  const topologyStatus = record.topologyReadiness?.topologyReadiness
    ?? parserReadiness.topologyReadiness
    ?? 'not_ready'
  const topologyReady = topologyStatus === 'ready' && topologyGraph.edges.length > 0
  return {
    mapReady: parserReadiness.mapReadiness ?? 'not_ready',
    inventoryReady: parserReadiness.inventoryReadiness ?? 'not_ready',
    topologyReady: topologyReady ? 'ready' : 'not_ready',
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
    status: 'active',
    publicationStatus: 'published',
    activePointerRevision: pointer.revision,
  }
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
