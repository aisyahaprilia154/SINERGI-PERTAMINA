export function groundOverlayCoordinates(overlay) {
  if (overlay?.latLonBox) {
    const { west, south, east, north } = overlay.latLonBox
    if (![west, south, east, north].every(Number.isFinite)) return null
    const rotation = Number(overlay.rotation ?? overlay.latLonBox.rotation ?? 0)
    return rotateGeographicCorners([
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ], rotation)
  }
  const coordinates = overlay?.latLonQuad?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length !== 4
    || !coordinates.every(validPosition)) return null
  // KML gx:LatLonQuad is lower-left first; MapLibre ImageSource is upper-left first.
  return [coordinates[3], coordinates[2], coordinates[1], coordinates[0]]
}

export function shouldRenderGroundOverlayFootprint(overlay) {
  return !String(overlay?.resourceUrl ?? '').trim()
}

function rotateGeographicCorners(corners, degrees) {
  if (!Number.isFinite(degrees) || Math.abs(degrees) < 0.0001) return corners
  const centerLongitude = corners.reduce((sum, [longitude]) => sum + longitude, 0) / corners.length
  const centerLatitude = corners.reduce((sum, [, latitude]) => sum + latitude, 0) / corners.length
  const longitudeScale = Math.cos(centerLatitude * Math.PI / 180)
  const radians = degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return corners.map(([longitude, latitude]) => {
    const x = (longitude - centerLongitude) * longitudeScale
    const y = latitude - centerLatitude
    return [
      centerLongitude + (x * cosine - y * sine) / longitudeScale,
      centerLatitude + x * sine + y * cosine,
    ]
  })
}

function validPosition(position) {
  return Array.isArray(position)
    && position.length >= 2
    && Number.isFinite(Number(position[0]))
    && Number.isFinite(Number(position[1]))
}
