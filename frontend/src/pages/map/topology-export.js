import { SCHEMATIC_THEME } from './schematic-theme.js'

export function getPngDimensions(viewBox, scale = 2) {
  const normalizedScale = [1, 2, 4].includes(Number(scale)) ? Number(scale) : 2
  return { width: Math.ceil(viewBox.width * normalizedScale), height: Math.ceil(viewBox.height * normalizedScale), scale: normalizedScale }
}

export function serializeTopologySvg(svgElement) {
  const clone = svgElement.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.style.removeProperty('width')
  clone.style.removeProperty('height')
  const viewBox = clone.viewBox.baseVal
  clone.setAttribute('width', String(Math.ceil(viewBox.width)))
  clone.setAttribute('height', String(Math.ceil(viewBox.height)))
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`
}

export function downloadTopologySvg(svgElement, filename) {
  downloadBlob(new Blob([serializeTopologySvg(svgElement)], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

export async function downloadTopologyPng(svgElement, filename, scale = 2) {
  const serialized = serializeTopologySvg(svgElement)
  const sourceUrl = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(sourceUrl)
    const dimensions = getPngDimensions(svgElement.viewBox.baseVal, scale)
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser tidak menyediakan canvas untuk export PNG.')
    context.fillStyle = SCHEMATIC_THEME.backgroundSubtle
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    downloadBlob(await canvasToBlob(canvas), filename)
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
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG tidak dapat dibuat oleh browser.')), 'image/png'))
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
