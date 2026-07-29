const ZOOM_LIMITS = Object.freeze({
  min: .65,
  lowMax: .94,
  highMin: 1.65,
  max: 3.2,
})

export function clampMapZoom(value) {
  return Math.max(ZOOM_LIMITS.min, Math.min(ZOOM_LIMITS.max, value))
}

export function getMapZoomTier(zoom) {
  if (zoom <= ZOOM_LIMITS.lowMax) return 'low'
  if (zoom < ZOOM_LIMITS.highMin) return 'medium'
  return 'high'
}

export function markerRadiusForTier(tier, important = false) {
  if (tier === 'low') return important ? 9 : 7
  if (tier === 'high') return important ? 12 : 10
  return important ? 11 : 9
}

export function markerRadiusForZoom(zoom, important = false) {
  const value = clampMapZoom(zoom)
  let regularRadius
  if (value <= 1) regularRadius = 7 + ((value - ZOOM_LIMITS.min) / .35) * 2
  else if (value < ZOOM_LIMITS.highMin) regularRadius = 9 + (value - 1) / .65
  else regularRadius = 10 + (value - ZOOM_LIMITS.highMin) / 1.55
  return regularRadius + (important ? 2 : 0)
}

export function layoutViewportNodes(nodes, {
  tier,
  selectedAssetId = null,
  hoveredAssetId = null,
  keyboardFocusAssetId = null,
} = {}) {
  const prioritized = nodes
    .map((node) => ({
      ...node,
      originalX: node.x,
      originalY: node.y,
      priority: nodePriority(node, {
        selectedAssetId,
        hoveredAssetId,
        keyboardFocusAssetId,
      }),
      collisionPriority: nodeCollisionPriority(node, {
        selectedAssetId,
        hoveredAssetId,
        keyboardFocusAssetId,
      }),
    }))
    .sort(compareNodes)

  if (tier !== 'high') {
    return clusterViewportNodes(
      prioritized,
      tier === 'low' ? 34 : 23,
      tier === 'low' ? 80 : 50,
    )
  }

  return displaceCloseNodes(spiderfyIdenticalNodes(prioritized), {
    minimumDistance: 25,
    maximumDisplacement: 42,
  })
}

export function createFrameScheduler(requestFrame, cancelFrame, callback) {
  let frameId = null
  return {
    schedule() {
      if (frameId !== null) return
      frameId = requestFrame(() => {
        frameId = null
        callback()
      })
    },
    cancel() {
      if (frameId === null) return
      cancelFrame(frameId)
      frameId = null
    },
    get pending() {
      return frameId !== null
    },
  }
}

export function createViewportSubscriptionStore(initialCallback = null) {
  const subscribers = new Set()
  if (typeof initialCallback === 'function') subscribers.add(initialCallback)
  return {
    subscribe(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('Viewport subscriber harus berupa function.')
      }
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    notify(bounds, detail) {
      subscribers.forEach((callback) => callback(bounds, detail))
    },
    clear() {
      subscribers.clear()
    },
    get size() {
      return subscribers.size
    },
  }
}

export function screenViewportToGeographicBounds({
  width,
  height,
  zoom,
  pan,
  dataBounds,
  projectionPadding = .08,
}) {
  if (![width, height, zoom].every(Number.isFinite)
    || width <= 0 || height <= 0 || zoom <= 0
    || !validGeographicBounds(dataBounds)) return null
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([screenX, screenY]) => {
    const displayX = ((screenX - width / 2 - (pan?.x || 0)) / zoom + width / 2) / width
    const displayY = ((screenY - height / 2 - (pan?.y || 0)) / zoom + height / 2) / height
    const usableRange = 1 - projectionPadding * 2
    const longitudeRatio = (displayX - projectionPadding) / usableRange
    const latitudeRatio = (displayY - projectionPadding) / usableRange
    return [
      dataBounds.west + longitudeRatio * (dataBounds.east - dataBounds.west),
      dataBounds.north - latitudeRatio * (dataBounds.north - dataBounds.south),
    ]
  })
  const minLng = Math.min(...corners.map(([longitude]) => longitude))
  const maxLng = Math.max(...corners.map(([longitude]) => longitude))
  const minLat = Math.min(...corners.map(([, latitude]) => latitude))
  const maxLat = Math.max(...corners.map(([, latitude]) => latitude))
  return {
    minLng,
    minLat,
    maxLng,
    maxLat,
    west: minLng,
    east: maxLng,
    south: minLat,
    north: maxLat,
    corners,
  }
}

export function calculateCanvasBackingStoreSize({
  cssWidth,
  cssHeight,
  devicePixelRatio = 1,
}) {
  const ratio = Math.max(1, Number(devicePixelRatio) || 1)
  return {
    cssWidth: Math.max(0, Number(cssWidth) || 0),
    cssHeight: Math.max(0, Number(cssHeight) || 0),
    pixelWidth: Math.max(0, Math.round((Number(cssWidth) || 0) * ratio)),
    pixelHeight: Math.max(0, Math.round((Number(cssHeight) || 0) * ratio)),
    ratio,
  }
}

export function pointerToCanvasCssPoint({
  clientX,
  clientY,
  rect,
  cssWidth,
  cssHeight,
}) {
  const scaleX = rect?.width ? cssWidth / rect.width : 1
  const scaleY = rect?.height ? cssHeight / rect.height : 1
  return {
    x: (clientX - (rect?.left || 0)) * scaleX,
    y: (clientY - (rect?.top || 0)) * scaleY,
  }
}

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

function clusterViewportNodes(nodes, radius, forcedThreshold) {
  const forced = []
  const candidates = []
  nodes.forEach((node) => {
    if (node.collisionPriority >= forcedThreshold || node.core) {
      forced.push(toAssetMarker(node))
    }
    else candidates.push(node)
  })

  const groups = groupNearbyNodes(candidates, radius)
  const markers = groups.map((group, index) => {
    if (group.length === 1) return toAssetMarker(group[0])
    const x = average(group.map((node) => node.x))
    const y = average(group.map((node) => node.y))
    return {
      kind: 'cluster',
      id: `cluster:${index}:${group.map(({ asset }) => asset.id).sort().join('|')}`,
      x,
      y,
      originalX: x,
      originalY: y,
      assets: group.map(({ asset }) => asset),
      count: group.length,
      hitRadius: 20,
      primaryNetwork: group[0].primaryNetwork,
      priority: Math.max(...group.map(({ priority }) => priority)),
    }
  })

  return [...markers, ...forced].sort(compareMarkers)
}

function spiderfyIdenticalNodes(nodes) {
  const groups = new Map()
  nodes.forEach((node) => {
    const key = coordinateKey(node)
    groups.set(key, [...(groups.get(key) || []), node])
  })

  return [...groups.values()].flatMap((group) => {
    if (group.length === 1) return [toAssetMarker(group[0])]
    const radius = Math.min(54, Math.max(24, 8 + group.length * 4))
    const angleOffset = -Math.PI / 2
    return group.map((node, index) => {
      const angle = angleOffset + (Math.PI * 2 * index) / group.length
      return {
        ...toAssetMarker(node),
        x: node.x + Math.cos(angle) * radius,
        y: node.y + Math.sin(angle) * radius,
        displaced: true,
        spiderfied: true,
        collisionCount: group.length,
      }
    })
  }).sort(compareMarkers)
}

function displaceCloseNodes(markers, {
  minimumDistance,
  maximumDisplacement,
}) {
  const placed = []
  const collisionIndex = createCollisionIndex(minimumDistance)
  const placementOrder = [...markers].sort((first, second) => (
    second.collisionPriority - first.collisionPriority
  ))
  placementOrder.forEach((marker) => {
    const candidate = { ...marker }
    if (candidate.collisionPriority < 100 && collisionIndex.collides(candidate)) {
      const resolved = findFreePosition(
        candidate,
        collisionIndex,
        maximumDisplacement,
      )
      candidate.x = resolved.x
      candidate.y = resolved.y
      candidate.displaced = candidate.displaced
        || Math.hypot(candidate.x - candidate.originalX, candidate.y - candidate.originalY) > 2
    }
    placed.push(candidate)
    collisionIndex.add(candidate)
  })
  return placed.sort(compareMarkers)
}

function findFreePosition(marker, collisionIndex, maximumDisplacement) {
  const angleStep = Math.PI / 6
  for (let radius = 8; radius <= maximumDisplacement; radius += 7) {
    for (let angle = 0; angle < Math.PI * 2; angle += angleStep) {
      const candidate = {
        x: marker.x + Math.cos(angle) * radius,
        y: marker.y + Math.sin(angle) * radius,
      }
      if (!collisionIndex.collides(candidate)) return candidate
    }
  }
  return { x: marker.x, y: marker.y }
}

function groupNearbyNodes(nodes, radius) {
  if (!nodes.length) return []
  const cellSize = radius
  const buckets = new Map()
  const groups = []

  nodes.forEach((node) => {
    const cellX = Math.floor(node.x / cellSize)
    const cellY = Math.floor(node.y / cellSize)
    let matchedGroup = null
    for (let x = cellX - 1; x <= cellX + 1; x += 1) {
      for (let y = cellY - 1; y <= cellY + 1; y += 1) {
        const nearbyGroups = buckets.get(`${x}:${y}`) || []
        matchedGroup ||= nearbyGroups.find((group) => (
          Math.hypot(node.x - group.anchor.x, node.y - group.anchor.y) <= radius
        ))
      }
    }
    if (matchedGroup) {
      matchedGroup.nodes.push(node)
      return
    }
    const group = { anchor: node, nodes: [node] }
    groups.push(group)
    const key = `${cellX}:${cellY}`
    buckets.set(key, [...(buckets.get(key) || []), group])
  })
  return groups.map(({ nodes: groupNodes }) => groupNodes)
}

function nodePriority(node, {
  selectedAssetId,
  hoveredAssetId,
  keyboardFocusAssetId,
}) {
  if (node.asset.id === selectedAssetId) return 100
  if (node.traceEndpoint) return 95
  if (node.core) return 90
  if (node.asset.id === hoveredAssetId || node.asset.id === keyboardFocusAssetId) return 80
  if (node.degree >= 3) return 70
  if (node.important) return 60
  if (node.connected) return 55
  return 10
}

function nodeCollisionPriority(node, {
  selectedAssetId,
  hoveredAssetId,
  keyboardFocusAssetId,
}) {
  if (node.asset.id === selectedAssetId || node.asset.id === keyboardFocusAssetId) return 100
  if (node.traceEndpoint) return 95
  if (node.core) return 90
  if (node.asset.id === hoveredAssetId) return 80
  if (node.degree >= 3) return 70
  if (node.important) return 60
  if (node.connected) return 55
  return 10
}

function coordinateKey(node) {
  const coordinate = node.asset.coordinate
  if (Array.isArray(coordinate) && coordinate.length >= 2) {
    return `${coordinate[0]}:${coordinate[1]}`
  }
  return `${node.originalX.toFixed(10)}:${node.originalY.toFixed(10)}`
}

function toAssetMarker(node) {
  return {
    ...node,
    kind: 'asset',
    displaced: false,
    spiderfied: false,
    collisionCount: 1,
  }
}

function compareNodes(first, second) {
  return second.collisionPriority - first.collisionPriority
    || first.asset.id.localeCompare(second.asset.id)
}

function compareMarkers(first, second) {
  return first.priority - second.priority
    || String(first.id || first.asset?.id).localeCompare(String(second.id || second.asset?.id))
}

function createCollisionIndex(minimumDistance) {
  const buckets = new Map()
  const cellFor = (point) => ({
    x: Math.floor(point.x / minimumDistance),
    y: Math.floor(point.y / minimumDistance),
  })
  return {
    add(point) {
      const cell = cellFor(point)
      const key = `${cell.x}:${cell.y}`
      buckets.set(key, [...(buckets.get(key) || []), point])
    },
    collides(point) {
      const cell = cellFor(point)
      for (let x = cell.x - 1; x <= cell.x + 1; x += 1) {
        for (let y = cell.y - 1; y <= cell.y + 1; y += 1) {
          const nearby = buckets.get(`${x}:${y}`) || []
          if (nearby.some((other) => (
            Math.hypot(point.x - other.x, point.y - other.y) < minimumDistance
          ))) return true
        }
      }
      return false
    },
  }
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
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

export const mapViewportLayoutInternals = {
  ZOOM_LIMITS,
  groupNearbyNodes,
}
