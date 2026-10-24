import { SCHEMATIC_THEME } from './schematic-theme.js'

export function serializeSchematicSvg(svgElement) {
  const clone = svgElement.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.style.removeProperty('width')
  clone.style.removeProperty('height')
  const viewBox = clone.viewBox.baseVal
  clone.setAttribute('width', String(Math.ceil(viewBox.width)))
  clone.setAttribute('height', String(Math.ceil(viewBox.height)))
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`
}

export function downloadSchematicSvg(svgElement, filename, options = {}) {
  options.signal?.throwIfAborted()
  const serializedSvg = serializeSchematicSvg(svgElement)
  downloadBlob(new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' }), filename, options)
}

export function calculateSafePngScale({
  width,
  height,
  requestedScale = 2,
  maxDimension = 8192,
  maxPixelCount = 40_000_000,
}) {
  if (!(width > 0) || !(height > 0)) return 1
  return Math.max(.1, Math.min(
    requestedScale,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxPixelCount / (width * height)),
  ))
}

export async function downloadSchematicPng(svgElement, filename, requestedScale = 2, options = {}) {
  const {signal} = options; signal?.throwIfAborted()
  const serializedSvg = serializeSchematicSvg(svgElement)
  const sourceUrl = URL.createObjectURL(new Blob([serializedSvg], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(sourceUrl, signal)
    const viewBox = svgElement.viewBox.baseVal
    const scale = calculateSafePngScale({
      width: viewBox.width,
      height: viewBox.height,
      requestedScale,
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewBox.width * scale)
    canvas.height = Math.ceil(viewBox.height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser tidak menyediakan canvas untuk export PNG.')
    context.fillStyle = SCHEMATIC_THEME.background
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await canvasToBlob(canvas, signal)
    downloadBlob(blob, filename, options)
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); image.src = ''; reject(signal.reason) }
    image.onload = () => { cleanup(); resolve(image) }
    image.onerror = () => { cleanup(); reject(new Error('SVG tidak dapat dikonversi menjadi PNG.')) }
    signal?.addEventListener('abort', abort, {once:true})
    if (signal?.aborted) { abort(); return }
    image.src = url
  })
}
function canvasToBlob(canvas, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal?.removeEventListener('abort', abort); reject(signal.reason) }
    signal?.addEventListener('abort', abort, {once:true})
    if (signal?.aborted) { abort(); return }
    canvas.toBlob(blob => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return
      if (blob) resolve(blob)
      else reject(new Error('PNG tidak dapat dibuat oleh browser.'))
    }, 'image/png')
  })
}

function downloadBlob(blob, filename, options = {}) {
  options.signal?.throwIfAborted()
  if (options.saveBlob) { options.saveBlob(blob, filename); return }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
