// User-confirmed facility facts. Shared by regeneration and existing map projections.
import {additionalRelations, additionalExpectation, additionalConflict} from './additional-facility-facts.mjs'
export {correctAdditionalMounts} from './additional-facility-facts.mjs'
export const FACILITY_CORRECTION_VERSION = 'facilities/2026-09-23-tegal-c17-jb012-v2'
export function assetCode(asset) {
  return String(asset?.sourceName ?? asset?.name ?? '').trim().toUpperCase()
    .replace(/^(C|JB|T)-0+(\d)/, '$1-$2')
    .replace(/^(C-\d+)-EXP$/, '$1')
}
export function isTegalBaru(asset) {
  return [asset?.locationGroupKey, asset?.areaKey, asset?.locationGroupName,
    ...String(asset?.sourceFolderPath ?? '').replaceAll('\\', '/').split('/')]
    .some(value => String(value ?? '').trim().toLowerCase().replaceAll('-', ' ') === 'ft tegal baru')
}
const indoor = new Set(['C-8', 'C-9', 'C-10', 'C-11', 'C-12', 'C-13', 'C-15', 'C-27'])
const standalone = new Set(['JB-8', 'JB-8.3', 'JB-9.1', 'C-33', 'JB-10.1', 'C-34',
  'JB-13-EXP', 'C-37', 'C-38', 'C-39', 'C-40', 'JB-14', 'C-44', 'C-45', 'C-46'])
export function correctedMountingExpectation(asset) {
  if (!isTegalBaru(asset)) return additionalExpectation(asset)
  const code = assetCode(asset)
  return indoor.has(code) ? 'indoor' : standalone.has(code) ? 'standalone' : null
}
export function facilityRelations(assets = []) {
  const index = new Map()
  for (const asset of assets.filter(isTegalBaru)) {
    // Cable labels such as "Jalur Server - JB-01" are not server assets.
    if (['cable_path', 'visual_only', 'visual'].includes(asset.objectRole)) continue
    const code = /^(?:rack[\s-]*)?server(?:[\s-]*rack)?$/i.test(String(asset.sourceName ?? asset.name ?? '').trim())
      ? 'SERVER' : assetCode(asset)
    index.set(code, [...(index.get(code) ?? []), asset])
  }
  const resolve = code => index.get(code)?.length === 1 ? index.get(code)[0] : null
  const id = a => a.canonicalAssetId ?? a.assetId ?? a.id
  return [['SERVER', 'JB-1'], ['SERVER', 'JB-14'], ['C-8', 'JB-1'],
    ['C-17', 'JB-1.2'],
    ['C-13', 'JB-2'], ['JB-2', 'JB-4'], ['C-31', 'JB-9'], ['C-32', 'JB-10-EXP']]
    .flatMap(([s, t]) => {
      const source = resolve(s), target = resolve(t)
      if (!source || !target || !id(source) || !id(target)) return []
      return [{ sourceAssetId: id(source), targetAssetId: id(target),
        id: `${FACILITY_CORRECTION_VERSION}:${id(source)}:${id(target)}`,
        relationType: 'connected-to', relationKind: 'device_edge',
        direction: 'undirected', verificationStatus: 'confirmed',
        provenance: 'facility_topology_correction', traversable: true }]
    }).concat(additionalRelations(assets))
}
export function conflictsWithFacilityRelation(edge, assets) {
  return facilityConflictPredicate(assets)(edge)
}
export function facilityConflictPredicate(assets) {
  const relations = facilityRelations(assets)
  const byId = new Map(assets.map(a => [a.canonicalAssetId ?? a.assetId ?? a.id, a]))
  return edge => {
  // Keep the verified branch baseline, while allowing a later explicit admin
  // edit to replace only the exact relation the administrator touched.
  if ((edge.manualConfirmation && edge.manualConfirmation.actorId !== 'facility-correction-policy')
    || (edge.provenance === 'manual_admin' && edge.verifiedBy !== 'facility-correction-policy')) return false
  if (additionalConflict(edge, byId)) return true
  const source = edge.sourceAssetId ?? edge.sourceNodeId ?? edge.sourcePathAssetId
  const target = edge.targetAssetId ?? edge.targetNodeId
  return relations.some(r => {
    if (!/^(C|BC|DC|CAM)-/i.test(assetCode(byId.get(r.sourceAssetId)))) return false
    const other = source === r.sourceAssetId ? target : target === r.sourceAssetId ? source : null
    return other && other !== r.targetAssetId && /^JB-/.test(assetCode(byId.get(other)))
  })
  }
}
export function correctFacilityEdges(edges = [], assets = []) {
  const conflicts = facilityConflictPredicate(assets)
  const result = edges.filter(edge => !conflicts(edge))
  for (const relation of facilityRelations(assets)) {
    const exists = result.some(e => {
      const s = e.sourceAssetId ?? e.sourceNodeId, t = e.targetAssetId ?? e.targetNodeId
      return s === relation.sourceAssetId && t === relation.targetAssetId
        || t === relation.sourceAssetId && s === relation.targetAssetId
    })
    if (!exists) result.push({ ...relation, sourceNodeId: relation.sourceAssetId,
      targetNodeId: relation.targetAssetId })
  }
  return result
}
export function correctFacilityBundle(input) {
  const nodes = input?.classifiedNodes ?? []
  const relations = facilityRelations(nodes)
  const ids = new Set(relations.map(r => r.id))
  return { ...input, explicitRelations: [
    ...(input.explicitRelations ?? []).filter(r => !ids.has(r.explicitRelationEvidenceId)
      && !conflictsWithFacilityRelation({...r, sourceAssetId: r.sourceReference, targetAssetId: r.targetReference}, nodes)),
    ...relations.map(r => ({ ...r, explicitRelationEvidenceId: r.id,
      datasetVersionId: input.datasetVersion?.id, siteId: input.site,
      sourceReference: r.sourceAssetId, targetReference: r.targetAssetId,
      source: 'manual_admin', manualConfirmation: {
        actorId: 'facility-correction-policy', reviewedAt: '2026-09-14T00:00:00.000Z',
        reason: 'Relasi fasilitas dikonfirmasi pengguna; mengungguli inferensi otomatis.',
      }, evidence: [] })),
  ] }
}
