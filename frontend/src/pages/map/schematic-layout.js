import { chooseDiagramAnchors } from './schematic-anchor.js'
import { calculateDiagramBounds } from './schematic-bounds.js'
import { routeOrthogonalEdges } from './schematic-edge-routing.js'
import { placeNodeLabels } from './schematic-label-layout.js'

const DEFAULT_OPTIONS = Object.freeze({
  marginX: 58,
  headerHeight: 106,
  footerHeight: 112,
  nodeWidth: 132,
  nodeHeight: 68,
  overviewNodeWidth: 212,
  overviewNodeHeight: 96,
  columnGap: 82,
  rowGap: 30,
  sectionGap: 42,
  sectionPadding: 24,
  sectionTitleHeight: 26,
  minWidth: 760,
  maxTraceColumns: 6,
  maxIsolatedNodes: 12,
  isolatedColumns: 5,
})

export function calculateSchematicLayout(graph, options = {}) {
  if (graph.status !== 'ready') {
    return {
      status: graph.status,
      nodes: [],
      edges: [],
      sections: [],
      width: 0,
      height: 0,
    }
  }

  const settings = resolveLayoutSettings(graph, options)
  const labeledNodes = placeNodeLabels(graph.nodes)
  if (graph.mode === 'overview') {
    return calculateOverviewLayout({
      ...graph,
      nodes: labeledNodes,
    }, settings)
  }
  if (graph.mode === 'trace') {
    return calculateTraceLayout({
      ...graph,
      nodes: labeledNodes,
    }, settings)
  }
  return calculateHierarchicalLayout({
    ...graph,
    nodes: labeledNodes,
  }, settings)
}

/**
 * Places each connected component in its own section. Isolated inventory
 * assets are deliberately separated from the primary connection lanes.
 */
export function calculateHierarchicalLayout(graph, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options }
  const anchorPlan = chooseDiagramAnchors(graph)
  const nodeBySourceId = new Map(graph.nodes.map((node) => [node.id, node]))
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]))
  const laidOutNodes = []
  const sections = []
  const treeEdgeIds = new Set()
  const sectionByNodeId = new Map()
  let cursorY = settings.headerHeight + settings.sectionTitleHeight
  let maximumRight = settings.minWidth - settings.marginX

  anchorPlan.components.forEach((component, index) => {
    const componentNodes = component.nodeIds.map((id) => nodeBySourceId.get(id))
    const componentEdges = component.edgeIds.map((id) => edgeById.get(id))
    const result = layoutConnectedComponent({
      nodes: componentNodes,
      edges: componentEdges,
      anchorId: component.anchorId,
      startX: settings.marginX,
      startY: cursorY + settings.sectionPadding,
      settings,
    })
    laidOutNodes.push(...result.nodes)
    result.treeEdgeIds.forEach((id) => treeEdgeIds.add(id))
    component.nodeIds.forEach((id) => sectionByNodeId.set(id, component.id))
    const section = {
      id: component.id,
      title: componentSectionTitle(index, anchorPlan.components.length),
      kind: 'connected-component',
      nodeIds: component.nodeIds,
      bounds: {
        x: settings.marginX - settings.sectionPadding,
        y: cursorY,
        width: result.width + settings.sectionPadding * 2,
        height: result.height + settings.sectionPadding * 2,
      },
    }
    sections.push(section)
    cursorY += section.bounds.height + settings.sectionGap
    maximumRight = Math.max(maximumRight, section.bounds.x + section.bounds.width)
  })

  if (anchorPlan.isolatedNodeIds.length) {
    const isolatedResult = layoutIsolatedSection({
      nodes: anchorPlan.isolatedNodeIds.map((id) => nodeBySourceId.get(id)),
      startX: settings.marginX,
      startY: cursorY + settings.sectionPadding,
      settings,
    })
    laidOutNodes.push(...isolatedResult.nodes)
    isolatedResult.sourceNodeIds.forEach((id) => {
      sectionByNodeId.set(id, 'section:isolated')
    })
    const isolatedSection = {
      id: 'section:isolated',
      title: 'Aset tanpa relasi',
      kind: 'isolated',
      nodeIds: isolatedResult.sourceNodeIds,
      aggregateCount: isolatedResult.aggregateCount,
      bounds: {
        x: settings.marginX - settings.sectionPadding,
        y: cursorY,
        width: isolatedResult.width + settings.sectionPadding * 2,
        height: isolatedResult.height + settings.sectionPadding * 2,
      },
    }
    sections.push(isolatedSection)
    cursorY += isolatedSection.bounds.height + settings.sectionGap
    maximumRight = Math.max(
      maximumRight,
      isolatedSection.bounds.x + isolatedSection.bounds.width,
    )
  }

  const laidOutNodeById = new Map(laidOutNodes.map((node) => [node.id, node]))
  const laidOutEdges = routeOrthogonalEdges(graph.edges, laidOutNodeById, {
    treeEdgeIds,
    sectionByNodeId,
  })
  const provisionalHeight = Math.max(
    settings.headerHeight + settings.footerHeight + 120,
    cursorY - settings.sectionGap + settings.footerHeight,
  )
  const provisionalWidth = Math.max(
    settings.minWidth,
    maximumRight + settings.marginX,
  )
  return finalizeLayout({
    strategy: 'hierarchical-layered',
    graph,
    settings,
    nodes: laidOutNodes,
    edges: laidOutEdges,
    sections,
    width: provisionalWidth,
    height: provisionalHeight,
    anchorPlan,
  })
}

function calculateOverviewLayout(graph, settings) {
  const columnCount = Math.min(3, Math.max(1, graph.nodes.length))
  const rowCount = Math.ceil(graph.nodes.length / columnCount)
  const cellWidth = settings.overviewNodeWidth + settings.columnGap
  const cellHeight = settings.overviewNodeHeight + settings.rowGap
  const nodes = [...graph.nodes]
    .sort((left, right) => (
      Number(right.isAnchor) - Number(left.isAnchor)
      || categoryOrder(left.category) - categoryOrder(right.category)
      || left.id.localeCompare(right.id)
    ))
    .map((node, index) => {
      const column = index % columnCount
      const row = Math.floor(index / columnCount)
      return placeNode(node, {
        x: settings.marginX + settings.sectionPadding + column * cellWidth,
        y: settings.headerHeight + settings.sectionTitleHeight
          + settings.sectionPadding + row * cellHeight,
        depth: column,
        width: settings.overviewNodeWidth,
        height: settings.overviewNodeHeight,
      })
    })
  const contentWidth = columnCount * settings.overviewNodeWidth
    + Math.max(0, columnCount - 1) * settings.columnGap
  const contentHeight = rowCount * settings.overviewNodeHeight
    + Math.max(0, rowCount - 1) * settings.rowGap
  const section = {
    id: 'section:overview',
    title: 'Ringkasan jaringan Pengapon',
    kind: 'overview',
    nodeIds: nodes.map(({ id }) => id),
    bounds: {
      x: settings.marginX,
      y: settings.headerHeight + settings.sectionTitleHeight,
      width: contentWidth + settings.sectionPadding * 2,
      height: contentHeight + settings.sectionPadding * 2,
    },
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges = routeOrthogonalEdges(graph.edges, nodeById, {
    treeEdgeIds: new Set(graph.edges.map(({ id }) => id)),
    sectionByNodeId: new Map(nodes.map(({ id }) => [id, section.id])),
  })
  const width = Math.max(
    settings.minWidth,
    section.bounds.x + section.bounds.width + settings.marginX,
  )
  const height = section.bounds.y + section.bounds.height + settings.footerHeight
  return finalizeLayout({
    strategy: 'overview-aggregate',
    graph,
    settings,
    nodes,
    edges,
    sections: [section],
    width,
    height,
    anchorPlan: chooseDiagramAnchors(graph),
  })
}

function calculateTraceLayout(graph, settings) {
  const columnCount = Math.min(graph.nodes.length, settings.maxTraceColumns)
  const rowCount = Math.max(1, Math.ceil(graph.nodes.length / columnCount))
  const nodes = graph.nodes.map((node, index) => {
    const row = Math.floor(index / columnCount)
    const positionInRow = index % columnCount
    const column = row % 2 === 0
      ? positionInRow
      : columnCount - 1 - positionInRow
    return placeNode(node, {
      x: settings.marginX + settings.sectionPadding
        + column * (settings.nodeWidth + settings.columnGap),
      y: settings.headerHeight + settings.sectionTitleHeight
        + settings.sectionPadding
        + row * (settings.nodeHeight + settings.rowGap),
      depth: index,
      width: settings.nodeWidth,
      height: settings.nodeHeight,
    })
  })
  const contentWidth = columnCount * settings.nodeWidth
    + Math.max(0, columnCount - 1) * settings.columnGap
  const contentHeight = rowCount * settings.nodeHeight
    + Math.max(0, rowCount - 1) * settings.rowGap
  const section = {
    id: 'section:trace',
    title: 'Urutan jalur tracing',
    kind: 'trace',
    nodeIds: nodes.map(({ id }) => id),
    bounds: {
      x: settings.marginX,
      y: settings.headerHeight + settings.sectionTitleHeight,
      width: contentWidth + settings.sectionPadding * 2,
      height: contentHeight + settings.sectionPadding * 2,
    },
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges = routeTraceEdges(graph.edges, nodeById)
  return finalizeLayout({
    strategy: 'trace-layered',
    graph,
    settings,
    nodes,
    edges,
    sections: [section],
    width: Math.max(
      settings.minWidth,
      section.bounds.x + section.bounds.width + settings.marginX,
    ),
    height: section.bounds.y + section.bounds.height + settings.footerHeight,
    anchorPlan: chooseDiagramAnchors(graph),
  })
}

function layoutConnectedComponent({
  nodes,
  edges,
  anchorId,
  startX,
  startY,
  settings,
}) {
  const tree = buildLayeredTree(nodes, edges, anchorId)
  const groups = groupByDepth(nodes, tree.depths, tree.parents)
  const maxRows = Math.max(...groups.map(({ nodes: group }) => group.length), 1)
  const maxDepth = Math.max(...groups.map(({ depth }) => depth), 0)
  const columnWidth = Math.max(
    settings.nodeWidth,
    ...nodes.map((node) => nodeWidth(node, settings)),
  )
  const componentHeight = maxRows * settings.nodeHeight
    + Math.max(0, maxRows - 1) * settings.rowGap
  const laidOut = []

  groups.forEach(({ depth, nodes: group }) => {
    const groupHeight = group.length * settings.nodeHeight
      + Math.max(0, group.length - 1) * settings.rowGap
    const groupStartY = startY + (componentHeight - groupHeight) / 2
    group.forEach((node, rowIndex) => {
      const width = nodeWidth(node, settings)
      const height = nodeHeight(node, settings)
      laidOut.push(placeNode(node, {
        x: startX + depth * (columnWidth + settings.columnGap)
          + (columnWidth - width) / 2,
        y: groupStartY + rowIndex * (settings.nodeHeight + settings.rowGap)
          + (settings.nodeHeight - height) / 2,
        depth,
        parentId: tree.parents.get(node.id) || null,
        width,
        height,
      }))
    })
  })

  return {
    nodes: laidOut,
    treeEdgeIds: tree.treeEdgeIds,
    width: (maxDepth + 1) * columnWidth + maxDepth * settings.columnGap,
    height: componentHeight,
  }
}

function buildLayeredTree(nodes, edges, anchorId) {
  const adjacency = new Map(nodes.map(({ id }) => [id, []]))
  edges.forEach((edge) => {
    adjacency.get(edge.sourceId)?.push({ nodeId: edge.targetId, edge })
    adjacency.get(edge.targetId)?.push({ nodeId: edge.sourceId, edge })
  })
  const depths = new Map([[anchorId, 0]])
  const parents = new Map()
  const treeEdgeIds = new Set()
  const queue = [anchorId]

  while (queue.length) {
    const currentId = queue.shift()
    const currentDepth = depths.get(currentId)
    ;[...(adjacency.get(currentId) || [])]
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
      .forEach(({ nodeId, edge }) => {
        if (depths.has(nodeId)) return
        depths.set(nodeId, currentDepth + 1)
        parents.set(nodeId, currentId)
        treeEdgeIds.add(edge.id)
        queue.push(nodeId)
      })
  }
  return { depths, parents, treeEdgeIds }
}

function groupByDepth(nodes, depths, parents) {
  const groups = new Map()
  nodes.forEach((node) => {
    const depth = depths.get(node.id) || 0
    groups.set(depth, [...(groups.get(depth) || []), node])
  })
  return [...groups]
    .sort(([left], [right]) => left - right)
    .map(([depth, group]) => ({
      depth,
      nodes: [...group].sort((left, right) => (
        ancestryKey(left.id, parents).localeCompare(ancestryKey(right.id, parents))
        || Number(right.isConnector) - Number(left.isConnector)
        || left.id.localeCompare(right.id)
      )),
    }))
}

function ancestryKey(nodeId, parents) {
  const path = [nodeId]
  const visited = new Set(path)
  let current = parents.get(nodeId)
  while (current && !visited.has(current)) {
    path.unshift(current)
    visited.add(current)
    current = parents.get(current)
  }
  return path.join('/')
}

function layoutIsolatedSection({
  nodes,
  startX,
  startY,
  settings,
}) {
  if (nodes.length > settings.maxIsolatedNodes) {
    const aggregate = placeNode({
      id: 'isolated:aggregate',
      name: 'Aset tanpa relasi',
      shortName: `${nodes.length} aset`,
      shortLabel: 'Aset tanpa relasi',
      type: 'Aset terisolasi',
      category: 'infrastructure',
      isGroup: true,
      isIsolatedAggregate: true,
      memberCount: nodes.length,
      memberIds: nodes.map(({ id }) => id),
      memberLabels: nodes.map((node) => (
        node.shortLabel || node.shortName || node.name || node.id
      )),
      location: 'Tidak mempunyai edge pada scope diagram ini',
      isConnector: false,
    }, {
      x: startX,
      y: startY,
      depth: 0,
      width: settings.overviewNodeWidth,
      height: settings.overviewNodeHeight,
    })
    return {
      nodes: [aggregate],
      sourceNodeIds: nodes.map(({ id }) => id),
      aggregateCount: nodes.length,
      width: settings.overviewNodeWidth,
      height: settings.overviewNodeHeight,
    }
  }

  const columnCount = Math.min(settings.isolatedColumns, nodes.length)
  const rowCount = Math.ceil(nodes.length / columnCount)
  const laidOut = [...nodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node, index) => placeNode(node, {
      x: startX + (index % columnCount)
        * (settings.nodeWidth + settings.columnGap / 2),
      y: startY + Math.floor(index / columnCount)
        * (settings.nodeHeight + settings.rowGap),
      depth: null,
      width: settings.nodeWidth,
      height: settings.nodeHeight,
      isolated: true,
    }))
  return {
    nodes: laidOut,
    sourceNodeIds: nodes.map(({ id }) => id),
    aggregateCount: nodes.length,
    width: columnCount * settings.nodeWidth
      + Math.max(0, columnCount - 1) * settings.columnGap / 2,
    height: rowCount * settings.nodeHeight
      + Math.max(0, rowCount - 1) * settings.rowGap,
  }
}

function placeNode(node, {
  x,
  y,
  depth,
  parentId = null,
  width,
  height,
  isolated = false,
}) {
  const virtual = node.isVirtual === true
  const group = node.isGroup === true
  const core = node.isCoreNode === true || /\bcore\s*switch\b/i.test(node.type || '')
  const radius = virtual ? 5 : group ? 0 : core ? 12 : node.isConnector ? 10 : 8
  const nodeX = group ? x + width / 2 : x + width / 2
  const nodeY = group ? y + height / 2 : virtual ? y + height / 2 : y + 16
  return {
    ...node,
    depth,
    parentId,
    isCoreNode: core,
    isIsolated: isolated,
    diagram: {
      x,
      y,
      width,
      height,
      nodeX,
      nodeY,
      radius,
      labelX: x + width / 2,
      labelY: virtual ? nodeY : group ? y + 30 : y + 38,
      anchorLeft: { x: group ? x : nodeX - radius, y: nodeY },
      anchorRight: { x: group ? x + width : nodeX + radius, y: nodeY },
      anchorTop: { x: nodeX, y: group ? y : nodeY - radius },
      anchorBottom: { x: nodeX, y: group ? y + height : nodeY + radius },
    },
  }
}

function routeTraceEdges(edges, nodeById) {
  return edges.map((edge, index) => {
    const source = nodeById.get(edge.sourceId)
    const target = nodeById.get(edge.targetId)
    if (!source || !target) return { ...edge, routePoints: [] }
    const sameRow = Math.abs(source.diagram.y - target.diagram.y) < 1
    if (sameRow) {
      const forward = source.diagram.nodeX <= target.diagram.nodeX
      const start = forward ? source.diagram.anchorRight : source.diagram.anchorLeft
      const end = forward ? target.diagram.anchorLeft : target.diagram.anchorRight
      return { ...edge, routeKind: 'trace', laneOffset: 0, routePoints: [start, end] }
    }
    const start = source.diagram.anchorBottom
    const end = target.diagram.anchorTop
    const middleY = (start.y + end.y) / 2
    return {
      ...edge,
      routeKind: 'trace-wrap',
      laneOffset: index % 2 ? 2 : -2,
      routePoints: [
        start,
        { x: start.x, y: middleY },
        { x: end.x, y: middleY },
        end,
      ],
    }
  })
}

function finalizeLayout({
  strategy,
  graph,
  settings,
  nodes,
  edges,
  sections,
  width,
  height,
  anchorPlan,
}) {
  const contentBounds = calculateDiagramBounds({
    nodes,
    edges,
    sections,
    headerHeight: settings.headerHeight,
    footerHeight: 0,
  })
  const finalWidth = Math.max(width, contentBounds.maxX + settings.marginX)
  const finalHeight = Math.max(height, contentBounds.maxY + settings.footerHeight)
  return {
    status: 'ready',
    strategy,
    width: finalWidth,
    height: finalHeight,
    diagramBounds: {
      minX: 0,
      minY: 0,
      maxX: finalWidth,
      maxY: finalHeight,
      width: finalWidth,
      height: finalHeight,
    },
    contentBounds,
    options: settings,
    nodes,
    edges,
    sections,
    anchorPlan,
    sourceGraph: graph,
  }
}

function resolveLayoutSettings(graph, options) {
  const compact = graph.layoutDensity === 'compact'
  return {
    ...DEFAULT_OPTIONS,
    ...(compact ? {
      nodeWidth: 112,
      nodeHeight: 58,
      columnGap: 58,
      rowGap: 22,
      maxIsolatedNodes: 8,
    } : {}),
    ...options,
  }
}

function nodeWidth(node, settings) {
  if (node.isVirtual) return 32
  if (node.isGroup) return settings.overviewNodeWidth
  if (node.isCoreNode || /\bcore\s*switch\b/i.test(node.type || '')) {
    return settings.nodeWidth + 10
  }
  return settings.nodeWidth
}

function nodeHeight(node, settings) {
  if (node.isVirtual) return 32
  if (node.isGroup) return settings.overviewNodeHeight
  if (node.isCoreNode || /\bcore\s*switch\b/i.test(node.type || '')) {
    return settings.nodeHeight + 6
  }
  return settings.nodeHeight
}

function componentSectionTitle(index, count) {
  return count > 1 ? `Komponen jaringan ${index + 1}` : 'Jaringan terhubung'
}

function categoryOrder(category) {
  return {
    cctv: 1,
    'fiber-optic': 2,
    lan: 3,
    infrastructure: 4,
    peripheral: 5,
  }[category] || 99
}

export const schematicLayoutInternals = {
  buildLayeredTree,
  groupByDepth,
  layoutIsolatedSection,
  placeNode,
}
