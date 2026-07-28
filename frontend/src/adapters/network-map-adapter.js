import {
  NETWORK_MAP_CONTRACT_VERSION,
  isPlainRecord,
  validateNetworkMapData,
} from '../domain/network-map-contract.js'

const readString = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim()
const asArray = (value) => Array.isArray(value) ? value : []

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]))
  }
  return value
}

function normalizeContext(rawContext) {
  if (!isPlainRecord(rawContext)) {
    throw new TypeError('MapContext atau activeContext wajib diberikan kepada adapter.')
  }

  const branchId = readString(rawContext.branchId)
  const datasetVersionId = readString(rawContext.datasetVersionId, rawContext.datasetId)
  const datasetVersionName = readString(
    rawContext.datasetVersionName,
    rawContext.version,
    rawContext.datasetName,
    datasetVersionId,
  )

  if (!branchId || !datasetVersionId || !datasetVersionName) {
    throw new TypeError('branchId, datasetVersionId, dan datasetVersionName wajib tersedia.')
  }

  return {
    branchId,
    datasetVersionId,
    datasetVersionName,
    ...(readString(rawContext.sourceFilename) ? { sourceFilename: rawContext.sourceFilename.trim() } : {}),
    selectedNetworkIds: asArray(rawContext.selectedNetworkIds).filter((id) => typeof id === 'string'),
    ...(readString(rawContext.selectedAssetId) ? { selectedAssetId: rawContext.selectedAssetId.trim() } : {}),
    ...(readString(rawContext.traceFrom) ? { traceFrom: rawContext.traceFrom.trim() } : {}),
    ...(readString(rawContext.traceTo) ? { traceTo: rawContext.traceTo.trim() } : {}),
  }
}

function extractAssets(parserOutput) {
  if (parserOutput?.type === 'FeatureCollection') return asArray(parserOutput.features)
  return asArray(
    parserOutput?.assets
    ?? parserOutput?.features
    ?? parserOutput?.nodes
    ?? parserOutput?.placemarks,
  )
}

function extractRelations(parserOutput) {
  return asArray(
    parserOutput?.relations
    ?? parserOutput?.assetRelations
    ?? parserOutput?.metadata?.relations,
  )
}

function extractNetworks(parserOutput) {
  return asArray(parserOutput?.networks ?? parserOutput?.metadata?.networks)
}

function adaptAsset(rawAsset, context, index, warnings) {
  if (!isPlainRecord(rawAsset)) {
    warnings.push(`Asset pada index ${index} dilewati karena bukan object.`)
    return null
  }

  const sourceProperties = isPlainRecord(rawAsset.properties) ? rawAsset.properties : {}
  const assetId = readString(
    rawAsset.assetId,
    sourceProperties.assetId,
    rawAsset.id,
    sourceProperties.id,
  )
  const id = readString(rawAsset.id, sourceProperties.id, assetId)

  if (!id || !assetId) {
    warnings.push(`Asset pada index ${index} dilewati karena tidak memiliki id/assetId.`)
    return null
  }

  const explicitBranchId = readString(rawAsset.branchId, sourceProperties.branchId)
  const explicitDatasetVersionId = readString(
    rawAsset.datasetVersionId,
    sourceProperties.datasetVersionId,
  )

  if (explicitBranchId && explicitBranchId !== context.branchId) {
    warnings.push(`Asset ${id} dilewati karena berasal dari branch ${explicitBranchId}.`)
    return null
  }
  if (explicitDatasetVersionId && explicitDatasetVersionId !== context.datasetVersionId) {
    warnings.push(`Asset ${id} dilewati karena berasal dari dataset ${explicitDatasetVersionId}.`)
    return null
  }

  const properties = cloneValue(sourceProperties)
  for (const key of ['status', 'ip', 'owner', 'description']) {
    if (rawAsset[key] !== undefined && properties[key] === undefined) {
      properties[key] = cloneValue(rawAsset[key])
    }
  }

  // Legacy x/y in the current demo are display coordinates, not longitude and
  // latitude. They are preserved as metadata and never promoted to geometry.
  if (Number.isFinite(rawAsset.x) && Number.isFinite(rawAsset.y)) {
    properties.displayPosition = {
      x: rawAsset.x,
      y: rawAsset.y,
      coordinateSpace: 'viewport-normalized',
    }
  }

  const geometry = cloneValue(rawAsset.geometry ?? rawAsset.feature?.geometry ?? null)
  const category = readString(rawAsset.category, sourceProperties.category, rawAsset.type, sourceProperties.type) ?? 'unknown'
  const type = readString(rawAsset.type, sourceProperties.type, category) ?? 'unknown'

  return {
    id,
    assetId,
    name: readString(rawAsset.name, sourceProperties.name, assetId) ?? assetId,
    category,
    type,
    branchId: context.branchId,
    location: cloneValue(rawAsset.location ?? sourceProperties.location ?? null),
    geometry,
    properties,
    layerId: readString(rawAsset.layerId, sourceProperties.layerId) ?? null,
    datasetVersionId: context.datasetVersionId,
  }
}

function relationFromRecord(rawRelation, index, sourceLabel, warnings) {
  if (!isPlainRecord(rawRelation)) {
    warnings.push(`Relation ${sourceLabel}[${index}] dilewati karena bukan object.`)
    return null
  }

  const sourceAssetId = readString(rawRelation.sourceAssetId, rawRelation.source, rawRelation.from)
  const targetAssetId = readString(rawRelation.targetAssetId, rawRelation.target, rawRelation.to)
  if (!sourceAssetId || !targetAssetId) {
    warnings.push(`Relation ${sourceLabel}[${index}] dilewati karena endpoint tidak lengkap.`)
    return null
  }

  return {
    id: readString(rawRelation.id) ?? `relation:${sourceLabel}:${sourceAssetId}:${targetAssetId}:${index}`,
    sourceAssetId,
    targetAssetId,
    relationType: readString(rawRelation.relationType, rawRelation.type) ?? 'unspecified',
    ...(readString(rawRelation.pathAssetId) ? { pathAssetId: rawRelation.pathAssetId.trim() } : {}),
    ...(readString(rawRelation.layerId) ? { layerId: rawRelation.layerId.trim() } : {}),
    ...(isPlainRecord(rawRelation.metadata) ? { metadata: cloneValue(rawRelation.metadata) } : {}),
  }
}

function relationFromEdge(rawEdge, network, edgeIndex, warnings) {
  let edgeRecord
  if (Array.isArray(rawEdge)) {
    edgeRecord = { sourceAssetId: rawEdge[0], targetAssetId: rawEdge[1] }
  } else if (isPlainRecord(rawEdge)) {
    edgeRecord = rawEdge
  } else {
    warnings.push(`Edge ${network.id}[${edgeIndex}] dilewati karena bentuknya tidak dikenal.`)
    return null
  }

  const relation = relationFromRecord(edgeRecord, edgeIndex, `network:${network.id}`, warnings)
  if (!relation) return null

  relation.id = readString(edgeRecord.id)
    ?? `relation:network:${network.id}:${relation.sourceAssetId}:${relation.targetAssetId}:${edgeIndex}`
  relation.relationType = readString(edgeRecord.relationType, network.relationType) ?? 'network-connection'
  relation.metadata = {
    ...(isPlainRecord(relation.metadata) ? relation.metadata : {}),
    networkId: network.id,
  }
  return relation
}

/**
 * Adapts parser output or the current project data shape into NetworkMapData.
 * The function never mutates its inputs and never creates relations from
 * geographic proximity.
 *
 * @param {{
 *   parserOutput: Record<string, unknown>,
 *   context?: Record<string, unknown>
 * }} input
 */
export function adaptNetworkMapData({ parserOutput, context: inputContext } = {}) {
  if (!isPlainRecord(parserOutput)) {
    throw new TypeError('parserOutput wajib berupa object.')
  }

  const warnings = []
  const context = normalizeContext(inputContext ?? parserOutput.context ?? parserOutput.activeContext)
  const nodeIds = new Set()
  const assetIds = new Set()
  const assetAliases = new Map()
  const assets = []

  extractAssets(parserOutput).forEach((rawAsset, index) => {
    const asset = adaptAsset(rawAsset, context, index, warnings)
    if (!asset) return
    if (nodeIds.has(asset.id) || assetIds.has(asset.assetId)) {
      warnings.push(`Asset duplikat ${asset.id}/${asset.assetId} dilewati.`)
      return
    }
    nodeIds.add(asset.id)
    assetIds.add(asset.assetId)
    assetAliases.set(asset.id, asset.assetId)
    assetAliases.set(asset.assetId, asset.assetId)
    assets.push(asset)
  })

  const rawNetworks = extractNetworks(parserOutput)
  const relationCandidates = extractRelations(parserOutput)
    .map((relation, index) => relationFromRecord(relation, index, 'relations', warnings))
    .filter(Boolean)
  const edgeRelationIdsByNetwork = new Map()

  rawNetworks.forEach((rawNetwork, networkIndex) => {
    if (!isPlainRecord(rawNetwork)) return
    const networkId = readString(rawNetwork.id) ?? `network:${networkIndex}`
    const relationIds = []
    asArray(rawNetwork.edges).forEach((edge, edgeIndex) => {
      const relation = relationFromEdge(edge, { ...rawNetwork, id: networkId }, edgeIndex, warnings)
      if (relation) {
        relationCandidates.push(relation)
        relationIds.push(relation.id)
      }
    })
    edgeRelationIdsByNetwork.set(networkId, relationIds)
  })

  const relationIds = new Set()
  const relations = []
  relationCandidates.forEach((candidate) => {
    const sourceAssetId = assetAliases.get(candidate.sourceAssetId)
    const targetAssetId = assetAliases.get(candidate.targetAssetId)
    const pathAssetId = candidate.pathAssetId ? assetAliases.get(candidate.pathAssetId) : undefined
    const relation = {
      ...candidate,
      sourceAssetId: sourceAssetId ?? candidate.sourceAssetId,
      targetAssetId: targetAssetId ?? candidate.targetAssetId,
      ...(candidate.pathAssetId && pathAssetId ? { pathAssetId } : {}),
    }
    if (relationIds.has(relation.id)) {
      warnings.push(`Relation duplikat ${relation.id} dilewati.`)
      return
    }
    if (!assetIds.has(relation.sourceAssetId) || !assetIds.has(relation.targetAssetId)) {
      warnings.push(`Relation ${relation.id} dilewati karena endpoint tidak ditemukan pada dataset aktif.`)
      return
    }
    relationIds.add(relation.id)
    relations.push(relation)
  })

  const networkIds = new Set()
  const networks = []
  rawNetworks.forEach((rawNetwork, index) => {
    if (!isPlainRecord(rawNetwork)) {
      warnings.push(`Network pada index ${index} dilewati karena bukan object.`)
      return
    }
    const id = readString(rawNetwork.id) ?? `network:${index}`
    if (networkIds.has(id)) {
      warnings.push(`Network duplikat ${id} dilewati.`)
      return
    }
    networkIds.add(id)

    const rawAssetIds = asArray(rawNetwork.assetIds ?? rawNetwork.nodeIds)
    const rawRelationIds = [
      ...asArray(rawNetwork.relationIds),
      ...(edgeRelationIdsByNetwork.get(id) ?? []),
    ]

    networks.push({
      id,
      name: readString(rawNetwork.name, id) ?? id,
      category: readString(rawNetwork.category, rawNetwork.type) ?? 'uncategorized',
      assetIds: [...new Set(rawAssetIds.map((assetId) => assetAliases.get(assetId)).filter(Boolean))],
      relationIds: [...new Set(rawRelationIds.filter((relationId) => relationIds.has(relationId)))],
      ...(Array.isArray(rawNetwork.bounds) ? { bounds: cloneValue(rawNetwork.bounds) } : {}),
      colorToken: readString(rawNetwork.colorToken, rawNetwork.color) ?? `network-${index + 1}`,
      isDefaultVisible: typeof rawNetwork.isDefaultVisible === 'boolean'
        ? rawNetwork.isDefaultVisible
        : context.selectedNetworkIds.includes(id),
    })
  })

  const assignedAssetIds = new Set(networks.flatMap((network) => network.assetIds))
  const unassignedAssetIds = assets.map((asset) => asset.assetId).filter((id) => !assignedAssetIds.has(id))

  if (unassignedAssetIds.length) {
    const unassignedSet = new Set(unassignedAssetIds)
    const fallbackRelationIds = relations
      .filter((relation) => unassignedSet.has(relation.sourceAssetId) && unassignedSet.has(relation.targetAssetId))
      .map((relation) => relation.id)

    networks.push({
      id: 'network:unassigned',
      name: 'Aset tanpa jaringan',
      category: 'unassigned',
      assetIds: unassignedAssetIds,
      relationIds: fallbackRelationIds,
      colorToken: 'network-unassigned',
      isDefaultVisible: networks.length === 0,
    })
    networkIds.add('network:unassigned')
    warnings.push(`${unassignedAssetIds.length} asset ditempatkan pada network fallback tanpa membuat relasi baru.`)
  }

  context.selectedNetworkIds = context.selectedNetworkIds.filter((id) => networkIds.has(id))
  if (!inputContext?.selectedNetworkIds && context.selectedNetworkIds.length === 0) {
    context.selectedNetworkIds = networks.filter((network) => network.isDefaultVisible).map((network) => network.id)
  }

  for (const key of ['selectedAssetId', 'traceFrom', 'traceTo']) {
    if (context[key]) {
      const canonicalAssetId = assetAliases.get(context[key])
      if (canonicalAssetId) context[key] = canonicalAssetId
      else {
        warnings.push(`${key} dihapus dari context karena asset tidak ditemukan pada dataset aktif.`)
        delete context[key]
      }
    }
  }

  const result = {
    contractVersion: NETWORK_MAP_CONTRACT_VERSION,
    context,
    assets,
    relations,
    networks,
    warnings,
  }
  const validation = validateNetworkMapData(result)
  if (!validation.valid) {
    throw new TypeError(`Hasil adapter tidak valid: ${validation.errors.join(' ')}`)
  }
  result.warnings.push(...validation.warnings.filter((warning) => !result.warnings.includes(warning)))
  return result
}
