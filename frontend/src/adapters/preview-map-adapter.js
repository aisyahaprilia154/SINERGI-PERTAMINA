import { createSourceIconLoader } from '../domain/source-icon-loader.js'
import { adaptActiveDatasetForMap } from './active-dataset-map-adapter.js'

// MapLibre owns only this container. Data changes preserve the user's camera;
// table, focus, busy and error renders do not touch the surface.
export function createPreviewMapAdapter(host, { loadFactory = async () => (await import('../pages/map/maplibre-map.js')).createMapLibreSurface } = {}) {
  let surface = null, controller = null, signature = '', camera = null, generation = 0, disposed = false
  return {
    async update(payload) {
      if (disposed) return
      const next = JSON.stringify(payload)
      if (next === signature) return
      signature = next
      const current = ++generation
      try {
        const factory = await loadFactory()
        if (disposed || current !== generation || !host.isConnected) return
        camera = surface?.getCamera?.() || camera
        controller?.abort(); surface?.destroy(); surface = null; host.replaceChildren(); controller = new AbortController()
        surface = factory(host, { ...adaptActiveDatasetForMap(payload), initialCamera: camera, iconLoader: createSourceIconLoader({signal:controller.signal}) })
      } catch (error) {
        if (!disposed && current === generation) { controller?.abort(); surface?.destroy(); surface = null; signature = ''; host.textContent = `Peta tidak dapat dimuat: ${error.message}` }
      }
    },
    dispose() { disposed = true; generation++; controller?.abort(); surface?.destroy(); surface = null; host.replaceChildren() },
  }
}
