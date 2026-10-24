import { createSourceIconLoader } from '../domain/source-icon-loader.js'
import { assetIconUrl } from '../domain/asset-icon.js'

// One surface per dataset/area document. React owns every control around it.
export function createMapReadAdapter(host, options, { loadFactory = async () => (await import('../pages/map/maplibre-map.js')).createMapLibreSurface } = {}) {
  let surface = null, disposed = false, desired = null, selectedAssetId = null
  const controller = new AbortController()
  const assets = (options.assets || []).map(asset => ({...asset})), iconLoader = createSourceIconLoader({ signal: controller.signal })
  let projection = null, applied = null
  const applyProjection = () => {
    if (!surface || !projection || projection === applied || disposed) return
    applied = projection
    const byId = projection.assetById
    assets.forEach(asset => { if (byId[asset.id]) Object.assign(asset, byId[asset.id]) })
    surface.setTopologyGraph?.(projection.topologyGraph); surface.setPoleGroups?.(projection.poleGroups)
    const preload = iconLoader.preload(assets.map(assetIconUrl))
    surface.refreshAssetIcons?.()
    if (preload) void preload.then(() => { if (!disposed) surface?.refreshAssetIcons?.() })
  }
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => surface?.invalidateSize())
  const safe = callback => (...args) => { if (!disposed) callback?.(...args) }
  const sync = () => {
    if (!surface || !desired || disposed) return
    const next = { ...desired }
    // setState({selectedAssetId}) pans the map. Unrelated controls must not pan it.
    if (next.selectedAssetId === selectedAssetId) delete next.selectedAssetId
    else selectedAssetId = next.selectedAssetId
    surface.setState(next); surface.setFocusedNetworkId?.(desired.focusedNetworkId)
  }
  const ready = (async () => {
    try {
      const factory = await loadFactory()
      if (disposed || !host.isConnected) return
      surface = factory(host, { ...options, assets, iconLoader, manageAccessibleAssets: false, onSelectAsset: safe(options.onSelectAsset), onSelectNetwork: safe(options.onSelectNetwork), onBasemapStatus: safe(options.onBasemapStatus), onLayoutStatus: safe(options.onLayoutStatus) })
      resize?.observe(host); applyProjection(); sync(); options.onReady?.(surface.getBasemapCapabilities())
    } catch (error) { if (!disposed) { controller.abort(); resize?.disconnect(); surface?.destroy(); surface = null; host.replaceChildren(); options.onError?.(error) } }
  })()
  return {
    ready,
    update(state) { desired = state; sync() },
    updateProjection(next) { projection = next; applyProjection() },
    zoomIn() { surface?.zoomIn() }, zoomOut() { surface?.zoomOut() }, reset() { surface?.reset() },
    focusAsset(id) { surface?.setState({selectedAssetId:id}) },
    highlightAsset(id) { surface?.highlightAsset(id) },
    focusNetwork(id) { surface?.focusNetworkBounds(id) },
    highlightNetwork(id) { surface?.setHighlightedNetworkId(id) },
    setBasemapMode(mode) { return surface?.setBasemapMode(mode) || false },
    invalidateSize() { surface?.invalidateSize() },
    dispose() { if (disposed) return; disposed = true; controller.abort(); resize?.disconnect(); surface?.destroy(); surface = null; host.replaceChildren() },
  }
}
