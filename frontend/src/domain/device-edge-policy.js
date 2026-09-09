const CAMERA_PATTERN = /\bcctv\b|\bcamera\b|\bcam(?:era)?(?:[-_\s]?\d+)?\b/i

const MANUAL_SOURCES = new Set(['manual_admin', 'manual_locked'])

const PROXIMITY_SOURCES = new Set([
  'spatial_inference',
  'automatic_device_relation',
  'device_nearest_junction',
])

const PROXIMITY_CANDIDATE_TYPES = new Set([
  'device_nearest_junction',
  'nearest_junction',
  'spatial_device_relation',
])

export function filterConflictingCameraEdges(edges = [], nodes = []) {
  const nodeById = new Map(asArray(nodes).flatMap((node) => {
    const id = node?.canonicalAssetId ?? node?.assetId ?? node?.id
    return id ? [[id, node]] : []
  }))
  const groups = new Map()
  asArray(edges).forEach((edge) => {
    if (!isDirectDeviceEdge(edge, nodeById)) return
    const cameraIds = [edge.sourceAssetId, edge.targetAssetId]
      .filter((id) => isCameraNode(nodeById.get(id)))
    cameraIds.forEach((cameraId) => {
      const group = groups.get(cameraId) ?? []
      group.push(edge)
      groups.set(cameraId, group)
    })
  })

  const suppressed = new Set()
  groups.forEach((group, cameraId) => {
    if (group.length < 2) return
    const ordered = [...group].sort(compareOperationalEvidence)
    const winner = ordered[0]
    ordered.slice(1).forEach((loser) => {
      if (otherEndpoint(winner, cameraId) !== otherEndpoint(loser, cameraId)) {
        suppressed.add(loser)
      }
    })
  })
  return asArray(edges).filter((edge) => !suppressed.has(edge))
}

/**
 * Removes the explicitly documented DPPU YIA false-positive connection between
 * JB-CCTV-08-WP and its neighbouring JB-CCTV-09.1-WP extension. The source
 * graph currently contains this edge as spatial inference, while the facility
 * topology says the extension belongs to JB-CCTV-09-WP only. This is a scoped
 * projection correction: it does not create a replacement edge or change
 * mounting relations.
 */
export function filterDppuYiaPresentationEdges(edges = [], assets = []) {
  const assetById = new Map(asArray(assets).flatMap((asset) => {
    const id = asset?.canonicalAssetId ?? asset?.assetId ?? asset?.id
    return id ? [[id, asset]] : []
  }))
  const dppuIds = new Set([...assetById.entries()]
    .filter(([, asset]) => String(asset?.locationGroupKey ?? asset?.areaKey ?? '').toLowerCase() === 'dppu-yia')
    .map(([id]) => id))
  const nameById = new Map([...assetById.entries()].map(([id, asset]) => [
    id,
    normalizeDppuName(asset?.name ?? asset?.sourceName ?? id),
  ]))
  return asArray(edges).filter((edge) => {
    const sourceId = edge?.sourceAssetId ?? edge?.sourceNodeId ?? edge?.sourceId
    const targetId = edge?.targetAssetId ?? edge?.targetNodeId ?? edge?.targetId
    if (!dppuIds.has(sourceId) || !dppuIds.has(targetId)) return true
    const pair = new Set([nameById.get(sourceId), nameById.get(targetId)])
    return !(pair.has('JB-CCTV-08-WP') && pair.has('JB-CCTV-09.1-WP'))
  })
}

function isDirectDeviceEdge(edge, nodeById) {
  if (!edge || edge.relationKind && edge.relationKind !== 'device_edge') return false
  const source = nodeById.get(edge.sourceAssetId ?? edge.sourceNodeId)
  const target = nodeById.get(edge.targetAssetId ?? edge.targetNodeId)
  return source?.objectRole === 'device_node' && target?.objectRole === 'device_node'
}

function isCameraNode(node) {
  if (!node) return false
  const identity = [
    node.assetType,
    node.category,
    node.sourceName,
    node.sourceFolderPath,
  ].filter(Boolean).join(' ')
  if (node.topologyRole === 'junction'
    || String(node.diagramClass ?? '').startsWith('junction')
    || /(^|\s)(junction|junction box|jb)(\s|[-_]|$)/i.test(identity)) return false
  return CAMERA_PATTERN.test(identity)
}

function compareOperationalEvidence(left, right) {
  return evidencePriority(right) - evidencePriority(left)
    || normalizedDistance(left) - normalizedDistance(right)
    || normalizedScore(right) - normalizedScore(left)
    || String(edgeId(left)).localeCompare(String(edgeId(right)))
}

function evidencePriority(edge) {
  const source = relationSource(edge)
  if (MANUAL_SOURCES.has(source)) return 400
  if (isGeometryEdge(edge)) return 300
  if (['explicit_kml_metadata', 'explicit_metadata'].includes(source)) return 250
  if (source === 'line_label_inference'
    || ['line_label_connection', 'line_label_attachment'].includes(edge?.candidateType)) return 200
  return 100
}

function isGeometryEdge(edge) {
  return PROXIMITY_SOURCES.has(relationSource(edge))
    || PROXIMITY_CANDIDATE_TYPES.has(String(edge?.candidateType ?? '').trim())
    || edge?.decisionSource === 'geometry'
}

function normalizedDistance(edge) {
  const value = Number(edge?.distanceMeters)
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function normalizedScore(edge) {
  const value = Number(edge?.confidence ?? edge?.score)
  return Number.isFinite(value) ? value : 0
}

function otherEndpoint(edge, cameraId) {
  const source = edge?.sourceAssetId ?? edge?.sourceNodeId
  const target = edge?.targetAssetId ?? edge?.targetNodeId
  return source === cameraId ? target : source
}

function relationSource(edge) {
  return String(
    edge?.relationSource
      ?? edge?.provenance
      ?? edge?.source
      ?? '',
  ).trim().toLowerCase()
}

function edgeId(edge) {
  return edge?.id ?? edge?.edgeId ?? edge?.relationId ?? edge?.candidateId ?? ''
}

function normalizeDppuName(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}
