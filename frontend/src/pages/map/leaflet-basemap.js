export function createLeafletBasemapManager(leaflet, map, {
  providers = [],
  maxZoom = 22,
  timeoutMs = 8000,
  onStatus = () => {},
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let availableProviders = providers.filter(({ url }) => Boolean(url))
  let activeLayer = null
  let activeProvider = null
  let activeIndex = -1
  let timeoutId = null
  let destroyed = false
  let generation = 0
  let batch = createBatch()

  function clearLoadTimeout() {
    if (timeoutId == null) return
    clearTimer(timeoutId)
    timeoutId = null
  }

  function removeActiveLayer() {
    clearLoadTimeout()
    activeLayer?.off()
    if (activeLayer && map.hasLayer?.(activeLayer)) map.removeLayer(activeLayer)
    activeLayer = null
  }

  function emit(status, detail = {}) {
    if (destroyed) return
    onStatus({
      status,
      provider: activeProvider,
      providerIndex: activeIndex,
      providerCount: availableProviders.length,
      ...detail,
    })
  }

  function armLoadTimeout(currentGeneration) {
    clearLoadTimeout()
    timeoutId = setTimer(() => {
      timeoutId = null
      if (destroyed || generation !== currentGeneration) return
      if (batch.loaded > 0) {
        emit('ready', { partial: batch.failed > 0 })
        return
      }
      activate(activeIndex + 1, 'timeout')
    }, timeoutMs)
  }

  function activate(index, reason = 'initial') {
    if (destroyed) return false
    removeActiveLayer()
    if (index >= availableProviders.length) {
      activeProvider = null
      activeIndex = availableProviders.length
      emit('error', { reason })
      return false
    }

    activeIndex = index
    activeProvider = availableProviders[index]
    generation += 1
    const currentGeneration = generation
    batch = createBatch()
    activeLayer = leaflet.tileLayer(activeProvider.url, {
      attribution: activeProvider.attribution,
      ...(activeProvider.subdomains
        ? { subdomains: activeProvider.subdomains }
        : {}),
      ...(activeProvider.token ? { token: activeProvider.token } : {}),
      maxZoom,
      maxNativeZoom: activeProvider.maxNativeZoom,
      detectRetina: true,
      crossOrigin: true,
      keepBuffer: 4,
      className: 'sinergi-basemap-tile',
    })

    activeLayer.on('loading', () => {
      if (generation !== currentGeneration) return
      batch = createBatch()
      emit(index === 0 ? 'loading' : 'fallback-loading', { reason })
      armLoadTimeout(currentGeneration)
    })
    activeLayer.on('tileloadstart', () => {
      if (generation === currentGeneration) batch.requested += 1
    })
    activeLayer.on('tileload', () => {
      if (generation === currentGeneration) batch.loaded += 1
    })
    activeLayer.on('tileerror', () => {
      if (generation === currentGeneration) batch.failed += 1
    })
    activeLayer.on('load', () => {
      if (generation !== currentGeneration) return
      clearLoadTimeout()
      if (batch.loaded > 0 || batch.failed === 0) {
        emit('ready', { partial: batch.failed > 0 })
        return
      }
      activate(index + 1, 'tile-error')
    })
    activeLayer.addTo(map)
    emit(index === 0 ? 'loading' : 'fallback-loading', { reason })
    return true
  }

  activate(0)

  return {
    get activeProvider() {
      return activeProvider
    },
    get activeLayer() {
      return activeLayer
    },
    retry() {
      return activate(0, 'manual-retry')
    },
    setProviders(nextProviders, reason = 'mode-change') {
      if (destroyed) return false
      availableProviders = (nextProviders ?? []).filter(({ url }) => Boolean(url))
      activeProvider = null
      activeIndex = -1
      generation += 1
      return activate(0, reason)
    },
    destroy() {
      if (destroyed) return
      removeActiveLayer()
      destroyed = true
      activeProvider = null
    },
  }
}

function createBatch() {
  return {
    requested: 0,
    loaded: 0,
    failed: 0,
  }
}
