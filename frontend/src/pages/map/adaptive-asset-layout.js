const DEFAULT_VIEWPORT = Object.freeze({
  width: Number.POSITIVE_INFINITY,
  height: Number.POSITIVE_INFINITY,
})
import {
  assetLabelEligibleAtZoom,
  assetVisibleAtZoom,
  assetVisualTier,
} from './semantic-zoom.js'

export function buildAdaptiveAssetLayout(items = [], {
  zoom = 18,
  viewport = DEFAULT_VIEWPORT,
  enabled = true,
  showLabels = false,
} = {}) {
  const visibleItems = items
    .filter(({ point }) => validPoint(point))
    .filter((item) => assetVisibleAtZoom(item, zoom)
      || item.selected || item.hovered || item.searchHighlighted
      || item.physicalRelated || item.candidateEndpoint)
    .filter(({ point }) => insideViewport(point, viewport, 120))
  const groups = enabled
    ? groupNearbyItems(visibleItems, separationForZoom(zoom))
    : visibleItems.map((item) => [item])
  const markers = []
  const leaders = []

  groups.forEach((group) => {
    const ranked = [...group].sort(compareItems)
    const focused = ranked.filter(({ selected, hovered, physicalRelated, candidateEndpoint }) => (
      selected || hovered || physicalRelated || candidateEndpoint
    ))
    if (enabled && zoom < 18 && ranked.length > 1
      && ranked.some(({ isPole }) => isPole)) {
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
            autoLabel: false,
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

      if (clustered.length > 1 && clustered.some(({ isPole }) => isPole)) {
        markers.push(createClusterMarker(clustered, focused.length
          ? { x: center.x + 38, y: center.y }
          : center))
      } else {
        clustered.forEach((item) => {
          const autoLabel = assetLabelEligibleAtZoom(item, zoom, {
            showAllLabels: showLabels,
          })
          markers.push({
            ...item,
            key: `asset:${item.id}`,
            kind: 'asset',
            point: item.point,
            anchorPoint: item.point,
            displaced: false,
            showLabel: autoLabel,
            autoLabel,
          })
        })
      }
      return
    }

    const center = centroid(ranked.map(({ point }) => point))
    const displayPoints = enabled && ranked.length > 1
      ? spreadPoints(center, ranked.length)
      : ranked.map(({ point }) => point)

    ranked.forEach((item, index) => {
      const point = displayPoints[index]
      const displaced = distance(item.point, point) > 7
      const explicitLabel = Boolean(item.selected || item.hovered
        || item.physicalRelated || item.candidateEndpoint || item.searchHighlighted)
      const autoLabel = !explicitLabel && assetLabelEligibleAtZoom(item, zoom, {
        showAllLabels: showLabels,
      })
      const marker = {
        ...item,
        key: `asset:${item.id}`,
        kind: 'asset',
        point,
        anchorPoint: item.point,
        displaced,
        showLabel: explicitLabel || autoLabel,
        autoLabel,
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
  const representativePole = items.find(({ isPole }) => isPole)
  return {
    key: `cluster:${items.map(({ id }) => id).sort().join('|')}`,
    kind: 'cluster',
    point,
    count: items.length,
    memberIds: items.map(({ id }) => id),
    memberLabels: items.map(({ label, id }) => label || id).slice(0, 4),
    coordinates: items.map(({ coordinate }) => coordinate).filter(validCoordinate),
    label: clusterLabel(items),
    representativePole: representativePole
      ? {
          id: representativePole.id,
          label: representativePole.label || representativePole.id,
        }
      : null,
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

export function attachClustersToPoleGroups(markers = [], poleGroups = [], maxDistance = 110) {
  const clusterGroupIds = new Map()
  // These assets are only close on the current screen. They are not
  // mounting relations and must stay separate from the persisted count.
  const nearbyAssetCounts = new Map()

  markers
    .filter(({ kind, representativePole }) => kind === 'cluster' && !representativePole)
    .forEach((marker) => {
      const nearest = poleGroups
        .map((group) => ({
          group,
          distance: distance(marker.point, group.point),
        }))
        .filter(({ distance: markerDistance }) => markerDistance <= maxDistance)
        .sort((left, right) => (
          left.distance - right.distance
            || String(left.group.group.id).localeCompare(String(right.group.group.id), 'id')
        ))[0]
      if (!nearest) return
      clusterGroupIds.set(marker.key, nearest.group.group.id)
      nearbyAssetCounts.set(
        nearest.group.group.id,
        (nearbyAssetCounts.get(nearest.group.group.id) ?? 0) + marker.count,
      )
    })

  return { clusterGroupIds, nearbyAssetCounts }
}

function spreadPoints(center, count) {
  if (count <= 1) return [center]
  if (count <= 8) {
    const radius = Math.max(30, 20 + count * 4)
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
    .sort((left, right) => itemPriority(left) - itemPriority(right)
      || compareItems(left, right))

  ranked.forEach((marker) => {
    const placements = ['right', 'left', 'top', 'bottom']
      .map((placement) => ({ placement, box: labelBox(marker, placement) }))
    const available = placements.find(({ box }) => (
      placed.every((placedBox) => !boxesOverlap(box, placedBox))
    ))
    if (available) {
      marker.labelPlacement = available.placement
      placed.push(available.box)
      return
    }
    const mandatory = marker.selected || marker.hovered
    if (!mandatory) {
      marker.showLabel = false
      return
    }
    marker.labelPlacement = 'right'
    placed.push(placements[0].box)
  })
}

function labelBox(marker, placement = 'right') {
  const labelWidth = Math.min(116, 38 + compactLabel(marker.label || marker.id).length * 6)
  const labelHeight = 22
  const gap = 4
  if (placement === 'left') {
    return { left: marker.point.x - 15 - gap - labelWidth,
      right: marker.point.x - 15 - gap, top: marker.point.y - labelHeight / 2,
      bottom: marker.point.y + labelHeight / 2 }
  }
  if (placement === 'top') {
    return { left: marker.point.x - labelWidth / 2, right: marker.point.x + labelWidth / 2,
      top: marker.point.y - 15 - gap - labelHeight, bottom: marker.point.y - 15 - gap }
  }
  if (placement === 'bottom') {
    return { left: marker.point.x - labelWidth / 2, right: marker.point.x + labelWidth / 2,
      top: marker.point.y + 15 + gap, bottom: marker.point.y + 15 + gap + labelHeight }
  }
  return {
    left: marker.point.x + 15 + gap,
    right: marker.point.x + 15 + gap + labelWidth,
    top: marker.point.y - labelHeight / 2,
    bottom: marker.point.y + labelHeight / 2,
  }
}

function compactLabel(value) {
  const label = String(value ?? '').trim()
  return label.length > 18 ? `${label.slice(0, 17)}…` : label
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
  if (item.hovered) return 1
  const tier = assetVisualTier(item)
  if (tier === 0) return 2
  if (item.networkFocused) return 3
  return 4 + tier
}

function clusterLabel(items) {
  const types = new Set(items.map(({ type, category }) => type || category).filter(Boolean))
  if (types.size === 1) return [...types][0]
  return 'Aset campuran'
}

function separationForZoom(zoom) {
  if (zoom < 18) return 72
  if (zoom < 20) return 48
  return 30
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
