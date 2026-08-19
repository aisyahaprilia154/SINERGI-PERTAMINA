import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { groundOverlayCoordinates } from '../../domain/ground-overlay.js'
import { getDefaultMapToken } from '../../services/active-dataset-service.js'
import { buildAdaptiveAssetLayout } from './adaptive-asset-layout.js'
import {
  isCctvCoverageOverlay,
  shouldRenderCctvCoverageOverlay,
  shouldRenderMapGeometry,
} from './cctv-coverage.js'
import {
  BASEMAP_LOAD_TIMEOUT_MS,
  BASEMAP_RETRY_DELAYS_MS,
  basemapErrorMessage,
  createBaseStyle,
  isBasemapError,
  isBasemapLoadedEvent,
} from './maplibre-basemap.js'
import { assetPointRadiusExpression } from './maplibre-style-expressions.js'

setWorkerUrl(maplibreWorkerUrl)

const CATEGORY_COLORS = Object.freeze({
  CCTV: '#6f6de8',
  'CCTV cable': '#6f6de8',
  'Fiber optic': '#26a985',
  LAN: '#708196',
  Infrastructure: '#c58722',
  Peripheral: '#8a65d8',
  'Belum terpetakan': '#7b8794',
})

export function createMapLibreSurface(element, {
  assets = [],
  networks = [],
  geometries = [],
  topologyGraph = { edges: [] },
  candidates = [],
  overlays = [],
  onSelectAsset = () => {},
  onSelectNetwork = () => {},
  onSelectCandidate = () => {},
  onBasemapStatus = () => {},
  onLayoutStatus = () => {},
} = {}) {
  let currentCandidates = candidates
  let currentTopologyGraph = topologyGraph
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const geometryById = new Map(geometries.map((geometry) => [geometry.id, geometry]))
  const networkById = new Map(networks.map((network) => [network.id, network]))
  const networkByGeometryId = new Map()
  const assetNetworkIds = new Map()
  networks.forEach((network) => {
    network.geometryIds?.forEach((geometryId) => {
      networkByGeometryId.set(geometryId, network)
    })
    network.nodeIds.forEach((assetId) => {
      assetNetworkIds.set(assetId, [...(assetNetworkIds.get(assetId) ?? []), network.id])
    })
  })

  let state = {
    selectedNetworkIds: new Set(networks.filter(({ isDefaultVisible }) => isDefaultVisible)
      .map(({ id }) => id)),
    selectedAssetId: null,
    traceNodeIds: [],
    traceGeometryIds: [],
    connectedNodeIds: [],
    selectedCandidateId: null,
    dimOthers: true,
    isolateSelectedCandidate: false,
    highlightedNetworkId: null,
    focusedNetworkId: null,
    showCctvCoverage: true,
  }
  let loaded = false
  let destroyed = false
  let basemapStatus = 'loading'
  let basemapTimer = null
  let basemapRetryTimer = null
  let basemapRetryAttempt = 0
  let basemapLastError = ''
  let basemapHasLoadedTile = false
  let declutterEnabled = true
  let layoutFrame = null
  let layoutStatusSignature = ''
  let clusterLookup = new Map()
  let groundOverlayLayers = []
  const initialBounds = boundsForGeometries(geometries)
  // Vite injects an empty string when Docker passes an unset build arg. Treat
  // that the same as an omitted value so the same-origin proxy remains the
  // safe default instead of rendering only the neutral canvas.
  const imageryTiles = String(import.meta.env.VITE_SINERGI_BASEMAP_TILES ?? '').trim()
  const vectorTiles = String(
    import.meta.env.VITE_SINERGI_VECTOR_TILES_URL ?? '',
  ).trim() || '/api/basemap/openfreemap/planet'
  const basemapAttribution = String(import.meta.env.VITE_SINERGI_BASEMAP_ATTRIBUTION ?? '').trim()
  let basemapMode = vectorTiles ? 'street' : 'satellite'
  const loadedBasemapSourceIds = new Set()
  const map = new MapLibreMap({
    container: element,
    style: createBaseStyle({ imageryTiles, vectorTiles, attribution: basemapAttribution }),
    center: initialBounds
      ? [(initialBounds[0] + initialBounds[2]) / 2, (initialBounds[1] + initialBounds[3]) / 2]
      : [117, -2],
    zoom: initialBounds ? 14 : 3,
    minZoom: 1,
    maxZoom: 22,
    attributionControl: false,
    cooperativeGestures: false,
    scrollZoom: true,
    keyboard: true,
    touchZoomRotate: true,
    touchPitch: false,
    dragRotate: false,
    pitchWithRotate: true,
    transformRequest: (url) => (
      url.includes('/overlay-resources/')
        ? { url, headers: { Authorization: `Bearer ${getDefaultMapToken()}` } }
        : { url }
    ),
  })
  const markerOverlay = document.createElement('div')
  markerOverlay.className = 'map-adaptive-marker-layer'
  markerOverlay.setAttribute('aria-label', 'Aset KML dengan tata letak adaptif')
  element.append(markerOverlay)
  const selectedCandidateOverlay = document.createElement('div')
  selectedCandidateOverlay.className = 'map-selected-candidate-overlay'
  selectedCandidateOverlay.setAttribute('aria-live', 'polite')
  element.append(selectedCandidateOverlay)

  const enableCtrlPitch = (event) => {
    if (event?.ctrlKey || event?.key === 'Control') map.dragRotate.enable()
  }
  const disableCtrlPitch = (event) => {
    if (!event || event.key === 'Control' || !event.ctrlKey) map.dragRotate.disable()
  }
  const toggleCtrlPitchFromPointer = (event) => {
    if (event.ctrlKey) map.dragRotate.enable()
    else map.dragRotate.disable()
  }
  window.addEventListener('keydown', enableCtrlPitch)
  window.addEventListener('keyup', disableCtrlPitch)
  window.addEventListener('blur', disableCtrlPitch)
  element.addEventListener('pointerdown', toggleCtrlPitchFromPointer)

  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
  // Keep attribution permanently readable in its own bottom-left safe area.
  // The map stage reserves the opposite corner for the custom controls.
  map.addControl(new AttributionControl({ compact: false }), 'bottom-left')

  let basemapSourceId = vectorTiles
    ? 'openfreemap'
    : imageryTiles ? 'satellite-imagery' : null
  onBasemapStatus('loading', { retrying: false })
  armBasemapTimeout()

  function armBasemapTimeout() {
    if (basemapTimer !== null) window.clearTimeout(basemapTimer)
    basemapTimer = window.setTimeout(() => {
      setBasemapStatus('unavailable', {
        message: basemapLastError || 'Basemap melewati batas waktu pemuatan.',
      })
    }, BASEMAP_LOAD_TIMEOUT_MS)
  }

  function setBasemapStatus(status, details = {}) {
    if (destroyed) return
    const changed = status !== basemapStatus
    basemapStatus = status
    if (status !== 'loading' && basemapTimer !== null) {
      window.clearTimeout(basemapTimer)
      basemapTimer = null
    }
    if (changed || Object.keys(details).length) onBasemapStatus(status, details)
  }

  function clearBasemapRetry() {
    if (basemapRetryTimer !== null) {
      window.clearTimeout(basemapRetryTimer)
      basemapRetryTimer = null
    }
  }

  function scheduleBasemapRetry() {
    if (destroyed || basemapHasLoadedTile || basemapRetryTimer !== null) return
    const delay = BASEMAP_RETRY_DELAYS_MS[basemapRetryAttempt]
    if (delay === undefined) return
    basemapRetryAttempt += 1
    onBasemapStatus('loading', {
      retrying: true,
      attempt: basemapRetryAttempt,
      message: basemapLastError,
    })
    basemapRetryTimer = window.setTimeout(() => {
      basemapRetryTimer = null
      const source = map.getSource(basemapSourceId)
      try {
        armBasemapTimeout()
        if (basemapSourceId === 'satellite-imagery' && typeof source?.setTiles === 'function') {
          source.setTiles([imageryTiles])
        } else if (basemapSourceId === 'openfreemap' && typeof source?.setUrl === 'function') {
          source.setUrl(vectorTiles)
        }
      } catch (error) {
        basemapLastError = String(error?.message ?? basemapLastError)
        scheduleBasemapRetry()
      }
    }, delay)
  }

  map.on('error', (event) => {
    if (!isBasemapError(event)) return
    basemapLastError = basemapErrorMessage(event)
    if (!basemapHasLoadedTile) scheduleBasemapRetry()
  })
  map.on('sourcedata', (event) => {
    if (['openfreemap', 'satellite-imagery'].includes(event?.sourceId) && event?.tile) {
      loadedBasemapSourceIds.add(event.sourceId)
    }
    if (!isBasemapLoadedEvent(event, basemapSourceId)) return
    basemapHasLoadedTile = true
    basemapLastError = ''
    basemapRetryAttempt = 0
    clearBasemapRetry()
    setBasemapStatus('available')
  })
  if (!basemapSourceId) setBasemapStatus('unavailable')

  function initializeOperationalLayers() {
    if (destroyed || loaded) return
    loaded = true
    map.addSource('sinergi-polygons', emptyGeoJsonSource())
    map.addSource('sinergi-overlays', emptyGeoJsonSource())
    map.addSource('sinergi-lines', emptyGeoJsonSource())
    map.addSource('sinergi-focus-lines', emptyGeoJsonSource())
    map.addSource('sinergi-asset-relations', emptyGeoJsonSource())
    map.addSource('sinergi-candidates', emptyGeoJsonSource())
    map.addSource('sinergi-points', emptyGeoJsonSource())
    groundOverlayLayers = addGroundOverlayImages(map, overlays)
    syncGroundOverlayVisibility()
    syncSources()
    addOperationalLayers(map)
    syncAdaptiveMarkers()
    if (initialBounds) fitBounds(initialBounds)
  }

  // Local KML must not wait for remote basemap tiles or glyphs. MapLibre's
  // general `load` event waits for every required source; `style.load` fires
  // as soon as the local style is ready to accept operational sources/layers.
  map.on('style.load', initializeOperationalLayers)
  if (map.isStyleLoaded()) initializeOperationalLayers()

  map.on('click', 'asset-points-hit', (event) => {
    const assetId = event.features?.[0]?.properties?.assetId
    if (assetId) onSelectAsset(assetId)
  })
  map.on('click', 'cable-lines-hit', (event) => {
    const networkId = event.features?.[0]?.properties?.networkId
    if (networkId) onSelectNetwork(networkId)
  })
  map.on('click', 'candidate-connectors-hit', (event) => {
    const candidateId = event.features?.[0]?.properties?.candidateId
    if (candidateId) onSelectCandidate(candidateId)
  })
  for (const layerId of ['asset-points-hit', 'cable-lines-hit', 'candidate-connectors-hit']) {
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = ''
      hideFeatureTooltip()
    })
  }
  map.on('mousemove', 'asset-points-hit', (event) => showFeatureTooltip(event, 'asset'))
  map.on('mousemove', 'cable-lines-hit', (event) => showFeatureTooltip(event, 'cable'))
  map.on('mousemove', 'candidate-connectors-hit', (event) => (
    showFeatureTooltip(event, 'candidate')
  ))
  map.on('move', scheduleAdaptiveMarkers)
  map.on('zoom', scheduleAdaptiveMarkers)
  map.on('resize', scheduleAdaptiveMarkers)
  markerOverlay.addEventListener('click', (event) => {
    const assetButton = event.target.closest('[data-adaptive-asset]')
    if (assetButton) {
      event.stopPropagation()
      onSelectAsset(assetButton.dataset.adaptiveAsset)
      return
    }
    const clusterButton = event.target.closest('[data-adaptive-cluster]')
    if (!clusterButton) return
    event.stopPropagation()
    focusCluster(clusterLookup.get(clusterButton.dataset.adaptiveCluster))
  })

  renderAccessibleAssets(element, assets, onSelectAsset)

  function syncSources() {
    if (!loaded || destroyed) return
    const featureCollections = buildFeatureCollections({
      geometries,
      networks,
      assetById,
      assetNetworkIds,
      topologyGraph: currentTopologyGraph,
      candidates: currentCandidates,
      overlays,
      state,
    })
    map.getSource('sinergi-polygons').setData(featureCollections.polygons)
    map.getSource('sinergi-overlays').setData(featureCollections.overlays)
    map.getSource('sinergi-lines').setData(featureCollections.lines)
    map.getSource('sinergi-focus-lines').setData(featureCollections.focusLines)
    map.getSource('sinergi-asset-relations').setData(featureCollections.relations)
    map.getSource('sinergi-candidates').setData(featureCollections.candidates)
    map.getSource('sinergi-points').setData(featureCollections.points)
    syncGroundOverlayVisibility()
  }

  function syncGroundOverlayVisibility() {
    if (!loaded || destroyed) return
    groundOverlayLayers.forEach(({ layerId, isCctvCoverage }) => {
      if (!isCctvCoverage || !map.getLayer(layerId)) return
      map.setLayoutProperty(
        layerId,
        'visibility',
        state.showCctvCoverage ? 'visible' : 'none',
      )
    })
  }

  function scheduleAdaptiveMarkers() {
    if (layoutFrame !== null || destroyed) return
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = null
      syncAdaptiveMarkers()
    })
  }

  function syncAdaptiveMarkers() {
    if (!loaded || destroyed) return
    const traceIds = new Set(state.traceNodeIds)
    const selectedCandidate = currentCandidates.find(({ candidateId }) => (
      candidateId === state.selectedCandidateId
    ))
    const isolateCandidate = Boolean(state.isolateSelectedCandidate && selectedCandidate)
    const focusedAssetIds = new Set([
      selectedCandidate?.sourcePathAssetId,
      selectedCandidate?.targetAssetId,
      selectedCandidate?.targetPathAssetId,
    ].filter(Boolean))
    const items = assets
      .filter(({ coordinate }) => validPosition(coordinate))
      .map((asset) => {
        const networkFocused = Boolean(
          state.focusedNetworkId && asset.networkIds?.includes(state.focusedNetworkId),
        )
        const active = isolateCandidate
          ? focusedAssetIds.has(asset.id)
          : !asset.networkIds?.length
            || asset.networkIds.some((networkId) => state.selectedNetworkIds.has(networkId))
        const focusContext = Boolean(
          state.focusedNetworkId && asset.networkIds?.length && !networkFocused,
        )
        const projected = map.project(asset.coordinate.slice(0, 2))
        return {
          id: asset.id,
          label: asset.name || asset.id,
          type: asset.type || asset.category || 'Aset',
          category: asset.category,
          coordinate: asset.coordinate.slice(0, 2),
          point: { x: projected.x, y: projected.y },
          color: assetColor(asset, networks, state.focusedNetworkId),
          icon: iconForAsset(asset),
          active,
          focusContext,
          networkFocused,
          candidateEndpoint: focusedAssetIds.has(asset.id),
          candidateContext: Boolean(selectedCandidate && !focusedAssetIds.has(asset.id)),
          selected: asset.id === state.selectedAssetId,
          trace: traceIds.has(asset.id),
          isCoreNode: asset.isCoreNode,
        }
      })
      .filter(({ active }) => active)

    const layout = buildAdaptiveAssetLayout(items, {
      zoom: map.getZoom(),
      viewport: { width: element.clientWidth, height: element.clientHeight },
      enabled: declutterEnabled,
    })
    clusterLookup = new Map()
    const leaders = layout.leaders.map(renderAdaptiveLeader).join('')
    const markers = layout.markers.map((marker, index) => {
      if (marker.kind === 'cluster') {
        const key = `cluster-${index}`
        clusterLookup.set(key, marker)
        return renderClusterMarker(marker, key)
      }
      return renderAdaptiveAssetMarker(marker)
    }).join('')
    markerOverlay.innerHTML = '<canvas class="map-kml-line-overlay" aria-hidden="true"></canvas>'
      + `<div class="map-adaptive-leaders">${leaders}</div>`
      + `<div class="map-adaptive-markers">${markers}</div>`
    drawKmlLineOverlay(markerOverlay.querySelector('.map-kml-line-overlay'))
    syncSelectedCandidateOverlay()

    const signature = JSON.stringify({
      enabled: declutterEnabled,
      ...layout.summary,
    })
    if (signature !== layoutStatusSignature) {
      layoutStatusSignature = signature
      onLayoutStatus({ enabled: declutterEnabled, ...layout.summary })
    }
  }

  function syncSelectedCandidateOverlay() {
    const candidate = currentCandidates.find(({ candidateId }) => (
      candidateId === state.selectedCandidateId
    ))
    if (!candidate
      || !validPosition(candidate.sourceCoordinate)
      || !validPosition(candidate.targetCoordinate)) {
      selectedCandidateOverlay.replaceChildren()
      selectedCandidateOverlay.hidden = true
      return
    }

    selectedCandidateOverlay.hidden = false
    const sourcePoint = map.project(candidate.sourceCoordinate.slice(0, 2))
    const targetPoint = map.project(candidate.targetCoordinate.slice(0, 2))
    const width = Math.max(element.clientWidth, 1)
    const height = Math.max(element.clientHeight, 1)
    const overlap = Math.hypot(
      targetPoint.x - sourcePoint.x,
      targetPoint.y - sourcePoint.y,
    ) < 84
    const midpoint = {
      x: (sourcePoint.x + targetPoint.x) / 2,
      y: (sourcePoint.y + targetPoint.y) / 2,
    }
    const sourceLabel = overlap
      ? {
        x: clampNumber(midpoint.x - 40, 40, width - 40),
        y: clampNumber(midpoint.y - 44, 68, height - 36),
      }
      : {
        x: clampNumber(sourcePoint.x, 40, width - 40),
        y: clampNumber(sourcePoint.y - 34, 68, height - 36),
      }
    const targetLabel = overlap
      ? {
        x: clampNumber(midpoint.x + 40, 40, width - 40),
        y: clampNumber(midpoint.y + 44, 68, height - 36),
      }
      : {
        x: clampNumber(targetPoint.x, 40, width - 40),
        y: clampNumber(targetPoint.y + 34, 68, height - 36),
      }
    const sourceName = candidate.sourceDisplayName
      || candidate.sourcePathAssetId
      || 'Aset sumber'
    const targetName = candidate.targetDisplayName
      || candidate.targetAssetId
      || candidate.targetPathAssetId
      || 'Aset target'
    const distance = Number.isFinite(candidate.distanceMeters)
      ? `${candidate.distanceMeters.toFixed(2)} m`
      : 'Lokasi dari metadata'

    selectedCandidateOverlay.innerHTML = `
      <svg viewBox="0 0 ${styleNumber(width)} ${styleNumber(height)}"
        preserveAspectRatio="none" aria-hidden="true">
        <line class="selected-connection"
          x1="${styleNumber(sourcePoint.x)}" y1="${styleNumber(sourcePoint.y)}"
          x2="${styleNumber(targetPoint.x)}" y2="${styleNumber(targetPoint.y)}"></line>
        <line class="selected-endpoint-leader source"
          x1="${styleNumber(sourcePoint.x)}" y1="${styleNumber(sourcePoint.y)}"
          x2="${styleNumber(sourceLabel.x)}" y2="${styleNumber(sourceLabel.y)}"></line>
        <line class="selected-endpoint-leader target"
          x1="${styleNumber(targetPoint.x)}" y1="${styleNumber(targetPoint.y)}"
          x2="${styleNumber(targetLabel.x)}" y2="${styleNumber(targetLabel.y)}"></line>
        <circle class="selected-anchor source" cx="${styleNumber(sourcePoint.x)}"
          cy="${styleNumber(sourcePoint.y)}" r="${overlap ? 11 : 8}"></circle>
        <circle class="selected-anchor target" cx="${styleNumber(targetPoint.x)}"
          cy="${styleNumber(targetPoint.y)}" r="${overlap ? 5 : 8}"></circle>
      </svg>
      <div class="selected-candidate-map-summary">
        <strong>${escapeHtml(sourceName)} <span>→</span> ${escapeHtml(targetName)}</strong>
        <b>${escapeHtml(distance)}</b>
      </div>
      <div class="selected-map-endpoint source"
        style="left:${styleNumber(sourceLabel.x)}px;top:${styleNumber(sourceLabel.y)}px"
        title="Dari: ${escapeHtml(sourceName)}">
        <span>Dari</span><strong>${escapeHtml(sourceName)}</strong>
      </div>
      <div class="selected-map-endpoint target"
        style="left:${styleNumber(targetLabel.x)}px;top:${styleNumber(targetLabel.y)}px"
        title="Ke: ${escapeHtml(targetName)}">
        <span>Ke</span><strong>${escapeHtml(targetName)}</strong>
      </div>
    `
  }

  function focusCluster(cluster) {
    if (!cluster?.coordinates?.length) return
    const center = cluster.coordinates.reduce((result, coordinate) => ({
      longitude: result.longitude + Number(coordinate[0]),
      latitude: result.latitude + Number(coordinate[1]),
    }), { longitude: 0, latitude: 0 })
    map.easeTo({
      center: [
        center.longitude / cluster.coordinates.length,
        center.latitude / cluster.coordinates.length,
      ],
      zoom: Math.min(21, Math.max(17.2, map.getZoom() + 2)),
      duration: 420,
    })
  }

  function drawKmlLineOverlay(canvas) {
    if (!canvas) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, element.clientWidth)
    const height = Math.max(1, element.clientHeight)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(ratio, ratio)
    context.lineCap = 'round'
    context.lineJoin = 'round'

    const traceIds = new Set(state.traceNodeIds)
    const requestedTraceGeometryIds = new Set(state.traceGeometryIds ?? [])
    const traceGeometryIds = new Set((currentTopologyGraph.edges ?? []).flatMap((edge) => {
      const sourceId = edge.sourceAssetId ?? edge.sourceNodeId
      const targetId = edge.targetAssetId ?? edge.targetNodeId
      const isTraceEdge = requestedTraceGeometryIds.size
        ? (edge.sourceGeometryIds ?? []).some((id) => requestedTraceGeometryIds.has(id))
        : traceIds.has(sourceId) && traceIds.has(targetId)
      return isTraceEdge
        ? edge.sourceGeometryIds ?? []
        : []
    }))
    requestedTraceGeometryIds.forEach((id) => traceGeometryIds.add(id))
    const selectedCandidate = currentCandidates.find(({ candidateId }) => (
      candidateId === state.selectedCandidateId
    ))
    const selectedCandidateGeometryIds = new Set(
      geometryIdsForCandidate(selectedCandidate),
    )
    const selectedCandidateFocus = Boolean(
      selectedCandidate && selectedCandidateGeometryIds.size,
    )
    const isolateCandidate = Boolean(
      state.isolateSelectedCandidate
      && selectedCandidate
      && selectedCandidateGeometryIds.size,
    )
    const linework = geometries
      .filter(({ geometryType, coordinates }) => (
        geometryType === 'line_string' && coordinates?.length > 1
      ))
      .map((geometry) => {
        const network = networkByGeometryId.get(geometry.id)
          ?? networkByGeometryId.get(geometry.sourceGeometryId)
        const networkIds = [...new Set([
          network?.id,
          ...(geometry.assetId ? assetNetworkIds.get(geometry.assetId) ?? [] : []),
        ].filter(Boolean))]
        const active = !networkIds.length
          || networkIds.some((networkId) => state.selectedNetworkIds.has(networkId))
        const focused = Boolean(
          state.focusedNetworkId && networkIds.includes(state.focusedNetworkId),
        )
        const focusedNetwork = focused
          ? networkById.get(state.focusedNetworkId)
          : null
        const focusContext = Boolean(
          state.focusedNetworkId && networkIds.length && !focused,
        )
        const selectedCandidateGeometry = selectedCandidateGeometryIds.has(geometry.id)
          || selectedCandidateGeometryIds.has(geometry.sourceGeometryId)
        return {
          geometry,
          network,
          networkIds,
          active,
          // Keep focus aligned with the operational map palette. LAN is blue
          // on the normal map and must not fall back to its gray card swatch.
          focusColor: operationalLineColor(
            focusedNetwork ?? network,
            geometry.category,
          ),
          highlighted: networkIds.includes(state.highlightedNetworkId),
          focused,
          focusContext,
          candidateFocused: selectedCandidateFocus && !selectedCandidateGeometry,
          trace: selectedCandidateGeometry
            || traceGeometryIds.has(geometry.id)
            || traceGeometryIds.has(geometry.sourceGeometryId),
        }
      })
      .filter(({ active }) => active)
      .filter(({ trace }) => !isolateCandidate || trace)
      .sort((left, right) => Number(left.focused) - Number(right.focused)
        || Number(left.active) - Number(right.active)
        || Number(left.trace) - Number(right.trace))

    linework
      .filter(({ focused }) => !focused)
      .forEach((entry) => {
        drawProjectedLine(context, map, entry, 'casing')
        drawProjectedLine(context, map, entry, 'color')
      })
    linework
      .filter(({ focused }) => focused)
      .forEach((entry) => {
        drawProjectedLine(context, map, entry, 'focus-glow')
        drawProjectedLine(context, map, entry, 'focus-main')
      })
  }

  function showFeatureTooltip(event, kind) {
    const tooltip = element.parentElement?.querySelector('.map-asset-tooltip')
    const feature = event.features?.[0]
    if (!tooltip || !feature) return
    const properties = feature.properties ?? {}
    const title = kind === 'candidate'
      ? 'Kandidat koneksi'
      : kind === 'cable'
        ? properties.networkName || properties.cableType || 'Jalur kabel'
        : properties.name || properties.assetId || 'Aset'
    const subtitle = kind === 'asset'
      ? properties.assetType || 'Aset'
      : kind === 'candidate'
        ? `${properties.networkFamily || 'Jaringan'} · confidence ${formatScore(properties.score)}`
        : `${properties.networkName || 'Jaringan'} · ${properties.cableType || 'jalur fisik'}`
    const status = kind === 'candidate'
      ? (properties.status === 'ambiguous' ? 'Ambigu · perlu review' : 'Belum terkonfirmasi')
      : kind === 'cable'
        ? (properties.confirmed ? 'Endpoint terkonfirmasi' : 'Endpoint belum terkonfirmasi')
        : properties.assetId
    const resolvedSubtitle = kind === 'cable' ? 'Jalur fisik dari KML' : subtitle
    tooltip.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(resolvedSubtitle)}</span>`
      + `<small>${escapeHtml(status || '')}</small>`
    tooltip.hidden = false
    const tooltipWidth = 220
    tooltip.style.left = `${
      Math.max(8, Math.min(element.clientWidth - tooltipWidth - 8, event.point.x + 14))
    }px`
    tooltip.style.top = `${Math.max(8, event.point.y - 28)}px`
  }

  function hideFeatureTooltip() {
    const tooltip = element.parentElement?.querySelector('.map-asset-tooltip')
    if (tooltip) tooltip.hidden = true
  }

  function fitBounds(bounds, { duration = 0 } = {}) {
    // Keep the route away from the left edge. On mobile the sidebar overlays
    // the map, while on desktop this also leaves room for the map controls.
    const leftPadding = window.matchMedia?.('(max-width: 960px)').matches ? 168 : 144
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
      padding: { top: 84, right: 84, bottom: 72, left: leftPadding },
      duration,
      maxZoom: 18,
    })
  }

  function setBasemapMode(nextMode) {
    const resolvedMode = nextMode === 'satellite' && imageryTiles ? 'satellite' : 'street'
    if (resolvedMode === 'street' && !vectorTiles) return false

    basemapMode = resolvedMode
    const satelliteVisible = resolvedMode === 'satellite'
    if (map.getLayer('satellite-imagery')) {
      map.setLayoutProperty(
        'satellite-imagery',
        'visibility',
        satelliteVisible ? 'visible' : 'none',
      )
    }

    const vectorSurfaceLayers = new Set([
      'basemap-landuse',
      'basemap-landcover',
      'basemap-water',
      'basemap-building-shadows',
      'basemap-buildings',
    ])
    const hiddenContextLayers = new Set([
      'basemap-building-labels',
      'basemap-poi-labels',
      'basemap-house-numbers',
    ])
    map.getStyle().layers
      .filter(({ id }) => id.startsWith('basemap-'))
      .forEach(({ id }) => {
        map.setLayoutProperty(
          id,
          'visibility',
          hiddenContextLayers.has(id)
            || (satelliteVisible && vectorSurfaceLayers.has(id)) ? 'none' : 'visible',
        )
      })

    basemapSourceId = satelliteVisible ? 'satellite-imagery' : 'openfreemap'
    basemapHasLoadedTile = loadedBasemapSourceIds.has(basemapSourceId)
    basemapRetryAttempt = 0
    basemapLastError = ''
    clearBasemapRetry()
    if (basemapHasLoadedTile) setBasemapStatus('available', { mode: basemapMode })
    else {
      setBasemapStatus('loading', { mode: basemapMode })
      armBasemapTimeout()
    }
    return true
  }

  return {
    invalidateSize() {
      map.resize()
    },
    setState(next) {
      state = {
        ...state,
        ...next,
        selectedNetworkIds: next.selectedNetworkIds
          ? new Set(next.selectedNetworkIds)
          : state.selectedNetworkIds,
      }
      syncSources()
      syncAdaptiveMarkers()
      if (next.selectedAssetId && assetById.has(next.selectedAssetId)) {
        const coordinate = assetById.get(next.selectedAssetId).coordinate
        if (validPosition(coordinate)) {
          map.easeTo({ center: coordinate.slice(0, 2), zoom: Math.max(map.getZoom(), 19) })
        }
      }
    },
    setCandidates(nextCandidates = []) {
      currentCandidates = Array.isArray(nextCandidates) ? nextCandidates : []
      syncSources()
    },
    setTopologyGraph(nextGraph = { edges: [] }) {
      currentTopologyGraph = nextGraph && typeof nextGraph === 'object'
        ? nextGraph
        : { edges: [] }
      syncSources()
      syncAdaptiveMarkers()
    },
    setHighlightedNetworkId(networkId) {
      state.highlightedNetworkId = networkById.has(networkId) ? networkId : null
      syncSources()
    },
    setFocusedNetworkId(networkId) {
      state.focusedNetworkId = networkById.has(networkId) ? networkId : null
      syncSources()
      syncAdaptiveMarkers()
    },
    focusNetworkBounds(networkId) {
      const network = networkById.get(networkId)
      const bounds = network?.bounds ?? boundsForGeometries(
        (network?.geometryIds ?? []).map((id) => geometryById.get(id)).filter(Boolean),
      )
      if (bounds) fitBounds(bounds, { duration: 420 })
    },
    focusAssetBounds(assetIds) {
      const positions = assetIds
        .map((id) => assetById.get(id)?.coordinate)
        .filter(validPosition)
      const bounds = boundsForPositions(positions)
      if (bounds) fitBounds(bounds)
    },
    focusCoordinates(positions) {
      const valid = positions.filter(validPosition)
      if (!valid.length) return
      const [firstLongitude, firstLatitude] = valid[0]
      const isSinglePoint = valid.every(([longitude, latitude]) => (
        Math.abs(Number(longitude) - Number(firstLongitude)) < 1e-8
        && Math.abs(Number(latitude) - Number(firstLatitude)) < 1e-8
      ))
      if (isSinglePoint) {
        map.easeTo({
          center: [Number(firstLongitude), Number(firstLatitude)],
          zoom: Math.max(map.getZoom(), 18),
          duration: 320,
        })
        return
      }
      const bounds = boundsForPositions(valid)
      if (bounds) fitBounds(bounds)
    },
    zoomIn() {
      map.zoomIn()
    },
    zoomOut() {
      map.zoomOut()
    },
    reset() {
      if (initialBounds) fitBounds(initialBounds)
    },
    getBasemapCapabilities() {
      return {
        mode: basemapMode,
        street: Boolean(vectorTiles),
        satellite: Boolean(imageryTiles),
      }
    },
    setBasemapMode,
    setDeclutterEnabled(enabled) {
      declutterEnabled = Boolean(enabled)
      syncAdaptiveMarkers()
    },
    destroy() {
      destroyed = true
      if (basemapTimer !== null) window.clearTimeout(basemapTimer)
      clearBasemapRetry()
      if (layoutFrame !== null) window.cancelAnimationFrame(layoutFrame)
      window.removeEventListener('keydown', enableCtrlPitch)
      window.removeEventListener('keyup', disableCtrlPitch)
      window.removeEventListener('blur', disableCtrlPitch)
      element.removeEventListener('pointerdown', toggleCtrlPitchFromPointer)
      markerOverlay.remove()
      selectedCandidateOverlay.remove()
      map.remove()
    },
  }
}

function addOperationalLayers(map) {
  map.addLayer({
    id: 'ground-overlay-footprints',
    type: 'fill',
    source: 'sinergi-overlays',
    paint: {
      'fill-color': '#58738e',
      'fill-opacity': 0.13,
      'fill-outline-color': '#58738e',
    },
  })
  map.addLayer({
    id: 'asset-areas',
    type: 'fill',
    source: 'sinergi-polygons',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['get', 'opacity'],
      'fill-outline-color': ['get', 'color'],
    },
  })
  map.addLayer({
    id: 'cable-lines-casing',
    type: 'line',
    source: 'sinergi-lines',
    paint: {
      'line-color': '#ffffff',
      'line-opacity': ['get', 'opacity'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 4, 19, 10],
      'line-blur': 0.4,
    },
  })
  map.addLayer({
    id: 'cable-lines',
    type: 'line',
    source: 'sinergi-lines',
    paint: {
      'line-color': [
        'case',
        ['get', 'trace'], '#1367d1',
        ['get', 'selectedCandidate'], '#1367d1',
        ['get', 'color'],
      ],
      'line-opacity': ['get', 'opacity'],
      'line-width': [
        'case',
        ['get', 'selectedCandidate'], 6,
        ['interpolate', ['linear'], ['zoom'], 14, 2, 19, 7],
      ],
    },
  })
  map.addLayer({
    id: 'cable-lines-hit',
    type: 'line',
    source: 'sinergi-lines',
    paint: { 'line-color': 'rgba(0,0,0,0)', 'line-width': 14 },
  })
  map.addLayer({
    id: 'asset-relations-casing',
    type: 'line',
    source: 'sinergi-asset-relations',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-opacity': ['get', 'opacity'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 4, 19, 8],
    },
  })
  map.addLayer({
    id: 'asset-relations',
    type: 'line',
    source: 'sinergi-asset-relations',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-opacity': ['get', 'opacity'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 19, 4],
      'line-dasharray': [1.5, 1.5],
    },
  })
  map.addLayer({
    id: 'asset-selection-halo',
    type: 'circle',
    source: 'sinergi-points',
    // Asset identity is rendered by the adaptive HTML marker layer below.
    // Keeping this visual layer active produces a second dot underneath
    // clusters and displaced markers while the hit layer remains available.
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 9, 17, 13, 20, 17],
      'circle-color': '#ffffff',
      'circle-opacity': ['case', ['get', 'selected'], 0.34, ['get', 'trace'], 0.22, 0],
      'circle-stroke-color': ['case', ['get', 'selected'], '#1367d1', '#ffffff'],
      'circle-stroke-width': ['case', ['get', 'selected'], 3, ['get', 'trace'], 2, 0],
    },
  })
  map.addLayer({
    id: 'asset-points',
    type: 'circle',
    source: 'sinergi-points',
    // Prevent a native circle from showing through the adaptive marker.
    // `asset-points-hit` below remains the interaction target.
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': [
        ...assetPointRadiusExpression(),
      ],
      'circle-color': ['get', 'color'],
      'circle-opacity': ['get', 'opacity'],
      'circle-stroke-color': [
        'case',
        ['get', 'selected'], '#0f172a',
        ['get', 'connected'], '#1367d1',
        '#ffffff',
      ],
      'circle-stroke-width': ['case', ['get', 'selected'], 4, ['get', 'connected'], 3, 2],
    },
  })
  map.addLayer({
    id: 'candidate-connectors',
    type: 'line',
    source: 'sinergi-candidates',
    minzoom: 15,
    paint: {
      'line-color': [
        'case',
        ['get', 'selected'], '#1367d1',
        ['==', ['get', 'status'], 'ambiguous'], '#dc6d21',
        '#d69a25',
      ],
      'line-opacity': ['case', ['get', 'dimmed'], .18, 1],
      'line-width': ['case', ['get', 'selected'], 5, 3],
      'line-dasharray': [2, 2],
    },
  })
  // Focus is rendered from a dedicated source so the selected network is
  // always composited after every regular network line. The two passes keep
  // the emphasis visible over satellite imagery without turning it neon.
  map.addLayer({
    id: 'cable-lines-focus-glow',
    type: 'line',
    source: 'sinergi-focus-lines',
    paint: {
      'line-color': ['get', 'focusColor'],
      'line-opacity': ['*', ['get', 'focusOpacity'], 0.34],
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 9, 19, 12],
      'line-blur': 1.2,
    },
  })
  map.addLayer({
    id: 'cable-lines-focus',
    type: 'line',
    source: 'sinergi-focus-lines',
    paint: {
      'line-color': ['get', 'focusColor'],
      'line-opacity': ['get', 'focusOpacity'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 4, 19, 5],
    },
  })
  map.addLayer({
    id: 'candidate-connectors-hit',
    type: 'line',
    source: 'sinergi-candidates',
    minzoom: 15,
    paint: { 'line-color': 'rgba(0,0,0,0)', 'line-width': 14 },
  })
  map.addLayer({
    id: 'asset-points-hit',
    type: 'circle',
    source: 'sinergi-points',
    paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)' },
  })
  // This intentionally glyph-free style must not add a text symbol layer.
  // MapLibre rejects text-field layers when the style has no glyphs URL; that
  // synchronous error used to stop source synchronization and blank every
  // operational layer. Asset identity remains available via click/tooltip.
}

function geometryIdsForCandidate(candidate) {
  if (!candidate) return []
  return candidate.mapGeometryIds?.length
    ? candidate.mapGeometryIds
    : candidate.sourceGeometryIds ?? []
}

function isConfirmedMapRelation(relation) {
  if (relation?.verificationStatus !== undefined) {
    return relation.verificationStatus === 'confirmed'
  }
  if (relation?.candidateStatus !== undefined) {
    return relation.candidateStatus === 'confirmed'
  }
  if (relation?.relationStatus !== undefined) {
    return relation.relationStatus === 'confirmed'
  }
  return relation?.relationSource === undefined
    || ['explicit', 'explicit_kml_metadata', 'manual_review', 'automatic'].includes(
      relation.relationSource,
    )
}

function drawProjectedLine(context, map, {
  geometry,
  network,
  active,
  highlighted,
  focused,
  focusContext,
  focusColor: entryFocusColor,
  trace,
  candidateFocused,
}, pass) {
  const isFocusGlow = pass === 'focus-glow'
  const isFocusMain = pass === 'focus-main'
  const focusColor = safeColor(
    entryFocusColor ?? network?.color ?? operationalLineColor(network, geometry.category),
  )
  const opacity = isFocusGlow
    ? 0.34
    : isFocusMain
      ? 0.96
      : candidateFocused
        ? 0.16
        : !active
          ? 0
          : focusContext
            ? 0.32
            : 0.94
  const width = isFocusGlow ? 10 : isFocusMain ? 4.5 : trace ? 5.5 : highlighted ? 4.8 : 3
  context.beginPath()
  geometry.coordinates.forEach((coordinate, index) => {
    if (!validPosition(coordinate)) return
    const point = map.project(coordinate.slice(0, 2))
    if (index === 0) context.moveTo(point.x, point.y)
    else context.lineTo(point.x, point.y)
  })
  context.globalAlpha = opacity
  context.strokeStyle = pass === 'casing'
    ? 'rgba(2, 8, 16, .88)'
    : isFocusGlow || isFocusMain
      ? focusColor
      : trace
      ? '#2f8dff'
      : operationalLineColor(network, geometry.category)
  context.lineWidth = pass === 'casing' ? width + 3.5 : width
  context.shadowBlur = isFocusGlow ? 8 : pass === 'color' && active ? 4 : 0
  context.shadowColor = isFocusGlow || isFocusMain
    ? focusColor
    : 'transparent'
  context.stroke()
  context.shadowBlur = 0
  context.globalAlpha = 1
}

function operationalLineColor(network, category = '') {
  const key = String(network?.categoryKey ?? network?.type ?? category).toLowerCase()
  if (key.includes('fiber') || key.includes('fibre')) return '#2de2a6'
  if (key.includes('lan') || key.includes('utp')) return '#35b8ff'
  if (key.includes('cctv')) return '#8d7cff'
  if (key.includes('infra') || key.includes('power')) return '#ffc247'
  return safeColor(network?.color)
}

function renderAdaptiveLeader(leader) {
  const deltaX = leader.to.x - leader.from.x
  const deltaY = leader.to.y - leader.from.y
  const length = Math.hypot(deltaX, deltaY)
  const angle = Math.atan2(deltaY, deltaX)
  return `<span class="map-adaptive-leader" aria-hidden="true" style="`
    + `left:${styleNumber(leader.from.x)}px;top:${styleNumber(leader.from.y)}px;`
    + `width:${styleNumber(length)}px;transform:rotate(${styleNumber(angle)}rad);`
    + `--leader-color:${safeColor(leader.color)}"></span>`
}

function renderAdaptiveAssetMarker(marker) {
  const classes = [
    'map-adaptive-asset',
    marker.showLabel ? 'show-label' : '',
    marker.selected ? 'selected' : '',
    marker.trace ? 'trace' : '',
    marker.displaced ? 'displaced' : '',
    marker.networkFocused ? 'network-focused' : '',
    marker.focusContext ? 'focus-context' : '',
    marker.candidateEndpoint ? 'candidate-endpoint' : '',
    marker.candidateContext ? 'candidate-context' : '',
    marker.active === false ? 'inactive' : '',
  ].filter(Boolean).join(' ')
  const label = shortAssetLabel(marker.label || marker.id)
  const title = `${marker.label || marker.id} · ${marker.type} · posisi aktual dari KML`
  return `
    <button class="${classes}" type="button"
      data-adaptive-asset="${escapeHtml(marker.id)}"
      aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"
      style="left:${styleNumber(marker.point.x)}px;top:${styleNumber(marker.point.y)}px;
        --marker-color:${safeColor(marker.color)}">
      <span class="map-adaptive-asset-icon material-symbols-outlined"
        aria-hidden="true">${escapeHtml(marker.icon)}</span>
      <span class="map-adaptive-asset-name">${escapeHtml(label)}</span>
    </button>
  `
}

function renderClusterMarker(marker, key) {
  const classes = [
    'map-adaptive-cluster',
    marker.networkFocused ? 'network-focused' : '',
    marker.candidateEndpoint ? 'candidate-endpoint' : '',
    marker.candidateContext ? 'candidate-context' : '',
  ].filter(Boolean).join(' ')
  const title = `${marker.count} aset berdekatan · klik untuk memperbesar`
  return `
    <button class="${classes}" type="button"
      data-adaptive-cluster="${key}" aria-label="${escapeHtml(title)}"
      title="${escapeHtml(title)}"
      style="left:${styleNumber(marker.point.x)}px;top:${styleNumber(marker.point.y)}px;
        --marker-color:${safeColor(marker.color)}">
      <strong>${marker.count}</strong>
    </button>
  `
}

function iconForAsset(asset) {
  const type = `${asset.type || ''} ${asset.category || ''}`.toLowerCase()
  if (type.includes('junction') || /\bjb\b/.test(type)) return 'hub'
  if (type.includes('cctv') || type.includes('camera') || type.includes('kamera')) return 'videocam'
  if (type.includes('server') || type.includes('nvr')) return 'dns'
  if (type.includes('switch') || type.includes('router')) return 'device_hub'
  if (type.includes('fiber') || type.includes('fibre') || /\bfo\b/.test(type)) return 'cable'
  if (type.includes('lan') || type.includes('utp')) return 'lan'
  if (type.includes('tiang')) return 'location_on'
  return 'memory'
}

function shortAssetLabel(value) {
  const label = String(value ?? '').trim()
  return label.length > 18 ? `${label.slice(0, 17)}…` : label
}

function safeColor(value) {
  const color = String(value ?? '')
  return /^#[\da-f]{3,8}$/i.test(color) ? color : '#708196'
}

function styleNumber(value) {
  return Math.round(Number(value) * 100) / 100
}

function clampNumber(value, minimum, maximum) {
  if (maximum < minimum) return (minimum + maximum) / 2
  return Math.max(minimum, Math.min(maximum, Number(value)))
}

function addGroundOverlayImages(map, overlays) {
  const layers = []
  overlays.filter(({ visibility, resourceUrl }) => (
    visibility !== false && resourceUrl
  )).sort((left, right) => (left.drawOrder ?? 0) - (right.drawOrder ?? 0))
    .forEach((overlay, index) => {
      const coordinates = groundOverlayCoordinates(overlay)
      if (!coordinates) return
      const sourceId = `ground-overlay-image-${index}`
      map.addSource(sourceId, {
        type: 'image',
        url: overlay.resourceUrl,
        coordinates,
      })
      map.addLayer({
        id: `${sourceId}-layer`,
        type: 'raster',
        source: sourceId,
        paint: { 'raster-opacity': 0.82, 'raster-fade-duration': 0 },
      })
      layers.push({
        layerId: `${sourceId}-layer`,
        isCctvCoverage: isCctvCoverageOverlay(overlay),
      })
    })
  return layers
}

function buildFeatureCollections({
  geometries,
  networks,
  assetById,
  assetNetworkIds,
  topologyGraph,
  candidates,
  overlays,
  state,
}) {
  const networkByGeometry = new Map()
  networks.forEach((network) => {
    network.geometryIds?.forEach((geometryId) => networkByGeometry.set(geometryId, network))
  })
  const traceIds = new Set(state.traceNodeIds)
  const requestedTraceGeometryIds = new Set(state.traceGeometryIds ?? [])
  const confirmedGeometryIds = new Set((topologyGraph.edges ?? []).flatMap(
    (edge) => edge.sourceGeometryIds ?? edge.sourceGeometryId ?? [],
  ))
  const availableLineGeometryIds = new Set(geometries
    .filter((geometry) => geometry.geometryType === 'line_string')
    .flatMap((geometry) => [
      geometry.id,
      geometry.sourceGeometryId,
    ].filter(Boolean)))
  const candidateGeometryIds = new Set(candidates.flatMap(
    (candidate) => geometryIdsForCandidate(candidate),
  ))
  const selectedCandidateItem = candidates.find(({ candidateId }) => (
    candidateId === state.selectedCandidateId
  ))
  const selectedCandidateGeometryIds = new Set(
    geometryIdsForCandidate(selectedCandidateItem),
  )
  const selectedCandidateFocus = Boolean(
    selectedCandidateItem && selectedCandidateGeometryIds.size,
  )
  const isolateCandidate = Boolean(
    state.isolateSelectedCandidate
    && selectedCandidateItem
    && selectedCandidateGeometryIds.size,
  )
  const traceGeometryIds = new Set((topologyGraph.edges ?? []).flatMap((edge) => {
    const sourceId = edge.sourceAssetId ?? edge.sourceNodeId
    const targetId = edge.targetAssetId ?? edge.targetNodeId
    const inTrace = requestedTraceGeometryIds.size
      ? (edge.sourceGeometryIds ?? []).some((id) => requestedTraceGeometryIds.has(id))
      : traceIds.has(sourceId) && traceIds.has(targetId)
    return inTrace ? edge.sourceGeometryIds ?? [] : []
  }))
  requestedTraceGeometryIds.forEach((id) => traceGeometryIds.add(id))
  const connectedIds = new Set(state.connectedNodeIds)
  const collections = {
    points: [],
    lines: [],
    focusLines: [],
    relations: [],
    polygons: [],
    candidates: [],
    overlays: [],
  }

  geometries.forEach((geometry) => {
    if (!shouldRenderMapGeometry(geometry, assetById, state.showCctvCoverage)) return
    const geoType = {
      point: 'Point',
      line_string: 'LineString',
      polygon: 'Polygon',
    }[geometry.geometryType]
    if (!geoType) return
    const network = networkByGeometry.get(geometry.id)
      ?? networkByGeometry.get(geometry.sourceGeometryId)
      ?? networks.find(({ nodeIds }) => nodeIds.includes(geometry.assetId))
    const networkIds = [...new Set([
      network?.id,
      ...(geometry.assetId ? assetNetworkIds.get(geometry.assetId) ?? [] : []),
    ].filter(Boolean))]
    const active = !networkIds.length
      || networkIds.some((id) => state.selectedNetworkIds.has(id))
    const highlighted = networkIds.includes(state.highlightedNetworkId)
    const focused = Boolean(
      state.focusedNetworkId && networkIds.includes(state.focusedNetworkId),
    )
    const focusContext = Boolean(
      state.focusedNetworkId && networkIds.length && !focused,
    )
    const focusedNetwork = focused
      ? networks.find(({ id }) => id === state.focusedNetworkId)
      : null
    const lineColor = operationalLineColor(network, geometry.category)
    const focusColor = operationalLineColor(focusedNetwork ?? network, geometry.category)
    const selectedCandidateGeometry = selectedCandidateGeometryIds.has(geometry.id)
      || selectedCandidateGeometryIds.has(geometry.sourceGeometryId)
    const candidateContextDimmed = selectedCandidateFocus
      && geoType === 'LineString'
      && !selectedCandidateGeometry
    if (isolateCandidate && !selectedCandidateGeometry) return
    const properties = {
      assetId: geometry.assetId ?? '',
      name: assetById.get(geometry.assetId)?.name ?? geometry.assetId ?? geometry.id,
      networkId: network?.id ?? '',
      networkName: network?.name ?? network?.shortName ?? '',
      color: geoType === 'LineString'
        ? lineColor
        : network?.color ?? CATEGORY_COLORS[geometry.category] ?? '#708196',
      focusColor,
      focusOpacity: focused && active ? 0.96 : 0,
      opacity: !active
        ? 0
        : selectedCandidateGeometry
          ? 1
          : candidateContextDimmed
            ? 0.16
            : focusContext ? 0.32 : 1,
      selected: geometry.assetId === state.selectedAssetId,
      trace: traceIds.has(geometry.assetId) || traceGeometryIds.has(geometry.id)
        || traceGeometryIds.has(geometry.sourceGeometryId),
      connected: connectedIds.has(geometry.assetId),
      highlighted,
      focused,
      focusContext,
      assetType: assetById.get(geometry.assetId)?.type ?? geometry.category ?? '',
      cableType: geometry.category ?? network?.type ?? '',
      confirmed: confirmedGeometryIds.has(geometry.id)
        || confirmedGeometryIds.has(geometry.sourceGeometryId),
      hasCandidate: candidateGeometryIds.has(geometry.id)
        || candidateGeometryIds.has(geometry.sourceGeometryId),
      selectedCandidate: selectedCandidateGeometry,
    }
    if (properties.highlighted && active && !focusContext && !candidateContextDimmed) {
      properties.opacity = 1
    }
    const feature = {
      type: 'Feature',
      id: geometry.id,
      properties,
      geometry: { type: geoType, coordinates: geometry.coordinates },
    }
    if (geoType === 'Point') collections.points.push(feature)
    else if (geoType === 'LineString') {
      collections.lines.push(feature)
      if (focused && active) collections.focusLines.push(feature)
    }
    else collections.polygons.push(feature)
  })

  const seenRelationKeys = new Set()
  ;(topologyGraph.edges ?? []).forEach((edge) => {
    if (!isConfirmedMapRelation(edge)) return
    const sourceAssetId = edge.sourceAssetId ?? edge.sourceNodeId
    const targetAssetId = edge.targetAssetId ?? edge.targetNodeId
    const sourceAsset = assetById.get(sourceAssetId)
    const targetAsset = assetById.get(targetAssetId)
    if (!sourceAsset || !targetAsset
      || !validPosition(sourceAsset.coordinate)
      || !validPosition(targetAsset.coordinate)
      || sourceAssetId === targetAssetId) return
    const sourceGeometryIds = Array.isArray(edge.sourceGeometryIds)
      ? edge.sourceGeometryIds
      : [edge.sourceGeometryId].filter(Boolean)
    // A KML/KMZ line already communicates this relation. Only add a
    // lightweight operational connector when the relation has no matching
    // source geometry (automatic spatial match or manual override).
    if (sourceGeometryIds.some((id) => availableLineGeometryIds.has(id))) return
    const relationKey = edge.id || edge.edgeId || edge.relationId
      || [sourceAssetId, targetAssetId].sort().join('|')
    if (seenRelationKeys.has(relationKey)) return
    seenRelationKeys.add(relationKey)
    const endpointNetworkIds = [
      ...(assetNetworkIds.get(sourceAssetId) ?? []),
      ...(assetNetworkIds.get(targetAssetId) ?? []),
      edge.networkId,
    ].filter(Boolean)
    const active = !endpointNetworkIds.length
      || endpointNetworkIds.some((networkId) => state.selectedNetworkIds.has(networkId))
    const focused = Boolean(
      state.focusedNetworkId && endpointNetworkIds.includes(state.focusedNetworkId),
    )
    const selected = state.selectedAssetId === sourceAssetId
      || state.selectedAssetId === targetAssetId
    collections.relations.push({
      type: 'Feature',
      id: relationKey,
      properties: {
        relationId: edge.relationId || edge.id || edge.edgeId || relationKey,
        sourceAssetId,
        targetAssetId,
        relationSource: edge.relationSource || 'automatic',
        color: focused || selected ? '#1367d1' : '#4b78a8',
        opacity: active ? (focused || selected ? 0.96 : 0.82) : 0,
      },
      geometry: {
        type: 'LineString',
        coordinates: [sourceAsset.coordinate.slice(0, 2), targetAsset.coordinate.slice(0, 2)],
      },
    })
  })

  candidates.filter((candidate) => (
    ['candidate', 'ambiguous'].includes(candidate.candidateStatus)
    && validPosition(candidate.sourceCoordinate)
    && validPosition(candidate.targetCoordinate)
    && (!isolateCandidate || candidate.candidateId === state.selectedCandidateId)
  )).forEach((candidate) => {
    collections.candidates.push({
      type: 'Feature',
      id: candidate.candidateId,
      properties: {
        candidateId: candidate.candidateId,
        status: candidate.candidateStatus,
        score: candidate.score,
        networkFamily: candidate.networkFamily,
        selected: candidate.candidateId === state.selectedCandidateId,
        dimmed: Boolean(
          state.selectedCandidateId && candidate.candidateId !== state.selectedCandidateId,
        ),
      },
      geometry: {
        type: 'LineString',
        coordinates: [candidate.sourceCoordinate, candidate.targetCoordinate],
      },
    })
  })
  overlays.filter((overlay) => (
    overlay.visibility !== false
      && shouldRenderCctvCoverageOverlay(overlay, state.showCctvCoverage)
      && (overlay.latLonBox || overlay.latLonQuad)
  )).forEach((overlay) => {
    const coordinates = groundOverlayCoordinates(overlay)
    if (!coordinates?.length) return
    collections.overlays.push({
      type: 'Feature',
      id: overlay.sourceOverlayId,
      properties: {
        name: overlay.name,
        resourceStatus: overlay.resourceResolutionStatus,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[...coordinates, coordinates[0]]],
      },
    })
  })
  return {
    points: featureCollection(collections.points),
    lines: featureCollection(collections.lines),
    focusLines: featureCollection(collections.focusLines),
    relations: featureCollection(collections.relations),
    polygons: featureCollection(collections.polygons),
    candidates: featureCollection(collections.candidates),
    overlays: featureCollection(collections.overlays),
  }
}

function renderAccessibleAssets(element, assets, onSelectAsset) {
  const list = element.parentElement?.querySelector('.map-accessible-assets')
  if (!list) return
  list.innerHTML = assets.map((asset) => (
    `<button type="button" data-map-asset="${escapeHtml(asset.id)}">`
      + `${escapeHtml(asset.name)} (${escapeHtml(asset.id)})</button>`
  )).join('')
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-map-asset]')
    if (button) onSelectAsset(button.dataset.mapAsset)
  })
}

function emptyGeoJsonSource() {
  return { type: 'geojson', data: featureCollection([]) }
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features }
}

function boundsForGeometries(geometries) {
  return boundsForPositions(geometries.flatMap(extractPositions))
}

function boundsForPositions(positions) {
  const valid = positions.filter(validPosition)
  if (!valid.length) return null
  return [
    Math.min(...valid.map(([longitude]) => Number(longitude))),
    Math.min(...valid.map(([, latitude]) => Number(latitude))),
    Math.max(...valid.map(([longitude]) => Number(longitude))),
    Math.max(...valid.map(([, latitude]) => Number(latitude))),
  ]
}

function extractPositions(geometry) {
  if (geometry.geometryType === 'point') return [geometry.coordinates]
  if (geometry.geometryType === 'line_string') return geometry.coordinates ?? []
  if (geometry.geometryType === 'polygon') return (geometry.coordinates ?? []).flat()
  return []
}

function validPosition(position) {
  return Array.isArray(position)
    && position.length >= 2
    && Number.isFinite(Number(position[0]))
    && Number.isFinite(Number(position[1]))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function assetColor(asset, networks, focusedNetworkId = null) {
  const network = networks.find(({ id }) => id === focusedNetworkId
    && asset.networkIds?.includes(id))
    ?? networks.find(({ id }) => asset.networkIds?.includes(id))
  return network?.color ?? CATEGORY_COLORS[asset.category] ?? '#ffffff'
}

function formatScore(value) {
  const score = Number(value)
  return Number.isFinite(score) ? `${Math.round(score * 100)}%` : 'n/a'
}
