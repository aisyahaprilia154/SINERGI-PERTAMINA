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

export function downloadSchematicSvg(svgElement, filename) {
  const serializedSvg = serializeSchematicSvg(svgElement)
  downloadBlob(new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' }), filename)
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

export async function downloadSchematicPng(svgElement, filename, requestedScale = 2) {
  const serializedSvg = serializeSchematicSvg(svgElement)
  const sourceUrl = URL.createObjectURL(new Blob([serializedSvg], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(sourceUrl)
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
    const blob = await canvasToBlob(canvas)
    downloadBlob(blob, filename)
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
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
