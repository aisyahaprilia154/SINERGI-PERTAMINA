import { AppError } from '../errors.js'
import { createBasemapResourceCache } from './basemap-resource-cache.js'

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
const FONT_BASE_URL = 'https://tiles.openfreemap.org/fonts'
const LOCAL_BASE_PATH = '/api/basemap/openfreemap'
const METADATA_CACHE_MS = 6 * 60 * 60 * 1000
const MAX_TILEJSON_BYTES = 2 * 1024 * 1024
const MAX_TILE_BYTES = 5 * 1024 * 1024
const MAX_FONT_BYTES = 2 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 10_000
const UPSTREAM_MAX_ATTEMPTS = 2
const UPSTREAM_RETRY_DELAY_MS = 120

export function createOpenFreeMapProxy({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  directory = null,
} = {}) {
  let metadataCache = null
  const resources = createBasemapResourceCache({ directory, now })

  async function loadResource(url, maxBytes, ttlMs, validate = () => {}) {
    return resources.get(url, { maxBytes, ttlMs, load: async () => {
      const upstream = await fetchUpstream(url, fetchImpl)
      const bytes = await readBoundedBody(upstream, maxBytes)
      validate(bytes)
      return bytes
    } })
  }

  async function loadMetadata() {
    if (metadataCache?.expiresAt > now()) return metadataCache
    const { plain } = await loadResource(TILEJSON_URL, MAX_TILEJSON_BYTES,
      METADATA_CACHE_MS, decodeMetadata)
    const { metadata, tileTemplate } = decodeMetadata(plain)
    metadataCache = {
      metadata,
      tileTemplate,
      expiresAt: (Math.floor(now() / METADATA_CACHE_MS) + 1) * METADATA_CACHE_MS,
    }
    return metadataCache
  }

  return {
    async handle(pathname, response, request = { headers: {} }) {
      if (pathname === `${LOCAL_BASE_PATH}/planet`) {
        const { metadata, tileTemplate } = await loadMetadata()
        const snapshot = snapshotFromTemplate(tileTemplate)
        return sendJson(response, {
          ...metadata,
          tiles: [`${LOCAL_BASE_PATH}/tiles/${snapshot}/{z}/{x}/{y}.pbf`],
        }, 300)
      }

      const tileMatch = pathname.match(
        /^\/api\/basemap\/openfreemap\/tiles\/(?:([A-Za-z0-9_-]{1,100})\/)?(\d{1,2})\/(\d+)\/(\d+)\.pbf$/,
      )
      if (tileMatch) {
        const snapshot = tileMatch[1]
        const [zoom, x, y] = tileMatch.slice(2).map(Number)
        assertTileCoordinate(zoom, x, y)
        const tileTemplate = snapshot
          ? `https://tiles.openfreemap.org/planet/${snapshot}/{z}/{x}/{y}.pbf`
          : (await loadMetadata()).tileTemplate
        const upstreamUrl = tileTemplate
          .replace('{z}', String(zoom))
          .replace('{x}', String(x))
          .replace('{y}', String(y))
        const result = await loadResource(upstreamUrl, MAX_TILE_BYTES, 7 * 86_400_000)
        return sendBinary(request, response, result, {
          contentType: 'application/vnd.mapbox-vector-tile',
          cacheSeconds: snapshot ? 31_536_000 : 300,
          immutable: Boolean(snapshot),
        })
      }

      const fontMatch = pathname.match(
        /^\/api\/basemap\/openfreemap\/fonts\/([^/]+)\/(\d+)-(\d+)\.pbf$/,
      )
      if (fontMatch) {
        const fontStack = decodeFontStack(fontMatch[1])
        const rangeStart = Number(fontMatch[2])
        const rangeEnd = Number(fontMatch[3])
        assertFontRange(rangeStart, rangeEnd)
        const upstreamUrl = `${FONT_BASE_URL}/${encodeURIComponent(fontStack)}/`
          + `${rangeStart}-${rangeEnd}.pbf`
        const result = await loadResource(upstreamUrl, MAX_FONT_BYTES, 7 * 86_400_000)
        return sendBinary(request, response, result, {
          contentType: 'application/x-protobuf',
          cacheSeconds: 604_800,
        })
      }

      return false
    },
  }
}

function sendBinary(request, response, result, {
  contentType,
  cacheSeconds,
  immutable = false,
}) {
  const headers = {
    'content-type': contentType,
    'cache-control': `public, max-age=${cacheSeconds}${immutable ? ', immutable' : ''}`,
    vary: 'Accept-Encoding',
    etag: `W/${result.etag}`,
  }
  if (request.headers['if-none-match']?.split(',').some(value => (
    value.trim().replace(/^W\//, '') === result.etag || value.trim() === '*'
  ))) {
    response.writeHead(304, headers)
    response.end()
    return true
  }
  const acceptsGzip = String(request.headers['accept-encoding'] ?? '').split(',')
    .some(value => /^gzip(?:\s*;|\s*$)/i.test(value.trim())
      && !/;\s*q=0(?:\.0*)?\s*$/i.test(value))
  const bytes = acceptsGzip ? result.compressed : result.plain
  response.writeHead(200, {
    ...headers,
    ...(acceptsGzip ? { 'content-encoding': 'gzip' } : {}),
    'content-length': String(bytes.length),
  })
  response.end(bytes)
  return true
}

async function fetchUpstream(url, fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw upstreamError('Layanan basemap belum dikonfigurasi.')
  }
  let lastError = null
  for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt += 1) {
    let response
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json, application/x-protobuf, */*' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
    } catch (error) {
      lastError = error
      if (attempt < UPSTREAM_MAX_ATTEMPTS) {
        await delay(UPSTREAM_RETRY_DELAY_MS)
        continue
      }
      break
    }
    if (response.ok) return response
    lastError = new Error(`Basemap eksternal merespons ${response.status}.`)
    if (attempt < UPSTREAM_MAX_ATTEMPTS && isRetryableStatus(response.status)) {
      await response.body?.cancel().catch(() => {})
      await delay(UPSTREAM_RETRY_DELAY_MS)
      continue
    }
    throw upstreamError(lastError.message, lastError)
  }
  throw upstreamError('Basemap eksternal tidak dapat dihubungi.', lastError)
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function readBoundedBody(response, maxBytes) {
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw upstreamError('Respons basemap melebihi batas ukuran.')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) {
    throw upstreamError('Respons basemap melebihi batas ukuran.')
  }
  return bytes
}

function sendJson(response, body, cacheSeconds) {
  const bytes = Buffer.from(JSON.stringify(body))
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': `public, max-age=${cacheSeconds}`,
  })
  response.end(bytes)
  return true
}

function isApprovedTileTemplate(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    const pathname = decodeURIComponent(url.pathname)
    return url.protocol === 'https:'
      && url.hostname === 'tiles.openfreemap.org'
      && /^\/planet\/[A-Za-z0-9_-]{1,100}\/\{z\}\/\{x\}\/\{y\}\.pbf$/.test(pathname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

function decodeMetadata(bytes) {
  let metadata
  try { metadata = JSON.parse(bytes.toString('utf8')) }
  catch { throw upstreamError('Metadata basemap tidak valid.') }
  const tileTemplate = metadata?.tiles?.find(isApprovedTileTemplate)
  if (!tileTemplate) throw upstreamError('Template tile basemap tidak tersedia.')
  return { metadata, tileTemplate }
}

function snapshotFromTemplate(template) {
  return decodeURIComponent(new URL(template).pathname).split('/')[2]
}

function assertTileCoordinate(zoom, x, y) {
  const scale = 2 ** zoom
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22
    || !Number.isInteger(x) || x < 0 || x >= scale
    || !Number.isInteger(y) || y < 0 || y >= scale) {
    throw new AppError('Koordinat tile basemap tidak valid.', {
      code: 'invalid_basemap_tile',
      statusCode: 400,
    })
  }
}

function decodeFontStack(value) {
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw invalidFontRequest()
  }
  if (!/^[\p{L}\p{N} _-]{1,100}$/u.test(decoded)) throw invalidFontRequest()
  return decoded
}

function assertFontRange(start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end < start || end - start > 255) {
    throw invalidFontRequest()
  }
}

function invalidFontRequest() {
  return new AppError('Permintaan font basemap tidak valid.', {
    code: 'invalid_basemap_font',
    statusCode: 400,
  })
}

function upstreamError(message, cause) {
  return new AppError(message, {
    code: 'basemap_upstream_unavailable',
    statusCode: 502,
    expose: true,
    cause,
  })
}
