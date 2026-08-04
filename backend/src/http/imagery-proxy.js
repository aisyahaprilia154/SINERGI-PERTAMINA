import { AppError } from '../errors.js'

const LOCAL_BASE_PATH = '/api/basemap/imagery'
const MAX_TILE_BYTES = 8 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 10_000
const UPSTREAM_MAX_ATTEMPTS = 2
const UPSTREAM_RETRY_DELAY_MS = 120

export function createImageryProxy({
  fetchImpl = globalThis.fetch,
  tileTemplate,
} = {}) {
  const normalizedTemplate = normalizeTileTemplate(tileTemplate)

  return {
    async handle(pathname, response) {
      const tileMatch = pathname.match(
        /^\/api\/basemap\/imagery\/tiles\/(\d{1,2})\/(\d+)\/(\d+)\.(?:jpg|jpeg|png|webp)$/,
      )
      if (!tileMatch) return false
      if (!normalizedTemplate) {
        throw upstreamError('Layanan citra satelit belum dikonfigurasi.')
      }

      const [zoom, x, y] = tileMatch.slice(1).map(Number)
      assertTileCoordinate(zoom, x, y)
      const upstreamUrl = normalizedTemplate
        .replaceAll('{z}', String(zoom))
        .replaceAll('{x}', String(x))
        .replaceAll('{y}', String(y))
      const upstream = await fetchUpstream(upstreamUrl, fetchImpl)
      const contentType = normalizeImageContentType(upstream.headers.get('content-type'))
      if (!contentType) {
        await upstream.body?.cancel().catch(() => {})
        throw upstreamError('Provider citra satelit mengirim format tile yang tidak didukung.')
      }
      const bytes = await readBoundedBody(upstream, MAX_TILE_BYTES)
      response.writeHead(200, {
        'content-type': contentType,
        'content-length': String(bytes.length),
        'cache-control': 'public, max-age=86400',
      })
      response.end(bytes)
      return true
    },
  }
}

function normalizeTileTemplate(value) {
  const template = String(value ?? '').trim()
  if (!template) return null
  if (template.length > 2048
    || !['{z}', '{x}', '{y}'].every((placeholder) => template.includes(placeholder))) {
    throw invalidConfiguration()
  }
  let url
  try {
    url = new URL(template)
  } catch {
    throw invalidConfiguration()
  }
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw invalidConfiguration()
  }
  return template
}

async function fetchUpstream(url, fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw upstreamError('Layanan citra satelit belum dikonfigurasi.')
  }
  let lastError = null
  for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt += 1) {
    let response
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' },
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
    lastError = new Error(`Provider citra satelit merespons ${response.status}.`)
    if (attempt < UPSTREAM_MAX_ATTEMPTS && isRetryableStatus(response.status)) {
      await response.body?.cancel().catch(() => {})
      await delay(UPSTREAM_RETRY_DELAY_MS)
      continue
    }
    throw upstreamError(lastError.message, lastError)
  }
  throw upstreamError('Provider citra satelit tidak dapat dihubungi.', lastError)
}

function normalizeImageContentType(value) {
  const contentType = String(value ?? '').split(';', 1)[0].trim().toLowerCase()
  return ['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
    ? contentType
    : null
}

async function readBoundedBody(response, maxBytes) {
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw upstreamError('Tile citra satelit melebihi batas ukuran.')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) {
    throw upstreamError('Tile citra satelit melebihi batas ukuran.')
  }
  return bytes
}

function assertTileCoordinate(zoom, x, y) {
  const scale = 2 ** zoom
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22
    || !Number.isInteger(x) || x < 0 || x >= scale
    || !Number.isInteger(y) || y < 0 || y >= scale) {
    throw new AppError('Koordinat tile citra satelit tidak valid.', {
      code: 'invalid_imagery_tile',
      statusCode: 400,
    })
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function invalidConfiguration() {
  return new AppError('Template tile citra satelit tidak valid.', {
    code: 'invalid_imagery_configuration',
    statusCode: 500,
    expose: true,
  })
}

function upstreamError(message, cause) {
  return new AppError(message, {
    code: 'imagery_upstream_unavailable',
    statusCode: 502,
    expose: true,
    cause,
  })
}
