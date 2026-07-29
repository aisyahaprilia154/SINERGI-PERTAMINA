import {
  calculateCanvasBackingStoreSize,
  clampMapZoom,
  createFrameScheduler,
  createViewportSubscriptionStore,
  geometryIntersectsGeographicBounds,
  getMapZoomTier,
  layoutViewportNodes,
  markerRadiusForZoom,
  pointerToCanvasCssPoint,
  screenViewportToGeographicBounds,
} from './map-viewport-layout.js'
import {
  getAssetRenderLabels,
  truncateAssetLabel,
} from '../../domain/asset-display-name.js'

const nodeGlyph = {
  CCTV: 'C',
  OTB: 'O',
  Server: 'S',
  NVR: 'N',
  'Junction box': 'J',
  'Core switch': 'S',
  'Distribution switch': 'S',
  'Access switch': 'S',
  'Access point': 'A',
  Printer: 'P',
}

const connectorTypes = new Set([
  'OTB',
  'NVR',
  'Junction box',
  'Core switch',
  'Distribution switch',
  'Access switch',
])

export function createMapCanvas(canvas, {
  assets,
  networks,
  geometries = [],
  onSelectAsset,
  onSelectNetwork = () => {},
  onViewportChange = () => {},
}) {
  const context = canvas.getContext('2d')
  const tooltip = canvas.parentElement.querySelector('.map-asset-tooltip')
  const computedStyle = getComputedStyle(canvas)
  const colors = {
    canvas: computedStyle.getPropertyValue('--color-map-canvas').trim(),
    road: computedStyle.getPropertyValue('--color-map-road').trim(),
    grid: computedStyle.getPropertyValue('--color-map-grid').trim(),
    label: computedStyle.getPropertyValue('--color-map-label').trim(),
    surface: computedStyle.getPropertyValue('--color-surface').trim(),
    surfaceSubtle: computedStyle.getPropertyValue('--color-surface-subtle').trim(),
    primary: computedStyle.getPropertyValue('--color-primary').trim(),
    primarySoft: computedStyle.getPropertyValue('--color-primary-soft').trim(),
    text: computedStyle.getPropertyValue('--color-text-primary').trim(),
    textSecondary: computedStyle.getPropertyValue('--color-text-secondary').trim(),
    border: computedStyle.getPropertyValue('--color-border').trim(),
    success: computedStyle.getPropertyValue('--color-success').trim(),
    warning: computedStyle.getPropertyValue('--color-warning').trim(),
  }
  let selectedNetworkIds = new Set()
  let selectedAssetId = null
  let highlightedNetworkId = null
  let hoveredEdgeNetworkId = null
  let hoveredAssetId = null
  let keyboardFocusAssetId = null
  let traceNodeIds = []
  let connectedNodeIds = []
  let selectableAssetIds = null
  let dimOthers = true
  let zoom = 1
  let pan = { x: 0, y: 0 }
  let renderedNodes = []
  let renderedEdges = []
  let dragging = false
  let dragStart = null
  let dragDistance = 0
  let viewportChangeTimer = null
  let viewTransformStable = true
  let renderedGeometryIds = new Set()
  const simplifiedPointCache = new WeakMap()
  const viewportSubscriptions = createViewportSubscriptionStore(onViewportChange)
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const geometryById = new Map(geometries.map((geometry) => [geometry.id, geometry]))
  const geometriesBySourceId = new Map()
  geometries.forEach((geometry) => {
    const sourceId = geometry.sourceGeometryId || geometry.id
    geometriesBySourceId.set(sourceId, [
      ...(geometriesBySourceId.get(sourceId) || []),
      geometry,
    ])
  })
  const networksByAssetId = new Map()
  networks.forEach((network) => {
    network.nodeIds.forEach((assetId) => {
      networksByAssetId.set(assetId, [
        ...(networksByAssetId.get(assetId) || []),
        network,
      ])
    })
  })
  const geometriesByNetworkId = new Map(networks.map((network) => [
    network.id,
    network.geometryIds?.length
      ? network.geometryIds.map((id) => geometryById.get(id)).filter(Boolean)
      : (network.geometryAssetIds ?? [])
        .flatMap((assetId) => assetById.get(assetId)?.geometry ?? []),
  ]))
  const networkIdsByGeometryId = new Map()
  networks.forEach((network) => {
    ;(geometriesByNetworkId.get(network.id) || []).forEach(({ id: geometryId }) => {
      networkIdsByGeometryId.set(geometryId, [
        ...(networkIdsByGeometryId.get(geometryId) || []),
        network.id,
      ])
    })
  })
  const geographicDataBounds = collectGeographicBounds(geometries)
  const drawScheduler = createFrameScheduler(
    window.requestAnimationFrame.bind(window),
    window.cancelAnimationFrame.bind(window),
    draw,
  )
  const scheduleDraw = () => drawScheduler.schedule()
  const scheduleViewportChange = () => {
    viewTransformStable = false
    window.clearTimeout(viewportChangeTimer)
    viewportChangeTimer = window.setTimeout(() => {
      viewportChangeTimer = null
      viewTransformStable = true
      scheduleDraw()
      const bounds = getGeographicViewportBounds()
      const detail = {
        visibleAssetIds: getVisibleAssetIds(),
        visibleGeometryIds: getVisibleGeometryIds(),
        zoom,
        zoomTier: getMapZoomTier(zoom),
      }
      viewportSubscriptions.notify(bounds, detail)
    }, 100)
  }

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    const backingStore = calculateCanvasBackingStoreSize({
      cssWidth: rect.width,
      cssHeight: rect.height,
      devicePixelRatio: window.devicePixelRatio,
    })
    if (!backingStore.pixelWidth || !backingStore.pixelHeight) return
    if (canvas.width !== backingStore.pixelWidth) {
      canvas.width = backingStore.pixelWidth
    }
    if (canvas.height !== backingStore.pixelHeight) {
      canvas.height = backingStore.pixelHeight
    }
    context.setTransform(
      backingStore.ratio,
      0,
      0,
      backingStore.ratio,
      0,
      0,
    )
    scheduleDraw()
    scheduleViewportChange()
  }

  const mapPoint = (asset, width, height) => ({
    x: width / 2 + (asset.x * width - width / 2) * zoom + pan.x,
    y: height / 2 + (asset.y * height - height / 2) * zoom + pan.y,
  })

  function drawBackground(width, height) {
    context.fillStyle = colors.canvas
    context.fillRect(0, 0, width, height)

    context.save()
    context.translate(pan.x, pan.y)
    context.scale(zoom, zoom)
    context.strokeStyle = colors.road
    context.lineWidth = 13
    const roads = [
      [[-20, height * .22], [width * .25, height * .18], [width * .51, height * .24], [width * 1.05, height * .17]],
      [[width * .08, -20], [width * .16, height * .37], [width * .12, height * 1.08]],
      [[width * .4, -20], [width * .44, height * .4], [width * .4, height * 1.05]],
      [[width * .73, -20], [width * .68, height * .43], [width * .78, height * 1.05]],
      [[-20, height * .58], [width * .28, height * .55], [width * .54, height * .66], [width * 1.05, height * .6]],
      [[-20, height * .85], [width * .38, height * .78], [width * .63, height * .88], [width * 1.05, height * .82]],
    ]
    context.lineCap = 'round'
    context.lineJoin = 'round'
    roads.forEach((road) => {
      context.beginPath()
      road.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
      context.stroke()
    })

    context.strokeStyle = colors.grid
    context.lineWidth = 1
    for (let x = 32; x < width; x += 96) {
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, height)
      context.stroke()
    }
    for (let y = 38; y < height; y += 88) {
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(width, y)
      context.stroke()
    }
    context.restore()

    context.fillStyle = colors.label
    context.font = '600 11px Inter, sans-serif'
    context.fillText('JL. PEMUDA', width * .72, height * .13)
    context.fillText('AREA OPERASI', width * .72, height * .77)
    context.fillText('GEDUNG ADMINISTRASI', width * .25, height * .12)
  }

  function draw() {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    context.clearRect(0, 0, width, height)
    drawBackground(width, height)
    renderedNodes = []
    renderedEdges = []
    renderedGeometryIds = new Set()

    const emphasizedNetworkId = hoveredEdgeNetworkId || highlightedNetworkId
    const hasEmphasizedNetwork = Boolean(emphasizedNetworkId)
    const tracingActive = traceNodeIds.length > 0
    const zoomTier = getMapZoomTier(zoom)
    const traceEdges = new Set(
      traceNodeIds.slice(1).map((id, index) => [traceNodeIds[index], id].sort().join('|')),
    )

    const networkStates = networks.map((network) => {
      const active = selectedNetworkIds.has(network.id)
      const emphasized = network.id === emphasizedNetworkId
      const hasTraceEdge = (network.edges || []).some(([fromId, toId]) =>
        traceEdges.has([fromId, toId].sort().join('|')),
      )
      return { network, active, emphasized, hasTraceEdge }
    })
    networkStates
      .filter(({ active, emphasized, hasTraceEdge }) => (
        active || emphasized || hasTraceEdge || !dimOthers
      ))
      .forEach((networkState) => drawNetworkPolygons(networkState, {
        width,
        height,
        tracingActive,
        hasEmphasizedNetwork,
      }))
    networkStates
      .filter(({ active, emphasized, hasTraceEdge }) => (
        active || emphasized || hasTraceEdge || !dimOthers
      ))
      .forEach((networkState) => drawNetworkLines(networkState, {
        width,
        height,
        tracingActive,
        hasEmphasizedNetwork,
        zoomTier,
      }))
    drawLogicalRelations(networkStates, traceEdges, width, height)

    const visibleAssetIds = new Set(
      networks
        .filter((network) =>
          selectedNetworkIds.has(network.id) || network.id === emphasizedNetworkId || !dimOthers,
        )
        .flatMap((network) => network.nodeIds),
    )
    traceNodeIds.forEach((assetId) => visibleAssetIds.add(assetId))
    connectedNodeIds.forEach((assetId) => visibleAssetIds.add(assetId))

    const nodeInputs = []
    assets.forEach((asset) => {
      if (!visibleAssetIds.has(asset.id) || !asset.hasPointGeometry) return
      const matchingNetworks = networksByAssetId.get(asset.id) || []
      const activeNetworks = matchingNetworks.filter((network) => selectedNetworkIds.has(network.id))
      const emphasizedNetworks = matchingNetworks.filter((network) => network.id === emphasizedNetworkId)
      const primaryNetwork = emphasizedNetworks[0] || activeNetworks[0] || matchingNetworks[0]
      if (!primaryNetwork) return

      const point = mapPoint(asset, width, height)
      const isSelected = asset.id === selectedAssetId
      const isTraceNode = traceNodeIds.includes(asset.id)
      const isTraceEndpoint = asset.id === traceNodeIds[0]
        || asset.id === traceNodeIds.at(-1)
      const isConnected = connectedNodeIds.includes(asset.id) || isTraceNode
      const isKeyboardFocused = asset.id === keyboardFocusAssetId
      const muted = activeNetworks.length === 0 && emphasizedNetworks.length === 0 && !isConnected
      const nodeAlpha = muted
        ? .22
        : tracingActive && !isTraceNode && !isSelected
          ? .18
        : hasEmphasizedNetwork && emphasizedNetworks.length === 0 && !isConnected
          ? .3
          : 1

      nodeInputs.push({
        ...point,
        asset,
        primaryNetwork,
        nodeAlpha,
        selected: isSelected,
        keyboardFocused: isKeyboardFocused,
        active: activeNetworks.length > 0,
        connected: isConnected,
        traceEndpoint: isTraceEndpoint,
        degree: Number(asset.relationCount) || 0,
        core: asset.isCoreNode === true,
        important: connectorTypes.has(asset.type) || asset.type === 'Server',
      })
    })

    const nodeMarkers = layoutViewportNodes(nodeInputs, {
      tier: zoomTier,
      selectedAssetId,
      hoveredAssetId,
      keyboardFocusAssetId,
    })
    drawDisplacementLeaders(nodeMarkers)
    nodeMarkers.forEach((marker) => {
      if (marker.kind === 'cluster') drawClusterMarker(marker, zoomTier)
      else drawAssetMarker(marker, zoomTier)
      renderedNodes.push(marker)
    })

    drawLabels(width, height)
    context.textAlign = 'start'
    context.textBaseline = 'alphabetic'
  }

  function drawDisplacementLeaders(markers) {
    context.save()
    context.strokeStyle = colors.textSecondary
    context.lineWidth = 1
    context.globalAlpha = .58
    markers
      .filter((marker) => marker.kind === 'asset' && marker.displaced)
      .forEach((marker) => {
        context.beginPath()
        context.moveTo(marker.originalX, marker.originalY)
        context.lineTo(marker.x, marker.y)
        context.stroke()
      })
    context.restore()
  }

  function drawAssetMarker(marker, zoomTier) {
    const { asset, primaryNetwork } = marker
    const radius = markerRadiusForZoom(zoom, marker.important)
      + (marker.selected || marker.keyboardFocused ? 2 : 0)
    marker.hitRadius = Math.max(20, radius + 6)

    context.save()
    context.globalAlpha = marker.nodeAlpha
    if (marker.connected) {
      drawOuterRing(marker, radius + 5, colors.surface, 5)
      drawOuterRing(marker, radius + 5, colors.primary, 1.5)
    }
    if (marker.selected || marker.keyboardFocused) {
      drawOuterRing(marker, radius + 5, colors.primarySoft, 5)
    }

    const fillColor = marker.selected ? colors.primary : colors.surface
    const strokeColor = marker.selected
      ? colors.primary
      : marker.connected
        ? colors.primary
        : primaryNetwork.color
    drawNodeShape(
      asset.type,
      marker,
      radius,
      fillColor,
      strokeColor,
      marker.selected ? 3 : 2.5,
    )

    context.fillStyle = marker.selected ? colors.surface : strokeColor
    context.font = `700 ${marker.important && zoomTier !== 'low' ? 11 : 10}px Inter, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(nodeGlyph[asset.type] || '·', marker.x, marker.y + .5)
    drawStatusBadge(asset, marker, radius)
    context.restore()
  }

  function drawClusterMarker(marker, zoomTier) {
    const radius = zoomTier === 'low' ? 13 : 15
    marker.hitRadius = 20
    marker.active = marker.assets.some((asset) => (
      (networksByAssetId.get(asset.id) || []).some((network) => selectedNetworkIds.has(network.id))
    ))
    context.save()
    drawOuterRing(marker, radius + 3, colors.surface, 4)
    context.beginPath()
    context.arc(marker.x, marker.y, radius, 0, Math.PI * 2)
    context.fillStyle = colors.primarySoft
    context.fill()
    context.strokeStyle = colors.primary
    context.lineWidth = 2
    context.stroke()
    context.fillStyle = colors.primary
    context.font = '700 11px Inter, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(String(marker.count), marker.x, marker.y + .5)
    context.restore()
  }

  function drawNetworkPolygons({
    network,
    active,
    emphasized,
    hasTraceEdge,
  }, {
    width,
    height,
    tracingActive,
    hasEmphasizedNetwork,
  }) {
    const alpha = emphasized
      ? .16
      : tracingActive && !hasTraceEdge
        ? .025
        : hasEmphasizedNetwork && !emphasized
          ? .035
          : active
            ? .09
            : .025
    for (const geometry of geometriesForNetwork(network)) {
      const owner = geometry.assetId
        ? assetById.get(geometry.assetId)
        : null
      const isCctvView = `${owner?.name || ''} ${owner?.type || ''} ${geometry.category || ''}`
        .toLowerCase().includes('view')
        || `${owner?.name || ''} ${owner?.type || ''}`.toLowerCase().includes('pandang')
      for (const rings of displayGeometryParts([geometry], 'polygon')) {
        if (!rings.length) continue
        context.save()
        context.beginPath()
        let geometryVisible = false
        rings.forEach((ring) => {
          const points = simplifyDisplayPoints(ring)
            .map((displayPoint) => mapPoint(displayPoint, width, height))
          if (screenPathIntersectsViewport(points, width, height)) {
            geometryVisible = true
          }
          points.forEach((point, index) => {
            if (index) context.lineTo(point.x, point.y)
            else context.moveTo(point.x, point.y)
          })
          context.closePath()
        })
        if (geometryVisible) renderedGeometryIds.add(geometry.id)
        context.globalAlpha = isCctvView ? Math.min(alpha, .045) : alpha
        context.fillStyle = network.color
        context.fill('evenodd')
        context.globalAlpha = Math.min(1, alpha * 4.5)
        context.strokeStyle = network.color
        context.lineWidth = emphasized ? 2.2 : active ? 1.6 : 1
        context.stroke()
        context.restore()
      }
    }
  }

  function drawNetworkLines({
    network,
    active,
    emphasized,
    hasTraceEdge,
  }, {
    width,
    height,
    tracingActive,
    hasEmphasizedNetwork,
    zoomTier,
  }) {
    const lineStyle = getNetworkLineStyle(network)
    const detailAlpha = lineDetailAlpha(lineStyle.role, zoomTier)
    const alpha = (emphasized
      ? 1
      : tracingActive && !hasTraceEdge
        ? .12
        : hasEmphasizedNetwork
          ? (active ? .25 : .08)
          : active
            ? 1
            : .14) * detailAlpha
    const tierWidthScale = zoomTier === 'low' ? .82 : zoomTier === 'high' ? 1.06 : 1
    const lineWidth = (emphasized
      ? lineStyle.width + 2
      : active
        ? lineStyle.width
        : Math.max(1.2, lineStyle.width - 1)) * tierWidthScale

    for (const geometry of geometriesForNetwork(network)) {
      for (const line of displayGeometryParts([geometry], 'line_string')) {
        const points = simplifyDisplayPoints(line, zoomTier)
          .map((point) => mapPoint(point, width, height))
        if (points.length < 2) continue
        if (screenPathIntersectsViewport(points, width, height)) {
          renderedGeometryIds.add(geometry.id)
        }
        context.save()
        context.globalAlpha = alpha
        context.lineCap = 'round'
        context.lineJoin = 'round'
        context.setLineDash(lineStyle.dash)
        if (active || emphasized) {
          strokeCanvasPath(points, colors.surface, lineWidth + 3)
        }
        strokeCanvasPath(points, network.color, lineWidth)
        context.restore()
        points.slice(1).forEach((end, index) => {
          renderedEdges.push({
            start: points[index],
            end,
            networkId: network.id,
            assetId: geometry.assetId,
            hitWidth: Math.max(12, lineWidth + 8),
          })
        })
      }
    }
  }

  function drawLogicalRelations(networkStates, traceEdges, width, height) {
    const drawn = new Set()
    networkStates.forEach(({ network, active }) => {
      const relations = network.relations?.length
        ? network.relations
        : (network.edges || []).map(([sourceAssetId, targetAssetId]) => ({
          sourceAssetId,
          targetAssetId,
          relationSource: 'explicit',
          relationStatus: 'confirmed',
        }))
      relations.forEach((relation) => {
        const fromId = relation.sourceAssetId
        const toId = relation.targetAssetId
        const key = [fromId, toId].sort().join('|')
        const isTraceEdge = traceEdges.has(key)
        const touchesSelectedAsset = selectedAssetId
          && (fromId === selectedAssetId || toId === selectedAssetId)
        if ((!active && !isTraceEdge && !touchesSelectedAsset)
          || relation.relationStatus === 'ambiguous'
          || drawn.has(key)) return
        const from = assetById.get(fromId)
        const to = assetById.get(toId)
        if (!from?.renderable || !to?.renderable) return
        drawn.add(key)
        const sourceGeometryIds = relation.sourceGeometryIds?.length
          ? relation.sourceGeometryIds
          : [relation.sourceGeometryId].filter(Boolean)
        const pathGeometries = sourceGeometryIds.flatMap(
          (geometryId) => geometriesBySourceId.get(geometryId) || [],
        )
        if (pathGeometries.length && active && !isTraceEdge && !touchesSelectedAsset) {
          return
        }
        const alpha = isTraceEdge ? 1 : touchesSelectedAsset ? .74 : .32
        const color = isTraceEdge ? colors.primary : network.color
        const lineWidth = isTraceEdge ? 3 : touchesSelectedAsset ? 2.4 : 1.5
        context.save()
        context.globalAlpha = alpha
        context.lineCap = 'round'
        context.lineJoin = 'round'
        context.setLineDash(relation.relationSource === 'explicit' ? [5, 5] : [])
        if (pathGeometries.length) {
          pathGeometries.forEach((geometry) => {
            displayGeometryParts([geometry], 'line_string').forEach((line) => {
              const points = simplifyDisplayPoints(line)
                .map((point) => mapPoint(point, width, height))
              if (points.length < 2) return
              if (screenPathIntersectsViewport(points, width, height)) {
                renderedGeometryIds.add(geometry.id)
              }
              strokeCanvasPath(points, colors.surface, lineWidth + 4)
              strokeCanvasPath(points, color, lineWidth)
              addRenderedEdgeSegments(points, network.id, lineWidth)
            })
          })
        } else {
          const points = [mapPoint(from, width, height), mapPoint(to, width, height)]
          strokeCanvasPath(points, colors.surface, lineWidth + 4)
          strokeCanvasPath(points, color, lineWidth)
          addRenderedEdgeSegments(points, network.id, lineWidth)
        }
        context.restore()
      })
    })
  }

  function addRenderedEdgeSegments(points, networkId, lineWidth) {
    points.slice(1).forEach((end, index) => {
      renderedEdges.push({
        start: points[index],
        end,
        networkId,
        hitWidth: Math.max(12, lineWidth + 8),
      })
    })
  }

  function displayGeometryParts(geometries, targetType) {
    const output = []
    const collect = (geometry) => {
      if (geometry.geometryType === targetType && geometry.displayCoordinates) {
        output.push(geometry.displayCoordinates)
      } else if (geometry.geometryType === 'multi_geometry') {
        ;(geometry.displayCoordinates ?? []).forEach(collect)
      }
    }
    geometries.forEach(collect)
    return output
  }

  function geometriesForNetwork(network) {
    return geometriesByNetworkId.get(network.id) || []
  }

  function simplifyDisplayPoints(points, tier = getMapZoomTier(zoom)) {
    const maximumPoints = tier === 'low' ? 80 : tier === 'medium' ? 180 : Infinity
    if (points.length <= maximumPoints) return points
    const cached = simplifiedPointCache.get(points)?.[tier]
    if (cached) return cached
    const step = Math.ceil(points.length / maximumPoints)
    const simplified = points.filter((_, index) => index % step === 0)
    const last = points.at(-1)
    if (simplified.at(-1) !== last) simplified.push(last)
    simplifiedPointCache.set(points, {
      ...(simplifiedPointCache.get(points) || {}),
      [tier]: simplified,
    })
    return simplified
  }

  function strokeCanvasPath(points, color, lineWidth) {
    context.beginPath()
    points.forEach((point, index) => {
      if (index) context.lineTo(point.x, point.y)
      else context.moveTo(point.x, point.y)
    })
    context.strokeStyle = color
    context.lineWidth = lineWidth
    context.stroke()
  }

  function drawLabels(width, height) {
    if (!viewTransformStable) return
    const occupied = []
    const zoomTier = getMapZoomTier(zoom)
    const candidates = renderedNodes
      .filter((node) => {
        if (node.kind !== 'asset') return false
        if (node.asset.id === selectedAssetId
          || node.asset.id === keyboardFocusAssetId
          || node.traceEndpoint
          || node.core) return true
        if (traceNodeIds.length && !node.connected) return false
        if (zoomTier !== 'high') return false
        if (node.asset.id === hoveredAssetId) return true
        if (node.degree >= 3) return true
        if (node.important && node.active) return true
        return zoom >= 2.4 && node.active
      })
      .sort((a, b) => labelPriority(b) - labelPriority(a))

    candidates.forEach((node) => {
      context.font = `${node.asset.id === selectedAssetId ? 700 : 600} 11px Inter, sans-serif`
      const label = getAssetRenderLabels(node.asset, {
        shortMax: 18,
        displayMax: 30,
      }).shortLabel
      const textWidth = context.measureText(label).width
      const rect = {
        x: Math.max(4, Math.min(width - textWidth - 16, node.x - textWidth / 2 - 8)),
        y: Math.max(4, Math.min(height - 24, node.y + 18)),
        width: textWidth + 16,
        height: 22,
      }
      if (occupied.some((item) => rectanglesOverlap(item, rect))) return
      const overlapsMarker = renderedNodes.some((marker) => {
        if (marker === node) return false
        const radius = Math.min(marker.hitRadius || 20, 20)
        return rectanglesOverlap(rect, {
          x: marker.x - radius,
          y: marker.y - radius,
          width: radius * 2,
          height: radius * 2,
        })
      })
      if (overlapsMarker && labelPriority(node) < 500) return
      occupied.push(rect)

      context.fillStyle = colors.surface
      context.strokeStyle = colors.border
      context.lineWidth = 1
      context.beginPath()
      context.roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      context.fill()
      context.stroke()
      context.fillStyle = colors.text
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(label, rect.x + rect.width / 2, rect.y + rect.height / 2 + .5)
    })
  }

  function labelPriority(node) {
    if (node.asset.id === selectedAssetId || node.asset.id === keyboardFocusAssetId) return 700
    if (node.traceEndpoint) return 600
    if (node.core) return 500
    if (node.asset.id === hoveredAssetId) return 400
    if (node.degree >= 3) return 300 + Math.min(node.degree, 99)
    if (node.important) return 200
    return 100
  }

  function drawNodeShape(type, point, radius, fillColor, strokeColor, lineWidth) {
    context.beginPath()
    if (type === 'Junction box') {
      context.moveTo(point.x, point.y - radius)
      context.lineTo(point.x + radius, point.y)
      context.lineTo(point.x, point.y + radius)
      context.lineTo(point.x - radius, point.y)
      context.closePath()
    } else if (type.includes('switch')) {
      context.roundRect(point.x - radius - 2, point.y - radius * .72, radius * 2 + 4, radius * 1.44, 5)
    } else if (type === 'OTB') {
      for (let index = 0; index < 6; index += 1) {
        const angle = Math.PI / 3 * index - Math.PI / 6
        const x = point.x + Math.cos(angle) * radius
        const y = point.y + Math.sin(angle) * radius
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.closePath()
    } else if (type === 'Server' || type === 'NVR' || type === 'Printer') {
      context.roundRect(point.x - radius, point.y - radius, radius * 2, radius * 2, type === 'Printer' ? 3 : 6)
    } else {
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
    }
    context.fillStyle = fillColor
    context.fill()
    context.strokeStyle = strokeColor
    context.lineWidth = lineWidth
    context.stroke()
  }

  function drawOuterRing(point, radius, color, lineWidth) {
    context.beginPath()
    context.arc(point.x, point.y, radius, 0, Math.PI * 2)
    context.strokeStyle = color
    context.lineWidth = lineWidth
    context.stroke()
  }

  function drawStatusBadge(asset, point, radius) {
    const status = String(asset.status || '').trim().toLowerCase()
    const online = ['online', 'active', 'aktif', 'normal'].includes(status)
    const warning = asset.hasIssue === true || Number(asset.issueCount) > 0
    if (!online && !warning) return
    const x = point.x + radius - 1
    const y = point.y - radius + 1
    context.beginPath()
    if (online && !warning) {
      context.arc(x, y, 4.5, 0, Math.PI * 2)
    } else {
      context.moveTo(x, y - 5)
      context.lineTo(x + 5, y + 4)
      context.lineTo(x - 5, y + 4)
      context.closePath()
    }
    context.fillStyle = online && !warning ? colors.success : colors.warning
    context.fill()
    context.strokeStyle = colors.surface
    context.lineWidth = 1.5
    context.stroke()
    context.beginPath()
    context.strokeStyle = colors.surface
    context.lineWidth = 1.3
    context.lineCap = 'round'
    if (online && !warning) {
      context.moveTo(x - 2.2, y)
      context.lineTo(x - .4, y + 1.8)
      context.lineTo(x + 2.5, y - 1.8)
    } else {
      context.moveTo(x, y - 1.8)
      context.lineTo(x, y + 1.2)
      context.moveTo(x, y + 2.8)
      context.lineTo(x, y + 2.9)
    }
    context.stroke()
  }

  function showTooltip(node) {
    if (!node || !tooltip) return
    if (node.kind === 'cluster') {
      tooltip.innerHTML = `
        <strong>${node.count} aset berdekatan</strong>
        <span>Klik untuk menguraikan marker</span>
        <small>Posisi geografis asli tidak berubah</small>
      `
    } else {
      const labels = getAssetRenderLabels(node.asset, {
        shortMax: 18,
        displayMax: 48,
      })
      tooltip.innerHTML = `
        <strong>${escapeHtml(labels.fullShortLabel)}</strong>
        <span>${escapeHtml(labels.fullDisplayName)}</span>
        <small>${escapeHtml(node.asset.type)} · ${escapeHtml(
          truncateAssetLabel(node.asset.location, 42),
        )}</small>
      `
    }
    tooltip.hidden = false
    const tooltipWidth = 220
    const left = Math.max(8, Math.min(canvas.clientWidth - tooltipWidth - 8, node.x + 16))
    const top = Math.max(8, Math.min(canvas.clientHeight - 90, node.y - 18))
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${top}px`
    canvas.setAttribute('aria-describedby', `map-keyboard-help ${tooltip.id}`)
  }

  function hideTooltip() {
    if (!tooltip) return
    tooltip.hidden = true
    tooltip.innerHTML = ''
    canvas.setAttribute('aria-describedby', 'map-keyboard-help')
  }

  function findNodeAt(x, y) {
    return [...renderedNodes]
      .reverse()
      .find((node) => (
        (node.kind !== 'asset' || !selectableAssetIds || selectableAssetIds.has(node.asset.id))
        && Math.hypot(node.x - x, node.y - y) <= node.hitRadius
      ))
  }

  function findEdgeAt(x, y) {
    return renderedEdges.find((edge) =>
      distanceToSegment({ x, y }, edge.start, edge.end) <= edge.hitWidth / 2,
    )
  }

  function eventToCanvasPoint(event) {
    return pointerToCanvasCssPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: canvas.getBoundingClientRect(),
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
    })
  }

  canvas.addEventListener('pointerdown', (event) => {
    const point = eventToCanvasPoint(event)
    dragging = true
    dragDistance = 0
    dragStart = {
      point,
      lastPoint: point,
      pan: { ...pan },
    }
    canvas.setPointerCapture(event.pointerId)
    if (!keyboardFocusAssetId) hideTooltip()
  })

  canvas.addEventListener('pointermove', (event) => {
    const point = eventToCanvasPoint(event)
    const { x, y } = point

    if (dragging) {
      const moved = Math.hypot(
        point.x - dragStart.lastPoint.x,
        point.y - dragStart.lastPoint.y,
      )
      dragDistance += moved
      dragStart.lastPoint = point
      if (moved > 1) {
        viewTransformStable = false
        pan = {
          x: dragStart.pan.x + point.x - dragStart.point.x,
          y: dragStart.pan.y + point.y - dragStart.point.y,
        }
        hideTooltip()
        scheduleDraw()
      }
      return
    }

    const node = findNodeAt(x, y)
    const edge = node ? null : findEdgeAt(x, y)
    const nextHoveredAssetId = node?.kind === 'asset' ? node.asset.id : null
    const nextHoveredNetworkId = edge?.networkId || null
    const hoverChanged = nextHoveredAssetId !== hoveredAssetId
      || nextHoveredNetworkId !== hoveredEdgeNetworkId
    hoveredAssetId = nextHoveredAssetId
    hoveredEdgeNetworkId = nextHoveredNetworkId
    canvas.classList.toggle('is-interactive-target', Boolean(node || edge))

    if (node) showTooltip(node)
    else if (!keyboardFocusAssetId) hideTooltip()
    if (hoverChanged) scheduleDraw()
  })

  canvas.addEventListener('pointerleave', () => {
    if (dragging) return
    hoveredAssetId = null
    hoveredEdgeNetworkId = null
    canvas.classList.remove('is-interactive-target')
    if (!keyboardFocusAssetId) hideTooltip()
    scheduleDraw()
  })

  canvas.addEventListener('pointerup', (event) => {
    dragging = false
    const { x, y } = eventToCanvasPoint(event)
    if (dragDistance >= 5) {
      scheduleViewportChange()
      return
    }

    const node = findNodeAt(x, y)
    if (node) {
      if (node.kind === 'cluster') {
        expandCluster(node)
        return
      }
      onSelectAsset(node.asset.id)
      return
    }
    const edge = findEdgeAt(x, y)
    if (edge) onSelectNetwork(edge.networkId)
  })

  canvas.addEventListener('pointercancel', () => {
    const moved = dragDistance >= 1
    dragging = false
    dragStart = null
    if (moved) scheduleViewportChange()
  })

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    const point = eventToCanvasPoint(event)
    setZoomAroundPoint(zoom * Math.exp(-event.deltaY * .0012), point)
  }, { passive: false })

  canvas.addEventListener('keydown', (event) => {
    const navigationKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
    if (navigationKeys.includes(event.key)) {
      event.preventDefault()
      const keyboardNodes = renderedNodes.filter((node) => (
        node.kind === 'asset'
        && (!selectableAssetIds || selectableAssetIds.has(node.asset.id))
      ))
      if (!keyboardNodes.length) return
      const currentIndex = keyboardNodes.findIndex((node) => (
        node.asset.id === keyboardFocusAssetId
      ))
      let nextIndex = currentIndex < 0 ? 0 : currentIndex
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % keyboardNodes.length
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = currentIndex < 0
          ? keyboardNodes.length - 1
          : (currentIndex - 1 + keyboardNodes.length) % keyboardNodes.length
      } else if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = keyboardNodes.length - 1
      }
      keyboardFocusAssetId = keyboardNodes[nextIndex].asset.id
      draw()
      showTooltip(renderedNodes.find((node) => (
        node.kind === 'asset' && node.asset.id === keyboardFocusAssetId
      )))
      return
    }

    if ((event.key === 'Enter' || event.key === ' ') && keyboardFocusAssetId) {
      event.preventDefault()
      onSelectAsset(keyboardFocusAssetId)
    } else if (event.key === 'Escape') {
      keyboardFocusAssetId = null
      hideTooltip()
      draw()
    }
  })

  canvas.addEventListener('blur', () => {
    keyboardFocusAssetId = null
    if (!hoveredAssetId) hideTooltip()
    draw()
  })

  function expandCluster(cluster) {
    const centerX = cluster.assets.reduce((sum, asset) => sum + asset.x, 0) / cluster.assets.length
    const centerY = cluster.assets.reduce((sum, asset) => sum + asset.y, 0) / cluster.assets.length
    const targetZoom = getMapZoomTier(zoom) === 'low' ? 1.18 : 1.72
    zoom = clampMapZoom(Math.max(zoom, targetZoom))
    pan = {
      x: -(centerX * canvas.clientWidth - canvas.clientWidth / 2) * zoom,
      y: -(centerY * canvas.clientHeight - canvas.clientHeight / 2) * zoom,
    }
    hideTooltip()
    scheduleDraw()
    scheduleViewportChange()
  }

  function setZoomAroundPoint(nextZoom, point) {
    const clampedZoom = clampMapZoom(nextZoom)
    if (Math.abs(clampedZoom - zoom) < .001) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const mapX = (point.x - width / 2 - pan.x) / zoom + width / 2
    const mapY = (point.y - height / 2 - pan.y) / zoom + height / 2
    pan = {
      x: point.x - width / 2 - (mapX - width / 2) * clampedZoom,
      y: point.y - height / 2 - (mapY - height / 2) * clampedZoom,
    }
    zoom = clampedZoom
    hideTooltip()
    scheduleDraw()
    scheduleViewportChange()
  }

  function setZoomAroundCenter(nextZoom) {
    setZoomAroundPoint(nextZoom, {
      x: canvas.clientWidth / 2,
      y: canvas.clientHeight / 2,
    })
  }

  function getViewportBounds() {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const unproject = (screenX, screenY) => ({
      x: ((screenX - width / 2 - pan.x) / zoom + width / 2) / width,
      y: ((screenY - height / 2 - pan.y) / zoom + height / 2) / height,
    })
    const topLeft = unproject(0, 0)
    const bottomRight = unproject(width, height)
    return {
      minX: Math.min(topLeft.x, bottomRight.x),
      maxX: Math.max(topLeft.x, bottomRight.x),
      minY: Math.min(topLeft.y, bottomRight.y),
      maxY: Math.max(topLeft.y, bottomRight.y),
    }
  }

  function getGeographicViewportBounds() {
    return screenViewportToGeographicBounds({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      zoom,
      pan,
      dataBounds: geographicDataBounds,
    })
  }

  function getVisibleAssetIds() {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const emphasizedNetworkId = hoveredEdgeNetworkId || highlightedNetworkId
    return assets
      .filter((asset) => asset.hasPointGeometry)
      .filter((asset) => {
        const assetNetworks = networksByAssetId.get(asset.id) || []
        return !dimOthers
          || assetNetworks.some(({ id }) => selectedNetworkIds.has(id))
          || assetNetworks.some(({ id }) => id === emphasizedNetworkId)
          || traceNodeIds.includes(asset.id)
          || connectedNodeIds.includes(asset.id)
      })
      .filter((asset) => {
        const point = mapPoint(asset, width, height)
        return point.x >= 0 && point.x <= width
          && point.y >= 0 && point.y <= height
      })
      .map(({ id }) => id)
      .sort()
  }

  function getVisibleGeometryIds() {
    const bounds = getGeographicViewportBounds()
    if (!bounds) return [...renderedGeometryIds].sort()
    const emphasizedNetworkId = hoveredEdgeNetworkId || highlightedNetworkId
    const ids = geometries
      .filter((geometry) => {
        const networkIds = networkIdsByGeometryId.get(geometry.id) || []
        return !dimOthers
          || networkIds.some((id) => selectedNetworkIds.has(id))
          || networkIds.includes(emphasizedNetworkId)
          || renderedGeometryIds.has(geometry.id)
      })
      .filter((geometry) => (
        geometryIntersectsGeographicBounds(geometry.coordinates, bounds)
      ))
      .map(({ id }) => id)
    return [...new Set(ids)].sort()
  }

  function subscribeViewportChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Viewport subscriber harus berupa function.')
    }
    return viewportSubscriptions.subscribe(callback)
  }

  function focusNetworkBounds(networkId) {
    const network = networks.find((item) => item.id === networkId)
    if (network?.displayBounds) {
      focusDisplayBounds(network.displayBounds)
      return
    }
    focusAssetBounds(network?.nodeIds || [])
  }

  function focusDisplayBounds({ minX, maxX, minY, maxY }) {
    if (![minX, maxX, minY, maxY].every(Number.isFinite)) return
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const rangeX = Math.max(maxX - minX, .08)
    const rangeY = Math.max(maxY - minY, .08)
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    zoom = clampMapZoom(Math.min(.72 / rangeX, .72 / rangeY))
    pan = {
      x: -(centerX * width - width / 2) * zoom,
      y: -(centerY * height - height / 2) * zoom,
    }
    scheduleDraw()
    scheduleViewportChange()
  }

  function focusAssetBounds(assetIds) {
    const focusedAssets = assetIds
      .map((assetId) => assetById.get(assetId))
      .filter((asset) => asset?.renderable)
    if (!focusedAssets.length) return

    const xs = focusedAssets.map((asset) => asset.x)
    const ys = focusedAssets.map((asset) => asset.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const rangeX = Math.max(maxX - minX, .08)
    const rangeY = Math.max(maxY - minY, .08)
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    zoom = clampMapZoom(Math.min(.72 / rangeX, .72 / rangeY))
    pan = {
      x: -(centerX * width - width / 2) * zoom,
      y: -(centerY * height - height / 2) * zoom,
    }
    scheduleDraw()
    scheduleViewportChange()
  }

  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(resize)
    : null
  observer?.observe(canvas)
  window.addEventListener('resize', resize)
  resize()

  return {
    invalidateSize() {
      resize()
    },
    setState(next) {
      if (next.selectedNetworkIds) selectedNetworkIds = new Set(next.selectedNetworkIds)
      if ('selectedAssetId' in next) selectedAssetId = next.selectedAssetId
      if (next.traceNodeIds) traceNodeIds = next.traceNodeIds
      if (next.connectedNodeIds) connectedNodeIds = next.connectedNodeIds
      if ('selectableAssetIds' in next) {
        selectableAssetIds = next.selectableAssetIds
          ? new Set(next.selectableAssetIds)
          : null
      }
      if ('dimOthers' in next) dimOthers = next.dimOthers
      scheduleDraw()
    },
    setHighlightedNetworkId(networkId) {
      highlightedNetworkId = networks.some((network) => network.id === networkId) ? networkId : null
      scheduleDraw()
    },
    focusNetworkBounds,
    focusAssetBounds,
    getViewportBounds,
    getGeographicViewportBounds,
    getVisibleAssetIds,
    getVisibleGeometryIds,
    subscribeViewportChange,
    zoomIn() {
      setZoomAroundCenter(zoom * 1.22)
    },
    zoomOut() {
      setZoomAroundCenter(zoom / 1.22)
    },
    reset() {
      zoom = 1
      pan = { x: 0, y: 0 }
      scheduleDraw()
      scheduleViewportChange()
    },
    destroy() {
      drawScheduler.cancel()
      window.clearTimeout(viewportChangeTimer)
      observer?.disconnect()
      viewportSubscriptions.clear()
      window.removeEventListener('resize', resize)
    },
  }
}

function collectGeographicBounds(geometries) {
  const coordinates = geometries.flatMap((geometry) => (
    flattenGeographicCoordinates(geometry.coordinates)
  )).filter(([longitude, latitude]) => (
    Number.isFinite(longitude) && Number.isFinite(latitude)
  ))
  if (!coordinates.length) return null
  return {
    west: Math.min(...coordinates.map(([longitude]) => longitude)),
    east: Math.max(...coordinates.map(([longitude]) => longitude)),
    south: Math.min(...coordinates.map(([, latitude]) => latitude)),
    north: Math.max(...coordinates.map(([, latitude]) => latitude)),
  }
}

function flattenGeographicCoordinates(value) {
  if (!Array.isArray(value)) return []
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    return [[Number(value[0]), Number(value[1])]]
  }
  return value.flatMap(flattenGeographicCoordinates)
}

function getNetworkLineStyle(network) {
  if (network.lineRole === 'fiber-backbone') {
    return { role: 'backbone', width: 6, dash: [] }
  }
  if (network.lineRole === 'fiber-distribution') {
    return { role: 'distribution', width: 4.5, dash: [] }
  }
  if (network.lineRole === 'cctv-cable') {
    return { role: 'distribution', width: 4, dash: [] }
  }
  if (network.lineRole === 'lan') return { role: 'minor', width: 2.5, dash: [9, 7] }
  return { role: 'standard', width: 3, dash: [] }
}

function lineDetailAlpha(role, tier) {
  if (tier !== 'low') return 1
  if (role === 'backbone') return 1
  if (role === 'distribution') return .42
  if (role === 'standard') return .34
  return .2
}

function screenPathIntersectsViewport(points, width, height) {
  if (!points.length) return false
  if (points.some(({ x, y }) => (
    x >= 0 && x <= width && y >= 0 && y <= height
  ))) return true
  const minX = Math.min(...points.map(({ x }) => x))
  const maxX = Math.max(...points.map(({ x }) => x))
  const minY = Math.min(...points.map(({ y }) => y))
  const maxY = Math.max(...points.map(({ y }) => y))
  return maxX >= 0 && minX <= width && maxY >= 0 && minY <= height
}

function distanceToSegment(point, start, end) {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y))
      / lengthSquared,
  ))
  const x = start.x + projection * (end.x - start.x)
  const y = start.y + projection * (end.y - start.y)
  return Math.hypot(point.x - x, point.y - y)
}

function rectanglesOverlap(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
