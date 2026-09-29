import { primaryCameraEdges } from '../../../shared/camera-primary-relation.mjs'

export function filterConflictingCameraEdges(edges = [], nodes = [], options = {}) {
  return primaryCameraEdges(edges, nodes, options).edges
}

export function resolveCameraEdges(edges = [], nodes = [], options = {}) {
  return primaryCameraEdges(edges, nodes, options)
}

/** Keep the documented DPPU YIA false-positive out of the presentation. */
export function filterDppuYiaPresentationEdges(edges = [], assets = []) {
  const assetById = new Map(assets.flatMap(asset => {
    const id = asset?.canonicalAssetId ?? asset?.assetId ?? asset?.id
    return id ? [[id, asset]] : []
  }))
  const dppuIds = new Set([...assetById.entries()]
    .filter(([, asset]) => String(asset?.locationGroupKey ?? asset?.areaKey ?? '').toLowerCase() === 'dppu-yia')
    .map(([id]) => id))
  const nameById = new Map([...assetById.entries()].map(([id, asset]) => [
    id, String(asset?.name ?? asset?.sourceName ?? id).trim().toUpperCase().replace(/\s+/g, ' '),
  ]))
  return edges.filter(edge => {
    const sourceId = edge?.sourceAssetId ?? edge?.sourceNodeId ?? edge?.sourceId
    const targetId = edge?.targetAssetId ?? edge?.targetNodeId ?? edge?.targetId
    if (!dppuIds.has(sourceId) || !dppuIds.has(targetId)) return true
    const pair = new Set([nameById.get(sourceId), nameById.get(targetId)])
    return !(pair.has('JB-CCTV-08-WP') && pair.has('JB-CCTV-09.1-WP'))
  })
}
