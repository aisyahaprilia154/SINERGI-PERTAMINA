const DEFAULT_OPTIONS = {
  marginX: 58,
  headerHeight: 106,
  footerHeight: 112,
  nodeWidth: 176,
  nodeHeight: 68,
  columnGap: 96,
  rowGap: 30,
  minWidth: 760,
  maxTraceColumns: 6,
  mapWidth: 1100,
  mapContentHeight: 650,
}

export function calculateSchematicLayout(graph, options = {}) {
  if (graph.status !== 'ready') {
    return { status: graph.status, nodes: [], edges: [], width: 0, height: 0 }
  }

  const settings = { ...DEFAULT_OPTIONS, ...options }
  if (graph.mode === 'all-assets') {
    return calculateSingleCanvasEvidenceLayout(graph, settings)
  }
  if (graph.mode === 'full-map') {
    return calculateCategorySectionLayout(graph, settings)
  }
  if (graph.mode === 'selected') {
    return calculateSelectedRelationLayout(graph, settings)
  }
  if (options.preserveMapOrientation && canUseSourcePositions(graph)) {
    return calculateMapRelativeLayout(graph, settings)
  }
  if (graph.mode === 'trace') return calculateTraceLayout(graph, settings)

  const depths = calculateDepths(graph)
  const groupedNodes = groupNodesByDepth(graph.nodes, depths)
  const maxRows = Math.max(...[...groupedNodes.values()].map((nodes) => nodes.length), 1)
  const columnCount = Math.max(groupedNodes.size, 1)
  const contentHeight = maxRows * settings.nodeHeight
    + Math.max(0, maxRows - 1) * settings.rowGap
  const width = Math.max(
    settings.minWidth,
    settings.marginX * 2
      + columnCount * settings.nodeWidth
      + Math.max(0, columnCount - 1) * settings.columnGap,
  )
  const height = settings.headerHeight + contentHeight + settings.footerHeight
  const nodeById = new Map()

  for (const [depth, nodes] of groupedNodes) {
    const groupHeight = nodes.length * settings.nodeHeight
      + Math.max(0, nodes.length - 1) * settings.rowGap
    const startY = settings.headerHeight + (contentHeight - groupHeight) / 2
    nodes.forEach((node, rowIndex) => {
      const x = settings.marginX + depth * (settings.nodeWidth + settings.columnGap)
      const y = startY + rowIndex * (settings.nodeHeight + settings.rowGap)
      nodeById.set(node.id, {
        ...node,
        depth,
        parentId: findParentId(node.id, depth, graph.edges, depths),
        diagram: {
          x,
          y,
          width: settings.nodeWidth,
          height: settings.nodeHeight,
          nodeX: x + settings.nodeWidth / 2,
          nodeY: y + 14,
          labelX: x + settings.nodeWidth / 2,
          labelY: y + 35,
        },
      })
    })
  }

  const laidOutEdges = layoutEdges(graph.edges, nodeById)

  return {
    status: 'ready',
    width,
    height,
    options: settings,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)),
    edges: laidOutEdges,
  }
}

function calculateSelectedRelationLayout(graph, settings) {
  const focus = graph.anchorAssetId || graph.nodes[0]?.id
  const neighbors = graph.nodes
    .filter((node) => node.id !== focus)
    .sort((left, right) => (
      String(left.type || '').localeCompare(String(right.type || ''))
      || String(left.name || left.id).localeCompare(String(right.name || right.id), 'id')
  ))
  const rowGap = Math.max(settings.rowGap, 24)
  const isSingleRelation = neighbors.length === 1
  const leftNeighbors = isSingleRelation
    ? []
    : neighbors.slice(0, Math.ceil(neighbors.length / 2))
  const rightNeighbors = isSingleRelation
    ? neighbors
    : neighbors.slice(Math.ceil(neighbors.length / 2))
  const rowCount = Math.max(leftNeighbors.length, rightNeighbors.length, 1)
  const contentHeight = Math.max(settings.nodeHeight, rowCount * settings.nodeHeight
    + Math.max(0, rowCount - 1) * rowGap) + 48
  const width = Math.max(
    isSingleRelation ? settings.marginX * 2 + settings.nodeWidth * 2 + settings.columnGap
      : settings.marginX * 2 + settings.nodeWidth * 3 + settings.columnGap * 2,
    isSingleRelation ? 520 : settings.minWidth,
  )
  const height = settings.headerHeight + contentHeight + settings.footerHeight
  const nodeById = new Map()
  const contentTop = settings.headerHeight + 24
  const focusColumn = isSingleRelation ? 0 : 1
  const focusY = contentTop + (contentHeight - 48 - settings.nodeHeight) / 2
  nodeById.set(focus, createDiagramNode(graph.nodes.find((node) => node.id === focus), {
    x: settings.marginX + focusColumn * (settings.nodeWidth + settings.columnGap),
    y: focusY,
    depth: 0,
    parentId: null,
    settings,
  }))
  const startY = contentTop + (contentHeight - 48 - (
    rowCount * settings.nodeHeight + Math.max(0, rowCount - 1) * rowGap
  )) / 2
  leftNeighbors.forEach((node, index) => {
    nodeById.set(node.id, createDiagramNode(node, {
      x: settings.marginX,
      y: startY + index * (settings.nodeHeight + rowGap),
      depth: 1,
      parentId: focus,
      settings,
    }))
  })
  rightNeighbors.forEach((node, index) => {
    nodeById.set(node.id, createDiagramNode(node, {
      x: settings.marginX + (settings.nodeWidth + settings.columnGap) * (isSingleRelation ? 1 : 2),
      y: startY + index * (settings.nodeHeight + rowGap),
      depth: 1,
      parentId: focus,
      settings,
    }))
  })
  return finalizeLayout({
    status: 'ready',
    strategy: 'selected-relation-branch',
    width,
    height,
    options: settings,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)).filter(Boolean),
    edges: layoutEdges(graph.edges, nodeById),
    defaultZoom: 1,
    focusNodeId: focus,
  }, settings)
}

function calculateFullGraphLayout(graph, settings) {
  const allAssetSettings = { ...settings, headerHeight: Math.max(settings.headerHeight, 122) }
  const connectedNodeIds = new Set(graph.edges.flatMap((edge) => [edge.sourceId, edge.targetId]))
  const isolated = graph.nodes.filter((node) => !connectedNodeIds.has(node.id))
  const components = connectedComponents(graph)
    .filter((component) => component.length > 1)
    .sort((left, right) => left[0].localeCompare(right[0], 'id'))
  const nodeById = new Map()
  const componentGap = Math.max(allAssetSettings.rowGap * 2, 48)
  const componentSpecs = components.map((component, componentIndex) => {
    const componentNodes = graph.nodes.filter((node) => component.includes(node.id))
    const componentEdges = graph.edges.filter((edge) => component.includes(edge.sourceId)
      && component.includes(edge.targetId))
    const root = chooseComponentRoot(componentNodes, componentEdges, graph.anchorAssetId)
    const depths = calculateComponentDepths(root, componentNodes, componentEdges)
    const grouped = groupNodesByDepth(componentNodes, depths)
    const maxRows = Math.max(...[...grouped.values()].map((nodes) => nodes.length), 1)
    const contentHeight = maxRows * allAssetSettings.nodeHeight
      + Math.max(0, maxRows - 1) * allAssetSettings.rowGap
    const componentWidth = Math.max(
      520,
      40 * 2 + grouped.size * allAssetSettings.nodeWidth
        + Math.max(0, grouped.size - 1) * allAssetSettings.columnGap,
    )
    const componentHeaderHeight = 34
    const componentPadding = 24
    const componentHeight = componentHeaderHeight + componentPadding * 2 + contentHeight
    const localNodes = new Map()
    for (const [depth, nodes] of grouped) {
      const groupHeight = nodes.length * allAssetSettings.nodeHeight
        + Math.max(0, nodes.length - 1) * allAssetSettings.rowGap
      const startY = componentHeaderHeight + componentPadding + (contentHeight - groupHeight) / 2
      nodes.forEach((node, index) => {
        localNodes.set(node.id, createDiagramNode(node, {
          x: componentPadding + depth
            * (allAssetSettings.nodeWidth + allAssetSettings.columnGap),
          y: startY + index * (allAssetSettings.nodeHeight + allAssetSettings.rowGap),
          depth,
          parentId: findParentId(node.id, depth, componentEdges, depths),
          settings: allAssetSettings,
        }))
      })
    }
    return {
      component,
      componentIndex,
      width: componentWidth,
      height: componentHeight,
      nodes: localNodes,
      title: `Komponen ${componentIndex + 1}`,
    }
  })

  const isolatedGroups = groupIsolatedAssets(isolated)
  const compactNodeWidth = 152
  const compactNodeHeight = 42
  const compactColumnGap = 16
  const largestIsolatedGroup = Math.max(0, ...isolatedGroups.map((group) => group.nodes.length))
  const preferredCompactColumns = Math.max(1, Math.min(7, largestIsolatedGroup))
  const preferredIsolatedWidth = allAssetSettings.marginX * 2
    + preferredCompactColumns * compactNodeWidth
    + Math.max(0, preferredCompactColumns - 1) * compactColumnGap
  const componentColumns = componentSpecs.length > 1
    && componentSpecs.every((spec) => spec.width <= 620) ? 2 : 1
  const columnWidths = Array.from({ length: componentColumns }, (_, column) => Math.max(
    0,
    ...componentSpecs.filter((_, index) => index % componentColumns === column)
      .map((spec) => spec.width),
  ))
  const componentWidth = columnWidths.reduce((sum, value) => sum + value, 0)
    + Math.max(0, componentColumns - 1) * componentGap
    + allAssetSettings.marginX * 2
  const layoutWidth = Math.max(
    allAssetSettings.minWidth,
    componentWidth,
    preferredIsolatedWidth,
  )
  const sections = []
  const rowSpecs = []
  for (let index = 0; index < componentSpecs.length; index += componentColumns) {
    rowSpecs.push(componentSpecs.slice(index, index + componentColumns))
  }
  const connectedSection = {
    kind: 'connected-overview',
    title: 'Komponen terhubung',
    nodeCount: connectedNodeIds.size,
    componentCount: components.length,
    x: 32,
    y: allAssetSettings.headerHeight + 16,
    width: layoutWidth - 64,
    height: 0,
  }
  sections.push(connectedSection)
  let sectionY = connectedSection.y + 56
  rowSpecs.forEach((row) => {
    const rowHeight = Math.max(...row.map((spec) => spec.height))
    row.forEach((spec, columnIndex) => {
      const offsetX = allAssetSettings.marginX + columnWidths
        .slice(0, columnIndex)
        .reduce((sum, value) => sum + value + componentGap, 0)
      const offsetY = sectionY + (rowHeight - spec.height) / 2
      sections.push({
        kind: 'connected',
        category: 'infrastructure',
        title: spec.title,
        nodeCount: spec.component.length,
        x: offsetX - 16,
        y: offsetY,
        width: spec.width + 32,
        height: spec.height,
      })
      spec.nodes.forEach((node) => {
        nodeById.set(node.id, translateDiagramNode(node, offsetX, offsetY))
      })
    })
    sectionY += rowHeight + componentGap
  })
  connectedSection.height = Math.max(88, sectionY - componentGap - connectedSection.y + 24)
  sectionY = connectedSection.y + connectedSection.height + 28

  if (isolated.length) {
    const isolatedSection = {
      kind: 'isolated',
      title: 'Aset tanpa relasi',
      nodeCount: isolated.length,
      x: 32,
      y: sectionY,
      width: layoutWidth - 64,
      height: 0,
    }
    sections.push(isolatedSection)
    const categoryX = isolatedSection.x + 24
    const categoryWidth = isolatedSection.width - 48
    const compactColumns = Math.max(1, Math.floor(
      (categoryWidth + compactColumnGap) / (compactNodeWidth + compactColumnGap),
    ))
    let categoryY = isolatedSection.y + 58
    isolatedGroups.forEach((group) => {
      const rowCount = Math.ceil(group.nodes.length / compactColumns)
      const categoryHeaderHeight = 38
      const compactRowGap = 12
      const categoryHeight = categoryHeaderHeight
        + rowCount * compactNodeHeight
        + Math.max(0, rowCount - 1) * compactRowGap
        + 18
      sections.push({
        kind: 'isolated-category',
        category: group.category,
        title: group.label,
        nodeCount: group.nodes.length,
        x: categoryX,
        y: categoryY,
        width: categoryWidth,
        height: categoryHeight,
      })
      group.nodes.forEach((node, index) => {
        const column = index % compactColumns
        const row = Math.floor(index / compactColumns)
        nodeById.set(node.id, createDiagramNode(node, {
          x: categoryX + column * (compactNodeWidth + compactColumnGap),
          y: categoryY + categoryHeaderHeight + row * (compactNodeHeight + compactRowGap),
          depth: null,
          parentId: null,
          settings: allAssetSettings,
          width: compactNodeWidth,
          height: compactNodeHeight,
          presentation: 'compact',
        }))
      })
      categoryY += categoryHeight + 12
    })
    isolatedSection.height = categoryY - 12 - isolatedSection.y + 22
    sectionY = isolatedSection.y + isolatedSection.height
  }

  return finalizeLayout({
    status: 'ready',
    strategy: 'graph-hierarchy',
    width: layoutWidth,
    height: sectionY + allAssetSettings.footerHeight,
    options: allAssetSettings,
    sections,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)).filter(Boolean),
    edges: layoutEdges(graph.edges, nodeById),
    summary: {
      totalCount: graph.nodes.length,
      connectedCount: connectedNodeIds.size,
      isolatedCount: isolated.length,
      componentCount: components.length,
      coveragePercent: graph.nodes.length
        ? Math.round((nodeById.size / graph.nodes.length) * 100)
        : 100,
    },
    defaultZoom: .78,
    focusNodeId: graph.anchorAssetId || components[0]?.[0] || isolated[0]?.id || null,
  }, allAssetSettings)
}

function calculateSingleCanvasEvidenceLayout(graph, settings) {
  const nodeWidth = 132
  const nodeHeight = 46
  const horizontalGap = 14
  const verticalGap = 12
  const columnCount = Math.max(8, Math.ceil(Math.sqrt(graph.nodes.length * 1.6)))
  const rowCount = Math.max(1, Math.ceil(graph.nodes.length / columnCount))
  const fullSettings = {
    ...settings,
    headerHeight: Math.max(settings.headerHeight, 122),
    footerHeight: Math.max(settings.footerHeight, 118),
    nodeWidth,
    nodeHeight,
  }
  const width = Math.max(
    settings.minWidth,
    settings.marginX * 2 + columnCount * (nodeWidth + horizontalGap),
  )
  const contentHeight = Math.max(760, rowCount * (nodeHeight + verticalGap) + 160)
  const height = fullSettings.headerHeight + contentHeight + fullSettings.footerHeight
  const bounds = canUseSourcePositions(graph)
    ? (graph.sourceBounds || getNodeSourceBounds(graph.nodes))
    : null
  const rangeX = Math.max((bounds?.maxX ?? 1) - (bounds?.minX ?? 0), .000001)
  const rangeY = Math.max((bounds?.maxY ?? 1) - (bounds?.minY ?? 0), .000001)
  const canvas = {
    minX: settings.marginX,
    maxX: width - settings.marginX - nodeWidth,
    minY: fullSettings.headerHeight + 32,
    maxY: fullSettings.headerHeight + contentHeight - nodeHeight - 24,
  }
  const sorted = [...graph.nodes].sort((left, right) => (
    compareSourcePosition(left, right)
    || String(left.name || left.id).localeCompare(String(right.name || right.id), 'id')
  ))
  const availablePositions = []
  for (let y = canvas.minY; y <= canvas.maxY; y += nodeHeight + verticalGap) {
    for (let x = canvas.minX; x <= canvas.maxX; x += nodeWidth + horizontalGap) {
      availablePositions.push({ x, y })
    }
  }
  const nodeById = new Map()

  sorted.forEach((node, index) => {
    const fallbackColumn = index % columnCount
    const fallbackRow = Math.floor(index / columnCount)
    const targetX = bounds
      ? canvas.minX + ((node.sourcePosition.x - bounds.minX) / rangeX)
        * Math.max(1, canvas.maxX - canvas.minX)
      : canvas.minX + fallbackColumn * (nodeWidth + horizontalGap)
    const targetY = bounds
      ? canvas.minY + ((node.sourcePosition.y - bounds.minY) / rangeY)
        * Math.max(1, canvas.maxY - canvas.minY)
      : canvas.minY + fallbackRow * (nodeHeight + verticalGap)
    const position = findNearestFreePosition({
      targetX,
      targetY,
      availablePositions,
    })
    nodeById.set(node.id, createDiagramNode(node, {
      x: position.x,
      y: position.y,
      depth: null,
      parentId: null,
      settings: fullSettings,
      width: nodeWidth,
      height: nodeHeight,
      presentation: 'compact',
    }))
  })

  const connectedNodeIds = new Set(graph.edges.flatMap((edge) => [edge.sourceId, edge.targetId]))
  const componentCount = connectedComponents(graph).filter((component) => component.length > 1).length
  const diagnostic = graph.diagnostics ?? {}
  return finalizeLayout({
    status: 'ready',
    strategy: 'single-evidence-canvas',
    width,
    height,
    options: fullSettings,
    sections: [],
    nodes: graph.nodes.map((node) => nodeById.get(node.id)).filter(Boolean),
    edges: layoutEdges(graph.edges, nodeById),
    summary: {
      totalCount: graph.nodes.length,
      connectedCount: connectedNodeIds.size,
      isolatedCount: graph.nodes.length - connectedNodeIds.size,
      confirmedCount: diagnostic.confirmedNodeCount ?? connectedNodeIds.size,
      recommendedCount: diagnostic.recommendedNodeCount ?? 0,
      reviewCount: diagnostic.reviewNodeCount ?? 0,
      unresolvedCount: diagnostic.unresolvedNodeCount
        ?? graph.nodes.length - connectedNodeIds.size,
      componentCount,
      coveragePercent: 100,
    },
    defaultZoom: .55,
    focusNodeId: graph.anchorAssetId || graph.nodes[0]?.id || null,
  }, fullSettings)
}

function findNearestFreePosition({ targetX, targetY, availablePositions }) {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  availablePositions.forEach((position, index) => {
    const distance = Math.hypot(position.x - targetX, position.y - targetY)
    if (distance < bestDistance
      || (distance === bestDistance && (
        position.y < availablePositions[bestIndex].y
        || (position.y === availablePositions[bestIndex].y
          && position.x < availablePositions[bestIndex].x)
      ))) {
      bestIndex = index
      bestDistance = distance
    }
  })
  return availablePositions.splice(bestIndex, 1)[0]
}

function createDiagramNode(node, {
  x,
  y,
  depth,
  parentId,
  settings,
  width = settings.nodeWidth,
  height = settings.nodeHeight,
  presentation = 'standard',
}) {
  return {
    ...node,
    depth,
    parentId,
    presentation,
    diagram: {
      x,
      y,
      width,
      height,
      nodeX: x + width / 2,
      nodeY: y + height / 2,
      labelX: x + width / 2,
      labelY: y + height - 22,
    },
  }
}

function groupIsolatedAssets(nodes) {
  const groups = new Map()
  nodes.forEach((node) => {
    const descriptor = describeIsolatedType(node)
    if (!groups.has(descriptor.key)) {
      groups.set(descriptor.key, { ...descriptor, nodes: [] })
    }
    groups.get(descriptor.key).nodes.push(node)
  })
  return [...groups.values()]
    .map((group) => ({
      ...group,
      nodes: group.nodes.sort((left, right) => (
        String(left.name || left.id).localeCompare(String(right.name || right.id), 'id')
      )),
    }))
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'id'))
}

function describeIsolatedType(node) {
  const type = String(node.type || '').trim()
  const normalized = type.toLowerCase()
  if ((normalized.includes('fo') || normalized.includes('fiber'))
    && normalized.includes('rekomendasi')) {
    return { key: 'fo-recommendation', label: 'FO Rekomendasi', category: 'fiber-optic', order: 2 }
  }
  if (normalized.includes('cctv') || normalized.includes('camera')) {
    return { key: 'cctv', label: 'CCTV', category: 'cctv', order: 0 }
  }
  if (normalized.includes('rekomendasi') || normalized.includes('recommendation')) {
    return { key: 'recommendation', label: 'Rekomendasi', category: node.category, order: 1 }
  }
  if (normalized.includes('junction')) {
    return { key: 'junction-box', label: 'Junction Box', category: node.category, order: 3 }
  }
  return {
    key: normalized || 'other',
    label: type || 'Aset lainnya',
    category: node.category || 'infrastructure',
    order: 10,
  }
}

function translateDiagramNode(node, offsetX, offsetY) {
  return {
    ...node,
    diagram: {
      ...node.diagram,
      x: node.diagram.x + offsetX,
      y: node.diagram.y + offsetY,
      nodeX: node.diagram.nodeX + offsetX,
      nodeY: node.diagram.nodeY + offsetY,
      labelX: node.diagram.labelX + offsetX,
      labelY: node.diagram.labelY + offsetY,
    },
  }
}

function finalizeLayout(layout, settings) {
  const padding = 32
  const extents = []
  layout.nodes.forEach((node) => {
    extents.push({
      minX: node.diagram.x,
      minY: node.diagram.y,
      maxX: node.diagram.x + node.diagram.width,
      maxY: node.diagram.y + node.diagram.height,
    })
  })
  layout.sections?.forEach((section) => {
    extents.push({
      minX: section.x,
      minY: section.y,
      maxX: section.x + section.width,
      maxY: section.y + section.height,
    })
  })
  layout.edges.forEach((edge) => edge.routePoints.forEach((point) => {
    extents.push({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y })
  }))

  const maxX = Math.max(layout.width - padding, ...extents.map((extent) => extent.maxX))
  const maxY = Math.max(layout.height - padding, ...extents.map((extent) => extent.maxY))
  const width = Math.max(settings.minWidth, maxX + padding)
  const height = Math.max(layout.height, maxY + padding)
  return {
    ...layout,
    width,
    height,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height,
      padding,
    },
  }
}

function connectedComponents(graph) {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]))
  graph.edges.forEach((edge) => {
    adjacency.get(edge.sourceId)?.push(edge.targetId)
    adjacency.get(edge.targetId)?.push(edge.sourceId)
  })
  const components = []
  const visited = new Set()
  graph.nodes.forEach((node) => {
    if (visited.has(node.id)) return
    const component = []
    const queue = [node.id]
    visited.add(node.id)
    while (queue.length) {
      const current = queue.shift()
      component.push(current)
      ;(adjacency.get(current) || []).sort().forEach((neighbor) => {
        if (visited.has(neighbor)) return
        visited.add(neighbor)
        queue.push(neighbor)
      })
    }
    components.push(component.sort())
  })
  return components
}

function chooseComponentRoot(nodes, edges, preferredId) {
  if (preferredId && nodes.some((node) => node.id === preferredId)) return preferredId
  const degree = new Map(nodes.map((node) => [node.id, 0]))
  edges.forEach((edge) => {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) || 0) + 1)
    degree.set(edge.targetId, (degree.get(edge.targetId) || 0) + 1)
  })
  return [...nodes].sort((left, right) => (
    Number(right.isAnchor) - Number(left.isAnchor)
    || (degree.get(right.id) || 0) - (degree.get(left.id) || 0)
    || left.id.localeCompare(right.id, 'id')
  ))[0]?.id
}

function calculateComponentDepths(root, nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]))
  edges.forEach((edge) => {
    adjacency.get(edge.sourceId)?.push(edge.targetId)
    adjacency.get(edge.targetId)?.push(edge.sourceId)
  })
  const depths = new Map([[root, 0]])
  const queue = [root]
  while (queue.length) {
    const current = queue.shift()
    ;(adjacency.get(current) || []).sort().forEach((neighbor) => {
      if (depths.has(neighbor)) return
      depths.set(neighbor, depths.get(current) + 1)
      queue.push(neighbor)
    })
  }
  return depths
}

function calculateMapRelativeLayout(graph, settings) {
  const bounds = graph.sourceBounds || getNodeSourceBounds(graph.nodes)
  const width = Math.max(settings.minWidth, settings.mapWidth)
  const height = settings.headerHeight + settings.mapContentHeight + settings.footerHeight
  const horizontalPadding = settings.nodeWidth / 2 + 28
  const verticalPadding = 34
  const rangeX = Math.max(bounds.maxX - bounds.minX, .0001)
  const rangeY = Math.max(bounds.maxY - bounds.minY, .0001)
  const nodeById = new Map()

  graph.nodes.forEach((node) => {
    const normalizedX = (node.sourcePosition.x - bounds.minX) / rangeX
    const normalizedY = (node.sourcePosition.y - bounds.minY) / rangeY
    const nodeX = horizontalPadding
      + normalizedX * (width - horizontalPadding * 2)
    const nodeY = settings.headerHeight + verticalPadding
      + normalizedY * (settings.mapContentHeight - verticalPadding * 2)
    const x = nodeX - settings.nodeWidth / 2
    const y = nodeY - 14

    nodeById.set(node.id, {
      ...node,
      depth: null,
      parentId: null,
      diagram: {
        x,
        y,
        width: settings.nodeWidth,
        height: settings.nodeHeight,
        nodeX,
        nodeY,
        labelX: nodeX,
        labelY: y + 35,
      },
    })
  })

  return {
    status: 'ready',
    strategy: 'map-relative',
    width,
    height,
    options: settings,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)),
    edges: layoutEdges(graph.edges, nodeById),
  }
}

function calculateCategorySectionLayout(graph, settings) {
  const categoryOrder = ['cctv', 'fiber-optic', 'lan', 'infrastructure', 'peripheral']
  const groups = new Map()
  graph.nodes.forEach((node) => {
    const category = node.category || 'infrastructure'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category).push(node)
  })
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => {
    const leftOrder = categoryOrder.indexOf(left)
    const rightOrder = categoryOrder.indexOf(right)
    return (leftOrder < 0 ? categoryOrder.length : leftOrder)
      - (rightOrder < 0 ? categoryOrder.length : rightOrder)
      || left.localeCompare(right)
  })
  const largestGroupSize = Math.max(...orderedGroups.map(([, nodes]) => nodes.length), 1)
  const aspectRatio = 16 / 9
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(largestGroupSize * aspectRatio)))
  const horizontalGap = Math.max(settings.columnGap / 2, 28)
  const verticalGap = Math.max(settings.rowGap / 2, 18)
  const cellWidth = settings.nodeWidth + horizontalGap
  const cellHeight = settings.nodeHeight + verticalGap
  const sectionHeaderHeight = 54
  const sectionPadding = 24
  const sectionGap = 28
  const width = Math.max(
    settings.minWidth,
    settings.marginX * 2 + columnCount * cellWidth,
  )
  const nodeById = new Map()
  const sections = []
  let sectionY = settings.headerHeight

  orderedGroups.forEach(([category, nodes]) => {
    const sortedNodes = [...nodes].sort((left, right) => (
      compareSourcePosition(left, right)
      || String(left.name || '').localeCompare(String(right.name || ''), 'id')
      || left.id.localeCompare(right.id)
    ))
    const rowCount = Math.ceil(sortedNodes.length / columnCount)
    const sectionHeight = sectionHeaderHeight + rowCount * cellHeight + sectionPadding
    sections.push({
      category,
      nodeCount: sortedNodes.length,
      x: 32,
      y: sectionY,
      width: width - 64,
      height: sectionHeight,
    })
    sortedNodes.forEach((node, index) => {
      const column = index % columnCount
      const row = Math.floor(index / columnCount)
      const x = settings.marginX + column * cellWidth
      const y = sectionY + sectionHeaderHeight + row * cellHeight
      nodeById.set(node.id, {
        ...node,
        depth: null,
        parentId: null,
        diagram: {
          x,
          y,
          width: settings.nodeWidth,
          height: settings.nodeHeight,
          nodeX: x + settings.nodeWidth / 2,
          nodeY: y + 14,
          labelX: x + settings.nodeWidth / 2,
          labelY: y + 35,
        },
      })
    })
    sectionY += sectionHeight + sectionGap
  })

  const height = sectionY - sectionGap + settings.footerHeight
  return {
    status: 'ready',
    strategy: 'category-sections',
    width,
    height,
    options: settings,
    sections,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)),
    edges: layoutEdges(graph.edges, nodeById),
  }
}

function compareSourcePosition(left, right) {
  const leftPosition = left.sourcePosition
  const rightPosition = right.sourcePosition
  if (!leftPosition && !rightPosition) return 0
  if (!leftPosition) return 1
  if (!rightPosition) return -1
  return leftPosition.y - rightPosition.y || leftPosition.x - rightPosition.x
}

function canUseSourcePositions(graph) {
  return graph.nodes.length > 0
    && graph.nodes.every((node) =>
      Number.isFinite(node.sourcePosition?.x) && Number.isFinite(node.sourcePosition?.y),
    )
}

function getNodeSourceBounds(nodes) {
  const positions = nodes.map((node) => node.sourcePosition)
  return {
    minX: Math.min(...positions.map((position) => position.x)),
    maxX: Math.max(...positions.map((position) => position.x)),
    minY: Math.min(...positions.map((position) => position.y)),
    maxY: Math.max(...positions.map((position) => position.y)),
  }
}

function calculateTraceLayout(graph, settings) {
  const columnCount = Math.min(graph.nodes.length, settings.maxTraceColumns)
  const rowCount = Math.ceil(graph.nodes.length / columnCount)
  const width = Math.max(
    settings.minWidth,
    settings.marginX * 2
      + columnCount * settings.nodeWidth
      + Math.max(0, columnCount - 1) * settings.columnGap,
  )
  const contentHeight = rowCount * settings.nodeHeight
    + Math.max(0, rowCount - 1) * settings.rowGap
  const height = settings.headerHeight + contentHeight + settings.footerHeight
  const nodeById = new Map()

  graph.nodes.forEach((node, index) => {
    const row = Math.floor(index / columnCount)
    const positionInRow = index % columnCount
    const column = row % 2 === 0
      ? positionInRow
      : columnCount - 1 - positionInRow
    const x = settings.marginX + column * (settings.nodeWidth + settings.columnGap)
    const y = settings.headerHeight + row * (settings.nodeHeight + settings.rowGap)
    nodeById.set(node.id, {
      ...node,
      depth: index,
      parentId: index ? graph.nodes[index - 1].id : null,
      diagram: {
        x,
        y,
        width: settings.nodeWidth,
        height: settings.nodeHeight,
        nodeX: x + settings.nodeWidth / 2,
        nodeY: y + 14,
        labelX: x + settings.nodeWidth / 2,
        labelY: y + 35,
      },
    })
  })

  return {
    status: 'ready',
    width,
    height,
    options: settings,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)),
    edges: layoutEdges(graph.edges, nodeById),
  }
}

function calculateDepths(graph) {
  if (graph.mode === 'trace') {
    return new Map(graph.nodes.map((node, index) => [node.id, index]))
  }

  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]))
  graph.edges.forEach((edge) => {
    adjacency.get(edge.sourceId)?.push(edge.targetId)
    adjacency.get(edge.targetId)?.push(edge.sourceId)
  })

  const anchorId = graph.anchorAssetId || graph.nodes[0]?.id
  const depths = new Map(anchorId ? [[anchorId, 0]] : [])
  const queue = anchorId ? [anchorId] : []

  while (queue.length) {
    const currentId = queue.shift()
    const currentDepth = depths.get(currentId)
    const neighbors = [...(adjacency.get(currentId) || [])].sort()
    neighbors.forEach((neighborId) => {
      if (depths.has(neighborId)) return
      depths.set(neighborId, currentDepth + 1)
      queue.push(neighborId)
    })
  }

  let disconnectedDepth = Math.max(...depths.values(), 0) + 1
  graph.nodes.forEach((node) => {
    if (!depths.has(node.id)) depths.set(node.id, disconnectedDepth++)
  })
  return depths
}

function groupNodesByDepth(nodes, depths) {
  const groups = new Map()
  nodes.forEach((node) => {
    const depth = depths.get(node.id) || 0
    if (!groups.has(depth)) groups.set(depth, [])
    groups.get(depth).push(node)
  })

  return new Map([...groups.entries()]
    .sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth)
    .map(([depth, group]) => [
      depth,
      [...group].sort((left, right) =>
        Number(right.isAnchor) - Number(left.isAnchor)
        || left.category.localeCompare(right.category)
        || left.id.localeCompare(right.id),
      ),
    ]))
}

function findParentId(nodeId, depth, edges, depths) {
  if (depth === 0) return null
  const parentEdge = edges.find((edge) => {
    if (edge.sourceId === nodeId) return depths.get(edge.targetId) === depth - 1
    if (edge.targetId === nodeId) return depths.get(edge.sourceId) === depth - 1
    return false
  })
  if (!parentEdge) return null
  return parentEdge.sourceId === nodeId ? parentEdge.targetId : parentEdge.sourceId
}

function calculateRoutePoints(source, target) {
  if (!source || !target) return []
  const sourceRight = {
    x: source.diagram.x + source.diagram.width,
    y: source.diagram.nodeY,
  }
  const sourceLeft = {
    x: source.diagram.x,
    y: source.diagram.nodeY,
  }
  const targetRight = {
    x: target.diagram.x + target.diagram.width,
    y: target.diagram.nodeY,
  }
  const targetLeft = {
    x: target.diagram.x,
    y: target.diagram.nodeY,
  }

  if (source.diagram.x === target.diagram.x) {
    const routeX = source.diagram.x + source.diagram.width + 22
    return [
      sourceRight,
      { x: routeX, y: sourceRight.y },
      { x: routeX, y: targetRight.y },
      targetRight,
    ]
  }

  const forward = source.diagram.x <= target.diagram.x
  const start = forward ? sourceRight : sourceLeft
  const end = forward ? targetLeft : targetRight
  const middleX = (start.x + end.x) / 2

  if (Math.abs(start.y - end.y) < 1) return [start, end]
  return [
    start,
    { x: middleX, y: start.y },
    { x: middleX, y: end.y },
    end,
  ]
}

function layoutEdges(edges, nodeById) {
  const groups = new Map()
  edges.forEach((edge) => {
    const key = [edge.sourceId, edge.targetId].sort().join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(edge)
  })

  return edges.map((edge) => {
    const key = [edge.sourceId, edge.targetId].sort().join('|')
    const parallelEdges = groups.get(key)
    const parallelIndex = parallelEdges.indexOf(edge)
    const laneOffset = (parallelIndex - (parallelEdges.length - 1) / 2) * 4
    const routePoints = calculateRoutePoints(
      nodeById.get(edge.sourceId),
      nodeById.get(edge.targetId),
    )
    return {
      ...edge,
      laneOffset,
      routePoints: offsetRoute(routePoints, laneOffset),
    }
  })
}

function offsetRoute(points, offset) {
  if (!offset || points.length < 2) return points
  const first = points[0]
  const second = points[1]
  const horizontalFirstSegment = first.y === second.y
  return points.map((point) => ({
    x: point.x + (horizontalFirstSegment ? 0 : offset),
    y: point.y + (horizontalFirstSegment ? offset : 0),
  }))
}
