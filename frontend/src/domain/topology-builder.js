const EARTH_RADIUS_METERS = 6371008.8

export const DEFAULT_TOPOLOGY_CONFIG = Object.freeze({
  endpointToleranceMeters: 5,
  pointOnLineToleranceMeters: 2,
  intersectionToleranceMeters: 1,
  ambiguityDeltaMeters: 0.75,
  inferLineEndpoints: true,
  inferLineIntersections: true,
  inferPointsOnLines: true,
})

/**
 * Builds a deterministic, read-only topology graph from normalized KML data.
 * Geographic coordinates and source geometry are never mutated.
 */
export function buildTopologyGraph({
  assets = [],
  geometries = [],
  relations = [],
  layers = [],
  config = {},
} = {}) {
  const settings = normalizeConfig(config)
  const ownerByNodeId = new Map(assets.map((asset) => [asset.id, asset]))
  const parts = geometries
    .flatMap(splitGeometry)
    .map((geometry) => ({
      ...geometry,
      owner: ownerByNodeId.get(geometry.assetNodeId),
    }))
    .filter(({ owner }) => Boolean(owner))

  const nodes = createAssetNodes(parts)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const lines = createTopologyLines(parts)
  const unresolvedEndpoints = []
  const ambiguousConnections = []
  const anchorsByLineId = new Map(lines.map((line) => [line.id, []]))

  if (settings.inferLineEndpoints) {
    lines.forEach((line) => resolveLineEndpoints({
      line,
      nodes,
      settings,
      anchors: anchorsByLineId.get(line.id),
      unresolvedEndpoints,
      ambiguousConnections,
    }))
  }

  if (settings.inferPointsOnLines) {
    resolvePointsOnLines({
      lines,
      nodes,
      settings,
      anchorsByLineId,
      ambiguousConnections,
    })
  }

  const internalEdges = createInternalEdges(lines, anchorsByLineId)
  const spatialCandidates = internalEdges.map((edge) => ({
    ...edge,
    relationStatus: 'candidate',
    candidateStatus: 'candidate',
  }))
  const edges = mergeConfirmedEdges({
    explicitRelations: relations.filter(isTrustedConfirmedRelation),
    inferredEdges: [],
    nodeById,
  })
  const connectedComponents = findConnectedComponents(nodes, edges)
  const connectedNodeIds = new Set(edges.flatMap(({ sourceNodeId, targetNodeId }) => (
    [sourceNodeId, targetNodeId]
  )))
  const isolatedNodes = nodes
    .filter(({ id }) => !connectedNodeIds.has(id))
    .map(({ id }) => id)

  return {
    nodes,
    edges,
    unresolvedEndpoints,
    ambiguousConnections,
    isolatedNodes,
    connectedComponents,
    virtualJunctions: [],
    internalEdges: [],
    spatialCandidates,
    settings,
  }
}

function isTrustedConfirmedRelation(relation) {
  if (relation.verificationStatus !== undefined) {
    return relation.verificationStatus === 'confirmed'
  }
  if (relation.candidateStatus !== undefined) {
    return relation.candidateStatus === 'confirmed'
  }
  if (relation.relationStatus !== undefined) {
    return relation.relationStatus === 'confirmed'
  }
  return relation.relationSource === undefined || relation.relationSource === 'explicit'
}

function createAssetNodes(parts) {
  const nodes = new Map()
  parts.forEach((geometry) => {
    if (geometry.geometryType !== 'point' || !validCoordinate(geometry.coordinates)) return
    const owner = geometry.owner
    if (nodes.has(owner.assetId)) return
    nodes.set(owner.assetId, {
      id: owner.assetId,
      assetId: owner.assetId,
      sourceNodeId: owner.id,
      name: owner.name || owner.assetId,
      category: owner.category || 'unmapped',
      assetType: owner.type || owner.category || 'unknown',
      layerId: owner.layerId,
      coordinate: cloneCoordinate(geometry.coordinates),
      geometryId: geometry.id,
      isVirtual: false,
    })
  })
  return [...nodes.values()]
}

function createTopologyLines(parts) {
  return parts
    .filter((geometry) => (
      geometry.geometryType === 'line_string'
      && Array.isArray(geometry.coordinates)
      && geometry.coordinates.length >= 2
      && geometry.coordinates.every(validCoordinate)
    ))
    .map((geometry) => {
      const coordinates = geometry.coordinates.map(cloneCoordinate)
      const segmentLengths = coordinates.slice(1).map((coordinate, index) => (
        geographicDistanceMeters(coordinates[index], coordinate)
      ))
      const cumulativeLengths = [0]
      segmentLengths.forEach((length) => {
        cumulativeLengths.push(cumulativeLengths.at(-1) + length)
      })
      return {
        id: geometry.id,
        sourceGeometryId: geometry.sourceGeometryId || geometry.id,
        ownerAssetId: geometry.owner.assetId,
        layerId: geometry.owner.layerId,
        category: geometry.owner.category || 'unmapped',
        assetType: geometry.owner.type || geometry.owner.category || 'unknown',
        coordinates,
        segmentLengths,
        cumulativeLengths,
        totalLengthMeters: cumulativeLengths.at(-1),
      }
    })
}

function resolveLineEndpoints({
  line,
  nodes,
  settings,
  anchors,
  unresolvedEndpoints,
  ambiguousConnections,
}) {
  const endpoints = [{
    endpoint: 'start',
    coordinate: line.coordinates[0],
    measureMeters: 0,
  }, {
    endpoint: 'end',
    coordinate: line.coordinates.at(-1),
    measureMeters: line.totalLengthMeters,
  }]

  endpoints.forEach((endpoint) => {
    const candidates = nodes
      .filter((node) => pointLineCompatible(node, line))
      .map((node) => ({
        nodeId: node.id,
        distanceMeters: geographicDistanceMeters(endpoint.coordinate, node.coordinate),
      }))
      .filter(({ distanceMeters }) => distanceMeters <= settings.endpointToleranceMeters)
      .sort(compareDistanceThenId)

    if (!candidates.length) {
      unresolvedEndpoints.push({
        lineId: line.id,
        sourceGeometryId: line.sourceGeometryId,
        endpoint: endpoint.endpoint,
        coordinate: cloneCoordinate(endpoint.coordinate),
        reason: 'no_candidate_within_tolerance',
        toleranceMeters: settings.endpointToleranceMeters,
      })
      return
    }
    if (isAmbiguous(candidates, settings.ambiguityDeltaMeters)) {
      ambiguousConnections.push({
        kind: 'line_endpoint',
        lineId: line.id,
        sourceGeometryId: line.sourceGeometryId,
        endpoint: endpoint.endpoint,
        coordinate: cloneCoordinate(endpoint.coordinate),
        candidates,
        toleranceMeters: settings.endpointToleranceMeters,
      })
      return
    }
    anchors.push({
      nodeId: candidates[0].nodeId,
      measureMeters: endpoint.measureMeters,
      distanceMeters: candidates[0].distanceMeters,
      source: 'endpoint',
    })
  })
}

function resolvePointsOnLines({
  lines,
  nodes,
  settings,
  anchorsByLineId,
  ambiguousConnections,
}) {
  nodes.forEach((node) => {
    const candidates = lines
      .filter((line) => pointLineCompatible(node, line))
      .map((line) => {
        const nearest = nearestPointOnLine(node.coordinate, line)
        return { line, ...nearest }
      })
      .filter((candidate) => (
        candidate.distanceMeters <= settings.pointOnLineToleranceMeters
        && candidate.measureMeters > settings.endpointToleranceMeters
        && lineRemaining(candidate.line, candidate.measureMeters)
          > settings.endpointToleranceMeters
      ))
      .sort((left, right) => (
        left.distanceMeters - right.distanceMeters || left.line.id.localeCompare(right.line.id)
      ))

    if (!candidates.length) return
    if (isAmbiguous(candidates, settings.ambiguityDeltaMeters)) {
      ambiguousConnections.push({
        kind: 'point_on_line',
        nodeId: node.id,
        coordinate: cloneCoordinate(node.coordinate),
        candidates: candidates.map(({ line, distanceMeters, projectedCoordinate }) => ({
          lineId: line.id,
          sourceGeometryId: line.sourceGeometryId,
          distanceMeters,
          coordinate: projectedCoordinate,
        })),
        toleranceMeters: settings.pointOnLineToleranceMeters,
      })
      return
    }

    const selected = candidates[0]
    anchorsByLineId.get(selected.line.id).push({
      nodeId: node.id,
      measureMeters: selected.measureMeters,
      distanceMeters: selected.distanceMeters,
      source: 'point_on_line',
    })
  })
}

function resolveLineIntersections({
  lines,
  nodes,
  settings,
  anchorsByLineId,
  virtualJunctions,
}) {
  const junctionByCoordinate = new Map()
  for (let leftIndex = 0; leftIndex < lines.length; leftIndex += 1) {
    const left = lines[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < lines.length; rightIndex += 1) {
      const right = lines[rightIndex]
      if (!lineIntersectionCompatible(left, right)) continue
      if (!boundingBoxesOverlap(lineBounds(left), lineBounds(right))) continue

      for (let leftSegment = 0; leftSegment < left.coordinates.length - 1; leftSegment += 1) {
        for (
          let rightSegment = 0;
          rightSegment < right.coordinates.length - 1;
          rightSegment += 1
        ) {
          const intersection = segmentIntersection(
            left.coordinates[leftSegment],
            left.coordinates[leftSegment + 1],
            right.coordinates[rightSegment],
            right.coordinates[rightSegment + 1],
          )
          if (!intersection) continue

          const matchingNodes = nodes
            .filter((node) => (
              pointLineCompatible(node, left)
              && pointLineCompatible(node, right)
            ))
            .map((node) => ({
              nodeId: node.id,
              distanceMeters: geographicDistanceMeters(
                intersection.coordinate,
                node.coordinate,
              ),
            }))
            .filter(({ distanceMeters }) => (
              distanceMeters <= settings.intersectionToleranceMeters
            ))
            .sort(compareDistanceThenId)
          const useInventoryNode = matchingNodes.length === 1
          const coordinateKey = quantizedCoordinateKey(intersection.coordinate)
          let junctionId = useInventoryNode ? matchingNodes[0].nodeId : null

          if (!junctionId) {
            junctionId = junctionByCoordinate.get(coordinateKey)
            if (!junctionId) {
              junctionId = `virtual-junction:${coordinateKey}`
              junctionByCoordinate.set(coordinateKey, junctionId)
              virtualJunctions.push({
                id: junctionId,
                coordinate: cloneCoordinate(intersection.coordinate),
                isVirtual: true,
              })
            }
          }

          anchorsByLineId.get(left.id).push({
            nodeId: junctionId,
            measureMeters: measureOnSegment(left, leftSegment, intersection.leftT),
            distanceMeters: useInventoryNode ? matchingNodes[0].distanceMeters : 0,
            source: 'line_intersection',
            isVirtual: !useInventoryNode,
          })
          anchorsByLineId.get(right.id).push({
            nodeId: junctionId,
            measureMeters: measureOnSegment(right, rightSegment, intersection.rightT),
            distanceMeters: useInventoryNode ? matchingNodes[0].distanceMeters : 0,
            source: 'line_intersection',
            isVirtual: !useInventoryNode,
          })
        }
      }
    }
  }
}

function createInternalEdges(lines, anchorsByLineId) {
  const edges = []
  lines.forEach((line) => {
    const anchors = deduplicateAnchors(anchorsByLineId.get(line.id))
      .sort((left, right) => (
        left.measureMeters - right.measureMeters || left.nodeId.localeCompare(right.nodeId)
      ))
    anchors.slice(1).forEach((target, index) => {
      const source = anchors[index]
      if (source.nodeId === target.nodeId) return
      const relationSource = internalRelationSource(source, target)
      edges.push({
        id: `internal:${slugify(line.id)}:${index}`,
        sourceNodeId: source.nodeId,
        targetNodeId: target.nodeId,
        sourceGeometryId: line.sourceGeometryId,
        pathAssetId: line.ownerAssetId,
        category: line.category,
        relationSource,
        relationStatus: 'confirmed',
        distanceMeters: Math.max(source.distanceMeters || 0, target.distanceMeters || 0),
        pathLengthMeters: Math.max(0, target.measureMeters - source.measureMeters),
      })
    })
  })
  return edges
}

function collapseVirtualJunctions({
  internalEdges,
  inventoryNodeIds,
  virtualNodeIds,
}) {
  const adjacency = createAdjacency(internalEdges)
  const results = new Map()

  inventoryNodeIds.forEach((sourceNodeId) => {
    const queue = (adjacency.get(sourceNodeId) || []).map(({ targetNodeId, edge }) => ({
      nodeId: targetNodeId,
      path: [edge],
      visitedVirtual: new Set(),
    }))

    while (queue.length) {
      const current = queue.shift()
      if (inventoryNodeIds.has(current.nodeId)) {
        if (current.nodeId !== sourceNodeId) {
          const edge = collapsePath(sourceNodeId, current.nodeId, current.path)
          const key = undirectedEdgeKey(edge.sourceNodeId, edge.targetNodeId)
          const existing = results.get(key)
          if (!existing || edge.pathLengthMeters < existing.pathLengthMeters) {
            results.set(key, edge)
          }
        }
        continue
      }
      if (!virtualNodeIds.has(current.nodeId)
        || current.visitedVirtual.has(current.nodeId)) continue

      const visitedVirtual = new Set(current.visitedVirtual)
      visitedVirtual.add(current.nodeId)
      for (const next of adjacency.get(current.nodeId) || []) {
        if (current.path.includes(next.edge)) continue
        queue.push({
          nodeId: next.targetNodeId,
          path: [...current.path, next.edge],
          visitedVirtual,
        })
      }
    }
  })

  return [...results.values()]
}

function collapsePath(sourceNodeId, targetNodeId, path) {
  const sourceGeometryIds = unique(path.map(({ sourceGeometryId }) => sourceGeometryId))
  const pathAssetIds = unique(path.map(({ pathAssetId }) => pathAssetId).filter(Boolean))
  const relationSource = path.some(({ relationSource }) => (
    relationSource === 'inferred_point_on_line'
  ))
    ? 'inferred_point_on_line'
    : path.some(({ relationSource }) => relationSource === 'inferred_line_intersection')
      ? 'inferred_line_intersection'
      : 'inferred_endpoint'
  const relationType = {
    inferred_endpoint: 'line-endpoint',
    inferred_line_intersection: 'line-intersection',
    inferred_point_on_line: 'point-on-line',
  }[relationSource]
  return {
    id: topologyEdgeId(sourceNodeId, targetNodeId, sourceGeometryIds),
    sourceNodeId,
    targetNodeId,
    sourceAssetId: sourceNodeId,
    targetAssetId: targetNodeId,
    relationType,
    relationSource,
    relationStatus: 'confirmed',
    sourceGeometryId: sourceGeometryIds.length === 1 ? sourceGeometryIds[0] : undefined,
    sourceGeometryIds,
    pathAssetId: pathAssetIds.length === 1 ? pathAssetIds[0] : undefined,
    category: path[0]?.category || 'unmapped',
    networkId: `network:${semanticFamily(path[0]?.category)}`,
    distanceMeters: Math.max(...path.map(({ distanceMeters = 0 }) => distanceMeters)),
    pathLengthMeters: path.reduce((total, edge) => total + edge.pathLengthMeters, 0),
  }
}

function mergeConfirmedEdges({ explicitRelations, inferredEdges, nodeById }) {
  const edges = new Map()
  explicitRelations.forEach((relation, index) => {
    const sourceNodeId = relation.sourceNodeId || relation.sourceAssetId
    const targetNodeId = relation.targetNodeId || relation.targetAssetId
    if (!nodeById.has(sourceNodeId) || !nodeById.has(targetNodeId)
      || sourceNodeId === targetNodeId) return
    const source = nodeById.get(sourceNodeId)
    const category = relation.category || source.category
    edges.set(undirectedEdgeKey(sourceNodeId, targetNodeId), {
      id: relation.id || `explicit:${slugify(sourceNodeId)}:${slugify(targetNodeId)}:${index}`,
      sourceNodeId,
      targetNodeId,
      sourceAssetId: sourceNodeId,
      targetAssetId: targetNodeId,
      relationType: relation.relationType || 'connected-to',
      relationSource: 'explicit',
      relationStatus: 'confirmed',
      pathAssetId: relation.pathAssetId,
      sourceGeometryId: relation.sourceGeometryId,
      sourceGeometryIds: relation.sourceGeometryIds
        || [relation.sourceGeometryId].filter(Boolean),
      category,
      networkId: relation.networkId || `network:${semanticFamily(category, source.assetType)}`,
      distanceMeters: relation.distanceMeters,
      metadata: relation.metadata ? structuredClone(relation.metadata) : undefined,
    })
  })
  inferredEdges.forEach((edge) => {
    const key = undirectedEdgeKey(edge.sourceNodeId, edge.targetNodeId)
    if (!edges.has(key)) edges.set(key, edge)
  })
  return [...edges.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function findConnectedComponents(nodes, edges) {
  const adjacency = new Map(nodes.map(({ id }) => [id, []]))
  edges.forEach((edge) => {
    adjacency.get(edge.sourceNodeId)?.push({ nodeId: edge.targetNodeId, edgeId: edge.id })
    adjacency.get(edge.targetNodeId)?.push({ nodeId: edge.sourceNodeId, edgeId: edge.id })
  })
  const visited = new Set()
  const components = []

  nodes.forEach(({ id }) => {
    if (visited.has(id)) return
    const nodeIds = []
    const edgeIds = new Set()
    const queue = [id]
    visited.add(id)
    while (queue.length) {
      const nodeId = queue.shift()
      nodeIds.push(nodeId)
      for (const adjacent of adjacency.get(nodeId) || []) {
        edgeIds.add(adjacent.edgeId)
        if (visited.has(adjacent.nodeId)) continue
        visited.add(adjacent.nodeId)
        queue.push(adjacent.nodeId)
      }
    }
    components.push({
      id: `component:${components.length + 1}`,
      nodeIds: nodeIds.sort(),
      edgeIds: [...edgeIds].sort(),
    })
  })
  return components
}

function splitGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return []
  if (geometry.geometryType !== 'multi_geometry') {
    return [{
      id: geometry.id,
      sourceGeometryId: geometry.sourceGeometryId || geometry.id,
      assetNodeId: geometry.assetNodeId,
      geometryType: geometry.geometryType,
      coordinates: structuredClone(geometry.coordinates),
    }]
  }
  return (geometry.coordinates || []).flatMap((child, index) => (
    child?.geometryType && child.geometryType !== 'multi_geometry'
      ? [{
        id: `${geometry.id}:part:${index + 1}`,
        sourceGeometryId: geometry.id,
        assetNodeId: geometry.assetNodeId,
        geometryType: child.geometryType,
        coordinates: structuredClone(child.coordinates),
      }]
      : []
  ))
}

function nearestPointOnLine(coordinate, line) {
  let nearest = {
    distanceMeters: Number.POSITIVE_INFINITY,
    measureMeters: 0,
    projectedCoordinate: cloneCoordinate(line.coordinates[0]),
  }
  line.coordinates.slice(1).forEach((end, index) => {
    const start = line.coordinates[index]
    const projection = projectPointToSegment(coordinate, start, end)
    if (projection.distanceMeters >= nearest.distanceMeters) return
    nearest = {
      distanceMeters: projection.distanceMeters,
      measureMeters: line.cumulativeLengths[index]
        + line.segmentLengths[index] * projection.t,
      projectedCoordinate: projection.coordinate,
    }
  })
  return nearest
}

function projectPointToSegment(point, start, end) {
  const referenceLatitude = (Number(start[1]) + Number(end[1]) + Number(point[1])) / 3
  const pointXY = localMeters(point, start, referenceLatitude)
  const endXY = localMeters(end, start, referenceLatitude)
  const lengthSquared = endXY.x ** 2 + endXY.y ** 2
  const t = lengthSquared
    ? clamp((pointXY.x * endXY.x + pointXY.y * endXY.y) / lengthSquared, 0, 1)
    : 0
  const projectedXY = { x: endXY.x * t, y: endXY.y * t }
  return {
    t,
    distanceMeters: Math.hypot(
      pointXY.x - projectedXY.x,
      pointXY.y - projectedXY.y,
    ),
    coordinate: [
      Number(start[0]) + (Number(end[0]) - Number(start[0])) * t,
      Number(start[1]) + (Number(end[1]) - Number(start[1])) * t,
    ],
  }
}

function segmentIntersection(leftStart, leftEnd, rightStart, rightEnd) {
  if (!boundingBoxesOverlap(
    coordinateBounds(leftStart, leftEnd),
    coordinateBounds(rightStart, rightEnd),
  )) return null
  const leftX = Number(leftEnd[0]) - Number(leftStart[0])
  const leftY = Number(leftEnd[1]) - Number(leftStart[1])
  const rightX = Number(rightEnd[0]) - Number(rightStart[0])
  const rightY = Number(rightEnd[1]) - Number(rightStart[1])
  const denominator = cross(leftX, leftY, rightX, rightY)
  if (Math.abs(denominator) < 1e-12) return null
  const offsetX = Number(rightStart[0]) - Number(leftStart[0])
  const offsetY = Number(rightStart[1]) - Number(leftStart[1])
  const leftT = cross(offsetX, offsetY, rightX, rightY) / denominator
  const rightT = cross(offsetX, offsetY, leftX, leftY) / denominator
  if (leftT < -1e-10 || leftT > 1 + 1e-10
    || rightT < -1e-10 || rightT > 1 + 1e-10) return null
  return {
    leftT: clamp(leftT, 0, 1),
    rightT: clamp(rightT, 0, 1),
    coordinate: [
      Number(leftStart[0]) + leftX * leftT,
      Number(leftStart[1]) + leftY * leftT,
    ],
  }
}

function pointLineCompatible(node, line) {
  const lineFamily = semanticFamily(line.category, line.assetType)
  const nodeFamily = semanticFamily(node.category, node.assetType)
  const type = String(node.assetType || '').toLowerCase()
  if (lineFamily === 'cctv-cable' || lineFamily === 'cctv') {
    return nodeFamily === 'cctv'
      || (nodeFamily === 'infrastructure'
        && /(junction|\bjb\b|switch|nvr|server|router)/.test(type))
  }
  if (lineFamily === 'fiber-optic') {
    return nodeFamily === 'fiber-optic'
      || (nodeFamily === 'infrastructure'
        && /(otb|junction|\bjb\b|switch|router|core)/.test(type))
  }
  if (lineFamily === 'lan') {
    return ['lan', 'infrastructure', 'peripheral'].includes(nodeFamily)
      && /(switch|router|access point|\bap\b|printer|server|device|lan)/.test(type)
  }
  if (lineFamily === 'infrastructure') return nodeFamily === 'infrastructure'
  if (lineFamily === 'peripheral') {
    return nodeFamily === 'peripheral' || nodeFamily === 'infrastructure'
  }
  return false
}

function lineIntersectionCompatible(left, right) {
  const leftFamily = semanticFamily(left.category, left.assetType)
  const rightFamily = semanticFamily(right.category, right.assetType)
  if (leftFamily === 'unmapped' || rightFamily === 'unmapped') return false
  if (leftFamily === rightFamily) return true
  return new Set([leftFamily, rightFamily]).size === 2
    && [leftFamily, rightFamily].every((family) => ['cctv', 'cctv-cable'].includes(family))
}

function semanticFamily(...values) {
  const value = values.filter(Boolean).join(' ').toLowerCase()
  if (value.includes('cctv') && /(cable|kabel|backbone)/.test(value)) return 'cctv-cable'
  if (/(fiber|fibre|\bfo\b)/.test(value)) return 'fiber-optic'
  if (/\blan\b|\butp\b/.test(value)) return 'lan'
  if (/cctv|camera|kamera|junction|\bjb\b|nvr/.test(value)) return 'cctv'
  if (/access point|\bap\b|printer|peripheral/.test(value)) return 'peripheral'
  if (/switch|server|rack|otb|core|router|infrastructure|infrastruktur/.test(value)) {
    return 'infrastructure'
  }
  return 'unmapped'
}

function isVisibleAsset(asset, layerById) {
  const sourceVisibility = asset.visibility
    ?? asset.properties?.visibility
    ?? asset.properties?.semanticMetadata?.visibility
  if (sourceVisibility === false || sourceVisibility === 0 || sourceVisibility === '0') {
    return false
  }
  const visited = new Set()
  let layer = layerById.get(asset.layerId)
  while (layer && !visited.has(layer.id)) {
    if (layer.defaultVisible === false) return false
    visited.add(layer.id)
    layer = layer.parentLayerId ? layerById.get(layer.parentLayerId) : null
  }
  return true
}

function normalizeConfig(config) {
  return {
    endpointToleranceMeters: positiveNumber(
      config.endpointToleranceMeters,
      DEFAULT_TOPOLOGY_CONFIG.endpointToleranceMeters,
    ),
    pointOnLineToleranceMeters: positiveNumber(
      config.pointOnLineToleranceMeters,
      DEFAULT_TOPOLOGY_CONFIG.pointOnLineToleranceMeters,
    ),
    intersectionToleranceMeters: positiveNumber(
      config.intersectionToleranceMeters,
      DEFAULT_TOPOLOGY_CONFIG.intersectionToleranceMeters,
    ),
    ambiguityDeltaMeters: nonNegativeNumber(
      config.ambiguityDeltaMeters,
      DEFAULT_TOPOLOGY_CONFIG.ambiguityDeltaMeters,
    ),
    inferLineEndpoints: config.inferLineEndpoints !== false,
    inferLineIntersections: config.inferLineIntersections !== false,
    inferPointsOnLines: config.inferPointsOnLines !== false,
  }
}

function createAdjacency(edges) {
  const adjacency = new Map()
  edges.forEach((edge) => {
    adjacency.set(edge.sourceNodeId, [
      ...(adjacency.get(edge.sourceNodeId) || []),
      { targetNodeId: edge.targetNodeId, edge },
    ])
    adjacency.set(edge.targetNodeId, [
      ...(adjacency.get(edge.targetNodeId) || []),
      { targetNodeId: edge.sourceNodeId, edge },
    ])
  })
  return adjacency
}

function internalRelationSource(source, target) {
  if ([source.source, target.source].includes('point_on_line')) {
    return 'inferred_point_on_line'
  }
  if ([source.source, target.source].includes('line_intersection')) {
    return 'inferred_line_intersection'
  }
  return 'inferred_endpoint'
}

function deduplicateAnchors(anchors = []) {
  const uniqueAnchors = new Map()
  anchors.forEach((anchor) => {
    const key = `${anchor.nodeId}:${Math.round(anchor.measureMeters * 100)}`
    const existing = uniqueAnchors.get(key)
    if (!existing || anchor.distanceMeters < existing.distanceMeters) {
      uniqueAnchors.set(key, anchor)
    }
  })
  return [...uniqueAnchors.values()]
}

function isAmbiguous(candidates, deltaMeters) {
  return candidates.length > 1
    && Math.abs(candidates[1].distanceMeters - candidates[0].distanceMeters) <= deltaMeters
}

function compareDistanceThenId(left, right) {
  return left.distanceMeters - right.distanceMeters
    || left.nodeId.localeCompare(right.nodeId)
}

function geographicDistanceMeters(left, right) {
  const leftLatitude = radians(Number(left[1]))
  const rightLatitude = radians(Number(right[1]))
  const latitudeDelta = rightLatitude - leftLatitude
  const longitudeDelta = radians(Number(right[0]) - Number(left[0]))
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude)
      * Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

function localMeters(coordinate, origin, referenceLatitude) {
  return {
    x: radians(Number(coordinate[0]) - Number(origin[0]))
      * EARTH_RADIUS_METERS * Math.cos(radians(referenceLatitude)),
    y: radians(Number(coordinate[1]) - Number(origin[1])) * EARTH_RADIUS_METERS,
  }
}

function lineBounds(line) {
  return {
    west: Math.min(...line.coordinates.map(([longitude]) => Number(longitude))),
    east: Math.max(...line.coordinates.map(([longitude]) => Number(longitude))),
    south: Math.min(...line.coordinates.map(([, latitude]) => Number(latitude))),
    north: Math.max(...line.coordinates.map(([, latitude]) => Number(latitude))),
  }
}

function coordinateBounds(left, right) {
  return {
    west: Math.min(Number(left[0]), Number(right[0])),
    east: Math.max(Number(left[0]), Number(right[0])),
    south: Math.min(Number(left[1]), Number(right[1])),
    north: Math.max(Number(left[1]), Number(right[1])),
  }
}

function boundingBoxesOverlap(left, right) {
  return left.west <= right.east
    && left.east >= right.west
    && left.south <= right.north
    && left.north >= right.south
}

function measureOnSegment(line, segmentIndex, t) {
  return line.cumulativeLengths[segmentIndex] + line.segmentLengths[segmentIndex] * t
}

function lineRemaining(line, measureMeters) {
  return line.totalLengthMeters - measureMeters
}

function topologyEdgeId(source, target, geometryIds) {
  const [left, right] = [source, target].sort()
  const geometryKey = slugify(geometryIds.join('-')).slice(0, 72) || 'geometry'
  return `topology:${slugify(left)}:${slugify(right)}:${geometryKey}`
}

function undirectedEdgeKey(source, target) {
  return [source, target].sort().join('|')
}

function quantizedCoordinateKey(coordinate) {
  return `${Number(coordinate[0]).toFixed(7)}:${Number(coordinate[1]).toFixed(7)}`
}

function validCoordinate(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return false
  const longitude = Number(coordinate[0])
  const latitude = Number(coordinate[1])
  return Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90
}

function cloneCoordinate(coordinate) {
  return coordinate.slice(0, 3).map(Number)
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item'
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function cross(leftX, leftY, rightX, rightY) {
  return leftX * rightY - leftY * rightX
}

function radians(degrees) {
  return degrees * Math.PI / 180
}

function unique(values) {
  return [...new Set(values)]
}
