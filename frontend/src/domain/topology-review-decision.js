export function topologyReviewDecisionKey(candidate = {}) {
  if (candidate.reviewCardinality?.key) return candidate.reviewCardinality.key
  if (candidate.candidateType === 'mounting_attachment') {
    return `mounting:${JSON.stringify([
      String(candidate.sourcePathAssetId ?? candidate.childAssetId ?? ''),
      String(candidate.mountingRole ?? 'default'),
    ])}`
  }
  if (candidate.candidateType === 'jb_internal_connection') {
    return `internal:${JSON.stringify([
      String(candidate.sourceInterfaceId ?? ''),
      String(candidate.serviceDomain ?? 'unknown'),
    ])}`
  }
  if (candidate.candidateType === 'path_continuation') {
    return `path-continuation:${JSON.stringify([
      String(candidate.sourceEndpointId ?? ''),
      String(candidate.targetEndpointId ?? candidate.targetPathAssetId ?? ''),
    ].sort())}`
  }
  if (candidate.candidateType === 'inline_device'
    && candidate.targetAssetId
    && candidate.sourcePathAssetId) {
    return `inline-device:${JSON.stringify([
      String(candidate.targetAssetId),
      String(candidate.sourcePathAssetId),
    ])}`
  }
  return `source-endpoint:${JSON.stringify(String(candidate.sourceEndpointId ?? ''))}`
}

export function topologyReviewDecisionCandidates(items = [], selected = null) {
  if (!selected) return []
  const decisionKey = topologyReviewDecisionKey(selected)
  return items.filter((candidate) => (
    topologyReviewDecisionKey(candidate) === decisionKey
      && ['candidate', 'ambiguous', 'revoked'].includes(candidate.candidateStatus)
  ))
}

export function topologyCandidateSupportsBulkReview(candidate = {}) {
  return candidate.candidateStatus === 'candidate'
    && candidate.proposalStatus === 'recommended'
    && candidate.reviewEligibility?.confirmable !== false
}

export function topologyCandidateRequiresTargetSelection(candidate, decisionCandidates = []) {
  return candidate?.candidateStatus === 'ambiguous'
    && decisionCandidates.some(({ candidateId }) => candidateId !== candidate.candidateId)
}

export function isStaleTopologyReviewError(error) {
  return [
    'stale_topology_review',
    'stale_topology_bulk_review',
    'dataset_version_stale_revision',
  ].includes(error?.code)
}
