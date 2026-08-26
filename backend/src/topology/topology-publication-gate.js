import { createHash } from 'node:crypto'

export const TOPOLOGY_PUBLICATION_GATE_VERSION = 'topology-publication-gate/1.0.0'

export function topologyInputFingerprint(bundle, {
  ruleSetVersion,
  config = {},
} = {}) {
  const payload = {
    bundle,
    ruleSetVersion,
    policy: {
      searchRadiusMeters: config.searchRadiusMeters,
      deviceRelationRadiusMeters: config.deviceRelationRadiusMeters,
      deviceRelationUniquenessMarginMeters: config.deviceRelationUniquenessMarginMeters,
      deviceRelationUniquenessRatio: config.deviceRelationUniquenessRatio,
      automaticRelationConfirmation: config.automaticRelationConfirmation === true,
      autoConfirmSpatialInference: config.autoConfirmSpatialInference === true,
    },
  }
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`
}

export function evaluateTopologyPublicationGate({
  artifacts,
  activeRecord = null,
  inputBundle = {},
  config = {},
} = {}) {
  const graph = artifacts?.graph ?? { nodes: [], edges: [], components: [] }
  const nodes = graph.nodes ?? []
  const edges = graph.edges ?? []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const checks = []
  const add = (code, passed, details = {}) => checks.push({ code, passed, ...details })

  const dangling = edges.filter((edge) => (
    !nodeById.has(edge.sourceAssetId) || !nodeById.has(edge.targetAssetId)
  ))
  const selfLoops = edges.filter((edge) => edge.sourceAssetId === edge.targetAssetId)
  const pairKeys = edges.map((edge) => [edge.sourceAssetId, edge.targetAssetId]
    .sort().join('|'))
  const duplicatePairs = pairKeys.filter((key, index) => pairKeys.indexOf(key) !== index)
  const crossArea = edges.filter((edge) => (
    areaKey(nodeById.get(edge.sourceAssetId)) !== areaKey(nodeById.get(edge.targetAssetId))
  ))
  add('graph_integrity', !dangling.length && !selfLoops.length
    && !duplicatePairs.length && !crossArea.length, {
    danglingEdgeIds: dangling.map(({ id }) => id),
    selfLoopEdgeIds: selfLoops.map(({ id }) => id),
    duplicatePairs: [...new Set(duplicatePairs)],
    crossAreaEdgeIds: crossArea.map(({ id }) => id),
  })

  const serverNodes = nodes.filter(isServerOrRack)
  const invalidRoots = serverNodes.filter((node) => (
    node.topologyRole !== 'root' || node.diagramClass !== 'rack-root'
  ))
  add('server_root_classification', !invalidRoots.length, {
    checkedCount: serverNodes.length,
    invalidNodeIds: invalidRoots.map(({ id }) => id),
  })

  const requiredNodes = nodes.filter((node) => (
    node.connectivityExpectation === 'required' || node.topologyRequired === true
  ))
  const explicitExceptionIds = new Set((inputBundle.topologyExceptions ?? [])
    .filter((item) => ['approved', 'active', 'excepted'].includes(
      String(item.status ?? item.verificationStatus ?? '').toLowerCase(),
    ))
    .flatMap((item) => [item.assetId, item.nodeId, item.sourceAssetId].filter(Boolean)))
  const componentByNodeId = new Map()
  ;(graph.components ?? []).forEach((component) => {
    component.nodeIds?.forEach((nodeId) => componentByNodeId.set(nodeId, component))
  })
  const rootIds = new Set(nodes.filter((node) => (
    node.topologyRole === 'root' && node.diagramClass === 'rack-root'
  )).map(({ id }) => id))
  const unresolvedRequired = requiredNodes.filter((node) => {
    if (explicitExceptionIds.has(node.id)) return false
    if (rootIds.has(node.id)) return false
    const component = componentByNodeId.get(node.id)
    return !component?.nodeIds?.some((id) => rootIds.has(id))
  })
  add('required_root_path', !unresolvedRequired.length, {
    checkedCount: requiredNodes.length,
    unresolvedNodeIds: unresolvedRequired.map(({ id }) => id),
  })

  const hierarchy = graph.presentationHierarchy ?? []
  const hierarchyByNodeId = new Map(hierarchy.map((item) => [item.nodeId, item]))
  const junctionChildren = nodes.filter((node) => node.junctionFamily?.childIndex !== null
    && node.junctionFamily?.childIndex !== undefined)
  const silentChildren = junctionChildren.filter((node) => ![
    'confirmed',
    'expected',
    'expected_parent_missing',
    'ambiguous_parent',
  ].includes(hierarchyByNodeId.get(node.id)?.layoutRelationStatus))
  add('junction_parent_accountability', !silentChildren.length, {
    checkedCount: junctionChildren.length,
    silentNodeIds: silentChildren.map(({ id }) => id),
  })

  const capacityIssues = [
    ...(artifacts?.validation?.issues ?? []),
    ...(artifacts?.eligibilityIssues ?? []),
  ].filter(({ issueCode }) => issueCode === 'interface_capacity_exceeded')
  add('interface_capacity', !capacityIssues.length, {
    issueIds: capacityIssues.map(({ issueId, entityReference }) => issueId ?? entityReference),
  })

  const operationalRelations = (artifacts?.confirmedRelations ?? []).filter((relation) => (
    relation.relationKind === 'device_edge' && relation.verificationStatus === 'confirmed'
  ))
  const cameraConflicts = nodes.filter(isCamera).flatMap((camera) => {
    const incident = operationalRelations.filter((relation) => (
      relation.sourceAssetId === camera.id || relation.targetAssetId === camera.id
    ))
    return incident.length > 1 ? [{
      cameraId: camera.id,
      relationIds: incident.map(({ relationId }) => relationId),
    }] : []
  })
  add('single_camera_termination', !cameraConflicts.length, { conflicts: cameraConflicts })

  const diff = buildTopologyAreaDiff(activeRecord?.topologyGraph, graph, inputBundle)
  const regressions = diff.areas.filter((area) => (
    area.previousNodeCount > 0
      && (area.confirmedEdgeDelta < 0 || area.requiredIsolatedDelta > 0)
  ))
  add('no_area_regression', !regressions.length, {
    areas: regressions.map(({ areaKey: key, confirmedEdgeDelta, requiredIsolatedDelta }) => ({
      areaKey: key,
      confirmedEdgeDelta,
      requiredIsolatedDelta,
    })),
  })

  const accuracy = artifacts?.readiness?.accuracy ?? artifacts?.readiness ?? {}
  const accuracyRequired = requiredNodes.length > 0
    && (config.automaticRelationConfirmation === true
      || config.autoConfirmSpatialInference === true)
  const accuracyPassed = !accuracyRequired || (
    Number(accuracy.heldOutPrecision) >= 0.99
      && Number(accuracy.pathAccuracy) >= 0.95
      && Number(accuracy.heldOutSampleSize) >= 200
  )
  add('accuracy', accuracyPassed, {
    required: accuracyRequired,
    minimum: { heldOutPrecision: 0.99, pathAccuracy: 0.95, heldOutSampleSize: 200 },
    actual: {
      heldOutPrecision: Number(accuracy.heldOutPrecision ?? 0),
      pathAccuracy: Number(accuracy.pathAccuracy ?? 0),
      heldOutSampleSize: Number(accuracy.heldOutSampleSize ?? 0),
    },
  })

  const fatalArtifactIssues = [
    ...(artifacts?.validation?.issues ?? []),
    ...(artifacts?.eligibilityIssues ?? []),
  ].filter(({ severity, scope }) => severity === 'error'
    && !['policy', 'candidate_hard_gate', 'constraint'].includes(scope))
  add('artifact_validation', !fatalArtifactIssues.length, {
    issueCodes: [...new Set(fatalArtifactIssues.map(({ issueCode }) => issueCode))],
  })

  const areaSummaries = buildAreaSummaries(graph, hierarchy)
  return {
    version: TOPOLOGY_PUBLICATION_GATE_VERSION,
    passed: checks.every(({ passed }) => passed),
    checks,
    blockingCodes: checks.filter(({ passed }) => !passed).map(({ code }) => code),
    areaSummaries,
    diff,
  }
}

export function buildTopologyAreaDiff(previousGraph = {}, nextGraph = {}, inputBundle = {}) {
  const sourceById = new Map((inputBundle.classifiedNodes ?? []).flatMap((node) => {
    const id = node.canonicalAssetId ?? node.assetId ?? node.stableAssetId
    return id ? [[String(id), node]] : []
  }))
  const alignedPreviousGraph = {
    ...previousGraph,
    nodes: (previousGraph?.nodes ?? []).map((node) => ({
      ...sourceById.get(String(node.id ?? node.assetId)),
      ...node,
      sourceFolderPath: node.sourceFolderPath
        ?? sourceById.get(String(node.id ?? node.assetId))?.sourceFolderPath,
      locationGroupKey: node.locationGroupKey
        ?? sourceById.get(String(node.id ?? node.assetId))?.locationGroupKey,
    })),
  }
  const previous = summarizeByArea(alignedPreviousGraph)
  const next = summarizeByArea(nextGraph)
  const keys = [...new Set([...previous.keys(), ...next.keys()])].sort()
  return {
    areas: keys.map((key) => {
      const before = previous.get(key) ?? emptyArea(key)
      const after = next.get(key) ?? emptyArea(key)
      return {
        areaKey: key,
        previousNodeCount: before.nodeCount,
        nodeCount: after.nodeCount,
        nodeDelta: after.nodeCount - before.nodeCount,
        confirmedEdgeCount: after.confirmedEdgeCount,
        confirmedEdgeDelta: after.confirmedEdgeCount - before.confirmedEdgeCount,
        requiredIsolatedCount: after.requiredIsolatedCount,
        requiredIsolatedDelta: after.requiredIsolatedCount - before.requiredIsolatedCount,
      }
    }),
  }
}

function buildAreaSummaries(graph, hierarchy) {
  const hierarchyByNodeId = new Map(hierarchy.map((item) => [item.nodeId, item]))
  return [...summarizeByArea(graph).values()].map((summary) => ({
    ...summary,
    rootCount: (graph.nodes ?? []).filter((node) => areaKey(node) === summary.areaKey
      && node.topologyRole === 'root').length,
    missingParentCount: (graph.nodes ?? []).filter((node) => areaKey(node) === summary.areaKey
      && ['expected_parent_missing', 'ambiguous_parent'].includes(
        hierarchyByNodeId.get(node.id)?.layoutRelationStatus,
      )).length,
  }))
}

function summarizeByArea(graph = {}) {
  const nodes = graph.nodes ?? []
  const edges = graph.edges ?? []
  const result = new Map()
  nodes.forEach((node) => {
    const key = areaKey(node)
    const summary = result.get(key) ?? emptyArea(key)
    summary.nodeCount += 1
    if ((node.connectivityExpectation === 'required' || node.topologyRequired === true)
      && Number(graph.degreeByNode?.[node.id] ?? 0) === 0) summary.requiredIsolatedCount += 1
    result.set(key, summary)
  })
  edges.forEach((edge) => {
    const source = nodes.find(({ id }) => id === edge.sourceAssetId)
    const key = areaKey(source)
    const summary = result.get(key) ?? emptyArea(key)
    summary.confirmedEdgeCount += 1
    result.set(key, summary)
  })
  return result
}

function emptyArea(key) {
  return { areaKey: key, nodeCount: 0, confirmedEdgeCount: 0, requiredIsolatedCount: 0 }
}

function areaKey(node) {
  if (!node) return 'unknown'
  const segments = String(node.sourceFolderPath ?? '').replace(/\\/g, '/').split('/')
    .map((value) => value.trim()).filter(Boolean)
  const rjbt = segments.findIndex((value) => value.toUpperCase() === 'RJBT')
  return String(node.locationGroupKey ?? node.areaKey
    ?? (rjbt >= 0 ? segments[rjbt + 1] : null)
    ?? node.siteId
    ?? 'unknown').toLowerCase()
}

function isServerOrRack(node) {
  const name = String(node.sourceName ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim()
  const type = String(node.assetType ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim()
  return node.diagramClass === 'rack-root'
    || node.topologyRole === 'root'
    || /^(server|rack server|server rack|sr|rs|cr|svr office)(\s|$)/.test(name)
    || /^(server|server rack|rack server|rack)$/.test(type)
}

function isCamera(node) {
  if (node.topologyRole === 'junction'
    || String(node.diagramClass ?? '').startsWith('junction')) return false
  const text = [
    node.assetType,
    node.category,
    node.sourceName,
  ].filter(Boolean).join(' ').toLowerCase()
  if (/(^|\s)(junction|junction box|jb)(\s|[-_]|$)/.test(text)) return false
  return /camera|kamera|cctv|(^|[\s_-])cam[\s_-]*\d+|(^|[\s_-])c[\s_-]*\d+/.test(text)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}
