const DEFAULT_PADDING = 24

export function calculateDiagramBounds({
  nodes = [],
  edges = [],
  sections = [],
  headerHeight = 0,
  footerHeight = 0,
  padding = DEFAULT_PADDING,
} = {}) {
  const points = []
  nodes.forEach(({ diagram }) => {
    if (!diagram) return
    points.push(
      { x: diagram.x, y: diagram.y },
      { x: diagram.x + diagram.width, y: diagram.y + diagram.height },
    )
  })
  edges.forEach(({ routePoints = [] }) => points.push(...routePoints))
  sections.forEach((section) => {
    if (!section.bounds) return
    points.push(
      { x: section.bounds.x, y: section.bounds.y },
      {
        x: section.bounds.x + section.bounds.width,
        y: section.bounds.y + section.bounds.height,
      },
    )
  })

  if (!points.length) {
    return {
      minX: 0,
      minY: 0,
      maxX: padding * 2,
      maxY: headerHeight + footerHeight + padding * 2,
      width: padding * 2,
      height: headerHeight + footerHeight + padding * 2,
    }
  }

  const minX = Math.min(...points.map(({ x }) => x)) - padding
  const maxX = Math.max(...points.map(({ x }) => x)) + padding
  const minY = Math.min(...points.map(({ y }) => y), headerHeight) - padding
  const maxY = Math.max(...points.map(({ y }) => y)) + padding + footerHeight
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function calculateFitScale({
  bounds,
  viewportWidth,
  viewportHeight,
  padding = 24,
  minScale = .35,
  maxScale = 2.5,
}) {
  if (!bounds?.width || !bounds?.height
    || !viewportWidth || !viewportHeight) return 1
  const availableWidth = Math.max(1, viewportWidth - padding * 2)
  const availableHeight = Math.max(1, viewportHeight - padding * 2)
  return clamp(
    Math.min(
      availableWidth / bounds.width,
      availableHeight / bounds.height,
    ),
    minScale,
    maxScale,
  )
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}
