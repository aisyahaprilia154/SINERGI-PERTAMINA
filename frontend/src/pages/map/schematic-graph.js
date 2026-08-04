import { createAssetLabelIndex } from '../../domain/asset-labels.js'
import { evaluateRelationReadiness, isConfirmedRelation } from '../../domain/relation-readiness.js'
import { edgeMatchesAssetScope, selectConfirmedComponent } from './topology-scope-builder.js'

export function buildSchematicGraph({
  assets = [],
  networks = [],
  topologyGraph = null,
  selectedNetworkIds = [],
  focusedAssetId = null,
  tracePath = [],
  traceRelations = [],
  scope = 'network',
}) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const networkById = new Map(networks.map((network) => [network.id, network]))
  const labelById = createAssetLabelIndex(assets)
  const hasTopology = Array.isArray(topologyGraph?.edges)
  const allEdges = hasTopology
    ? topologyGraph.edges.filter(isConfirmedRelation).map(normalizeTopologyEdge)
    : networks.flatMap((network) => (network.edges || []).map(([sourceId, targetId], index) => ({
      id: `${network.id}:${sourceId}:${targetId}:${index}`,
      sourceId,
      targetId,
      networkId: network.id,
      relationType: 'explicit-network-edge',
      relationSource: 'explicit',
      verificationStatus: 'confirmed',
      order: index,
    })))
  const validEdges = deduplicateEdges(allEdges)
    .filter((edge) => edgeMatchesAssetScope(edge, assetById))
  const readiness = evaluateRelationReadiness({
    assets,
    topologyGraph: {
      edges: validEdges.map((edge) => ({
        ...edge,
        sourceNodeId: edge.sourceId,
        targetNodeId: edge.targetId,
        verificationStatus: 'confirmed',
      })),
      pendingEdges: topologyGraph?.pendingEdges,
    },
    selectedAssetId: focusedAssetId,
  })

  if (scope === 'trace') {
    if (tracePath.length < 2) return emptyGraph('trace', 0, 'Jalur terpilih belum tersedia. Jalankan tracing terlebih dahulu.')
    const traceIds = tracePath.filter((id) => assetById.has(id))
    const edges = buildTraceEdges(traceIds, traceRelations, validEdges, networkById)
    return finalizeGraph({
      mode: 'trace',
      nodeIds: traceIds,
      edges,
      anchorAssetId: traceIds[0],
      assets,
      assetById,
      networkById,
      networks,
      labelById,
      readiness,
      title: 'Jalur koneksi terpilih',
    })
  }

  const selectedIds = new Set(selectedNetworkIds)
  let candidateEdges = selectedIds.size
    ? validEdges.filter((edge) => selectedIds.has(edge.networkId))
    : validEdges
  if (!candidateEdges.length && validEdges.length) candidateEdges = validEdges

  const component = selectConfirmedComponent(candidateEdges, focusedAssetId)

  if (!candidateEdges.length || component.length < 2) {
    return emptyGraph(
      'network',
      assets.length,
      `${assets.length} aset ditemukan, tetapi belum ada relasi yang telah dikonfirmasi.`,
      readiness,
    )
  }

  const componentIds = new Set(component)
  const componentEdges = candidateEdges.filter((edge) => (
    componentIds.has(edge.sourceId) && componentIds.has(edge.targetId)
  ))
  const anchorAssetId = focusedAssetId && componentIds.has(focusedAssetId)
    ? focusedAssetId
    : chooseAnchor(component, componentEdges, assetById)
  const selectedNetwork = networkById.get(componentEdges[0]?.networkId)
    || chooseNetworkForComponent(component, networks)
  const networkLabel = (selectedNetwork?.shortName || selectedNetwork?.name || 'Aset')
    .replace(/^Jaringan\s+/i, '')

  return finalizeGraph({
    mode: 'network',
    nodeIds: component,
    edges: componentEdges,
    anchorAssetId,
    assets,
    assetById,
    networkById,
    networks,
    labelById,
    readiness,
    title: `Topologi Jaringan ${networkLabel}`,
  })
}

function finalizeGraph({ mode, nodeIds, edges, anchorAssetId, assets, assetById, networkById, networks, labelById, readiness, title }) {
  const included = new Set(nodeIds)
  const connectedIds = new Set(edges.flatMap(({ sourceId, targetId }) => [sourceId, targetId]))
  const nodes = nodeIds.filter((id) => connectedIds.has(id)).map((id, index) => {
    const asset = assetById.get(id)
    const labels = labelById.get(id)
    return {
      id,
      assetId: id,
      name: labels.displayName,
      shortName: labels.shortLabel,
      shortLabel: labels.shortLabel,
      type: deriveAssetType(asset),
      category: resolveCategory(asset, networks),
      location: asset.location || '',
      ip: normalizeIp(asset.ip),
      status: asset.status || '',
      isAnchor: id === anchorAssetId,
      isConnector: isConnectorType(asset.type),
      order: mode === 'trace' ? index : null,
    }
  })
  const normalizedEdges = edges
    .filter((edge) => included.has(edge.sourceId) && included.has(edge.targetId))
    .map((edge, index) => {
      const network = networkById.get(edge.networkId)
      return {
        ...edge,
        id: edge.id || `relation:${edge.sourceId}:${edge.targetId}:${index}`,
        networkName: network?.shortName || network?.name || 'Topologi terkonfirmasi',
        networkColor: network?.color || '#17385f',
        networkType: network?.type || 'Relasi',
        verificationStatus: 'confirmed',
      }
    })
  const isolatedNodes = assets.filter(({ id }) => !connectedIds.has(id)).map((asset) => ({
    id: asset.id,
    name: labelById.get(asset.id)?.displayName,
    shortLabel: labelById.get(asset.id)?.shortLabel,
    type: deriveAssetType(asset),
  }))
  return {
    status: normalizedEdges.length ? 'ready' : 'empty',
    mode,
    title,
    anchorAssetId,
    nodes,
    edges: normalizedEdges,
    isolatedNodes,
    readiness,
    summary: buildSummary(nodes, normalizedEdges),
  }
}

function buildTraceEdges(tracePath, traceRelations, confirmedEdges, networkById) {
  return tracePath.slice(1).map((targetId, index) => {
    const sourceId = tracePath[index]
    const relation = traceRelations[index]
    const confirmed = confirmedEdges.find((edge) => (
      (edge.sourceId === sourceId && edge.targetId === targetId)
      || (edge.sourceId === targetId && edge.targetId === sourceId)
    ))
    return {
      ...(confirmed || {}),
      sourceId,
      targetId,
      id: relation?.edgeId || relation?.id || confirmed?.id,
      networkId: relation?.networkId || confirmed?.networkId || [...networkById.keys()][0] || null,
      relationType: relation?.relationType || confirmed?.relationType || 'explicit-network-edge',
      relationSource: relation?.relationSource || confirmed?.relationSource || 'admin',
      verificationStatus: 'confirmed',
      order: index,
    }
  })
}

function normalizeTopologyEdge(edge, index) {
  return {
    ...edge,
    id: edge.id || edge.edgeId,
    sourceId: edge.sourceNodeId ?? edge.sourceId,
    targetId: edge.targetNodeId ?? edge.targetId,
    order: edge.order ?? index,
  }
}

function chooseAnchor(nodeIds, edges, assetById) {
  const degree = new Map(nodeIds.map((id) => [id, 0]))
  edges.forEach(({ sourceId, targetId }) => {
    degree.set(sourceId, (degree.get(sourceId) || 0) + 1)
    degree.set(targetId, (degree.get(targetId) || 0) + 1)
  })
  return [...nodeIds].sort((leftId, rightId) => {
    const priority = anchorPriority(assetById.get(leftId)) - anchorPriority(assetById.get(rightId))
    if (priority) return priority
    const degrees = (degree.get(rightId) || 0) - (degree.get(leftId) || 0)
    return degrees || leftId.localeCompare(rightId)
  })[0]
}

function anchorPriority(asset = {}) {
  const value = `${asset.type || ''} ${asset.name || ''}`.toLowerCase()
  if (/nvr|server/.test(value)) return 0
  if (/core.*switch|switch.*core/.test(value)) return 1
  if (/\botb\b/.test(value)) return 2
  if (/junction|\bjb\b/.test(value)) return 3
  return 4
}

function chooseNetworkForComponent(componentIds, networks) {
  const included = new Set(componentIds)
  return [...networks].sort((left, right) => {
    const rightCount = (right.nodeIds || []).filter((id) => included.has(id)).length
    const leftCount = (left.nodeIds || []).filter((id) => included.has(id)).length
    return rightCount - leftCount || String(left.id).localeCompare(String(right.id))
  })[0]
}

function deriveAssetType(asset = {}) {
  const value = `${asset.type || ''} ${asset.name || ''}`.toLowerCase()
  if (/\bnvr\b/.test(value)) return 'NVR / Server'
  if (/\bserver\b/.test(value)) return 'Server'
  if (/core.*switch|switch.*core/.test(value)) return 'Core switch'
  if (/\botb\b/.test(value)) return 'OTB'
  return asset.type || 'Aset'
}

function buildSummary(nodes, edges) {
  const typeCounts = new Map()
  nodes.forEach((node) => typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1))
  return {
    nodeCount: nodes.length,
    connectionCount: edges.length,
    typeCounts: [...typeCounts.entries()].map(([type, count]) => ({ type, count })),
  }
}

function emptyGraph(mode, nodeCount, message, readiness = null) {
  return { status: 'empty', mode, nodes: [], edges: [], isolatedNodes: [], nodeCount, message, readiness }
}

function deduplicateEdges(edges) {
  const seen = new Set()
  return edges.filter((edge) => {
    if (!edge.sourceId || !edge.targetId || edge.sourceId === edge.targetId) return false
    const key = `${edge.networkId || ''}|${[edge.sourceId, edge.targetId].sort().join('|')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeIp(ip) {
  return !ip || ['—', '-'].includes(ip) ? '' : ip
}

function resolveCategory(asset, networks) {
  const source = `${asset.category || ''} ${asset.type || ''}`.toLowerCase()
  if (/cctv|nvr|junction/.test(source)) return 'cctv'
  if (/fiber|otb/.test(source)) return 'fiber-optic'
  if (/printer|peripheral/.test(source)) return 'peripheral'
  if (/lan|switch|server/.test(source)) return 'lan'
  const networkTypes = networks.filter((network) => network.nodeIds?.includes(asset.id))
    .map((network) => network.type).join(' ').toLowerCase()
  if (networkTypes.includes('cctv')) return 'cctv'
  if (networkTypes.includes('fiber')) return 'fiber-optic'
  if (networkTypes.includes('lan')) return 'lan'
  return 'infrastructure'
}

function isConnectorType(type = '') {
  return /switch|junction|otb|server|nvr|router/i.test(type)
}
