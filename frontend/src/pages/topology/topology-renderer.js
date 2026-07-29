const CATEGORY_COLORS = Object.freeze({
  cctv: '#6f6de8',
  'fiber-optic': '#26a985',
  lan: '#708196',
  infrastructure: '#c58722',
  peripheral: '#8a65d8',
  unmapped: '#7b8794',
})

export function renderTopologySvg(layout, {
  labelMode = 'auto',
  zoom = 1,
} = {}) {
  const showAutoLabels = zoom >= 0.72
  const showLabels = labelMode === 'all' || (labelMode === 'auto' && showAutoLabels)
  const edges = layout.edges.map(renderEdge).join('')
  const nodes = layout.nodes.map((node) => renderNode(node, showLabels)).join('')
  return `
    <svg class="topology-svg" viewBox="0 0 ${layout.width} ${layout.height}"
      width="${layout.width}" height="${layout.height}"
      role="img" aria-label="Graph topologi cabang terkonfirmasi">
      <style>
        .topology-edge{fill:none;stroke:#4d78a8;stroke-width:2.5}
        .topology-edge.traced{stroke:#0d67d1;stroke-width:5}
        .topology-edge.dimmed,.topology-node.dimmed{opacity:.14}
        .node-card{fill:#fff;stroke:#cbd6df;stroke-width:1.5}
        .topology-node.core .node-card{stroke:#314d6c;stroke-width:2.5}
        .topology-node.selected .node-card{stroke:#0d67d1;stroke-width:4}
        .topology-node.neighbor .node-card{stroke-dasharray:5 3}
        .node-name{fill:#172231;font:650 12px Arial,sans-serif}
        .node-id{fill:#69778a;font:10px Arial,sans-serif}
        .node-badge circle{fill:#d38b1f;stroke:#fff;stroke-width:2}
        .node-badge text{fill:#fff;font:700 9px Arial,sans-serif;text-anchor:middle}
      </style>
      <g class="topology-edges">${edges}</g>
      <g class="topology-nodes">${nodes}</g>
    </svg>
  `
}

export function renderSpatialTopologySvg(layout, {
  labelMode = 'auto',
  zoom = 1,
  showCandidates = true,
  showUnresolved = true,
  minimap = false,
} = {}) {
  const showLabels = !minimap && (
    labelMode === 'all'
    || (labelMode === 'auto' && zoom >= 0.72)
  )
  const paths = layout.paths.map(renderSpatialPath).join('')
  const candidates = showCandidates && !minimap
    ? layout.candidates.map((candidate) => renderCandidate(candidate, zoom)).join('')
    : ''
  const unresolved = showUnresolved && !minimap
    ? layout.unresolved.map(renderUnresolvedEndpoint).join('')
    : ''
  const nodes = layout.nodes.map((node) => renderSpatialNode(node, showLabels, minimap)).join('')
  return `
    <svg class="topology-svg spatial-topology-svg${minimap ? ' minimap-svg' : ''}"
      viewBox="0 0 ${round(layout.width)} ${round(layout.height)}"
      width="${round(layout.width)}" height="${round(layout.height)}"
      role="img" aria-label="Peta topologi spasial berdasarkan koordinat sumber">
      <defs>
        <pattern id="spatial-grid-small" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#243445" stroke-width=".7"/>
        </pattern>
        <pattern id="spatial-grid-large" width="120" height="120" patternUnits="userSpaceOnUse">
          <rect width="120" height="120" fill="url(#spatial-grid-small)"/>
          <path d="M 120 0 L 0 0 0 120" fill="none" stroke="#32475b" stroke-width="1"/>
        </pattern>
        <filter id="spatial-node-shadow" x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#020711" flood-opacity=".7"/>
        </filter>
        <filter id="candidate-glow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <style>
        .spatial-bg{fill:#101923}
        .spatial-grid{fill:url(#spatial-grid-large);opacity:.72}
        .source-path-casing,.source-path-line,.candidate-line,.candidate-hit{
          fill:none;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke
        }
        .source-path-casing{stroke:#07111c;stroke-width:7}
        .source-path-line{stroke-width:3}
        .source-path.confirmed .source-path-line{stroke-width:4}
        .source-path.dimmed,.spatial-node.dimmed,.spatial-candidate.dimmed,
        .unresolved-endpoint.dimmed{opacity:.11}
        .spatial-node{cursor:pointer}
        .spatial-node .node-hit{fill:transparent}
        .spatial-node .node-ring{fill:#101923;stroke-width:2.5;vector-effect:non-scaling-stroke}
        .spatial-node .node-core{stroke:#eaf1f7;stroke-width:1.3;vector-effect:non-scaling-stroke}
        .spatial-node.selected .node-ring{stroke:#fff;stroke-width:4}
        .spatial-node.selected .node-selection{opacity:1}
        .node-selection{fill:none;stroke:#5ba4f5;stroke-width:2;opacity:0;vector-effect:non-scaling-stroke}
        .spatial-node:focus{outline:none}
        .spatial-node:focus .node-selection{opacity:1}
        .spatial-node .node-glyph{fill:#f8fafc;font:800 7px Arial,sans-serif;text-anchor:middle}
        .spatial-node .node-label{fill:#e6edf5;font:650 11px Arial,sans-serif}
        .spatial-node .node-meta{fill:#8fa3b8;font:9px Arial,sans-serif}
        .candidate-line{stroke-width:2.5;stroke-dasharray:7 5}
        .candidate-hit{stroke:transparent;stroke-width:18;cursor:pointer}
        .spatial-candidate{cursor:pointer}
        .spatial-candidate .endpoint-dot{fill:#101923;stroke-width:2.5;vector-effect:non-scaling-stroke}
        .spatial-candidate.selected .candidate-line{stroke-width:4;filter:url(#candidate-glow)}
        .spatial-candidate.selected .endpoint-dot{stroke-width:4}
        .candidate-score-bg{fill:#1d2a38;stroke:#53677b;stroke-width:1}
        .candidate-score{fill:#f8fafc;font:750 9px Arial,sans-serif;text-anchor:middle}
        .unresolved-endpoint{cursor:pointer}
        .unresolved-endpoint .unresolved-ring{fill:#101923;stroke:#ef6b72;stroke-width:2;stroke-dasharray:3 2;vector-effect:non-scaling-stroke}
        .unresolved-endpoint .unresolved-cross{stroke:#ef6b72;stroke-width:2;vector-effect:non-scaling-stroke}
        .unresolved-endpoint.selected .unresolved-ring{stroke:#fff;stroke-width:3}
        .node-candidate-badge{fill:#d99a2b;stroke:#101923;stroke-width:2;vector-effect:non-scaling-stroke}
        .node-candidate-count{fill:#fff;font:800 8px Arial,sans-serif;text-anchor:middle}
        .minimap-svg .spatial-grid{opacity:.25}
        .minimap-svg .source-path-casing{stroke-width:2}
        .minimap-svg .source-path-line{stroke-width:1}
      </style>
      <rect class="spatial-bg" width="${round(layout.width)}" height="${round(layout.height)}"/>
      <rect class="spatial-grid" width="${round(layout.width)}" height="${round(layout.height)}"/>
      <g class="spatial-source-paths">${paths}</g>
      <g class="spatial-candidates">${candidates}</g>
      <g class="spatial-unresolved">${unresolved}</g>
      <g class="spatial-nodes">${nodes}</g>
    </svg>
  `
}

export function topologyNeighborList(viewModel, selectedAssetId) {
  if (!selectedAssetId) return []
  const nodeById = new Map(viewModel.nodes.map((node) => [node.id, node]))
  return viewModel.edges.flatMap((edge) => {
    if (edge.sourceId === selectedAssetId) return [nodeById.get(edge.targetId)]
    if (edge.targetId === selectedAssetId) return [nodeById.get(edge.sourceId)]
    return []
  }).filter(Boolean)
}

function renderSpatialPath(path) {
  const points = path.points.map(({ x, y }) => `${round(x)},${round(y)}`).join(' ')
  const classes = [
    'source-path',
    path.confirmed ? 'confirmed' : '',
    path.dimmed ? 'dimmed' : '',
  ].filter(Boolean).join(' ')
  return `<g class="${classes}" data-source-path-id="${escapeHtml(path.id)}">
    <title>${escapeHtml(path.name)} · geometri sumber, posisi tidak diubah</title>
    <polyline class="source-path-casing" points="${points}"/>
    <polyline class="source-path-line" points="${points}" stroke="${path.color}"/>
  </g>`
}

function renderSpatialNode(node, showLabel, minimap) {
  if (minimap) {
    return `<circle cx="${round(node.x)}" cy="${round(node.y)}" r="3"
      fill="${node.color}" opacity="${node.dimmed ? '.12' : '.9'}"/>`
  }
  const classes = [
    'spatial-node',
    node.selected ? 'selected' : '',
    node.dimmed ? 'dimmed' : '',
  ].filter(Boolean).join(' ')
  const label = showLabel || node.selected
    ? `<text x="${round(node.x + 15)}" y="${round(node.y - 3)}" class="node-label">${
      escapeHtml(shorten(node.name, 24))
    }</text>
      <text x="${round(node.x + 15)}" y="${round(node.y + 10)}" class="node-meta">${
        escapeHtml(categoryLabel(node.family))
      } · ${node.degree} confirmed</text>`
    : ''
  return `<g class="${classes}" tabindex="0" role="button"
      aria-label="${escapeHtml(`${node.name}, ${node.type}, ${node.degree} koneksi terkonfirmasi`)}"
      data-node-id="${escapeHtml(node.id)}">
    <title>${escapeHtml(node.name)} · ${escapeHtml(node.type)} · posisi asli sumber</title>
    <circle class="node-hit" cx="${round(node.x)}" cy="${round(node.y)}" r="16"/>
    <circle class="node-selection" cx="${round(node.x)}" cy="${round(node.y)}" r="14"/>
    <circle class="node-ring" cx="${round(node.x)}" cy="${round(node.y)}" r="9"
      stroke="${node.color}" filter="url(#spatial-node-shadow)"/>
    <circle class="node-core" cx="${round(node.x)}" cy="${round(node.y)}" r="5.5"
      fill="${node.color}"/>
    <text class="node-glyph" x="${round(node.x)}" y="${round(node.y + 2.6)}">${
      escapeHtml(nodeGlyph(node.family))
    }</text>
    ${label}
    ${node.candidateCount ? `
      <circle class="node-candidate-badge" cx="${round(node.x + 9)}" cy="${round(node.y - 9)}" r="7"/>
      <text class="node-candidate-count" x="${round(node.x + 9)}" y="${round(node.y - 6.2)}">${
        node.candidateCount > 9 ? '9+' : node.candidateCount
      }</text>` : ''}
  </g>`
}

function renderCandidate(candidate, zoom) {
  const classes = [
    'spatial-candidate',
    candidate.candidateStatus,
    candidate.selected ? 'selected' : '',
    candidate.dimmed ? 'dimmed' : '',
  ].filter(Boolean).join(' ')
  const midpoint = {
    x: (candidate.source.x + candidate.target.x) / 2,
    y: (candidate.source.y + candidate.target.y) / 2,
  }
  const showScore = candidate.selected || zoom >= 1.18
  const score = Math.round((candidate.score ?? 0) * 100)
  return `<g class="${classes}" tabindex="0" role="button"
      aria-label="${escapeHtml(`Review ${candidate.sourceName} ke ${candidate.targetName}, score ${score}%`)}"
      data-candidate-id="${escapeHtml(candidate.candidateId)}">
    <title>${escapeHtml(candidate.sourceName)} → ${escapeHtml(candidate.targetName)} · ${
      score
    }% · perlu konfirmasi</title>
    <line class="candidate-line" x1="${round(candidate.source.x)}" y1="${round(candidate.source.y)}"
      x2="${round(candidate.target.x)}" y2="${round(candidate.target.y)}"
      stroke="${candidate.color}"/>
    <line class="candidate-hit" x1="${round(candidate.source.x)}" y1="${round(candidate.source.y)}"
      x2="${round(candidate.target.x)}" y2="${round(candidate.target.y)}"/>
    <circle class="endpoint-dot" cx="${round(candidate.source.x)}" cy="${round(candidate.source.y)}"
      r="5" stroke="${candidate.color}"/>
    <circle class="endpoint-dot" cx="${round(candidate.target.x)}" cy="${round(candidate.target.y)}"
      r="5" stroke="${candidate.color}"/>
    ${showScore ? `
      <rect class="candidate-score-bg" x="${round(midpoint.x - 17)}" y="${round(midpoint.y - 22)}"
        width="34" height="16" rx="8"/>
      <text class="candidate-score" x="${round(midpoint.x)}" y="${round(midpoint.y - 11)}">${
        score
      }%</text>` : ''}
  </g>`
}

function renderUnresolvedEndpoint(endpoint) {
  const classes = [
    'unresolved-endpoint',
    endpoint.selected ? 'selected' : '',
    endpoint.dimmed ? 'dimmed' : '',
  ].filter(Boolean).join(' ')
  return `<g class="${classes}" tabindex="0" role="button"
      data-unresolved-id="${escapeHtml(endpoint.id)}"
      aria-label="${escapeHtml(`${endpoint.name}, endpoint belum memiliki kandidat aman`)}">
    <title>${escapeHtml(endpoint.name)} · endpoint belum terselesaikan</title>
    <circle class="unresolved-ring" cx="${round(endpoint.x)}" cy="${round(endpoint.y)}" r="6"/>
    <path class="unresolved-cross"
      d="M ${round(endpoint.x - 3)} ${round(endpoint.y - 3)} L ${round(endpoint.x + 3)} ${
        round(endpoint.y + 3)
      } M ${round(endpoint.x + 3)} ${round(endpoint.y - 3)} L ${round(endpoint.x - 3)} ${
        round(endpoint.y + 3)
      }"/>
  </g>`
}

function renderEdge(edge) {
  const points = (edge.sections ?? []).flatMap((section) => [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
  ]).filter(Boolean)
  if (points.length < 2) return ''
  const path = points.map((point, index) => (
    `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`
  )).join(' ')
  return `<path class="topology-edge${edge.traced ? ' traced' : ''}${edge.dimmed ? ' dimmed' : ''}"
    d="${path}" data-edge-id="${escapeHtml(edge.id)}">
    <title>${escapeHtml(edge.relationType ?? 'Relasi confirmed')}</title>
  </path>`
}

function renderNode(node, showLabels) {
  const color = CATEGORY_COLORS[node.category] ?? CATEGORY_COLORS.unmapped
  const classes = [
    'topology-node',
    node.selected ? 'selected' : '',
    node.neighbor ? 'neighbor' : '',
    node.traced ? 'traced' : '',
    node.dimmed ? 'dimmed' : '',
    node.isCore ? 'core' : '',
  ].filter(Boolean).join(' ')
  const label = showLabels || node.selected || node.isCore
    ? `<text x="${node.x + 44}" y="${node.y + 29}" class="node-name">${escapeHtml(shorten(node.name, 22))}</text>
       <text x="${node.x + 44}" y="${node.y + 48}" class="node-id">${escapeHtml(node.id)}</text>`
    : ''
  return `
    <g class="${classes}" tabindex="0" role="button" aria-label="${escapeHtml(
      `${node.name}, ${node.type}, ${node.degree} koneksi`,
    )}" data-node-id="${escapeHtml(node.id)}">
      <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"
        rx="12" class="node-card"></rect>
      <circle cx="${node.x + 23}" cy="${node.y + node.height / 2}" r="${node.isCore ? 13 : 10}"
        fill="${color}" class="node-symbol"></circle>
      ${label}
      ${node.candidateCount ? `<g class="node-badge">
        <circle cx="${node.x + node.width - 8}" cy="${node.y + 8}" r="10"></circle>
        <text x="${node.x + node.width - 8}" y="${node.y + 12}">${node.candidateCount}</text>
      </g>` : ''}
    </g>
  `
}

function shorten(value, max) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function nodeGlyph(family) {
  return {
    cctv: 'C',
    'fiber-optic': 'F',
    lan: 'L',
    infrastructure: 'I',
    peripheral: 'P',
    unmapped: '•',
  }[family] ?? '•'
}

function categoryLabel(family) {
  return {
    cctv: 'CCTV',
    'fiber-optic': 'Fiber optic',
    lan: 'LAN',
    infrastructure: 'Infrastruktur',
    peripheral: 'Peripheral',
    unmapped: 'Lainnya',
  }[family] ?? family
}

function round(value) {
  return Math.round(Number(value) * 10) / 10
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
