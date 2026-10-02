import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { createDiskRepresentationCache } from './disk-representation-cache.js'

const compress = promisify(gzip)

// Public provider resources are keyed by their complete upstream URL. Tile
// snapshots never share a cache entry, and concurrent clients share one fetch.
export function createBasemapResourceCache({
  directory = null, now = () => Date.now(), maxMemoryBytes = 32 * 1024 * 1024,
  maxDiskBytes = 128 * 1024 * 1024, maxEntries = 512,
} = {}) {
  const entries = new Map()
  const disk = directory ? createDiskRepresentationCache({
    directory, maxBytes: maxDiskBytes, maxEntries, maxPlainBytes: 5 * 1024 * 1024,
  }) : null
  let retained = 0
  return {
    async get(key, { ttlMs, maxBytes, load }) {
      const cacheKey = JSON.stringify(['basemap/1', key, Math.floor(now() / ttlMs)])
      let entry = entries.get(key)
      if (entry?.cacheKey === cacheKey) {
        entries.delete(key)
        entries.set(key, entry)
        return entry.promise
      }
      if (entry) { retained -= entry.bytes ?? 0; entries.delete(key) }
      entry = { cacheKey, bytes: 0 }
      entry.promise = Promise.resolve().then(async () => {
        const stored = await disk?.read(key, cacheKey)
        if (stored && stored.plain.length <= maxBytes) return stored
        const plain = await load()
        const compressed = await compress(plain)
        const result = { plain, compressed,
          etag: `"${createHash('sha256').update(plain).digest('hex')}"` }
        await disk?.write(key, cacheKey, result)
        return result
      })
      entries.set(key, entry)
      try {
        const result = await entry.promise
        if (entries.get(key) === entry) {
          entry.bytes = result.plain.length + result.compressed.length
          entry.ready = true
          retained += entry.bytes
          // Keep unfinished loads shared even when completed resources fill
          // memory; evicting their promises would start duplicate downloads.
          for (const [oldest, candidate] of entries) {
            if (retained <= maxMemoryBytes) break
            if (!candidate.ready) continue
            retained -= candidate.bytes
            entries.delete(oldest)
          }
        }
        return result
      } catch (error) {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      }
    },
  }
}
