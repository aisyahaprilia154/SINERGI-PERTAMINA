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

/**
 * A camera has one operational termination. When a path/label-backed edge and
 * a proximity-only edge compete for that camera, the latter is not allowed to
 * become a second confirmed connection. The source record remains untouched;
 * callers can use this as a projection guard while older records are repaired.
 */
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
  const suppressions = []
  groups.forEach((group, cameraId) => {
    const authoritative = group.filter(isAuthoritativeEdge)
    if (!authoritative.length) return
    group.filter(isProximityOnlyEdge).forEach((weakEdge) => {
      const strongerEdges = authoritative.filter((strongEdge) => (
        strongEdge !== weakEdge
      ))
      if (!strongerEdges.length) return
      suppressed.add(weakEdge)
      suppressions.push({
        cameraAssetId: cameraId,
        suppressedEdgeId: edgeId(weakEdge),
        strongerEdgeIds: strongerEdges.map(edgeId).filter(Boolean),
        reason: 'stronger_path_or_label_evidence',
      })
    })
  })

  return {
    edges: asArray(edges).filter((edge) => !suppressed.has(edge)),
    suppressedEdges: suppressions,
  }
}

/**
 * Applies the same precedence before candidates are materialized. This keeps
 * future regeneration from confirming a nearest-JB candidate beside a known
 * line-label/path connection.
 */
export function demoteConflictingCameraCandidates(candidates = [], nodes = []) {
  const activeCandidates = asArray(candidates).filter((candidate) => (
    !['rejected', 'revoked'].includes(candidate?.candidateStatus)
  ))
  const projected = activeCandidates.map((candidate) => ({
    ...candidate,
    id: candidate.candidateId,
    edgeId: candidate.candidateId,
    sourceAssetId: candidate.sourceAssetId ?? candidate.sourcePathAssetId,
    relationSource: candidate.relationSource ?? candidate.provenance
      ?? candidateSource(candidate),
  }))
  const { suppressedEdges, edges } = filterConflictingCameraEdges(projected, nodes)
  const strongerBySuppressedId = new Map(suppressedEdges.map((suppression) => [
    suppression.suppressedEdgeId,
    suppression.strongerEdgeIds,
  ]))
  const activeIds = new Set(edges.map((edge) => edge.candidateId))
  return asArray(candidates).map((candidate) => {
    const strongerCandidateIds = strongerBySuppressedId.get(candidate.candidateId)
    if (!strongerCandidateIds || activeIds.has(candidate.candidateId)) return candidate
    return {
      ...candidate,
      candidateStatus: 'ambiguous',
      proposalStatus: 'superseded_by_stronger_evidence',
      conflictResolution: {
        code: 'stronger_camera_relation_evidence',
        strongerCandidateIds,
      },
    }
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

function candidateSource(candidate) {
  if (['line_label_connection', 'line_label_attachment'].includes(candidate?.candidateType)) {
    return 'line_label_inference'
  }
  if (candidate?.candidateType === 'explicit_metadata') return 'explicit_kml_metadata'
  if (candidate?.candidateType === 'device_nearest_junction') return 'spatial_inference'
  return ''
}

function pathAssetIds(edge) {
  return [edge?.pathAssetId, ...(edge?.pathAssetIds ?? [])].filter(Boolean)
}

function edgeId(edge) {
  return edge?.id ?? edge?.edgeId ?? edge?.relationId ?? edge?.candidateId ?? null
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}
