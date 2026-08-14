import { topologyCandidateDecisionKeyFromLabel, topologyCandidateDecisionKey } from './topology-cardinality.js'

/**
 * Evaluates a versioned calibration/held-out gold set without mutating candidates.
 * Labels are intentionally external to source KML and review decisions.
 */
export const ACCURACY_ARTIFACT_SCHEMA_VERSION = '1.0.0'
export const MINIMUM_HELD_OUT_SAMPLE_SIZE = 200

/**
 * Validates the immutable approval boundary consumed by spatial auto-confirm.
 * Raw metrics are deliberately not sufficient; the artifact must be approved,
 * current, scoped, and bound to the active rule set and build.
 */
export function evaluateAccuracyGate({
  artifact,
  requiredRuleSetVersion,
  requiredEngineBuildSha,
  requiredHeldOutPrecision = 0.99,
  requiredPathAccuracy = 0.95,
  requiredHeldOutSampleSize = MINIMUM_HELD_OUT_SAMPLE_SIZE,
  scope = {},
  now = new Date(),
} = {}) {
  const blockingReasons = []
  const candidate = artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? artifact
    : null
  const metrics = {
    heldOutPrecision: unitMetric(candidate?.heldOutPrecision),
    heldOutRecall: unitMetric(candidate?.heldOutRecall),
    pathAccuracy: unitMetric(candidate?.pathAccuracy),
    componentAccuracy: unitMetric(candidate?.componentAccuracy),
    falseComponentMergeCount: integerMetric(candidate?.falseComponentMergeCount),
    sampleSize: integerMetric(candidate?.sampleSize),
  }

  if (!candidate) {
    blockingReasons.push('accuracy_artifact_missing')
  } else {
    if (candidate.schemaVersion !== ACCURACY_ARTIFACT_SCHEMA_VERSION) {
      blockingReasons.push('accuracy_artifact_schema_mismatch')
    }
    if (candidate.status !== 'approved') {
      blockingReasons.push('accuracy_artifact_not_approved')
    }
    for (const [field, reason] of [
      ['evaluationId', 'accuracy_evaluation_id_missing'],
      ['goldSetVersion', 'accuracy_gold_set_version_missing'],
      ['goldSetChecksum', 'accuracy_gold_set_checksum_missing'],
      ['ruleSetVersion', 'accuracy_rule_set_version_missing'],
      ['engineBuildSha', 'accuracy_engine_build_sha_missing'],
      ['approvedBy', 'accuracy_approved_by_missing'],
      ['approvedAt', 'accuracy_approved_at_missing'],
      ['evaluatedAt', 'accuracy_evaluated_at_missing'],
      ['expiresAt', 'accuracy_expires_at_missing'],
    ]) {
      if (!nonEmpty(candidate[field])) blockingReasons.push(reason)
    }
    if (!requiredRuleSetVersion || candidate.ruleSetVersion !== requiredRuleSetVersion) {
      blockingReasons.push('accuracy_rule_set_mismatch')
    }
    if (!requiredEngineBuildSha) {
      blockingReasons.push('accuracy_engine_build_context_missing')
    } else if (candidate.engineBuildSha !== requiredEngineBuildSha) {
      blockingReasons.push('accuracy_engine_build_mismatch')
    }

    if (!candidate.siteId || !scope.siteId || candidate.siteId !== scope.siteId) {
      blockingReasons.push('accuracy_site_scope_mismatch')
    }
    const networkFamilies = [...new Set(
      (scope.networkFamilies ?? []).filter((value) => nonEmpty(value)),
    )]
    if (!candidate.networkFamily
      || networkFamilies.length !== 1
      || candidate.networkFamily !== networkFamilies[0]) {
      blockingReasons.push('accuracy_network_family_scope_mismatch')
    }

    const currentTime = dateValue(now)
    const evaluatedAt = dateValue(candidate.evaluatedAt)
    const approvedAt = dateValue(candidate.approvedAt)
    const expiresAt = dateValue(candidate.expiresAt)
    if (currentTime === null || evaluatedAt === null || approvedAt === null || expiresAt === null) {
      blockingReasons.push('accuracy_artifact_timestamp_invalid')
    } else {
      if (evaluatedAt > currentTime || approvedAt > currentTime) {
        blockingReasons.push('accuracy_artifact_timestamp_in_future')
      }
      if (expiresAt <= currentTime) blockingReasons.push('accuracy_artifact_expired')
    }

    if (metrics.sampleSize === null) {
      blockingReasons.push('accuracy_sample_size_missing')
    } else if (metrics.sampleSize < requiredHeldOutSampleSize) {
      blockingReasons.push('accuracy_sample_size_below_minimum')
    }
    if (metrics.heldOutPrecision === null
      || metrics.heldOutPrecision < requiredHeldOutPrecision) {
      blockingReasons.push('held_out_precision_below_threshold')
    }
    if (metrics.pathAccuracy === null || metrics.pathAccuracy < requiredPathAccuracy) {
      blockingReasons.push('path_accuracy_below_threshold')
    }
    if (metrics.falseComponentMergeCount === null) {
      blockingReasons.push('accuracy_false_merge_count_missing')
    } else if (metrics.falseComponentMergeCount !== 0) {
      blockingReasons.push('false_component_merge_detected')
    }
  }

  return {
    approved: blockingReasons.length === 0,
    blockingReasons: [...new Set(blockingReasons)],
    evaluationId: candidate?.evaluationId ?? null,
    status: candidate?.status ?? null,
    metrics,
  }
}

export function evaluateTopologyAccuracy({
  candidates = [],
  graph = { nodes: [], edges: [], components: [] },
  goldSet,
} = {}) {
  validateGoldSet(goldSet)
  const selectedByDecisionKey = new Map()
  candidates
    .filter((candidate) => (
      candidate.proposalStatus === 'recommended'
      || candidate.candidateStatus === 'confirmed'
    ))
    .sort((left, right) => right.score - left.score || (
      left.candidateId.localeCompare(right.candidateId)
    ))
    .forEach((candidate) => {
      const decisionKey = topologyCandidateDecisionKey(candidate)
      if (!selectedByDecisionKey.has(decisionKey)) {
        selectedByDecisionKey.set(decisionKey, candidate)
      }
    })

  const evaluateSplit = (split) => {
    const labels = goldSet.endpointConnections.filter((label) => label.split === split)
    const positives = labels.filter(({ expectedTargetAssetId }) => Boolean(expectedTargetAssetId))
    const predictions = labels.flatMap((label) => {
      const candidate = selectedByDecisionKey.get(topologyCandidateDecisionKeyFromLabel(label))
      return candidate ? [{ label, candidate }] : []
    })
    const correct = predictions.filter(({ label, candidate }) => {
      if (label.expectedTargetAssetId != null) {
        return candidate.targetAssetId === label.expectedTargetAssetId
      }
      if (label.expectedTargetEndpointId != null) {
        return candidate.targetEndpointId === label.expectedTargetEndpointId
      }
      return candidate.targetAssetId == null && candidate.targetEndpointId == null
    })
    return {
      sampleSize: labels.length,
      positiveCount: positives.length,
      predictedCount: predictions.length,
      correctCount: correct.length,
      precision: ratio(correct.length, predictions.length),
      recall: ratio(correct.length, positives.length),
      autoCoverage: ratio(predictions.length, labels.length),
      distanceStrata: strata(labels, selectedByDecisionKey),
    }
  }

  const pathResults = goldSet.paths.map((path) => {
    const connected = path.assetIds.slice(1).every((assetId, index) => (
      graphHasPath(graph, path.assetIds[index], assetId)
    ))
    return {
      pathId: path.pathId,
      split: path.split,
      connected,
    }
  })
  const componentResults = goldSet.componentAssertions.map((assertion) => {
    const sameComponent = graph.components.some(({ nodeIds }) => (
      nodeIds.includes(assertion.leftAssetId)
      && nodeIds.includes(assertion.rightAssetId)
    ))
    return {
      ...assertion,
      actualSameComponent: sameComponent,
      correct: sameComponent === assertion.expectedSameComponent,
    }
  })
  const heldOutPaths = pathResults.filter(({ split }) => split === 'held_out')
  const heldOutComponents = componentResults.filter(({ split }) => split === 'held_out')
  const falseComponentMergeCount = heldOutComponents.filter((result) => (
    result.expectedSameComponent === false && result.actualSameComponent === true
  )).length
  const terminationCandidates = candidates.filter(({ candidateType }) => (
    candidateType === 'cable_termination'
  ))
  const cableToPolePredictions = terminationCandidates.filter((candidate) => (
    candidate.targetObjectRole === 'pole'
      || candidate.targetAssetType === 'pole'
      || candidate.targetCategory === 'pole'
  ))
  const mountingLabels = Array.isArray(goldSet.mountingConnections)
    ? goldSet.mountingConnections
    : []
  const selectedMounting = candidates.filter(({ candidateType, candidateStatus, proposalStatus }) => (
    candidateType === 'mounting_attachment'
      && (candidateStatus === 'confirmed' || proposalStatus === 'recommended')
  ))
  const mountingCorrect = mountingLabels.filter((label) => (
    selectedMounting.some((candidate) => (
      candidate.sourcePathAssetId === label.sourceAssetId
        && candidate.targetAssetId === label.targetAssetId
    ))
  )).length
  const interfaceLabels = goldSet.endpointConnections.filter(({ expectedTargetInterfaceId }) => (
    expectedTargetInterfaceId != null
  ))
  const interfacePredictions = interfaceLabels.flatMap((label) => {
    const candidate = selectedByDecisionKey.get(topologyCandidateDecisionKeyFromLabel(label))
    return candidate ? [{ label, candidate }] : []
  })
  const interfaceCorrect = interfacePredictions.filter(({ label, candidate }) => (
    candidate.targetInterfaceId === label.expectedTargetInterfaceId
  )).length

  return {
    goldSetVersion: goldSet.version,
    evaluatedAt: goldSet.evaluatedAt ?? null,
    calibration: evaluateSplit('calibration'),
    heldOut: evaluateSplit('held_out'),
    pathAccuracy: ratio(
      heldOutPaths.filter(({ connected }) => connected).length,
      heldOutPaths.length,
    ),
    componentAccuracy: ratio(
      heldOutComponents.filter(({ correct }) => correct).length,
      heldOutComponents.length,
    ),
    falseComponentMergeCount,
    cableToPoleFalsePositiveRate: ratio(
      cableToPolePredictions.length,
      terminationCandidates.length,
    ) ?? 0,
    cableToPoleFalsePositiveCount: cableToPolePredictions.length,
    interfaceTypeAccuracy: ratio(interfaceCorrect, interfacePredictions.length),
    mountingRelationPrecision: ratio(mountingCorrect, selectedMounting.length),
    mountingRelationRecall: ratio(mountingCorrect, mountingLabels.length),
    sampleCoverage: {
      endpointCount: goldSet.endpointConnections.length,
      heldOutEndpointCount: goldSet.endpointConnections.filter(({ split }) => (
        split === 'held_out'
      )).length,
      pathCount: goldSet.paths.length,
      heldOutPathCount: heldOutPaths.length,
      componentAssertionCount: goldSet.componentAssertions.length,
    },
  }
}

function validateGoldSet(goldSet) {
  if (!goldSet?.version || !Array.isArray(goldSet.endpointConnections)) {
    throw new TypeError('Gold set version dan endpointConnections wajib tersedia.')
  }
  if (!Array.isArray(goldSet.paths) || !Array.isArray(goldSet.componentAssertions)) {
    throw new TypeError('Gold set paths dan componentAssertions wajib berupa array.')
  }
  const ids = new Set()
  goldSet.endpointConnections.forEach((label) => {
    if (!['calibration', 'held_out'].includes(label.split)
      || !label.sourceEndpointId
      || ids.has(label.labelId)) {
      throw new TypeError('Label endpoint gold set tidak valid atau duplikat.')
    }
    ids.add(label.labelId)
  })
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function unitMetric(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null
}

function integerMetric(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

function dateValue(value) {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

function graphHasPath(graph, source, target) {
  if (source === target) return true
  const adjacency = new Map((graph.nodes ?? []).map(({ id }) => [id, []]))
  ;(graph.edges ?? []).filter(({ verificationStatus }) => (
    verificationStatus === 'confirmed'
  )).forEach((edge) => {
    adjacency.get(edge.sourceAssetId)?.push(edge.targetAssetId)
    adjacency.get(edge.targetAssetId)?.push(edge.sourceAssetId)
  })
  const visited = new Set([source])
  const queue = [source]
  while (queue.length) {
    const current = queue.shift()
    for (const next of adjacency.get(current) ?? []) {
      if (next === target) return true
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }
  return false
}

function strata(labels, selectedByDecisionKey) {
  const result = {
    '0_2m': { labels: 0, correct: 0 },
    '2_4m': { labels: 0, correct: 0 },
    '4_6m': { labels: 0, correct: 0 },
    noCandidate: { labels: 0, correct: 0 },
  }
  labels.forEach((label) => {
    const candidate = selectedByDecisionKey.get(topologyCandidateDecisionKeyFromLabel(label))
    const key = !candidate || !Number.isFinite(candidate.distanceMeters)
      ? 'noCandidate'
      : candidate.distanceMeters <= 2 ? '0_2m'
        : candidate.distanceMeters <= 4 ? '2_4m' : '4_6m'
    result[key].labels += 1
    if (candidate?.targetAssetId === label.expectedTargetAssetId) {
      result[key].correct += 1
    }
  })
  return result
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null
}
