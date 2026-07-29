const VIEW_WIDTH = 1200
const VIEW_HEIGHT = 760

export function createFlatNetworkMap(element, {
  assets = [],
  diagramAssets = assets,
  networks = [],
  geometries = [],
  candidates = [],
  onSelectAsset = () => {},
  onSelectNetwork = () => {},
  onSelectCandidate = () => {},
} = {}) {
  const featureById = new Map(diagramAssets.map((asset) => [asset.id, asset]))
  const geometryById = new Map(geometries.map((geometry) => [geometry.id, geometry]))
  const networkByGeometryId = new Map()
  networks.forEach((network) => {
    network.geometryIds?.forEach((geometryId) => {
      networkByGeometryId.set(geometryId, network)
    })
  })
  const projection = createProjection(geometries)
  let state = {
    selectedNetworkIds: new Set(networks.map(({ id }) => id)),
    selectedAssetId: null,
    traceNodeIds: [],
    connectedNodeIds: [],
    dimOthers: true,
    highlightedNetworkId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
  }
  let dragging = false
  let dragOrigin = null

  function render() {
    element.innerHTML = renderFlatNetworkSvg({
      assets,
      diagramAssets,
      networks,
      geometries,
      candidates,
      state,
      projection,
      networkByGeometryId,
      featureById,
    })
  }

  element.addEventListener('click', (event) => {
    const assetTarget = event.target.closest('[data-flat-asset]')
    if (assetTarget) {
      onSelectAsset(assetTarget.dataset.flatAsset)
      return
    }
    const candidateTarget = event.target.closest('[data-flat-candidate]')
    if (candidateTarget) {
      onSelectCandidate(candidateTarget.dataset.flatCandidate)
      return
    }
    const networkTarget = event.target.closest('[data-flat-network]')
    if (networkTarget) onSelectNetwork(networkTarget.dataset.flatNetwork)
  })
  element.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-flat-asset], [data-flat-network], [data-flat-candidate]')) return
    dragging = true
    dragOrigin = { x: event.clientX - state.panX, y: event.clientY - state.panY }
    element.setPointerCapture(event.pointerId)
  })
  element.addEventListener('pointermove', (event) => {
    if (!dragging) return
    state.panX = event.clientX - dragOrigin.x
    state.panY = event.clientY - dragOrigin.y
    applyTransform()
  })
  element.addEventListener('pointerup', () => {
    dragging = false
    dragOrigin = null
  })
  element.addEventListener('wheel', (event) => {
    event.preventDefault()
    state.zoom = clamp(state.zoom + (event.deltaY < 0 ? .12 : -.12), .65, 4)
    applyTransform()
  }, { passive: false })

  function applyTransform() {
    const viewport = element.querySelector('.flat-network-viewport')
    if (viewport) {
      viewport.setAttribute(
        'transform',
        `translate(${state.panX} ${state.panY}) scale(${state.zoom})`,
      )
    }
    element.querySelector('.flat-zoom-readout')?.replaceChildren(
      document.createTextNode(`${Math.round(state.zoom * 100)}%`),
    )
  }

  function focusDisplayBounds(bounds) {
    if (!bounds) return
    const rangeX = Math.max(bounds.maxX - bounds.minX, .05)
    const rangeY = Math.max(bounds.maxY - bounds.minY, .05)
    state.zoom = clamp(Math.min(.78 / rangeX, .78 / rangeY), .8, 4)
    const centerX = ((bounds.minX + bounds.maxX) / 2) * VIEW_WIDTH
    const centerY = ((bounds.minY + bounds.maxY) / 2) * VIEW_HEIGHT
    state.panX = VIEW_WIDTH / 2 - centerX * state.zoom
    state.panY = VIEW_HEIGHT / 2 - centerY * state.zoom
    applyTransform()
  }

  render()

  return {
    invalidateSize() {},
    setState(next) {
      state = {
        ...state,
        ...next,
        selectedNetworkIds: next.selectedNetworkIds
          ? new Set(next.selectedNetworkIds)
          : state.selectedNetworkIds,
      }
      render()
    },
    setHighlightedNetworkId(networkId) {
      state.highlightedNetworkId = networks.some(({ id }) => id === networkId)
        ? networkId
        : null
      render()
    },
    focusNetworkBounds(networkId) {
      const network = networks.find(({ id }) => id === networkId)
      focusDisplayBounds(network?.displayBounds)
    },
    focusAssetBounds(assetIds) {
      const selected = assetIds.map((id) => featureById.get(id)).filter(Boolean)
      if (!selected.length) return
      focusDisplayBounds({
        minX: Math.min(...selected.map(({ x }) => x)),
        maxX: Math.max(...selected.map(({ x }) => x)),
        minY: Math.min(...selected.map(({ y }) => y)),
        maxY: Math.max(...selected.map(({ y }) => y)),
      })
    },
    zoomIn() {
      state.zoom = clamp(state.zoom + .2, .65, 4)
      applyTransform()
    },
    zoomOut() {
      state.zoom = clamp(state.zoom - .2, .65, 4)
      applyTransform()
    },
    reset() {
      state.zoom = 1
      state.panX = 0
      state.panY = 0
      applyTransform()
    },
    destroy() {
      element.replaceChildren()
    },
  }
}

export function renderFlatNetworkSvg({
  assets,
  diagramAssets,
  networks,
  geometries,
  candidates,
  state,
  projection = createProjection(geometries),
  networkByGeometryId = createNetworkGeometryIndex(networks),
  featureById = new Map(diagramAssets.map((asset) => [asset.id, asset])),
}) {
  const traceIds = new Set(state.traceNodeIds)
  const connectedIds = new Set(state.connectedNodeIds)
  const lineGeometries = geometries.filter(({ geometryType }) => geometryType === 'line_string')
  const pointAssets = assets.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))
  return `
    <svg class="flat-network-svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}"
      role="img" aria-label="Peta jaringan aset 2D">
      <defs>
        <pattern id="flat-network-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#26374a" stroke-width="1"/>
        </pattern>
        <filter id="flat-node-glow">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" fill="#101b29"/>
      <rect width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" fill="url(#flat-network-grid)"/>
      <g class="flat-network-viewport"
        transform="translate(${state.panX} ${state.panY}) scale(${state.zoom})">
        <g class="flat-network-cables">
          ${lineGeometries.map((geometry) => {
            const network = networkByGeometryId.get(geometry.id)
            const active = !network || state.selectedNetworkIds.has(network.id)
            const highlighted = network?.id === state.highlightedNetworkId
            const owner = featureById.get(geometry.assetId)
            const points = (geometry.displayCoordinates ?? [])
              .filter(isDisplayPosition)
              .map(({ x, y }) => `${x * VIEW_WIDTH},${y * VIEW_HEIGHT}`)
              .join(' ')
            if (!points) return ''
            const opacity = highlighted ? 1 : active ? .92 : state.dimOthers ? .12 : 0
            const color = network?.color || '#5bb7ff'
            return `
              <g data-flat-network="${escapeAttribute(network?.id || '')}" class="flat-cable">
                <title>${escapeXml(owner?.name || network?.name || 'Jalur kabel')} · ${escapeXml(network?.type || geometry.category || 'Kabel')}</title>
                <polyline points="${points}" fill="none" stroke="#07101b" stroke-width="7"
                  stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>
                <polyline points="${points}" fill="none" stroke="${color}" stroke-width="${highlighted ? 4.5 : 3}"
                  stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>
              </g>
            `
          }).join('')}
        </g>
        <g class="flat-network-candidates">
          ${candidates.map((candidate) => {
            const source = projection(candidate.sourceCoordinate)
            const target = projection(candidate.targetCoordinate)
            if (!source || !target) return ''
            const ambiguous = candidate.candidateStatus === 'ambiguous'
            return `
              <line data-flat-candidate="${escapeAttribute(candidate.candidateId)}"
                x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"
                stroke="${ambiguous ? '#f59e0b' : '#facc15'}" stroke-width="2"
                stroke-dasharray="6 5" opacity=".9">
                <title>${ambiguous ? 'Koneksi ambigu' : 'Kandidat koneksi'} · ${Math.round((candidate.score || 0) * 100)}%</title>
              </line>
            `
          }).join('')}
        </g>
        <g class="flat-network-assets">
          ${pointAssets.map((asset) => {
            const active = !asset.networkIds?.length
              || asset.networkIds.some((id) => state.selectedNetworkIds.has(id))
            const selected = asset.id === state.selectedAssetId
            const traced = traceIds.has(asset.id)
            const connected = connectedIds.has(asset.id)
            const opacity = selected || traced || connected ? 1 : active ? 1 : state.dimOthers ? .14 : 0
            const color = assetColor(asset, networks)
            const x = asset.x * VIEW_WIDTH
            const y = asset.y * VIEW_HEIGHT
            return `
              <g class="flat-asset ${selected ? 'selected' : ''}"
                data-flat-asset="${escapeAttribute(asset.id)}" opacity="${opacity}">
                <title>${escapeXml(asset.name)} · ${escapeXml(asset.type)} · ${escapeXml(asset.id)}</title>
                ${selected || traced ? `<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="#fff" stroke-width="2" filter="url(#flat-node-glow)"/>` : ''}
                <circle cx="${x}" cy="${y}" r="${selected ? 8 : 6}" fill="${color}"
                  stroke="#f8fafc" stroke-width="2"/>
                <text x="${x + 9}" y="${y - 8}" class="flat-asset-label">${escapeXml(shortLabel(asset.name))}</text>
              </g>
            `
          }).join('')}
        </g>
      </g>
      <g class="flat-map-status">
        <rect x="18" y="18" width="176" height="34" rx="8" fill="#172638" stroke="#31465d"/>
        <text x="34" y="40" fill="#d8e4ef" font-size="12" font-weight="700">Network map 2D</text>
        <text class="flat-zoom-readout" x="176" y="40" fill="#8fa6bb" text-anchor="end" font-size="11">${Math.round(state.zoom * 100)}%</text>
      </g>
    </svg>
  `
}

function createProjection(geometries) {
  const positions = geometries.flatMap(extractPositions)
  const west = Math.min(...positions.map(([longitude]) => longitude))
  const east = Math.max(...positions.map(([longitude]) => longitude))
  const south = Math.min(...positions.map(([, latitude]) => latitude))
  const north = Math.max(...positions.map(([, latitude]) => latitude))
  return (position) => {
    if (!isGeoPosition(position)) return null
    return {
      x: (.08 + ((position[0] - west) / Math.max(east - west, .000001)) * .84) * VIEW_WIDTH,
      y: (.08 + ((north - position[1]) / Math.max(north - south, .000001)) * .84) * VIEW_HEIGHT,
    }
  }
}

function createNetworkGeometryIndex(networks) {
  const index = new Map()
  networks.forEach((network) => network.geometryIds?.forEach((id) => index.set(id, network)))
  return index
}

function extractPositions(geometry) {
  if (geometry.geometryType === 'point') return [geometry.coordinates].filter(isGeoPosition)
  if (geometry.geometryType === 'line_string') return (geometry.coordinates ?? []).filter(isGeoPosition)
  if (geometry.geometryType === 'polygon') return (geometry.coordinates ?? []).flat().filter(isGeoPosition)
  return []
}

function isGeoPosition(position) {
  return Array.isArray(position) && Number.isFinite(Number(position[0]))
    && Number.isFinite(Number(position[1]))
}

function isDisplayPosition(position) {
  return Number.isFinite(position?.x) && Number.isFinite(position?.y)
}

function assetColor(asset, networks) {
  return networks.find(({ id }) => asset.networkIds?.includes(id))?.color || '#5bb7ff'
}

function shortLabel(value = '') {
  return value.length > 22 ? `${value.slice(0, 20)}…` : value
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function escapeAttribute(value) {
  return escapeXml(value)
}
