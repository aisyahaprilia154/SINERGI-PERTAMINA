import { SCHEMATIC_CATEGORY_STYLES, SCHEMATIC_THEME } from './schematic-theme.js'

export function renderTopologySvg({ graph, layout, context, selectedAssetId = null }) {
  if (graph.status !== 'ready' || layout.status !== 'ready') return ''
  const footerY = layout.height - layout.options.footerHeight
  return `
    <svg class="schematic-svg topology-schematic" xmlns="http://www.w3.org/2000/svg" data-crossings="${layout.crossings || 0}"
      viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}"
      role="img" aria-labelledby="schematic-svg-title schematic-svg-description">
      <title id="schematic-svg-title">${escapeXml(graph.title)}</title>
      <desc id="schematic-svg-description">Diagram topologi ${layout.nodes.length} aset dari relasi terkonfirmasi dataset aktif.</desc>
      <defs><style>
        .diagram-bg{fill:#fff}.diagram-title{font:700 18px Inter,system-ui;fill:${SCHEMATIC_THEME.text}}
        .diagram-meta{font:500 10px Inter,system-ui;fill:${SCHEMATIC_THEME.textSecondary}}
        .diagram-edge-underlay{fill:none;stroke:#fff;stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
        .diagram-edge{fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;cursor:pointer}
        .diagram-edge.cycle{stroke-dasharray:5 4}.diagram-node{cursor:pointer;outline:none}
        .node-card{fill:#fff;stroke:#d7e0ea;stroke-width:1.2}.diagram-node:hover .node-card,.diagram-node.selected .node-card{stroke:#17385f;stroke-width:2}
        .node-icon-bg{stroke-width:1.4}.node-glyph{font:700 8px Inter,system-ui}.node-label{font:700 10px Inter,system-ui;fill:#162337}
        .node-type{font:500 8px Inter,system-ui;fill:#6b7789}.sequence-badge{fill:#17385f}.sequence-text{font:700 7px Inter,system-ui;fill:#fff}
        .diagram-divider{stroke:#e2e8f0;stroke-width:1}.diagram-disclaimer{font:500 9px Inter,system-ui;fill:#7d8898}
      </style></defs>
      <rect class="diagram-bg" width="${layout.width}" height="${layout.height}"/>
      <text class="diagram-title" x="${layout.options.marginX}" y="30">${escapeXml(graph.title)}</text>
      <text class="diagram-meta" x="${layout.options.marginX}" y="49">${escapeXml(context.branchName)} · Dataset ${escapeXml(context.version)} · ${graph.summary?.nodeCount || layout.nodes.length} aset · ${graph.summary?.connectionCount || layout.edges.length} koneksi · Read-only</text>
      <line class="diagram-divider" x1="${layout.options.marginX}" y1="66" x2="${layout.width - layout.options.marginX}" y2="66"/>
      <g class="diagram-edges" aria-label="Relasi aset">${layout.edges.map((edge) => renderEdge(edge, graph.mode)).join('')}</g>
      <g class="diagram-nodes" aria-label="Aset">${layout.nodes.map((node) => renderNode(node, selectedAssetId)).join('')}</g>
      <line class="diagram-divider" x1="${layout.options.marginX}" y1="${footerY + 14}" x2="${layout.width - layout.options.marginX}" y2="${footerY + 14}"/>
      <text class="diagram-disclaimer" x="${layout.options.marginX}" y="${layout.height - 28}">Diagram bersifat skematik dan tidak merepresentasikan skala geografis.</text>
      <text class="diagram-disclaimer" x="${layout.options.marginX}" y="${layout.height - 13}">Posisi relatif dan arah koneksi mengikuti data aset terkonfirmasi.</text>
    </svg>`
}

function renderEdge(edge, mode) {
  const path = roundedPath(edge.routePoints || [])
  const color = sanitizeColor(edge.networkColor)
  return `<path class="diagram-edge-underlay" d="${path}" aria-hidden="true"/>
    <path class="diagram-edge ${mode === 'trace' ? 'trace' : ''} ${edge.isCycleEdge ? 'cycle' : ''}"
      d="${path}" stroke="${color}" data-edge-id="${escapeXml(edge.id)}" tabindex="0">
      <title>${escapeXml(edge.networkName || 'Topologi terkonfirmasi')} · confirmed · ${escapeXml(edge.relationType || 'connection')}</title>
    </path>`
}

function renderNode(node, selectedAssetId) {
  const style = SCHEMATIC_CATEGORY_STYLES[node.category] || SCHEMATIC_CATEGORY_STYLES.infrastructure
  const { x, y, width, height, nodeX, nodeY, labelX, labelY } = node.diagram
  const classes = ['diagram-node', node.isAnchor ? 'anchor' : '', node.id === selectedAssetId ? 'selected' : ''].filter(Boolean).join(' ')
  const iconShape = /junction/i.test(node.type) ? renderDiamond(nodeX, nodeY, style.color) : renderCircle(nodeX, nodeY, style.color)
  return `<g class="${classes}" data-asset-id="${escapeXml(node.id)}" tabindex="0" role="button" aria-label="Pilih aset ${escapeXml(node.shortLabel || node.name)}">
      <title>${escapeXml(node.name)} · ${escapeXml(node.type)}${node.location ? ` · ${escapeXml(node.location)}` : ''}</title>
      <rect class="node-card" x="${x}" y="${y}" width="${width}" height="${height}" rx="7"/>
      ${iconShape}<text class="node-glyph" x="${nodeX}" y="${nodeY + 3}" text-anchor="middle" fill="${style.color}">${escapeXml(nodeGlyph(node.type, node.isAggregate))}</text>
      <text class="node-label" x="${labelX}" y="${labelY}">${escapeXml(node.shortLabel || node.shortName || node.name)}</text>
      <text class="node-type" x="${labelX}" y="${labelY + 15}">${escapeXml(node.type)}</text>
      ${Number.isInteger(node.order) ? `<circle class="sequence-badge" cx="${x + width - 10}" cy="${y + 10}" r="8"/><text class="sequence-text" x="${x + width - 10}" y="${y + 12.5}" text-anchor="middle">${node.order + 1}</text>` : ''}
    </g>`
}

function renderCircle(x, y, color) {
  return `<circle class="node-icon-bg" cx="${x}" cy="${y}" r="14" fill="${color}" fill-opacity=".10" stroke="${color}"/>`
}

function renderDiamond(x, y, color) {
  return `<rect class="node-icon-bg" x="${x - 11}" y="${y - 11}" width="22" height="22" rx="3" transform="rotate(45 ${x} ${y})" fill="${color}" fill-opacity=".10" stroke="${color}"/>`
}

function nodeGlyph(type = '', aggregate = false) {
  if (aggregate) return '+'
  const value = type.toLowerCase()
  if (value.includes('junction')) return 'JB'
  if (value.includes('switch')) return 'SW'
  if (value.includes('otb')) return 'OT'
  if (value.includes('cctv') || value.includes('camera')) return 'C'
  if (value.includes('nvr')) return 'N'
  if (value.includes('server')) return 'S'
  return '•'
}

function roundedPath(points) {
  if (!points.length) return ''
  return points.slice(1).reduce((path, point) => `${path} L ${point.x} ${point.y}`, `M ${points[0].x} ${points[0].y}`)
}

function sanitizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#17385f'
}

function escapeXml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}
