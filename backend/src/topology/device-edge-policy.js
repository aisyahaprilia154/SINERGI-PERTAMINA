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

/**
 * A camera has one operational termination. A locked manual relation is the
 * only evidence above geometry; line labels are a fallback when no strong
 * spatial candidate exists. Losing evidence remains available as a diagnostic.
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
    if (group.length < 2) return
    const ordered = [...group].sort(compareOperationalEvidence)
    const winner = ordered[0]
    ordered.slice(1).forEach((loser) => {
      if (sameOperationalTarget(winner, loser, cameraId)) return
      suppressed.add(loser)
      suppressions.push({
        cameraAssetId: cameraId,
        suppressedEdgeId: edgeId(loser),
        strongerEdgeIds: [edgeId(winner)].filter(Boolean),
        reason: isGeometryEdge(winner) && isLabelEdge(loser)
          ? 'label_geometry_conflict'
          : 'single_operational_camera_termination',
      })
    })
  })

  return {
    edges: asArray(edges).filter((edge) => !suppressed.has(edge)),
    suppressedEdges: suppressions,
  }
}

/**
 * Applies the same precedence before candidates are materialized.
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
        code: suppressedEdges.find(({ suppressedEdgeId }) => (
          suppressedEdgeId === candidate.candidateId
        ))?.reason ?? 'single_operational_camera_termination',
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
    || String(edgeId(left) ?? '').localeCompare(String(edgeId(right) ?? ''))
}

function evidencePriority(edge) {
  const source = relationSource(edge)
  if (MANUAL_SOURCES.has(source)) return 400
  if (isGeometryEdge(edge)) return 300
  if (['explicit_kml_metadata', 'explicit_metadata'].includes(source)) return 250
  if (isLabelEdge(edge)) return 200
  return 100
}

function isGeometryEdge(edge) {
  const source = relationSource(edge)
  return PROXIMITY_SOURCES.has(source)
    || PROXIMITY_CANDIDATE_TYPES.has(String(edge?.candidateType ?? '').trim())
    || edge?.decisionSource === 'geometry'
}

function isLabelEdge(edge) {
  return relationSource(edge) === 'line_label_inference'
    || ['line_label_connection', 'line_label_attachment']
      .includes(String(edge?.candidateType ?? '').trim())
}

function normalizedDistance(edge) {
  const value = Number(edge?.distanceMeters)
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function normalizedScore(edge) {
  const value = Number(edge?.confidence ?? edge?.score)
  return Number.isFinite(value) ? value : 0
}

function sameOperationalTarget(left, right, cameraId) {
  return otherEndpoint(left, cameraId) === otherEndpoint(right, cameraId)
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

function candidateSource(candidate) {
  if (['line_label_connection', 'line_label_attachment'].includes(candidate?.candidateType)) {
    return 'line_label_inference'
  }
  if (candidate?.candidateType === 'explicit_metadata') return 'explicit_kml_metadata'
  if (candidate?.candidateType === 'device_nearest_junction') return 'spatial_inference'
  return ''
}

function edgeId(edge) {
  return edge?.id ?? edge?.edgeId ?? edge?.relationId ?? edge?.candidateId ?? null
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}
