import {
  buildSelectedAssetRelationGraph,
  isConfirmedTopologyEdge,
  normalizeTopologyEdge,
} from './selected-asset-relation-graph.js'

export { buildSelectedAssetRelationGraph }

export function buildSchematicGraph({
  assets,
  networks,
  topologyGraph = null,
  topologyCandidates = [],
  selectedNetworkIds = [],
  focusedAssetId = null,
  tracePath = [],
  traceRelations = [],
  scope = 'auto',
}) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const networkById = new Map(networks.map((network) => [network.id, network]))
  const selectedIds = new Set(selectedNetworkIds)
  const topologyEdges = Array.isArray(topologyGraph?.edges)
    ? topologyGraph.edges.filter(isConfirmedTopologyEdge).map((edge, index) => {
      const normalized = normalizeTopologyEdge(edge)
      return {
      sourceId: normalized.sourceId,
      targetId: normalized.targetId,
      id: edge.id,
      networkId: edge.networkId || null,
      relationType: edge.relationType,
      relationSource: edge.relationSource,
      sourceGeometryId: edge.sourceGeometryId,
      sourceGeometryIds: edge.sourceGeometryIds ?? [],
      pathAssetIds: edge.pathAssetIds ?? [],
      order: index,
      }
    })
    : []
  const hasTopology = topologyEdges.length > 0
  const topologyNodeIds = new Set(
    (topologyGraph?.nodes ?? []).map((node) => node.canonicalAssetId ?? node.assetId ?? node.id),
  )
  const topologyAssets = () => uniqueIds([...topologyNodeIds])
    .filter((assetId) => assetById.has(assetId))
  const evidenceEdges = buildDiagramEvidenceEdges({
    candidates: topologyCandidates,
    assetById,
  })

  let mode = 'network'
  let anchorAssetId = null
  let nodeIds = []
  let sourceEdges = []
  let categorySummary = null
  const selectedScope = scope === 'selected' || scope === 'relation'

  if (selectedScope) {
    const selectedGraph = buildSelectedAssetRelationGraph({
      selectedAssetId: focusedAssetId,
      topologyGraph,
      assets,
    })
    if (selectedGraph.status !== 'ready') {
      return {
        status: 'empty',
        message: selectedGraph.message,
        mode: 'selected',
        anchorAssetId: focusedAssetId,
        nodes: [],
        edges: [],
        neighborCount: selectedGraph.neighborCount,
        relationCount: selectedGraph.relationCount,
      }
    }
    mode = 'selected'
    anchorAssetId = focusedAssetId
    nodeIds = selectedGraph.nodes.map((asset) => asset.id)
    sourceEdges = selectedGraph.edges
    categorySummary = selectedGraph.categorySummary
  } else if (scope === 'trace' && tracePath.length < 2) {
    return {
      status: 'empty',
      message: 'Jalur terpilih belum tersedia. Jalankan tracing terlebih dahulu.',
      mode: 'trace',
      nodes: [],
      edges: [],
    }
  }

  if ((scope === 'auto' || scope === 'trace') && tracePath.length > 1) {
    mode = 'trace'
    anchorAssetId = tracePath[0]
    nodeIds = tracePath.filter((assetId) => assetById.has(assetId))
    sourceEdges = buildTraceEdges(tracePath, traceRelations, networks)
  } else if (scope === 'all-assets') {
    mode = 'all-assets'
    nodeIds = uniqueIds(assets.map(({ id }) => id))
    sourceEdges = [
      ...(hasTopology
        ? topologyEdges
        : networks.flatMap((network) =>
        (network.edges || []).map(([sourceId, targetId], index) => ({
          sourceId,
          targetId,
          networkId: network.id,
          relationType: 'explicit-network-edge',
          relationSource: 'explicit',
          order: index,
        })),
        )),
      ...evidenceEdges,
    ]
    anchorAssetId = chooseCoreAnchor(nodeIds, sourceEdges, assetById)
  } else if (scope === 'full-map') {
    mode = 'full-map'
    nodeIds = hasTopology
      ? topologyAssets()
      : uniqueIds(assets.map(({ id }) => id))
    sourceEdges = hasTopology
      ? topologyEdges
      : networks.flatMap((network) =>
        (network.edges || []).map(([sourceId, targetId], index) => ({
          sourceId,
          targetId,
          networkId: network.id,
          relationType: 'explicit-network-edge',
          relationSource: 'explicit',
          order: index,
        })),
      )
    anchorAssetId = chooseCoreAnchor(nodeIds, sourceEdges, assetById)
  } else if ((scope === 'auto' || scope === 'focus')
    && focusedAssetId && assetById.has(focusedAssetId)) {
    mode = 'focus'
    anchorAssetId = focusedAssetId
    const directEdges = hasTopology
      ? topologyEdges.filter(({ sourceId, targetId }) => (
        sourceId === focusedAssetId || targetId === focusedAssetId
      ))
      : networks.flatMap((network) =>
        (network.edges || [])
          .filter(([sourceId, targetId]) =>
            sourceId === focusedAssetId || targetId === focusedAssetId,
          )
          .map(([sourceId, targetId], index) => ({
            sourceId,
            targetId,
            networkId: network.id,
            relationType: 'explicit-network-edge',
            relationSource: 'explicit',
            order: index,
          })),
      )
    nodeIds = uniqueIds([
      focusedAssetId,
      ...directEdges.flatMap((edge) => [edge.sourceId, edge.targetId]),
    ]).filter((assetId) => assetById.has(assetId)
      && (!hasTopology || topologyNodeIds.has(assetId)))
    sourceEdges = directEdges
  } else if (!selectedScope) {
    const selectedNetworks = networks.filter((network) => selectedIds.has(network.id))
    nodeIds = uniqueIds(selectedNetworks.flatMap((network) => network.nodeIds || []))
      .filter((assetId) => assetById.has(assetId)
        && (!hasTopology || topologyNodeIds.has(assetId)))
    sourceEdges = hasTopology
      ? topologyEdges.filter(({ networkId }) => selectedIds.has(networkId))
      : selectedNetworks.flatMap((network) =>
        (network.edges || []).map(([sourceId, targetId], index) => ({
          sourceId,
          targetId,
          networkId: network.id,
          relationType: 'explicit-network-edge',
          relationSource: 'explicit',
          order: index,
        })),
      )
    anchorAssetId = chooseCoreAnchor(nodeIds, sourceEdges, assetById)
  }

  if (!nodeIds.length) {
    return {
      status: 'empty',
      message: 'Tidak ada aset yang dapat digunakan untuk membuat diagram.',
      mode,
      nodes: [],
      edges: [],
    }
  }

  const includedIds = new Set(nodeIds)
  const edges = deduplicateEdges(sourceEdges)
    .filter((edge) => includedIds.has(edge.sourceId) && includedIds.has(edge.targetId))
    .map((edge, index) => {
      const network = networkById.get(edge.networkId)
      return {
        id: edge.id || `${edge.networkId || 'relation'}:${edge.sourceId}:${edge.targetId}:${index}`,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        networkId: edge.networkId || null,
        networkName: edge.networkName
          || network?.shortName
          || network?.name
          || 'Topologi terkonfirmasi',
        networkColor: edge.networkColor || network?.color || null,
        networkType: edge.networkType || network?.type || 'Relasi',
        relationType: edge.relationType || 'explicit-network-edge',
        relationSource: edge.relationSource || 'explicit',
        relationStatus: edge.relationStatus || 'confirmed',
        confidence: edge.confidence ?? null,
        distanceMeters: edge.distanceMeters ?? null,
        candidateId: edge.candidateId ?? null,
        evidence: edge.evidence ?? [],
        sourceGeometryId: edge.sourceGeometryId,
        sourceGeometryIds: edge.sourceGeometryIds ?? [],
        pathAssetIds: edge.pathAssetIds ?? [],
        order: edge.order ?? index,
      }
    })

  const evidenceByNode = buildNodeEvidenceIndex({
    nodeIds,
    edges,
    candidates: topologyCandidates,
  })
  const nodes = nodeIds.map((assetId, index) => {
    const asset = assetById.get(assetId)
    const nodeEvidence = evidenceByNode.get(assetId)
    return {
      id: asset.id,
      assetId: asset.id,
      name: asset.name,
      shortName: shortenName(asset.name),
      type: asset.type,
      category: resolveCategory(asset, networks),
      location: asset.location || '',
      ip: normalizeIp(asset.ip),
      status: asset.status || '',
      sourcePosition: getSourceDisplayPosition(asset),
      isAnchor: asset.id === anchorAssetId,
      isConnector: isConnectorType(asset.type),
      resolutionStatus: nodeEvidence?.resolutionStatus ?? 'unresolved',
      evidenceCount: nodeEvidence?.evidenceCount ?? 0,
      candidateCount: nodeEvidence?.candidateCount ?? 0,
      order: mode === 'trace' ? index : null,
    }
  })

  const diagnostics = mode === 'all-assets'
    ? buildDiagramDiagnostics(nodes, edges)
    : null
  return {
    status: 'ready',
    mode,
    anchorAssetId,
    nodes,
    edges,
    sourceBounds: getSourceDisplayBounds(assets),
    neighborCount: mode === 'selected' ? Math.max(0, nodes.length - 1) : undefined,
    relationCount: edges.length,
    ...(categorySummary ? { categorySummary } : {}),
    isolatedNodeIds: mode === 'all-assets'
      ? nodes.filter((node) => !edges.some((edge) => (
        edge.sourceId === node.id || edge.targetId === node.id
      ))).map((node) => node.id)
      : [],
    ...(diagnostics ? { diagnostics } : {}),
    title: getDiagramTitle(mode, nodes, networkById, selectedIds),
  }
}

export function buildDiagramEvidenceEdges({ candidates = [], assetById = new Map() } = {}) {
  const edges = []
  candidates.forEach((candidate) => {
    const relationStatus = diagramCandidateStatus(candidate)
    if (!relationStatus) return
    const shared = {
      candidateId: candidate.candidateId,
      networkId: candidate.networkFamily
        ? `evidence:${candidate.networkFamily}`
        : 'evidence:unknown',
      networkName: networkFamilyLabel(candidate.networkFamily),
      networkType: candidate.networkFamily || 'Relasi',
      relationType: candidate.candidateType || candidate.relationKind || 'spatial-evidence',
      relationSource: candidate.candidateType || 'spatial_inference',
      relationStatus,
      confidence: Number.isFinite(candidate.score) ? candidate.score : null,
      distanceMeters: Number.isFinite(candidate.distanceMeters)
        ? candidate.distanceMeters
        : null,
      sourceGeometryIds: candidate.sourceGeometryIds ?? [],
      pathAssetIds: [candidate.sourcePathAssetId, candidate.targetPathAssetId].filter(Boolean),
      evidence: candidate.evidence ?? [],
    }

    if (candidate.relationKind === 'device_edge') {
      if (relationStatus !== 'recommended') return
      addEvidenceEdge(edges, assetById, {
        ...shared,
        sourceId: candidate.sourceAssetId ?? candidate.sourcePathAssetId,
        targetId: candidate.targetAssetId,
      })
      return
    }

    if (candidate.relationKind === 'path_continuation') {
      addEvidenceEdge(edges, assetById, {
        ...shared,
        sourceId: candidate.sourcePathAssetId,
        targetId: candidate.targetPathAssetId ?? candidate.targetAssetId,
      })
      return
    }

    if (candidate.relationKind === 'path_attachment') {
      addEvidenceEdge(edges, assetById, {
        ...shared,
        sourceId: candidate.sourcePathAssetId,
        targetId: candidate.targetAssetId,
      })
      if (candidate.targetPathAssetId) {
        addEvidenceEdge(edges, assetById, {
          ...shared,
          idSuffix: 'target-path',
          sourceId: candidate.targetPathAssetId,
          targetId: candidate.targetAssetId,
        })
      }
    }
  })
  return deduplicateEvidenceEdges(edges)
}

function addEvidenceEdge(edges, assetById, edge) {
  if (!edge.sourceId || !edge.targetId || edge.sourceId === edge.targetId) return
  if (!assetById.has(edge.sourceId) || !assetById.has(edge.targetId)) return
  edges.push({
    ...edge,
    id: `${edge.candidateId || 'evidence'}:${edge.idSuffix || edges.length}`,
  })
}

function diagramCandidateStatus(candidate) {
  if (candidate.candidateStatus === 'confirmed') return 'confirmed'
  if (candidate.candidateStatus === 'candidate' && candidate.proposalStatus === 'recommended') {
    return 'recommended'
  }
  return null
}

function buildNodeEvidenceIndex({ nodeIds, edges, candidates }) {
  const included = new Set(nodeIds)
  const index = new Map(nodeIds.map((id) => [id, {
    resolutionStatus: 'unresolved',
    evidenceCount: 0,
    candidateCount: 0,
  }]))
  edges.forEach((edge) => {
    for (const id of [edge.sourceId, edge.targetId]) {
      const item = index.get(id)
      if (!item) continue
      item.evidenceCount += Math.max(1, edge.evidence?.length ?? 0)
      if (edge.relationStatus === 'confirmed') item.resolutionStatus = 'confirmed'
      else if (item.resolutionStatus !== 'confirmed') item.resolutionStatus = 'recommended'
    }
  })
  ;(candidates ?? []).forEach((candidate) => {
    const ids = candidateAssetIds(candidate).filter((id) => included.has(id))
    ids.forEach((id) => {
      const item = index.get(id)
      item.candidateCount += 1
      if (item.resolutionStatus === 'unresolved') item.resolutionStatus = 'review'
    })
  })
  return index
}

function candidateAssetIds(candidate) {
  return uniqueIds([
    candidate.sourceAssetId,
    candidate.sourcePathAssetId,
    candidate.targetAssetId,
    candidate.targetPathAssetId,
  ].filter(Boolean))
}

function buildDiagramDiagnostics(nodes, edges) {
  const countStatus = (status) => nodes.filter((node) => node.resolutionStatus === status).length
  const physicalEdges = edges.filter((edge) => edge.relationStatus === 'confirmed')
  const recommendedEdges = edges.filter((edge) => edge.relationStatus === 'recommended')
  const unresolvedNodes = nodes.filter((node) => node.resolutionStatus === 'unresolved')
  const reviewNodes = nodes.filter((node) => node.resolutionStatus === 'review')
  return {
    totalAssetCount: nodes.length,
    confirmedNodeCount: countStatus('confirmed'),
    recommendedNodeCount: countStatus('recommended'),
    reviewNodeCount: reviewNodes.length,
    unresolvedNodeCount: unresolvedNodes.length,
    confirmedEdgeCount: physicalEdges.length,
    recommendedEdgeCount: recommendedEdges.length,
    unresolvedNodes: unresolvedNodes.map((node) => ({
      assetId: node.id,
      name: node.name,
      type: node.type,
      reason: 'no_supported_evidence',
    })),
    reviewNodes: reviewNodes.map((node) => ({
      assetId: node.id,
      name: node.name,
      type: node.type,
      reason: 'candidate_requires_review',
      candidateCount: node.candidateCount,
    })),
  }
}

function deduplicateEvidenceEdges(edges) {
  const seen = new Set()
  return edges.filter((edge) => {
    const key = [edge.relationStatus, ...[edge.sourceId, edge.targetId].sort()].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function networkFamilyLabel(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'fiber_optic') return 'Fiber Optic (evidence)'
  if (normalized === 'lan') return 'LAN (evidence)'
  if (normalized === 'cctv') return 'CCTV (evidence)'
  return 'Evidence topologi'
}

function buildTraceEdges(tracePath, traceRelations, networks) {
  return tracePath.slice(1).map((targetId, index) => {
    const sourceId = tracePath[index]
    const relation = traceRelations[index]
    const fallbackNetwork = networks.find((network) =>
      (network.edges || []).some(([left, right]) =>
        (left === sourceId && right === targetId)
        || (left === targetId && right === sourceId),
      ),
    )
    return {
      sourceId,
      targetId,
      networkId: relation?.networkId || fallbackNetwork?.id || null,
      relationType: relation?.relationType || 'explicit-network-edge',
      relationSource: relation?.relationSource || 'explicit',
      sourceGeometryId: relation?.sourceGeometryId,
      sourceGeometryIds: relation?.sourceGeometryIds ?? [],
      pathAssetIds: relation?.pathAssetIds ?? [],
      id: relation?.edgeId || relation?.id,
      order: index,
    }
  })
}

function chooseCoreAnchor(nodeIds, edges, assetById) {
  const degree = new Map(nodeIds.map((assetId) => [assetId, 0]))
  edges.forEach((edge) => {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) || 0) + 1)
    degree.set(edge.targetId, (degree.get(edge.targetId) || 0) + 1)
  })

  return [...nodeIds].sort((leftId, rightId) => {
    const leftAsset = assetById.get(leftId)
    const rightAsset = assetById.get(rightId)
    const connectorDifference = Number(isConnectorType(rightAsset?.type))
      - Number(isConnectorType(leftAsset?.type))
    if (connectorDifference) return connectorDifference
    const degreeDifference = (degree.get(rightId) || 0) - (degree.get(leftId) || 0)
    if (degreeDifference) return degreeDifference
    return leftId.localeCompare(rightId)
  })[0]
}

function deduplicateEdges(edges) {
  const seen = new Set()
  return edges.filter((edge) => {
    if (!edge.sourceId || !edge.targetId || edge.sourceId === edge.targetId) return false
    const key = [
      edge.networkId || '',
      ...[edge.sourceId, edge.targetId].sort(),
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueIds(ids) {
  return [...new Set(ids)]
}

function shortenName(name = '') {
  return name.length > 22 ? `${name.slice(0, 20)}…` : name
}

function normalizeIp(ip) {
  if (!ip || ['—', 'â€”', '-'].includes(ip)) return ''
  return ip
}

function getSourceDisplayPosition(asset) {
  if (!Number.isFinite(asset.x) || !Number.isFinite(asset.y)) return null
  return { x: asset.x, y: asset.y }
}

function getSourceDisplayBounds(assets) {
  const positions = assets.map(getSourceDisplayPosition).filter(Boolean)
  if (!positions.length) return null
  return {
    minX: Math.min(...positions.map((position) => position.x)),
    maxX: Math.max(...positions.map((position) => position.x)),
    minY: Math.min(...positions.map((position) => position.y)),
    maxY: Math.max(...positions.map((position) => position.y)),
  }
}

function resolveCategory(asset, networks) {
  const source = `${asset.category || ''} ${asset.type || ''}`.toLowerCase()
  if (source.includes('cctv') || source.includes('nvr') || source.includes('junction')) return 'cctv'
  if (source.includes('fiber') || source.includes('otb')) return 'fiber-optic'
  if (source.includes('printer') || source.includes('peripheral')) return 'peripheral'
  if (source.includes('lan')) return 'lan'

  const networkTypes = networks
    .filter((network) => network.nodeIds?.includes(asset.id))
    .map((network) => network.type)
    .join(' ')
    .toLowerCase()
  if (networkTypes.includes('cctv')) return 'cctv'
  if (networkTypes.includes('fiber')) return 'fiber-optic'
  if (networkTypes.includes('lan')) return 'lan'
  return 'infrastructure'
}

function isConnectorType(type = '') {
  return ['switch', 'junction', 'otb', 'server', 'nvr', 'router']
    .some((keyword) => type.toLowerCase().includes(keyword))
}

function getDiagramTitle(mode, nodes, networkById, selectedIds) {
  if (mode === 'selected') return `Relasi ${nodes.find((node) => node.isAnchor)?.name || 'aset'}`
  if (mode === 'trace') return 'Jalur koneksi terpilih'
  if (mode === 'all-assets') return 'Seluruh aset'
  if (mode === 'full-map') return 'Peta jaringan lengkap'
  if (mode === 'focus') return `Relasi langsung ${nodes.find((node) => node.isAnchor)?.name || 'aset fokus'}`
  const selectedNames = [...selectedIds]
    .map((networkId) => networkById.get(networkId)?.shortName)
    .filter(Boolean)
  return selectedNames.length === 1 ? selectedNames[0] : 'Jaringan aset terpilih'
}
