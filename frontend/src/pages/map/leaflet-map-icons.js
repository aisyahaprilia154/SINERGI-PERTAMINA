import {
  getAssetRenderLabels,
  truncateAssetLabel,
} from '../../domain/asset-display-name.js'

const TYPE_GLYPHS = Object.freeze({
  CCTV: 'C',
  OTB: 'O',
  Server: 'S',
  NVR: 'N',
  'Junction box': 'J',
  'Core switch': 'S',
  'Distribution switch': 'S',
  'Access switch': 'S',
  'Access point': 'A',
  Printer: 'P',
})

export function createLeafletAssetIcon(leaflet, {
  asset,
  color,
  selected = false,
  connected = false,
  traceRole = null,
  muted = false,
  selectable = true,
  zoomTier = 'medium',
  visualOffset = null,
  showLabel = false,
  important = false,
  isolated = false,
}) {
  const size = markerSize(zoomTier, important, selected)
  const labels = getAssetRenderLabels(asset, { shortMax: 18, displayMax: 48 })
  const offset = normalizeVisualOffset(visualOffset)
  const classNames = [
    'sinergi-leaflet-marker',
    `asset-type-${safeClassName(asset.type)}`,
    selected ? 'is-selected' : '',
    connected ? 'is-connected' : '',
    traceRole ? 'is-trace-endpoint' : '',
    traceRole === 'start' ? 'is-trace-start' : '',
    traceRole === 'end' ? 'is-trace-end' : '',
    muted ? 'is-muted' : '',
    selectable ? '' : 'is-disabled',
    isolated ? 'is-isolated' : '',
    asset.hasIssue ? 'has-issue' : '',
  ].filter(Boolean).join(' ')

  return leaflet.divIcon({
    className: 'sinergi-leaflet-div-icon',
    html: `
      <span class="${classNames}" style="
        --asset-color:${escapeAttribute(color)};
        --marker-offset-x:${offset.offsetX}px;
        --marker-offset-y:${offset.offsetY}px;
      ">
        ${offset.displaced ? `
          <span class="asset-marker-leader" aria-hidden="true" style="
            --leader-length:${offset.leaderLength}px;
            --leader-angle:${offset.leaderAngle}deg;
          "></span>
        ` : ''}
        <span class="asset-marker-symbol" aria-hidden="true">
          <span class="asset-marker-glyph">${escapeHtml(TYPE_GLYPHS[asset.type] || '•')}</span>
        </span>
        ${traceRole ? `
          <span class="asset-marker-trace-role" aria-hidden="true">
            ${traceRole === 'start' ? 'A' : 'T'}
          </span>
        ` : ''}
        ${asset.hasIssue ? '<span class="asset-marker-issue" aria-hidden="true">!</span>' : ''}
        ${showLabel ? `<span class="asset-marker-label">${escapeHtml(labels.shortLabel)}</span>` : ''}
      </span>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -(size / 2 + 6)],
  })
}

export function createLeafletAssetTooltip(asset) {
  const labels = getAssetRenderLabels(asset, {
    shortMax: 18,
    displayMax: 48,
  })
  return `
    <strong>${escapeHtml(labels.fullShortLabel)}</strong>
    <span>${escapeHtml(labels.fullDisplayName)}</span>
    <small>${escapeHtml(asset.type)} · ${escapeHtml(
      truncateAssetLabel(asset.location, 42),
    )}</small>
  `
}

export function assetMarkerTitle(asset) {
  const labels = getAssetRenderLabels(asset, {
    shortMax: 18,
    displayMax: 48,
  })
  return `${labels.fullShortLabel} — ${labels.fullDisplayName}`
}

function markerSize(tier, important, selected) {
  const selectedAdjustment = selected ? 4 : 0
  if (tier === 'low') return (important ? 26 : 22) + selectedAdjustment
  if (tier === 'high') return (important ? 34 : 30) + selectedAdjustment
  return (important ? 30 : 26) + selectedAdjustment
}

function normalizeVisualOffset(value) {
  const read = (key) => {
    const number = Number(value?.[key])
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
  }
  return {
    offsetX: read('offsetX'),
    offsetY: read('offsetY'),
    leaderLength: read('leaderLength'),
    leaderAngle: read('leaderAngle'),
    displaced: Boolean(value?.displaced),
  }
}

function safeClassName(value) {
  return String(value ?? 'asset')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'asset'
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;')
}
