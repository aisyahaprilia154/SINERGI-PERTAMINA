import {
  KML_IMPORT_CONTRACT_VERSION,
  isAssetGeometry,
  isPlainRecord,
  validateKmlImportResult,
} from '../domain/kml-import-contract.js'
import { buildTopologyGraph } from '../domain/topology-builder.js'

const DEFAULT_METADATA_ALIASES = Object.freeze({
  assetId: ['asset_id', 'assetId', 'Asset ID', 'ASSET_ID', 'kode_aset'],
  assetName: ['asset_name', 'assetName', 'Asset Name', 'nama_aset'],
  category: ['category', 'asset_category', 'kategori'],
  assetType: ['asset_type', 'assetType', 'Asset Type', 'type', 'jenis_aset'],
  branchId: ['branch_id', 'branchId', 'Branch ID', 'kode_cabang'],
  branchName: ['branch_name', 'branchName', 'Branch Name', 'nama_cabang'],
  location: ['location', 'lokasi', 'asset_location'],
  ipAddress: ['ip_address', 'ipAddress', 'IP Address', 'ip'],
  hostname: ['hostname', 'host_name', 'Host Name'],
  status: ['status', 'asset_status'],
  connectedTo: ['connected_to', 'connectedTo', 'Connected To'],
  parentAssetId: ['parent_asset_id', 'parentAssetId', 'Parent Asset ID'],
  upstreamAssetId: ['upstream_asset_id', 'upstreamAssetId', 'Upstream Asset ID'],
  downstreamAssetId: ['downstream_asset_id', 'downstreamAssetId', 'Downstream Asset ID'],
  sourceAssetId: ['source_asset_id', 'sourceAssetId', 'Source Asset ID'],
  targetAssetId: ['target_asset_id', 'targetAssetId', 'Target Asset ID'],
  relationType: ['relation_type', 'relationType', 'Relation Type'],
})
const asArray = (value) => Array.isArray(value) ? value : []
const readString = (...values) => values.find(
  (value) => typeof value === 'string' && value.trim(),
)?.trim()

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    )
  }
  return value
}

function normalizeMetadataKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function findMetadataMatch(metadata, keys) {
  const entries = Object.entries(metadata)
  for (const key of keys) {
    const normalizedKey = normalizeMetadataKey(key)
    const match = entries.find(([entryKey, entryValue]) => (
      normalizeMetadataKey(entryKey) === normalizedKey
      && entryValue !== undefined
      && entryValue !== null
      && String(entryValue).trim()
    ))
    if (match) {
      return {
        sourceKey: match[0],
        originalValue: cloneValue(match[1]),
        value: String(match[1]).trim(),
      }
    }
  }
  return undefined
}

function readMetadataValue(metadata, keys) {
  return findMetadataMatch(metadata, keys)?.value
}

function normalizeMetadataAliases(configuredAliases) {
  const aliases = { ...DEFAULT_METADATA_ALIASES }
  if (!isPlainRecord(configuredAliases)) return aliases
  for (const [field, configured] of Object.entries(configuredAliases)) {
    if (Array.isArray(configured) && configured.every((value) => typeof value === 'string')) {
      aliases[field] = configured
    }
  }
  return aliases
}

function mapSemanticMetadata(metadata, aliases) {
  const values = {}
  const mappings = []
  for (const [targetField, sourceAliases] of Object.entries(aliases)) {
    const match = findMetadataMatch(metadata, sourceAliases)
    if (!match) continue
    values[targetField] = match.value
    mappings.push({
      targetField,
      sourceKey: match.sourceKey,
      originalValue: match.originalValue,
      normalizedValue: match.value,
    })
  }
  return { values, mappings }
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item'
}

function createSourceIdentityBase({ sourceFolderPath, placemarkName }) {
  const normalizedPath = readString(sourceFolderPath)
  const normalizedName = readString(placemarkName)
  if (!normalizedPath || normalizedPath === '/' || !normalizedName) return null
  return `src:${slugify(normalizedPath)}:${slugify(normalizedName)}`
}

function createSourceIdentity({
  mode,
  sourceFolderPath,
  placemarkName,
  counts,
  occurrences,
}) {
  if (mode !== 'folder-path-name') return null
  const base = createSourceIdentityBase({ sourceFolderPath, placemarkName })
  if (!base) return null
  const total = counts.get(base) ?? 1
  const occurrence = (occurrences.get(base) ?? 0) + 1
  occurrences.set(base, occurrence)
  return {
    assetId: total > 1 ? `${base}:${occurrence}` : base,
    sourceReference: `${sourceFolderPath} / ${placemarkName}`,
    occurrence,
    total,
  }
}

function isUnmappedCategory(value) {
  return ['unmapped', 'uncategorized', 'unknown', '']
    .includes(String(value ?? '').trim().toLowerCase())
}

function countSourceFolders(folders) {
  return folders.reduce((count, folder) => {
    if (!isPlainRecord(folder)) return count
    return count + 1 + countSourceFolders(asArray(folder.folders ?? folder.children))
  }, 0)
}

function folderContainsObjects(folder) {
  if (!isPlainRecord(folder)) return false
  if (asArray(folder.placemarks ?? folder.features).length) return true
  return asArray(folder.folders ?? folder.children).some(folderContainsObjects)
}

function normalizePath(parentPath, name) {
  const normalizedName = String(name).trim().replace(/^\/+|\/+$/g, '')
  if (!normalizedName) return parentPath || '/'
  if (!parentPath || parentPath === '/') return `/${normalizedName}`
  return `${parentPath.replace(/\/+$/g, '')}/${normalizedName}`
}

/**
 * Adapts a parser result into the persistence-facing SINERGI import contract.
 * It does not parse XML/ZIP, mutate parser output, or write to storage/database.
 * Its topology phase may derive confirmed edges only within configured geographic
 * tolerances and records uncertain candidates as diagnostics.
 *
 * Explicit relation metadata mappings have this shape:
 * `{ targetKey, relationType, pathAssetKey?, separator? }`. The source asset is
 * the placemark that owns the metadata.
 *
 * @param {{
 *   parserOutput: Record<string, unknown>,
 *   datasetVersion: Record<string, unknown>,
 *   mapping?: {
 *     assetIdKeys?: string[],
 *     sourceIdentityFallback?: 'none'|'folder-path-name',
 *     metadataAliases?: Record<string, string[]>,
 *     relationMappings?: Array<{
 *       mode?: 'owner-target'|'explicit-pair',
 *       targetKey?: string,
 *       targetField?: string,
 *       sourceField?: string,
 *       relationType?: string,
 *       relationTypeField?: string,
 *       pathAssetKey?: string,
 *       separator?: string,
 *       unresolvedSeverity?: 'error'|'warning'
 *     }>,
 *     topology?: Record<string, unknown>
 *   }
 * }} input
 */
export function adaptKmlImportResult({
  parserOutput,
  datasetVersion: inputDatasetVersion,
  mapping = {},
} = {}) {
  if (!isPlainRecord(parserOutput)) {
    throw new TypeError('parserOutput wajib berupa object.')
  }

  const datasetVersion = normalizeDatasetVersion(inputDatasetVersion)
  const issues = []
  const layers = []
  const assets = []
  const geometries = []
  const relations = []
  const placemarkRecords = []
  const layerByReference = new Map()
  const pendingLayerParents = []
  const usedLayerIds = new Set()
  const metadataAliases = normalizeMetadataAliases(mapping.metadataAliases)
  const assetIdKeys = asArray(mapping.assetIdKeys).length
    ? mapping.assetIdKeys
    : metadataAliases.assetId
  const sourceIdentityFallback = mapping.sourceIdentityFallback === 'folder-path-name'
    ? 'folder-path-name'
    : 'none'
  let issueSequence = 0
  const sourceFolderCount = countSourceFolders(asArray(parserOutput.folders))
  let folderSequence = 0

  function addIssue({
    severity,
    issueCode,
    message,
    canActivate,
    sourceFolderPath,
    sourcePlacemarkName,
    assetId,
    geometryReference,
  }) {
    issueSequence += 1
    issues.push({
      id: `issue:${datasetVersion.id}:${issueSequence}`,
      datasetVersionId: datasetVersion.id,
      severity,
      issueCode,
      message,
      ...(readString(sourceFolderPath) ? { sourceFolderPath: sourceFolderPath.trim() } : {}),
      ...(readString(sourcePlacemarkName) ? { sourcePlacemarkName: sourcePlacemarkName.trim() } : {}),
      ...(readString(assetId) ? { assetId: assetId.trim() } : {}),
      ...(readString(geometryReference) ? { geometryReference: geometryReference.trim() } : {}),
      canActivate,
    })
  }

  function createLayer(rawFolder, parentLayer = null, parentPath = '/', displayOrder = 0) {
    if (!isPlainRecord(rawFolder)) {
      addIssue({
        severity: 'warning',
        issueCode: 'invalid_folder_record',
        message: 'Folder KML dilewati karena bentuk output parser tidak dikenal.',
        canActivate: true,
      })
      return null
    }

    folderSequence += 1
    const name = readString(rawFolder.name, rawFolder.title) ?? `Folder ${folderSequence}`
    const sourceFolderPath = readString(rawFolder.sourceFolderPath, rawFolder.path)
      ?? normalizePath(parentPath, name)
    if (!folderContainsObjects(rawFolder)) return null
    const preferredId = readString(rawFolder.layerId, rawFolder.id)
      ?? `layer:${datasetVersion.id}:${slugify(sourceFolderPath)}`
    let id = preferredId
    let duplicateIndex = 2
    while (usedLayerIds.has(id)) {
      id = `${preferredId}:${duplicateIndex}`
      duplicateIndex += 1
    }
    if (id !== preferredId) {
      addIssue({
        severity: 'warning',
        issueCode: 'duplicate_folder_id',
        message: `ID folder ${preferredId} duplikat; layer diberi ID unik tanpa mengubah data sumber.`,
        sourceFolderPath,
        canActivate: true,
      })
    }

    const sourceCategory = readString(rawFolder.category)
    const inheritedCategory = isUnmappedCategory(sourceCategory)
      ? parentLayer?.category
      : null
    const layer = {
      id,
      datasetVersionId: datasetVersion.id,
      ...(parentLayer ? { parentLayerId: parentLayer.id } : {}),
      sourceFolderPath,
      name,
      category: inheritedCategory ?? sourceCategory ?? parentLayer?.category ?? 'uncategorized',
      displayOrder: Number.isInteger(rawFolder.displayOrder) && rawFolder.displayOrder >= 0
        ? rawFolder.displayOrder
        : displayOrder,
      defaultVisible: parentLayer?.defaultVisible !== false && (typeof rawFolder.defaultVisible === 'boolean'
        ? rawFolder.defaultVisible
        : rawFolder.visibility !== false && rawFolder.visibility !== 0),
      ...(readString(rawFolder.sourceStyleId, rawFolder.styleId)
        ? { sourceStyleId: readString(rawFolder.sourceStyleId, rawFolder.styleId) }
        : {}),
    }

    usedLayerIds.add(id)
    layers.push(layer)
    for (const reference of [rawFolder.id, rawFolder.layerId, rawFolder.path, sourceFolderPath]) {
      if (readString(reference)) layerByReference.set(String(reference).trim(), layer)
    }
    if (!parentLayer && readString(rawFolder.parentFolderId, rawFolder.parentLayerId)) {
      pendingLayerParents.push({
        layer,
        parentReference: readString(rawFolder.parentFolderId, rawFolder.parentLayerId),
      })
    }

    asArray(rawFolder.placemarks ?? rawFolder.features).forEach((placemark, index) => {
      placemarkRecords.push({ placemark, layer, sourceFolderPath, sourceIndex: index })
    })
    asArray(rawFolder.folders ?? rawFolder.children).forEach((child, index) => {
      createLayer(child, layer, sourceFolderPath, index)
    })
    return layer
  }

  asArray(parserOutput.folders).forEach((folder, index) => createLayer(folder, null, '/', index))
  pendingLayerParents.forEach(({ layer, parentReference }) => {
    const parentLayer = layerByReference.get(parentReference)
    if (parentLayer && parentLayer.id !== layer.id) {
      layer.parentLayerId = parentLayer.id
    } else {
      addIssue({
        severity: 'warning',
        issueCode: 'missing_parent_folder',
        message: `Parent folder ${parentReference} tidak ditemukan.`,
        sourceFolderPath: layer.sourceFolderPath,
        canActivate: true,
      })
    }
  })

  asArray(parserOutput.placemarks ?? parserOutput.features).forEach((placemark, index) => {
    const folderReference = readString(
      placemark?.folderId,
      placemark?.layerId,
      placemark?.sourceFolderPath,
    )
    placemarkRecords.push({
      placemark,
      layer: folderReference ? layerByReference.get(folderReference) ?? null : null,
      sourceFolderPath: readString(placemark?.sourceFolderPath) ?? '/',
      sourceIndex: index,
    })
  })

  let fallbackLayer = null
  function getFallbackLayer() {
    if (fallbackLayer) return fallbackLayer
    fallbackLayer = {
      id: `layer:${datasetVersion.id}:unassigned`,
      datasetVersionId: datasetVersion.id,
      sourceFolderPath: '/',
      name: 'Tanpa folder',
      category: 'uncategorized',
      displayOrder: layers.length,
      defaultVisible: true,
    }
    layers.push(fallbackLayer)
    usedLayerIds.add(fallbackLayer.id)
    return fallbackLayer
  }

  const assetAliases = new Map()
  const assetIds = new Set()
  const placemarkMetadataByAssetId = new Map()
  const sourceIdentityCounts = new Map()
  const sourceIdentityOccurrences = new Map()

  if (sourceIdentityFallback === 'folder-path-name') {
    placemarkRecords.forEach(({ placemark, sourceFolderPath }) => {
      const sourceIdentityBase = createSourceIdentityBase({
        sourceFolderPath,
        placemarkName: readString(placemark?.name),
      })
      if (!sourceIdentityBase) return
      sourceIdentityCounts.set(
        sourceIdentityBase,
        (sourceIdentityCounts.get(sourceIdentityBase) ?? 0) + 1,
      )
    })
  }

  placemarkRecords.forEach(({ placemark, layer: sourceLayer, sourceFolderPath, sourceIndex }) => {
    if (!isPlainRecord(placemark)) {
      addIssue({
        severity: 'warning',
        issueCode: 'invalid_placemark_record',
        message: 'Placemark dilewati karena bentuk output parser tidak dikenal.',
        sourceFolderPath,
        canActivate: true,
      })
      return
    }

    const normalizedExtendedData = normalizeExtendedData(placemark.extendedData)
    const sourceProperties = isPlainRecord(placemark.properties)
      ? cloneValue(placemark.properties)
      : {}
    const metadata = { ...sourceProperties, ...normalizedExtendedData }
    const semanticMetadata = mapSemanticMetadata(metadata, metadataAliases)
    const placemarkName = readString(semanticMetadata.values.assetName, placemark.name, metadata.name)
      ?? `Placemark ${sourceIndex + 1}`
    const explicitAssetId = readString(
      placemark.assetId,
      semanticMetadata.values.assetId,
      readMetadataValue(metadata, assetIdKeys),
    )
    const sourceIdentity = explicitAssetId
      ? null
      : createSourceIdentity({
        mode: sourceIdentityFallback,
        sourceFolderPath,
        placemarkName: readString(placemark.name),
        counts: sourceIdentityCounts,
        occurrences: sourceIdentityOccurrences,
      })
    const assetId = explicitAssetId ?? sourceIdentity?.assetId

    if (!assetId) {
      addIssue({
        severity: 'error',
        issueCode: 'missing_asset_id',
        message: 'Placemark tidak memiliki Asset ID yang dapat digunakan sebagai identifier stabil.',
        sourceFolderPath,
        sourcePlacemarkName: placemarkName,
        canActivate: false,
      })
      return
    }
    if (sourceIdentity) {
      addIssue({
        severity: sourceIdentity.total > 1 ? 'warning' : 'information',
        issueCode: sourceIdentity.total > 1
          ? 'source_identity_occurrence_applied'
          : 'source_identity_fallback_applied',
        message: sourceIdentity.total > 1
          ? `Asset ID ${assetId} berasal dari folder, nama Placemark, dan urutan duplikat sumber.`
          : `Asset ID ${assetId} berasal dari folder dan nama Placemark sumber.`,
        sourceFolderPath,
        sourcePlacemarkName: placemarkName,
        assetId,
        canActivate: true,
      })
    }
    if (assetIds.has(assetId)) {
      addIssue({
        severity: 'error',
        issueCode: 'duplicate_asset_id',
        message: `Asset ID ${assetId} digunakan oleh lebih dari satu placemark.`,
        sourceFolderPath,
        sourcePlacemarkName: placemarkName,
        assetId,
        canActivate: false,
      })
      return
    }

    const layer = sourceLayer ?? getFallbackLayer()
    const sourcePlacemarkId = readString(placemark.sourcePlacemarkId, placemark.id)
    const nodeId = readString(placemark.assetNodeId)
      ?? `asset-node:${datasetVersion.id}:${slugify(assetId)}`
    const location = placemark.location ?? semanticMetadata.values.location ?? metadata.location
    const properties = {
      ...sourceProperties,
      extendedData: cloneValue(normalizedExtendedData),
      sourceExtendedData: cloneValue(placemark.extendedData ?? null),
      semanticMetadata: cloneValue({
        ...semanticMetadata.values,
        ...(sourceIdentity ? { assetId } : {}),
      }),
      metadataMapping: cloneValue(semanticMetadata.mappings),
      ...(sourceIdentity ? {
        sourceIdentityMapping: {
          strategy: 'folder-path-name',
          sourceFolderPath,
          sourcePlacemarkName: placemarkName,
          occurrence: sourceIdentity.occurrence,
          totalOccurrences: sourceIdentity.total,
        },
      } : {}),
    }
    if (
      semanticMetadata.values.branchId
      && semanticMetadata.values.branchId !== datasetVersion.branchId
    ) {
      addIssue({
        severity: 'error',
        issueCode: 'branch_metadata_mismatch',
        message: `Metadata branch_id ${semanticMetadata.values.branchId} tidak sesuai dengan branch dataset ${datasetVersion.branchId}.`,
        sourceFolderPath,
        sourcePlacemarkName: placemarkName,
        assetId,
        canActivate: false,
      })
    }
    const asset = {
      id: nodeId,
      datasetVersionId: datasetVersion.id,
      layerId: layer.id,
      assetId,
      name: placemarkName,
      category: readString(
        semanticMetadata.values.category,
        placemark.category,
        metadata.category,
        layer.category,
      )
        ?? 'uncategorized',
      type: readString(
        semanticMetadata.values.assetType,
        placemark.type,
        metadata.type,
        metadata.assetType,
        layer.name,
      )
        ?? 'unknown',
      branchId: datasetVersion.branchId,
      ...(location !== undefined && location !== null && location !== ''
        ? { location: cloneValue(location) }
        : {}),
      properties,
      ...(sourcePlacemarkId ? { sourcePlacemarkId } : {}),
    }

    assetIds.add(assetId)
    assets.push(asset)
    placemarkMetadataByAssetId.set(assetId, {
      raw: metadata,
      semantic: semanticMetadata.values,
      mappings: semanticMetadata.mappings,
    })
    assetAliases.set(assetId, assetId)
    assetAliases.set(nodeId, assetId)
    if (sourcePlacemarkId) assetAliases.set(sourcePlacemarkId, assetId)

    const rawGeometry = placemark.geometry ?? placemark.sourceGeometry
    if (!rawGeometry) {
      addIssue({
        severity: 'warning',
        issueCode: 'missing_geometry',
        message: `Asset ${assetId} tidak memiliki geometry.`,
        sourceFolderPath,
        sourcePlacemarkName: placemarkName,
        assetId,
        canActivate: true,
      })
      return
    }

    const geometry = normalizeGeometry(rawGeometry, {
      id: readString(placemark.geometryId) ?? `geometry:${nodeId}:1`,
      assetNodeId: nodeId,
    })
    if (!geometry || !isAssetGeometry(geometry)) {
      asset.properties.invalidSourceGeometry = cloneValue(rawGeometry)
      addIssue({
        severity: 'error',
        issueCode: geometry ? 'invalid_geometry_coordinates' : 'unsupported_geometry',
        message: geometry
          ? `Koordinat geometry untuk asset ${assetId} tidak valid.`
          : `Jenis geometry untuk asset ${assetId} belum didukung.`,
        sourceFolderPath,
        sourcePlacemarkName: placemarkName,
        assetId,
        geometryReference: readString(rawGeometry.id, rawGeometry.type),
        canActivate: false,
      })
      return
    }
    geometries.push(geometry)
  })

  adaptParserIssues(parserOutput, addIssue)
  adaptUnsupportedElements(parserOutput, addIssue)

  const relationCandidates = [
    ...asArray(parserOutput.relations ?? parserOutput.metadata?.relations),
    ...buildMappedRelationCandidates({
      relationMappings: asArray(mapping.relationMappings),
      metadataByAssetId: placemarkMetadataByAssetId,
      metadataAliases,
      addIssue,
    }),
  ]
  const usedRelationIds = new Set()

  relationCandidates.forEach((rawRelation, index) => {
    if (!isPlainRecord(rawRelation)) {
      addIssue({
        severity: 'warning',
        issueCode: 'invalid_relation_record',
        message: `Relation pada index ${index} dilewati karena bentuknya tidak dikenal.`,
        canActivate: true,
      })
      return
    }

    const rawSourceId = readString(
      rawRelation.sourceAssetId,
      rawRelation.source,
      rawRelation.from,
    )
    const rawTargetId = readString(
      rawRelation.targetAssetId,
      rawRelation.target,
      rawRelation.to,
    )
    const sourceAssetId = assetAliases.get(rawSourceId) ?? rawSourceId
    const targetAssetId = assetAliases.get(rawTargetId) ?? rawTargetId
    const rawPathAssetId = readString(rawRelation.pathAssetId)
    const pathAssetId = assetAliases.get(rawPathAssetId) ?? rawPathAssetId
    const unresolvedSeverity = rawRelation.unresolvedSeverity === 'warning'
      ? 'warning'
      : 'error'
    const relationType = readString(rawRelation.relationType, rawRelation.type)

    if (!sourceAssetId || !targetAssetId || !relationType) {
      addIssue({
        severity: 'error',
        issueCode: 'incomplete_relation_reference',
        message: 'Relation tidak memiliki sourceAssetId, targetAssetId, dan relationType yang lengkap.',
        canActivate: false,
      })
      return
    }
    if (!assetIds.has(sourceAssetId) || !assetIds.has(targetAssetId)) {
      addIssue({
        severity: unresolvedSeverity,
        issueCode: 'unknown_relation_reference',
        message: `Relation ${sourceAssetId} → ${targetAssetId} merujuk Asset ID yang tidak tersedia pada dataset version ini.`,
        assetId: !assetIds.has(sourceAssetId) ? sourceAssetId : targetAssetId,
        canActivate: unresolvedSeverity !== 'error',
      })
      return
    }
    if (pathAssetId && !assetIds.has(pathAssetId)) {
      addIssue({
        severity: unresolvedSeverity,
        issueCode: 'unknown_relation_path_asset',
        message: `Relation ${sourceAssetId} → ${targetAssetId} merujuk pathAssetId yang tidak tersedia.`,
        assetId: pathAssetId,
        canActivate: unresolvedSeverity !== 'error',
      })
      return
    }

    const preferredId = readString(rawRelation.id)
      ?? `relation:${datasetVersion.id}:${slugify(sourceAssetId)}:${slugify(targetAssetId)}:${index}`
    if (usedRelationIds.has(preferredId)) {
      addIssue({
        severity: 'warning',
        issueCode: 'duplicate_relation_id',
        message: `Relation ID ${preferredId} duplikat dan dilewati.`,
        canActivate: true,
      })
      return
    }

    usedRelationIds.add(preferredId)
    relations.push({
      id: preferredId,
      datasetVersionId: datasetVersion.id,
      sourceAssetId,
      targetAssetId,
      relationType,
      ...(pathAssetId ? { pathAssetId } : {}),
      ...(readString(rawRelation.sourceMetadataKey)
        ? { sourceMetadataKey: rawRelation.sourceMetadataKey.trim() }
        : {}),
      ...(isPlainRecord(rawRelation.metadata)
        ? { metadata: cloneValue(rawRelation.metadata) }
        : {}),
      relationSource: 'explicit',
      relationStatus: 'confirmed',
    })
  })

  const topologyGraph = buildTopologyGraph({
    assets,
    geometries,
    relations,
    layers,
    config: isPlainRecord(mapping.topology) ? mapping.topology : {},
  })
  topologyGraph.edges
    .filter(({ relationSource }) => relationSource !== 'explicit')
    .forEach((edge) => {
      if (usedRelationIds.has(edge.id)) return
      usedRelationIds.add(edge.id)
      relations.push({
        id: edge.id,
        datasetVersionId: datasetVersion.id,
        sourceAssetId: edge.sourceNodeId,
        targetAssetId: edge.targetNodeId,
        relationType: edge.relationType,
        ...(edge.pathAssetId ? { pathAssetId: edge.pathAssetId } : {}),
        relationSource: edge.relationSource,
        relationStatus: edge.relationStatus,
        ...(edge.sourceGeometryId
          ? { sourceGeometryId: edge.sourceGeometryId }
          : {}),
        ...(Number.isFinite(edge.distanceMeters)
          ? { distanceMeters: edge.distanceMeters }
          : {}),
        metadata: {
          topology: {
            sourceGeometryIds: cloneValue(edge.sourceGeometryIds ?? []),
            pathLengthMeters: edge.pathLengthMeters,
          },
        },
      })
    })
  topologyGraph.ambiguousConnections.forEach((diagnostic) => {
    addIssue({
      severity: 'warning',
      issueCode: 'topology_connection_ambiguous',
      message: diagnostic.kind === 'point_on_line'
        ? `Point ${diagnostic.nodeId} memiliki beberapa kandidat jalur dalam toleransi topologi.`
        : `Endpoint ${diagnostic.endpoint} pada geometry ${diagnostic.sourceGeometryId} memiliki beberapa kandidat node yang hampir sama.`,
      assetId: diagnostic.nodeId,
      geometryReference: diagnostic.sourceGeometryId ?? diagnostic.lineId,
      canActivate: true,
    })
  })
  topologyGraph.unresolvedEndpoints.forEach((diagnostic) => {
    addIssue({
      severity: 'information',
      issueCode: 'topology_endpoint_unresolved',
      message: `Endpoint ${diagnostic.endpoint} pada geometry ${diagnostic.sourceGeometryId} tidak mempunyai node kompatibel dalam toleransi ${diagnostic.toleranceMeters} meter.`,
      geometryReference: diagnostic.sourceGeometryId,
      canActivate: true,
    })
  })

  const geometryCounts = countGeometryTypes(geometries)
  const comparison = isPlainRecord(parserOutput.comparison) ? parserOutput.comparison : {}
  const summary = {
    totalFolders: sourceFolderCount,
    totalPlacemarks: placemarkRecords.length,
    totalAssets: assets.length,
    totalPoints: geometryCounts.point,
    totalLines: geometryCounts.line_string,
    totalPolygons: geometryCounts.polygon,
    totalRelations: relations.length,
    newAssets: nonNegativeCount(comparison.newAssets),
    updatedAssets: nonNegativeCount(comparison.updatedAssets),
    unchangedAssets: nonNegativeCount(comparison.unchangedAssets),
    removedAssets: nonNegativeCount(comparison.removedAssets),
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
  const hasBlockingIssues = issues.some((issue) => issue.canActivate === false)
  datasetVersion.summary = summary
  datasetVersion.validationStatus = hasBlockingIssues ? 'invalid' : 'valid'
  if (!['active', 'archived'].includes(datasetVersion.status)) {
    datasetVersion.status = hasBlockingIssues ? 'invalid' : 'valid'
  }

  const result = {
    contractVersion: KML_IMPORT_CONTRACT_VERSION,
    datasetVersion,
    layers,
    assets,
    geometries,
    relations,
    issues,
    topologyGraph,
    sourceStyles: {
      styles: cloneValue(asArray(parserOutput.styles)),
      styleMaps: cloneValue(asArray(parserOutput.styleMaps)),
    },
  }
  const validation = validateKmlImportResult(result)
  if (!validation.valid) {
    throw new TypeError(`Hasil adapter import tidak valid: ${validation.errors.join(' ')}`)
  }
  return result
}

function normalizeDatasetVersion(value) {
  if (!isPlainRecord(value)) throw new TypeError('DatasetVersion wajib diberikan kepada adapter.')

  const requiredStrings = [
    'id',
    'datasetId',
    'branchId',
    'versionName',
    'sourceFilename',
    'sourceMimeType',
    'checksum',
    'importedBy',
    'importedAt',
  ]
  for (const field of requiredStrings) {
    if (!readString(value[field])) throw new TypeError(`DatasetVersion.${field} wajib tersedia.`)
  }
  if (!Number.isInteger(value.sourceSize) || value.sourceSize < 0) {
    throw new TypeError('DatasetVersion.sourceSize harus berupa integer non-negatif.')
  }

  return {
    id: value.id.trim(),
    datasetId: value.datasetId.trim(),
    branchId: value.branchId.trim(),
    versionName: value.versionName.trim(),
    ...(readString(value.versionNote) ? { versionNote: value.versionNote.trim() } : {}),
    ...(typeof value.officialSourceConfirmed === 'boolean'
      ? { officialSourceConfirmed: value.officialSourceConfirmed }
      : {}),
    sourceFilename: value.sourceFilename.trim(),
    sourceMimeType: value.sourceMimeType.trim(),
    sourceSize: value.sourceSize,
    checksum: value.checksum.trim(),
    ...(readString(value.sourceStorageKey)
      ? { sourceStorageKey: value.sourceStorageKey.trim() }
      : {}),
    importedBy: value.importedBy.trim(),
    importedAt: value.importedAt.trim(),
    ...(readString(value.activatedBy) ? { activatedBy: value.activatedBy.trim() } : {}),
    ...(readString(value.activatedAt) ? { activatedAt: value.activatedAt.trim() } : {}),
    validationStatus: ['pending', 'valid', 'invalid'].includes(value.validationStatus)
      ? value.validationStatus
      : 'pending',
    publicationStatus: ['unpublished', 'published', 'archived'].includes(value.publicationStatus)
      ? value.publicationStatus
      : 'unpublished',
    status: ['processing', 'draft', 'valid', 'invalid', 'active', 'archived'].includes(value.status)
      ? value.status
      : 'draft',
    summary: emptySummary(),
  }
}

function normalizeExtendedData(value) {
  const normalized = {}

  function visit(item) {
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (!isPlainRecord(item)) return

    const key = readString(item.name, item.key)
    if (key) {
      const itemValue = item.value ?? item.text ?? item['#text'] ?? ''
      normalized[key] = cloneValue(itemValue)
      return
    }

    for (const [entryKey, entryValue] of Object.entries(item)) {
      if (['data', 'simpleData', 'schemaData', 'values'].includes(entryKey) && (
        Array.isArray(entryValue) || isPlainRecord(entryValue)
      )) {
        visit(entryValue)
      } else if (!isPlainRecord(entryValue) && !Array.isArray(entryValue)) {
        normalized[entryKey] = cloneValue(entryValue)
      } else if (isPlainRecord(entryValue) && 'value' in entryValue) {
        normalized[entryKey] = cloneValue(entryValue.value)
      }
    }
  }

  visit(value)
  return normalized
}

function normalizeGeometry(rawGeometry, { id, assetNodeId }) {
  if (!isPlainRecord(rawGeometry)) return null
  const geometryType = normalizeGeometryType(rawGeometry.type ?? rawGeometry.geometryType)
  if (!geometryType) return null

  let coordinates
  if (geometryType === 'multi_geometry') {
    const children = asArray(rawGeometry.geometries ?? rawGeometry.coordinates)
      .map((child) => {
        if (!isPlainRecord(child)) return null
        const childType = normalizeGeometryType(child.type ?? child.geometryType)
        if (!childType || childType === 'multi_geometry') return null
        return {
          geometryType: childType,
          coordinates: cloneValue(child.coordinates),
        }
      })
      .filter(Boolean)
    coordinates = children
  } else {
    coordinates = cloneValue(rawGeometry.coordinates)
  }

  const bounds = calculateBounds(geometryType, coordinates)
  return {
    id,
    assetNodeId,
    geometryType,
    coordinates,
    ...(readString(rawGeometry.altitudeMode)
      ? { altitudeMode: rawGeometry.altitudeMode.trim() }
      : {}),
    sourceGeometry: cloneValue(rawGeometry),
    ...(bounds ? { bounds } : {}),
  }
}

function normalizeGeometryType(value) {
  const compact = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (compact === 'point') return 'point'
  if (compact === 'linestring') return 'line_string'
  if (compact === 'polygon') return 'polygon'
  if (compact === 'multigeometry' || compact === 'geometrycollection') return 'multi_geometry'
  return null
}

function calculateBounds(geometryType, coordinates) {
  const positions = []

  function collect(type, value) {
    if (type === 'point' && Array.isArray(value)) {
      positions.push(value)
    } else if (type === 'line_string' && Array.isArray(value)) {
      value.forEach((position) => positions.push(position))
    } else if (type === 'polygon' && Array.isArray(value)) {
      value.forEach((ring) => asArray(ring).forEach((position) => positions.push(position)))
    } else if (type === 'multi_geometry' && Array.isArray(value)) {
      value.forEach((geometry) => collect(geometry.geometryType, geometry.coordinates))
    }
  }

  collect(geometryType, coordinates)
  const validPositions = positions.filter(
    (position) => Array.isArray(position)
      && Number.isFinite(position[0])
      && Number.isFinite(position[1]),
  )
  if (!validPositions.length) return undefined
  return [
    Math.min(...validPositions.map((position) => position[0])),
    Math.min(...validPositions.map((position) => position[1])),
    Math.max(...validPositions.map((position) => position[0])),
    Math.max(...validPositions.map((position) => position[1])),
  ]
}

function buildMappedRelationCandidates({
  relationMappings,
  metadataByAssetId,
  metadataAliases,
  addIssue,
}) {
  const relations = []

  for (const rule of relationMappings) {
    if (!isPlainRecord(rule)) continue
    const mode = rule.mode === 'explicit-pair' ? 'explicit-pair' : 'owner-target'
    const unresolvedSeverity = rule.unresolvedSeverity === 'warning' ? 'warning' : 'error'

    for (const [ownerAssetId, metadataRecord] of metadataByAssetId) {
      const rawMetadata = metadataRecord.raw
      const semantic = metadataRecord.semantic
      if (mode === 'explicit-pair') {
        const sourceField = readString(rule.sourceField) ?? 'sourceAssetId'
        const targetField = readString(rule.targetField) ?? 'targetAssetId'
        const relationTypeField = readString(rule.relationTypeField) ?? 'relationType'
        const sourceAssetId = semantic[sourceField]
          ?? readMetadataValue(rawMetadata, metadataAliases[sourceField] ?? [sourceField])
        const targetAssetId = semantic[targetField]
          ?? readMetadataValue(rawMetadata, metadataAliases[targetField] ?? [targetField])
        const relationType = readString(semantic[relationTypeField], rule.relationType)
          ?? readMetadataValue(rawMetadata, metadataAliases[relationTypeField] ?? [relationTypeField])
        if (!sourceAssetId && !targetAssetId) continue
        if (!sourceAssetId || !targetAssetId) {
          addIssue({
            severity: 'error',
            issueCode: 'incomplete_relation_metadata',
            message: `Metadata relation pada asset ${ownerAssetId} tidak memiliki source dan target yang lengkap.`,
            assetId: ownerAssetId,
            canActivate: false,
          })
          continue
        }
        relations.push({
          id: `relation:mapped:${slugify(sourceAssetId)}:${slugify(targetAssetId)}:explicit`,
          sourceAssetId,
          targetAssetId,
          relationType: relationType || 'connected-to',
          sourceMetadataKey: `${sourceField},${targetField},${relationTypeField}`,
          unresolvedSeverity,
          metadata: {
            mappingRule: cloneValue(rule),
            sourceMetadata: cloneValue(rawMetadata),
          },
        })
        continue
      }

      const targetField = readString(rule.targetField)
      const targetKey = readString(rule.targetKey)
      const targetAliases = targetField
        ? metadataAliases[targetField] ?? [targetField]
        : [targetKey].filter(Boolean)
      const targetMatch = targetField && semantic[targetField]
        ? findMetadataMatch(rawMetadata, targetAliases)
        : findMetadataMatch(rawMetadata, targetAliases)
      const rawTargets = semantic[targetField] ?? targetMatch?.value
      const relationType = readString(rule.relationType)
      if (!rawTargets || !relationType) continue
      const separator = typeof rule.separator === 'string' && rule.separator
        ? rule.separator
        : ','
      const targets = rawTargets.split(separator).map((value) => value.trim()).filter(Boolean)
      const pathAssetId = readString(rule.pathAssetKey)
        ? readMetadataValue(rawMetadata, [rule.pathAssetKey])
        : undefined

      targets.forEach((targetAssetId, index) => {
        relations.push({
          id: `relation:mapped:${slugify(ownerAssetId)}:${slugify(targetAssetId)}:${index}`,
          sourceAssetId: ownerAssetId,
          targetAssetId,
          relationType,
          ...(pathAssetId ? { pathAssetId } : {}),
          sourceMetadataKey: targetMatch?.sourceKey ?? targetField ?? targetKey,
          unresolvedSeverity,
          metadata: {
            mappingRule: cloneValue(rule),
            originalTargetValue: targetMatch?.originalValue ?? rawTargets,
          },
        })
      })
    }
  }

  return relations
}

function adaptParserIssues(parserOutput, addIssue) {
  asArray(parserOutput.issues).forEach((issue) => {
    if (!isPlainRecord(issue)) return
    const severity = ['error', 'warning', 'information'].includes(issue.severity)
      ? issue.severity
      : 'warning'
    addIssue({
      severity,
      issueCode: readString(issue.issueCode, issue.code) ?? 'parser_issue',
      message: readString(issue.message) ?? 'Parser melaporkan issue tanpa pesan.',
      sourceFolderPath: issue.sourceFolderPath,
      sourcePlacemarkName: issue.sourcePlacemarkName,
      assetId: issue.assetId,
      geometryReference: issue.geometryReference,
      canActivate: typeof issue.canActivate === 'boolean'
        ? issue.canActivate
        : severity !== 'error',
    })
  })
}

function adaptUnsupportedElements(parserOutput, addIssue) {
  asArray(parserOutput.unsupportedElements).forEach((element) => {
    const record = isPlainRecord(element) ? element : { name: String(element) }
    const name = readString(record.name, record.elementName) ?? 'unknown'
    addIssue({
      severity: 'warning',
      issueCode: 'unsupported_kml_element',
      message: `Elemen KML ${name} belum didukung dan tidak dinormalisasi.`,
      sourceFolderPath: record.sourceFolderPath,
      sourcePlacemarkName: record.sourcePlacemarkName,
      geometryReference: record.geometryReference,
      canActivate: record.canActivate !== false,
    })
  })
}

function countGeometryTypes(geometries) {
  const counts = {
    point: 0,
    line_string: 0,
    polygon: 0,
  }

  function count(type, coordinates) {
    if (type in counts) counts[type] += 1
    if (type === 'multi_geometry') {
      asArray(coordinates).forEach((geometry) => count(geometry.geometryType, geometry.coordinates))
    }
  }

  geometries.forEach((geometry) => count(geometry.geometryType, geometry.coordinates))
  return counts
}

function nonNegativeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
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
