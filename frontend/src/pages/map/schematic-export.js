import {
  createZipArchive,
  sanitizeDownloadFilename,
} from '../../utils/zip-archive.js'

export function serializeSchematicSvg(svgElement) {
  const clone = svgElement.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.style.removeProperty('width')
  clone.style.removeProperty('height')
  const viewBox = clone.viewBox.baseVal
  clone.setAttribute('width', String(Math.ceil(viewBox.width)))
  clone.setAttribute('height', String(Math.ceil(viewBox.height)))
  return validateStandaloneSvgMarkup(
    `<?xml version="1.0" encoding="UTF-8"?>\n${
      new XMLSerializer().serializeToString(clone)
    }`,
  )
}

export function downloadSchematicSvg(svgElement, filename) {
  const serializedSvg = serializeSchematicSvg(svgElement)
  downloadBlob(new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

export function downloadSchematicSvgMarkup(svgMarkup, filename) {
  const serializedSvg = serializeSchematicSvgMarkup(svgMarkup)
  downloadBlob(new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

export async function downloadSchematicPng(svgElement, filename, scale = 2) {
  const serializedSvg = serializeSchematicSvg(svgElement)
  return downloadSerializedPng(serializedSvg, svgElement.viewBox.baseVal, filename, scale)
}

export async function downloadSchematicPngMarkup(svgMarkup, filename, scale = 2) {
  const parser = new DOMParser()
  const document = parser.parseFromString(svgMarkup, 'image/svg+xml')
  const svg = document.documentElement
  const viewBox = String(svg.getAttribute('viewBox') || '')
    .split(/\s+/)
    .map(Number)
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new Error('Ukuran halaman diagram tidak valid.')
  }
  const blob = await createSerializedPngBlob(
    serializeSchematicSvgMarkup(svgMarkup),
    { width: viewBox[2], height: viewBox[3] },
    scale,
  )
  downloadBlob(blob, filename)
}

export function serializeSchematicSvgMarkup(svgMarkup) {
  const normalized = String(svgMarkup).trim()
  return validateStandaloneSvgMarkup(normalized.startsWith('<?xml')
    ? normalized
    : `<?xml version="1.0" encoding="UTF-8"?>\n${normalized}`)
}

export function validateStandaloneSvgMarkup(svgMarkup) {
  const value = String(svgMarkup ?? '').trim()
  const viewBox = value.match(
    /<svg\b[^>]*\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["'][^>]*>/i,
  )
  if (!/^<\?xml\b/i.test(value) || !/<svg\b/i.test(value)) {
    throw new Error('SVG standalone harus memiliki deklarasi XML dan root SVG.')
  }
  if (!/<svg\b[^>]*\bxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(value)) {
    throw new Error('SVG standalone tidak memiliki namespace SVG.')
  }
  if (!viewBox || Number(viewBox[1]) <= 0 || Number(viewBox[2]) <= 0) {
    throw new Error('SVG standalone tidak memiliki viewBox yang valid.')
  }
  if (!/<style\b[^>]*>[\s\S]*<\/style>/i.test(value)) {
    throw new Error('SVG standalone harus memuat style internal.')
  }
  if (!/<text\b/i.test(value)) {
    throw new Error('SVG standalone tidak memuat label text.')
  }
  if (/<(?:link|foreignObject)\b/i.test(value)
    || /@import\b/i.test(value)
    || /\b(?:href|src)=["'](?:https?:|file:|javascript:)/i.test(value)) {
    throw new Error('SVG mengandung resource eksternal atau markup yang tidak diizinkan.')
  }
  return value
}

export function createSchematicExportFilename({
  siteName = 'Pengapon',
  scope = 'Diagram',
  version = 'aktif',
  exportedAt = new Date(),
} = {}) {
  const date = new Date(exportedAt)
  const dateToken = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10)
  return sanitizeDownloadFilename(
    `SINERGI_${filenameToken(siteName)}_${filenameToken(scope)}_${
      filenameToken(version)
    }_${dateToken}`,
    `SINERGI_Pengapon_Diagram_${dateToken}`,
  )
}

async function downloadSerializedPng(serializedSvg, viewBox, filename, scale) {
  const blob = await createSerializedPngBlob(serializedSvg, viewBox, scale)
  downloadBlob(blob, filename)
}

export async function createSchematicPngBlobFromMarkup(svgMarkup, scale = 2) {
  const match = String(svgMarkup).match(/viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+([\d.-]+)\s*["']/i)
  if (!match) throw new Error('Ukuran halaman diagram tidak valid.')
  return createSerializedPngBlob(
    serializeSchematicSvgMarkup(svgMarkup),
    { width: Number(match[1]), height: Number(match[2]) },
    normalizeScale(scale),
  )
}

export async function createSchematicMultiPageArchive({
  pages,
  overviewSvg = null,
  format = 'svg',
  scale = 2,
  context = {},
  scope = 'multi-page',
  indexSummary = null,
}) {
  const exportedAt = context.exportedAt || new Date().toISOString()
  const normalizedFormat = format === 'png' ? 'png' : 'svg'
  const entries = []
  const indexPages = []
  const oversizedPage = pages.find((page) => Number(page.nodeCount) > 100)
  if (oversizedPage) {
    throw new Error(
      `Halaman "${oversizedPage.title}" mempunyai lebih dari 100 node. Segmentasi ulang diperlukan.`,
    )
  }
  let overviewFile = null
  if (overviewSvg) {
    const serializedOverview = serializeSchematicSvgMarkup(overviewSvg)
    overviewFile = 'overview.svg'
    entries.push({
      name: overviewFile,
      data: serializedOverview,
    })
    if (normalizedFormat === 'png') {
      const overviewPng = await createSchematicPngBlobFromMarkup(serializedOverview, scale)
      overviewFile = `overview@${normalizeScale(scale)}x.png`
      entries.push({
        name: overviewFile,
        data: new Uint8Array(await overviewPng.arrayBuffer()),
      })
    }
  }
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    const baseName = `diagram-${String(index + 1).padStart(2, '0')}`
    const serialized = serializeSchematicSvgMarkup(page.svg)
    if (normalizedFormat === 'png') {
      const png = await createSchematicPngBlobFromMarkup(serialized, scale)
      entries.push({
        name: `pages/${baseName}@${normalizeScale(scale)}x.png`,
        data: new Uint8Array(await png.arrayBuffer()),
      })
    } else {
      entries.push({ name: `pages/${baseName}.svg`, data: serialized })
    }
    indexPages.push({
      page: index + 1,
      title: page.title,
      nodeCount: page.nodeCount,
      connectionCount: page.connectionCount,
      file: normalizedFormat === 'png'
        ? `pages/${baseName}@${normalizeScale(scale)}x.png`
        : `pages/${baseName}.svg`,
    })
  }
  const manifest = {
    title: 'Export Diagram Skematik 2D SINERGI',
    site: context.siteScopeName || context.branchName || 'Pengapon',
    branch: context.branchId || '',
    datasetVersion: context.version || '',
    scope,
    exportedAt,
    format: normalizedFormat,
    pageCount: pages.length,
    nodeCount: indexPages.reduce((sum, page) => sum + Number(page.nodeCount || 0), 0),
    edgeCount: indexPages.reduce(
      (sum, page) => sum + Number(page.connectionCount || 0),
      0,
    ),
    overviewFile,
    pages: indexPages,
    ...(indexSummary ? {
      segmentation: {
        strategy: indexSummary.strategy || 'connected-component-then-network',
        connectedComponentCount: indexSummary.connectedComponentCount,
        pageCount: indexSummary.pageCount,
      },
    } : {}),
    disclaimer: 'Diagram skematik. Posisi aset telah disederhanakan dan tidak menunjukkan skala geografis.',
  }
  entries.push({ name: 'index.json', data: JSON.stringify(manifest, null, 2) })
  entries.push({ name: 'index.html', data: renderArchiveIndex(manifest) })
  return new Blob([createZipArchive(entries)], { type: 'application/zip' })
}

export function downloadSchematicArchive(blob, filename) {
  downloadBlob(blob, `${sanitizeDownloadFilename(filename, 'diagram-sinergi')}.zip`)
}

async function createSerializedPngBlob(serializedSvg, viewBox, scale) {
  const exportScale = normalizeScale(scale)
  const sourceUrl = URL.createObjectURL(new Blob([serializedSvg], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(sourceUrl)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewBox.width * exportScale)
    canvas.height = Math.ceil(viewBox.height * exportScale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser tidak menyediakan canvas untuk export PNG.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvasToBlob(canvas)
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function normalizeScale(value) {
  const scale = Number(value)
  return [1, 2, 4].includes(scale) ? scale : 2
}

function filenameToken(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'Diagram'
}

function renderArchiveIndex(manifest) {
  const rows = manifest.pages.map((page) => (
    `<li><a href="${escapeHtml(page.file)}">${escapeHtml(page.title)}</a> — ${page.nodeCount} node, ${page.connectionCount} connection</li>`
  )).join('')
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(manifest.title)}</title></head>
<body><main><h1>${escapeHtml(manifest.title)}</h1>
<p>Site ${escapeHtml(manifest.site)} · Branch ${escapeHtml(manifest.branch)} · Dataset ${escapeHtml(manifest.datasetVersion)} · ${escapeHtml(manifest.scope)}</p>
<p>${manifest.nodeCount} node · ${manifest.edgeCount} edge</p>
${manifest.overviewFile
    ? `<p><a href="${escapeHtml(manifest.overviewFile)}">Buka overview index</a></p>`
    : ''}
<p>Diexport ${escapeHtml(manifest.exportedAt)}</p><ol>${rows}</ol>
<p>${escapeHtml(manifest.disclaimer)}</p></main></body></html>`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('SVG tidak dapat dikonversi menjadi PNG.'))
    image.src = url
  })
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG tidak dapat dibuat oleh browser.'))
    }, 'image/png')
  })
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
