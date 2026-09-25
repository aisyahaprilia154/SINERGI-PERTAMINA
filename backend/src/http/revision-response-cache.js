import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'

const compress = promisify(gzip)

// Cache representations, not mutable aggregates. Every hit requires a fresh
// storage revision and authorization by the caller. Bound retained memory.
export function createRevisionResponseCache({ maxBytes = 96 * 1024 * 1024 } = {}) {
  const entries = new Map()
  let retainedBytes = 0
  return async function send(request, response, { key, revision, load }) {
    const cacheKey = revision == null ? null : JSON.stringify([key, revision])
    let pending = cacheKey && entries.get(cacheKey)
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        const plain = Buffer.from(JSON.stringify(await load()))
        const compressed = await compress(plain)
        return { plain, compressed, etag: `"${createHash('sha256').update(plain).digest('hex')}"` }
      })
      if (cacheKey) entries.set(cacheKey, pending)
      try {
        const result = await pending
        if (cacheKey && entries.get(cacheKey) === pending) {
          pending.bytes = result.plain.length + result.compressed.length
          retainedBytes += pending.bytes
          while (retainedBytes > maxBytes && entries.size) {
            const oldest = entries.keys().next().value
            retainedBytes -= entries.get(oldest).bytes ?? 0
            entries.delete(oldest)
          }
        }
      } catch (error) {
        if (cacheKey && entries.get(cacheKey) === pending) entries.delete(cacheKey)
        throw error
      }
    }
    const result = await pending
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-cache',
      vary: 'Authorization, Accept-Encoding',
      // Compressed and identity encodings represent the same JSON value.
      etag: `W/${result.etag}`,
    }
    if (request.headers['if-none-match']?.split(',').some(value => (
      value.trim().replace(/^W\//, '') === result.etag || value.trim() === '*'
    ))) {
      response.writeHead(304, headers)
      response.end()
      return
    }
    const acceptsGzip = String(request.headers['accept-encoding'] ?? '').split(',')
      .some(value => /^gzip(?:\s*;|\s*$)/i.test(value.trim())
        && !/;\s*q=0(?:\.0*)?\s*$/i.test(value))
    const body = acceptsGzip ? result.compressed : result.plain
    response.writeHead(200, {
      ...headers,
      ...(acceptsGzip ? { 'content-encoding': 'gzip' } : {}),
      'content-length': String(body.length),
    })
    response.end(body)
  }
}
