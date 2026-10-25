// Fill the browser's HTTP cache while the dataset loads, rather than putting
// metadata and the first label font after MapLibre initialization on that path.
export function preloadBasemapResources(vectorUrl, fetchImpl = globalThis.fetch) {
  const urls = [vectorUrl]
  if (vectorUrl === '/api/basemap/openfreemap/planet') {
    urls.push('/api/basemap/openfreemap/fonts/Noto%20Sans%20Regular/0-255.pbf')
  }
  return Promise.allSettled(urls.filter(Boolean).map(async url => {
    const response = await fetchImpl(url, { cache: 'default' })
    if (response.ok) await response.arrayBuffer()
    else await response.body?.cancel()
  }))
}
