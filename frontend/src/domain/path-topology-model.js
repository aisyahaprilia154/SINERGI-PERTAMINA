const NATURAL = new Intl.Collator('id', { numeric: true, sensitivity: 'base' })
const MAX_BLOCKS_PER_LANE = 6

export function buildPathTopologyModel({
  area = null,
  assets = [],
  graph = {},
  mountingRelations = [],
  candidates = [],
  unresolved = [],
  collapsedPoleGroupIds = new Set(),
  selectedAssetId = null,
  search = '',
  traceFrom = null,
  traceTo = null,
} = {}) {
  const uniqueAssets = deduplicateAssets(assets)
  const assetById = new Map(uniqueAssets.map((asset) => [asset.id, asset]))
  const graphNodes = normalizeGraphNodes(graph, assetById)
  graphNodes.forEach((node) => {
    if (!assetById.has(node.id)) assetById.set(node.id, node)
  })
  const pathAssetIds = new Set([...assetById.values()].filter(isCablePath).map(({ id }) => id))
  const physicalAssets = [...assetById.values()].filter((asset) => !pathAssetIds.has(asset.id))
  const physicalIds = new Set(physicalAssets.map(({ id }) => id))
  const confirmedEdges = normalizeConfirmedEdges(graph).filter((edge) => (
    assetById.has(edge.sourceId) && assetById.has(edge.targetId)
  ))
  const collapsedEdges = collapseCablePaths(confirmedEdges, pathAssetIds, physicalIds, assetById)
  const degree = calculateDegree(collapsedEdges, physicalIds)
  const confirmedMounting = mountingRelations.filter(isConfirmedMounting)
  const mountedSourceIds = new Set(confirmedMounting.map(({ sourceAssetId }) => sourceAssetId))
  const core = chooseCore(physicalAssets.filter(({ id }) => !mountedSourceIds.has(id)), degree)
  const coreId = core?.id ?? null

  const mountedChildIds = new Set()
  const poleBlocks = buildPoleBlocks({
    assets: physicalAssets,
    assetById,
    relations: confirmedMounting,
    mountedChildIds,
    collapsedPoleGroupIds,
    selectedAssetId,
    search,
  })
  const blockByAssetId = new Map()
  poleBlocks.forEach((block) => block.assetIds.forEach((id) => blockByAssetId.set(id, block.id)))

  const vertexFor = (assetId) => blockByAssetId.get(assetId) ?? assetId
  const projectedEdges = deduplicateProjectedEdges(collapsedEdges.flatMap((edge) => {
    const sourceId = vertexFor(edge.sourceId)
    const targetId = vertexFor(edge.targetId)
    if (sourceId === targetId) return []
    return [{ ...edge, sourceId, targetId, originalSourceId: edge.sourceId, originalTargetId: edge.targetId }]
  }))
  const blockIds = new Set(poleBlocks.map(({ id }) => id))
  const traversalVertices = new Set([
    ...(coreId ? [coreId] : []),
    ...blockIds,
  ])
  const traversalEdges = projectedEdges.filter(({ sourceId, targetId }) => (
    traversalVertices.has(sourceId) && traversalVertices.has(targetId)
  ))
  const { order, treeEdgeIds } = deterministicTraversal({
    rootId: coreId,
    vertexIds: [...blockIds],
    edges: traversalEdges,
    labelFor: (id) => poleBlocks.find((block) => block.id === id)?.pole.name ?? id,
  })
  const orderedBlocks = order.map((id) => poleBlocks.find((block) => block.id === id)).filter(Boolean)
  const extendedBlocks = orderedBlocks.filter(isExtendedBlock)
  const mainBlocks = orderedBlocks.filter((block) => !isExtendedBlock(block))
  const lanes = chunk(mainBlocks, MAX_BLOCKS_PER_LANE).map((blocks, index) => ({
    id: `lane-${index + 1}`,
    name: `JALUR ${String(index + 1).padStart(2, '0')}`,
    blocks,
  }))
  const laneBlockIds = new Set(mainBlocks.map(({ id }) => id))
  const crossEdges = projectedEdges.filter((edge) => (
    !treeEdgeIds.has(edge.id)
      && (laneBlockIds.has(edge.sourceId) || laneBlockIds.has(edge.targetId))
  ))

  const representedIds = new Set([
    ...(coreId ? [coreId] : []),
    ...poleBlocks.flatMap(({ assetIds }) => assetIds),
  ])
  const connectedIds = new Set(collapsedEdges.flatMap(({ sourceId, targetId }) => [sourceId, targetId]))
  const ungroupedConnectedAssets = physicalAssets
    .filter((asset) => !representedIds.has(asset.id) && connectedIds.has(asset.id))
    .sort(compareAsset)
    .map((asset) => decorateAsset(asset, { selectedAssetId, search }))
  ungroupedConnectedAssets.forEach(({ id }) => representedIds.add(id))

  const unconnectedPhysicalAssets = physicalAssets
    .filter((asset) => !representedIds.has(asset.id))
    .sort(compareAsset)
    .map((asset) => decorateAsset(asset, { selectedAssetId, search }))
  const uninstalledEndpoints = mergeUninstalledEndpoints(
    normalizeUninstalledEndpoints(unresolved, candidates, assetById),
    unconnectedPhysicalAssets,
  )
  const recommendationEdges = buildRecommendationEdges(candidates, vertexFor, assetById)
  const trace = traceBetween(projectedEdges, vertexFor(traceFrom), vertexFor(traceTo))

  return {
    area,
    core: core ? decorateAsset(core, { selectedAssetId, search }) : null,
    lanes,
    poleBlocks: mainBlocks,
    crossEdges,
    primaryEdges: projectedEdges.filter(({ id }) => treeEdgeIds.has(id)),
    recommendationEdges,
    extendedAssets: extendedBlocks,
    ungroupedConnectedAssets,
    uninstalledEndpoints,
    trace,
    stats: summarizePhysicalAssets(physicalAssets, poleBlocks),
    physicalAssetCount: physicalAssets.length,
    cablePathCount: pathAssetIds.size,
    visualizedPhysicalAssetIds: unique([
      ...(coreId ? [coreId] : []),
      ...poleBlocks.flatMap(({ assetIds }) => assetIds),
      ...ungroupedConnectedAssets.map(({ id }) => id),
      ...unconnectedPhysicalAssets.map(({ id }) => id),
    ]),
  }
}

function normalizeGraphNodes(graph, assetById) {
  return (graph.nodes ?? []).map((node) => {
    const id = node.canonicalAssetId ?? node.assetId ?? node.id
    const asset = assetById.get(id)
    return {
      ...node,
      id,
      name: asset?.name ?? node.sourceName ?? node.assetId ?? id,
      type: asset?.type ?? node.assetType ?? node.objectRole ?? 'Aset',
      category: asset?.category ?? node.category ?? node.networkFamily ?? 'unmapped',
      objectRole: asset?.objectRole ?? node.objectRole,
    }
  }).filter(({ id }) => Boolean(id))
}

function normalizeConfirmedEdges(graph) {
  return (graph.edges ?? []).flatMap((edge, index) => {
    const status = edge.verificationStatus ?? edge.relationStatus ?? 'confirmed'
    const sourceId = edge.sourceAssetId ?? edge.sourceNodeId
    const targetId = edge.targetAssetId ?? edge.targetNodeId
    if (status !== 'confirmed' || !sourceId || !targetId || sourceId === targetId) return []
    return [{
      ...edge,
      id: edge.id ?? edge.edgeId ?? `confirmed:${sourceId}:${targetId}:${index}`,
      sourceId,
      targetId,
      status: 'confirmed',
      family: connectionFamily(edge),
    }]
  })
}

function collapseCablePaths(edges, pathIds, physicalIds, assetById) {
  const adjacency = adjacencyFor(edges)
  const result = []
  const direct = edges.filter(({ sourceId, targetId }) => (
    physicalIds.has(sourceId) && physicalIds.has(targetId)
  ))
  result.push(...direct)
  const visitedPairs = new Set()
  for (const startId of [...physicalIds].sort(naturalCompare)) {
    for (const first of adjacency.get(startId) ?? []) {
      const nextId = otherEnd(first, startId)
      if (!pathIds.has(nextId)) continue
      const queue = [{ id: nextId, edges: [first], paths: [nextId] }]
      const visitedPaths = new Set([nextId])
      while (queue.length) {
        const current = queue.shift()
        for (const edge of adjacency.get(current.id) ?? []) {
          if (current.edges.includes(edge)) continue
          const targetId = otherEnd(edge, current.id)
          if (physicalIds.has(targetId)) {
            if (targetId === startId) continue
            const pair = [startId, targetId].sort(naturalCompare).join('|')
            if (visitedPairs.has(pair)) continue
            visitedPairs.add(pair)
            const evidenceEdges = [...current.edges, edge]
            result.push({
              ...evidenceEdges[0],
              id: `collapsed:${pair}`,
              sourceId: startId,
              targetId,
              pathAssetIds: unique([
                ...current.paths,
                ...evidenceEdges.flatMap((item) => item.pathAssetIds ?? []),
              ]),
              sourceEdgeIds: evidenceEdges.map(({ id }) => id),
              family: connectionFamily(evidenceEdges, current.paths.map((id) => assetById.get(id))),
            })
            continue
          }
          if (pathIds.has(targetId) && !visitedPaths.has(targetId)) {
            visitedPaths.add(targetId)
            queue.push({ id: targetId, edges: [...current.edges, edge], paths: [...current.paths, targetId] })
          }
        }
      }
    }
  }
  return deduplicatePhysicalEdges(result)
}

function buildPoleBlocks({
  assets,
  assetById,
  relations,
  mountedChildIds,
  collapsedPoleGroupIds,
  selectedAssetId,
  search,
}) {
  const childrenByPole = new Map()
  const targetIdsByChild = new Map()
  relations.forEach(({ sourceAssetId, targetAssetId }) => {
    targetIdsByChild.set(sourceAssetId, new Set([
      ...(targetIdsByChild.get(sourceAssetId) ?? []),
      targetAssetId,
    ]))
  })
  relations.filter(({ sourceAssetId }) => targetIdsByChild.get(sourceAssetId)?.size === 1)
    .forEach((relation) => {
    if (!assetById.has(relation.sourceAssetId) || !assetById.has(relation.targetAssetId)) return
    mountedChildIds.add(relation.sourceAssetId)
    childrenByPole.set(relation.targetAssetId, [
      ...(childrenByPole.get(relation.targetAssetId) ?? []),
      relation.sourceAssetId,
    ])
    })
  return assets.filter((asset) => childrenByPole.has(asset.id)).map((pole) => {
    const children = unique(childrenByPole.get(pole.id) ?? [])
      .map((id) => assetById.get(id)).filter(Boolean).sort(compareMountedAsset)
    const groupId = `pole-group:${pole.id}`
    const blockAssets = [pole, ...children]
    const searchable = blockAssets.map(({ id, name, type }) => `${id} ${name} ${type}`).join(' ')
    return {
      id: groupId,
      pole: decorateAsset(pole, { selectedAssetId, search }),
      assets: children.map((asset) => decorateAsset(asset, { selectedAssetId, search })),
      assetIds: blockAssets.map(({ id }) => id),
      jbAssets: children.filter(isJunctionBox),
      cctvAssets: children.filter(isCctv),
      otherAssets: children.filter((asset) => !isJunctionBox(asset) && !isCctv(asset)),
      collapsed: collapsedPoleGroupIds.has(groupId),
      selected: blockAssets.some(({ id }) => id === selectedAssetId),
      dimmed: Boolean(search) && !searchable.toLocaleLowerCase('id')
        .includes(String(search).trim().toLocaleLowerCase('id')),
    }
  }).sort((left, right) => (
    compareAsset(left.pole, right.pole)
  ))
}

function deterministicTraversal({ rootId, vertexIds, edges, labelFor }) {
  const adjacency = adjacencyFor(edges)
  const orderedVertices = [...vertexIds].sort((left, right) => (
    naturalCompare(labelFor(left), labelFor(right)) || naturalCompare(left, right)
  ))
  const visited = new Set(rootId ? [rootId] : [])
  const queued = []
  const order = []
  const treeEdgeIds = new Set()
  const walk = (startId, includeStart) => {
    if (!visited.has(startId)) visited.add(startId)
    if (includeStart && vertexIds.includes(startId)) order.push(startId)
    queued.push(startId)
    while (queued.length) {
      const current = queued.shift()
      const neighbors = (adjacency.get(current) ?? []).map((edge) => ({
        edge,
        id: otherEnd(edge, current),
      })).filter(({ id }) => !visited.has(id)).sort((left, right) => (
        naturalCompare(labelFor(left.id), labelFor(right.id)) || naturalCompare(left.id, right.id)
      ))
      for (const neighbor of neighbors) {
        visited.add(neighbor.id)
        treeEdgeIds.add(neighbor.edge.id)
        if (vertexIds.includes(neighbor.id)) order.push(neighbor.id)
        queued.push(neighbor.id)
      }
    }
  }
  if (rootId) walk(rootId, false)
  orderedVertices.forEach((id) => {
    if (!visited.has(id)) walk(id, true)
  })
  return { order, treeEdgeIds }
}

function buildRecommendationEdges(candidates, vertexFor, assetById) {
  return (candidates ?? []).flatMap((candidate) => {
    if (!['candidate', 'ambiguous'].includes(candidate.candidateStatus)) return []
    const sourceAssetId = candidate.sourceAssetId ?? candidate.sourcePathAssetId
    const targetAssetId = candidate.targetAssetId ?? candidate.targetPathAssetId
    if (!sourceAssetId || !targetAssetId || !assetById.has(sourceAssetId) || !assetById.has(targetAssetId)) return []
    const sourceId = vertexFor(sourceAssetId)
    const targetId = vertexFor(targetAssetId)
    if (sourceId === targetId) return []
    return [{
      id: candidate.candidateId,
      sourceId,
      targetId,
      status: candidate.proposalStatus === 'recommended' ? 'recommended' : 'review',
      family: connectionFamily(candidate),
      candidate,
    }]
  })
}

function normalizeUninstalledEndpoints(unresolved, candidates, assetById) {
  const candidateUnresolved = (candidates ?? []).filter(({ candidateStatus }) => (
    candidateStatus === 'unresolved'
  ))
  const records = [...(unresolved ?? []), ...candidateUnresolved]
  const seen = new Set()
  return records.flatMap((record, index) => {
    const id = record.sourceEndpointId ?? record.candidateId ?? `unresolved-${index + 1}`
    if (seen.has(id)) return []
    seen.add(id)
    const sourceAssetId = record.sourceAssetId ?? record.sourcePathAssetId ?? null
    return [{
      ...record,
      id,
      sourceAssetId,
      name: assetById.get(sourceAssetId)?.name ?? record.sourceName ?? sourceAssetId ?? id,
      status: 'unresolved',
    }]
  }).sort((left, right) => naturalCompare(left.name, right.name) || naturalCompare(left.id, right.id))
}

function mergeUninstalledEndpoints(endpoints, assets) {
  const representedAssetIds = new Set(endpoints.map(({ sourceAssetId }) => sourceAssetId).filter(Boolean))
  return [
    ...endpoints,
    ...assets.filter(({ id }) => !representedAssetIds.has(id)).map((asset) => ({
      id: `uninstalled:${asset.id}`,
      sourceAssetId: asset.id,
      name: asset.name,
      type: asset.type,
      asset,
      status: 'unresolved',
    })),
  ]
}

function traceBetween(edges, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return { assetIds: [], edgeIds: [] }
  const adjacency = adjacencyFor(edges)
  const queue = [sourceId]
  const previous = new Map([[sourceId, null]])
  const previousEdge = new Map()
  while (queue.length && !previous.has(targetId)) {
    const current = queue.shift()
    for (const edge of (adjacency.get(current) ?? []).sort((a, b) => naturalCompare(a.id, b.id))) {
      const next = otherEnd(edge, current)
      if (previous.has(next)) continue
      previous.set(next, current)
      previousEdge.set(next, edge.id)
      queue.push(next)
    }
  }
  if (!previous.has(targetId)) return { assetIds: [], edgeIds: [] }
  const assetIds = []
  const edgeIds = []
  for (let current = targetId; current; current = previous.get(current)) {
    assetIds.unshift(current)
    if (previousEdge.has(current)) edgeIds.unshift(previousEdge.get(current))
  }
  return { assetIds, edgeIds }
}

function chooseCore(assets, degree) {
  const eligible = assets.filter((asset) => isCoreMarker(asset) || isConnector(asset))
  const pool = eligible.length ? eligible : assets.filter((asset) => (degree[asset.id] ?? 0) > 0)
  return [...pool].sort((left, right) => (
    Number(isCoreMarker(right)) - Number(isCoreMarker(left))
      || (degree[right.id] ?? 0) - (degree[left.id] ?? 0)
      || compareAsset(left, right)
  ))[0] ?? null
}

function summarizePhysicalAssets(assets, blocks) {
  return {
    poleCount: new Set([
      ...blocks.map(({ pole }) => pole.id),
      ...assets.filter(isPole).map(({ id }) => id),
    ]).size,
    jbCount: assets.filter(isJunctionBox).length,
    cctvCount: assets.filter(isCctv).length,
  }
}

function decorateAsset(asset, { selectedAssetId, search }) {
  const query = String(search ?? '').trim().toLocaleLowerCase('id')
  return {
    ...asset,
    selected: asset.id === selectedAssetId,
    dimmed: Boolean(query) && !`${asset.id} ${asset.name ?? ''} ${asset.type ?? ''}`
      .toLocaleLowerCase('id').includes(query),
  }
}

function deduplicateAssets(assets) {
  const byId = new Map()
  assets.forEach((asset) => {
    if (!asset?.id) return
    byId.set(asset.id, { ...(byId.get(asset.id) ?? {}), ...asset })
  })
  return [...byId.values()]
}

function deduplicatePhysicalEdges(edges) {
  const byPair = new Map()
  edges.forEach((edge) => {
    const key = [edge.sourceId, edge.targetId].sort(naturalCompare).join('|')
    if (!byPair.has(key)) byPair.set(key, edge)
  })
  return [...byPair.values()].sort((left, right) => naturalCompare(left.id, right.id))
}

function deduplicateProjectedEdges(edges) {
  const seen = new Set()
  return edges.filter((edge) => {
    const key = [edge.sourceId, edge.targetId].sort(naturalCompare).join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function adjacencyFor(edges) {
  const adjacency = new Map()
  edges.forEach((edge) => {
    adjacency.set(edge.sourceId, [...(adjacency.get(edge.sourceId) ?? []), edge])
    adjacency.set(edge.targetId, [...(adjacency.get(edge.targetId) ?? []), edge])
  })
  return adjacency
}

function calculateDegree(edges, ids) {
  const degree = Object.fromEntries([...ids].map((id) => [id, 0]))
  edges.forEach(({ sourceId, targetId }) => {
    degree[sourceId] = (degree[sourceId] ?? 0) + 1
    degree[targetId] = (degree[targetId] ?? 0) + 1
  })
  return degree
}

function connectionFamily(...sources) {
  const value = sources.flat(Infinity).map((source) => typeof source === 'string'
    ? source
    : [source?.networkFamily, source?.networkType, source?.networkName, source?.category,
      source?.type, source?.name].filter(Boolean).join(' ')).join(' ').toLowerCase()
  return /fiber|fibre|optic|\bfo\b/.test(value) ? 'fiber-optic' : 'lan'
}

function isConfirmedMounting(relation) {
  if (relation?.relationType !== 'mounted_on') return false
  if (['rejected', 'revoked'].includes(relation.verificationStatus)) return false
  return relation.verificationStatus === 'confirmed'
    || /manual/i.test(`${relation.relationSource ?? ''} ${relation.source ?? ''}`)
}

function isCablePath(asset) {
  return asset?.objectRole === 'cable_path'
    || asset?.geometry?.some?.(({ geometryType }) => geometryType === 'line_string')
    || /cable path|jalur kabel|fiber optic path|lan path/i.test(`${asset?.type ?? ''}`)
}

function isCoreMarker(asset) {
  return asset?.isCoreNode === true || /\b(core|rack|server|nvr|router|distribution)\b/i
    .test(`${asset?.type ?? ''} ${asset?.name ?? ''}`)
}

function isConnector(asset) {
  return /connector|switch|junction|otb|patch panel/i.test(`${asset?.type ?? ''} ${asset?.name ?? ''}`)
}

function isPole(asset) {
  return /\b(tiang|pole|mast)\b/i.test(`${asset?.type ?? ''} ${asset?.name ?? ''}`)
}

function isJunctionBox(asset) {
  return /junction|\bjb\b|joint box|termination box/i.test(`${asset?.type ?? ''} ${asset?.name ?? ''}`)
}

function isCctv(asset) {
  return !isJunctionBox(asset)
    && /cctv|camera|kamera/i.test(`${asset?.category ?? ''} ${asset?.type ?? ''} ${asset?.name ?? ''}`)
}

function isExtendedBlock(block) {
  return /extended|\bext\b|peralatan akses/i.test(block.assetIds.map((id, index) => (
    `${id} ${index ? block.assets[index - 1]?.name ?? '' : block.pole.name ?? ''}`
  )).join(' '))
}

function compareMountedAsset(left, right) {
  return mountedRank(left) - mountedRank(right) || compareAsset(left, right)
}

function mountedRank(asset) {
  if (isJunctionBox(asset)) return 0
  if (isCctv(asset)) return 1
  return 2
}

function compareAsset(left, right) {
  return naturalCompare(left?.name ?? left?.id ?? '', right?.name ?? right?.id ?? '')
    || naturalCompare(left?.id ?? '', right?.id ?? '')
}

function naturalCompare(left, right) {
  return NATURAL.compare(String(left ?? ''), String(right ?? ''))
}

function otherEnd(edge, id) {
  return edge.sourceId === id ? edge.targetId : edge.sourceId
}

function unique(values) {
  return [...new Set(values)]
}

function chunk(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => (
    values.slice(index * size, index * size + size)
  ))
}

export { MAX_BLOCKS_PER_LANE }
