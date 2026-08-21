const DEFAULT_OPTIONS = Object.freeze({
  margin: 42,
  sectionGap: 30,
  sectionHeaderHeight: 42,
  sectionPadding: 22,
  laneGap: 26,
  laneHeaderHeight: 24,
  lanePadding: 18,
  bandHeaderHeight: 22,
  bandGap: 24,
  nodeGapX: 18,
  nodeGapY: 18,
  levelGapY: 84,
  nodeWidth: 108,
  nodeHeight: 64,
  coreWidth: 132,
  coreHeight: 76,
  distributionWidth: 108,
  distributionHeight: 64,
  endpointWidth: 92,
  endpointHeight: 58,
  compactWidth: 84,
  compactHeight: 54,
  unresolvedHeight: 58,
  footerHeight: 86,
  minWidth: 1120,
  layoutStyle: 'central-backbone',
  componentColumns: 3,
  componentGapX: 28,
  componentGapY: 28,
  hubMinWidth: 420,
  hubPadding: 20,
  hubHeaderHeight: 34,
  hubNodeGapX: 10,
  hubLevelGapY: 58,
  hubRootWidth: 132,
  hubRootHeight: 76,
  hubJunctionWidth: 94,
  hubJunctionHeight: 64,
  hubEndpointWidth: 64,
  hubEndpointHeight: 56,
  peerColumns: 10,
  extendedColumns: 8,
  endpointColumns: 12,
  overview: false,
  overviewColumns: 3,
  overviewCardHeight: 136,
  overviewMargin: 28,
  overviewGapX: 16,
  overviewGapY: 22,
  overviewMinWidth: 1000,
})

export function calculateTopologyDiagramLayout(model, options = {}) {
  if (!model || model.status !== 'ready') {
    return {
      status: model?.status ?? 'empty',
      message: model?.message ?? 'Diagram tidak memiliki aset.',
      nodes: [],
      edges: [],
      sections: [],
      unresolvedMarkers: [],
      width: 0,
      height: 0,
      options: { ...DEFAULT_OPTIONS, ...options },
    }
  }

  const settings = { ...DEFAULT_OPTIONS, ...options }
  if (settings.overview) return calculateAreaOverviewLayout(model, settings)
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]))
  const componentById = new Map(model.components.map((component) => [component.componentId, component]))
  const layoutNodes = new Map()
  const layoutEdges = []
  const sections = []
  let cursorY = settings.margin + 62
  let maxSectionWidth = settings.minWidth

  for (const area of model.areas) {
    const areaComponents = area.componentIds
      .map((componentId) => componentById.get(componentId))
      .filter(Boolean)
      .sort((left, right) => compareComponentPriority(left, right, nodeById)
        || left.componentId.localeCompare(right.componentId, 'id'))
    const laneSpecs = areaComponents.map((component, index) => buildLaneSpec({
      component,
      index,
      nodeById,
      edges: model.edges,
      settings,
    }))
    const disconnectedNodes = (area.isolatedNodeIds ?? [])
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .sort(compareNodes)
    const suggestedOnlyNodes = (area.suggestedOnlyNodeIds ?? [])
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .sort(compareNodes)
    const isolatedNodes = [...disconnectedNodes, ...suggestedOnlyNodes]
    const isolatedSpec = isolatedNodes.length
      ? buildIsolatedSpec(isolatedNodes, settings)
      : null
    const unresolvedSpec = model.unresolved.filter((item) => item.areaKey === area.key)
    const laneGrid = layoutComponentLanes(laneSpecs, settings)
    const laneWidth = Math.max(
      settings.minWidth - settings.sectionPadding * 2,
      laneGrid.width,
      isolatedSpec?.width ?? 0,
    )
    const sectionWidth = laneWidth + settings.sectionPadding * 2
    let sectionHeight = settings.sectionHeaderHeight + settings.sectionPadding
      + laneGrid.height
    const sectionLanes = laneGrid.lanes
    if (isolatedSpec) {
      isolatedSpec.x = settings.sectionPadding
      isolatedSpec.y = sectionHeight
      isolatedSpec.width = laneWidth
      sectionHeight += isolatedSpec.height + settings.laneGap
    }
    const unresolvedPanel = unresolvedSpec.length
      ? {
        x: settings.sectionPadding,
        y: sectionHeight,
        width: laneWidth,
        height: settings.unresolvedHeight,
        items: unresolvedSpec,
      }
      : null
    if (unresolvedPanel) sectionHeight += unresolvedPanel.height + settings.laneGap
    sectionHeight += settings.sectionPadding
    const section = {
      kind: 'area',
      key: area.key,
      name: area.name,
      x: settings.margin,
      y: cursorY,
      width: sectionWidth,
      height: sectionHeight,
      nodeCount: area.nodeIds.length,
      componentCount: laneSpecs.length,
      isolatedCount: disconnectedNodes.length,
      suggestedOnlyCount: suggestedOnlyNodes.length,
      unresolvedCount: unresolvedSpec.length,
      crossAreaCount: area.crossAreaEdgeCount ?? 0,
      lanes: sectionLanes,
      isolated: isolatedSpec,
      unresolved: unresolvedPanel,
    }
    sections.push(section)
    maxSectionWidth = Math.max(maxSectionWidth, sectionWidth)
    cursorY += sectionHeight + settings.sectionGap

    sectionLanes.forEach((lane) => {
      lane.nodes.forEach((node) => layoutNodes.set(node.id, node))
    })
    if (isolatedSpec) isolatedSpec.nodes.forEach((node) => layoutNodes.set(node.id, node))
  }

  const finalWidth = Math.max(settings.minWidth, maxSectionWidth + settings.margin * 2)
  sections.forEach((section) => {
    section.x = (finalWidth - section.width) / 2
    section.lanes.forEach((lane) => {
      lane.nodes.forEach((node) => translateNode(node, section.x + lane.x, section.y + lane.y))
    })
    if (section.isolated) {
      section.isolated.nodes.forEach((node) => translateNode(
        node,
        section.x + section.isolated.x,
        section.y + section.isolated.y,
      ))
    }
  })

  const crossAreaMarkers = buildCrossAreaMarkers(model.crossAreaEdges, layoutNodes, finalWidth)

  const finalHeight = Math.max(settings.footerHeight + cursorY, settings.margin * 2 + 220)
  const unresolvedMarkers = sections.flatMap((section) => (
    (section.unresolved?.items ?? []).map((item, index) => ({
      ...item,
      x: section.x + settings.sectionPadding + 22 + index * 18,
      y: section.y + section.unresolved.y + section.unresolved.height / 2,
      areaKey: section.key,
    }))
  ))

  const allEdges = model.edges.filter((edge) => (
    layoutNodes.has(edge.sourceId) && layoutNodes.has(edge.targetId)
  ))
  allEdges.forEach((edge) => {
    const source = layoutNodes.get(edge.sourceId)
    const target = layoutNodes.get(edge.targetId)
    layoutEdges.push({
      ...edge,
      routePoints: routeEdge(source, target),
      linePoints: straightLinkPoints(source, target),
    })
  })

  const layout = {
    status: 'ready',
    strategy: settings.layoutStyle === 'central-backbone'
      ? 'central-backbone-network'
      : 'top-down-area-semantic-tier',
    width: finalWidth,
    height: finalHeight,
    options: settings,
    nodes: [...layoutNodes.values()].sort(compareLayoutNodes),
    edges: layoutEdges.sort((left, right) => left.id.localeCompare(right.id, 'id')),
    sections,
    unresolvedMarkers,
    crossAreaMarkers,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: finalWidth,
      maxY: finalHeight,
    },
  }
  return validateLayoutBounds(layout)
}

function calculateAreaOverviewLayout(model, settings) {
  const areas = [...(model.areas ?? [])]
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'id')
      || String(left.key).localeCompare(String(right.key), 'id'))
  const nodeById = new Map((model.nodes ?? []).map((node) => [node.id, node]))
  const columns = Math.max(1, Math.min(
    settings.overviewColumns,
    Math.max(areas.length, 1),
  ))
  const cardWidth = Math.max(
    280,
    (settings.overviewMinWidth - settings.overviewMargin * 2
      - (columns - 1) * settings.overviewGapX) / columns,
  )
  const startY = settings.overviewMargin + 94
  const cards = areas.map((area, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const areaNodes = area.nodeIds.map((id) => nodeById.get(id)).filter(Boolean)
    const connectedCount = areaNodes.filter(({ confirmedDegree }) => confirmedDegree > 0).length
    return {
      ...area,
      x: settings.overviewMargin + column * (cardWidth + settings.overviewGapX),
      y: startY + row * (settings.overviewCardHeight + settings.overviewGapY),
      width: cardWidth,
      height: settings.overviewCardHeight,
      nodeCount: area.nodeIds.length,
      connectedCount,
      componentCount: area.componentIds.length,
      disconnectedCount: area.isolatedNodeIds.length,
      crossAreaEdgeCount: area.crossAreaEdgeCount ?? 0,
      crossAreaNeighborKeys: area.crossAreaNeighborKeys ?? [],
    }
  })
  const rows = Math.ceil(cards.length / columns)
  const width = Math.max(
    settings.overviewMinWidth,
    settings.overviewMargin * 2 + columns * cardWidth
      + Math.max(0, columns - 1) * settings.overviewGapX,
  )
  const height = Math.max(
    settings.footerHeight + startY + settings.overviewCardHeight,
    startY + rows * settings.overviewCardHeight
      + Math.max(0, rows - 1) * settings.overviewGapY
      + settings.overviewMargin + settings.footerHeight,
  )
  return {
    status: 'ready',
    mode: 'area-overview',
    strategy: 'area-overview-progressive-disclosure',
    width,
    height,
    options: settings,
    nodes: [],
    edges: [],
    sections: [],
    unresolvedMarkers: [],
    crossAreaMarkers: [],
    overviewAreas: cards,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height,
    },
  }
}

function layoutComponentLanes(lanes, settings) {
  if (!lanes.length) return { width: 0, height: 0, lanes: [] }
  const columns = Math.max(1, Math.min(
    settings.componentColumns,
    lanes.length,
  ))
  const rows = Math.ceil(lanes.length / columns)
  const slotOrder = Array.from({ length: lanes.length }, (_, index) => index)
  if (columns >= 3 && lanes.length >= columns) {
    const centerColumn = Math.floor(columns / 2)
    const firstRowSlots = [
      centerColumn,
      ...Array.from({ length: columns }, (_, column) => column)
        .filter((column) => column !== centerColumn),
    ]
    firstRowSlots.forEach((slot, index) => {
      slotOrder[index] = slot
    })
  }
  const placements = lanes.map((lane, index) => {
    const slot = slotOrder[index]
    return {
      lane,
      row: Math.floor(slot / columns),
      column: slot % columns,
    }
  })
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(
    ...placements.filter(({ column: laneColumn }) => laneColumn === column)
      .map(({ lane }) => lane.width),
    settings.hubMinWidth,
  ))
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(
    ...placements.filter(({ row: laneRow }) => laneRow === row)
      .map(({ lane }) => lane.height),
    settings.hubPadding * 2,
  ))
  const gridWidth = columnWidths.reduce((total, width) => total + width, 0)
    + Math.max(0, columns - 1) * settings.componentGapX
  const gridHeight = rowHeights.reduce((total, height) => total + height, 0)
    + Math.max(0, rows - 1) * settings.componentGapY
  const rowY = []
  rowHeights.forEach((height, row) => {
    rowY[row] = row === 0
      ? 0
      : rowY[row - 1] + rowHeights[row - 1] + settings.componentGapY
  })
  const columnX = []
  columnWidths.forEach((width, column) => {
    columnX[column] = column === 0
      ? 0
      : columnX[column - 1] + columnWidths[column - 1] + settings.componentGapX
  })
  const contentWidth = Math.max(
    settings.minWidth - settings.sectionPadding * 2,
    gridWidth,
  )
  const offsetX = (contentWidth - gridWidth) / 2
  const positioned = placements.map(({ lane, row, column }) => {
    return {
      ...lane,
      x: settings.sectionPadding + offsetX + columnX[column],
      y: settings.sectionHeaderHeight + settings.sectionPadding + rowY[row],
    }
  })
  return {
    width: contentWidth,
    height: gridHeight,
    lanes: positioned,
  }
}

export function createTopologyDiagramLayoutCacheKey({
  model,
  datasetVersionId = model?.datasetVersionId,
  branchId = model?.branchId,
  area = model?.area,
  selectedFamilies = model?.selectedFamilies,
  hideFiltered = false,
  overview = false,
} = {}) {
  const nodeIds = (model?.nodes ?? []).map(({ id }) => id).sort().join(',')
  const edgeIds = (model?.edges ?? []).map(({ id }) => id).sort().join(',')
  const families = [...(selectedFamilies ?? [])].sort().join(',')
  return [
    datasetVersionId ?? '',
    branchId ?? '',
    area ?? '*',
    model?.graphRevision ?? '',
    nodeIds,
    edgeIds,
    (model?.crossAreaEdges ?? []).map(({ id }) => id).sort().join(','),
    model?.summary?.activeAdminLayer ? 'admin' : 'operational',
    (model?.unresolved ?? []).map(({ unresolvedId }) => unresolvedId).sort().join(','),
    (model?.candidates ?? []).map(({ candidateId }) => candidateId).sort().join(','),
    (model?.mountingGroups ?? []).map(({ id, childIds }) => `${id}:${childIds.join(',')}`).sort().join(','),
    families,
    hideFiltered ? 'hide' : 'dim',
    overview ? 'overview' : 'detail',
  ].join('|')
}

export const createTopologyLayoutCacheKey = createTopologyDiagramLayoutCacheKey

/**
 * Updates presentation-only node positions and recomputes every confirmed
 * link route. The source graph is never mutated by this helper.
 */
export function updateTopologyDiagramLayoutPositions(layout, positions = {}) {
  if (!layout || layout.status !== 'ready') return layout
  const positionFor = (id) => positions instanceof Map ? positions.get(id) : positions[id]
  layout.nodes.forEach((node) => {
    const next = positionFor(node.id)
    if (!next || !Number.isFinite(Number(next.x)) || !Number.isFinite(Number(next.y))) return
    const width = node.diagram.width
    const height = node.diagram.height
    node.diagram.x = Number(next.x)
    node.diagram.y = Number(next.y)
    node.diagram.centerX = node.diagram.x + width / 2
    node.diagram.centerY = node.diagram.y + height / 2
    node.diagram.topX = node.diagram.centerX
    node.diagram.topY = node.diagram.y
    node.diagram.bottomX = node.diagram.centerX
    node.diagram.bottomY = node.diagram.y + height
    node.position = { x: node.diagram.x, y: node.diagram.y }
  })
  refreshTopologyDiagramLinks(layout)
  return layout
}

export function refreshTopologyDiagramLinks(layout) {
  if (!layout || layout.status !== 'ready') return layout
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]))
  const settings = layout.options ?? DEFAULT_OPTIONS
  layout.edges = layout.edges.map((edge) => {
    const source = nodeById.get(edge.sourceId)
    const target = nodeById.get(edge.targetId)
    if (!source || !target) return edge
    return {
      ...edge,
      routePoints: routeEdge(source, target),
      linePoints: straightLinkPoints(source, target),
    }
  })
  return layout
}

export function createTopologyLayoutWorkerModel(model) {
  return {
    ...model,
    nodeById: undefined,
    edgeById: undefined,
    adjacency: undefined,
    selectedFamilies: [...(model.selectedFamilies ?? [])],
    traceAssetIds: [...(model.traceAssetIds ?? [])],
    traceEdgeIds: [...(model.traceEdgeIds ?? [])],
  }
}

function buildLaneSpec(args) {
  if (args.settings.layoutStyle === 'central-backbone') {
    return buildCentralBackboneLaneSpec(args)
  }
  return buildSemanticLaneSpec(args)
}

function buildCentralBackboneLaneSpec({ component, index, nodeById, edges, settings }) {
  const componentNodes = component.nodeIds.map((id) => nodeById.get(id)).filter(Boolean)
  const componentNodeIds = new Set(componentNodes.map(({ id }) => id))
  const componentEdges = edges.filter((edge) => (
    componentNodeIds.has(edge.sourceId) && componentNodeIds.has(edge.targetId)
  ))
  const traversal = buildTraversal(component.rootId, componentNodes, componentEdges)
  const traversalIndex = traversal.indexById
  const rootId = componentNodeIds.has(component.rootId)
    ? component.rootId
    : traversal.order[0] ?? componentNodes[0]?.id
  if (!rootId) {
    return {
      kind: 'component',
      componentId: component.componentId,
      title: `Komponen ${String(index + 1).padStart(2, '0')}`,
      rootId: null,
      rootVerified: false,
      rootReason: null,
      x: 0,
      y: 0,
      width: settings.hubMinWidth,
      height: settings.hubPadding * 2,
      nodes: [],
      bands: [],
      edgeCount: 0,
      presentation: 'hub-spoke',
    }
  }

  const parentById = new Map()
  componentNodes.forEach((node) => {
    if (node.id === rootId) return
    const candidate = centralParentFor(node, traversal.parentById, nodeById, rootId)
    parentById.set(node.id, candidate && componentNodeIds.has(candidate) && candidate !== node.id
      ? candidate
      : rootId)
  })
  const childrenById = new Map(componentNodes.map(({ id }) => [id, []]))
  parentById.forEach((parentId, childId) => {
    const children = childrenById.get(parentId)
    if (children) children.push(childId)
    else {
      parentById.set(childId, rootId)
      childrenById.get(rootId).push(childId)
    }
  })

  const semanticLevelFor = (node) => ({
    'rack-root': 0,
    'junction-peer': 1,
    'junction-extended': 2,
    endpoint: 3,
  }[node.diagramClass] ?? Math.max(0, Number(node.depth) || 0))
  const rootSemanticLevel = semanticLevelFor(nodeById.get(rootId) ?? {})
  const levelById = new Map([[rootId, 0]])
  const queue = [rootId]
  while (queue.length) {
    const parentId = queue.shift()
    const parentLevel = levelById.get(parentId) ?? 0
    const childIds = childrenById.get(parentId) ?? []
    childIds.sort((left, right) => (
      (traversalIndex.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (traversalIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
      || left.localeCompare(right, 'id')
    ))
    childIds.forEach((childId) => {
      const child = nodeById.get(childId)
      const semanticLevel = semanticLevelFor(child) - rootSemanticLevel
      levelById.set(childId, Math.max(parentLevel + 1, semanticLevel, 1))
      queue.push(childId)
    })
  }

  // A malformed or disconnected component must still remain visible and
  // deterministic. Attach any node missed by the traversal to the root.
  componentNodes.forEach((node) => {
    if (levelById.has(node.id)) return
    parentById.set(node.id, rootId)
    childrenById.get(rootId).push(node.id)
    levelById.set(node.id, 1)
  })

  const childrenSort = (left, right) => (
    (levelById.get(left) ?? 0) - (levelById.get(right) ?? 0)
      || (traversalIndex.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (traversalIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
      || left.localeCompare(right, 'id')
  )
  childrenById.forEach((children) => children.sort(childrenSort))

  const subtreeWidthById = new Map()
  const subtreeWidthFor = (nodeId) => {
    if (subtreeWidthById.has(nodeId)) return subtreeWidthById.get(nodeId)
    const node = nodeById.get(nodeId)
    const ownWidth = hubNodeSize(node, settings).width
    const children = childrenById.get(nodeId) ?? []
    const childWidth = children.reduce(
      (total, childId) => total + subtreeWidthFor(childId),
      Math.max(0, children.length - 1) * settings.hubNodeGapX,
    )
    const width = Math.max(ownWidth, childWidth)
    subtreeWidthById.set(nodeId, width)
    return width
  }
  const treeWidth = subtreeWidthFor(rootId)
  const levelCount = Math.max(...[...levelById.values(), 0]) + 1
  const rowHeights = Array.from({ length: levelCount }, (_, level) => Math.max(
    ...componentNodes
      .filter((node) => levelById.get(node.id) === level)
      .map((node) => hubNodeSize(node, settings).height),
    settings.hubEndpointHeight,
  ))
  const levelY = []
  rowHeights.forEach((height, level) => {
    levelY[level] = level === 0
      ? settings.hubPadding + settings.hubHeaderHeight
      : levelY[level - 1] + rowHeights[level - 1] + settings.hubLevelGapY
  })
  const laneWidth = Math.max(settings.hubMinWidth, treeWidth + settings.hubPadding * 2)
  const treeStartX = (laneWidth - treeWidth) / 2
  const nodes = []
  const placed = new Set()
  const placeSubtree = (nodeId, left) => {
    if (placed.has(nodeId)) return
    const node = nodeById.get(nodeId)
    if (!node) return
    const subtreeWidth = subtreeWidthFor(nodeId)
    const size = hubNodeSize(node, settings)
    const level = levelById.get(nodeId) ?? 0
    const x = left + (subtreeWidth - size.width) / 2
    nodes.push(toLayoutNode(node, {
      x,
      y: levelY[level] ?? settings.hubPadding,
      width: size.width,
      height: size.height,
      laneId: component.componentId,
      laneIndex: index,
      areaKey: node.areaKey,
      presentation: 'hub-spoke',
      depth: node.depth,
      diagramClass: node.diagramClass,
      semanticTier: node.semanticTier,
      parentId: parentById.get(nodeId) ?? null,
      bandId: hubBandId(node.diagramClass),
      rowIndex: level,
      traversalIndex: traversalIndex.get(node.id) ?? Number.MAX_SAFE_INTEGER,
    }))
    placed.add(nodeId)
    const children = childrenById.get(nodeId) ?? []
    if (!children.length) return
    const childrenWidth = children.reduce(
      (total, childId) => total + subtreeWidthFor(childId),
      Math.max(0, children.length - 1) * settings.hubNodeGapX,
    )
    let childLeft = left + (subtreeWidth - childrenWidth) / 2
    children.forEach((childId) => {
      placeSubtree(childId, childLeft)
      childLeft += subtreeWidthFor(childId) + settings.hubNodeGapX
    })
  }
  placeSubtree(rootId, treeStartX)

  const bandIds = ['rack-root', 'junction-peer', 'junction-extended', 'endpoint']
  const bands = bandIds.map((bandId) => {
    const bandNodes = nodes.filter((node) => node.bandId === bandId)
    const level = Math.max(0, ...bandNodes.map((node) => node.rowIndex))
    return {
      id: bandId,
      title: hubBandTitle(bandId),
      x: 0,
      y: levelY[level] ?? 0,
      width: laneWidth,
      height: rowHeights[level] ?? settings.hubEndpointHeight,
      nodeIds: bandNodes.map(({ id }) => id),
      rowCount: 1,
    }
  }).filter(({ nodeIds }) => nodeIds.length)

  return {
    kind: 'component',
    componentId: component.componentId,
    title: `Jalur ${String(index + 1).padStart(2, '0')}`,
    rootId,
    rootVerified: component.rootVerified,
    rootReason: component.rootReason,
    x: 0,
    y: 0,
    width: laneWidth,
    height: (levelY[levelCount - 1] ?? settings.hubPadding)
      + rowHeights[levelCount - 1] + settings.hubPadding,
    nodes: nodes.sort(compareLayoutNodes),
    bands,
    edgeCount: component.edgeIds.length,
    presentation: 'hub-spoke',
  }
}

function centralParentFor(node, parentById, nodeById, rootId) {
  let candidate = nearestVisualParent(node.id, parentById, nodeById)
  const sameTier = (id) => id && nodeById.get(id)?.diagramClass === node.diagramClass
  while (sameTier(candidate) && candidate !== rootId) {
    candidate = parentById.get(candidate) ?? null
  }
  return candidate || rootId
}

function buildSemanticLaneSpec({ component, index, nodeById, edges, settings }) {
  const componentNodes = component.nodeIds.map((id) => nodeById.get(id)).filter(Boolean)
  const componentEdges = edges.filter((edge) => component.nodeIds.includes(edge.sourceId)
    && component.nodeIds.includes(edge.targetId))
  const traversal = buildTraversal(component.rootId, componentNodes, componentEdges)
  const parentById = traversal.parentById
  const traversalIndex = traversal.indexById
  const visualParentById = new Map(componentNodes.map((node) => [
    node.id,
    nearestVisualParent(node.id, parentById, nodeById),
  ]))
  const groups = {
    rack: componentNodes.filter((node) => node.diagramClass === 'rack-root'),
    peer: componentNodes.filter((node) => node.diagramClass === 'junction-peer'),
    extended: componentNodes.filter((node) => node.diagramClass === 'junction-extended'),
    endpoint: componentNodes.filter((node) => node.diagramClass === 'endpoint'),
  }
  const sortByTraversal = (left, right) => (
    (traversalIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (traversalIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    || String(left.name ?? '').localeCompare(String(right.name ?? ''), 'id')
    || left.id.localeCompare(right.id, 'id')
  )
  const sortByParentThenTraversal = (left, right) => (
    (traversalIndex.get(visualParentById.get(left.id)) ?? Number.MAX_SAFE_INTEGER)
      - (traversalIndex.get(visualParentById.get(right.id)) ?? Number.MAX_SAFE_INTEGER)
    || sortByTraversal(left, right)
  )
  groups.rack.sort(sortByTraversal)
  groups.peer.sort(sortByTraversal)
  groups.extended.sort(sortByParentThenTraversal)
  groups.endpoint.sort(sortByParentThenTraversal)

  const allRows = [
    { id: 'rack-root', label: 'RACK / CORE', nodes: groups.rack, columns: 8, presentation: 'card' },
    { id: 'junction-peer', label: 'JB REGULER · PEER', nodes: groups.peer, columns: settings.peerColumns, presentation: 'card' },
    { id: 'junction-extended', label: 'JB EXTENDED', nodes: groups.extended, columns: settings.extendedColumns, presentation: 'card' },
    { id: 'endpoint', label: 'ENDPOINT', nodes: groups.endpoint, columns: settings.endpointColumns, presentation: 'compact' },
  ].filter(({ nodes }) => nodes.length)

  const maxRowWidth = Math.max(
    settings.nodeWidth,
    ...allRows.flatMap((band) => chunk(band.nodes, band.columns).map((row) => (
      row.reduce((total, node) => total + nodeSize(node, settings).width, 0)
        + Math.max(0, row.length - 1) * settings.nodeGapX
    ))),
  )
  const laneWidth = Math.max(
    settings.minWidth - settings.sectionPadding * 2,
    settings.lanePadding * 2 + maxRowWidth,
  )
  const nodes = []
  const bands = []
  let cursorY = settings.laneHeaderHeight + settings.lanePadding
  allRows.forEach((band) => {
    const rows = chunk(band.nodes, band.columns)
    const rowHeights = rows.map((row) => rowHeight(row, settings))
    const contentHeight = rowHeights.reduce((total, height) => total + height, 0)
      + Math.max(0, rows.length - 1) * settings.nodeGapY
    const height = settings.bandHeaderHeight + 8 + contentHeight + settings.lanePadding
    const bandNodeIds = []
    let rowY = cursorY + settings.bandHeaderHeight + 8
    rows.forEach((row, rowIndex) => {
      const rowWidth = row.reduce((total, node) => total + nodeSize(node, settings).width, 0)
        + Math.max(0, row.length - 1) * settings.nodeGapX
      let x = settings.lanePadding + (laneWidth - settings.lanePadding * 2 - rowWidth) / 2
      row.forEach((node) => {
        const size = nodeSize(node, settings)
        const parentId = visualParentById.get(node.id) ?? null
        const layoutNode = toLayoutNode(node, {
          x,
          y: rowY,
          width: size.width,
          height: size.height,
          laneId: component.componentId,
          laneIndex: index,
          areaKey: node.areaKey,
          presentation: band.presentation,
          depth: node.depth,
          diagramClass: node.diagramClass,
          semanticTier: node.semanticTier,
          parentId,
          bandId: band.id,
          rowIndex,
          traversalIndex: traversalIndex.get(node.id) ?? Number.MAX_SAFE_INTEGER,
        })
        nodes.push(layoutNode)
        bandNodeIds.push(node.id)
        x += size.width + settings.nodeGapX
      })
      rowY += rowHeights[rowIndex] + settings.nodeGapY
    })
    bands.push({
      id: band.id,
      title: band.label,
      kind: band.id,
      x: 0,
      y: cursorY,
      width: laneWidth,
      height,
      nodeIds: bandNodeIds,
      rowCount: rows.length,
    })
    cursorY += height + settings.bandGap
  })

  return {
    kind: 'component',
    componentId: component.componentId,
    // Kept in the layout model for inspector/debugging; the main SVG does not
    // render this component label because component IDs are not user-facing.
    title: `Komponen ${String(index + 1).padStart(2, '0')}`,
    rootId: component.rootId,
    rootVerified: component.rootVerified,
    rootReason: component.rootReason,
    x: 0,
    y: 0,
    width: laneWidth,
    height: cursorY - settings.bandGap + settings.lanePadding,
    nodes,
    bands,
    edgeCount: component.edgeIds.length,
  }
}

function buildIsolatedSpec(nodes, settings) {
  const sorted = [...nodes].sort(compareNodes)
  const columns = Math.max(1, Math.min(8, sorted.length))
  const rows = Math.ceil(sorted.length / columns)
  const width = settings.minWidth - settings.sectionPadding * 2
  const contentWidth = columns * settings.compactWidth
    + Math.max(0, columns - 1) * settings.nodeGapX
  const height = 46 + settings.lanePadding
    + rows * settings.compactHeight + Math.max(0, rows - 1) * 14 + settings.lanePadding
  const layoutNodes = []
  sorted.forEach((node, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const rowCount = Math.min(columns, sorted.length - row * columns)
    const rowWidth = rowCount * settings.compactWidth
      + Math.max(0, rowCount - 1) * settings.nodeGapX
    const rowStart = settings.lanePadding + (width - settings.lanePadding * 2 - rowWidth) / 2
    layoutNodes.push(toLayoutNode(node, {
      x: rowStart + column * (settings.compactWidth + settings.nodeGapX),
      y: 46 + settings.lanePadding + row * (settings.compactHeight + 14),
      width: settings.compactWidth,
      height: settings.compactHeight,
      presentation: 'compact',
      laneId: null,
      areaKey: node.areaKey,
      depth: null,
      diagramClass: node.diagramClass,
      semanticTier: node.semanticTier,
      parentId: null,
      bandId: 'isolated',
      rowIndex: row,
      traversalIndex: Number.MAX_SAFE_INTEGER,
    }))
  })
  return {
    kind: 'isolated',
    title: 'Aset tanpa relasi',
    x: 0,
    y: 0,
    width,
    height,
    nodes: layoutNodes,
    nodeCount: sorted.length,
    disconnectedCount: sorted.filter(({ connectivityStatus }) => connectivityStatus === 'disconnected').length,
    suggestedOnlyCount: sorted.filter(({ connectivityStatus }) => connectivityStatus === 'suggested-only').length,
    contentWidth,
  }
}

function toLayoutNode(node, {
  x,
  y,
  width,
  height,
  laneId = null,
  laneIndex = null,
  areaKey = node.areaKey,
  presentation = 'card',
  depth = node.depth,
  diagramClass = node.diagramClass,
  semanticTier = node.semanticTier,
  parentId = null,
  bandId = null,
  rowIndex = 0,
  traversalIndex = Number.MAX_SAFE_INTEGER,
} = {}) {
  return {
    ...node,
    depth,
    areaKey,
    laneId,
    laneIndex,
    presentation,
    diagramClass,
    semanticTier,
    parentId,
    bandId,
    rowIndex,
    traversalIndex,
    position: { x, y },
    diagram: {
      x,
      y,
      width,
      height,
      centerX: x + width / 2,
      centerY: y + height / 2,
      topX: x + width / 2,
      topY: y,
      bottomX: x + width / 2,
      bottomY: y + height,
    },
  }
}

function translateNode(node, offsetX, offsetY) {
  node.diagram.x += offsetX
  node.diagram.y += offsetY
  node.diagram.centerX += offsetX
  node.diagram.centerY += offsetY
  node.diagram.topX += offsetX
  node.diagram.topY += offsetY
  node.diagram.bottomX += offsetX
  node.diagram.bottomY += offsetY
  node.position = { x: node.diagram.x, y: node.diagram.y }
}

function nodeSize(node, settings) {
  if (node.diagramClass === 'rack-root') {
    return node.isCore
      ? { width: settings.coreWidth, height: settings.coreHeight }
      : { width: settings.distributionWidth, height: settings.distributionHeight }
  }
  if (node.diagramClass === 'junction-peer' || node.diagramClass === 'junction-extended') {
    return { width: settings.distributionWidth, height: settings.distributionHeight }
  }
  if (node.diagramClass === 'endpoint') {
    return { width: settings.endpointWidth, height: settings.endpointHeight }
  }
  return { width: settings.nodeWidth, height: settings.nodeHeight }
}

function hubNodeSize(node, settings) {
  if (node?.diagramClass === 'rack-root') {
    return node.isCore
      ? { width: settings.hubRootWidth, height: settings.hubRootHeight }
      : { width: settings.hubJunctionWidth, height: settings.hubJunctionHeight }
  }
  if (node?.diagramClass === 'junction-peer' || node?.diagramClass === 'junction-extended') {
    return { width: settings.hubJunctionWidth, height: settings.hubJunctionHeight }
  }
  if (node?.diagramClass === 'endpoint') {
    return { width: settings.hubEndpointWidth, height: settings.hubEndpointHeight }
  }
  return { width: settings.nodeWidth, height: settings.nodeHeight }
}

function hubBandId(diagramClass) {
  return ['rack-root', 'junction-peer', 'junction-extended', 'endpoint'].includes(diagramClass)
    ? diagramClass
    : 'endpoint'
}

function hubBandTitle(bandId) {
  return {
    'rack-root': 'RACK / CORE',
    'junction-peer': 'JB REGULER · PEER',
    'junction-extended': 'JB EXTENDED',
    endpoint: 'ENDPOINT',
  }[bandId] ?? 'ENDPOINT'
}

function compareComponentPriority(left, right, nodeById) {
  const leftNodes = left.nodeIds.map((id) => nodeById.get(id)).filter(Boolean)
  const rightNodes = right.nodeIds.map((id) => nodeById.get(id)).filter(Boolean)
  const rank = (nodes) => {
    if (nodes.some((node) => node.diagramClass === 'rack-root')) return 0
    if (nodes.some((node) => node.isVerifiedRoot)) return 1
    if (nodes.some((node) => node.diagramClass === 'junction-peer')) return 2
    return 3
  }
  return rank(leftNodes) - rank(rightNodes)
    || Number(right.suggestedLinkIds?.length > 0) - Number(left.suggestedLinkIds?.length > 0)
}

function buildTraversal(rootId, nodes, edges) {
  const nodeIds = new Set(nodes.map(({ id }) => id))
  const adjacency = new Map(nodes.map(({ id }) => [id, []]))
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) return
    adjacency.get(edge.sourceId).push(edge.targetId)
    adjacency.get(edge.targetId).push(edge.sourceId)
  })
  adjacency.forEach((neighbors) => neighbors.sort((left, right) => left.localeCompare(right, 'id')))
  const order = []
  const indexById = new Map()
  const parentById = new Map()
  const visited = new Set()
  const visit = (start) => {
    if (!start || !nodeIds.has(start) || visited.has(start)) return
    const queue = [start]
    visited.add(start)
    while (queue.length) {
      const current = queue.shift()
      indexById.set(current, order.length)
      order.push(current)
      ;(adjacency.get(current) ?? []).forEach((next) => {
        if (visited.has(next)) return
        visited.add(next)
        parentById.set(next, current)
        queue.push(next)
      })
    }
  }
  visit(rootId)
  nodes.map(({ id }) => id).sort((left, right) => left.localeCompare(right, 'id')).forEach(visit)
  return { order, indexById, parentById }
}

function nearestVisualParent(id, parentById, nodeById) {
  let parentId = parentById.get(id) ?? null
  const seen = new Set([id])
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = nodeById.get(parentId)
    if (!parent || parent.diagramClass !== 'endpoint') return parentId
    parentId = parentById.get(parentId) ?? null
  }
  return parentId
}

function chunk(items, size) {
  const result = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function straightLinkPoints(source, target) {
  if (!source || !target) return []
  const sourceBox = source.diagram
  const targetBox = target.diagram
  if (Math.abs(targetBox.centerY - sourceBox.centerY) < 10) {
    return targetBox.centerX >= sourceBox.centerX
      ? [
        { x: sourceBox.x + sourceBox.width, y: sourceBox.centerY },
        { x: targetBox.x, y: targetBox.centerY },
      ]
      : [
        { x: sourceBox.x, y: sourceBox.centerY },
        { x: targetBox.x + targetBox.width, y: targetBox.centerY },
      ]
  }
  return targetBox.centerY >= sourceBox.centerY
    ? [
      { x: sourceBox.centerX, y: sourceBox.bottomY },
      { x: targetBox.centerX, y: targetBox.topY },
    ]
    : [
      { x: sourceBox.centerX, y: sourceBox.topY },
      { x: targetBox.centerX, y: targetBox.bottomY },
    ]
}

function rowHeight(nodes, settings) {
  return Math.max(...nodes.map((node) => nodeSize(node, settings).height), settings.nodeHeight)
}

function routeEdge(source, target) {
  if (!source || !target) return []
  const sourceBox = source.diagram
  const targetBox = target.diagram
  const sourceCenter = { x: sourceBox.centerX, y: sourceBox.centerY }
  const targetCenter = { x: targetBox.centerX, y: targetBox.centerY }
  if (Math.abs(targetCenter.y - sourceCenter.y) < 10) {
    const sourceRight = targetCenter.x >= sourceCenter.x
    const sourcePoint = {
      x: sourceRight ? sourceBox.x + sourceBox.width : sourceBox.x,
      y: sourceCenter.y,
    }
    const targetPoint = {
      x: sourceRight ? targetBox.x : targetBox.x + targetBox.width,
      y: targetCenter.y,
    }
    return [sourcePoint, targetPoint]
  }
  const sourceBelow = targetCenter.y >= sourceCenter.y
  const sourcePoint = {
    x: sourceCenter.x,
    y: sourceBelow ? sourceBox.bottomY : sourceBox.topY,
  }
  const targetPoint = {
    x: targetCenter.x,
    y: sourceBelow ? targetBox.topY : targetBox.bottomY,
  }
  if (Math.abs(targetPoint.x - sourcePoint.x) < 1) {
    return [sourcePoint, targetPoint]
  }
  const middleY = sourcePoint.y + (targetPoint.y - sourcePoint.y) / 2
  // Route through the whitespace between hierarchy rows. This keeps links away
  // from device names and prevents a parent's horizontal segment from crossing
  // sibling cards.
  return [
    sourcePoint,
    { x: sourcePoint.x, y: middleY },
    { x: targetPoint.x, y: middleY },
    targetPoint,
  ]
}

function compactPoints(points) {
  return points.filter((point, index) => index === 0
    || point.x !== points[index - 1].x
    || point.y !== points[index - 1].y)
}

function buildCrossAreaMarkers(edges = [], layoutNodes = new Map(), width = 0) {
  const offsetsByNode = new Map()
  return (Array.isArray(edges) ? edges : []).flatMap((edge) => {
    const node = layoutNodes.get(edge.insideNodeId)
    if (!node) return []
    const index = offsetsByNode.get(node.id) ?? 0
    offsetsByNode.set(node.id, index + 1)
    const label = `Area ${edge.outsideAreaName || edge.outsideAreaKey || 'lainnya'}`
    const labelWidth = Math.max(104, label.length * 5.3 + 26)
    const placeRight = node.diagram.x + node.diagram.width + labelWidth + 28 < width
    const gatewayX = placeRight
      ? node.diagram.x + node.diagram.width + 20
      : Math.max(14, node.diagram.x - labelWidth - 20)
    const anchorX = placeRight ? node.diagram.x + node.diagram.width : node.diagram.x
    const y = node.diagram.centerY + index * 18 - 9
    return [{
      id: `cross-area:${edge.id}`,
      edgeId: edge.id,
      nodeId: node.id,
      x: gatewayX,
      y,
      anchorX,
      anchorY: node.diagram.centerY,
      width: labelWidth,
      height: 22,
      label,
      outsideAreaKey: edge.outsideAreaKey,
      outsideAreaName: edge.outsideAreaName,
    }]
  })
}

function validateLayoutBounds(layout) {
  const extents = []
  layout.sections.forEach((section) => extents.push({
    minX: section.x,
    minY: section.y,
    maxX: section.x + section.width,
    maxY: section.y + section.height,
  }))
  layout.nodes.forEach((node) => extents.push({
    minX: node.diagram.x,
    minY: node.diagram.y,
    maxX: node.diagram.x + node.diagram.width,
    maxY: node.diagram.y + node.diagram.height,
  }))
  layout.edges.forEach((edge) => edge.routePoints.forEach((point) => extents.push({
    minX: point.x,
    minY: point.y,
    maxX: point.x,
    maxY: point.y,
  })))
  ;(layout.crossAreaMarkers ?? []).forEach((marker) => extents.push({
    minX: marker.x,
    minY: marker.y,
    maxX: marker.x + marker.width,
    maxY: marker.y + marker.height,
  }))
  const minX = Math.min(0, ...extents.map(({ minX: value }) => value))
  const minY = Math.min(0, ...extents.map(({ minY: value }) => value))
  const maxX = Math.max(layout.width, ...extents.map(({ maxX: value }) => value))
  const maxY = Math.max(layout.height, ...extents.map(({ maxY: value }) => value))
  const width = Math.max(layout.width, maxX + 1)
  const height = Math.max(layout.height, maxY + 1)
  return {
    ...layout,
    bounds: { minX, minY, maxX: width, maxY: height },
    width,
    height,
  }
}

function compareNodes(left, right) {
  return Number(right.isVerifiedRoot) - Number(left.isVerifiedRoot)
    || Number(right.isCore) - Number(left.isCore)
    || String(left.name ?? '').localeCompare(String(right.name ?? ''), 'id')
    || left.id.localeCompare(right.id, 'id')
}

function compareLayoutNodes(left, right) {
  return String(left.areaKey).localeCompare(String(right.areaKey), 'id')
    || String(left.laneId ?? '').localeCompare(String(right.laneId ?? ''), 'id')
    || String(left.semanticTier ?? '').localeCompare(String(right.semanticTier ?? ''), 'id')
    || Number(left.traversalIndex ?? Number.MAX_SAFE_INTEGER)
      - Number(right.traversalIndex ?? Number.MAX_SAFE_INTEGER)
    || left.diagram.y - right.diagram.y
    || left.diagram.x - right.diagram.x
    || left.id.localeCompare(right.id, 'id')
}
