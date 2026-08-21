const NETWORK_FAMILY_ORDER = Object.freeze([
  'cctv',
  'fiber-optic',
  'utp',
  'power',
  'lan',
  'infrastructure',
  'peripheral',
  'unmapped',
])

const NETWORK_FAMILY_LABELS = Object.freeze({
  cctv: 'CCTV',
  'fiber-optic': 'Fiber optic',
  utp: 'UTP',
  power: 'Power',
  lan: 'LAN',
  infrastructure: 'Infrastruktur',
  peripheral: 'Peripheral',
  unmapped: 'Lainnya',
})

const NETWORK_FAMILY_COLORS = Object.freeze({
  cctv: '#5367d8',
  'fiber-optic': '#0b9b79',
  utp: '#2d7cc4',
  power: '#c0801d',
  lan: '#6f8295',
  infrastructure: '#9b6b18',
  peripheral: '#7957bd',
  unmapped: '#7e8b98',
})

const ROLE_PRIORITY = Object.freeze({
  root: 0,
  core: 1,
  server: 2,
  nvr: 3,
  router: 4,
  distribution: 5,
  switch: 6,
  otb: 7,
  junction: 8,
  endpoint: 20,
})

export const TOPOLOGY_DIAGRAM_CLASSES = Object.freeze([
  'rack-root',
  'junction-peer',
  'junction-extended',
  'endpoint',
  'physical-mount',
])

const DIAGRAM_CLASS_TIERS = Object.freeze({
  'rack-root': 'rack-root',
  'junction-peer': 'junction-peer',
  'junction-extended': 'junction-extended',
  endpoint: 'endpoint',
  'physical-mount': 'physical-mount',
})

export function buildTopologyDiagramModel({
  assets = [],
  graph = {},
  candidates = [],
  unresolved = [],
  locationGroups = [],
  area = null,
  branchId = null,
  datasetId = null,
  datasetVersionId = null,
  roots = [],
  mountingRelations = [],
  poleGroups = [],
  selectedFamilies = new Set(),
  search = '',
  showAdminLayers = false,
  traceAssetIds = [],
  traceEdgeIds = [],
  readiness = null,
  publicationProfile = null,
  isDraft = false,
} = {}) {
  const inputAssets = Array.isArray(assets) ? assets : []
  const graphNodes = new Map()
  ;(Array.isArray(graph?.nodes) ? graph.nodes : []).forEach((node) => {
    const id = assetIdFor(node)
    if (id && !graphNodes.has(id)) graphNodes.set(id, node)
  })

  const allSourceAssetById = new Map()
  inputAssets.forEach((asset) => {
    const id = assetIdFor(asset)
    if (!id || allSourceAssetById.has(id)) return
    if (!matchesScope(asset, { branchId, datasetVersionId })) return
    const scopedValue = { ...asset, ...graphNodes.get(id), id }
    if (!isTopologyDeviceAsset({ asset, graphNode: graphNodes.get(id), graphHasNodes: graphNodes.size > 0 })) return
    allSourceAssetById.set(id, scopedValue)
  })
  // The confirmed graph is authoritative for topology nodes. In normal map
  // payloads every graph node also has an asset record, but retaining a graph
  // node here keeps the diagram complete when the map projection is partial.
  graphNodes.forEach((graphNode, id) => {
    if (allSourceAssetById.has(id)) return
    if (!matchesScope(graphNode, { branchId, datasetVersionId })) return
    const scopedValue = { ...graphNode, id }
    allSourceAssetById.set(id, scopedValue)
  })

  const sourceAssetById = new Map([...allSourceAssetById.entries()].filter(([, asset]) => (
    !area || areaKeyFor(asset) === area
  )))

  const physicalAssetById = new Map([...sourceAssetById.entries()].filter(([, asset]) => (
    classifyTopologyNode(asset) === 'physical-mount'
  )))
  const assetById = new Map([...sourceAssetById.entries()].filter(([, asset]) => (
    classifyTopologyNode(asset) !== 'physical-mount'
  )))

  const nodes = [...assetById.values()].map((asset) => {
    const graphNode = graphNodes.get(asset.id) ?? {}
    const projectedAsset = { ...asset, ...graphNode }
    const areaKey = areaKeyFor(projectedAsset)
    const areaName = areaNameFor(projectedAsset, locationGroups)
    const family = networkFamilyFor({ ...asset, ...graphNode })
    const topologyRole = normalizeTopologyRole(
      graphNode.topologyRole ?? asset.topologyRole ?? asset.role,
    )
    const diagramClass = classifyTopologyNode({ ...asset, ...graphNode })
    return {
      ...asset,
      ...graphNode,
      id: asset.id,
      assetId: asset.id,
      assetType: asset.assetType
        ?? graphNode.assetType
        ?? asset.type
        ?? graphNode.type
        ?? 'Aset',
      branchId: asset.branchId ?? graphNode.branchId ?? branchId,
      areaId: areaKey,
      name: asset.name ?? graphNode.name ?? asset.id,
      type: asset.type ?? graphNode.assetType ?? graphNode.type ?? 'Aset',
      category: asset.category ?? graphNode.category ?? family,
      location: asset.location ?? graphNode.location ?? '',
      areaKey,
      areaName,
      networkFamily: family,
      networkFamilyLabel: networkFamilyLabel(family),
      iconType: iconTypeForAsset({ ...asset, ...graphNode }),
      topologyRole,
      diagramClass,
      semanticTier: DIAGRAM_CLASS_TIERS[diagramClass] ?? diagramClass,
      isCore: diagramClass === 'rack-root'
        || isCoreRole(topologyRole, asset.type ?? graphNode.assetType ?? graphNode.type),
      isEndpoint: diagramClass === 'endpoint'
        || isEndpointRole(topologyRole, asset.type ?? graphNode.assetType ?? graphNode.type),
      status: asset.status ?? asset.operationalStatus ?? graphNode.status ?? '',
      relationStatus: 'unresolved',
      degree: 0,
      confirmedDegree: 0,
      suggestedDegree: 0,
      connectivityStatus: 'disconnected',
      isSuggestedOnly: false,
      isLayoutAnchor: false,
      layoutAnchorReason: null,
      position: null,
      directEdgeIds: [],
      matched: matchesSearch(asset, graphNode, search),
      trace: false,
      dimmed: false,
    }
  })
  const scopedIds = new Set(nodes.map(({ id }) => id))
  const allDeviceIds = new Set([...allSourceAssetById.entries()]
    .filter(([, asset]) => classifyTopologyNode(asset) !== 'physical-mount')
    .map(([id]) => id))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const allEdges = normalizeConfirmedEdges(graph?.edges, allDeviceIds, {
    branchId,
    datasetVersionId,
  })
  const edges = allEdges.filter((edge) => (
    nodeById.has(edge.sourceId)
      && nodeById.has(edge.targetId)
      &&
    areaKeyFor(nodeById.get(edge.sourceId)) === areaKeyFor(nodeById.get(edge.targetId))
  ))
  const crossAreaEdges = allEdges
    .filter((edge) => {
      const sourceInScope = scopedIds.has(edge.sourceId)
      const targetInScope = scopedIds.has(edge.targetId)
      const sourceArea = areaKeyFor(allSourceAssetById.get(edge.sourceId))
      const targetArea = areaKeyFor(allSourceAssetById.get(edge.targetId))
      if (!sourceArea || !targetArea || sourceArea === targetArea) return false
      return !area || sourceInScope !== targetInScope
    })
    .map((edge) => {
      const sourceAsset = allSourceAssetById.get(edge.sourceId)
      const targetAsset = allSourceAssetById.get(edge.targetId)
      const sourceInScope = scopedIds.has(edge.sourceId)
      const insideAsset = area ? (sourceInScope ? sourceAsset : targetAsset) : null
      const outsideAsset = area ? (sourceInScope ? targetAsset : sourceAsset) : null
      return {
        ...edge,
        sourceAreaKey: areaKeyFor(sourceAsset),
        sourceAreaName: areaNameFor(sourceAsset, locationGroups),
        targetAreaKey: areaKeyFor(targetAsset),
        targetAreaName: areaNameFor(targetAsset, locationGroups),
        insideNodeId: insideAsset?.id ?? null,
        outsideNodeId: outsideAsset?.id ?? null,
        outsideAreaKey: areaKeyFor(outsideAsset),
        outsideAreaName: areaNameFor(outsideAsset, locationGroups),
      }
    })
  const edgeById = new Map()
  edges.forEach((edge) => {
    if (edgeById.has(edge.id)) return
    edgeById.set(edge.id, edge)
  })

  const adjacency = new Map(nodes.map(({ id }) => [id, []]))
  const edgeGroups = new Map()
  edges.forEach((edge) => {
    const source = nodeById.get(edge.sourceId)
    const target = nodeById.get(edge.targetId)
    if (!source || !target) return
    source.degree += 1
    target.degree += 1
    source.directEdgeIds.push(edge.id)
    target.directEdgeIds.push(edge.id)
    source.relationStatus = 'confirmed'
    target.relationStatus = 'confirmed'
    adjacency.get(edge.sourceId).push({ id: edge.targetId, edge })
    adjacency.get(edge.targetId).push({ id: edge.sourceId, edge })
    const key = unorderedPair(edge.sourceId, edge.targetId)
    edgeGroups.set(key, [...(edgeGroups.get(key) ?? []), edge])
  })
  nodes.forEach((node) => {
    node.directEdgeIds.sort()
    node.confirmedDegree = node.degree
  })

  const mountingGroups = normalizeMountingGroups({
    poleGroups,
    mountingRelations,
    assetById: sourceAssetById,
    nodeById,
  })
  const mountingGroupIdsByChild = new Map()
  mountingGroups.forEach((group) => {
    group.childIds.forEach((childId) => {
      mountingGroupIdsByChild.set(childId, [
        ...(mountingGroupIdsByChild.get(childId) ?? []),
        group.id,
      ])
    })
  })
  nodes.forEach((node) => {
    node.mountingGroupIds = [...(mountingGroupIdsByChild.get(node.id) ?? [])].sort(compareIds)
    node.isPhysicalMount = false
  })

  const scopedCandidates = normalizeAdminCandidates(candidates, scopedIds, area, {
    branchId,
    datasetVersionId,
    nodeById,
  })
  const allSuggestedLinks = normalizeSuggestedLinks(scopedCandidates)
  const suggestedDegreeByNode = new Map(nodes.map(({ id }) => [id, 0]))
  allSuggestedLinks.forEach((link) => {
    if (suggestedDegreeByNode.has(link.sourceId)) {
      suggestedDegreeByNode.set(link.sourceId, suggestedDegreeByNode.get(link.sourceId) + 1)
    }
    if (suggestedDegreeByNode.has(link.targetId)) {
      suggestedDegreeByNode.set(link.targetId, suggestedDegreeByNode.get(link.targetId) + 1)
    }
  })
  nodes.forEach((node) => {
    node.suggestedDegree = suggestedDegreeByNode.get(node.id) ?? 0
    node.isSuggestedOnly = node.confirmedDegree === 0 && node.suggestedDegree > 0
    node.connectivityStatus = node.confirmedDegree > 0
      ? 'confirmed'
      : node.isSuggestedOnly ? 'suggested-only' : 'disconnected'
    node.relationStatus = node.connectivityStatus === 'confirmed'
      ? 'confirmed'
      : node.isSuggestedOnly ? 'suggested' : 'unresolved'
  })

  const components = connectedComponents(nodes, adjacency)
  const verifiedRootIds = normalizeRootIds(roots, scopedIds)
  const componentModels = components
    .filter((componentNodeIds) => componentNodeIds.length > 1)
    .map((componentNodeIds, index) => {
    const componentNodes = componentNodeIds.map((id) => nodeById.get(id)).filter(Boolean)
    const componentEdges = edges.filter((edge) => (
      componentNodeIds.includes(edge.sourceId) && componentNodeIds.includes(edge.targetId)
    ))
    const root = chooseComponentRoot({
      nodes: componentNodes,
      edges: componentEdges,
      verifiedRootIds,
    })
    const depths = calculateDepths(root.id, componentNodes, adjacency)
    const componentId = componentIdFor(graph, componentNodeIds, index)
    componentNodes.forEach((node) => {
      node.componentId = componentId
      node.depth = depths.get(node.id) ?? 0
      node.rootReason = root.id === node.id ? root.reason : null
      node.isVerifiedRoot = root.id === node.id && root.verified
      node.isLayoutAnchor = root.id === node.id
      node.layoutAnchorReason = root.id === node.id ? root.reason : null
    })
      return {
        componentId,
        nodeIds: [...componentNodeIds].sort(compareIds),
        edgeIds: componentEdges.map(({ id }) => id).sort(compareIds),
        suggestedLinkIds: [],
        suggestedNeighborComponentIds: [],
        rootId: root.id,
        rootVerified: root.verified,
        rootReason: root.reason,
        areaKey: componentNodes[0]?.areaKey ?? 'lainnya',
      }
    })

  const componentByNodeId = new Map()
  componentModels.forEach((component) => {
    component.nodeIds.forEach((nodeId) => componentByNodeId.set(nodeId, component))
  })
  const suggestedLinksByComponent = new Map()
  allSuggestedLinks.forEach((link) => {
    const sourceComponent = componentByNodeId.get(link.sourceId)
    const targetComponent = componentByNodeId.get(link.targetId)
    if (!sourceComponent || !targetComponent
      || sourceComponent.componentId === targetComponent.componentId) return
    ;[sourceComponent, targetComponent].forEach((component) => {
      const current = suggestedLinksByComponent.get(component.componentId) ?? {
        linkIds: new Set(),
        neighborIds: new Set(),
      }
      current.linkIds.add(link.id)
      current.neighborIds.add(
        component === sourceComponent ? targetComponent.componentId : sourceComponent.componentId,
      )
      suggestedLinksByComponent.set(component.componentId, current)
    })
  })
  componentModels.forEach((component) => {
    const suggestion = suggestedLinksByComponent.get(component.componentId)
    component.suggestedLinkIds = [...(suggestion?.linkIds ?? [])].sort(compareIds)
    component.suggestedNeighborComponentIds = [...(suggestion?.neighborIds ?? [])].sort(compareIds)
  })

  const connectedIds = new Set(componentModels.flatMap(({ nodeIds }) => nodeIds))
  const isolatedNodes = nodes.filter((node) => (
    !connectedIds.has(node.id) && node.confirmedDegree === 0 && node.suggestedDegree === 0
  ))
  const suggestedOnlyNodes = nodes.filter((node) => (
    !connectedIds.has(node.id) && node.isSuggestedOnly
  ))
  isolatedNodes.forEach((node) => {
    node.componentId = null
    node.depth = null
    node.rootReason = null
    node.isVerifiedRoot = false
    node.isLayoutAnchor = false
    node.layoutAnchorReason = null
  })
  suggestedOnlyNodes.forEach((node) => {
    node.componentId = null
    node.depth = null
    node.rootReason = null
    node.isVerifiedRoot = false
    node.isLayoutAnchor = false
    node.layoutAnchorReason = null
  })

  const areaByKey = new Map()
  nodes.forEach((node) => {
    const key = node.areaKey || 'lainnya'
    const existing = areaByKey.get(key) ?? {
      key,
      name: node.areaName || key,
      nodeIds: [],
      componentIds: [],
      isolatedNodeIds: [],
      suggestedOnlyNodeIds: [],
      unresolved: [],
    }
    existing.nodeIds.push(node.id)
    areaByKey.set(key, existing)
  })
  componentModels.forEach((component) => {
    const areaModel = areaByKey.get(component.areaKey) ?? {
      key: component.areaKey,
      name: areaNameForKey(component.areaKey, locationGroups),
      nodeIds: [],
      componentIds: [],
      isolatedNodeIds: [],
      suggestedOnlyNodeIds: [],
      unresolved: [],
    }
    areaModel.componentIds.push(component.componentId)
    areaByKey.set(component.areaKey, areaModel)
  })
  isolatedNodes.forEach((node) => {
    areaByKey.get(node.areaKey)?.isolatedNodeIds.push(node.id)
  })
  suggestedOnlyNodes.forEach((node) => {
    areaByKey.get(node.areaKey)?.suggestedOnlyNodeIds.push(node.id)
  })

  const scopedUnresolved = normalizeUnresolved(unresolved, scopedIds, area, {
      branchId,
      datasetVersionId,
      nodeById,
    })
  scopedUnresolved.forEach((item) => {
    const key = item.areaKey || areaKeyFor(nodeById.get(item.sourcePathAssetId)) || 'lainnya'
    const areaModel = areaByKey.get(key) ?? {
      key,
      name: areaNameForKey(key, locationGroups),
      nodeIds: [],
      componentIds: [],
      isolatedNodeIds: [],
      suggestedOnlyNodeIds: [],
      unresolved: [],
    }
    areaModel.unresolved.push(item)
    areaByKey.set(key, areaModel)
  })

  const traceAssets = new Set(traceAssetIds.filter((id) => scopedIds.has(id)))
  const traceEdges = new Set(traceEdgeIds.filter((id) => edgeById.has(id)))
  nodes.forEach((node) => {
    node.trace = traceAssets.has(node.id)
    node.dimmed = shouldDimNode(node, {
      search,
      selectedFamilies,
      traceAssets,
    })
  })
  edges.forEach((edge) => {
    edge.trace = traceEdges.has(edge.id)
    edge.dimmed = shouldDimEdge(edge, {
      search,
      selectedFamilies,
      traceAssets,
      traceEdges,
    })
  })

  const crossAreaCountByKey = new Map()
  const crossAreaNeighborsByKey = new Map()
  crossAreaEdges.forEach((edge) => {
    ;[edge.sourceAreaKey, edge.targetAreaKey].forEach((key) => {
      crossAreaCountByKey.set(key, (crossAreaCountByKey.get(key) ?? 0) + 1)
      const neighbors = crossAreaNeighborsByKey.get(key) ?? new Set()
      neighbors.add(key === edge.sourceAreaKey ? edge.targetAreaKey : edge.sourceAreaKey)
      crossAreaNeighborsByKey.set(key, neighbors)
    })
  })

  const areas = [...areaByKey.values()]
    .sort((left, right) => areaOrder(left.key, locationGroups)
      - areaOrder(right.key, locationGroups)
      || left.name.localeCompare(right.name, 'id')
      || left.key.localeCompare(right.key, 'id'))
    .map((areaModel) => ({
      ...areaModel,
      nodeIds: [...new Set(areaModel.nodeIds)].sort(compareIds),
      componentIds: [...new Set(areaModel.componentIds)].sort(compareIds),
      isolatedNodeIds: [...new Set(areaModel.isolatedNodeIds)].sort(compareIds),
      suggestedOnlyNodeIds: [...new Set(areaModel.suggestedOnlyNodeIds)].sort(compareIds),
      unresolved: areaModel.unresolved.sort(compareUnresolved),
      crossAreaEdgeCount: crossAreaCountByKey.get(areaModel.key) ?? 0,
      crossAreaNeighborKeys: [...(crossAreaNeighborsByKey.get(areaModel.key) ?? [])].sort(compareIds),
    }))

  const networkOptions = uniqueNetworkFamilies(nodes, edges)
  const activeAdminLayer = Boolean(showAdminLayers)
  const visibleCandidates = activeAdminLayer ? scopedCandidates : []
  const visibleSuggestedLinks = activeAdminLayer ? allSuggestedLinks : []
  const visibleUnresolved = activeAdminLayer ? scopedUnresolved : []
  const topologyLinks = [
    ...edges,
    ...visibleSuggestedLinks,
  ]
  const topologyLinkById = new Map(topologyLinks.map((link) => [link.id, link]))
  const summary = {
    totalAssetCount: nodes.length,
    connectedAssetCount: connectedIds.size,
    isolatedAssetCount: isolatedNodes.length,
    confirmedEdgeCount: edges.length,
    crossAreaEdgeCount: crossAreaEdges.length,
    componentCount: componentModels.length,
    areaCount: areas.length,
    candidateCount: scopedCandidates.length,
    unresolvedPathCount: scopedUnresolved.length,
    suggestedLinkCount: allSuggestedLinks.length,
    suggestedOnlyAssetCount: suggestedOnlyNodes.length,
    disconnectedAssetCount: isolatedNodes.length,
    physicalMountCount: physicalAssetById.size,
    mountingGroupCount: mountingGroups.length,
    activeAdminLayer,
    draft: Boolean(isDraft),
  }

  const invalid = topologyGraphDiagnostics({ nodes, edges, graph })
  return {
    status: nodes.length ? 'ready' : 'empty',
    message: nodes.length
      ? null
      : area
        ? 'Area ini belum memiliki aset pada dataset aktif.'
        : 'Tidak ada aset pada dataset aktif untuk ditampilkan.',
    branchId,
    datasetId,
    datasetVersionId,
    area,
    graphRevision: graph?.graphRevision ?? null,
    publicationProfile,
    readiness,
    draft: Boolean(isDraft),
    nodes: nodes.sort(compareNodes),
    edges: edges.sort(compareEdges),
    crossAreaEdges: crossAreaEdges.sort(compareEdges),
    confirmedLinks: edges,
    suggestedLinks: visibleSuggestedLinks,
    allSuggestedLinks,
    topologyLinks,
    areas,
    components: componentModels.sort((left, right) => left.componentId.localeCompare(right.componentId)),
    isolatedNodes: isolatedNodes.sort(compareNodes),
    candidates: visibleCandidates,
    unresolved: visibleUnresolved,
    allCandidates: scopedCandidates,
    allUnresolved: scopedUnresolved,
    physicalMounts: [...physicalAssetById.values()].sort(compareNodes),
    nodeById,
    edgeById,
    topologyLinkById,
    adjacency,
    networkOptions,
    mountingGroups,
    selectedFamilies: new Set(selectedFamilies),
    search,
    summary,
    diagnostics: invalid,
    edgeGroups,
    traceAssetIds: traceAssets,
    traceEdgeIds: traceEdges,
  }
}

export function getTopologyDiagramSearchResults(model, query, limit = 12) {
  const normalized = normalizeSearch(query)
  if (!normalized) return []
  const nodeResults = (model?.nodes ?? [])
    .map((node) => ({
      kind: 'asset',
      id: node.id,
      label: node.name || node.id,
      detail: `${node.type || 'Aset'} · ${node.location || node.areaName || 'Lokasi belum tersedia'}`,
      score: searchScore(node, normalized),
    }))
    .filter(({ score }) => score > 0)
  const edgeResults = (model?.edges ?? [])
    .map((edge) => {
      const source = model.nodeById.get(edge.sourceId)
      const target = model.nodeById.get(edge.targetId)
      const score = searchScore({
        id: edge.id,
        name: `${edge.sourceGeometryId ?? ''} ${edge.relationId ?? ''} ${edge.networkFamily ?? ''}`,
        type: `${source?.name ?? ''} ${target?.name ?? ''}`,
        location: edge.provenance,
      }, normalized)
      return {
        kind: 'edge',
        id: edge.id,
        label: edge.sourceGeometryId || edge.relationId || edge.id,
        detail: `${source?.name ?? edge.sourceId} → ${target?.name ?? edge.targetId}`,
        score,
      }
    })
    .filter(({ score }) => score > 0)
  return [...nodeResults, ...edgeResults]
    .sort((left, right) => right.score - left.score
      || left.label.localeCompare(right.label, 'id')
      || left.id.localeCompare(right.id, 'id'))
    .slice(0, limit)
}

export function isConfirmedTopologyEdge(edge) {
  if (!edge || typeof edge !== 'object') return false
  if (edge.verificationStatus !== undefined) return edge.verificationStatus === 'confirmed'
  if (edge.relationStatus !== undefined) return edge.relationStatus === 'confirmed'
  if (edge.candidateStatus !== undefined) return edge.candidateStatus === 'confirmed'
  return true
}

export function normalizeNetworkFamily(value) {
  const source = String(value ?? '').trim().toLowerCase()
    .replaceAll('_', '-').replaceAll(' ', '-')
  if (!source) return 'unmapped'
  if (source.includes('fiber') || source.includes('fibre') || source === 'fo') {
    return 'fiber-optic'
  }
  if (source.includes('utp') || source.includes('ethernet')) return 'utp'
  if (source.includes('power') || source.includes('listrik')) return 'power'
  if (source.includes('cctv') || source.includes('camera')) return 'cctv'
  if (source === 'lan' || source.includes('lan')) return 'lan'
  if (source.includes('peripheral') || source.includes('printer') || source.includes('access-point')) {
    return 'peripheral'
  }
  if (source.includes('infra') || source.includes('switch') || source.includes('server')
    || source.includes('router') || source.includes('core') || source.includes('otb')) {
    return 'infrastructure'
  }
  return NETWORK_FAMILY_ORDER.includes(source) ? source : 'unmapped'
}

export function networkFamilyLabel(value) {
  const family = normalizeNetworkFamily(value)
  return NETWORK_FAMILY_LABELS[family] ?? family
}

export function networkFamilyColor(value) {
  const family = normalizeNetworkFamily(value)
  return NETWORK_FAMILY_COLORS[family] ?? NETWORK_FAMILY_COLORS.unmapped
}

export function normalizeTopologyRole(value) {
  const source = String(value ?? '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
  if (source.includes('root')) return 'root'
  if (source.includes('core')) return 'core'
  if (source.includes('distribution') || source === 'dist') return 'distribution'
  if (source.includes('server')) return 'server'
  if (source.includes('nvr')) return 'nvr'
  if (source.includes('router')) return 'router'
  if (source.includes('switch')) return 'switch'
  if (source.includes('otb')) return 'otb'
  if (source.includes('junction') || source === 'jb') return 'junction'
  if (source.includes('endpoint') || source.includes('camera') || source.includes('cctv')) {
    return 'endpoint'
  }
  return source || 'unknown'
}

export function normalizeTopologyDiagramClass(value) {
  const source = String(value ?? '').trim().toLowerCase()
    .replaceAll('_', '-').replaceAll(' ', '-')
  return {
    'rack-root': 'rack-root',
    'rack': 'rack-root',
    'root': 'rack-root',
    'core': 'rack-root',
    'junction-peer': 'junction-peer',
    'junction': 'junction-peer',
    'junction-regular': 'junction-peer',
    'junction-extended': 'junction-extended',
    'extended-junction': 'junction-extended',
    endpoint: 'endpoint',
    'physical-mount': 'physical-mount',
    mounting: 'physical-mount',
  }[source] ?? null
}

export function classifyTopologyNode(value = {}) {
  const canonicalClass = normalizeTopologyDiagramClass(
    value.diagramClass
      ?? value.canonicalDiagramClass
      ?? value.topology?.diagramClass,
  )
  if (canonicalClass) return canonicalClass

  const canonicalType = String(value.canonicalAssetType ?? '').trim().toLowerCase()
    .replaceAll('_', '-').replaceAll(' ', '-')
  const canonicalProfile = String(value.jbProfileId ?? '').trim().toLowerCase()
    .replaceAll('_', '-')
  if (canonicalProfile.includes('server-rack') || canonicalProfile.includes('rack-server')) {
    return 'rack-root'
  }
  if (canonicalProfile.includes('extended')) return 'junction-extended'
  if (canonicalProfile.includes('main-jb') || canonicalProfile.includes('main-junction')) {
    return 'junction-peer'
  }
  if (['pole', 'mast', 'pylon', 'physical-mount'].includes(canonicalType)) {
    return 'physical-mount'
  }
  if (['junction-box', 'junction', 'jb'].includes(canonicalType)) return 'junction-peer'
  if (['rack', 'server-rack', 'router', 'switch', 'core-switch', 'nvr', 'otb', 'olt']
    .includes(canonicalType)) return 'rack-root'
  if (['cctv-camera', 'cctv-fixed', 'cctv-dome', 'cctv-ptz', 'access-point', 'printer', 'endpoint']
    .includes(canonicalType)) return 'endpoint'

  const source = [
    value.assetType,
    value.type,
    value.category,
    value.name,
    value.objectRole,
    value.topologyRole,
    value.role,
  ].filter(Boolean).join(' ').toLowerCase()
  const role = normalizeTopologyRole(value.topologyRole ?? value.role)
  const normalizedRole = String(value.topologyRole ?? value.role ?? '')
    .trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')

  if (normalizedRole.includes('physical_mount')
    || normalizedRole.includes('mounting')
    || normalizedRole === 'pole'
    || /(^|\s)(tiang|pole|mast|pylon)(\s|$)/.test(source)) {
    return 'physical-mount'
  }
  if (/jb[\s_-]*(?:box[\s_-]*)?(?:rack[\s_-]*server|server[\s_-]*rack)/.test(source)
    || /rack[\s_-]*server/.test(source)) {
    return 'rack-root'
  }
  if (normalizedRole.includes('junction_extended')
    || /(?:junction|jb)[\s_-]*(?:box[\s_-]*)?extended/.test(source)
    || /extended[\s_-]*(?:junction|jb)/.test(source)) {
    return 'junction-extended'
  }
  if (normalizedRole.includes('junction') || normalizedRole === 'jb'
    || /(?:^|\s)(?:jb|junction)(?:\s|[-_]|$)/.test(source)) {
    return 'junction-peer'
  }
  if (role === 'endpoint' || /cctv|camera|kamera|access[\s_-]*point|(^|\s)ap(\s|$)|endpoint/.test(source)) {
    return 'endpoint'
  }
  if (['root', 'core', 'server', 'nvr', 'router', 'switch', 'distribution', 'otb'].includes(role)
    || /server[\s_-]*rack|rack[\s_-]*server|core[\s_-]*switch|core|router|nvr|switch|distribution|olt|otb/.test(source)) {
    return 'rack-root'
  }
  return 'endpoint'
}

export function iconTypeForAsset(value = {}) {
  const source = [
    value.assetType,
    value.type,
    value.category,
    value.networkFamily,
    value.name,
    value.topologyRole,
  ].filter(Boolean).join(' ').toLowerCase()
  const role = normalizeTopologyRole(value.topologyRole ?? value.role)
  if (/server\s*(rack)?|rack server|core|nvr|router/.test(source)
    || ['root', 'core', 'server', 'nvr', 'router'].includes(role)) {
    return 'server-rack-core'
  }
  if (/switch|otb|distribution|olt/.test(source)
    || ['distribution', 'switch', 'otb'].includes(role)) {
    return 'switch-otb'
  }
  if (/junction\s*box|junction|\bjb\b/.test(source) || role === 'junction') {
    return 'junction-box'
  }
  if (/cctv|camera|kamera|access\s*point|\bap\b/.test(source) || role === 'endpoint') {
    return /access\s*point|\bap\b/.test(source) ? 'access-point' : 'cctv'
  }
  if (/tiang|pole|mount|mast/.test(source)) return 'pole-mounting'
  return 'generic-device'
}

function isTopologyDeviceAsset({ asset = {}, graphNode = null, graphHasNodes = false } = {}) {
  if (graphNode) return true
  if (!graphHasNodes) return !isPathLikeAsset(asset)
  if (hasPointGeometry(asset)) return true
  return !isPathLikeAsset(asset)
}

function isPathLikeAsset(asset = {}) {
  const source = [asset.type, asset.assetType, asset.category, asset.name, asset.objectRole]
    .filter(Boolean).join(' ').toLowerCase()
  if (/cable|kabel|fiber|fibre|utp|power\s*line|line\s*string|path|jalur|wire|route/.test(source)) {
    return !hasPointGeometry(asset)
  }
  const geometries = Array.isArray(asset.geometry) ? asset.geometry : []
  return geometries.length > 0 && geometries.every(({ geometryType }) => (
    ['line_string', 'linestring', 'line-string'].includes(String(geometryType).toLowerCase())
  ))
}

function hasPointGeometry(asset) {
  return (asset?.geometry ?? asset?.geometries ?? []).some(({ geometryType }) => (
    String(geometryType ?? '').toLowerCase().replaceAll('-', '_') === 'point'
  ))
}

function normalizeConfirmedEdges(rawEdges, scopedIds, { branchId, datasetVersionId }) {
  const seen = new Set()
  return (Array.isArray(rawEdges) ? rawEdges : []).flatMap((edge, index) => {
    if (!isConfirmedTopologyEdge(edge)) return []
    if (!matchesScope(edge, { branchId, datasetVersionId })) return []
    const sourceId = edge.sourceAssetId ?? edge.sourceNodeId ?? edge.sourceId
    const targetId = edge.targetAssetId ?? edge.targetNodeId ?? edge.targetId
    if (!sourceId || !targetId || sourceId === targetId
      || !scopedIds.has(sourceId) || !scopedIds.has(targetId)) return []
    const id = String(edge.id ?? edge.edgeId ?? edge.relationId
      ?? `confirmed:${sourceId}:${targetId}:${index}`)
    const pairKey = `${id}|${unorderedPair(sourceId, targetId)}`
    if (seen.has(pairKey)) return []
    seen.add(pairKey)
    const direction = normalizeDirection(edge.direction)
    const networkFamily = normalizeNetworkFamily(
      edge.networkFamily ?? edge.networkType ?? edge.networkId ?? edge.category,
    )
    return [{
      ...edge,
      id,
      relationId: edge.relationId ?? edge.id ?? edge.edgeId ?? id,
      sourceId,
      targetId,
      relationStatus: 'confirmed',
      verificationStatus: 'confirmed',
      status: 'confirmed',
      direction,
      directed: direction !== 'undirected',
      networkFamily,
      networkFamilyLabel: networkFamilyLabel(networkFamily),
      mediaType: edge.mediaType ?? edge.media ?? edge.networkType ?? networkFamily,
      relationType: edge.relationType ?? edge.relationKind ?? 'connected-to',
      networkColor: edge.networkColor ?? networkFamilyColor(networkFamily),
      sourceGeometryId: edge.sourceGeometryId ?? edge.sourceGeometryIds?.[0] ?? null,
      sourceGeometryIds: [...new Set([
        ...(edge.sourceGeometryIds ?? []),
        ...(edge.sourceGeometryId ? [edge.sourceGeometryId] : []),
      ])],
      pathAssetIds: [...new Set([
        ...(edge.pathAssetIds ?? []),
        ...(edge.pathAssetId ? [edge.pathAssetId] : []),
      ])],
      lengthMeters: numberOrNull(edge.lengthMeters
        ?? edge.totalLengthMeters
        ?? edge.distanceMeters),
      confidence: numberOrNull(edge.confidence ?? edge.score),
      provenance: edge.provenance ?? edge.relationSource ?? 'confirmed topology projection',
      evidence: Array.isArray(edge.evidence) ? edge.evidence : [],
    }]
  })
}

function normalizeAdminCandidates(candidates, scopedIds, area, {
  branchId,
  datasetVersionId,
  nodeById,
}) {
  return (Array.isArray(candidates) ? candidates : []).flatMap((candidate, index) => {
    if (!['candidate', 'ambiguous'].includes(candidate?.candidateStatus)) return []
    if (['rejected', 'revoked'].includes(candidate?.proposalStatus)) return []
    if (!matchesScope(candidate, { branchId, datasetVersionId })) return []
    const sourceId = candidate.sourceAssetId
      ?? candidate.sourcePathAssetId
      ?? candidate.sourceEndpointId
    const targetId = candidate.targetAssetId
      ?? candidate.targetPathAssetId
      ?? candidate.targetEndpointId
    const ids = [sourceId, targetId].filter(Boolean)
    if (!ids.length || !ids.every((id) => scopedIds.has(id))) return []
    const sourceArea = candidate.areaKey
      ? areaKeyFor({ locationGroupKey: candidate.areaKey })
      : areaKeyFor(nodeById.get(sourceId))
    const targetArea = areaKeyFor(nodeById.get(targetId))
    if (area && sourceArea && sourceArea !== area) return []
    if (sourceArea && targetArea && sourceArea !== targetArea) return []
    return [{
      ...candidate,
      candidateId: candidate.candidateId ?? `candidate:${sourceId}:${targetId}:${index}`,
      sourceId,
      targetId,
      areaKey: sourceArea || null,
      networkFamily: normalizeNetworkFamily(candidate.networkFamily ?? candidate.candidateType),
      networkFamilyLabel: networkFamilyLabel(candidate.networkFamily ?? candidate.candidateType),
      confidence: numberOrNull(candidate.confidence ?? candidate.score),
      mediaType: candidate.mediaType ?? candidate.media ?? candidate.networkFamily
        ?? candidate.candidateType ?? 'unmapped',
    }]
  }).sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'id'))
}

function normalizeSuggestedLinks(candidates) {
  return candidates.map((candidate) => ({
    ...candidate,
    id: String(candidate.candidateId),
    status: 'suggested',
    relationStatus: 'suggested',
    verificationStatus: 'suggested',
    relationType: candidate.relationType ?? candidate.candidateType ?? 'suggested-connection',
    direction: normalizeDirection(candidate.direction),
    directed: normalizeDirection(candidate.direction) !== 'undirected',
    networkFamily: normalizeNetworkFamily(candidate.networkFamily ?? candidate.candidateType),
    networkFamilyLabel: networkFamilyLabel(candidate.networkFamily ?? candidate.candidateType),
    networkColor: candidate.networkColor
      ?? networkFamilyColor(candidate.networkFamily ?? candidate.candidateType),
    pathAssetIds: [...new Set([
      ...(candidate.pathAssetIds ?? []),
      ...(candidate.pathAssetId ? [candidate.pathAssetId] : []),
    ])],
    sourceGeometryIds: [...new Set([
      ...(candidate.sourceGeometryIds ?? []),
      ...(candidate.sourceGeometryId ? [candidate.sourceGeometryId] : []),
    ])],
    confidence: numberOrNull(candidate.confidence ?? candidate.score),
    evidence: Array.isArray(candidate.evidence) ? candidate.evidence : [],
    provenance: candidate.provenance ?? candidate.relationSource ?? 'candidate evidence',
  }))
}

function normalizeUnresolved(items, scopedIds, area, {
  branchId,
  datasetVersionId,
  nodeById,
}) {
  return (Array.isArray(items) ? items : []).flatMap((item, index) => {
    if (!matchesScope(item, { branchId, datasetVersionId })) return []
    const sourceId = item.sourceAssetId ?? item.sourcePathAssetId ?? item.sourceEndpointId
    const itemArea = item.areaKey
      ?? item.locationGroupKey
      ?? nodeById.get(sourceId)?.areaKey
      ?? null
    // An unresolved record without an area is branch-level evidence. Do not
    // repeat it inside every selected-area detail view; it remains visible in
    // the all-area administrator projection where the `Lainnya` section can
    // provide the correct context.
    if (area && (!itemArea || itemArea !== area)) return []
    return [{
      ...item,
      unresolvedId: item.unresolvedId ?? item.sourceEndpointId
        ?? `unresolved:${sourceId ?? 'path'}:${index}`,
      sourcePathAssetId: sourceId ?? item.sourcePathAssetId ?? null,
      areaKey: itemArea || 'lainnya',
      reason: item.reason ?? 'endpoint_without_safe_target',
    }]
  }).sort(compareUnresolved)
}

function normalizeMountingGroups({
  poleGroups = [],
  mountingRelations = [],
  assetById = new Map(),
  nodeById,
}) {
  const groups = new Map()

  const recordById = (id) => assetById.get(id) ?? nodeById.get(id) ?? null

  const addGroup = (hostId, childIds = [], relationIds = []) => {
    if (!hostId) return
    const host = recordById(hostId)
    if (host && classifyTopologyNode(host) !== 'physical-mount') return
    const scopedChildren = childIds
      .filter((id) => id && id !== hostId && nodeById.has(id))
    if (!scopedChildren.length) return
    const id = `pole-group:${hostId}`
    const current = groups.get(id) ?? {
      id,
      hostId,
      childIds: [],
      relationIds: [],
    }
    current.childIds = [...new Set([...current.childIds, ...scopedChildren])].sort(compareIds)
    current.relationIds = [...new Set([...current.relationIds, ...relationIds.filter(Boolean)])]
      .sort(compareIds)
    groups.set(id, current)
  }

  ;(Array.isArray(poleGroups) ? poleGroups : []).forEach((group) => {
    const hostId = group?.poleAssetId ?? group?.hostAssetId ?? group?.targetAssetId
    const childIds = (group?.assetIds ?? []).filter((id) => id !== hostId)
    addGroup(hostId, childIds, (group?.relations ?? []).map((relation) => (
      relation?.relationId ?? relation?.id
    )))
  })

  ;(Array.isArray(mountingRelations) ? mountingRelations : []).forEach((relation) => {
    const relationType = String(relation?.relationType ?? relation?.type ?? '').toLowerCase()
    if (['rejected', 'revoked'].includes(String(relation?.verificationStatus ?? '').toLowerCase())) return
    if (relationType && !['mounted_on', 'mounting', 'physical_mounting'].includes(relationType)) return
    const childId = relation?.sourceAssetId ?? relation?.sourceNodeId ?? relation?.assetId
    const hostId = relation?.targetAssetId ?? relation?.targetNodeId
      ?? relation?.poleAssetId ?? relation?.hostAssetId
    addGroup(hostId, [childId], [relation?.relationId ?? relation?.id])
  })

  nodeById.forEach((node) => {
    if (node.mountedOnAssetId) addGroup(node.mountedOnAssetId, [node.id])
  })
  assetById.forEach((asset) => {
    if (Array.isArray(asset.mountedAssetIds)) addGroup(asset.id, asset.mountedAssetIds)
  })

  return [...groups.values()]
    .map((group) => ({
      ...group,
      assetIds: [group.hostId, ...group.childIds],
      hostName: recordById(group.hostId)?.name ?? group.hostId,
      hostType: recordById(group.hostId)?.type
        ?? recordById(group.hostId)?.assetType
        ?? 'Tiang',
      diagramClass: 'physical-mount',
      childCount: group.childIds.length,
      childAssets: group.childIds.map((id) => recordById(id)).filter(Boolean),
    }))
    .sort((left, right) => left.hostName.localeCompare(right.hostName, 'id')
      || left.hostId.localeCompare(right.hostId, 'id'))
}

function connectedComponents(nodes, adjacency) {
  const visited = new Set()
  const components = []
  nodes.map(({ id }) => id).sort(compareIds).forEach((start) => {
    if (visited.has(start)) return
    const queue = [start]
    const component = []
    while (queue.length) {
      const current = queue.shift()
      if (visited.has(current)) continue
      visited.add(current)
      component.push(current)
      ;(adjacency.get(current) ?? [])
        .map(({ id }) => id)
        .sort(compareIds)
        .forEach((next) => {
          if (!visited.has(next)) queue.push(next)
        })
    }
    components.push(component.sort(compareIds))
  })
  return components
}

function calculateDepths(rootId, nodes, adjacency) {
  const depths = new Map([[rootId, 0]])
  const queue = [rootId]
  while (queue.length) {
    const current = queue.shift()
    ;(adjacency.get(current) ?? [])
      .map(({ id }) => id)
      .sort(compareIds)
      .forEach((next) => {
        if (depths.has(next)) return
        depths.set(next, depths.get(current) + 1)
        queue.push(next)
      })
  }
  nodes.forEach((node) => {
    if (!depths.has(node.id)) depths.set(node.id, Math.max(...depths.values(), 0) + 1)
  })
  return depths
}

function chooseComponentRoot({ nodes, edges, verifiedRootIds }) {
  const degree = new Map(nodes.map(({ id }) => [id, 0]))
  edges.forEach((edge) => {
    degree.set(edge.sourceId, degree.get(edge.sourceId) + 1)
    degree.set(edge.targetId, degree.get(edge.targetId) + 1)
  })
  const verified = nodes.filter(({ id }) => verifiedRootIds.has(id))
  if (verified.length) {
    return { id: verified.sort(compareNodes)[0].id, verified: true, reason: 'verified topology root' }
  }
  const roleRoots = nodes.filter((node) => ['root', 'core'].includes(node.topologyRole))
  if (roleRoots.length) {
    return { id: roleRoots.sort(compareNodes)[0].id, verified: false, reason: 'topology role anchor' }
  }
  const serverRoots = nodes.filter((node) => (
    ['server', 'nvr'].includes(node.topologyRole)
      || node.iconType === 'server-rack-core'
  ))
  if (serverRoots.length) {
    serverRoots.sort((left, right) => (
      (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0)
        || left.id.localeCompare(right.id, 'id')
    ))
    return { id: serverRoots[0].id, verified: false, reason: 'server/core layout anchor' }
  }
  const junctionRoots = nodes.filter((node) => node.topologyRole === 'junction')
  if (junctionRoots.length) {
    junctionRoots.sort((left, right) => (
      (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0)
        || left.id.localeCompare(right.id, 'id')
    ))
    return { id: junctionRoots[0].id, verified: false, reason: 'highest-degree junction anchor' }
  }
  const semantic = nodes.filter((node) => ROLE_PRIORITY[node.topologyRole] !== undefined)
  if (semantic.length) {
    semantic.sort((left, right) => roleRank(left) - roleRank(right)
      || (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0)
      || left.id.localeCompare(right.id, 'id'))
    return { id: semantic[0].id, verified: false, reason: 'semantic anchor' }
  }
  const fallback = [...nodes].sort((left, right) => (
    (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0)
    || left.id.localeCompare(right.id, 'id')
  ))[0]
  return { id: fallback.id, verified: false, reason: 'deterministic fallback anchor' }
}

function componentIdFor(graph, nodeIds, index) {
  const source = (graph?.components ?? []).find((component) => (
    (component.nodeIds ?? []).some((id) => nodeIds.includes(id))
  ))
  return source?.componentId ?? source?.id ?? `component:${String(index + 1).padStart(4, '0')}`
}

function matchesScope(record, { branchId, datasetVersionId }) {
  if (!record || typeof record !== 'object') return false
  const recordBranch = record.branchId ?? record.branch
  const recordDataset = record.datasetVersionId ?? record.datasetId
  return (!branchId || !recordBranch || recordBranch === branchId)
    && (!datasetVersionId || !recordDataset || recordDataset === datasetVersionId)
}

function areaKeyFor(value) {
  if (!value) return 'lainnya'
  return String(value.locationGroupKey
    ?? value.areaKey
    ?? value.areaId
    ?? value.facilityAreaId
    ?? value.area
    ?? 'lainnya') || 'lainnya'
}

function areaNameFor(asset, locationGroups) {
  return asset?.locationGroupName
    ?? locationGroups.find(({ key }) => key === areaKeyFor(asset))?.name
    ?? areaNameForKey(areaKeyFor(asset), locationGroups)
}

function areaNameForKey(key, locationGroups) {
  return locationGroups.find(({ key: candidate }) => candidate === key)?.name
    ?? (key === 'lainnya' ? 'Lainnya' : String(key).replaceAll('-', ' '))
}

function areaOrder(key, locationGroups) {
  const index = locationGroups.findIndex(({ key: candidate }) => candidate === key)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

function assetIdFor(value) {
  return value?.canonicalAssetId ?? value?.assetId ?? value?.id ?? null
}

function networkFamilyFor(value) {
  return normalizeNetworkFamily(value?.networkFamily ?? value?.category ?? value?.type)
}

function isCoreRole(role, type = '') {
  const source = `${role} ${type}`.toLowerCase()
  return ['root', 'core', 'server', 'nvr', 'router'].some((value) => source.includes(value))
}

function isEndpointRole(role, type = '') {
  const source = `${role} ${type}`.toLowerCase()
  return role === 'endpoint' || /cctv|camera|access point|printer|peripheral/.test(source)
}

function roleRank(node) {
  return ROLE_PRIORITY[node.topologyRole] ?? 50
}

function normalizeRootIds(roots, scopedIds) {
  return new Set((Array.isArray(roots) ? roots : [])
    .map((root) => typeof root === 'string' ? root : assetIdFor(root))
    .filter((id) => scopedIds.has(id)))
}

function normalizeDirection(value) {
  const source = String(value ?? 'undirected').trim().toLowerCase().replaceAll('-', '_')
  return ['source_to_target', 'target_to_source', 'bidirectional', 'undirected'].includes(source)
    ? source
    : 'undirected'
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function matchesSearch(asset, graphNode, query) {
  const normalized = normalizeSearch(query)
  return !normalized || searchScore({ ...asset, ...graphNode }, normalized) > 0
}

function searchScore(value, normalized) {
  const haystack = [
    value?.id,
    value?.assetId,
    value?.canonicalAssetId,
    value?.name,
    value?.type,
    value?.assetType,
    value?.location,
    value?.locationGroupName,
    value?.hostname,
    value?.hostName,
    value?.provenance,
  ].filter(Boolean).join(' ').toLowerCase()
  if (!haystack.includes(normalized)) return 0
  if (String(value?.id ?? '').toLowerCase() === normalized) return 100
  if (String(value?.name ?? '').toLowerCase().startsWith(normalized)) return 80
  return haystack.startsWith(normalized) ? 60 : 40
}

function normalizeSearch(value) {
  return String(value ?? '').trim().toLowerCase()
}

function shouldDimNode(node, { search, selectedFamilies, traceAssets }) {
  const hasSearch = normalizeSearch(search).length > 0
  const familyFiltered = selectedFamilies?.size > 0
    && !selectedFamilies.has(node.networkFamily)
  const traceActive = traceAssets?.size > 0
  return (hasSearch && !node.matched) || (familyFiltered && !traceActive)
}

function shouldDimEdge(edge, { search, selectedFamilies, traceAssets, traceEdges }) {
  const familyFiltered = selectedFamilies?.size > 0
    && !selectedFamilies.has(edge.networkFamily)
  const traceActive = traceAssets?.size > 0
  const traceEdge = traceAssets?.has(edge.sourceId) && traceAssets?.has(edge.targetId)
  const explicitTraceEdge = traceEdges?.has(edge.id)
  return (familyFiltered && !traceActive) || (traceActive && !traceEdge && !explicitTraceEdge)
}

function uniqueNetworkFamilies(nodes, edges) {
  return [...new Set([
    ...nodes.map(({ networkFamily }) => networkFamily),
    ...edges.map(({ networkFamily }) => networkFamily),
  ])]
    .filter(Boolean)
    .sort((left, right) => familyOrder(left) - familyOrder(right) || left.localeCompare(right, 'id'))
    .map((id) => ({ id, label: networkFamilyLabel(id), color: networkFamilyColor(id) }))
}

function familyOrder(value) {
  const index = NETWORK_FAMILY_ORDER.indexOf(value)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

function topologyGraphDiagnostics({ nodes, edges, graph }) {
  const nodeIds = new Set(nodes.map(({ id }) => id))
  const invalidEdges = (Array.isArray(graph?.edges) ? graph.edges : []).filter((edge) => (
    isConfirmedTopologyEdge(edge)
      && (!nodeIds.has(edge.sourceAssetId ?? edge.sourceNodeId ?? edge.sourceId)
        || !nodeIds.has(edge.targetAssetId ?? edge.targetNodeId ?? edge.targetId))
  ))
  return {
    invalid: Boolean(graph?.validation?.errorCount || graph?.topologyValidation?.errorCount),
    invalidEdgeCount: invalidEdges.length,
    message: invalidEdges.length
      ? 'Sebagian relasi terkonfirmasi tidak memiliki endpoint dalam scope aktif.'
      : null,
    confirmedEdgeCount: edges.length,
  }
}

function compareIds(left, right) {
  return String(left).localeCompare(String(right), 'id')
}

function compareNodes(left, right) {
  return roleRank(left) - roleRank(right)
    || String(left.name ?? '').localeCompare(String(right.name ?? ''), 'id')
    || compareIds(left.id, right.id)
}

function compareEdges(left, right) {
  return compareIds(left.id, right.id)
}

function compareUnresolved(left, right) {
  return compareIds(left.unresolvedId, right.unresolvedId)
}

function unorderedPair(left, right) {
  return [left, right].sort(compareIds).join('|')
}
