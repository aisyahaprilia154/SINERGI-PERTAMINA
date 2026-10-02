import { buildCoverage, buildTopologyInputBundle } from '../domain/parser-contract.js'
import { buildCanonicalAssetIdentityMap } from '../domain/canonical-asset-identity.js'
import { AppError } from '../errors.js'

const identity = object => object.canonicalAssetId ?? object.stableAssetId ?? object.assetId
const facility = feature => {
  const parts = String(feature?.sourceFolderPath ?? '').toLowerCase().replaceAll('\\', '/').split('/').filter(Boolean)
  const root = parts.indexOf('rjbt')
  return parts[root < 0 ? 0 : root + 1] ?? ''
}

// IDs and audit evidence stay intact. Storage IDs are scoped by dataset version;
// only ownership changes when a baseline is copied into a staged candidate.
export function copyToVersion(value, datasetVersionId) {
  if (Array.isArray(value)) return value.map(item => copyToVersion(item, datasetVersionId))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'datasetVersionId' ? datasetVersionId : copyToVersion(item, datasetVersionId)]))
}

export function mergeAdditionsOnlyImport({ canonicalParser, projection, baseline, parserOutput }) {
  const version = projection.datasetVersion
  const oldFeatures = new Map((baseline.sourceFeatures ?? []).map(feature => [feature.sourceFeatureId, feature]))
  const byId = new Map((baseline.classifiedObjects ?? []).map(object => [identity(object), object]).filter(([id]) => id))
  const bySource = new Map()
  for (const object of baseline.classifiedObjects ?? []) {
    for (const key of sourceKeys(oldFeatures.get(object.sourceFeatureId))) {
      const list = bySource.get(key) ?? []
      list.push(object)
      bySource.set(key, list)
    }
  }
  const features = new Map(canonicalParser.sourceFeatures.map(feature => [feature.sourceFeatureId, feature]))
  const added = new Set(), ignored = new Set(), conflicts = []
  for (const object of canonicalParser.classifiedObjects) {
    const feature = features.get(object.sourceFeatureId)
    const sourceMatches = [...new Set(sourceKeys(feature).flatMap(key => bySource.get(key) ?? []))]
    const stableMatch = byId.get(identity(object))
    const matches = [...new Set([...sourceMatches, ...(stableMatch ? [stableMatch] : [])])]
    if (matches.length > 1 || (stableMatch && facility(oldFeatures.get(stableMatch.sourceFeatureId)) !== facility(feature))
      || (sourceMatches.length === 1 && object.identityResolutionStatus === 'stable_explicit'
        && identity(object) !== identity(sourceMatches[0]))) {
      conflicts.push({ sourceFeatureId: object.sourceFeatureId, assetId: identity(object), reason: 'identity_scope_conflict' })
      ignored.add(object.sourceFeatureId)
    } else if (matches.length) {
      ignored.add(object.sourceFeatureId)
    } else {
      added.add(object.sourceFeatureId)
    }
  }
  const copy = value => copyToVersion(value ?? [], version.id)
  const merged = { ...canonicalParser }
  for (const key of ['sourceFeatures', 'sourceGeometries', 'sourceMetadataEntries', 'classifiedObjects']) {
    merged[key] = [...copy(baseline[key]), ...canonicalParser[key].filter(item => added.has(item.sourceFeatureId))]
  }
  merged.sourceOverlays = copy(baseline.sourceOverlays)
  merged.sourceResources = [...copy(baseline.sourceResources).map(item => ({
    ...item, originDatasetVersionId: item.originDatasetVersionId ?? baseline.datasetVersion.id,
  })), ...canonicalParser.sourceResources]
  merged.identityRegistry = canonicalParser.identityRegistry
  merged.assetIdentityMap = buildCanonicalAssetIdentityMap({
    datasetVersion: version, sourceFeatures: merged.sourceFeatures,
    classifiedObjects: merged.classifiedObjects, identityRegistry: merged.identityRegistry,
  })
  merged.explicitRelationEvidence = [
    ...copy(baseline.canonicalParser?.explicitRelationEvidence),
    ...canonicalParser.explicitRelationEvidence.filter(item => added.has(item.sourceFeatureId)),
  ]
  const oldBundle = baseline.topologyInputBundle ?? {}
  const bundle = buildTopologyInputBundle({
    datasetVersion: version, classifiedObjects: merged.classifiedObjects,
    sourceFeatures: merged.sourceFeatures, sourceGeometries: merged.sourceGeometries,
    explicitRelationEvidence: merged.explicitRelationEvidence,
    topologyExceptions: copy(oldBundle.topologyExceptions), topologyPolicy: oldBundle.topologyPolicy,
    interfaceRegistry: copy(Array.isArray(baseline.topologyInterfaceRegistry)
      ? baseline.topologyInterfaceRegistry : baseline.topologyInterfaceRegistry?.interfaces ?? oldBundle.interfaceRegistry),
    componentInventory: copy(oldBundle.componentInventory), jbProfiles: copy(oldBundle.jbProfiles),
    internalConnections: copy(oldBundle.internalConnections),
  })
  for (const key of ['classifiedNodes', 'classifiedPaths']) {
    bundle[key] = [...copy(oldBundle[key]), ...bundle[key].filter(item => added.has(item.sourceFeatureId))]
  }
  const oldGeometryIds = new Set((oldBundle.geometries ?? []).map(item => item.geometryId))
  bundle.geometries = [...copy(oldBundle.geometries), ...bundle.geometries.filter(item => !oldGeometryIds.has(item.geometryId))]
  bundle.additionsOnly = {
    protectedAssetIds: [...new Set((baseline.assets ?? []).map(identity).filter(Boolean))],
    confirmedRelations: copy(baseline.confirmedRelations), candidates: copy(baseline.topologyCandidates),
    components: copy(baseline.topologyComponentRegistry),
    mounting: Object.fromEntries(['relations', 'candidates', 'options', 'overrides', 'expectations', 'reviewItems']
      .map(key => [key, copy(baseline[`mounting${key[0].toUpperCase()}${key.slice(1)}`])])),
  }
  merged.topologyInputBundle = bundle
  const coverageParser = { ...parserOutput, structure: {
    ...parserOutput.structure,
    placemarkCount: merged.sourceFeatures.filter(item => item.sourceElementType === 'Placemark').length,
    overlayCount: merged.sourceOverlays.length,
  } }
  merged.coverage = buildCoverage({
    parserOutput: coverageParser, sourceFeatures: merged.sourceFeatures,
    sourceGeometries: merged.sourceGeometries, sourceOverlays: merged.sourceOverlays,
    resources: merged.sourceResources, classifiedObjects: merged.classifiedObjects, topologyInputBundle: bundle,
  })
  merged.issues = canonicalParser.issues.filter(item => !ignored.has(item.sourceFeatureId))
  const newAssets = projection.assets.filter(asset => added.has(asset.properties?.sourceFeatureId))
  const newNodes = new Set(newAssets.map(asset => asset.id))
  const conflictIssues = conflicts.map(conflict => ({
    ...conflict, datasetVersionId: version.id, severity: 'error', issueCode: 'identity_conflict',
    message: 'Identitas aset bertentangan dengan baseline terkoreksi; tambahan tidak diterapkan.', canActivate: false,
  }))
  merged.issues.push(...conflictIssues)
  const importAdditions = {
    baseDatasetVersionId: baseline.datasetVersion.id, baseRecordRevision: Number(baseline.recordRevision ?? 0),
    addedAssets: newAssets.length, preservedAssets: baseline.assets?.length ?? 0,
    ignoredExistingFeatures: ignored.size, identityConflicts: conflicts,
  }
  const result = {
    ...projection, datasetVersion: { ...version, contentMode: 'additions_only',
      baseDatasetVersionId: importAdditions.baseDatasetVersionId, baseRecordRevision: importAdditions.baseRecordRevision },
    importAdditions,
    assets: [...copy(baseline.assets), ...newAssets],
    geometries: [...copy(baseline.geometries), ...projection.geometries.filter(item => newNodes.has(item.assetNodeId))],
    layers: [...copy(baseline.layers), ...projection.layers.filter(layer => newAssets.some(asset => asset.layerId === layer.id))],
    issues: [...projection.issues.filter(item => !ignored.has(item.sourceFeatureId)), ...conflictIssues],
    sourceStyles: { styles: [...copy(baseline.sourceStyles?.styles), ...(projection.sourceStyles?.styles ?? [])],
      styleMaps: [...copy(baseline.sourceStyles?.styleMaps), ...(projection.sourceStyles?.styleMaps ?? [])] },
    assetIdentityMap: merged.assetIdentityMap,
  }
  result.datasetVersion.summary = { ...result.datasetVersion.summary,
    totalAssets: result.assets.length, totalPlacemarks: merged.coverage.placemarkCount,
    totalFolders: result.layers.length,
    totalPoints: result.geometries.filter(item => item.geometryType === 'point').length,
    totalLines: result.geometries.filter(item => item.geometryType === 'line_string').length,
    totalPolygons: result.geometries.filter(item => item.geometryType === 'polygon').length,
    newAssets: newAssets.length, unchangedAssets: importAdditions.preservedAssets,
    updatedAssets: 0, removedAssets: 0 }
  for (const key of ['topologyCandidateHistory', 'topologyRuns', 'topologyFrameNames', 'topologyFrameAssignments',
    'topologyFrames', 'topologyEdgeOverrides', 'topologyRootAssignments']) {
    if (baseline[key] !== undefined) result[key] = copy(baseline[key])
  }
  return { canonicalParser: merged, projection: result }
}

function sourceKeys(feature) {
  if (!feature) return []
  const scope = facility(feature)
  return [feature.sourceKmlId ? `kml:${scope}:${feature.sourceDocumentPath ?? ''}:${feature.sourceKmlId}` : null,
    feature.sourceIdentityKey ? `registry:${scope}:${feature.sourceIdentityKey}` : null].filter(Boolean)
}

export function assertAdditionsBaseline(target, active) {
  if (target.datasetVersion?.contentMode !== 'additions_only') return
  const baseline = target.importAdditions ?? target.datasetVersion
  if (baseline.baseDatasetVersionId !== (active?.datasetVersion?.id ?? null)
    || Number(baseline.baseRecordRevision ?? 0) !== Number(active?.recordRevision ?? 0)) {
    throw new AppError('Baseline terkoreksi berubah sejak import. Import ulang tambahan sebelum aktivasi.', {
      code: 'additions_baseline_changed', statusCode: 409,
    })
  }
}
