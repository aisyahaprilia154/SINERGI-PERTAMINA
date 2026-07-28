import { escapeAttribute, escapeHtml } from './import-view-utils.js'
import { extractPositions } from './preview-import-state.js'

const WIDTH = 1200
const HEIGHT = 780
const IMPORTANT_TYPES = new Set([
  'switch',
  'otb',
  'junction box',
  'junction box cctv',
  'nvr',
  'server',
])

export function renderPreviewMapCanvas({ visible, state }) {
  const baseBounds = state.focusBounds ?? visible.bounds
  if (!baseBounds) {
    return `
      <div class="preview-map-empty" role="status">
        <span class="material-symbols-outlined" aria-hidden="true">location_off</span>
        <strong>Tidak ada geometri yang dapat ditampilkan</strong>
        <p>Ubah filter atau periksa laporan validasi dataset.</p>
      </div>
    `
  }
  const bounds = zoomBounds(baseBounds, state.zoom)
  const projection = createProjection(bounds)
  const assetsByNode = new Map(visible.assets.map((asset) => [asset.id, asset]))
  const traced = state.traceAssetIds
  const labels = createLabelCollector()
  const rendered = visible.geometries.map((geometry) => {
    const asset = assetsByNode.get(geometry.assetNodeId)
    if (!asset) return ''
    return renderGeometry(geometry, asset, projection, state, labels)
  }).join('')
  const logicalRelations = state.traceAssetIds.size
    ? renderTraceRelations(visible, projection, traced)
    : ''

  return `
    <svg class="import-preview-map-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}"
      role="img" aria-label="Peta preview dataset import">
      <defs>
        <pattern id="preview-map-grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" stroke-width="1"/>
        </pattern>
        <filter id="preview-label-halo" x="-20%" y="-30%" width="140%" height="160%">
          <feMorphology in="SourceAlpha" result="DILATED" operator="dilate" radius="2"/>
          <feFlood flood-color="#ffffff" result="WHITE"/>
          <feComposite in="WHITE" in2="DILATED" operator="in" result="OUTLINE"/>
          <feMerge><feMergeNode in="OUTLINE"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" class="preview-map-background"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#preview-map-grid)" class="preview-map-grid"/>
      <g class="preview-geometries">${rendered}</g>
      <g class="preview-logical-relations">${logicalRelations}</g>
      <g class="preview-map-labels">${labels.render()}</g>
    </svg>
    <div class="preview-map-context-pill">
      <span class="material-symbols-outlined" aria-hidden="true">apartment</span>
      <strong>${escapeHtml(visible.source.assets[0]?.branchId || 'Kantor cabang')}</strong>
      <i aria-hidden="true"></i>
      <span>${state.viewMode === 'active' ? 'Dataset aktif' : 'Dataset baru'}</span>
      <i aria-hidden="true"></i>
      <span><span class="material-symbols-outlined" aria-hidden="true">lock</span> Read-only</span>
    </div>
    <div class="preview-map-controls" aria-label="Kontrol zoom peta">
      <button type="button" data-preview-zoom-in aria-label="Perbesar peta" title="Perbesar">
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
      <button type="button" data-preview-zoom-out aria-label="Perkecil peta" title="Perkecil">
        <span class="material-symbols-outlined" aria-hidden="true">remove</span>
      </button>
      <button type="button" data-preview-fit aria-label="Fit seluruh data" title="Fit seluruh data">
        <span class="material-symbols-outlined" aria-hidden="true">fit_screen</span>
      </button>
    </div>
    <button type="button" class="preview-mobile-sidebar-button" data-open-preview-sidebar
      aria-label="Buka filter preview">
      <span class="material-symbols-outlined" aria-hidden="true">tune</span>
    </button>
    ${renderChangeLegend(state)}
  `
}

function renderGeometry(geometry, asset, project, state, labels) {
  if (geometry.geometryType === 'multi_geometry') {
    return (geometry.coordinates ?? []).map((child, index) => renderGeometry({
      id: `${geometry.id}:${index}`,
      assetNodeId: geometry.assetNodeId,
      geometryType: child.geometryType,
      coordinates: child.coordinates,
    }, asset, project, state, labels)).join('')
  }
  const isSelected = asset.assetId === state.selectedAssetId
  const isTraced = state.traceAssetIds.has(asset.assetId)
  const isDimmed = state.traceAssetIds.size > 0 && !isTraced
  const classes = [
    'preview-map-object',
    `category-${categoryClass(asset.category)}`,
    `change-${asset.changeStatus}`,
    isSelected ? 'is-selected' : '',
    isTraced ? 'is-traced' : '',
    isDimmed ? 'is-dimmed' : '',
    asset.issues.length ? 'has-issue' : '',
  ].filter(Boolean).join(' ')
  const common = `
    class="${classes}"
    data-preview-asset="${escapeAttribute(asset.assetId)}"
    tabindex="0" role="button"
    aria-label="${escapeAttribute(`${asset.assetId}, ${asset.name || 'tanpa nama'}, ${asset.type || 'aset'}`)}"
  `
  const title = `<title>${escapeHtml(asset.assetId)} · ${escapeHtml(asset.name || 'Tanpa nama')} · ${escapeHtml(asset.type || 'Aset')} · ${escapeHtml(asset.location || 'Lokasi tidak tersedia')}</title>`
  if (geometry.geometryType === 'point') {
    const point = project(geometry.coordinates)
    if (!point) return ''
    const important = IMPORTANT_TYPES.has(String(asset.type ?? '').toLowerCase())
    const size = important ? 10 : 8
    if (isSelected || important || state.zoom >= 2.1) labels.add(asset, point)
    return `
      <g ${common} transform="translate(${round(point.x)} ${round(point.y)})">
        ${title}
        <circle class="node-hit-area" r="18"/>
        ${nodeShape(asset.type, size)}
        ${asset.issues.length ? '<path class="node-issue-flag" d="M 7 -12 L 16 -12 L 16 -3 L 7 -3 Z"/>' : ''}
        ${changeGlyph(asset.changeStatus)}
      </g>
    `
  }
  if (geometry.geometryType === 'line_string') {
    const positions = simplifyPositions(geometry.coordinates, state.zoom)
      .map(project).filter(Boolean)
    if (positions.length < 2) return ''
    const path = positions.map((point, index) => (
      `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`
    )).join(' ')
    return `
      <g ${common}>${title}
        <path class="network-line-hit" d="${path}"/>
        <path class="network-line-visible" d="${path}"/>
        ${lineChangeGlyph(asset, positions)}
      </g>
    `
  }
  if (geometry.geometryType === 'polygon') {
    const paths = (geometry.coordinates ?? []).map((ring) => {
      const points = simplifyPositions(ring, state.zoom).map(project).filter(Boolean)
      return points.map((point, index) => (
        `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`
      )).join(' ') + ' Z'
    }).join(' ')
    if (!paths.trim()) return ''
    return `
      <path class="${classes} network-polygon"
        data-preview-asset="${escapeAttribute(asset.assetId)}"
        tabindex="0" role="button"
        aria-label="${escapeAttribute(`${asset.assetId}, ${asset.name || 'tanpa nama'}, polygon`)}"
        d="${paths}">${title}</path>
    `
  }
  return ''
}

function renderTraceRelations(visible, project, traced) {
  const pointByAssetId = new Map()
  visible.assets.forEach((asset) => {
    if (!traced.has(asset.assetId)) return
    const geometry = visible.source.geometriesByAssetNode.get(asset.id)
      ?.find(({ geometryType }) => geometryType === 'point')
    const point = geometry ? project(geometry.coordinates) : null
    if (point) pointByAssetId.set(asset.assetId, point)
  })
  return visible.relations.map((relation) => {
    if (!traced.has(relation.sourceAssetId) || !traced.has(relation.targetAssetId)) return ''
    const source = pointByAssetId.get(relation.sourceAssetId)
    const target = pointByAssetId.get(relation.targetAssetId)
    if (!source || !target) return ''
    return `
      <line x1="${round(source.x)}" y1="${round(source.y)}"
        x2="${round(target.x)}" y2="${round(target.y)}">
        <title>${escapeHtml(relation.sourceAssetId)} → ${escapeHtml(relation.targetAssetId)} · ${escapeHtml(relation.relationType)}</title>
      </line>
    `
  }).join('')
}

function createProjection(bounds) {
  const longitudeSpan = Math.max(bounds.east - bounds.west, 0.000001)
  const latitudeSpan = Math.max(bounds.north - bounds.south, 0.000001)
  const padding = 42
  return (position) => {
    if (!Array.isArray(position) || !Number.isFinite(Number(position[0]))
      || !Number.isFinite(Number(position[1]))) return null
    return {
      x: padding + ((Number(position[0]) - bounds.west) / longitudeSpan) * (WIDTH - padding * 2),
      y: padding + ((bounds.north - Number(position[1])) / latitudeSpan) * (HEIGHT - padding * 2),
    }
  }
}

function zoomBounds(bounds, zoom) {
  const factor = Math.max(1, Math.min(4, zoom))
  if (factor === 1) return bounds
  const centerLongitude = (bounds.west + bounds.east) / 2
  const centerLatitude = (bounds.south + bounds.north) / 2
  const halfLongitude = (bounds.east - bounds.west) / (2 * factor)
  const halfLatitude = (bounds.north - bounds.south) / (2 * factor)
  return {
    west: centerLongitude - halfLongitude,
    east: centerLongitude + halfLongitude,
    south: centerLatitude - halfLatitude,
    north: centerLatitude + halfLatitude,
  }
}

function simplifyPositions(positions = [], zoom) {
  if (zoom > 1.25 || positions.length <= 80) return positions
  const stride = Math.max(1, Math.ceil(positions.length / 80))
  const simplified = positions.filter((_, index) => index % stride === 0)
  if (simplified.at(-1) !== positions.at(-1)) simplified.push(positions.at(-1))
  return simplified
}

function nodeShape(type, size) {
  const compact = String(type ?? '').toLowerCase()
  if (compact.includes('cctv')) {
    return `<path class="node-symbol" d="M ${-size} -5 H 5 V 4 H ${-size} Z M 5 -3 L ${size + 4} -7 V 7 L 5 3 Z"/>`
  }
  if (compact.includes('switch') || compact.includes('otb') || compact.includes('junction')) {
    return `<rect class="node-symbol connector-node" x="${-size}" y="${-size}" width="${size * 2}" height="${size * 2}" rx="3"/>`
  }
  if (compact.includes('server') || compact.includes('nvr')) {
    return `<path class="node-symbol connector-node" d="M ${-size} ${-size} H ${size} V ${size} H ${-size} Z M ${-size + 3} -3 H ${size - 3} M ${-size + 3} 3 H ${size - 3}"/>`
  }
  if (compact.includes('printer')) {
    return `<path class="node-symbol" d="M -8 -7 H 8 V -1 H 11 V 7 H 7 V 11 H -7 V 7 H -11 V -1 H -8 Z"/>`
  }
  if (compact.includes('access')) {
    return '<path class="node-symbol" d="M -9 -2 Q 0 -11 9 -2 M -5 2 Q 0 -3 5 2 M 0 7 V 7"/>'
  }
  return `<circle class="node-symbol" r="${size}"/>`
}

function changeGlyph(status) {
  if (status === 'unchanged') return ''
  const glyph = { new: '+', updated: '↻', removed: '×' }[status] ?? ''
  return `<g class="node-change-glyph"><circle cx="-12" cy="-12" r="7"/><text x="-12" y="-9">${glyph}</text></g>`
}

function lineChangeGlyph(asset, points) {
  if (asset.changeStatus === 'unchanged' || !points.length) return ''
  const point = points[Math.floor(points.length / 2)]
  const glyph = { new: '+', updated: '↻', removed: '×' }[asset.changeStatus] ?? ''
  return `<g class="line-change-glyph" transform="translate(${round(point.x)} ${round(point.y)})"><circle r="8"/><text y="3">${glyph}</text></g>`
}

function createLabelCollector() {
  const occupied = new Set()
  const entries = []
  return {
    add(asset, point) {
      const key = `${Math.round(point.x / 90)}:${Math.round(point.y / 34)}`
      if (occupied.has(key)) return
      occupied.add(key)
      entries.push({ asset, point })
    },
    render() {
      return entries.map(({ asset, point }) => `
        <text x="${round(point.x + 13)}" y="${round(point.y - 11)}"
          filter="url(#preview-label-halo)">${escapeHtml(asset.assetId)}</text>
      `).join('')
    },
  }
}

function renderChangeLegend(state) {
  if (!state.showChanges || state.viewMode === 'active') return ''
  return `
    <div class="preview-change-legend" aria-label="Legenda perubahan">
      <strong>Perubahan</strong>
      <span class="change-new"><i>+</i> Baru</span>
      <span class="change-updated"><i>↻</i> Diperbarui</span>
      <span class="change-unchanged"><i>✓</i> Tidak berubah</span>
      <span class="change-removed"><i>×</i> Tidak tersedia</span>
    </div>
  `
}

function categoryClass(value) {
  const compact = String(value ?? 'unmapped').toLowerCase()
  if (compact.includes('fiber') || compact === 'fo') return 'fiber-optic'
  if (compact.includes('cctv')) return 'cctv'
  if (compact.includes('lan')) return 'lan'
  if (compact.includes('peripheral')) return 'peripheral'
  return 'infrastructure'
}

function round(value) {
  return Number(value.toFixed(2))
}

export const previewMapInternals = {
  simplifyPositions,
  zoomBounds,
}
