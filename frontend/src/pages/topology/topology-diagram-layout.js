import {routeSchematicEdges} from './topology-obstacle-router.js'

const DEFAULT_OPTIONS = Object.freeze({
  margin: 28,
  sectionGap: 26,
  sectionHeaderHeight: 36,
  sectionPadding: 16,
  laneGap: 24,
  laneHeaderHeight: 16,
  lanePadding: 14,
  bandHeaderHeight: 18,
  bandGap: 18,
  nodeGapX: 14,
  nodeGapY: 14,
  levelGapY: 56,
  nodeWidth: 56,
  nodeHeight: 48,
  coreWidth: 72,
  coreHeight: 56,
  distributionWidth: 64,
  distributionHeight: 48,
  endpointWidth: 36,
  endpointHeight: 36,
  compactWidth: 36,
  compactHeight: 36,
  unresolvedHeight: 44,
  footerHeight: 156,
  minWidth: 920,
  layoutStyle: 'central-backbone',
  componentColumns: 2,
  componentMaxColumns: 4,
  componentPackingAspectRatio: 2.2,
  componentGapX: 18,
  componentGapY: 18,
  hubMinWidth: 280,
  hubPadding: 14,
  hubHeaderHeight: 10,
  hubNodeGapX: 12,
  hubLevelGapY: 28,
  hubRootWidth: 72,
  hubRootHeight: 56,
  hubJunctionWidth: 56,
  hubJunctionHeight: 48,
  hubEndpointWidth: 36,
  hubEndpointHeight: 36,
  mountingBoxMinWidth: 196,
  mountingBoxPadding: 16,
  mountingBoxHeaderHeight: 44,
  mountingBoxGapX: 24,
  mountingRootGapX: null,
  mountingBoxGapY: 26,
  mountingBoxLevelGapY: 34,
  mountingBoxNodeGapX: 18,
  mountingRootColumns: null,
  mountingRootFrameGap: null,
  mountingRootRowGapY: 72,
  backboneCoreGapY: 70,
  peerColumns: 10,
  extendedColumns: 8,
  endpointColumns: 12,
  overview: false,
  overviewColumns: 3,
  overviewCardHeight: 156,
  overviewMargin: 24,
  overviewGapX: 16,
  overviewGapY: 22,
  overviewMinWidth: 920,
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

  const settings = { ...DEFAULT_OPTIONS,
    ...(options.layoutStyle === 'facility-schematic' ? {
      mountingBoxPadding: 24,
      mountingBoxHeaderHeight: 40,
      mountingBoxGapX: 48,
      mountingRootGapX: 144,
      mountingBoxGapY: 72,
      mountingBoxNodeGapX: 32,
      mountingBoxLevelGapY: 64,
      backboneCoreGapY: 80,
    } : {}), ...options }
  if (settings.layoutStyle === 'facility-schematic') settings.footerHeight = Math.max(100, settings.footerHeight)
  if (settings.overview) return calculateAreaOverviewLayout(model, settings)
  const usesPoleBoxes = ['central-backbone', 'compound-poles', 'facility-schematic'].includes(settings.layoutStyle)
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
    const nonPoleIds = (area.nodeIds ?? []).filter(id =>
      ['indoor', 'standalone'].includes(nodeById.get(id)?.mountingExpectation))
    const hasCustomFrames = Object.values(settings.customFrames ?? {})
      .some((frame) => frame?.areaKey === area.key)
    const laneSpecs = usesPoleBoxes && (areaComponents.length || nonPoleIds.length || hasCustomFrames)
      ? [buildPoleBackboneAreaLaneSpec({
        area,
        components: areaComponents,
        nodeById,
        edges: model.edges,
        mountingGroups: model.mountingGroups,
        physicalMounts: model.physicalMounts,
        frameAssignments: settings.frameAssignments,
        customFrames: settings.customFrames,
        settings,
      })]
      : areaComponents.map((component, index) => buildLaneSpec({
        component,
        index,
        nodeById,
        edges: model.edges,
        settings,
      }))
    const mountedPresentationIds = new Set(model.mountingGroups
      .filter((group) => group.areaKey === area.key)
      .flatMap((group) => group.childIds ?? []))
    const disconnectedNodes = (area.isolatedNodeIds ?? [])
      .filter((id) => !mountedPresentationIds.has(id))
      .filter(id => !usesPoleBoxes || !nonPoleIds.includes(id))
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .sort(compareNodes)
    const suggestedOnlyNodes = (area.suggestedOnlyNodeIds ?? [])
      .filter(id => !usesPoleBoxes || !nonPoleIds.includes(id))
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
      componentCount: areaComponents.length,
      componentColumns: laneGrid.columns ?? 0,
      componentRows: laneGrid.rows ?? 0,
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
      const offsetX = section.x + lane.x
      const offsetY = section.y + lane.y
      lane.nodes.forEach((node) => translateNode(node, offsetX, offsetY))
      ;(lane.mountingBoxes ?? []).forEach((box) => {
        box.x += offsetX
        if (Number.isFinite(box.treeX)) box.treeX += offsetX
        box.y += offsetY
      })
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

  const mountingBoxes = sections.flatMap((section) => (
    section.lanes.flatMap((lane) => lane.mountingBoxes ?? [])
  ))
  const mountingBoxById = new Map(mountingBoxes.map((box) => [box.id, box]))
  const allEdges = model.edges.filter((edge) => (
    layoutNodes.has(edge.sourceId) && layoutNodes.has(edge.targetId)
  ))
  allEdges.forEach((edge) => {
    const source = layoutNodes.get(edge.sourceId)
    const target = layoutNodes.get(edge.targetId)
    const staysInsideCompoundGroup = settings.layoutStyle === 'compound-poles'
      && source.mountingBoxId
      && source.mountingBoxId === target.mountingBoxId
    layoutEdges.push({
      ...edge,
      routePoints: staysInsideCompoundGroup
        ? straightLinkPoints(source, target)
        : routeEdge(source, target, mountingBoxById),
      linePoints: straightLinkPoints(source, target),
    })
  })
  const backboneGaps = (model.backboneGaps ?? [])
    .map((gap, index) => {
      const source = layoutNodes.get(gap.sourceId)
      const target = layoutNodes.get(gap.targetId)
      if (!source || !target) return null
      const routePoints = routeBackboneGap(source, target, layoutNodes, index)
      return {
        ...gap,
        routePoints,
        linePoints: [routePoints[0], routePoints[routePoints.length - 1]],
        labelX: routePoints[2]?.x ?? target.diagram.centerX,
        labelY: ((routePoints[2]?.y ?? target.diagram.centerY)
          + (routePoints[3]?.y ?? target.diagram.centerY)) / 2,
      }
    })
    .filter(Boolean)

  const mountingGroupBounds = mountingBoxes.map((box) => ({
    ...box,
    childIds: [...box.nodeIds],
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    bottom: box.y + box.height,
  }))
  const layout = {
    status: 'ready',
    strategy: settings.layoutStyle === 'compound-poles'
      ? 'compound-pole-network'
      : settings.layoutStyle === 'central-backbone'
        ? 'central-backbone-network'
        : 'top-down-area-semantic-tier',
    networkAtlasStrategy: 'backbone-first-component-islands',
    width: finalWidth,
    height: finalHeight,
    options: settings,
    nodes: [...layoutNodes.values()].sort(compareLayoutNodes),
    edges: (settings.layoutStyle === 'facility-schematic'
      ? routeSchematicEdges([...layoutNodes.values()], layoutEdges, mountingBoxes) : layoutEdges)
      .sort((left, right) => left.id.localeCompare(right.id, 'id')),
    mountingBoxes,
    mountingGroupBounds,
    backboneGaps,
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
    .filter((area) => (area.nodeIds ?? []).length > 0)
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
    const areaMountingGroups = (model.mountingGroups ?? []).filter((group) => (
      group.areaKey === area.key
    ))
    const occupiedPoleCount = areaMountingGroups.filter(({ childIds }) => childIds.length > 0).length
    const unmountedCount = areaNodes.filter((node) => (
      /junction|\bjb\b|cctv|camera|kamera/i.test(`${node.type ?? ''} ${node.category ?? ''}`)
        && !['indoor', 'standalone'].includes(node.mountingExpectation)
        && !(node.mountingGroupIds ?? []).length
    )).length
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
      poleCount: areaMountingGroups.length,
      occupiedPoleCount,
      emptyPoleCount: areaMountingGroups.length - occupiedPoleCount,
      unmountedCount,
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
  const maximumSeedCount = Math.max(1, Math.min(
    settings.componentMaxColumns ?? settings.componentColumns ?? 2,
    lanes.length,
  ))
  const widths = [...lanes]
    .map(({ width }) => width)
    .sort((left, right) => right - left)
  const candidates = []
  let targetWidth = 0
  for (let seedCount = 1; seedCount <= maximumSeedCount; seedCount += 1) {
    targetWidth += widths[seedCount - 1]
    if (seedCount > 1) targetWidth += settings.componentGapX
    candidates.push(packComponentLanes(lanes, settings, targetWidth))
  }
  candidates.sort((left, right) => componentPackingScore(left, settings)
    - componentPackingScore(right, settings)
    || left.width - right.width
    || left.height - right.height
    || left.columns - right.columns)
  return candidates[0]
}

function packComponentLanes(lanes, settings, requestedWidth) {
  const minimumWidth = settings.minWidth - settings.sectionPadding * 2
  const shelfLimit = Math.max(minimumWidth, requestedWidth)
  const shelves = []
  let currentShelf = null
  lanes.forEach((lane) => {
    const nextWidth = currentShelf
      ? currentShelf.width + settings.componentGapX + lane.width
      : lane.width
    if (currentShelf && nextWidth > shelfLimit) currentShelf = null
    if (!currentShelf) {
      currentShelf = { lanes: [], width: 0, height: 0 }
      shelves.push(currentShelf)
    }
    if (currentShelf.lanes.length) currentShelf.width += settings.componentGapX
    currentShelf.lanes.push(lane)
    currentShelf.width += lane.width
    currentShelf.height = Math.max(currentShelf.height, lane.height)
  })
  const packedWidth = Math.max(...shelves.map(({ width }) => width), minimumWidth)
  const packedHeight = shelves.reduce((total, shelf) => total + shelf.height, 0)
    + Math.max(0, shelves.length - 1) * settings.componentGapY
  const contentWidth = Math.max(
    minimumWidth,
    packedWidth,
  )
  const positioned = []
  let shelfY = 0
  shelves.forEach((shelf) => {
    let laneX = (contentWidth - shelf.width) / 2
    shelf.lanes.forEach((lane) => {
      positioned.push({
        ...lane,
        x: settings.sectionPadding + laneX,
        y: settings.sectionHeaderHeight + settings.sectionPadding + shelfY,
      })
      laneX += lane.width + settings.componentGapX
    })
    shelfY += shelf.height + settings.componentGapY
  })
  return {
    width: contentWidth,
    height: packedHeight,
    columns: Math.max(...shelves.map(({ lanes: shelfLanes }) => shelfLanes.length)),
    rows: shelves.length,
    lanes: positioned,
  }
}

function componentPackingScore(grid, settings) {
  const target = Math.max(.1, Number(settings.componentPackingAspectRatio) || 1.45)
  const aspect = Math.max(.1, grid.width / Math.max(1, grid.height))
  const aspectDistance = Math.abs(Math.log(aspect / target))
  const widthLimit = Math.max(settings.minWidth * 2, settings.minWidth + 640)
  const widthPenalty = Math.max(0, grid.width - widthLimit) / widthLimit
  const laneArea = grid.lanes.reduce((total, lane) => total + lane.width * lane.height, 0)
  const whitespaceRatio = 1 - laneArea / Math.max(1, grid.width * grid.height)
  return aspectDistance + widthPenalty * .35 + whitespaceRatio * .18
}

export function createTopologyDiagramLayoutCacheKey({
  model,
  datasetVersionId = model?.datasetVersionId,
  branchId = model?.branchId,
  area = model?.area,
  selectedFamilies = model?.selectedFamilies,
  frameAssignments = {},
  customFrames = {},
  hideFiltered = false,
  overview = false,
} = {}) {
  const nodeIds = (model?.nodes ?? []).map(({ id }) => id).sort().join(',')
  const edgeIds = (model?.edges ?? []).map(({ id }) => id).sort().join(',')
  const families = [...(selectedFamilies ?? [])].sort().join(',')
  const assignments = (frameAssignments instanceof Map
    ? [...frameAssignments.entries()]
    : Object.entries(frameAssignments ?? {}))
    .sort(([left], [right]) => String(left).localeCompare(String(right), 'id'))
    .map(([assetId, frameId]) => `${assetId}:${frameId}`)
    .join(',')
  const frames = Object.values(customFrames ?? {})
    .map((frame) => `${frame.id}:${frame.type}:${frame.areaKey}:${frame.name ?? ''}`)
    .sort((left, right) => left.localeCompare(right, 'id'))
    .join(',')
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
    (model?.nodes ?? []).map(node => `${node.id}:${node.mountingExpectation ?? ''}`).sort().join(','),
    assignments,
    frames,
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
  const mountingBoxById = new Map(
    (layout.mountingBoxes ?? []).map((box) => [box.id, box]),
  )
  const settings = layout.options ?? DEFAULT_OPTIONS
  layout.edges = layout.edges.map((edge) => {
    const source = nodeById.get(edge.sourceId)
    const target = nodeById.get(edge.targetId)
    if (!source || !target) return edge
    return {
      ...edge,
      routePoints: settings.layoutStyle === 'compound-poles'
        && source.mountingBoxId
        && source.mountingBoxId === target.mountingBoxId
        ? straightLinkPoints(source, target)
        : routeEdge(source, target, mountingBoxById),
      linePoints: straightLinkPoints(source, target),
    }
  })
  if (settings.layoutStyle === 'facility-schematic') {
    layout.edges = routeSchematicEdges(layout.nodes, layout.edges, layout.mountingBoxes)
  }
  layout.backboneGaps = (layout.backboneGaps ?? []).map((gap, index) => {
    const source = nodeById.get(gap.sourceId)
    const target = nodeById.get(gap.targetId)
    if (!source || !target) return gap
    const routePoints = routeBackboneGap(source, target, nodeById, index)
    return {
      ...gap,
      routePoints,
      linePoints: [routePoints[0], routePoints[routePoints.length - 1]],
      labelX: routePoints[2]?.x ?? target.diagram.centerX,
      labelY: ((routePoints[2]?.y ?? target.diagram.centerY)
        + (routePoints[3]?.y ?? target.diagram.centerY)) / 2,
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
  if (['central-backbone', 'compound-poles', 'facility-schematic'].includes(args.settings.layoutStyle)) {
    return buildCentralBackboneLaneSpec(args)
  }
  return buildSemanticLaneSpec(args)
}

function buildPoleBackboneAreaLaneSpec({
  area,
  components,
  nodeById,
  edges,
  mountingGroups = [],
  physicalMounts = [],
  frameAssignments = {},
  customFrames = {},
  settings,
}) {
  const componentByNodeId = new Map()
  components.forEach((component) => {
    component.nodeIds.forEach((nodeId) => componentByNodeId.set(nodeId, component))
  })
  // A mounted endpoint can be physically assigned even when it has no
  // confirmed logical edge yet. Include those children in the pole lane so
  // they do not fall into the unrelated-device tray (e.g. DPPU YIA BC-042).
  const mountedPresentationIds = new Set(mountingGroups
    .filter((group) => !area?.key || group.areaKey === area.key)
    .flatMap((group) => group.childIds ?? []))
  const nonPoleIds = (area.nodeIds ?? []).filter(id =>
    ['indoor', 'standalone'].includes(nodeById.get(id)?.mountingExpectation))
  const connectedIds = new Set([...componentByNodeId.keys(), ...mountedPresentationIds, ...nonPoleIds])
  const connectedNodes = [...connectedIds].map((id) => nodeById.get(id)).filter(Boolean)
  const coreNodes = connectedNodes
    .filter((node) => node.diagramClass === 'rack-root')
    .sort(compareNodes)
  const assignedNodeIds = new Set(coreNodes.map(({ id }) => id))
  // Presentation-only exception: this DPPU parent JB is intentionally shown
  // in the non-pole scope while its numbered extensions stay on their poles.
  // It must not alter the confirmed network graph or mounting records.
  const presentationExcludedNodeIds = new Set(connectedNodes
    .filter((node) => presentationExcludedFromPole(node, area))
    .map(({ id }) => id))
  presentationExcludedNodeIds.forEach((id) => assignedNodeIds.add(id))
  const confirmedGroups = [...mountingGroups]
    .filter((group) => !(group.childIds ?? []).length
      || (group.childIds ?? []).some((id) => connectedIds.has(id)))
    .sort((left, right) => String(left.hostName ?? left.hostId).localeCompare(
      String(right.hostName ?? right.hostId),
      'id',
    ) || String(left.id).localeCompare(String(right.id), 'id'))
    .flatMap((group) => {
      const emptyMount = !(group.childIds ?? []).length
      const nodeIds = (group.childIds ?? []).filter((id) => (
        connectedIds.has(id)
          && !assignedNodeIds.has(id)
          && !presentationExcludedNodeIds.has(id)
      ))
      if (!nodeIds.length && !emptyMount) return []
      nodeIds.forEach((id) => assignedNodeIds.add(id))
      return [{
        id: group.id,
        hostId: group.hostId,
        hostName: group.hostName || group.hostId,
        hostType: group.hostType || 'Tiang',
        kind: emptyMount ? 'empty' : 'confirmed',
        nodeIds,
        mountingConflict: nodeIds.some((id) => (
          (nodeById.get(id)?.mountingGroupIds ?? []).length > 1
        )),
      }]
    })
  const confirmedPoleIds = new Set(confirmedGroups
    .map((group) => group.hostId)
    .filter(Boolean))
  const emptyPhysicalGroups = area.key === 'dppu-yia'
    ? physicalMounts
      .filter((pole) => pole.areaKey === area.key && !confirmedPoleIds.has(pole.id))
      .map((pole) => ({
        id: `pole-group:${pole.id}`,
        hostId: pole.id,
        hostName: pole.name,
        hostType: 'Tiang',
        kind: 'empty',
        nodeIds: [],
        mountingConflict: false,
      }))
    : []
  attachNamedJunctionFamiliesToMountingGroups({
    confirmedGroups,
    connectedNodes,
    assignedNodeIds,
    area,
  })
  const edgeAdjacency = buildLayoutEdgeAdjacency(connectedNodes, edges)
  confirmedGroups.splice(0, confirmedGroups.length,
    ...confirmedGroups.flatMap(group => splitIndependentPoleBranches(group, nodeById, edgeAdjacency)))
  const junctionGroups = buildEndpointJunctionGroups({
    confirmedGroups,
    connectedNodes,
    assignedNodeIds,
    edgeAdjacency,
  })
  const unmountedNodes = connectedNodes
    .filter((node) => node.diagramClass !== 'rack-root' && !assignedNodeIds.has(node.id))
  const excludedNodeIds = [
    ...presentationExcludedNodeIds,
    ...unmountedNodes
      .filter((node) => ['indoor', 'standalone'].includes(node.mountingExpectation))
      .map(({ id }) => id),
  ]
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)))
  const needsMountingNodeIds = unmountedNodes
    .filter((node) => node.mountingExpectation === 'pole' || node.mountingExpectation == null)
    .map(({ id }) => id)
    .sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)))
  const unassignedNodeIds = unmountedNodes
    .filter((node) => node.mountingExpectation === 'unknown')
    .map(({ id }) => id)
    .sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)))
  const excludedGroupSpecs = buildExcludedMountingGroupSpecs({
    area,
    nodeIds: excludedNodeIds,
    connectedNodes,
    edgeAdjacency,
  })
  const builtGroupIds = new Set([
    ...confirmedGroups,
    ...emptyPhysicalGroups,
    ...junctionGroups,
    ...excludedGroupSpecs,
  ].map(({ id }) => id))
  const groupSpecs = [
    ...confirmedGroups,
    ...emptyPhysicalGroups,
    ...junctionGroups,
    ...(needsMountingNodeIds.length ? [{
      id: `needs-mounting:${area.key}`,
      hostId: null,
      hostName: 'Perlu mounting',
      hostType: 'Aset pole/unknown tanpa relasi mounting tiang',
      kind: 'needs-mounting',
      nodeIds: needsMountingNodeIds,
      mountingConflict: false,
    }] : []),
    ...(unassignedNodeIds.length ? [{
      id: `unassigned-mounting:${area.key}`,
      hostId: null,
      hostName: 'Aset lainnya',
      hostType: 'Belum ada penempatan tiang yang terkonfirmasi',
      kind: 'unassigned',
      nodeIds: unassignedNodeIds,
      mountingConflict: false,
    }] : []),
    ...excludedGroupSpecs,
    ...Object.values(customFrames ?? {})
      .filter((frame) => frame?.areaKey === area.key && !builtGroupIds.has(frame.id))
      .map((frame) => ({
        id: frame.id,
        hostId: frame.type === 'pole' ? frame.poleAssetId : null,
        hostName: frame.name || (frame.type === 'indoor' ? 'Indoor' : frame.type === 'pole' ? frame.poleAssetId : 'Non-tiang'),
        hostType: frame.type === 'pole' ? 'Tiang' : frame.type === 'indoor' ? 'Aset dalam ruangan' : 'Aset non-tiang',
        kind: frame.type === 'pole' ? 'empty' : 'excluded',
        nodeIds: [],
        mountingConflict: false,
        custom: true,
      })),
  ]
  const logicalGroupSpecs = applyFrameAssignmentsToGroups(
    splitFramesByExternalJunction(groupSpecs, nodeById, edgeAdjacency),
    frameAssignments,
    nodeById,
  )
  const mountingBoxes = logicalGroupSpecs.map((group) => buildMountingBoxSpec({
    group,
    nodeById,
    componentByNodeId,
    edgeAdjacency,
    settings,
  })).sort((left, right) => (
    mountingBoxOrder(left.kind) - mountingBoxOrder(right.kind)
      || mountingBoxPoleNumber(left) - mountingBoxPoleNumber(right)
      || left.entryDepth - right.entryDepth
      || left.label.localeCompare(right.label, 'id')
      || left.id.localeCompare(right.id, 'id')
  ))

  attachCrossBoxJunctionFamilies({
    mountingBoxes,
    connectedNodes,
    edgeAdjacency,
  })
  {
    // Reserve an invisible subtree for every JB in every pole layout. Physical
    // frames stay separate, but their network children travel with their owner.
    const boxByNode = new Map(mountingBoxes.flatMap(box => box.nodes.map(node => [node.id, box])))
    for (const box of mountingBoxes) {
      if (!box.nodes.length || box.nodes.some(node =>
        ['rack-root', 'junction-peer', 'junction-extended'].includes(node.diagramClass))) continue
      const anchors = box.nodes.flatMap(node => (edgeAdjacency.get(node.id) ?? []).map(({id}) => ({
        child: node, parent: boxByNode.get(id)?.nodes.find(item => item.id === id), box: boxByNode.get(id),
      }))).filter(item => item.box && item.box !== box
        && ['junction-peer', 'junction-extended'].includes(item.parent?.diagramClass))
      const ownerId = preferredJunctionOwnerId(
        anchors.map(item => item.parent.id), nodeById, edgeAdjacency,
      )
      if (!ownerId) continue
      const anchor = anchors.find(item => item.parent.id === ownerId)
      box.layoutParentBoxId = anchor.box.id
      box.layoutParentNodeId = anchor.parent.id
      box.layoutChildNodeId = anchor.child.id
      box.connectionLabel = `Terhubung ke ${anchor.parent.name || anchor.parent.id}`
      for (const item of anchors) {
        if (item.parent.id === ownerId) item.child.layoutParentId = ownerId
      }
    }
  }
  const mountingBoxTree = buildMountingBoxTree(mountingBoxes, settings, edgeAdjacency)
  const boxesWidth = mountingBoxTree.width
  const coreWidth = coreNodes.reduce(
    (total, node) => total + hubNodeSize(node, settings).width,
    0,
  ) + Math.max(0, coreNodes.length - 1) * settings.hubNodeGapX
  let laneWidth = Math.max(settings.hubMinWidth, boxesWidth, coreWidth)
  const coreY = settings.hubPadding + settings.hubHeaderHeight
  const coreHeight = Math.max(
    settings.hubRootHeight,
    ...coreNodes.map((node) => hubNodeSize(node, settings).height),
  )
  const boxesY = coreNodes.length
    ? coreY + coreHeight + settings.backboneCoreGapY
    : settings.hubPadding + settings.hubHeaderHeight
  placeMountingBoxTree(
    mountingBoxTree,
    (laneWidth - boxesWidth) / 2,
    boxesY,
    settings,
  )
  if (Number(settings.mountingRootFrameGap) > 0) {
    const packedWidth = compactRootFrameSpacing(
      mountingBoxTree, mountingBoxes, Number(settings.mountingRootFrameGap), settings.mountingBoxGapX,
    )
    laneWidth = Math.max(settings.hubMinWidth, packedWidth, coreWidth)
    const offset = (laneWidth - packedWidth) / 2
    mountingBoxes.forEach(box => { box.x += offset; box.treeX += offset })
  }
  mountingBoxes.forEach((box) => {
    delete box.branchRows
    box.nodes.forEach((node) => translateNode(node, box.x, box.y))
  })

  const boxCentersByComponent = new Map()
  mountingBoxes.forEach((box) => {
    box.componentIds.forEach((componentId) => {
      boxCentersByComponent.set(componentId, [
        ...(boxCentersByComponent.get(componentId) ?? []),
        box.x + box.width / 2,
      ])
    })
  })
  const placedCoreNodes = []
  const coreSpecs = coreNodes.map((node) => {
    const size = hubNodeSize(node, settings)
    const centers = boxCentersByComponent.get(node.componentId) ?? []
    const desiredCenter = coreNodes.length === 1
      ? laneWidth / 2
      : centers.length
      ? centers.reduce((total, value) => total + value, 0) / centers.length
      : laneWidth / 2
    return { node, size, desiredCenter }
  }).sort((left, right) => left.desiredCenter - right.desiredCenter
    || compareNodes(left.node, right.node))
  let previousRight = -Infinity
  coreSpecs.forEach(({ node, size, desiredCenter }) => {
    const x = Math.max(
      0,
      Math.min(laneWidth - size.width, Math.max(desiredCenter - size.width / 2, previousRight)),
    )
    previousRight = x + size.width + settings.hubNodeGapX
    placedCoreNodes.push(toLayoutNode(node, {
      x,
      y: coreY,
      width: size.width,
      height: size.height,
      laneId: `area:${area.key}:pole-backbone`,
      laneIndex: 0,
      areaKey: area.key,
      presentation: 'pole-backbone',
      depth: node.depth,
      diagramClass: node.diagramClass,
      semanticTier: node.semanticTier,
      parentId: null,
      bandId: 'rack-root',
      rowIndex: 0,
      traversalIndex: 0,
      mountingBoxId: null,
      mountingRole: 'core',
    }))
  })
  // The rack/server is the presentation parent for every top-level asset
  // group in the area. This keeps disconnected JB islands and direct devices
  // (such as an indoor camera connected to the server) visually below the
  // server without inventing additional operational graph edges.
  const presentationRootId = placedCoreNodes[0]?.id ?? null
  if (presentationRootId) {
    mountingBoxes.forEach((box) => {
      box.nodes
        .filter((node) => !node.parentId && !node.layoutParentId)
        .forEach((node) => {
          node.parentId = presentationRootId
          node.layoutParentId = presentationRootId
        })
    })
  }
  const boxNodes = mountingBoxes.flatMap((box) => box.nodes)
  const laneHeight = Math.max(
    coreY + coreHeight + settings.hubPadding,
    boxesY + mountingBoxTree.height + settings.hubPadding,
  )
  return {
    kind: 'area-backbone',
    componentId: `area:${area.key}:pole-backbone`,
    componentIds: components.map(({ componentId }) => componentId),
    islandIndex: 1,
    title: '',
    rootId: placedCoreNodes[0]?.id ?? mountingBoxes[0]?.entryJunctionIds?.[0] ?? null,
    rootVerified: components.some(({ rootVerified }) => rootVerified),
    rootReason: 'pole-group backbone presentation',
    x: 0,
    y: 0,
    width: laneWidth,
    height: laneHeight,
    nodes: [...placedCoreNodes, ...boxNodes].sort(compareLayoutNodes),
    bands: [],
    edgeCount: components.reduce((total, component) => total + component.edgeIds.length, 0),
    presentation: 'pole-backbone',
    mountingBoxes,
  }
}

function splitIndependentPoleBranches(group, nodeById, adjacency) {
  if (group.kind !== 'confirmed' || !group.hostId || group.nodeIds.length < 2) return [group]
  const local = new Set(group.nodeIds)
  const namedParentById = buildNamedJunctionParents(group.nodeIds
    .map(id => nodeById.get(id)).filter(node => node
      && ['junction-peer', 'junction-extended'].includes(node.diagramClass)), adjacency)
  const unseen = new Set(group.nodeIds)
  const branches = []
  while (unseen.size) {
    const start = [...unseen].sort()[0]
    const queue = [start], members = []
    while (queue.length) {
      const id = queue.shift()
      if (!unseen.delete(id)) continue
      members.push(id)
      for (const next of adjacency.get(id) ?? []) {
        if (local.has(next.id) && unseen.has(next.id)) queue.push(next.id)
      }
      const namedParent = namedParentById.get(id)
      if (local.has(namedParent) && unseen.has(namedParent)) queue.push(namedParent)
      for (const [childId, parentId] of namedParentById) {
        if (parentId === id && unseen.has(childId)) queue.push(childId)
      }
    }
    branches.push(members.sort())
  }
  const withJunction = branches.filter(ids => ids.some(id =>
    ['junction-peer', 'junction-extended'].includes(nodeById.get(id)?.diagramClass)))
  if (withJunction.length < 2) return [group]
  branches.sort((left, right) => {
    const anchor = ids => ids.find(id =>
      ['junction-peer', 'junction-extended'].includes(nodeById.get(id)?.diagramClass)) ?? ids[0]
    return String(nodeById.get(anchor(left))?.name ?? anchor(left)).localeCompare(
      String(nodeById.get(anchor(right))?.name ?? anchor(right)), 'id')
  })
  return branches.map((nodeIds, index) => ({
    ...group,
    id: index === 0 ? group.id : `${group.id}:branch:${nodeIds.find(id =>
      ['junction-peer', 'junction-extended'].includes(nodeById.get(id)?.diagramClass)) ?? nodeIds[0]}`,
    physicalGroupId: group.id,
    nodeIds,
    presentationInheritedNodeIds: (group.presentationInheritedNodeIds ?? [])
      .filter(id => nodeIds.includes(id)),
  }))
}

// Physical co-location is not logical ownership. Keep the original mounting
// metadata, but give devices owned by an external JB a separate presentation
// frame that the subtree packer can place under that JB.
function splitFramesByExternalJunction(groups, nodeById, adjacency) {
  return groups.flatMap(group => {
    const local = new Set(group.nodeIds)
    const satellites = new Map()
    const retained = []
    for (const id of group.nodeIds) {
      const node = nodeById.get(id)
      const owners = node?.diagramClass === 'endpoint'
        ? [...new Set((adjacency.get(id) ?? []).map(next => next.id).filter(otherId => {
          const other = nodeById.get(otherId)
          return other?.areaKey === node.areaKey
            && ['junction-peer', 'junction-extended'].includes(other?.diagramClass)
        }))] : []
      const ownerId = preferredJunctionOwnerId(owners, nodeById, adjacency)
      if (!ownerId || local.has(ownerId)) {
        retained.push(id)
        continue
      }
      if (!satellites.has(ownerId)) satellites.set(ownerId, [])
      satellites.get(ownerId).push(id)
    }
    if (!satellites.size) return [group]
    const inherit = ids => (group.presentationInheritedNodeIds ?? []).filter(id => ids.includes(id))
    return [
      ...(retained.length ? [{...group, nodeIds: retained, presentationInheritedNodeIds: inherit(retained)}] : []),
      ...[...satellites].map(([ownerId, ids]) => ({...group,
        id: `${group.id}:junction:${ownerId}`, physicalGroupId: group.id,
        nodeIds: ids, presentationInheritedNodeIds: inherit(ids),
        connectionLabel: `Terhubung ke ${nodeById.get(ownerId).name || ownerId}`,
      })),
    ]
  })
}

// Diagram moves are presentation overrides. They intentionally do not rewrite
// mountingRelations: an administrator may want to show an asset inside an
// Indoor/Non-tiang frame while the physical mounting evidence stays intact.
function applyFrameAssignmentsToGroups(groups, assignments = {}, nodeById) {
  const entries = assignments instanceof Map
    ? [...assignments.entries()]
    : Object.entries(assignments ?? {})
  if (!entries.length) return groups

  const nextGroups = groups.map((group) => ({
    ...group,
    nodeIds: [...(group.nodeIds ?? [])],
    presentationInheritedNodeIds: [...(group.presentationInheritedNodeIds ?? [])],
  }))
  const groupById = new Map(nextGroups.map((group) => [group.id, group]))
  const groupByNodeId = new Map()
  nextGroups.forEach((group) => {
    group.nodeIds.forEach((nodeId) => groupByNodeId.set(nodeId, group))
  })

  entries
    .filter(([assetId, frameId]) => assetId && frameId)
    .sort(([left], [right]) => String(left).localeCompare(String(right), 'id'))
    .forEach(([assetId, frameId]) => {
      const node = nodeById.get(assetId)
      const source = groupByNodeId.get(assetId)
      const target = groupById.get(frameId)
      if (!node || !source || !target || source === target
        || !['confirmed', 'empty', 'excluded'].includes(target.kind)) return

      source.nodeIds = source.nodeIds.filter((id) => id !== assetId)
      source.presentationInheritedNodeIds = source.presentationInheritedNodeIds
        .filter((id) => id !== assetId)
      target.nodeIds = [...new Set([...target.nodeIds, assetId])]
      target.presentationInheritedNodeIds = target.presentationInheritedNodeIds
        .filter((id) => id !== assetId)
      groupByNodeId.set(assetId, target)

      // Keep a pole frame visible after its last child is moved, but let its
      // header truthfully switch to the empty state. Excluded frames without
      // nodes are removed below so stale visual containers do not linger.
      if (source.hostId && !source.nodeIds.length && source.kind === 'confirmed') {
        source.kind = 'empty'
      }
    })

  return nextGroups.filter((group) => group.custom || group.hostId || group.nodeIds.length || group.kind !== 'excluded')
}

function mountingBoxOrder(kind) {
  if (kind === 'confirmed') return 0
  if (kind === 'empty') return 0
  if (kind === 'needs-mounting') return 1
  if (kind === 'unassigned') return 2
  if (kind === 'excluded') return 3
  return 4
}

function buildExcludedMountingGroupSpecs({ area, nodeIds = [], connectedNodes = [], edgeAdjacency }) {
  const byId = new Map(connectedNodes.map(node => [node.id, node]))
  const isJunction = id => ['junction-peer', 'junction-extended'].includes(byId.get(id)?.diagramClass)
  const base = {hostId: null, hostType: 'Aset indoor atau standalone', kind: 'excluded', mountingConflict: false}
  const groups = new Map()
  // A JB is a grouping boundary, even when it is itself indoor/non-pole.
  // Never merge a whole connected backbone into one facility-specific frame.
  for (const id of [...nodeIds].sort()) {
    if (!isJunction(id)) continue
    groups.set(id, {...base, id: `excluded-mounting:${area.key}:${id}`,
      hostName: `${byId.get(id)?.mountingExpectation === 'indoor' ? 'Indoor' : 'Non-tiang'} · ${byId.get(id).name || id}`,
      nodeIds: [id]})
  }
  const remaining = new Set(nodeIds.filter(id => !isJunction(id)))
  // Directly connected devices with the same physical context belong to the
  // JB's own frame. Independent branches still receive separate frames.
  for (const id of [...remaining].sort()) {
    const node = byId.get(id)
    const owners = (edgeAdjacency.get(id) ?? []).map(({ id: ownerId }) => ownerId)
      .filter(ownerId => groups.has(ownerId)
        && byId.get(ownerId)?.mountingExpectation === node?.mountingExpectation
        && byId.get(ownerId)?.areaKey === node?.areaKey)
    const owner = preferredJunctionOwnerId(owners, byId, edgeAdjacency)
    if (!owner) continue
    groups.get(owner).nodeIds.push(id)
    remaining.delete(id)
  }
  while (remaining.size) {
    const first = [...remaining].sort()[0]
    const ids = [], queue = [first], owners = new Set()
    while (queue.length) {
      const id = queue.shift()
      if (!remaining.delete(id)) continue
      ids.push(id)
      for (const next of edgeAdjacency.get(id) ?? []) {
        if (isJunction(next.id)) owners.add(next.id)
        else if (remaining.has(next.id)
          && byId.get(next.id)?.mountingExpectation === byId.get(first)?.mountingExpectation) queue.push(next.id)
      }
    }
    const owner = preferredJunctionOwnerId([...owners], byId, edgeAdjacency)
    const kind = byId.get(first)?.mountingExpectation === 'indoor' ? 'Indoor' : 'Non-tiang'
    // Keep physical scope distinct from logical ownership, including standalone devices.
    const key = `${owner ?? first}:${kind}`
    if (groups.has(key)) groups.get(key).nodeIds.push(...ids)
    else groups.set(key, {...base, id: `excluded-mounting:${area.key}:${first}`,
      hostName: `${kind} · ${owner ? byId.get(owner).name || owner : ids.map(id => byId.get(id)?.name || id).join(', ')}`,
      ...(owner ? {connectionLabel: `Terhubung ke ${byId.get(owner).name || owner}`} : {}), nodeIds: ids})
  }
  return [...groups.values()]
}
function buildMountingBoxSpec({
  group,
  nodeById,
  componentByNodeId,
  edgeAdjacency,
  settings,
}) {
  const nodes = group.nodeIds.map((id) => nodeById.get(id)).filter(Boolean)
  const compactEndpointLabels = group.kind === 'excluded'
    && nodes.filter(node => node.diagramClass === 'endpoint').length > 1
  const nodeIds = new Set(nodes.map(({ id }) => id))
  const byComponent = new Map()
  nodes.forEach((node) => {
    const componentId = componentByNodeId.get(node.id)?.componentId ?? 'unscoped'
    byComponent.set(componentId, [...(byComponent.get(componentId) ?? []), node])
  })
  const junctions = nodes.filter((node) => (
    ['junction-peer', 'junction-extended'].includes(node.diagramClass)
  ))
  const namedParentById = buildNamedJunctionParents(junctions, edgeAdjacency)
  const entryJunctionIds = []
  byComponent.forEach((componentNodes) => {
    const regularJunctions = componentNodes.filter((node) => {
      if (node.diagramClass !== 'junction-peer') return false
      return junctionNumberIdentity(node.name)?.childIndex == null
    })
    if (!regularJunctions.length) return
    regularJunctions.sort((left, right) => (
      externalConfirmedDegree(right.id, nodeIds, edgeAdjacency)
        - externalConfirmedDegree(left.id, nodeIds, edgeAdjacency)
      || (left.depth ?? Number.MAX_SAFE_INTEGER) - (right.depth ?? Number.MAX_SAFE_INTEGER)
      || (right.confirmedDegree ?? 0) - (left.confirmedDegree ?? 0)
      || compareNodes(left, right)
    ))
    entryJunctionIds.push(regularJunctions[0].id)
  })
  namedParentById.forEach((parentId) => entryJunctionIds.push(parentId))
  const uniqueEntryJunctionIds = [...new Set(entryJunctionIds)]
  uniqueEntryJunctionIds.sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)))
  const levelById = new Map(uniqueEntryJunctionIds.map((id) => [id, 0]))
  const parentById = new Map()
  const queue = [...uniqueEntryJunctionIds]
  while (queue.length) {
    const parentId = queue.shift()
    const parentLevel = levelById.get(parentId) ?? 0
    const candidates = (edgeAdjacency.get(parentId) ?? [])
      .map(({ id }) => nodeById.get(id))
      .filter((node) => nodeIds.has(node?.id)
        && ['junction-peer', 'junction-extended'].includes(node?.diagramClass)
        && (!namedParentById.has(node.id) || namedParentById.get(node.id) === parentId)
        && !levelById.has(node.id))
      .sort(compareNodes)
    candidates.forEach((node) => {
      levelById.set(node.id, parentLevel + 1)
      parentById.set(node.id, parentId)
      queue.push(node.id)
    })
  }
  junctions
    .filter((node) => !levelById.has(node.id))
    .sort((left, right) => (
      (left.depth ?? Number.MAX_SAFE_INTEGER) - (right.depth ?? Number.MAX_SAFE_INTEGER)
      || compareNodes(left, right)
    ))
    .forEach((node) => {
      const namedParent = nodeById.get(namedParentById.get(node.id))
      const parent = namedParent && levelById.has(namedParent.id)
        ? namedParent
        : bestJunctionParent(node, nodeIds, levelById, nodeById, edgeAdjacency)
      const parentLevel = parent ? levelById.get(parent.id) ?? 0 : 0
      levelById.set(node.id, Math.max(1, parentLevel + 1))
      if (parent) parentById.set(node.id, parent.id)
    })
  const maximumJunctionLevel = Math.max(0, ...junctions.map((node) => levelById.get(node.id) ?? 0))
  const endpointLevel = maximumJunctionLevel + 1
  nodes.filter((node) => !levelById.has(node.id)).forEach((node) => {
    const parent = bestEndpointParent(node, nodeIds, nodeById, edgeAdjacency)
    levelById.set(node.id, parent ? (levelById.get(parent.id) ?? 0) + 1 : endpointLevel)
    if (parent) parentById.set(node.id, parent.id)
  })
  const rows = new Map()
  nodes.forEach((node) => {
    const level = levelById.get(node.id) ?? endpointLevel
    rows.set(level, [...(rows.get(level) ?? []), node])
  })
  rows.forEach((row) => row.sort((left, right) => (
    compareLayoutParents(
      parentById.get(left.id),
      parentById.get(right.id),
      nodeById,
    )
      || (left.diagramClass === 'junction-peer' ? 0 : left.diagramClass === 'junction-extended' ? 1 : 2)
        - (right.diagramClass === 'junction-peer' ? 0 : right.diagramClass === 'junction-extended' ? 1 : 2)
      || compareNodes(left, right)
  )))
  const rowWidths = new Map()
  const rowHeights = new Map()
  rows.forEach((row, level) => {
    rowWidths.set(level, row.reduce(
      (total, node) => total + hubNodeSize(node, settings).width,
      Math.max(0, row.length - 1) * settings.mountingBoxNodeGapX,
    ))
    rowHeights.set(level, Math.max(...row.map((node) => hubNodeSize(node, settings).height)))
  })
  // Allocate horizontal space per logical subtree, independently of the
  // physical frame. A camera under one JB must not drift under another JB.
  const childrenById = new Map(nodes.map(node => [node.id, []]))
  nodes.forEach(node => {
    if (childrenById.has(parentById.get(node.id))) childrenById.get(parentById.get(node.id)).push(node)
  })
  childrenById.forEach(children => children.sort(compareNodes))
  const roots = nodes.filter(node => !parentById.has(node.id)).sort(compareNodes)
  const subtreeWidths = new Map()
  const measure = node => {
    const children = childrenById.get(node.id)
    const childrenWidth = children.reduce((sum, child) => sum + measure(child), 0)
      + Math.max(0, children.length - 1) * settings.mountingBoxNodeGapX
    const size = Math.max(hubNodeSize(node, settings).width, childrenWidth)
    subtreeWidths.set(node.id, size)
    return size
  }
  const forestWidth = roots.reduce((sum, node) => sum + measure(node), 0)
    + Math.max(0, roots.length - 1) * settings.mountingBoxNodeGapX
  const width = Math.max(
    settings.mountingBoxMinWidth,
    forestWidth,
    ...rowWidths.values(),
  ) + settings.mountingBoxPadding * 2
  const nodeX = new Map()
  const place = (node, left) => {
    const span = subtreeWidths.get(node.id)
    nodeX.set(node.id, left + (span - hubNodeSize(node, settings).width) / 2)
    const children = childrenById.get(node.id)
    const childSpan = children.reduce((sum, child) => sum + subtreeWidths.get(child.id), 0)
      + Math.max(0, children.length - 1) * settings.mountingBoxNodeGapX
    let childX = left + (span - childSpan) / 2
    children.forEach(child => {
      place(child, childX)
      childX += subtreeWidths.get(child.id) + settings.mountingBoxNodeGapX
    })
  }
  let rootX = (width - forestWidth) / 2
  roots.forEach(node => {
    place(node, rootX)
    rootX += subtreeWidths.get(node.id) + settings.mountingBoxNodeGapX
  })
  const levels = [...rows.keys()].sort((left, right) => left - right)
  let rowY = settings.mountingBoxHeaderHeight + settings.mountingBoxPadding
  const layoutNodes = []
  levels.forEach((level) => {
    const row = rows.get(level)
    let rowX = (width - rowWidths.get(level)) / 2
    row.forEach((node, index) => {
      const size = hubNodeSize(node, settings)
      const entry = uniqueEntryJunctionIds.includes(node.id)
      const layoutNode = toLayoutNode(node, {
        x: nodeX.get(node.id) ?? rowX,
        y: rowY,
        width: size.width,
        height: size.height,
        laneId: group.id,
        laneIndex: 0,
        areaKey: node.areaKey,
        presentation: 'pole-backbone',
        depth: node.depth,
        diagramClass: node.diagramClass,
        semanticTier: node.semanticTier,
        parentId: parentById.get(node.id) ?? null,
        bandId: hubBandId(node.diagramClass),
        rowIndex: level,
        traversalIndex: index,
        mountingBoxId: group.id,
        mountingRole: entry
          ? 'entry-junction'
          : ['junction-peer', 'junction-extended'].includes(node.diagramClass)
            ? 'downstream-junction'
            : 'endpoint',
      })
      layoutNode.suppressTypeLabel = compactEndpointLabels
        && node.diagramClass === 'endpoint'
      layoutNode.mountingRelationStatus = group.kind === 'unassigned'
        ? 'unassigned'
        : group.presentationInheritedNodeIds?.includes(node.id)
        ? ['indoor', 'standalone'].includes(node.mountingExpectation)
          ? 'excluded'
          : node.mountingExpectation === 'pole' || node.mountingExpectation == null
            ? 'needs-mounting'
            : 'unassigned'
        : group.kind === 'confirmed'
          ? 'confirmed'
          : group.kind === 'excluded'
            ? 'excluded'
            : group.kind === 'needs-mounting' ? 'needs-mounting' : 'unassigned'
      layoutNodes.push(layoutNode)
      rowX += size.width + settings.mountingBoxNodeGapX
    })
    rowY += rowHeights.get(level) + settings.mountingBoxLevelGapY
  })
  const height = Math.max(
    settings.mountingBoxHeaderHeight + settings.mountingBoxPadding * 2 + settings.hubEndpointHeight,
    rowY - settings.mountingBoxLevelGapY + Math.max(32, settings.mountingBoxPadding),
  )
  return {
    ...group,
    label: group.hostName,
    x: 0,
    y: 0,
    width,
    height,
    nodes: layoutNodes.sort(compareLayoutNodes),
    nodeIds: layoutNodes.map(({ id }) => id),
    entryJunctionIds: uniqueEntryJunctionIds,
    entryDepth: Math.min(
      ...uniqueEntryJunctionIds.map((id) => nodeById.get(id)?.depth ?? Number.MAX_SAFE_INTEGER),
      Number.MAX_SAFE_INTEGER,
    ),
    componentIds: [...new Set(layoutNodes.map((node) => node.componentId).filter(Boolean))],
  }
}

function attachNamedJunctionFamiliesToMountingGroups({
  confirmedGroups,
  connectedNodes,
  assignedNodeIds,
  area = null,
}) {
  const connectedNodeById = new Map(connectedNodes.map((node) => [node.id, node]))
  const junctions = connectedNodes.filter((node) => (
    ['junction-peer', 'junction-extended'].includes(node.diagramClass)
  ))
  const families = new Map()
  junctions.forEach((node) => {
    const identity = junctionNumberIdentity(node.name)
    if (!identity) return
    families.set(identity.baseNumber, [
      ...(families.get(identity.baseNumber) ?? []),
      { node, identity },
    ])
  })
  const groupByNodeId = new Map()
  confirmedGroups.forEach((group) => {
    group.nodeIds.forEach((nodeId) => groupByNodeId.set(nodeId, group))
  })
  families.forEach((members) => {
    const base = members.find(({ identity }) => identity.childIndex === null)?.node ?? null
    const candidateGroups = [...new Set(members
      .map(({ node }) => groupByNodeId.get(node.id))
      .filter(Boolean))]
    if (!candidateGroups.length) return
    const baseGroup = base ? groupByNodeId.get(base.id) : null
    // DPPU keeps unmounted base JBs in their own non-pole scope. Other
    // facilities retain the legacy fallback that co-locates a family when
    // only the extension has a confirmed mounting group.
    if (area?.key === 'dppu-yia' && !baseGroup) return
    const targetGroup = baseGroup ?? candidateGroups.sort((left, right) => {
      const firstChildIndex = (group) => Math.min(
        ...members
          .filter(({ node }) => group.nodeIds.includes(node.id))
          .map(({ identity }) => identity.childIndex ?? -1),
      )
      return firstChildIndex(left) - firstChildIndex(right)
        || String(left.id).localeCompare(String(right.id), 'id')
    })[0]
  const inheritedIds = members
      .filter(({ node }) => !['indoor', 'standalone'].includes(node.mountingExpectation))
      .map(({ node }) => node.id)
      .filter((nodeId) => !assignedNodeIds.has(nodeId))
    if (!inheritedIds.length) return
    inheritedIds.forEach((nodeId) => assignedNodeIds.add(nodeId))
    targetGroup.nodeIds = [...new Set([...targetGroup.nodeIds, ...inheritedIds])]
      .sort((left, right) => compareNodes(
        connectedNodeById.get(left),
        connectedNodeById.get(right),
      ))
    targetGroup.presentationInheritedNodeIds = [
      ...new Set([...(targetGroup.presentationInheritedNodeIds ?? []), ...inheritedIds]),
    ].sort((left, right) => left.localeCompare(right, 'id'))
  })
}

function buildEndpointJunctionGroups({
  confirmedGroups,
  connectedNodes,
  assignedNodeIds,
  edgeAdjacency,
}) {
  const connectedNodeById = new Map(connectedNodes.map((node) => [node.id, node]))
  const junctions = connectedNodes.filter((node) => (
    ['junction-peer', 'junction-extended'].includes(node.diagramClass)
  ))
  const junctionGroupById = new Map()
  confirmedGroups.forEach((group) => {
    group.nodeIds
      .map((nodeId) => connectedNodeById.get(nodeId))
      .filter((node) => node && ['junction-peer', 'junction-extended'].includes(node.diagramClass))
      .forEach((node) => junctionGroupById.set(node.id, group))
  })
  const extraGroups = junctions
    .filter(node => !['indoor', 'standalone'].includes(node.mountingExpectation))
    .filter((junction) => !junctionGroupById.has(junction.id) && !assignedNodeIds.has(junction.id))
    .filter((junction) => (edgeAdjacency.get(junction.id) ?? [])
      .some(({ id }) => connectedNodeById.get(id)?.diagramClass === 'endpoint'))
    .sort(compareNodes)
    .map((junction) => {
      const group = {
        id: `junction-endpoints:${junction.id}`,
        hostId: null,
        hostName: junction.name || junction.id,
        hostType: 'JB endpoint group',
        kind: 'unassigned',
        nodeIds: [junction.id],
        mountingConflict: false,
        presentationInheritedNodeIds: [],
      }
      junctionGroupById.set(junction.id, group)
      assignedNodeIds.add(junction.id)
      return group
    })
  ;[...junctionGroupById.entries()].forEach(([junctionId, group]) => {
    const endpointIds = (edgeAdjacency.get(junctionId) ?? [])
      .map(({ id }) => connectedNodeById.get(id))
      .filter((node) => node?.diagramClass === 'endpoint')
      .filter(node => !['indoor', 'standalone'].includes(node.mountingExpectation))
      .map((node) => node.id)
      .sort((left, right) => compareNodes(
        connectedNodeById.get(left),
        connectedNodeById.get(right),
      ))
    endpointIds.forEach((endpointId) => {
      // Preserve an explicit physical pole placement when it already owns
      // the endpoint. Only unassigned endpoints are inherited by a JB-only
      // presentation group.
      if (assignedNodeIds.has(endpointId)) return
      ;[...new Set(junctionGroupById.values())].forEach((candidate) => {
        if (candidate === group) return
        candidate.nodeIds = candidate.nodeIds.filter((id) => id !== endpointId)
        candidate.presentationInheritedNodeIds = (candidate.presentationInheritedNodeIds ?? [])
          .filter((id) => id !== endpointId)
      })
      if (!group.nodeIds.includes(endpointId)) group.nodeIds.push(endpointId)
      if (!(group.presentationInheritedNodeIds ?? []).includes(endpointId)) {
        group.presentationInheritedNodeIds = [
          ...(group.presentationInheritedNodeIds ?? []),
          endpointId,
        ]
      }
      assignedNodeIds.add(endpointId)
    })
    group.nodeIds.sort((left, right) => compareNodes(
      connectedNodeById.get(left),
      connectedNodeById.get(right),
    ))
  })
  return extraGroups
}

function buildNamedJunctionParents(junctions, adjacency) {
  const identityById = new Map(junctions.map((node) => [node.id, junctionNumberIdentity(node.name)]))
  const rootsByNumber = new Map()
  junctions.forEach((node) => {
    const identity = identityById.get(node.id)
    if (!identity || identity.childIndex !== null) return
    rootsByNumber.set(identity.baseNumber, [
      ...(rootsByNumber.get(identity.baseNumber) ?? []),
      node,
    ])
  })
  const parentById = new Map()
  junctions.forEach((node) => {
    const identity = identityById.get(node.id)
    if (!identity || identity.childIndex === null) return
    const candidates = rootsByNumber.get(identity.baseNumber) ?? []
    const adjacentIds = new Set((adjacency.get(node.id) ?? []).map(({ id }) => id))
    const parent = [...candidates].sort((left, right) => (
      Number(adjacentIds.has(right.id)) - Number(adjacentIds.has(left.id))
      || Number(right.diagramClass === 'junction-peer')
        - Number(left.diagramClass === 'junction-peer')
      || compareNodes(left, right)
    ))[0]
    if (parent) parentById.set(node.id, parent.id)
  })
  return parentById
}

function junctionNumberIdentity(value) {
  // Support both short JB-15.1-WP names and DPPU's JB-CCTV-15.1-WP names.
  // This identity is presentation metadata only: it links an extension box
  // back to its numbered parent without creating a network edge.
  const match = String(value ?? '').match(
    /\bjb(?:[\s_-]*[a-z]+)*[\s_-]*0*(\d+)(?:[._-]+0*(\d+))?/i,
  )
  if (!match) return null
  return {
    baseNumber: String(Number(match[1])),
    childIndex: match[2] === undefined ? null : Number(match[2]),
  }
}

function preferredJunctionOwnerId(ownerIds, nodeById, adjacency) {
  const ids = [...new Set(ownerIds)]
  if (ids.length === 1) return ids[0]
  if (!ids.length) return null
  // A camera may retain a confirmed link to the base JB after gaining a
  // direct link to its numbered extension. Only that ancestor pair is safe
  // to collapse for presentation; unrelated multiple owners stay ambiguous.
  const children = ids.filter(id => {
    const identity = junctionNumberIdentity(nodeById.get(id)?.name)
    if (identity?.childIndex == null) return false
    const neighbors = new Set((adjacency.get(id) ?? []).map(({id: next}) => next))
    return ids.every(otherId => {
      if (otherId === id) return true
      const other = junctionNumberIdentity(nodeById.get(otherId)?.name)
      return other?.baseNumber === identity.baseNumber
        && other.childIndex === null && neighbors.has(otherId)
    })
  })
  return children.length === 1 ? children[0] : null
}

function compareLayoutParents(leftParentId, rightParentId, nodeById) {
  if (leftParentId === rightParentId) return 0
  if (!leftParentId) return -1
  if (!rightParentId) return 1
  const left = nodeById.get(leftParentId)
  const right = nodeById.get(rightParentId)
  if (left && right) return compareNodes(left, right)
  return String(leftParentId).localeCompare(String(rightParentId), 'id')
}

function attachCrossBoxJunctionFamilies({
  mountingBoxes,
  connectedNodes,
  edgeAdjacency,
}) {
  const junctions = connectedNodes.filter((node) => (
    ['junction-peer', 'junction-extended'].includes(node.diagramClass)
  ))
  const boxByNodeId = new Map()
  mountingBoxes.forEach((box) => {
    box.nodeIds.forEach((nodeId) => boxByNodeId.set(nodeId, box))
  })
  const parentCandidatesByBoxId = new Map()
  const parentById = buildNamedJunctionParents(junctions, edgeAdjacency)
  const junctionById = new Map(junctions.map(node => [node.id, node]))
  for (const node of junctions) {
    if (parentById.has(node.id) || node.diagramClass !== 'junction-extended') continue
    const parents = (edgeAdjacency.get(node.id) ?? []).map(({id}) => junctionById.get(id))
      .filter(parent => parent && parent.depth < node.depth)
      .sort((a, b) => b.depth - a.depth || compareNodes(a, b))
    if (parents.length === 1) parentById.set(node.id, parents[0].id)
  }
  parentById.forEach((parentNodeId, childNodeId) => {
    const childBox = boxByNodeId.get(childNodeId)
    const parentBox = boxByNodeId.get(parentNodeId)
    if (!childBox || !parentBox || childBox.id === parentBox.id) return
    const confirmedSibling = (edgeAdjacency.get(childNodeId) ?? [])
      .some(({ id }) => id === parentNodeId)
    if (!confirmedSibling || childBox.entryJunctionIds.length) return
    parentCandidatesByBoxId.set(childBox.id, [
      ...(parentCandidatesByBoxId.get(childBox.id) ?? []),
      { childNodeId, parentNodeId, parentBox },
    ])
  })
  parentCandidatesByBoxId.forEach((candidates, childBoxId) => {
    const childBox = mountingBoxes.find(({ id }) => id === childBoxId)
    if (!childBox) return
    const selected = [...candidates].sort((left, right) => (
      left.parentBox.label.localeCompare(right.parentBox.label, 'id')
      || left.parentNodeId.localeCompare(right.parentNodeId, 'id')
      || left.childNodeId.localeCompare(right.childNodeId, 'id')
    ))[0]
    childBox.layoutParentBoxId = selected.parentBox.id
    childBox.layoutParentNodeId = selected.parentNodeId
    childBox.layoutChildNodeId = selected.childNodeId
    const childNode = childBox.nodes.find(({ id }) => id === selected.childNodeId)
    if (childNode) {
      childNode.layoutParentId = selected.parentNodeId
      childNode.mountingRole = 'downstream-junction'
      childNode.rowIndex = Math.max(1, childNode.rowIndex ?? 1)
    }
  })
}

function buildMountingBoxTree(mountingBoxes, settings, edgeAdjacency) {
  const boxById = new Map(mountingBoxes.map((box) => [box.id, box]))
  const childrenById = new Map(mountingBoxes.map((box) => [box.id, []]))
  mountingBoxes.forEach((box) => {
    if (!boxById.has(box.layoutParentBoxId)) return
    childrenById.get(box.layoutParentBoxId).push(box)
  })
  childrenById.forEach((children) => children.sort(compareMountingBoxes))
  const roots = mountingBoxes
    .filter((box) => !boxById.has(box.layoutParentBoxId))
    .sort(compareMountingBoxes)
  const visiting = new Set()
  const measure = (box) => {
    if (box.treeWidth && box.treeHeight) return box
    if (visiting.has(box.id)) {
      box.layoutParentBoxId = null
      box.treeWidth = box.width
      box.treeHeight = box.height
      return box
    }
    visiting.add(box.id)
    const children = childrenById.get(box.id) ?? []
    const owners = [...new Set(children.map(child => child.layoutParentNodeId))].sort()
    children.forEach(child => { child.routingTrack = owners.indexOf(child.layoutParentNodeId) })
    box.childRoutingGap = Math.max(settings.mountingBoxGapY, 24 + owners.length * 12)
    children.forEach(measure)
    box.branchRows = measureSiblingJunctionFrame(
      box, children, boxById.get(box.layoutParentBoxId), edgeAdjacency, settings,
    )
    box.siblingJunctionGrid = Boolean(box.branchRows)
    if (children.some(child => child.branchRows)) {
      box.childRoutingGap = Math.max(box.childRoutingGap, settings.mountingBoxGapY + 48)
    }
    // Keep dense camera siblings in a small grid. Narrow branch children can
    // share a column so every root frame keeps the same visible spacing.
    box.gridEndpointChildren = !box.branchRows && shouldGridEndpointChildren(box, children)
    const compactBranchChildren = Number(settings.mountingRootFrameGap) > 0
      && children.length >= 2
      && !children.some(child => child.branchRows)
      && (box.kind === 'excluded' || children.every(child => child.kind === 'excluded'))
      && children.every(child => child.treeWidth <= child.width)
    if (box.gridEndpointChildren) children.sort((left, right) => {
      const leftX = box.nodes.find(node => node.id === left.layoutParentNodeId).diagram.centerX
      const rightX = box.nodes.find(node => node.id === right.layoutParentNodeId).diagram.centerX
      return leftX - rightX || compareMountingBoxes(left, right)
    })
    box.gridColumns = box.branchRows ? 0 : box.gridEndpointChildren
      ? Math.ceil(Math.sqrt(children.length)) : compactBranchChildren ? 1 : 0
    const childGridRows = box.gridColumns ? chunk(children, box.gridColumns) : null
    const childrenWidth = children.reduce((total, child) => total + child.treeWidth, 0)
      + Math.max(0, children.length - 1) * settings.mountingBoxGapX
    const childrenHeight = Math.max(0, ...children.map((child) => child.treeHeight))
    box.treeWidth = box.branchRows ? box.width : childGridRows
      ? Math.max(box.width, ...childGridRows.map(row => row.reduce(
        (total, child) => total + child.treeWidth, 0)
        + Math.max(0, row.length - 1) * settings.mountingBoxGapX))
      : Math.max(box.width, childrenWidth)
    box.treeHeight = box.height + (children.length
      ? box.branchRows
        ? box.childRoutingGap + box.branchRows.reduce((total, row) => total + row.height, 0)
          + Math.max(0, box.branchRows.length - 1) * settings.mountingBoxGapY
        : box.childRoutingGap + (childGridRows
          ? childGridRows.reduce((total, row) => total + Math.max(...row.map(child => child.treeHeight)), 0)
            + Math.max(0, childGridRows.length - 1) * settings.mountingBoxGapY
          : childrenHeight)
      : 0)
    visiting.delete(box.id)
    return box
  }
  roots.forEach(measure)
  const requestedColumns = Number(settings.mountingRootColumns)
  const rootColumns = Number.isFinite(requestedColumns) && requestedColumns > 0
    ? Math.max(1, Math.floor(requestedColumns))
    : Math.max(1, roots.length)
  const rootRows = []
  for (let index = 0; index < roots.length; index += rootColumns) {
    rootRows.push(roots.slice(index, index + rootColumns))
  }
  const rowWidth = (row) => row.reduce((total, root) => total + root.treeWidth, 0)
    + Math.max(0, row.length - 1) * (settings.mountingRootGapX ?? settings.mountingBoxGapX)
  const rowHeight = (row) => Math.max(0, ...row.map((root) => root.treeHeight))
  return {
    roots,
    rootRows,
    childrenById,
    width: Math.max(0, ...rootRows.map(rowWidth)),
    height: rootRows.reduce((total, row) => total + rowHeight(row), 0)
      + Math.max(0, rootRows.length - 1) * settings.mountingRootRowGapY,
  }
}

function shouldGridEndpointChildren(box, children) {
  if (children.length < 3 || !children.every(child => child.kind === 'excluded'
    && child.nodes.length && child.nodes.every(node => node.diagramClass === 'endpoint'))) return false
  const anchors = children.map(child => box.nodes.find(node => node.id === child.layoutParentNodeId))
  if (anchors.some(anchor => !anchor)
    || new Set(anchors.map(anchor => anchor.id)).size !== anchors.length) return false
  const centers = anchors.map(anchor => anchor.diagram.centerX)
  return Math.max(...centers) - Math.min(...centers)
    < Math.min(...children.map(child => child.treeWidth)) * 2
}

function measureSiblingJunctionFrame(box, children, parentBox, edgeAdjacency, settings) {
  if (!box.custom || box.kind !== 'excluded' || !parentBox) return null
  const junctions = box.nodes.filter(node =>
    ['junction-peer', 'junction-extended'].includes(node.diagramClass))
  const baseNumber = junctionNumberIdentity(junctions[0]?.name)?.baseNumber
  const parentIds = new Set(parentBox.nodes
    .filter(node => junctionNumberIdentity(node.name)?.baseNumber === baseNumber)
    .map(node => node.id))
  const junctionIds = new Set(junctions.map(node => node.id))
  if (junctions.length < 2 || junctions.length !== box.nodes.length
    || baseNumber == null || !parentIds.size
    || children.some(child => !junctionIds.has(child.layoutParentNodeId))
    || junctions.some(node => junctionNumberIdentity(node.name)?.baseNumber !== baseNumber
      || !(edgeAdjacency.get(node.id) ?? []).some(({id}) => parentIds.has(id)))) return null
  const ordered = junctions.sort((left, right) =>
    String(left.name ?? '').localeCompare(String(right.name ?? ''), 'id', {numeric: true})
      || left.id.localeCompare(right.id, 'id'))
  const rows = chunk(ordered, 3).map(nodes => {
    const columns = nodes.map(node => {
      const childBoxes = children.filter(child => child.layoutParentNodeId === node.id)
      return {
        node,
        children: childBoxes,
        width: Math.max(node.diagram.width, ...childBoxes.map(child => child.treeWidth)),
        height: childBoxes.reduce((total, child) => total + child.treeHeight, 0)
          + Math.max(0, childBoxes.length - 1) * settings.mountingBoxGapY,
      }
    })
    return {
      columns,
      width: columns.reduce((total, column) => total + column.width, 0)
        + Math.max(0, columns.length - 1) * settings.mountingBoxGapX,
      height: Math.max(0, ...columns.map(column => column.height)),
    }
  })
  const originalHeight = box.height
  const firstNodeY = Math.min(...ordered.map(node => node.diagram.y))
  const nodeHeight = Math.max(...ordered.map(node => node.diagram.height))
  box.width = Math.max(box.width,
    ...rows.map(row => row.width + settings.mountingBoxPadding * 2))
  box.height = originalHeight + (rows.length - 1)
    * (nodeHeight + settings.mountingBoxLevelGapY)
  rows.forEach((row, rowIndex) => {
    let columnX = (box.width - row.width) / 2
    row.columns.forEach(column => {
      column.x = columnX
      const nodeX = columnX + (column.width - column.node.diagram.width) / 2
      const nodeY = firstNodeY + rowIndex * (nodeHeight + settings.mountingBoxLevelGapY)
      translateNode(column.node, nodeX - column.node.diagram.x, nodeY - column.node.diagram.y)
      column.node.rowIndex = rowIndex
      columnX += column.width + settings.mountingBoxGapX
    })
  })
  return rows
}

function placeMountingBoxTree(tree, x, y, settings) {
  const place = (box, subtreeX, subtreeY, rootBoxId) => {
    box.rootBoxId = rootBoxId
    box.treeX = subtreeX
    box.x = subtreeX + (box.treeWidth - box.width) / 2
    box.y = subtreeY
    const children = tree.childrenById.get(box.id) ?? []
    if (!children.length) return
    if (box.branchRows) {
      let rowY = subtreeY + box.height + box.childRoutingGap
      box.branchRows.forEach((row, rowIndex) => {
        row.columns.forEach(column => {
          let childY = rowY
          column.children.forEach((child, stackIndex) => {
            child.denseSiblingRowIndex = rowIndex + stackIndex
            place(child, subtreeX + column.x + (column.width - child.treeWidth) / 2,
              childY, rootBoxId)
            childY += child.treeHeight + settings.mountingBoxGapY
          })
        })
        rowY += row.height + settings.mountingBoxGapY
      })
      return
    }
    if (box.gridColumns) {
      let childY = subtreeY + box.height + box.childRoutingGap
      chunk(children, box.gridColumns).forEach((row, rowIndex) => {
        const rowWidth = row.reduce((total, child) => total + child.treeWidth, 0)
          + Math.max(0, row.length - 1) * settings.mountingBoxGapX
        let childX = subtreeX + (box.treeWidth - rowWidth) / 2
        row.forEach(child => {
          child.denseSiblingRowIndex = rowIndex
          place(child, childX, childY, rootBoxId)
          childX += child.treeWidth + settings.mountingBoxGapX
        })
        childY += Math.max(...row.map(child => child.treeHeight)) + settings.mountingBoxGapY
      })
      return
    }
    const childrenWidth = children.reduce((total, child) => total + child.treeWidth, 0)
      + Math.max(0, children.length - 1) * settings.mountingBoxGapX
    let childX = subtreeX + (box.treeWidth - childrenWidth) / 2
    const childY = subtreeY + box.height + box.childRoutingGap
    children.forEach((child) => {
      place(child, childX, childY, rootBoxId)
      childX += child.treeWidth + settings.mountingBoxGapX
    })
  }
  let rowY = y
  const rows = tree.rootRows ?? [tree.roots]
  rows.forEach((row) => {
    const rowWidth = row.reduce((total, root) => total + root.treeWidth, 0)
      + Math.max(0, row.length - 1) * (settings.mountingRootGapX ?? settings.mountingBoxGapX)
    let rootX = x + (tree.width - rowWidth) / 2
    row.forEach((root) => {
      place(root, rootX, rowY, root.id)
      rootX += root.treeWidth + (settings.mountingRootGapX ?? settings.mountingBoxGapX)
    })
    rowY += Math.max(0, ...row.map((root) => root.treeHeight))
      + settings.mountingRootRowGapY
  })
}

function compactRootFrameSpacing(tree, boxes, frameGap, subtreeGap) {
  const families = tree.roots.map(root => ({
    root,
    boxes: boxes.filter(box => box.rootBoxId === root.id),
  }))
  const placed = []
  let previousRoot = null
  families.forEach(({root, boxes: family}) => {
    if (!previousRoot) {
      placed.push(...family)
      previousRoot = root
      return
    }
    // Indent by the visible frame, then shift only as far as overlapping
    // descendants require. Empty horizontal subtree slots are not spacing.
    let shift = previousRoot.x + previousRoot.width + frameGap - root.x
    for (const candidate of family) {
      for (const earlier of placed) {
        if (candidate.y >= earlier.y + earlier.height
          || earlier.y >= candidate.y + candidate.height) continue
        shift = Math.max(shift, earlier.x + earlier.width + subtreeGap - candidate.x)
      }
    }
    family.forEach(box => { box.x += shift; box.treeX += shift })
    placed.push(...family)
    previousRoot = root
  })
  const left = Math.min(...boxes.map(box => box.x))
  boxes.forEach(box => { box.x -= left; box.treeX -= left })
  return Math.max(0, ...boxes.map(box => box.x + box.width))
}

function compareMountingBoxes(left, right) {
  return mountingBoxOrder(left.kind) - mountingBoxOrder(right.kind)
    || mountingBoxPoleNumber(left) - mountingBoxPoleNumber(right)
    || left.entryDepth - right.entryDepth
    || left.label.localeCompare(right.label, 'id')
    || left.id.localeCompare(right.id, 'id')
}

function mountingBoxPoleNumber(box) {
  const label = String(box.hostName ?? box.label ?? '')
  const match = label.match(/\bt[\s_-]*0*(\d+)\b/i)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function presentationExcludedFromPole(node, area) {
  if (area?.key !== 'dppu-yia') return false
  return String(node.name ?? '').trim().toUpperCase() === 'JB-CCTV-15-WP'
}

function buildLayoutEdgeAdjacency(nodes, edges) {
  const adjacency = new Map(nodes.map(({ id }) => [id, []]))
  edges.forEach((edge) => {
    if (!adjacency.has(edge.sourceId) || !adjacency.has(edge.targetId)) return
    adjacency.get(edge.sourceId).push({ id: edge.targetId, edge })
    adjacency.get(edge.targetId).push({ id: edge.sourceId, edge })
  })
  adjacency.forEach((neighbors) => neighbors.sort((left, right) => left.id.localeCompare(right.id, 'id')))
  return adjacency
}

function externalConfirmedDegree(nodeId, localNodeIds, adjacency) {
  return (adjacency.get(nodeId) ?? []).filter(({ id }) => !localNodeIds.has(id)).length
}

function bestJunctionParent(node, localNodeIds, levelById, nodeById, adjacency) {
  return (adjacency.get(node.id) ?? [])
    .map(({ id }) => nodeById.get(id))
    .filter((candidate) => localNodeIds.has(candidate?.id)
      && levelById.has(candidate.id)
      && ['junction-peer', 'junction-extended'].includes(candidate.diagramClass))
    .sort((left, right) => (levelById.get(left.id) ?? 0) - (levelById.get(right.id) ?? 0)
      || compareNodes(left, right))[0] ?? null
}

function bestEndpointParent(node, localNodeIds, nodeById, adjacency) {
  const neighbors = (adjacency.get(node.id) ?? [])
    .map(({ id }) => nodeById.get(id))
    .filter(Boolean)
  return neighbors
    .filter((candidate) => localNodeIds.has(candidate.id)
      && ['junction-peer', 'junction-extended'].includes(candidate.diagramClass))
    .sort((left, right) => (right.confirmedDegree ?? 0) - (left.confirmedDegree ?? 0)
      || compareNodes(left, right))[0]
    ?? neighbors
      .filter((candidate) => ['rack-root', 'junction-peer', 'junction-extended']
        .includes(candidate.diagramClass))
      .sort((left, right) => (left.depth ?? Number.MAX_SAFE_INTEGER)
        - (right.depth ?? Number.MAX_SAFE_INTEGER)
        || compareNodes(left, right))[0]
    ?? null
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
      islandIndex: index + 1,
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
      const parent = nodeById.get(parentId)
      const endpointLeaf = child?.diagramClass === 'endpoint'
        && ['rack-root', 'junction-peer', 'junction-extended'].includes(parent?.diagramClass)
      levelById.set(childId, endpointLeaf
        ? parentLevel + 1
        : Math.max(parentLevel + 1, semanticLevel, 1))
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
    islandIndex: index + 1,
    title: '',
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
  // Preserve the confirmed JB-to-JB backbone. Only skip endpoint ancestors so
  // a camera/device does not become a visual parent for another device.
  let candidate = parentById.get(node.id) ?? null
  while (candidate && nodeById.get(candidate)?.diagramClass === 'endpoint') {
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
    islandIndex: index + 1,
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
  const columns = Math.max(1, Math.min(14, sorted.length))
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
      presentation: 'tray',
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
  mountingBoxId = node.mountingBoxId ?? null,
  mountingRole = node.mountingRole ?? null,
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
    layoutParentId: parentId,
    bandId,
    rowIndex,
    traversalIndex,
    mountingBoxId,
    compoundGroupId: mountingBoxId,
    mountingRole,
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
  if (settings.layoutStyle === 'facility-schematic') return {width: 168, height: 64}
  return baseNodeSize(node, settings)
}

function baseNodeSize(node, settings) {
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
  if (settings.layoutStyle === 'facility-schematic') return node.diagramClass === 'rack-root'
    ? {width: 228, height: 88} : {width: 208, height: 76}
  return baseHubNodeSize(node, settings)
}

function baseHubNodeSize(node, settings) {
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
    || right.nodeIds.length - left.nodeIds.length
    || Number(right.rootVerified) - Number(left.rootVerified)
    || Number(right.suggestedLinkIds?.length > 0) - Number(left.suggestedLinkIds?.length > 0)
    || String(left.rootId ?? '').localeCompare(String(right.rootId ?? ''), 'id')
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
  const sourceBox = connectionBoxForNode(source)
  const targetBox = connectionBoxForNode(target)
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

function routeEdge(source, target, mountingBoxById = new Map()) {
  if (!source || !target) return []
  const sourceBox = connectionBoxForNode(source)
  const targetBox = connectionBoxForNode(target)
  const sourceCenter = { x: sourceBox.centerX, y: sourceBox.centerY }
  const targetCenter = { x: targetBox.centerX, y: targetBox.centerY }
  const sourceMountingBox = mountingBoxById.get(source.mountingBoxId)
  const targetMountingBox = mountingBoxById.get(target.mountingBoxId)
  const crossesMountingBoxes = source.mountingBoxId !== target.mountingBoxId
    && (sourceMountingBox || targetMountingBox)

  const sourceParentsTargetBox = sourceMountingBox
    && targetMountingBox?.layoutParentBoxId === sourceMountingBox.id
  const targetParentsSourceBox = targetMountingBox
    && sourceMountingBox?.layoutParentBoxId === targetMountingBox.id
  const sourceTargetsLowerGrid = sourceMountingBox
    && targetMountingBox?.layoutParentBoxId === sourceMountingBox.id
    && targetMountingBox.denseSiblingRowIndex > 0
  const targetTargetsLowerGrid = targetMountingBox
    && sourceMountingBox?.layoutParentBoxId === targetMountingBox.id
    && sourceMountingBox.denseSiblingRowIndex > 0
  if (sourceParentsTargetBox || targetParentsSourceBox
    || sourceTargetsLowerGrid || targetTargetsLowerGrid) {
    const sourceIsParent = sourceParentsTargetBox || sourceTargetsLowerGrid
    const parentNode = sourceIsParent ? source : target
    const childNode = sourceIsParent ? target : source
    const parentFrame = sourceIsParent ? sourceMountingBox : targetMountingBox
    const childFrame = sourceIsParent ? targetMountingBox : sourceMountingBox
    const parentVisual = connectionBoxForNode(parentNode)
    const childVisual = connectionBoxForNode(childNode)
    if (parentFrame.siblingJunctionGrid) {
      const blockers = parentFrame.nodes.filter(node => node.id !== parentNode.id
        && node.diagram.y > parentVisual.bottomY
        && node.diagram.y < childFrame.y)
      if (blockers.some(node => parentVisual.centerX > node.diagram.x
        && parentVisual.centerX < node.diagram.x + node.diagram.width)) {
        const lanes = [parentFrame.x + 12, parentFrame.x + parentFrame.width - 12]
          .filter(x => blockers.every(node =>
            x <= node.diagram.x - 12 || x >= node.diagram.x + node.diagram.width + 12))
          .sort((left, right) => Math.abs(left - parentVisual.centerX)
            - Math.abs(right - parentVisual.centerX))
        if (lanes.length) {
          const exitY = parentVisual.bottomY + 12
          const approachY = childFrame.y - 18
          const points = compactPoints([
            {x: parentVisual.centerX, y: parentVisual.bottomY},
            {x: parentVisual.centerX, y: exitY},
            {x: lanes[0], y: exitY},
            {x: lanes[0], y: approachY},
            {x: childVisual.centerX, y: approachY},
            {x: childVisual.centerX, y: childVisual.topY},
          ])
          return sourceIsParent ? points : points.reverse()
        }
      }
    }
    if (childFrame.siblingJunctionGrid && childNode.rowIndex > 0) {
      const firstRow = childFrame.nodes
        .filter(node => node.rowIndex === 0)
        .sort((left, right) => left.diagram.x - right.diagram.x)
      const lanes = firstRow.slice(1).map((node, index) =>
        (firstRow[index].diagram.x + firstRow[index].diagram.width + node.diagram.x) / 2)
      const laneX = lanes.sort((left, right) =>
        Math.abs(left - childVisual.centerX) - Math.abs(right - childVisual.centerX))[0]
      if (Number.isFinite(laneX)) {
        const exitY = parentFrame.y + parentFrame.height + 12
        const approachY = childVisual.topY - 18
        const points = compactPoints([
          {x: parentVisual.centerX, y: parentVisual.bottomY},
          {x: parentVisual.centerX, y: exitY},
          {x: laneX, y: exitY},
          {x: laneX, y: approachY},
          {x: childVisual.centerX, y: approachY},
          {x: childVisual.centerX, y: childVisual.topY},
        ])
        return sourceIsParent ? points : points.reverse()
      }
    }
    if (childFrame.denseSiblingRowIndex > 0) {
      // Reach a lower child row through the gap between first-row frames.
      const firstRow = [...mountingBoxById.values()]
        .filter(box => box.layoutParentBoxId === parentFrame.id
          && box.denseSiblingRowIndex === 0)
        .sort((left, right) => left.x - right.x)
      const gaps = firstRow.slice(1).map((box, index) => (
        (firstRow[index].x + firstRow[index].width + box.x) / 2
      ))
      if (gaps.length) {
        const laneX = gaps.sort((left, right) => (
          Math.abs(left - parentVisual.centerX) - Math.abs(right - parentVisual.centerX)
        ))[0]
        const exitY = parentFrame.y + parentFrame.height + 12
        const approachY = childFrame.y - 18
        const points = compactPoints([
          {x: parentVisual.centerX, y: parentVisual.bottomY},
          {x: parentVisual.centerX, y: exitY},
          {x: laneX, y: exitY},
          {x: laneX, y: approachY},
          {x: childVisual.centerX, y: approachY},
          {x: childVisual.centerX, y: childVisual.topY},
        ])
        return sourceIsParent ? points : points.reverse()
      }
    }
    // Exit at the side of the JB and use the gutter between installations.
    // A center drop would run through its local cameras and their labels.
    const track = childFrame.routingTrack ?? 0
    const laneX = parentFrame.x + parentFrame.width + 12 + track * 12
    const approachY = childFrame.y - 18 - track * 12
    const clearDrop = !(childFrame.denseSiblingRowIndex > 0)
      && !(parentFrame.nodes ?? []).some(node => {
        if (node.id === parentNode.id) return false
        const box = node.diagram
        return parentVisual.centerX > box.x - 12 && parentVisual.centerX < box.x + box.width + 12
          && box.y + box.height + 28 > parentVisual.bottomY && box.y < approachY
      })
    if (clearDrop) {
      const points = compactPoints([
        {x: parentVisual.centerX, y: parentVisual.bottomY},
        {x: parentVisual.centerX, y: approachY},
        {x: childVisual.centerX, y: approachY},
        {x: childVisual.centerX, y: childVisual.topY},
      ])
      return sourceIsParent ? points : points.reverse()
    }
    const parentPoint = {
      x: parentVisual.x + parentVisual.width,
      y: parentVisual.centerY,
    }
    const childPoint = {
      x: childVisual.centerX,
      y: childVisual.topY,
    }
    const points = [
      parentPoint,
      { x: laneX, y: parentPoint.y },
      { x: laneX, y: approachY },
      { x: childPoint.x, y: approachY },
      childPoint,
    ]
    return sourceIsParent ? points : points.reverse()
  }

  if (crossesMountingBoxes) {
    const sourcePoint = sourceMountingBox
      ? { x: sourceCenter.x, y: sourceBox.topY }
      : {
        x: sourceCenter.x,
        y: targetCenter.y >= sourceCenter.y ? sourceBox.bottomY : sourceBox.topY,
      }
    const targetPoint = targetMountingBox
      ? { x: targetCenter.x, y: targetBox.topY }
      : {
        x: targetCenter.x,
        y: targetCenter.y >= sourceCenter.y ? targetBox.topY : targetBox.bottomY,
      }
    const mountingBoxTops = [sourceMountingBox?.y, targetMountingBox?.y]
      .filter((value) => Number.isFinite(value))
    const railY = Math.min(...mountingBoxTops) - 18
    return compactPoints([
      sourcePoint,
      { x: sourcePoint.x, y: railY },
      { x: targetPoint.x, y: railY },
      targetPoint,
    ])
  }

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

function routeBackboneGap(source, target, layoutNodes, index = 0) {
  const targetBox = connectionBoxForNode(target)
  const targetPoint = { x: targetBox.centerX, y: targetBox.topY }
  // A missing rack path is a diagnostic, not a suggested or confirmed edge.
  // Keep it as a short local callout at the affected island root instead of
  // drawing a synthetic cable across unrelated components.
  const calloutY = Math.max(12, targetPoint.y - 22)
  return [
    { x: targetPoint.x, y: calloutY },
    targetPoint,
  ]
}

function connectionBoxForNode(node) {
  const diagram = node?.diagram
  if (!diagram) return null
  if (node.layoutStyle === 'facility-schematic' || node.diagram?.width >= 160) {
    const width = diagram.width || 168
    const height = diagram.height || 64
    const centerX = diagram.centerX
    const centerY = diagram.centerY
    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      centerX,
      centerY,
      topX: centerX,
      topY: centerY - height / 2,
      bottomX: centerX,
      bottomY: centerY + height / 2,
    }
  }
  const visualSize = node.diagramClass === 'rack-root'
    ? { width: 60, height: 52 }
    : ['junction-peer', 'junction-extended'].includes(node.diagramClass)
      ? { width: 44, height: 38 }
      : { width: 24, height: 24 }
  const centerX = diagram.centerX
  const centerY = diagram.centerY
  return {
    x: centerX - visualSize.width / 2,
    y: centerY - visualSize.height / 2,
    width: visualSize.width,
    height: visualSize.height,
    centerX,
    centerY,
    topX: centerX,
    topY: centerY - visualSize.height / 2,
    bottomX: centerX,
    bottomY: centerY + visualSize.height / 2,
  }
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
  ;(layout.backboneGaps ?? []).forEach((gap) => gap.routePoints.forEach((point) => extents.push({
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
