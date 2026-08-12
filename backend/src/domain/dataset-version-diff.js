import { createHash } from 'node:crypto'

export const DATASET_DIFF_SCHEMA_VERSION = '1.0.0'

const HIGH_RISK_TYPES = new Set([
  'asset_removed',
  'asset_identity_changed',
  'overlay_removed',
  'explicit_relation_removed',
  'site_changed',
])

const MEDIUM_RISK_TYPES = new Set([
  'asset_added',
  'asset_metadata_changed',
  'geometry_added',
  'geometry_removed',
  'geometry_changed',
  'classification_changed',
  'overlay_added',
  'overlay_changed',
  'explicit_relation_added',
  'explicit_relation_changed',
  'unmatched_onboarding_object',
])

/**
 * Compares canonical evidence, not presentation asset-node IDs. Stable Asset
 * ID is the primary match; onboarding objects remain explicitly unmatched so
 * an import can never manufacture an apparently certain add/remove diff.
 */
export function compareCanonicalDatasetVersions(candidate = {}, active = null) {
  const candidateVersionId = candidate.datasetVersion?.id ?? candidate.datasetVersionId ?? null
  const activeVersionId = active?.datasetVersion?.id ?? active?.datasetVersionId ?? null
  const candidateObjects = canonicalObjects(candidate)
  const activeObjects = canonicalObjects(active)
  const candidateByStable = indexByStableId(candidateObjects)
  const activeByStable = indexByStableId(activeObjects)
  const candidateBySource = indexBySourceFeature(candidateObjects)
  const activeBySource = indexBySourceFeature(activeObjects)
  const candidateBySourceIdentity = indexBySourceIdentity(candidateObjects)
  const activeBySourceIdentity = indexBySourceIdentity(activeObjects)
  const candidateGeometries = indexGeometries(candidate)
  const activeGeometries = indexGeometries(active)
  const items = []
  const identityChangedSources = new Set()

  const add = (changeType, {
    assetId = null,
    sourceFeatureId = null,
    before = null,
    after = null,
    changedFields = [],
    explanation,
    risk = riskFor(changeType),
  } = {}) => {
    items.push({
      changeId: `change:${fingerprint({
        changeType,
        assetId,
        sourceFeatureId,
        beforeRef: reference(before),
        afterRef: reference(after),
        changedFields,
      }).slice(0, 32)}`,
      changeType,
      risk,
      assetId,
      beforeRef: reference(before),
      afterRef: reference(after),
      changedFields: [...new Set(changedFields)].sort(),
      explanation: explanation ?? defaultExplanation(changeType, assetId),
      ...(sourceFeatureId ? { sourceFeatureId } : {}),
    })
  }

  const identityPairs = new Map()
  const registerIdentityPair = (sourceKey, before, after) => {
    if (!before || !before.stableAssetId || !after?.stableAssetId
      || before.stableAssetId === after.stableAssetId) return
    const pairKey = [
      before.sourceFeatureId ?? sourceKey,
      after.sourceFeatureId ?? sourceKey,
    ].join('|')
    if (identityPairs.has(pairKey)) return
    identityPairs.set(pairKey, {
      sourceFeatureId: after.sourceFeatureId ?? before.sourceFeatureId ?? null,
      before,
      after,
    })
  }
  for (const [sourceFeatureId, after] of candidateBySource) {
    registerIdentityPair(
      `source-feature:${sourceFeatureId}`,
      activeBySource.get(sourceFeatureId),
      after,
    )
  }
  for (const [sourceIdentity, after] of candidateBySourceIdentity) {
    registerIdentityPair(
      sourceIdentity,
      activeBySourceIdentity.get(sourceIdentity),
      after,
    )
  }
  for (const { sourceFeatureId, before, after } of identityPairs.values()) {
    if (before.sourceFeatureId) identityChangedSources.add(before.sourceFeatureId)
    if (after.sourceFeatureId) identityChangedSources.add(after.sourceFeatureId)
    add('asset_identity_changed', {
      assetId: after.stableAssetId,
      sourceFeatureId,
      before,
      after,
      changedFields: ['stableAssetId'],
      explanation: `Source evidence ${sourceFeatureId ?? '(unknown)'} berubah identity dari ${before.stableAssetId} menjadi ${after.stableAssetId}.`,
    })
  }

  for (const [stableId, after] of candidateByStable) {
    const before = activeByStable.get(stableId)
    if (!before) {
      if (identityChangedSources.has(after.sourceFeatureId)) continue
      add('asset_added', {
        assetId: stableId,
        sourceFeatureId: after.sourceFeatureId,
        after,
        explanation: `Stable Asset ID ${stableId} hanya tersedia pada candidate version.`,
      })
      continue
    }
    const beforeFeature = activeBySource.get(before.sourceFeatureId)
    const changedFields = changedAssetFields(before, after)
    if (before.siteId !== after.siteId) {
      add('site_changed', {
        assetId: stableId,
        sourceFeatureId: after.sourceFeatureId,
        before,
        after,
        changedFields: ['siteId'],
        explanation: `Site Asset ID ${stableId} berubah dari ${before.siteId ?? '(null)'} menjadi ${after.siteId ?? '(null)'}.`,
      })
    }
    if (changedFields.length) {
      const classificationFields = changedFields.filter((field) => (
        ['objectRole', 'networkFamily', 'category', 'assetType'].includes(field)
      ))
      const metadataFields = changedFields.filter((field) => !classificationFields.includes(field))
      if (classificationFields.length) {
        add('classification_changed', {
          assetId: stableId,
          sourceFeatureId: after.sourceFeatureId,
          before,
          after,
          changedFields: classificationFields,
        })
      }
      if (metadataFields.length) {
        add('asset_metadata_changed', {
          assetId: stableId,
          sourceFeatureId: after.sourceFeatureId,
          before,
          after,
          changedFields: metadataFields,
        })
      }
    }
    const beforeGeometry = activeGeometries.get(before.sourceFeatureId) ?? []
    const afterGeometry = candidateGeometries.get(after.sourceFeatureId) ?? []
    const geometryChange = compareGeometrySets(beforeGeometry, afterGeometry)
    if (geometryChange !== 'same') {
      add(`geometry_${geometryChange}`, {
        assetId: stableId,
        sourceFeatureId: after.sourceFeatureId,
        before,
        after,
        changedFields: ['geometry'],
      })
    }
    // A source KML ID is immutable evidence. If it keeps the same business
    // identity but moves to another feature, record the mapping change.
    if (before.sourceKmlId && after.sourceKmlId && before.sourceKmlId !== after.sourceKmlId) {
      add('asset_identity_changed', {
        assetId: stableId,
        sourceFeatureId: after.sourceFeatureId,
        before,
        after,
        changedFields: ['sourceKmlId'],
      })
    }
    void beforeFeature
  }

  for (const [stableId, before] of activeByStable) {
    if (candidateByStable.has(stableId)
      || identityChangedSources.has(before.sourceFeatureId)) continue
    add('asset_removed', {
      assetId: stableId,
      sourceFeatureId: before.sourceFeatureId,
      before,
      explanation: `Stable Asset ID ${stableId} tidak ditemukan pada candidate version.`,
    })
  }

  for (const object of candidateObjects.filter((item) => !item.stableAssetId)) {
    if (candidateBySource.has(object.sourceFeatureId) && activeBySource.has(object.sourceFeatureId)) continue
    add('unmatched_onboarding_object', {
      sourceFeatureId: object.sourceFeatureId,
      after: object,
      assetId: null,
      risk: 'medium',
      explanation: 'Object belum mempunyai stable Asset ID; tidak dipaksakan menjadi add/remove bisnis.',
    })
  }
  for (const object of activeObjects.filter((item) => !item.stableAssetId)) {
    if (candidateBySource.has(object.sourceFeatureId)) continue
    add('unmatched_onboarding_object', {
      sourceFeatureId: object.sourceFeatureId,
      before: object,
      assetId: null,
      risk: 'medium',
      explanation: 'Object onboarding pada active version belum dapat dipasangkan secara bisnis.',
    })
  }

  compareRelations(candidate, active, add)
  compareOverlays(candidate, active, add)

  const objectDecreaseRatio = activeObjects.length
    ? (activeObjects.length - candidateObjects.length) / activeObjects.length
    : 0
  if (objectDecreaseRatio > 0.1) {
    items.filter(({ changeType }) => changeType === 'unmatched_onboarding_object')
      .forEach((item) => { item.risk = 'high' })
  }

  items.sort((left, right) => (
    left.changeType.localeCompare(right.changeType)
      || String(left.assetId ?? left.sourceFeatureId ?? '').localeCompare(
        String(right.assetId ?? right.sourceFeatureId ?? ''),
      )
      || left.changeId.localeCompare(right.changeId)
  ))
  const summary = summarize(items)
  return {
    schemaVersion: DATASET_DIFF_SCHEMA_VERSION,
    baseDatasetVersionId: activeVersionId,
    candidateDatasetVersionId: candidateVersionId,
    comparisonRevision: `comparison:sha256:${fingerprint({
      candidateVersionId,
      activeVersionId,
      items,
    })}`,
    summary,
    items,
    nextCursor: null,
    pageInfo: {
      limit: items.length,
      returned: items.length,
    },
  }
}

export function paginateDatasetDiff(comparison, {
  risk,
  type,
  limit = 50,
  cursor = null,
} = {}) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const filtered = (comparison.items ?? []).filter((item) => (
    (!risk || item.risk === risk) && (!type || item.changeType === type)
  ))
  const offset = decodeCursor(cursor, comparison.comparisonRevision)
  const items = filtered.slice(offset, offset + normalizedLimit)
  const nextOffset = offset + items.length
  return {
    ...comparison,
    items,
    nextCursor: nextOffset < filtered.length
      ? encodeCursor(nextOffset, comparison.comparisonRevision)
      : null,
    pageInfo: {
      limit: normalizedLimit,
      returned: items.length,
      totalMatched: filtered.length,
    },
  }
}

function compareRelations(candidate, active, add) {
  const candidateRelations = relationRecords(candidate)
  const activeRelations = relationRecords(active)
  const candidateByKey = new Map(candidateRelations.map((relation) => [relationKey(relation), relation]))
  const activeByKey = new Map(activeRelations.map((relation) => [relationKey(relation), relation]))
  for (const [key, relation] of candidateByKey) {
    if (!activeByKey.has(key)) {
      const sameEndpoints = [...activeByKey.values()].find((item) => (
        endpointKey(item) === endpointKey(relation)
      ))
      add(sameEndpoints ? 'explicit_relation_changed' : 'explicit_relation_added', {
        assetId: relation.sourceAssetId ?? null,
        before: sameEndpoints ?? null,
        after: relation,
        changedFields: sameEndpoints ? ['relation'] : [],
      })
    }
  }
  for (const [key, relation] of activeByKey) {
    if (candidateByKey.has(key)) continue
    add('explicit_relation_removed', {
      assetId: relation.sourceAssetId ?? null,
      before: relation,
    })
  }
}

function compareOverlays(candidate, active, add) {
  const candidateOverlays = candidate?.sourceOverlays ?? []
  const activeOverlays = active?.sourceOverlays ?? []
  const candidateByKey = new Map(candidateOverlays.map((overlay) => [overlayKey(overlay), overlay]))
  const activeByKey = new Map(activeOverlays.map((overlay) => [overlayKey(overlay), overlay]))
  for (const [key, overlay] of candidateByKey) {
    const before = activeByKey.get(key)
    if (!before) {
      add('overlay_added', { after: overlay, sourceFeatureId: overlay.sourceFeatureId })
    } else if (fingerprint(before) !== fingerprint(overlay)) {
      add('overlay_changed', {
        before,
        after: overlay,
        sourceFeatureId: overlay.sourceFeatureId,
        changedFields: ['overlay'],
      })
    }
  }
  for (const [key, overlay] of activeByKey) {
    if (!candidateByKey.has(key)) {
      add('overlay_removed', { before: overlay, sourceFeatureId: overlay.sourceFeatureId })
    }
  }
}

function canonicalObjects(record) {
  if (!record) return []
  const sourceFeatures = new Map(
    (record.sourceFeatures ?? []).map((feature) => [feature.sourceFeatureId, feature]),
  )
  if (Array.isArray(record.classifiedObjects) && record.classifiedObjects.length) {
    return record.classifiedObjects
      .filter(({ objectRole }) => ['device_node', 'cable_path'].includes(objectRole))
      .map((object) => {
        const feature = sourceFeatures.get(object.sourceFeatureId)
        return {
          ...structuredClone(object),
          sourceKmlId: object.sourceKmlId ?? feature?.sourceKmlId ?? null,
          sourceFeatureKey: object.sourceFeatureKey ?? feature?.sourceFeatureKey ?? null,
          stableAssetId: object.stableAssetId
            ?? (['stable_explicit', 'stable_registry'].includes(object.identityResolutionStatus)
              ? object.assetId
              : null),
          assetName: object.assetName ?? object.name ?? null,
        }
      })
  }
  return (record.assets ?? []).map((asset) => ({
    sourceFeatureId: asset.sourceFeatureId ?? asset.properties?.sourceFeatureId ?? asset.id,
    sourceKmlId: asset.sourcePlacemarkId
      ?? sourceFeatures.get(asset.sourceFeatureId)?.sourceKmlId
      ?? null,
    sourceFeatureKey: sourceFeatures.get(asset.sourceFeatureId)?.sourceFeatureKey ?? null,
    stableAssetId: asset.stableAssetId
      ?? (asset.identityStatus === 'stable' && !asset.onboardingIdentity ? asset.assetId : null),
    assetId: asset.assetId,
    assetName: asset.name,
    objectRole: asset.objectRole ?? 'device_node',
    networkFamily: asset.networkFamily ?? null,
    category: asset.category,
    assetType: asset.assetType ?? asset.type,
    siteId: asset.siteId ?? asset.branchId,
    sourceStatus: asset.sourceStatus ?? asset.properties?.semanticMetadata?.sourceStatus,
  }))
}

function indexByStableId(objects) {
  return new Map(objects
    .filter(({ stableAssetId }) => stableAssetId)
    .map((object) => [object.stableAssetId, object]))
}

function indexBySourceFeature(objects) {
  return new Map(objects
    .filter(({ sourceFeatureId }) => sourceFeatureId)
    .map((object) => [object.sourceFeatureId, object]))
}

function indexBySourceIdentity(objects) {
  const result = new Map()
  objects.forEach((object) => {
    if (object.sourceKmlId) {
      result.set(`source-kml-id:${object.sourceKmlId}`, object)
    }
    if (object.sourceFeatureKey) {
      result.set(`source-feature-key:${object.sourceFeatureKey}`, object)
    }
  })
  return result
}

function indexGeometries(record) {
  const result = new Map()
  const sourceGeometries = record?.sourceGeometries ?? []
  if (sourceGeometries.length) {
    sourceGeometries.forEach((geometry) => {
      const list = result.get(geometry.sourceFeatureId) ?? []
      list.push(geometry)
      result.set(geometry.sourceFeatureId, list)
    })
    return result
  }
  const byNode = new Map((record?.geometries ?? []).map((geometry) => [geometry.assetNodeId, geometry]))
  ;(record?.assets ?? []).forEach((asset) => {
    const featureId = asset.sourceFeatureId ?? asset.properties?.sourceFeatureId
    const geometries = (record.geometries ?? []).filter((geometry) => geometry.assetNodeId === asset.id)
    if (featureId && geometries.length) result.set(featureId, geometries)
    void byNode
  })
  return result
}

function relationRecords(record) {
  if (!record) return []
  if (Array.isArray(record.explicitRelationEvidence) && record.explicitRelationEvidence.length) {
    return record.explicitRelationEvidence
      .filter(({ validationStatus }) => validationStatus !== 'rejected')
      .map((relation) => ({
        sourceAssetId: relation.sourceReference,
        targetAssetId: relation.targetReference,
        relationType: relation.relationType,
        direction: relation.direction,
        sourceFeatureId: relation.sourceFeatureId,
      }))
  }
  return record.relations ?? record.confirmedRelations ?? []
}

function relationKey(relation) {
  return fingerprint({
    source: relation.sourceAssetId ?? relation.sourceReference,
    target: relation.targetAssetId ?? relation.targetReference,
    relationType: relation.relationType,
    direction: relation.direction,
    pathAssetIds: relation.pathAssetIds ?? relation.pathAssetId ?? null,
  })
}

function endpointKey(relation) {
  return `${relation.sourceAssetId ?? relation.sourceReference}|${relation.targetAssetId ?? relation.targetReference}`
}

function overlayKey(overlay) {
  return overlay.sourceOverlayId ?? overlay.sourceFeatureId ?? overlay.sourceFingerprint ?? overlay.name
}

function changedAssetFields(before, after) {
  return [
    'assetName',
    'objectRole',
    'networkFamily',
    'category',
    'assetType',
    'sourceStatus',
    'siteId',
  ].filter((field) => before[field] !== after[field])
}

function compareGeometrySets(before, after) {
  if (!before.length && !after.length) return 'same'
  if (!before.length) return 'added'
  if (!after.length) return 'removed'
  return fingerprint(before.map(geometryFingerprint).sort())
    === fingerprint(after.map(geometryFingerprint).sort()) ? 'same' : 'changed'
}

function geometryFingerprint(geometry) {
  return {
    geometryType: geometry.geometryType,
    coordinates: geometry.coordinates,
    sourceCoordinateText: geometry.sourceCoordinateText,
    geometryFingerprint: geometry.geometryFingerprint,
  }
}

function reference(record) {
  if (!record) return null
  return {
    datasetVersionId: record.datasetVersionId ?? null,
    sourceFeatureId: record.sourceFeatureId ?? null,
    sourceGeometryId: record.geometryId ?? record.sourceGeometryId ?? null,
    sourceOverlayId: record.sourceOverlayId ?? null,
    relationId: record.relationId ?? record.id ?? null,
  }
}

function riskFor(changeType) {
  if (HIGH_RISK_TYPES.has(changeType)) return 'high'
  if (MEDIUM_RISK_TYPES.has(changeType)) return 'medium'
  return 'low'
}

function summarize(items) {
  const byRisk = { high: 0, medium: 0, low: 0 }
  const byType = {}
  items.forEach((item) => {
    byRisk[item.risk] = (byRisk[item.risk] ?? 0) + 1
    byType[item.changeType] = (byType[item.changeType] ?? 0) + 1
  })
  return {
    total: items.length,
    byRisk,
    byType,
    requiresBreakingChangeConfirmation: byRisk.high > 0,
    // Compatibility summary used by the original import preview.
    newAssets: byType.asset_added ?? 0,
    updatedAssets: (byType.asset_metadata_changed ?? 0)
      + (byType.classification_changed ?? 0)
      + (byType.geometry_changed ?? 0)
      + (byType.geometry_added ?? 0)
      + (byType.geometry_removed ?? 0)
      + (byType.site_changed ?? 0),
    unchangedAssets: 0,
    removedAssets: byType.asset_removed ?? 0,
  }
}

function defaultExplanation(changeType, assetId) {
  const target = assetId ? ` untuk ${assetId}` : ''
  return `${changeType}${target} terdeteksi dari perbandingan canonical evidence.`
}

function encodeCursor(offset, revision) {
  return Buffer.from(JSON.stringify({ offset, revision })).toString('base64url')
}

function decodeCursor(cursor, revision) {
  if (!cursor) return 0
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
    if (value.revision !== revision || !Number.isInteger(value.offset) || value.offset < 0) return 0
    return value.offset
  } catch {
    return 0
  }
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
