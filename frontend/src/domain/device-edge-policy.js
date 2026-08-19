const CAMERA_PATTERN = /\bcctv\b|\bcamera\b|\bcam(?:era)?(?:[-_\s]?\d+)?\b/i

const AUTHORITATIVE_SOURCES = new Set([
  'manual_admin',
  'explicit_kml_metadata',
  'line_label_inference',
  'explicit_metadata',
])

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
  groups.forEach((group) => {
    const authoritative = group.filter(isAuthoritativeEdge)
    if (!authoritative.length) return
    group.filter(isProximityOnlyEdge).forEach((weakEdge) => {
      if (authoritative.some((strongEdge) => strongEdge !== weakEdge)) {
        suppressed.add(weakEdge)
      }
    })
  })
  return asArray(edges).filter((edge) => !suppressed.has(edge))
}

function isDirectDeviceEdge(edge, nodeById) {
  if (!edge || edge.relationKind && edge.relationKind !== 'device_edge') return false
  const source = nodeById.get(edge.sourceAssetId ?? edge.sourceNodeId)
  const target = nodeById.get(edge.targetAssetId ?? edge.targetNodeId)
  return source?.objectRole === 'device_node' && target?.objectRole === 'device_node'
}

function isCameraNode(node) {
  if (!node) return false
  return CAMERA_PATTERN.test([
    node.assetType,
    node.category,
    node.sourceName,
    node.sourceFolderPath,
  ].filter(Boolean).join(' '))
}

function isAuthoritativeEdge(edge) {
  const source = relationSource(edge)
  if (AUTHORITATIVE_SOURCES.has(source)) return true
  return pathAssetIds(edge).length > 0 && !PROXIMITY_SOURCES.has(source)
}

function isProximityOnlyEdge(edge) {
  if (pathAssetIds(edge).length > 0) return false
  const source = relationSource(edge)
  return PROXIMITY_SOURCES.has(source)
    || PROXIMITY_CANDIDATE_TYPES.has(String(edge.candidateType ?? '').trim())
}

function relationSource(edge) {
  return String(
    edge?.relationSource
      ?? edge?.provenance
      ?? edge?.source
      ?? '',
  ).trim().toLowerCase()
}

function pathAssetIds(edge) {
  return [edge?.pathAssetId, ...(edge?.pathAssetIds ?? [])].filter(Boolean)
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}
