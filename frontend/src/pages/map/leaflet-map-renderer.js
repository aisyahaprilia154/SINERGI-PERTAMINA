import * as L from 'leaflet'
import { createLeafletBasemapManager } from './leaflet-basemap.js'
import { createLeafletLayerRegistry } from './leaflet-map-layers.js'
import {
  deriveLeafletZoomThresholds,
  leafletBoundsToGeographic,
  leafletZoomTier,
  resolveLeafletMapConfig,
} from './leaflet-map-state.js'

export function createLeafletMapRenderer(host, {
  assets,
  networks,
  geometries = [],
  topologyGraph = null,
  onSelectAsset,
  onSelectNetwork = () => {},
  onViewportChange = () => {},
}) {
  const config = resolveLeafletMapConfig()
  const root = document.createElement('div')
  root.className = 'leaflet-map-root'
  root.setAttribute('aria-label', 'Visualisasi peta geografis jaringan aset')
  root.setAttribute('aria-describedby', 'map-keyboard-help')
  host.replaceChildren(root)
  host.classList.add('uses-leaflet')
  host.closest('.map-stage')?.classList.add('renderer-leaflet')

  const computedStyle = getComputedStyle(host)
  const colors = {
    primary: computedStyle.getPropertyValue('--color-primary').trim() || '#172638',
    border: computedStyle.getPropertyValue('--color-border-strong').trim() || '#cbd5df',
  }
  const map = L.map(root, {
    zoomControl: false,
    attributionControl: true,
    minZoom: config.minZoom,
    maxZoom: config.maxZoom,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
  })
  createSinergiPanes(map)

  const basemapStatus = createBasemapStatus(host)
  const basemapManager = createLeafletBasemapManager(L, map, {
    providers: config.basemapProviders,
    maxZoom: config.maxZoom,
    timeoutMs: config.basemapTimeoutMs,
    onStatus(detail) {
      setBasemapStatus(basemapStatus, detail)
      if (detail.provider) {
        root.dataset.basemapProvider = detail.provider.id
        root.dataset.basemapProviderName = detail.provider.name
      } else {
        delete root.dataset.basemapProvider
        delete root.dataset.basemapProviderName
      }
    },
  })
  const basemapSwitch = createBasemapSwitchControl(L, map, {
    onChange(mode) {
      const providers = mode === 'satellite'
        ? config.satelliteBasemapProviders
        : config.basemapProviders
      basemapManager.setProviders(providers, `switch-${mode}`)
      root.dataset.basemapMode = mode
    },
  })

  const registry = createLeafletLayerRegistry(L, map, {
    assets,
    networks,
    geometries,
    topologyGraph,
    onSelectAsset,
    onSelectNetwork,
    config,
    colors,
  })
  const safePadding = readMapSafePadding(host)
  const dataBounds = registry.getDataBounds()
  const naturalFitZoom = dataBounds?.isValid?.()
    ? map.getBoundsZoom(dataBounds, false, L.point(
      safePadding.left + safePadding.right,
      safePadding.top + safePadding.bottom,
    ))
    : config.minZoom
  const thresholds = deriveLeafletZoomThresholds(
    Math.min(naturalFitZoom, config.fitMaxZoom),
    config,
  )
  Object.assign(config, thresholds)
  root.dataset.fitZoom = String(thresholds.fitZoom)
  root.dataset.lowZoomMax = String(thresholds.lowZoomMax)
  root.dataset.highZoomMin = String(thresholds.highZoomMin)
  const viewportSubscribers = new Set()
  if (typeof onViewportChange === 'function') viewportSubscribers.add(onViewportChange)
  let destroyed = false
  let viewReady = false
  let viewportTimer = null
  let layerRefreshFrame = null
  let initialView = null

  function scheduleViewportNotification() {
    window.clearTimeout(viewportTimer)
    viewportTimer = window.setTimeout(() => {
      viewportTimer = null
      notifyViewport()
    }, 80)
  }

  function scheduleLayerRefresh() {
    window.cancelAnimationFrame(layerRefreshFrame)
    layerRefreshFrame = window.requestAnimationFrame(() => {
      layerRefreshFrame = null
      registry.refreshForViewport()
    })
  }

  function notifyViewport() {
    if (destroyed || !viewReady) return
    const leafletBounds = map.getBounds()
    const bounds = leafletBoundsToGeographic(leafletBounds)
    if (!bounds) return
    const detail = {
      visibleAssetIds: registry.getVisibleAssetIds(leafletBounds),
      visibleGeometryIds: registry.getVisibleGeometryIds(bounds),
      zoom: map.getZoom(),
      zoomTier: leafletZoomTier(map.getZoom(), config),
    }
    viewportSubscribers.forEach((callback) => callback(bounds, detail))
  }

  function fitBounds(bounds, { maximumZoom = config.fitMaxZoom } = {}) {
    if (!bounds?.isValid?.()) return false
    const padding = readMapSafePadding(host)
    map.fitBounds(bounds, {
      animate: false,
      maxZoom: maximumZoom,
      paddingTopLeft: [padding.left, padding.top],
      paddingBottomRight: [padding.right, padding.bottom],
    })
    viewReady = true
    return true
  }

  function fitAll() {
    return fitBounds(registry.getDataBounds())
  }

  function reset() {
    if (!initialView) return fitAll()
    map.setView(initialView.center, initialView.zoom, { animate: false })
    viewReady = true
    return true
  }

  map.on('moveend', () => {
    scheduleLayerRefresh()
    scheduleViewportNotification()
  })
  map.on('zoomend', () => {
    scheduleLayerRefresh()
    scheduleViewportNotification()
  })
  map.on('resize', scheduleViewportNotification)

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (destroyed) return
      map.invalidateSize({ pan: false, debounceMoveend: true })
      scheduleViewportNotification()
    })
    : null
  resizeObserver?.observe(host)

  fitAll()
  if (viewReady) {
    initialView = {
      center: map.getCenter(),
      zoom: map.getZoom(),
    }
  }

  return {
    rendererName: 'leaflet',
    invalidateSize() {
      if (destroyed) return
      map.invalidateSize({ pan: false, debounceMoveend: true })
      scheduleViewportNotification()
    },
    setState(next) {
      registry.setState(next)
      scheduleViewportNotification()
    },
    setHighlightedNetworkId(networkId) {
      registry.setHighlightedNetworkId(networkId)
    },
    focusNetworkBounds(networkId) {
      fitBounds(registry.getNetworkBounds(networkId))
    },
    focusAssetBounds(assetIds) {
      fitBounds(registry.getAssetBounds(assetIds))
    },
    focusTraceBounds({
      nodeIds = [],
      relationIds = [],
    } = {}) {
      return fitBounds(registry.getTraceBounds({
        nodeIds,
        relationIds,
      }))
    },
    panToAsset(assetId) {
      const latLng = registry.getAssetLatLng(assetId)
      if (!latLng) return false
      map.panTo(latLng, { animate: false })
      viewReady = true
      return true
    },
    getGeographicViewportBounds() {
      if (destroyed || !viewReady) return null
      return leafletBoundsToGeographic(map.getBounds())
    },
    getVisibleAssetIds() {
      if (destroyed || !viewReady) return []
      return registry.getVisibleAssetIds(map.getBounds())
    },
    getVisibleGeometryIds() {
      if (destroyed || !viewReady) return []
      return registry.getVisibleGeometryIds(leafletBoundsToGeographic(map.getBounds()))
    },
    subscribeViewportChange(callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('Viewport subscriber harus berupa function.')
      }
      viewportSubscribers.add(callback)
      return () => viewportSubscribers.delete(callback)
    },
    zoomIn() {
      map.zoomIn(1)
    },
    zoomOut() {
      map.zoomOut(1)
    },
    fitAll,
    reset,
    destroy() {
      if (destroyed) return
      destroyed = true
      window.clearTimeout(viewportTimer)
      window.cancelAnimationFrame(layerRefreshFrame)
      resizeObserver?.disconnect()
      viewportSubscribers.clear()
      registry.destroy()
      basemapSwitch.remove()
      basemapManager.destroy()
      map.off()
      map.remove()
      basemapStatus.remove()
      host.classList.remove('uses-leaflet')
      host.closest('.map-stage')?.classList.remove('renderer-leaflet')
      host.replaceChildren()
    },
  }
}

function createBasemapSwitchControl(leaflet, map, {
  onChange,
}) {
  const control = leaflet.control({ position: 'bottomleft' })
  control.onAdd = () => {
    const container = leaflet.DomUtil.create(
      'div',
      'leaflet-control leaflet-basemap-switch',
    )
    container.setAttribute('role', 'group')
    container.setAttribute('aria-label', 'Pilihan peta dasar')
    container.innerHTML = `
      <button type="button" data-basemap-mode="light" aria-pressed="true">
        Peta terang
      </button>
      <button type="button" data-basemap-mode="satellite" aria-pressed="false">
        Satelit
      </button>
    `
    leaflet.DomEvent.disableClickPropagation(container)
    leaflet.DomEvent.disableScrollPropagation(container)
    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-basemap-mode]')
      if (!button) return
      container.querySelectorAll('[data-basemap-mode]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button))
      })
      onChange?.(button.dataset.basemapMode)
    })
    return container
  }
  control.addTo(map)
  return control
}

function createSinergiPanes(map) {
  const panes = [
    ['sinergi-polygons', 360],
    ['sinergi-lines', 410],
    ['sinergi-relations', 430],
    ['sinergi-markers', 610],
  ]
  panes.forEach(([name, zIndex]) => {
    const pane = map.createPane(name)
    pane.style.zIndex = String(zIndex)
  })
}

function createBasemapStatus(host) {
  const status = document.createElement('div')
  status.className = 'leaflet-basemap-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.hidden = true
  host.append(status)
  return status
}

function setBasemapStatus(element, {
  status,
  provider = null,
} = {}) {
  element.dataset.status = status
  if (provider) element.dataset.provider = provider.id
  else delete element.dataset.provider
  if (status !== 'error') {
    element.hidden = true
    element.textContent = ''
    return
  }
  element.hidden = false
  element.textContent =
    'Semua basemap gagal dimuat. Layer aset tetap dapat digunakan.'
}

function readMapSafePadding(host) {
  const stage = host.closest('.map-stage')
  const style = getComputedStyle(stage || host)
  const read = (name, fallback) => {
    const value = Number.parseFloat(style.getPropertyValue(`--map-safe-${name}`))
    return Number.isFinite(value) ? Math.max(12, value) : fallback
  }
  return {
    left: read('left', 24),
    right: read('right', 60),
    top: read('top', 96),
    bottom: read('bottom', 48),
  }
}

export const leafletMapRendererInternals = {
  readMapSafePadding,
  setBasemapStatus,
}
