/**
 * Evaluates a versioned calibration/held-out gold set without mutating candidates.
 * Labels are intentionally external to source KML and review decisions.
 */
export function evaluateTopologyAccuracy({
  candidates = [],
  graph = { nodes: [], edges: [], components: [] },
  goldSet,
} = {}) {
  validateGoldSet(goldSet)
  const selectedByEndpoint = new Map()
  candidates
    .filter((candidate) => (
      candidate.proposalStatus === 'recommended'
      || candidate.candidateStatus === 'confirmed'
    ))
    .sort((left, right) => right.score - left.score || (
      left.candidateId.localeCompare(right.candidateId)
    ))
    .forEach((candidate) => {
      if (!selectedByEndpoint.has(candidate.sourceEndpointId)) {
        selectedByEndpoint.set(candidate.sourceEndpointId, candidate)
      }
    })

  const evaluateSplit = (split) => {
    const labels = goldSet.endpointConnections.filter((label) => label.split === split)
    const positives = labels.filter(({ expectedTargetAssetId }) => Boolean(expectedTargetAssetId))
    const predictions = labels.flatMap((label) => {
      const candidate = selectedByEndpoint.get(label.sourceEndpointId)
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
      distanceStrata: strata(labels, selectedByEndpoint),
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

function strata(labels, selectedByEndpoint) {
  const result = {
    '0_2m': { labels: 0, correct: 0 },
    '2_4m': { labels: 0, correct: 0 },
    '4_6m': { labels: 0, correct: 0 },
    noCandidate: { labels: 0, correct: 0 },
  }
  labels.forEach((label) => {
    const candidate = selectedByEndpoint.get(label.sourceEndpointId)
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
