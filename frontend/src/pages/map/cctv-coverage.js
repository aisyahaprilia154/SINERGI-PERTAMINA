/**
 * Identifies source geometry used to depict a CCTV viewing direction.
 *
 * CCTV coverage is source metadata, not a separate network. Keeping the
 * check isolated lets the sidebar toggle hide only that visual layer while
 * the CCTV asset points and topology remain untouched.
 */
export function isCctvCoverageGeometry(geometry, assetById = new Map()) {
  const owner = assetById instanceof Map
    ? assetById.get(geometry?.assetId)
    : assetById?.[geometry?.assetId]
  const sourcePath = [
    geometry?.sourceFolderPath,
    geometry?.sourceFeaturePath,
    geometry?.sourceLayerPath,
    geometry?.layerPath,
  ].filter(Boolean).join(' ').toLowerCase()
  const metadata = [
    geometry?.category,
    owner?.name,
    owner?.type,
    owner?.category,
  ].filter(Boolean).join(' ').toLowerCase()
  const source = `${sourcePath} ${metadata}`
  const hasCctvMarker = source.includes('cctv')
    || source.includes('camera')
    || source.includes('kamera')
  const hasViewMarker = /(^|[\s\\/_-])view([\s\\/_-]|$)/.test(source)
    || source.includes('pandang')
    || source.includes('field of view')
  const hasCctvPath = sourcePath.includes('cctv')
    || sourcePath.includes('camera')
    || sourcePath.includes('kamera')
  const hasViewMetadata = /(^|[\s\\/_-])view([\s\\/_-]|$)/.test(metadata)
    || metadata.includes('pandang')
    || metadata.includes('field of view')
  return hasCctvMarker && hasViewMarker && (hasCctvPath || hasViewMetadata)
}

/**
 * CCTV direction sectors in KMZ are GroundOverlay images under a CCTV/View
 * folder. They are intentionally separate from Point/Line geometry so the
 * marker and the camera direction can be toggled independently.
 */
export function isCctvCoverageOverlay(overlay) {
  const source = [
    overlay?.sourceFolderPath,
    overlay?.sourceFeaturePath,
    overlay?.sourceLayerPath,
    overlay?.layerPath,
    overlay?.name,
    overlay?.description,
    overlay?.iconHref,
  ].filter(Boolean).join(' ').toLowerCase()
  const hasCctvMarker = source.includes('cctv')
    || source.includes('camera')
    || source.includes('kamera')
  const hasViewMarker = /(^|[\s\\/_-])view([\s\\/_-]|$)/.test(source)
    || source.includes('pandang')
    || source.includes('field of view')
    || source.includes('coverage')
  return hasCctvMarker && hasViewMarker
}

export function shouldRenderCctvCoverageOverlay(overlay, showCctvCoverage = true) {
  return showCctvCoverage || !isCctvCoverageOverlay(overlay)
}

export function shouldRenderMapGeometry(
  geometry,
  assetById,
  showCctvCoverage = true,
) {
  if (showCctvCoverage || geometry?.geometryType === 'point') return true
  return !isCctvCoverageGeometry(geometry, assetById)
}
