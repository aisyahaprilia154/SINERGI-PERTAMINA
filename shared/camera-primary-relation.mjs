const CAMERA = /\bcctv\b|\bcamera\b|\bcam(?:era)?(?:[-_\s]?\d+)?\b/i
const JUNCTION = /(^|\s)(junction|junction box|jb)(\s|[-_]|$)/i
const GEOMETRY = new Set(['spatial_inference', 'automatic_device_relation', 'device_nearest_junction'])

export function isCamera(node) {
  if (!node || isJunction(node)) return false
  return CAMERA.test([node.assetType, node.category, node.sourceName, node.name,
    node.sourceFolderPath].filter(Boolean).join(' '))
}

export function isJunction(node) {
  if (!node) return false
  return node.topologyRole === 'junction' || String(node.diagramClass ?? '').startsWith('junction')
    || JUNCTION.test([node.assetType, node.category, node.sourceName, node.name].filter(Boolean).join(' '))
}

export function edgeEnds(edge) {
  return [edge?.sourceAssetId ?? edge?.sourceNodeId, edge?.targetAssetId ?? edge?.targetNodeId]
}

export function primaryCameraEdges(edges = [], nodes = [], { mountingRelations = [] } = {}) {
  const byId = new Map(nodes.flatMap(node => {
    const id = node?.canonicalAssetId ?? node?.assetId ?? node?.id
    return id ? [[id, node]] : []
  }))
  const mounts = new Map(mountingRelations.filter(relation =>
    !['rejected', 'revoked'].includes(String(relation.verificationStatus ?? '').toLowerCase()))
    .map(relation => [relation.sourceAssetId, relation.targetAssetId]))
  const junctionAdjacency = new Map()
  edges.forEach(edge => {
    const [a, b] = edgeEnds(edge)
    if (!isJunction(byId.get(a)) || !isJunction(byId.get(b))) return
    junctionAdjacency.set(a, [...(junctionAdjacency.get(a) ?? []), b])
    junctionAdjacency.set(b, [...(junctionAdjacency.get(b) ?? []), a])
  })
  const groups = new Map()
  edges.forEach(edge => {
    if (edge?.relationKind && edge.relationKind !== 'device_edge') return
    const [a, b] = edgeEnds(edge)
    const cameraId = isCamera(byId.get(a)) && isJunction(byId.get(b)) ? a
      : isCamera(byId.get(b)) && isJunction(byId.get(a)) ? b : null
    if (!cameraId) return
    groups.set(cameraId, [...(groups.get(cameraId) ?? []), edge])
  })
  const suppressed = new Set()
  const suppressedEdges = []
  groups.forEach((group, cameraId) => {
    if (group.length < 2) return
    const targets = [...new Set(group.map(edge => other(edge, cameraId)))]
    const ranked = group.map(edge => ({ edge, score: score(edge, cameraId, byId, mounts,
      junctionAdjacency, targets) })).sort((a, b) => compareScore(b.score, a.score)
      || String(id(a.edge)).localeCompare(String(id(b.edge))))
    const winner = ranked[0]
    const unresolved = targets.length > 1 && compareScore(winner.score, ranked.find(item =>
      other(item.edge, cameraId) !== other(winner.edge, cameraId))?.score) === 0
    ranked.forEach(({ edge }) => {
      if (!unresolved && edge === winner.edge) return
      suppressed.add(edge)
      suppressedEdges.push({ cameraAssetId: cameraId, suppressedEdgeId: id(edge),
        strongerEdgeIds: unresolved ? [] : [id(winner.edge)].filter(Boolean),
        reason: unresolved ? 'camera_primary_requires_review'
          : other(edge, cameraId) === other(winner.edge, cameraId)
            ? 'duplicate_camera_termination_evidence'
          : geometry(winner.edge) && label(edge) ? 'label_geometry_conflict'
            : 'single_operational_camera_termination' })
    })
  })
  return { edges: edges.filter(edge => !suppressed.has(edge)), suppressedEdges }
}

function score(edge, cameraId, byId, mounts, adjacency, targets) {
  const target = other(edge, cameraId)
  const source = String(edge.relationSource ?? edge.provenance ?? edge.source ?? '').toLowerCase()
  const manual = ['manual_admin', 'manual_locked'].includes(source) ? 1 : 0
  const child = targets.some(otherId => otherId !== target
    && isChildOf(target, otherId, byId, adjacency)) ? 1 : 0
  const sameMount = mounts.get(cameraId) && mounts.get(cameraId) === mounts.get(target) ? 1 : 0
  const evidence = geometry(edge) ? 3 : source.includes('explicit') ? 2 : label(edge) ? 1 : 0
  const manualTime = manual ? Date.parse(edge.manualConfirmation?.reviewedAt
    ?? edge.review?.reviewedAt ?? edge.verifiedAt ?? '') : NaN
  const manualOrder = manual && Number.isInteger(edge.manualOrder) ? edge.manualOrder : 0
  const distance = Number(edge.distanceMeters)
  const confidence = Number(edge.confidence ?? edge.score)
  return [child, manual, Number.isFinite(manualTime) ? manualTime : 0, manualOrder,
    sameMount, evidence,
    Number.isFinite(distance) ? -distance : -Infinity,
    Number.isFinite(confidence) ? confidence : 0]
}

function isChildOf(childId, parentId, byId, adjacency) {
  if (!(adjacency.get(childId) ?? []).includes(parentId)) return false
  const child = String(byId.get(childId)?.name ?? byId.get(childId)?.sourceName ?? '')
  const parent = String(byId.get(parentId)?.name ?? byId.get(parentId)?.sourceName ?? '')
  const normalize = value => value.toUpperCase().replace(/[^A-Z0-9.]/g, '')
  return normalize(child).startsWith(`${normalize(parent)}.`)
}

function compareScore(a, b) {
  if (!b) return 1
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}
function other(edge, cameraId) { const [a, b] = edgeEnds(edge); return a === cameraId ? b : a }
function geometry(edge) { return GEOMETRY.has(String(edge.relationSource ?? edge.provenance ?? edge.source ?? '').toLowerCase())
  || ['device_nearest_junction', 'nearest_junction', 'spatial_device_relation'].includes(edge.candidateType)
  || edge.decisionSource === 'geometry' }
function label(edge) { return edge.relationSource === 'line_label_inference'
  || ['line_label_connection', 'line_label_attachment'].includes(edge.candidateType) }
function id(edge) { return edge?.id ?? edge?.edgeId ?? edge?.relationId ?? edge?.candidateId ?? null }
