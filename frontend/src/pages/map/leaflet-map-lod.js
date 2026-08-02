const MEDIUM_NODE_TYPES = new Set([
  'Junction box',
  'Core switch',
  'Distribution switch',
  'Access switch',
  'Switch',
  'OTB',
  'NVR',
  'Server',
])

export function isAssetVisibleAtZoom(asset, zoomTier, {
  selectedAssetId = null,
  traceNodeIds = [],
} = {}) {
  if (!asset) return false
  if (asset.id === selectedAssetId || traceNodeIds.includes(asset.id)) return true
  if (zoomTier === 'high') return true
  if (zoomTier === 'medium') {
    return isLeafletCoreNode(asset) || MEDIUM_NODE_TYPES.has(asset.type || asset.assetType)
  }
  return isLeafletCoreNode(asset) || Number(asset.relationCount) >= 5
}

export function isGeometryVisibleAtZoom(geometry, zoomTier) {
  if (!geometry) return false
  return !(geometry.geometryType === 'polygon' && zoomTier === 'low')
}

export function isLeafletCoreNode(asset) {
  const type = String(asset?.type || asset?.assetType || '').toLowerCase()
  return type === 'core switch' || type === 'router'
}

export function markerVisualPriority(asset, {
  selectedAssetId = null,
  traceNodeIds = [],
  hoveredAssetId = null,
} = {}) {
  if (asset.id === selectedAssetId) return 600
  const traceIndex = traceNodeIds.indexOf(asset.id)
  if (traceIndex >= 0
    && (traceIndex === 0 || traceIndex === traceNodeIds.length - 1)) return 500
  if (isLeafletCoreNode(asset)) return 400
  if (asset.id === hoveredAssetId) return 300
  if (isImportantJunction(asset)) return 200
  return 100
}

/**
 * Calculates render-only screen offsets. Geographic coordinates and Leaflet
 * marker LatLng values are never changed.
 */
export function calculateLeafletMarkerLayout(records, {
  selectedAssetId = null,
  traceNodeIds = [],
  hoveredAssetId = null,
  minimumDistance = 30,
} = {}) {
  const sourceSnapshot = records.map(({ asset, point }) => ({
    asset,
    point: { x: Number(point.x), y: Number(point.y) },
    priority: markerVisualPriority(asset, {
      selectedAssetId,
      traceNodeIds,
      hoveredAssetId,
    }),
  }))
  const ordered = [...sourceSnapshot].sort((left, right) => (
    right.priority - left.priority || left.asset.id.localeCompare(right.asset.id, 'id')
  ))
  const initialOffsets = exactCoordinateFanOut(ordered, minimumDistance)
  const placed = []
  const layout = new Map()

  ordered.forEach((record) => {
    const initial = initialOffsets.get(record.asset.id) ?? { x: 0, y: 0 }
    const desired = {
      x: record.point.x + initial.x,
      y: record.point.y + initial.y,
    }
    const position = findNonCollidingPosition(
      desired,
      placed,
      minimumDistance,
      stableAngleOffset(record.asset.id),
    )
    const offsetX = position.x - record.point.x
    const offsetY = position.y - record.point.y
    const distance = Math.hypot(offsetX, offsetY)
    layout.set(record.asset.id, {
      offsetX,
      offsetY,
      leaderLength: distance,
      leaderAngle: distance > 3
        ? Math.atan2(-offsetY, -offsetX) * (180 / Math.PI)
        : 0,
      displaced: distance > 3,
    })
    placed.push(position)
  })

  return layout
}

export function calculateLeafletLabelVisibility(records, layout, {
  selectedAssetId = null,
  traceNodeIds = [],
  hoveredAssetId = null,
  zoomTier = 'medium',
} = {}) {
  const candidates = records
    .filter(({ asset }) => shouldShowPersistentLabel(asset, zoomTier, {
      selectedAssetId,
      traceNodeIds,
      hoveredAssetId,
    }))
    .map((record) => ({
      ...record,
      priority: markerVisualPriority(record.asset, {
        selectedAssetId,
        traceNodeIds,
        hoveredAssetId,
      }),
    }))
    .sort((left, right) => (
      right.priority - left.priority || left.asset.id.localeCompare(right.asset.id, 'id')
    ))
  const acceptedRects = []
  const visibleIds = new Set()

  candidates.forEach(({ asset, point }) => {
    const offset = layout.get(asset.id) ?? { offsetX: 0, offsetY: 0 }
    const label = asset.shortLabel || asset.assetId || asset.displayName || asset.name || ''
    const width = Math.min(160, Math.max(52, String(label).length * 7 + 16))
    const height = 24
    const centerX = point.x + offset.offsetX
    const top = point.y + offset.offsetY + 20
    const rect = {
      left: centerX - width / 2,
      right: centerX + width / 2,
      top,
      bottom: top + height,
    }
    if (acceptedRects.some((accepted) => rectanglesOverlap(rect, accepted))) return
    acceptedRects.push(rect)
    visibleIds.add(asset.id)
  })
  return visibleIds
}

function exactCoordinateFanOut(records, minimumDistance) {
  const groups = new Map()
  records.forEach((record) => {
    const coordinate = record.asset.coordinate
    const key = Array.isArray(coordinate)
      ? `${Number(coordinate[0])}|${Number(coordinate[1])}`
      : `${record.point.x}|${record.point.y}`
    groups.set(key, [...(groups.get(key) ?? []), record])
  })

  const offsets = new Map()
  groups.forEach((group) => {
    const sorted = [...group].sort((left, right) => (
      right.priority - left.priority || left.asset.id.localeCompare(right.asset.id, 'id')
    ))
    offsets.set(sorted[0].asset.id, { x: 0, y: 0 })
    if (sorted.length === 1) return
    const radialCount = sorted.length - 1
    const radius = Math.min(58, Math.max(minimumDistance, 20 + radialCount * 4))
    sorted.slice(1).forEach((record, index) => {
      const angle = (-Math.PI / 2) + (index * Math.PI * 2 / radialCount)
      offsets.set(record.asset.id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      })
    })
  })
  return offsets
}

function findNonCollidingPosition(desired, placed, minimumDistance, angleOffset) {
  if (!collides(desired, placed, minimumDistance)) return desired
  const rings = [minimumDistance, minimumDistance * 1.45, minimumDistance * 1.9]
  for (const radius of rings) {
    for (let step = 0; step < 12; step += 1) {
      const angle = angleOffset + (step * Math.PI * 2 / 12)
      const candidate = {
        x: desired.x + Math.cos(angle) * radius,
        y: desired.y + Math.sin(angle) * radius,
      }
      if (!collides(candidate, placed, minimumDistance)) return candidate
    }
  }
  const fallbackAngle = angleOffset + placed.length * 0.85
  const fallbackRadius = minimumDistance * (2 + Math.floor(placed.length / 8))
  return {
    x: desired.x + Math.cos(fallbackAngle) * fallbackRadius,
    y: desired.y + Math.sin(fallbackAngle) * fallbackRadius,
  }
}

function shouldShowPersistentLabel(asset, zoomTier, context) {
  if (asset.id === context.selectedAssetId) return true
  if (context.traceNodeIds.includes(asset.id)) {
    const index = context.traceNodeIds.indexOf(asset.id)
    return index === 0 || index === context.traceNodeIds.length - 1
  }
  if (isLeafletCoreNode(asset) && zoomTier !== 'low') return true
  return asset.id === context.hoveredAssetId && zoomTier === 'high'
}

function isImportantJunction(asset) {
  const type = asset.type || asset.assetType
  return type === 'Junction box' || Number(asset.relationCount) >= 3
}

function collides(candidate, placed, minimumDistance) {
  return placed.some((point) => (
    Math.hypot(candidate.x - point.x, candidate.y - point.y) < minimumDistance
  ))
}

function rectanglesOverlap(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top
}

function stableAngleOffset(value) {
  let hash = 0
  for (const character of String(value ?? '')) {
    hash = ((hash * 31) + character.codePointAt(0)) >>> 0
  }
  return (hash % 360) * (Math.PI / 180)
}

export const leafletMapLodInternals = {
  exactCoordinateFanOut,
  rectanglesOverlap,
  shouldShowPersistentLabel,
}
