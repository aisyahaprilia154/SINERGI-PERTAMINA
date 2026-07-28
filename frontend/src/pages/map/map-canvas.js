const nodeGlyph = {
  CCTV: 'C',
  OTB: 'O',
  Server: 'S',
  NVR: 'N',
  'Junction box': 'J',
  'Core switch': '↔',
  'Distribution switch': '↔',
  'Access switch': '↔',
  'Access point': '⌁',
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
  let dimOthers = true
  let zoom = 1
  let pan = { x: 0, y: 0 }
  let renderedNodes = []
  let renderedEdges = []
  let dragging = false
  let dragStart = null
  let dragDistance = 0
  const geometryById = new Map(geometries.map((geometry) => [geometry.id, geometry]))

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    draw()
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

    const emphasizedNetworkId = hoveredEdgeNetworkId || highlightedNetworkId
    const hasEmphasizedNetwork = Boolean(emphasizedNetworkId)
    const tracingActive = traceNodeIds.length > 0
    const traceEdges = new Set(
      traceNodeIds.slice(1).map((id, index) => [traceNodeIds[index], id].sort().join('|')),
    )

    const networkStates = networks.map((network) => {
      const active = selectedNetworkIds.has(network.id)
      const emphasized = network.id === emphasizedNetworkId
      const hasTraceEdge = network.edges.some(([fromId, toId]) =>
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
      }))
    if (tracingActive) drawTraceRelations(networkStates, traceEdges, width, height)

    const visibleAssetIds = new Set(
      networks
        .filter((network) =>
          selectedNetworkIds.has(network.id) || network.id === emphasizedNetworkId || !dimOthers,
        )
        .flatMap((network) => network.nodeIds),
    )
    traceNodeIds.forEach((assetId) => visibleAssetIds.add(assetId))
    connectedNodeIds.forEach((assetId) => visibleAssetIds.add(assetId))

    assets.forEach((asset) => {
      if (!visibleAssetIds.has(asset.id) || !asset.hasPointGeometry) return
      const matchingNetworks = networks.filter((network) => network.nodeIds.includes(asset.id))
      const activeNetworks = matchingNetworks.filter((network) => selectedNetworkIds.has(network.id))
      const emphasizedNetworks = matchingNetworks.filter((network) => network.id === emphasizedNetworkId)
      const primaryNetwork = emphasizedNetworks[0] || activeNetworks[0] || matchingNetworks[0]
      if (!primaryNetwork) return

      const point = mapPoint(asset, width, height)
      const isSelected = asset.id === selectedAssetId
      const isTraceNode = traceNodeIds.includes(asset.id)
      const isConnected = connectedNodeIds.includes(asset.id) || isTraceNode
      const isKeyboardFocused = asset.id === keyboardFocusAssetId
      const muted = activeNetworks.length === 0 && emphasizedNetworks.length === 0 && !isConnected
      const baseRadius = connectorTypes.has(asset.type) ? 12 : 10
      const radius = isSelected || isKeyboardFocused ? baseRadius + 2 : baseRadius
      const nodeAlpha = muted
        ? .22
        : tracingActive && !isTraceNode && !isSelected
          ? .18
        : hasEmphasizedNetwork && emphasizedNetworks.length === 0 && !isConnected
          ? .3
          : 1

      context.save()
      context.globalAlpha = nodeAlpha
      if (isConnected) {
        drawOuterRing(point, radius + 5, colors.surface, 5)
        drawOuterRing(point, radius + 5, colors.primary, 1.5)
      }
      if (isSelected || isKeyboardFocused) drawOuterRing(point, radius + 5, colors.primarySoft, 5)

      const fillColor = isSelected ? colors.primary : colors.surface
      const strokeColor = isSelected ? colors.primary : isConnected ? colors.primary : primaryNetwork.color
      drawNodeShape(asset.type, point, radius, fillColor, strokeColor, isSelected ? 3 : 2.5)

      context.fillStyle = isSelected ? colors.surface : strokeColor
      context.font = `700 ${connectorTypes.has(asset.type) ? 11 : 10}px Inter, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(nodeGlyph[asset.type] || '•', point.x, point.y + .5)
      drawStatusBadge(asset, point, radius)
      context.restore()

      renderedNodes.push({
        ...point,
        asset,
        hitRadius: Math.max(17, radius + 5),
        active: activeNetworks.length > 0,
        connected: isTraceNode,
        important: connectorTypes.has(asset.type) || asset.type === 'Server',
      })
    })

    drawLabels(width, height)
    context.textAlign = 'start'
    context.textBaseline = 'alphabetic'
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
        ? assets.find((item) => item.id === geometry.assetId)
        : null
      const isCctvView = `${owner?.name || ''} ${owner?.type || ''} ${geometry.category || ''}`
        .toLowerCase().includes('view')
        || `${owner?.name || ''} ${owner?.type || ''}`.toLowerCase().includes('pandang')
      for (const rings of displayGeometryParts([geometry], 'polygon')) {
        if (!rings.length) continue
        context.save()
        context.beginPath()
        rings.forEach((ring) => {
          const points = simplifyDisplayPoints(ring)
          points.forEach((displayPoint, index) => {
            const point = mapPoint(displayPoint, width, height)
            if (index) context.lineTo(point.x, point.y)
            else context.moveTo(point.x, point.y)
          })
          context.closePath()
        })
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
  }) {
    const lineStyle = getNetworkLineStyle(network)
    const alpha = emphasized
      ? 1
      : tracingActive && !hasTraceEdge
        ? .12
        : hasEmphasizedNetwork
          ? (active ? .25 : .08)
          : active
            ? 1
            : .14
    const lineWidth = emphasized
      ? lineStyle.width + 2
      : active
        ? lineStyle.width
        : Math.max(1.2, lineStyle.width - 1)

    for (const geometry of geometriesForNetwork(network)) {
      for (const line of displayGeometryParts([geometry], 'line_string')) {
        const points = simplifyDisplayPoints(line).map((point) => mapPoint(point, width, height))
        if (points.length < 2) continue
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

  function drawTraceRelations(networkStates, traceEdges, width, height) {
    const drawn = new Set()
    networkStates.forEach(({ network }) => {
      network.edges.forEach(([fromId, toId]) => {
        const key = [fromId, toId].sort().join('|')
        if (!traceEdges.has(key) || drawn.has(key)) return
        const from = assets.find((asset) => asset.id === fromId)
        const to = assets.find((asset) => asset.id === toId)
        if (!from?.renderable || !to?.renderable) return
        drawn.add(key)
        const start = mapPoint(from, width, height)
        const end = mapPoint(to, width, height)
        context.save()
        context.lineCap = 'round'
        context.setLineDash([5, 5])
        strokeCanvasPath([start, end], colors.surface, 7)
        strokeCanvasPath([start, end], colors.primary, 3)
        context.restore()
        renderedEdges.push({
          start,
          end,
          networkId: network.id,
          hitWidth: 13,
        })
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
    if (network.geometryIds?.length) {
      return network.geometryIds.map((id) => geometryById.get(id)).filter(Boolean)
    }
    return (network.geometryAssetIds ?? [])
      .flatMap((assetId) => assets.find((asset) => asset.id === assetId)?.geometry ?? [])
  }

  function simplifyDisplayPoints(points) {
    if (zoom >= 1.05 || points.length <= 120) return points
    const step = Math.ceil(points.length / 120)
    const simplified = points.filter((_, index) => index % step === 0)
    const last = points.at(-1)
    if (simplified.at(-1) !== last) simplified.push(last)
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
    const occupied = []
    const candidates = renderedNodes
      .filter((node) => {
        const focused = node.asset.id === selectedAssetId
          || node.asset.id === hoveredAssetId
          || node.asset.id === keyboardFocusAssetId
        if (focused) return true
        if (traceNodeIds.length && !node.connected) return false
        if (node.important && node.active && zoom >= 1) return true
        return node.active && zoom >= 1.4
      })
      .sort((a, b) => labelPriority(b) - labelPriority(a))

    candidates.forEach((node) => {
      context.font = `${node.asset.id === selectedAssetId ? 700 : 600} 11px Inter, sans-serif`
      const focused = node.asset.id === selectedAssetId
        || node.asset.id === hoveredAssetId
        || node.asset.id === keyboardFocusAssetId
      const label = focused ? node.asset.id : node.asset.name
      const textWidth = context.measureText(label).width
      const rect = {
        x: Math.max(4, Math.min(width - textWidth - 16, node.x - textWidth / 2 - 8)),
        y: Math.max(4, Math.min(height - 24, node.y + 18)),
        width: textWidth + 16,
        height: 22,
      }
      if (occupied.some((item) => rectanglesOverlap(item, rect))) return
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
    if (node.asset.id === selectedAssetId) return 4
    if (node.asset.id === hoveredAssetId || node.asset.id === keyboardFocusAssetId) return 3
    if (node.important) return 2
    return 1
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
    const warning = status && ![
      'status tidak tersedia',
      'tidak tersedia',
      'unknown',
      'n/a',
      '-',
    ].includes(status)
    if (!online && !warning) return
    const x = point.x + radius - 1
    const y = point.y - radius + 1
    context.beginPath()
    if (online) {
      context.arc(x, y, 4.5, 0, Math.PI * 2)
    } else {
      context.moveTo(x, y - 5)
      context.lineTo(x + 5, y + 4)
      context.lineTo(x - 5, y + 4)
      context.closePath()
    }
    context.fillStyle = online ? colors.success : colors.warning
    context.fill()
    context.strokeStyle = colors.surface
    context.lineWidth = 1.5
    context.stroke()
    context.beginPath()
    context.strokeStyle = colors.surface
    context.lineWidth = 1.3
    context.lineCap = 'round'
    if (online) {
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
    tooltip.innerHTML = `
      <strong>${escapeHtml(node.asset.id)}</strong>
      <span>${escapeHtml(node.asset.name)}</span>
      <small>${escapeHtml(node.asset.type)} · ${escapeHtml(node.asset.location)}</small>
    `
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
    return renderedNodes.find((node) => Math.hypot(node.x - x, node.y - y) <= node.hitRadius)
  }

  function findEdgeAt(x, y) {
    return renderedEdges.find((edge) =>
      distanceToSegment({ x, y }, edge.start, edge.end) <= edge.hitWidth / 2,
    )
  }

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true
    dragDistance = 0
    dragStart = { x: event.clientX - pan.x, y: event.clientY - pan.y }
    canvas.setPointerCapture(event.pointerId)
    if (!keyboardFocusAssetId) hideTooltip()
  })

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    if (dragging) {
      const moved = Math.abs(event.movementX) + Math.abs(event.movementY)
      dragDistance += moved
      if (moved > 1) {
        pan = { x: event.clientX - dragStart.x, y: event.clientY - dragStart.y }
        hideTooltip()
        draw()
      }
      return
    }

    const node = findNodeAt(x, y)
    const edge = node ? null : findEdgeAt(x, y)
    const nextHoveredAssetId = node?.asset.id || null
    const nextHoveredNetworkId = edge?.networkId || null
    const hoverChanged = nextHoveredAssetId !== hoveredAssetId
      || nextHoveredNetworkId !== hoveredEdgeNetworkId
    hoveredAssetId = nextHoveredAssetId
    hoveredEdgeNetworkId = nextHoveredNetworkId
    canvas.classList.toggle('is-interactive-target', Boolean(node || edge))

    if (node) showTooltip(node)
    else if (!keyboardFocusAssetId) hideTooltip()
    if (hoverChanged) draw()
  })

  canvas.addEventListener('pointerleave', () => {
    if (dragging) return
    hoveredAssetId = null
    hoveredEdgeNetworkId = null
    canvas.classList.remove('is-interactive-target')
    if (!keyboardFocusAssetId) hideTooltip()
    draw()
  })

  canvas.addEventListener('pointerup', (event) => {
    dragging = false
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (dragDistance >= 5) return

    const node = findNodeAt(x, y)
    if (node) {
      onSelectAsset(node.asset.id)
      return
    }
    const edge = findEdgeAt(x, y)
    if (edge) onSelectNetwork(edge.networkId)
  })

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    zoom = Math.max(.75, Math.min(1.8, zoom + (event.deltaY > 0 ? -.08 : .08)))
    draw()
  }, { passive: false })

  canvas.addEventListener('keydown', (event) => {
    const navigationKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
    if (navigationKeys.includes(event.key)) {
      event.preventDefault()
      if (!renderedNodes.length) return
      const currentIndex = renderedNodes.findIndex((node) => node.asset.id === keyboardFocusAssetId)
      let nextIndex = currentIndex < 0 ? 0 : currentIndex
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % renderedNodes.length
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = currentIndex < 0
          ? renderedNodes.length - 1
          : (currentIndex - 1 + renderedNodes.length) % renderedNodes.length
      } else if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = renderedNodes.length - 1
      }
      keyboardFocusAssetId = renderedNodes[nextIndex].asset.id
      draw()
      showTooltip(renderedNodes.find((node) => node.asset.id === keyboardFocusAssetId))
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

    zoom = Math.max(.75, Math.min(1.8, .72 / rangeX, .72 / rangeY))
    pan = {
      x: -(centerX * width - width / 2) * zoom,
      y: -(centerY * height - height / 2) * zoom,
    }
    draw()
  }

  function focusAssetBounds(assetIds) {
    const focusedAssets = assetIds
      .map((assetId) => assets.find((asset) => asset.id === assetId))
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

    zoom = Math.max(.75, Math.min(1.8, .72 / rangeX, .72 / rangeY))
    pan = {
      x: -(centerX * width - width / 2) * zoom,
      y: -(centerY * height - height / 2) * zoom,
    }
    draw()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(canvas)

  return {
    invalidateSize() {
      resize()
    },
    setState(next) {
      if (next.selectedNetworkIds) selectedNetworkIds = new Set(next.selectedNetworkIds)
      if ('selectedAssetId' in next) selectedAssetId = next.selectedAssetId
      if (next.traceNodeIds) traceNodeIds = next.traceNodeIds
      if (next.connectedNodeIds) connectedNodeIds = next.connectedNodeIds
      if ('dimOthers' in next) dimOthers = next.dimOthers
      draw()
    },
    setHighlightedNetworkId(networkId) {
      highlightedNetworkId = networks.some((network) => network.id === networkId) ? networkId : null
      draw()
    },
    focusNetworkBounds,
    focusAssetBounds,
    zoomIn() {
      zoom = Math.min(1.8, zoom + .15)
      draw()
    },
    zoomOut() {
      zoom = Math.max(.75, zoom - .15)
      draw()
    },
    reset() {
      zoom = 1
      pan = { x: 0, y: 0 }
      draw()
    },
    destroy() {
      observer.disconnect()
    },
  }
}

function getNetworkLineStyle(network) {
  if (network.lineRole === 'fiber-backbone') return { width: 6, dash: [] }
  if (network.lineRole === 'fiber-distribution') return { width: 4.5, dash: [] }
  if (network.lineRole === 'cctv-cable') return { width: 4, dash: [] }
  if (network.lineRole === 'lan') return { width: 2.5, dash: [9, 7] }
  return { width: 3, dash: [] }
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
