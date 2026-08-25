export const TOPOLOGY_SEMANTIC_ZOOM = Object.freeze({
  overviewMax: 0.65,
  detailMax: 0.95,
  focusMin: 0.95,
})

export function semanticZoomLevelForZoom(zoom = 1) {
  const value = Number(zoom)
  if (!Number.isFinite(value) || value < TOPOLOGY_SEMANTIC_ZOOM.overviewMax) {
    return 'overview'
  }
  if (value < TOPOLOGY_SEMANTIC_ZOOM.focusMin) return 'detail'
  return 'focus'
}

export function effectiveViewportFor({
  viewportWidth = 0,
  viewportHeight = 0,
  paddingLeft = 0,
  paddingRight = 0,
  paddingTop = 0,
  paddingBottom = 0,
  overlayLeft = 0,
  overlayRight = 0,
  overlayTop = 0,
  overlayBottom = 0,
} = {}) {
  const width = Math.max(1, Number(viewportWidth) || 0)
  const height = Math.max(1, Number(viewportHeight) || 0)
  const left = Math.max(Number(paddingLeft) || 0, Number(overlayLeft) || 0)
  const right = Math.min(
    width - (Number(paddingRight) || 0),
    width - (Number(overlayRight) || 0),
  )
  const top = Math.max(Number(paddingTop) || 0, Number(overlayTop) || 0)
  const bottom = Math.min(
    height - (Number(paddingBottom) || 0),
    height - (Number(overlayBottom) || 0),
  )
  return {
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    centerX: (left + right) / 2 - (Number(paddingLeft) || 0),
    centerY: (top + bottom) / 2 - (Number(paddingTop) || 0),
    left,
    right,
    top,
    bottom,
  }
}

export function computeFitZoom({
  viewportWidth = 0,
  viewportHeight = 0,
  layoutWidth = 0,
  layoutHeight = 0,
  minZoom = 0.35,
  maxZoom = 1,
  horizontalPadding = 72,
  verticalPadding = 0,
} = {}) {
  const availableWidth = Math.max(1, Number(viewportWidth) - horizontalPadding)
  const availableHeight = Math.max(1, Number(viewportHeight) - verticalPadding)
  const contentWidth = Math.max(1, Number(layoutWidth))
  const contentHeight = Number(layoutHeight)
  const widthRatio = availableWidth / contentWidth
  const heightRatio = Number.isFinite(contentHeight) && contentHeight > 0 && Number(viewportHeight) > 0
    ? availableHeight / contentHeight
    : Number.POSITIVE_INFINITY
  return clamp(Math.min(widthRatio, heightRatio), minZoom, maxZoom)
}

export function computeReadableZoom({
  viewportWidth = 0,
  viewportHeight = 0,
  layoutWidth = 0,
  layoutHeight = 0,
  minZoom = 0.6,
  maxZoom = 1,
  horizontalPadding = 72,
  verticalPadding = 0,
} = {}) {
  return computeFitZoom({
    viewportWidth,
    viewportHeight,
    layoutWidth,
    layoutHeight,
    minZoom,
    maxZoom,
    horizontalPadding,
    verticalPadding,
  })
}

export function centeredScrollPosition({
  point = {},
  zoom = 1,
  viewportWidth = 0,
  viewportHeight = 0,
  viewportCenterX = null,
  viewportCenterY = null,
} = {}) {
  const centerX = viewportCenterX !== null && viewportCenterX !== undefined
    && Number.isFinite(Number(viewportCenterX))
    ? Number(viewportCenterX)
    : Number(viewportWidth) / 2
  const centerY = viewportCenterY !== null && viewportCenterY !== undefined
    && Number.isFinite(Number(viewportCenterY))
    ? Number(viewportCenterY)
    : Number(viewportHeight) / 2
  return {
    left: Math.max(0, Number(point.x ?? 0) * Number(zoom) - centerX),
    top: Math.max(0, Number(point.y ?? 0) * Number(zoom) - centerY),
  }
}

export function zoomSurfaceMetrics({
  layoutWidth = 0,
  layoutHeight = 0,
  zoom = 1,
  viewportWidth = 0,
  viewportHeight = 0,
  horizontalPadding = 30,
  topPadding = 84,
  bottomPadding = 30,
} = {}) {
  const scale = Math.max(Number(zoom) || 1, 0.01)
  const scaledWidth = Math.max(1, Number(layoutWidth) || 0) * scale
  const scaledHeight = Math.max(1, Number(layoutHeight) || 0) * scale
  const side = Math.max(0, Number(horizontalPadding) || 0)
  const top = Math.max(0, Number(topPadding) || 0)
  const bottom = Math.max(0, Number(bottomPadding) || 0)
  const width = Math.max(Number(viewportWidth) || 0, scaledWidth + side * 2)

  return {
    width: Math.ceil(width),
    height: Math.ceil(Math.max(Number(viewportHeight) || 0, scaledHeight + top + bottom)),
    frameLeft: Math.max(side, (width - scaledWidth) / 2),
    frameTop: top,
  }
}

export function anchoredZoomScrollPosition({
  scrollLeft = 0,
  scrollTop = 0,
  anchorX = 0,
  anchorY = 0,
  oldZoom = 1,
  newZoom = 1,
  oldFrameLeft = 0,
  oldFrameTop = 0,
  newFrameLeft = 0,
  newFrameTop = 0,
} = {}) {
  const previousScale = Math.max(Number(oldZoom) || 1, 0.01)
  const nextScale = Math.max(Number(newZoom) || 1, 0.01)
  const sourceX = (Number(scrollLeft) + Number(anchorX) - Number(oldFrameLeft)) / previousScale
  const sourceY = (Number(scrollTop) + Number(anchorY) - Number(oldFrameTop)) / previousScale

  return {
    left: Math.max(0, Number(newFrameLeft) + sourceX * nextScale - Number(anchorX)),
    top: Math.max(0, Number(newFrameTop) + sourceY * nextScale - Number(anchorY)),
  }
}

function clamp(value, min, max) {
  return Math.max(Number(min), Math.min(Number(max), Number(value)))
}
