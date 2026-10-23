import { getDefaultMapToken } from '../services/active-dataset-service.js'

export function createSourceIconLoader({signal} = {}) {
  const dataByUrl = new Map()
  const pendingByUrl = new Map()

  const load = (url) => {
    if (!url || signal?.aborted) return Promise.resolve(null)
    if (dataByUrl.has(url)) return Promise.resolve(dataByUrl.get(url))
    if (pendingByUrl.has(url)) return pendingByUrl.get(url)

    const promise = (async () => {
      try {
        const token = getDefaultMapToken()
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          ...(signal ? {signal} : {}),
        })
        if (!response.ok) throw new Error(`Ikon aset gagal dimuat (${response.status}).`)
        const dataUrl = await blobToDataUrl(await response.blob(), signal)
        signal?.throwIfAborted()
        dataByUrl.set(url, dataUrl)
        return dataUrl
      } catch {
        // Cache failures as null so a broken KMZ resource cannot trigger a
        // fetch loop every time the map is repositioned or the diagram redraws.
        if (!signal?.aborted) dataByUrl.set(url, null)
        return null
      } finally {
        pendingByUrl.delete(url)
      }
    })()
    pendingByUrl.set(url, promise)
    return promise
  }

  const preload = (urls = []) => {
    const missing = [...new Set(urls.filter(Boolean))].filter((url) => (
      !dataByUrl.has(url) && !pendingByUrl.has(url)
    ))
    if (!missing.length) return null
    return Promise.all(missing.map(load))
  }

  return { dataByUrl, load, preload }
}

function blobToDataUrl(blob, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const reader = new FileReader()
    const abort = () => { reader.abort(); reject(signal.reason) }
    const finish = (callback, value) => { signal?.removeEventListener('abort', abort); callback(value) }
    reader.addEventListener('load', () => finish(resolve, reader.result))
    reader.addEventListener('error', () => finish(reject, reader.error || new Error('Ikon aset gagal dibaca.')))
    if (signal) {
      reader.addEventListener('abort', () => finish(reject, signal.reason))
      signal.addEventListener('abort', abort, {once: true})
    }
    reader.readAsDataURL(blob)
  })
}
