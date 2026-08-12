const DEFAULT_VIEWPORT = Object.freeze({
  width: Number.POSITIVE_INFINITY,
  height: Number.POSITIVE_INFINITY,
})

export function buildAdaptiveAssetLayout(items = [], {
  zoom = 18,
  viewport = DEFAULT_VIEWPORT,
  enabled = true,
} = {}) {
  const visibleItems = items
    .filter(({ point }) => validPoint(point))
    .filter(({ point }) => insideViewport(point, viewport, 120))
  const groups = enabled
    ? groupNearbyItems(visibleItems, separationForZoom(zoom))
    : visibleItems.map((item) => [item])
  const markers = []
  const leaders = []

  groups.forEach((group) => {
    const ranked = [...group].sort(compareItems)
    const focused = ranked
      .filter(({ selected, trace, networkFocused }) => selected || trace || networkFocused)
      .slice(0, 4)
    if (enabled && ranked.length > 8) {
      const focusedIds = new Set(focused.map(({ id }) => id))
      const clustered = ranked.filter(({ id }) => !focusedIds.has(id))
      const center = centroid(ranked.map(({ point }) => point))

      if (focused.length) {
        const displayPoints = focused.length === 1
          ? [center]
          : spreadPoints(center, focused.length)
        focused.forEach((item, index) => {
          const point = displayPoints[index]
          const displaced = distance(item.point, point) > 7
          markers.push({
            ...item,
            key: `asset:${item.id}`,
            kind: 'asset',
            point,
            anchorPoint: item.point,
            displaced,
            showLabel: true,
          })
          if (displaced) {
            leaders.push({
              key: `leader:${item.id}`,
              assetId: item.id,
              from: item.point,
              to: point,
              color: item.color,
            })
          }
        })
      }

      if (clustered.length) {
        markers.push(createClusterMarker(
          clustered,
          focused.length === 1 ? { x: center.x + 38, y: center.y } : center,
        ))
      }
      return
    }

    const mustExpand = zoom >= 17
      || ranked.some(({ selected, trace, networkFocused }) => (
        selected || trace || networkFocused
      ))

    if (enabled && ranked.length > 1 && !mustExpand) {
      markers.push(createClusterMarker(ranked))
      return
    }

    const center = centroid(ranked.map(({ point }) => point))
    const displayPoints = enabled && ranked.length > 1
      ? spreadPoints(center, ranked.length)
      : ranked.map(({ point }) => point)

    ranked.forEach((item, index) => {
      const point = displayPoints[index]
      const displaced = distance(item.point, point) > 7
      const marker = {
        ...item,
        key: `asset:${item.id}`,
        kind: 'asset',
        point,
        anchorPoint: item.point,
        displaced,
        showLabel: Boolean(item.selected || item.trace || (item.isCoreNode && zoom >= 19.5)),
      }
      markers.push(marker)
      if (displaced) {
        leaders.push({
          key: `leader:${item.id}`,
          assetId: item.id,
          from: item.point,
          to: point,
          color: item.color,
        })
      }
    })
  })

  avoidLabelCollisions(markers)

  return {
    markers,
    leaders,
    summary: {
      visibleAssetCount: visibleItems.length,
      clusterCount: markers.filter(({ kind }) => kind === 'cluster').length,
      clusteredAssetCount: markers
        .filter(({ kind }) => kind === 'cluster')
        .reduce((total, marker) => total + marker.count, 0),
      displacedAssetCount: leaders.length,
      hiddenLabelCount: markers
        .filter(({ kind, showLabel }) => kind === 'asset' && !showLabel)
        .length,
    },
  }
}

function createClusterMarker(items, point = centroid(items.map((item) => item.point))) {
  return {
    key: `cluster:${items.map(({ id }) => id).sort().join('|')}`,
    kind: 'cluster',
    point,
    count: items.length,
    memberIds: items.map(({ id }) => id),
    coordinates: items.map(({ coordinate }) => coordinate).filter(validCoordinate),
    label: clusterLabel(items),
    networkFocused: items.some(({ networkFocused }) => networkFocused),
    candidateEndpoint: items.some(({ candidateEndpoint }) => candidateEndpoint),
    candidateContext: items.every(({ candidateContext }) => candidateContext),
    color: items.find(({ networkFocused }) => networkFocused)?.color,
  }
}

export function groupNearbyItems(items, threshold) {
  if (items.length < 2 || threshold <= 0) return items.map((item) => [item])
  const groups = []
  const ordered = [...items].sort((left, right) => (
    left.point.x - right.point.x
    || left.point.y - right.point.y
    || String(left.id).localeCompare(String(right.id), 'id')
  ))

  ordered.forEach((item) => {
    const nearest = groups
      .map((group, index) => ({
        group,
        index,
        distance: distance(item.point, centroid(group.map(({ point }) => point))),
      }))
      .filter(({ group, distance: centerDistance }) => (
        centerDistance <= threshold
        && group.every(({ point }) => distance(item.point, point) <= threshold * 1.55)
      ))
      .sort((left, right) => left.distance - right.distance || left.index - right.index)[0]
    if (nearest) nearest.group.push(item)
    else groups.push([item])
  })
  return groups
}

function spreadPoints(center, count) {
  if (count <= 1) return [center]
  if (count <= 8) {
    const radius = Math.max(38, 21 + count * 5)
    return Array.from({ length: count }, (_, index) => {
      const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / count)
      return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      }
    })
  }

  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, index) => {
    const radius = 30 + 15 * Math.sqrt(index + 1)
    const angle = (-Math.PI / 2) + index * goldenAngle
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
  })
}

function avoidLabelCollisions(markers) {
  const placed = []
  const ranked = markers
    .filter(({ kind, showLabel }) => kind === 'asset' && showLabel)
    .sort(compareItems)

  ranked.forEach((marker) => {
    const box = labelBox(marker)
    const collides = placed.some((placedBox) => boxesOverlap(box, placedBox))
    const mandatory = marker.selected || marker.trace
    if (collides && !mandatory) {
      marker.showLabel = false
      return
    }
    placed.push(box)
  })
}

function labelBox(marker) {
  const labelWidth = Math.min(116, 38 + String(marker.label || marker.id).length * 6)
  return {
    left: marker.point.x - 15,
    right: marker.point.x + labelWidth,
    top: marker.point.y - 17,
    bottom: marker.point.y + 17,
  }
}

function boxesOverlap(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top
}

function compareItems(left, right) {
  return itemPriority(left) - itemPriority(right)
    || String(left.label ?? left.name ?? left.id)
      .localeCompare(String(right.label ?? right.name ?? right.id), 'id')
}

function itemPriority(item) {
  if (item.selected) return 0
  if (item.trace) return 1
  if (item.networkFocused) return 2
  if (item.isCoreNode) return 3
  if (item.active !== false) return 4
  return 5
}

function clusterLabel(items) {
  const types = new Set(items.map(({ type, category }) => type || category).filter(Boolean))
  if (types.size === 1) return [...types][0]
  return 'Aset campuran'
}

function separationForZoom(zoom) {
  if (zoom < 15) return 96
  if (zoom < 17) return 68
  if (zoom < 19) return 38
  return 22
}

function centroid(points) {
  if (!points.length) return { x: 0, y: 0 }
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function insideViewport(point, viewport, padding) {
  return point.x >= -padding
    && point.x <= viewport.width + padding
    && point.y >= -padding
    && point.y <= viewport.height + padding
}

function validPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y)
}

function validCoordinate(coordinate) {
  return Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(Number(coordinate[0]))
    && Number.isFinite(Number(coordinate[1]))
}
