import { getDefaultMapToken } from '../services/active-dataset-service.js'

export function createSourceIconLoader() {
  const dataByUrl = new Map()
  const pendingByUrl = new Map()

  const load = (url) => {
    if (!url) return Promise.resolve(null)
    if (dataByUrl.has(url)) return Promise.resolve(dataByUrl.get(url))
    if (pendingByUrl.has(url)) return pendingByUrl.get(url)

    const promise = (async () => {
      try {
        const token = getDefaultMapToken()
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!response.ok) throw new Error(`Ikon aset gagal dimuat (${response.status}).`)
        const dataUrl = await blobToDataUrl(await response.blob())
        dataByUrl.set(url, dataUrl)
        return dataUrl
      } catch {
        // Cache failures as null so a broken KMZ resource cannot trigger a
        // fetch loop every time the map is repositioned or the diagram redraws.
        dataByUrl.set(url, null)
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result))
    reader.addEventListener('error', () => reject(reader.error || new Error('Ikon aset gagal dibaca.')))
    reader.readAsDataURL(blob)
  })
}
