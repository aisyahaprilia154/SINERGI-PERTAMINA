/**
 * Compatibility projection for the existing map/inventory persistence contract.
 * Canonical parser and relation-engine records remain the source of truth.
 */
export function projectCanonicalImport({
  parserOutput,
  canonicalParser,
  datasetVersion: inputDatasetVersion,
  sourceIdentityFallback = 'folder-path-name',
} = {}) {
  const datasetVersion = structuredClone(inputDatasetVersion)
  const layers = []
  const assets = []
  const geometries = []
  const issues = []
  const featureQueues = createFeatureQueues(canonicalParser)
  const classificationByFeature = new Map(
    canonicalParser.classifiedObjects.map((object) => [object.sourceFeatureId, object]),
  )
  const identityByFeature = new Map(
    (canonicalParser.assetIdentityMap?.items ?? []).map((identity) => [
      identity.sourceFeatureId,
      identity,
    ]),
  )
  const geometriesByFeature = groupBy(canonicalParser.sourceGeometries, 'sourceFeatureId')
  const layerByPath = new Map()
  const placemarkRecords = []
  let issueSequence = 0

  const addIssue = (issue) => {
    issueSequence += 1
    issues.push({
      id: `issue:${datasetVersion.id}:projection:${issueSequence}`,
      datasetVersionId: datasetVersion.id,
      severity: issue.severity ?? 'warning',
      issueCode: issue.issueCode ?? 'projection_issue',
      message: issue.message ?? 'Projection issue tidak memiliki pesan.',
      canActivate: issue.canActivate ?? issue.severity !== 'error',
      ...compact({
        sourceFolderPath: issue.sourceFolderPath,
        sourcePlacemarkName: issue.sourcePlacemarkName,
        assetId: issue.assetId,
        geometryReference: issue.geometryReference,
      }),
    })
  }

  const visitFolder = (folder, parentLayer = null, inheritedCategory = null) => {
    const category = isMappedCategory(folder.category)
      ? folder.category
      : inheritedCategory ?? 'uncategorized'
    const layer = {
      id: uniqueLayerId(
        `layer:${datasetVersion.id}:${slugify(folder.sourceFolderPath)}`,
        new Set(layers.map(({ id }) => id)),
      ),
      datasetVersionId: datasetVersion.id,
      ...compact({ parentLayerId: parentLayer?.id }),
      sourceFolderPath: folder.sourceFolderPath,
      name: folder.name,
      category,
      displayOrder: layers.length,
      defaultVisible: parentLayer?.defaultVisible !== false && folder.visibility !== false,
      ...compact({ sourceStyleId: folder.sourceStyleId }),
    }
    layers.push(layer)
    layerByPath.set(folder.sourceFolderPath, layer)
    ;(folder.placemarks ?? []).forEach((placemark, index) => {
      placemarkRecords.push({ placemark, layer, index })
    })
    ;(folder.children ?? []).forEach((child) => visitFolder(child, layer, category))
  }
  ;(parserOutput.folders ?? []).forEach((folder) => visitFolder(folder))
  ;(parserOutput.placemarks ?? []).forEach((placemark, index) => {
    placemarkRecords.push({ placemark, layer: null, index })
  })

  let fallbackLayer = null
  const getFallbackLayer = () => {
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
    return fallbackLayer
  }

  const fallbackBases = placemarkRecords.map(({ placemark }) => (
    sourceIdentityBase(placemark.sourceFolderPath, placemark.name)
  ))
  const fallbackCounts = countValues(fallbackBases.filter(Boolean))
  const fallbackOccurrences = new Map()
  const usedAssetIds = new Set()
  const usedCanonicalAssetIds = new Set()

  placemarkRecords.forEach(({ placemark, layer: inputLayer, index }) => {
    const feature = shiftFeature(featureQueues, placemark)
    if (!feature) {
      addIssue({
        severity: 'error',
        issueCode: 'canonical_feature_projection_missing',
        message: `Placemark ${placemark.name} tidak ditemukan pada canonical source feature.`,
        sourceFolderPath: placemark.sourceFolderPath,
        sourcePlacemarkName: placemark.name,
        canActivate: false,
      })
      return
    }
    const classification = classificationByFeature.get(feature.sourceFeatureId)
    const identity = identityByFeature.get(feature.sourceFeatureId)
    const metadata = semanticMetadataForFeature(canonicalParser, feature.sourceFeatureId)
    const layer = inputLayer
      ?? layerByPath.get(feature.sourceFolderPath)
      ?? getFallbackLayer()
    let assetId = classification?.stableAssetId ?? classification?.assetId
    let sourceIdentity = null
    if (!assetId && sourceIdentityFallback === 'folder-path-name') {
      const base = sourceIdentityBase(feature.sourceFolderPath, feature.sourceName)
      if (base) {
        const occurrence = (fallbackOccurrences.get(base) ?? 0) + 1
        fallbackOccurrences.set(base, occurrence)
        assetId = identity?.legacyId
          ?? ((fallbackCounts.get(base) ?? 1) > 1 ? `${base}:${occurrence}` : base)
        sourceIdentity = {
          strategy: 'folder-path-name',
          sourceFolderPath: feature.sourceFolderPath,
          sourcePlacemarkName: feature.sourceName,
          occurrence,
          totalOccurrences: fallbackCounts.get(base) ?? 1,
          canonicalAssetId: identity?.canonicalAssetId ?? null,
          onboardingId: identity?.onboardingId ?? null,
          legacyId: identity?.legacyId ?? assetId,
        }
      }
    }
    if (!assetId) {
      addIssue({
        severity: 'error',
        issueCode: 'missing_asset_id',
        message: 'Placemark tidak memiliki Asset ID stabil.',
        sourceFolderPath: feature.sourceFolderPath,
        sourcePlacemarkName: feature.sourceName,
        canActivate: false,
      })
      return
    }
    if (usedAssetIds.has(assetId)) {
      addIssue({
        severity: 'error',
        issueCode: 'duplicate_asset_id',
        message: `Asset ID ${assetId} digunakan lebih dari sekali.`,
        sourceFolderPath: feature.sourceFolderPath,
        sourcePlacemarkName: feature.sourceName,
        assetId,
        canActivate: false,
      })
      return
    }
    usedAssetIds.add(assetId)
    const canonicalAssetId = identity?.canonicalAssetId ?? assetId
    if (usedCanonicalAssetIds.has(canonicalAssetId)) {
      addIssue({
        severity: 'error',
        issueCode: 'duplicate_canonical_asset_id',
        message: `canonicalAssetId ${canonicalAssetId} digunakan lebih dari sekali.`,
        sourceFolderPath: feature.sourceFolderPath,
        sourcePlacemarkName: feature.sourceName,
        assetId,
        canActivate: false,
      })
      return
    }
    usedCanonicalAssetIds.add(canonicalAssetId)
    const nodeId = `asset-node:${datasetVersion.id}:${slugify(assetId)}`
    const sourceProperties = structuredClone(feature.rawProperties ?? {})
    const asset = {
      id: nodeId,
      datasetVersionId: datasetVersion.id,
      layerId: layer.id,
      assetId,
      canonicalAssetId,
      stableAssetId: identity?.stableAssetId ?? classification?.stableAssetId ?? null,
      onboardingIdentity: identity?.onboardingId ?? classification?.onboardingIdentity ?? null,
      legacyAssetId: identity?.legacyId ?? assetId,
      identityStatus: identity?.identityStatus ?? (assetId ? 'stable' : 'unresolved'),
      identityAliases: structuredClone(identity?.aliases ?? {}),
      sourceFeatureId: feature.sourceFeatureId,
      name: metadata.assetName ?? feature.sourceName ?? `Placemark ${index + 1}`,
      category: metadata.category ?? layer.category ?? classification?.category ?? 'uncategorized',
      type: metadata.assetType
        ?? layer.name
        ?? classification?.assetType
        ?? 'unknown',
      branchId: datasetVersion.branchId,
      properties: {
        ...sourceProperties,
        extendedData: structuredClone(metadata.raw),
        sourceExtendedData: structuredClone(placemark.extendedData ?? null),
        semanticMetadata: {
          ...metadata.camel,
          ...(sourceIdentity ? { assetId } : {}),
          canonicalAssetId,
        },
        metadataMapping: structuredClone(metadata.mappings),
        ...compact({
          sourceIdentityMapping: sourceIdentity
            ? sourceIdentity
            : identity
              ? {
                strategy: identity.identityStatus,
                canonicalAssetId,
                onboardingId: identity.onboardingId,
                legacyId: identity.legacyId,
              }
              : null,
        }),
        sourceFeatureId: feature.sourceFeatureId,
        classification: classification ? structuredClone(classification) : null,
      },
      ...compact({ sourcePlacemarkId: feature.sourceKmlId }),
    }
    if (metadata.location) asset.location = metadata.location
    if (sourceIdentity) {
      addIssue({
        severity: sourceIdentity.totalOccurrences > 1 ? 'warning' : 'information',
        issueCode: sourceIdentity.totalOccurrences > 1
          ? 'source_identity_occurrence_applied'
          : 'source_identity_fallback_applied',
        message: `Asset ID ${assetId} berasal dari path dan nama Placemark sumber.`,
        sourceFolderPath: feature.sourceFolderPath,
        sourcePlacemarkName: feature.sourceName,
        assetId,
        canActivate: true,
      })
    }
    assets.push(asset)

    const sourceGeometries = geometriesByFeature.get(feature.sourceFeatureId) ?? []
    if (!sourceGeometries.length) {
      addIssue({
        severity: 'warning',
        issueCode: 'missing_geometry',
        message: `Asset ${assetId} tidak memiliki geometry.`,
        assetId,
        canActivate: true,
      })
      return
    }
    sourceGeometries.forEach((geometry, geometryIndex) => {
      if (!geometry.valid) {
        asset.properties.invalidSourceGeometry = structuredClone(geometry)
        addIssue({
          severity: 'error',
          issueCode: 'invalid_geometry_coordinates',
          message: `Geometry ${geometry.geometryId} tidak valid.`,
          assetId,
          geometryReference: geometry.geometryId,
          canActivate: false,
        })
        return
      }
      geometries.push({
        id: `geometry:${nodeId}:${geometryIndex + 1}`,
        datasetVersionId: datasetVersion.id,
        assetNodeId: nodeId,
        geometryType: legacyGeometryType(geometry.geometryType),
        coordinates: structuredClone(geometry.coordinates),
        ...compact({ altitudeMode: geometry.altitudeMode }),
        bounds: geometryBounds(geometry.coordinates),
        sourceGeometryId: geometry.geometryId,
        sourceFeatureId: feature.sourceFeatureId,
      })
    })
  })

  ;(parserOutput.issues ?? []).forEach((issue) => addIssue(issue))
  ;(parserOutput.unsupportedElements ?? []).forEach((element) => addIssue({
    severity: element.canActivate === false ? 'error' : 'warning',
    issueCode: 'unsupported_kml_element',
    message: `Elemen ${element.name} belum didukung.`,
    geometryReference: element.geometryReference,
    canActivate: element.canActivate,
  }))

  const geometryCounts = countValues(geometries.map(({ geometryType }) => geometryType))
  const hasBlocking = issues.some(({ canActivate }) => canActivate === false)
  datasetVersion.summary = {
    totalFolders: parserOutput.structure?.folderCount ?? layers.length,
    totalPlacemarks: parserOutput.structure?.placemarkCount ?? placemarkRecords.length,
    totalAssets: assets.length,
    totalPoints: geometryCounts.get('point') ?? 0,
    totalLines: geometryCounts.get('line_string') ?? 0,
    totalPolygons: geometryCounts.get('polygon') ?? 0,
    totalRelations: 0,
    newAssets: 0,
    updatedAssets: 0,
    unchangedAssets: 0,
    removedAssets: 0,
    errors: issues.filter(({ severity }) => severity === 'error').length,
    warnings: issues.filter(({ severity }) => severity === 'warning').length,
  }
  datasetVersion.validationStatus = hasBlocking ? 'invalid' : 'valid'
  datasetVersion.status = hasBlocking ? 'invalid' : 'valid'

  return {
    contractVersion: '1.0.0',
    datasetVersion,
    layers,
    assets,
    geometries,
    relations: [],
    issues,
    assetIdentityMap: structuredClone(canonicalParser.assetIdentityMap ?? null),
    sourceStyles: {
      styles: structuredClone(parserOutput.styles ?? []),
      styleMaps: structuredClone(parserOutput.styleMaps ?? []),
    },
  }
}

function createFeatureQueues(canonicalParser) {
  const queues = new Map()
  canonicalParser.sourceFeatures
    .filter(({ sourceElementType }) => sourceElementType === 'Placemark')
    .forEach((feature) => {
      for (const key of featureKeys(feature)) {
        if (!queues.has(key)) queues.set(key, [])
        queues.get(key).push(feature)
      }
    })
  return queues
}

function shiftFeature(queues, placemark) {
  for (const key of featureKeys({
    sourceKmlId: placemark.id,
    sourceFolderPath: placemark.sourceFolderPath,
    sourceName: placemark.name,
  })) {
    const queue = queues.get(key)
    if (queue?.length) {
      const feature = queue.shift()
      for (const relatedKey of featureKeys(feature)) {
        const related = queues.get(relatedKey)
        const index = related?.findIndex(({ sourceFeatureId }) => (
          sourceFeatureId === feature.sourceFeatureId
        ))
        if (index >= 0) related.splice(index, 1)
      }
      return feature
    }
  }
  return null
}

function featureKeys(feature) {
  return [
    feature.sourceKmlId ? `id:${feature.sourceKmlId}` : null,
    `path:${feature.sourceFolderPath}|name:${feature.sourceName}`,
  ].filter(Boolean)
}

function semanticMetadataForFeature(canonicalParser, sourceFeatureId) {
  const entries = canonicalParser.sourceMetadataEntries.filter((entry) => (
    entry.sourceFeatureId === sourceFeatureId
  ))
  const semantic = Object.fromEntries(entries
    .filter(({ semanticField }) => Boolean(semanticField))
    .map(({ semanticField, normalizedValue }) => [semanticField, normalizedValue]))
  const camel = Object.fromEntries(Object.entries(semantic).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, character) => character.toUpperCase()),
    value,
  ]))
  return {
    raw: Object.fromEntries(entries.map(({ sourceKey, sourceValue }) => [sourceKey, sourceValue])),
    mappings: entries.filter(({ semanticField }) => Boolean(semanticField)).map((entry) => ({
      targetField: entry.semanticField.replace(
        /_([a-z])/g,
        (_, character) => character.toUpperCase(),
      ),
      sourceKey: entry.sourceKey,
      originalValue: structuredClone(entry.sourceValue),
      normalizedValue: entry.normalizedValue,
    })),
    camel,
    assetName: semantic.asset_name,
    assetType: semantic.asset_type,
    category: semantic.category,
    location: semantic.location,
  }
}

function sourceIdentityBase(path, name) {
  if (!path || path === '/' || !name) return null
  return `src:${slugify(path)}:${slugify(name)}`
}

function legacyGeometryType(type) {
  return {
    Point: 'point',
    LineString: 'line_string',
    Polygon: 'polygon',
  }[type] ?? 'unknown'
}

function geometryBounds(coordinates) {
  const positions = flattenPositions(coordinates)
  if (!positions.length) return undefined
  return {
    west: Math.min(...positions.map(([longitude]) => longitude)),
    south: Math.min(...positions.map(([, latitude]) => latitude)),
    east: Math.max(...positions.map(([longitude]) => longitude)),
    north: Math.max(...positions.map(([, latitude]) => latitude)),
  }
}

function flattenPositions(value) {
  if (!Array.isArray(value)) return []
  if (value.length >= 2 && value.every((item) => Number.isFinite(Number(item)))) {
    return [value.map(Number)]
  }
  return value.flatMap(flattenPositions)
}

function isMappedCategory(value) {
  return !['', 'unmapped', 'unknown', 'uncategorized']
    .includes(String(value ?? '').toLowerCase())
}

function uniqueLayerId(base, used) {
  let id = base
  let index = 2
  while (used.has(id)) {
    id = `${base}:${index}`
    index += 1
  }
  return id
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item'
}

function groupBy(records, field) {
  return records.reduce((result, record) => {
    result.set(record[field], [...(result.get(record[field]) ?? []), record])
    return result
  }, new Map())
}

function countValues(values) {
  return values.reduce((result, value) => (
    result.set(value, (result.get(value) ?? 0) + 1)
  ), new Map())
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
