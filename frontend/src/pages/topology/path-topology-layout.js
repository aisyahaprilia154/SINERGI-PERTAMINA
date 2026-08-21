const PAGE_WIDTH = 1600
const PADDING_X = 48
const HEADER_HEIGHT = 164
const BLOCK_WIDTH = 218
const BLOCK_HEIGHT = 164
const COLLAPSED_BLOCK_HEIGHT = 70
const COLUMN_GAP = 28
const LANE_GAP = 54
const LANE_LABEL_WIDTH = 96
const SECTION_CARD_WIDTH = 176

export function createPathTopologyLayout(model, { collapsedPoleGroupIds = new Set() } = {}) {
  const maxColumns = Math.max(1, Math.min(6, ...model.lanes.map(({ blocks }) => blocks.length), 1))
  const contentWidth = maxColumns * BLOCK_WIDTH + (maxColumns - 1) * COLUMN_GAP
  const left = Math.max(PADDING_X + LANE_LABEL_WIDTH, (PAGE_WIDTH - contentWidth) / 2)
  const positions = new Map()
  let cursorY = HEADER_HEIGHT

  const core = model.core ? {
    ...model.core,
    x: PAGE_WIDTH / 2 - 122,
    y: 24,
    width: 244,
    height: 102,
  } : null
  if (core) positions.set(core.id, core)

  const lanes = model.lanes.map((lane) => {
    const blockHeight = Math.max(...lane.blocks.map(({ id, collapsed }) => (
      collapsed || collapsedPoleGroupIds.has(id) ? COLLAPSED_BLOCK_HEIGHT : BLOCK_HEIGHT
    )), COLLAPSED_BLOCK_HEIGHT)
    const busY = cursorY + 20
    const blocks = lane.blocks.map((block, index) => {
      const collapsed = block.collapsed || collapsedPoleGroupIds.has(block.id)
      const positioned = {
        ...block,
        collapsed,
        x: left + index * (BLOCK_WIDTH + COLUMN_GAP),
        y: cursorY + 34,
        width: BLOCK_WIDTH,
        height: collapsed ? COLLAPSED_BLOCK_HEIGHT : BLOCK_HEIGHT,
        anchorX: left + index * (BLOCK_WIDTH + COLUMN_GAP) + BLOCK_WIDTH / 2,
        anchorY: cursorY + 34,
      }
      positions.set(block.id, positioned)
      block.assetIds.forEach((id) => positions.set(id, positioned))
      return positioned
    })
    const result = { ...lane, y: cursorY, busY, height: blockHeight + 52, blocks }
    cursorY += result.height + LANE_GAP
    return result
  })

  const sectionTop = cursorY + 2
  const extended = layoutPoleSection(model.extendedAssets, {
    x: PADDING_X,
    y: sectionTop + 46,
    availableWidth: 770,
    positions,
    collapsedPoleGroupIds,
  })
  const connected = layoutAssetSection(model.ungroupedConnectedAssets, {
    x: 838,
    y: sectionTop + 46,
    availableWidth: 714,
    positions,
  })
  const firstSectionHeight = Math.max(extended.height, connected.height, 100)
  const unresolvedY = sectionTop + 66 + firstSectionHeight
  const uninstalled = layoutEndpointSection(model.uninstalledEndpoints, {
    x: PADDING_X,
    y: unresolvedY + 40,
    availableWidth: PAGE_WIDTH - PADDING_X * 2,
  })
  const footerY = unresolvedY + 64 + Math.max(uninstalled.height, 74)
  const height = Math.max(720, footerY + 88)

  const allEdges = [
    ...model.primaryEdges.map((edge) => ({ ...edge, kind: 'primary' })),
    ...model.crossEdges.map((edge) => ({ ...edge, kind: 'cross' })),
    ...model.recommendationEdges.map((edge) => ({ ...edge, kind: 'recommendation' })),
  ].flatMap((edge) => {
    const source = anchorFor(positions.get(edge.sourceId), 'source')
    const target = anchorFor(positions.get(edge.targetId), 'target')
    if (!source || !target) return []
    return [{
      ...edge,
      points: orthogonalRoute(source, target, edge.kind),
      traced: model.trace.edgeIds.includes(edge.id),
    }]
  })

  return {
    ...model,
    width: PAGE_WIDTH,
    height,
    core,
    lanes,
    extendedSection: {
      title: 'JB EXTENDED · PERALATAN AKSES',
      x: PADDING_X,
      y: sectionTop,
      width: 770,
      ...extended,
    },
    connectedSection: {
      title: 'PERANGKAT TERHUBUNG TANPA TIANG',
      x: 838,
      y: sectionTop,
      width: 714,
      ...connected,
    },
    uninstalledSection: {
      title: 'ENDPOINT YANG BELUM TERPASANG',
      x: PADDING_X,
      y: unresolvedY,
      width: PAGE_WIDTH - PADDING_X * 2,
      ...uninstalled,
    },
    edges: allEdges,
    footerY,
  }
}

function layoutPoleSection(blocks, { x, y, availableWidth, positions, collapsedPoleGroupIds }) {
  const columns = Math.max(1, Math.floor((availableWidth + 18) / (SECTION_CARD_WIDTH + 18)))
  const cardWidth = Math.min(SECTION_CARD_WIDTH, (availableWidth - (columns - 1) * 18) / columns)
  const positioned = blocks.map((block, index) => {
    const collapsed = block.collapsed || collapsedPoleGroupIds.has(block.id)
    const item = {
      ...block,
      collapsed,
      x: x + (index % columns) * (cardWidth + 18),
      y: y + Math.floor(index / columns) * 148,
      width: cardWidth,
      height: collapsed ? COLLAPSED_BLOCK_HEIGHT : 128,
    }
    positions.set(block.id, item)
    block.assetIds.forEach((id) => positions.set(id, item))
    return item
  })
  return {
    blocks: positioned,
    height: positioned.length ? Math.ceil(positioned.length / columns) * 148 : 0,
  }
}

function layoutAssetSection(assets, { x, y, availableWidth, positions }) {
  const columns = Math.max(1, Math.floor((availableWidth + 14) / (SECTION_CARD_WIDTH + 14)))
  const cardWidth = Math.min(SECTION_CARD_WIDTH, (availableWidth - (columns - 1) * 14) / columns)
  const positioned = assets.map((asset, index) => {
    const item = {
      ...asset,
      x: x + (index % columns) * (cardWidth + 14),
      y: y + Math.floor(index / columns) * 76,
      width: cardWidth,
      height: 58,
    }
    positions.set(asset.id, item)
    return item
  })
  return {
    assets: positioned,
    height: positioned.length ? Math.ceil(positioned.length / columns) * 76 : 0,
  }
}

function layoutEndpointSection(endpoints, { x, y, availableWidth }) {
  const columns = Math.max(1, Math.min(6, Math.floor((availableWidth + 20) / 220)))
  const width = (availableWidth - (columns - 1) * 20) / columns
  const positioned = endpoints.map((endpoint, index) => ({
    ...endpoint,
    x: x + (index % columns) * (width + 20),
    y: y + Math.floor(index / columns) * 96,
    width,
    height: 76,
  }))
  return {
    endpoints: positioned,
    height: positioned.length ? Math.ceil(positioned.length / columns) * 96 : 0,
  }
}

function anchorFor(item, direction) {
  if (!item) return null
  if (item.anchorX !== undefined) return { x: item.anchorX, y: item.anchorY }
  return {
    x: item.x + item.width / 2,
    y: direction === 'source' ? item.y + item.height : item.y,
  }
}

function orthogonalRoute(source, target, kind) {
  if (Math.abs(source.y - target.y) < 4) {
    const offset = kind === 'cross' ? -18 : 18
    return [source, { x: source.x, y: source.y + offset }, {
      x: target.x, y: source.y + offset,
    }, target]
  }
  const midY = source.y + (target.y - source.y) / 2
  return [source, { x: source.x, y: midY }, { x: target.x, y: midY }, target]
}

export const PATH_LAYOUT_CONSTANTS = Object.freeze({
  maxBlocksPerLane: 6,
  blockWidth: BLOCK_WIDTH,
  blockHeight: BLOCK_HEIGHT,
})
