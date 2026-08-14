export const MIN_SCHEMATIC_ZOOM = .25
export const ALL_ASSET_FIT_MIN_ZOOM = .6

export function calculateSchematicFitScale({
  viewBoxWidth,
  viewBoxHeight,
  viewportWidth,
  viewportHeight,
  padding = 32,
  minZoom = MIN_SCHEMATIC_ZOOM,
  maxZoom = 1,
  preferWidth = false,
}) {
  const width = Number(viewBoxWidth)
  const height = Number(viewBoxHeight)
  const availableWidth = Math.max(Number(viewportWidth) - padding, 1)
  const availableHeight = Math.max(Number(viewportHeight) - padding, 1)
  if (!(width > 0) || !(height > 0)) return minZoom

  const widthScale = availableWidth / width
  const heightScale = availableHeight / height
  const fitScale = preferWidth ? widthScale : Math.min(widthScale, heightScale)
  return Math.max(minZoom, Math.min(maxZoom, fitScale))
}
