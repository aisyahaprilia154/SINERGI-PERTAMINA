import { edgeEnds, isCamera, isJunction } from '../../../shared/camera-primary-relation.mjs'

export function stageCameraRelationReplacement({ graph, changes, nodes, sourceAssetId, targetAssetId }) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const cameraId = isCamera(byId.get(sourceAssetId)) && isJunction(byId.get(targetAssetId))
    ? sourceAssetId
    : isCamera(byId.get(targetAssetId)) && isJunction(byId.get(sourceAssetId))
      ? targetAssetId : null
  if (!cameraId) return { graph, changes, replaced: [] }
  const replaced = graph.edges.filter(edge => {
    const [a, b] = edgeEnds(edge)
    return (a === cameraId && isJunction(byId.get(b)) && b !== otherTarget(cameraId, sourceAssetId, targetAssetId))
      || (b === cameraId && isJunction(byId.get(a)) && a !== otherTarget(cameraId, sourceAssetId, targetAssetId))
  })
  if (!replaced.length) return { graph, changes, replaced }
  const replacedIds = new Set(replaced.map(edge => edge.id ?? edge.relationId))
  const nextChanges = changes.filter(change =>
    !(change.type === 'add-relation' && replacedIds.has(change.draftEdgeId)))
  replaced.forEach(edge => {
    const edgeId = edge.id ?? edge.relationId
    if (!changes.some(change => change.type === 'add-relation' && change.draftEdgeId === edgeId)
      && !nextChanges.some(change => change.type === 'remove-edge' && change.edgeId === edgeId)) {
      nextChanges.push({ type: 'remove-edge', edgeId })
    }
  })
  return { graph: { ...graph, edges: graph.edges.filter(edge =>
    !replacedIds.has(edge.id ?? edge.relationId)) }, changes: nextChanges, replaced }
}

function otherTarget(cameraId, sourceAssetId, targetAssetId) {
  return cameraId === sourceAssetId ? targetAssetId : sourceAssetId
}
