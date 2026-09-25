import { primaryCameraEdges } from '../../../shared/camera-primary-relation.mjs'

export function filterConflictingCameraEdges(edges = [], nodes = [], options = {}) {
  return primaryCameraEdges(edges, nodes, options)
}

// Candidate records remain intact; only their active status is demoted. The
// original evidence and conflict resolution are retained for audit/review.
export function demoteConflictingCameraCandidates(candidates = [], nodes = [], options = {}) {
  const active = candidates.filter(candidate =>
    !['rejected', 'revoked'].includes(candidate?.candidateStatus))
  const projected = active.map((candidate, manualOrder) => ({
    ...candidate,
    id: candidate.candidateId,
    manualOrder,
    sourceAssetId: candidate.sourceAssetId ?? candidate.sourcePathAssetId,
    relationSource: candidate.relationSource ?? candidate.provenance ?? candidateSource(candidate),
  }))
  const { suppressedEdges, edges } = filterConflictingCameraEdges(projected, nodes, options)
  const suppressionById = new Map(suppressedEdges.map(item => [item.suppressedEdgeId, item]))
  const activeIds = new Set(edges.map(edge => edge.candidateId))
  return candidates.map(candidate => {
    const suppression = suppressionById.get(candidate.candidateId)
    if (!suppression || activeIds.has(candidate.candidateId)) return candidate
    return {
      ...candidate,
      candidateStatus: 'ambiguous',
      proposalStatus: suppression.reason === 'camera_primary_requires_review'
        ? 'ambiguous' : 'superseded_by_stronger_evidence',
      conflictResolution: {
        code: suppression.reason,
        strongerCandidateIds: suppression.strongerEdgeIds,
      },
    }
  })
}

function candidateSource(candidate) {
  if (['line_label_connection', 'line_label_attachment'].includes(candidate?.candidateType)) {
    return 'line_label_inference'
  }
  if (candidate?.candidateType === 'explicit_metadata') return 'explicit_kml_metadata'
  if (candidate?.candidateType === 'device_nearest_junction') return 'spatial_inference'
  return ''
}
