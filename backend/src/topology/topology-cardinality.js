/**
 * Defines the review cardinality for every topology candidate.
 *
 * A physical line endpoint has one decision slot: it can resolve to one
 * target. An inline device is different: the same device may anchor several
 * paths, so its decision slot is the device/path pair.
 */
export function topologyCandidateCardinality(candidate = {}) {
  const isInlineDevice = candidate.candidateType === 'inline_device'
    && candidate.targetAssetId
    && candidate.sourcePathAssetId
  return {
    key: isInlineDevice
      ? `inline-device:${JSON.stringify([
        String(candidate.targetAssetId),
        String(candidate.sourcePathAssetId),
      ])}`
      : `source-endpoint:${JSON.stringify(String(candidate.sourceEndpointId ?? ''))}`,
    scope: isInlineDevice ? 'device_path' : 'source_endpoint',
    sourceEndpointId: candidate.sourceEndpointId ?? null,
    targetAssetId: candidate.targetAssetId ?? null,
    sourcePathAssetId: candidate.sourcePathAssetId ?? null,
  }
}

export function topologyCandidateDecisionKey(candidate = {}) {
  return topologyCandidateCardinality(candidate).key
}

export function topologyCandidateDecisionKeyFromLabel(label = {}) {
  return topologyCandidateDecisionKey({
    candidateType: label.candidateType,
    sourceEndpointId: label.sourceEndpointId,
    sourcePathAssetId: label.sourcePathAssetId,
    targetAssetId: label.targetAssetId ?? label.expectedTargetAssetId,
    targetPathAssetId: label.targetPathAssetId ?? label.expectedTargetPathAssetId,
  })
}

export function findTopologyCandidateConflicts(candidates = []) {
  const candidatesByDecisionKey = new Map()
  candidates.forEach((candidate) => {
    const cardinality = topologyCandidateCardinality(candidate)
    const group = candidatesByDecisionKey.get(cardinality.key) ?? []
    group.push(candidate)
    candidatesByDecisionKey.set(cardinality.key, group)
  })
  return [...candidatesByDecisionKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([decisionKey, group]) => {
      const cardinality = topologyCandidateCardinality(group[0])
      return {
        reason: 'endpoint_conflict',
        decisionKey,
        conflictScope: cardinality.scope,
        sourceEndpointId: cardinality.sourceEndpointId,
        sourcePathAssetId: cardinality.sourcePathAssetId,
        targetAssetId: cardinality.targetAssetId,
        candidateIds: group.map(({ candidateId }) => candidateId).filter(Boolean),
      }
    })
}
