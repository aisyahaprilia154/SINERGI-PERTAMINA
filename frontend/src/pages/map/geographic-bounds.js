export function geometryIntersectsGeographicBounds(coordinates, bounds) {
  if (!validGeographicBounds(bounds)) return false
  const paths = collectCoordinatePaths(coordinates)
  return paths.some((path) => (
    path.some((coordinate) => coordinateWithinBounds(coordinate, bounds))
    || path.slice(1).some((coordinate, index) => segmentIntersectsBounds(
      path[index],
      coordinate,
      bounds,
    ))
  ))
}

function validGeographicBounds(bounds) {
  return bounds
    && [bounds.west, bounds.east, bounds.south, bounds.north].every(Number.isFinite)
    && bounds.west <= bounds.east
    && bounds.south <= bounds.north
}

function collectCoordinatePaths(value) {
  if (!Array.isArray(value)) return []
  if (value.length >= 2 && value.every(isCoordinateTuple)) return [value]
  if (isCoordinateTuple(value)) return [[value]]
  return value.flatMap(collectCoordinatePaths)
}

function isCoordinateTuple(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
}

function coordinateWithinBounds([longitude, latitude], bounds) {
  return longitude >= bounds.west && longitude <= bounds.east
    && latitude >= bounds.south && latitude <= bounds.north
}

function segmentIntersectsBounds(start, end, bounds) {
  let leftCode = outCode(start, bounds)
  let rightCode = outCode(end, bounds)
  let left = [...start]
  let right = [...end]

  while (true) {
    if (!(leftCode | rightCode)) return true
    if (leftCode & rightCode) return false
    const code = leftCode || rightCode
    let longitude
    let latitude
    if (code & 8) {
      longitude = left[0] + (right[0] - left[0])
        * (bounds.north - left[1]) / (right[1] - left[1])
      latitude = bounds.north
    } else if (code & 4) {
      longitude = left[0] + (right[0] - left[0])
        * (bounds.south - left[1]) / (right[1] - left[1])
      latitude = bounds.south
    } else if (code & 2) {
      latitude = left[1] + (right[1] - left[1])
        * (bounds.east - left[0]) / (right[0] - left[0])
      longitude = bounds.east
    } else {
      latitude = left[1] + (right[1] - left[1])
        * (bounds.west - left[0]) / (right[0] - left[0])
      longitude = bounds.west
    }
    if (code === leftCode) {
      left = [longitude, latitude]
      leftCode = outCode(left, bounds)
    } else {
      right = [longitude, latitude]
      rightCode = outCode(right, bounds)
    }
  }
}

function outCode([longitude, latitude], bounds) {
  let code = 0
  if (longitude < bounds.west) code |= 1
  else if (longitude > bounds.east) code |= 2
  if (latitude < bounds.south) code |= 4
  else if (latitude > bounds.north) code |= 8
  return code
}
