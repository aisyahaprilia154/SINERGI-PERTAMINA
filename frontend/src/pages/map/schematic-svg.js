import {
  SCHEMATIC_CATEGORY_STYLES as CATEGORY_STYLES,
  SCHEMATIC_THEME as SVG_THEME,
} from './schematic-theme.js'

export function renderSchematicSvg({
  graph,
  layout,
  context,
  selectedAssetId = null,
}) {
  if (graph.status !== 'ready' || layout.status !== 'ready') return ''

  const legendCategories = [...new Set(layout.nodes.map((node) => node.category))]
  const legendNetworks = uniqueNetworks(layout.edges)
  const diagramBottom = layout.height - layout.options.footerHeight

  return `
    <svg class="schematic-svg topology-schematic" xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}"
      role="img" aria-labelledby="schematic-svg-title schematic-svg-description">
      <title id="schematic-svg-title">${escapeXml(graph.title)}</title>
      <desc id="schematic-svg-description">
        Diagram topology skematik ${layout.nodes.length} aset berdasarkan relasi eksplisit dataset aktif.
      </desc>
      <defs>
        <pattern id="topology-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${SVG_THEME.grid}" stroke-width=".45"/>
        </pattern>
        <style>
          .diagram-bg{fill:${SVG_THEME.background}}
          .diagram-grid{fill:url(#topology-grid);opacity:.32}
          .diagram-title{font:700 19px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text}}
          .diagram-meta{font:500 11px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textSecondary}}
          .diagram-edge-underlay{fill:none;stroke:${SVG_THEME.edgeUnderlay};stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
          .diagram-edge{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
          .diagram-edge.trace{stroke-width:4}
          .diagram-edge.logical{stroke-dasharray:6 5;stroke-width:2}
          .diagram-node{cursor:pointer;outline:none}
          .node-ring{fill:${SVG_THEME.background};stroke-width:2.5}
          .diagram-node.connector .node-ring{stroke-width:4}
          .diagram-node.anchor .node-halo{fill:none;stroke:${SVG_THEME.warning};stroke-width:2;opacity:.75}
          .diagram-node.selected .node-halo,.diagram-node:focus .node-halo{fill:none;stroke:${SVG_THEME.selected};stroke-width:3;opacity:1}
          .diagram-node:hover .node-halo{fill:none;stroke:${SVG_THEME.selected};stroke-width:2;opacity:.8}
          .node-glyph{font:700 7px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text};letter-spacing:-.02em}
          .node-id{font:700 9.5px "Segoe UI Mono",Consolas,monospace}
          .node-name{font:500 8.5px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textSecondary}}
          .node-ip{font:500 8.5px "Segoe UI Mono",Consolas,monospace;fill:${SVG_THEME.textMuted}}
          .sequence-badge{fill:${SVG_THEME.backgroundSubtle};stroke:${SVG_THEME.textSecondary};stroke-width:1}
          .sequence-text{font:700 7px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text}}
          .status-alert{fill:${SVG_THEME.warning};stroke:${SVG_THEME.background};stroke-width:1.5}
          .status-alert-text{font:800 6px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.background}}
          .diagram-divider{stroke:${SVG_THEME.border};stroke-width:1}
          .legend-label{font:600 9px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textSecondary}}
          .legend-title{font:700 8px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textMuted};letter-spacing:.08em}
          .diagram-disclaimer{font:500 9px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textMuted}}
        </style>
      </defs>

      <rect class="diagram-bg" width="${layout.width}" height="${layout.height}"/>
      <rect class="diagram-grid" y="82" width="${layout.width}" height="${diagramBottom - 82}"/>

      <g class="diagram-heading">
        <text class="diagram-title" x="32" y="34">${escapeXml(graph.title)}</text>
        <text class="diagram-meta" x="32" y="56">
          ${escapeXml(context.branchName)} · Dataset ${escapeXml(context.version)} · ${layout.nodes.length} aset · ${modeLabel(graph.mode)}
        </text>
        <line class="diagram-divider" x1="32" y1="78" x2="${layout.width - 32}" y2="78"/>
      </g>

      <g class="diagram-edges" aria-label="Relasi aset">
        ${layout.edges.map((edge) => renderEdge(edge, graph.mode)).join('')}
      </g>

      <g class="diagram-nodes" aria-label="Aset">
        ${layout.nodes.map((node) => renderNode(node, selectedAssetId)).join('')}
      </g>

      <line class="diagram-divider" x1="32" y1="${diagramBottom + 8}"
        x2="${layout.width - 32}" y2="${diagramBottom + 8}"/>
      ${renderLegend(legendCategories, legendNetworks, diagramBottom)}
      <text class="diagram-disclaimer" x="32" y="${layout.height - 16}">
        Diagram skematik mengikuti posisi relatif tampilan peta dan tidak menunjukkan skala geografis.
      </text>
    </svg>
  `
}

function renderEdge(edge, mode) {
  const path = roundedPath(edge.routePoints)
  const color = sanitizeColor(edge.networkColor)
  const logicalClass = edge.networkType === 'Server' ? 'logical' : ''
  const traceClass = mode === 'trace' ? 'trace' : ''
  return `
    <path class="diagram-edge-underlay" d="${path}" aria-hidden="true"/>
    <path class="diagram-edge ${traceClass} ${logicalClass}"
      d="${path}" stroke="${color}" data-edge-id="${escapeAttribute(edge.id)}"
      data-network-id="${escapeAttribute(edge.networkId || '')}">
      <title>${escapeXml(edge.networkName)} · relasi eksplisit</title>
    </path>
  `
}

function renderNode(node, selectedAssetId) {
  const categoryStyle = CATEGORY_STYLES[node.category] || CATEGORY_STYLES.infrastructure
  const { nodeX, nodeY, labelX, labelY } = node.diagram
  const radius = node.isConnector ? 11 : 8
  const classes = [
    'diagram-node',
    node.isConnector ? 'connector' : '',
    node.isAnchor ? 'anchor' : '',
    node.id === selectedAssetId ? 'selected' : '',
  ].filter(Boolean).join(' ')
  const detailLabel = node.ip || node.shortName

  return `
    <g class="${classes}" data-asset-id="${escapeAttribute(node.id)}" tabindex="0"
      role="button" aria-label="Pilih aset ${escapeAttribute(node.id)}">
      <title>${escapeXml(node.id)} · ${escapeXml(node.name)} · ${escapeXml(node.type)} · ${escapeXml(node.location)}${node.ip ? ` · ${escapeXml(node.ip)}` : ''}</title>
      <circle class="node-halo" cx="${nodeX}" cy="${nodeY}" r="${radius + 5}" opacity="0"/>
      <circle class="node-ring" cx="${nodeX}" cy="${nodeY}" r="${radius}" stroke="${categoryStyle.color}"/>
      <circle cx="${nodeX}" cy="${nodeY}" r="${Math.max(3, radius - 5)}"
        fill="${node.isConnector ? categoryStyle.color : SVG_THEME.backgroundSubtle}"/>
      <text class="node-glyph" x="${nodeX}" y="${nodeY + 2.5}" text-anchor="middle">
        ${escapeXml(nodeGlyph(node.type))}
      </text>
      ${Number.isInteger(node.order) ? `
        <circle class="sequence-badge" cx="${nodeX + radius + 5}" cy="${nodeY - radius - 3}" r="6"/>
        <text class="sequence-text" x="${nodeX + radius + 5}" y="${nodeY - radius - .5}"
          text-anchor="middle">${node.order + 1}</text>
      ` : ''}
      ${node.status && node.status !== 'Online' ? `
        <circle class="status-alert" cx="${nodeX - radius - 3}" cy="${nodeY - radius + 1}" r="5"/>
        <text class="status-alert-text" x="${nodeX - radius - 3}" y="${nodeY - radius + 3}"
          text-anchor="middle">!</text>
      ` : ''}
      <text class="node-id" x="${labelX}" y="${labelY}" text-anchor="middle"
        fill="${categoryStyle.color}">${escapeXml(node.id)}</text>
      <text class="${node.ip ? 'node-ip' : 'node-name'}" x="${labelX}" y="${labelY + 12}"
        text-anchor="middle">${escapeXml(detailLabel)}</text>
      ${node.ip ? `
        <text class="node-name" x="${labelX}" y="${labelY + 23}"
          text-anchor="middle">${escapeXml(node.shortName)}</text>
      ` : ''}
    </g>
  `
}

function renderLegend(categories, networks, diagramBottom) {
  return `
    <g class="diagram-legend" transform="translate(32 ${diagramBottom + 28})">
      <text class="legend-title" x="0" y="0">NODE</text>
      ${categories.map((category, index) => {
        const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.infrastructure
        const offsetX = 48 + index * 106
        return `
          <circle cx="${offsetX}" cy="-3" r="5" fill="${SVG_THEME.background}" stroke="${style.color}" stroke-width="2"/>
          <text class="legend-label" x="${offsetX + 10}" y="0">${escapeXml(style.label)}</text>
        `
      }).join('')}
    </g>
    <g class="diagram-network-legend" transform="translate(32 ${diagramBottom + 54})">
      <text class="legend-title" x="0" y="0">JALUR</text>
      ${networks.map((network, index) => {
        const offsetX = 48 + index * 128
        return `
          <line x1="${offsetX}" y1="-3" x2="${offsetX + 18}" y2="-3"
            stroke="${sanitizeColor(network.color)}" stroke-width="3" stroke-linecap="round"/>
          <text class="legend-label" x="${offsetX + 25}" y="0">${escapeXml(shortenLegend(network.name))}</text>
        `
      }).join('')}
    </g>
  `
}

function uniqueNetworks(edges) {
  const seen = new Set()
  return edges
    .filter((edge) => {
      const key = edge.networkId || edge.networkName
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((edge) => ({
      id: edge.networkId,
      name: edge.networkName,
      color: edge.networkColor,
    }))
}

function nodeGlyph(type = '') {
  const normalized = type.toLowerCase()
  if (normalized.includes('junction')) return 'JB'
  if (normalized.includes('switch')) return 'SW'
  if (normalized === 'otb') return 'OT'
  if (normalized === 'cctv') return 'C'
  if (normalized === 'nvr') return 'N'
  if (normalized === 'server') return 'S'
  if (normalized === 'access point') return 'AP'
  if (normalized === 'printer') return 'P'
  return '•'
}

function modeLabel(mode) {
  if (mode === 'trace') return 'hasil tracing'
  if (mode === 'full-map') return 'peta jaringan lengkap'
  if (mode === 'focus') return 'relasi langsung aset fokus'
  return 'jaringan terpilih'
}

function shortenLegend(value = '') {
  return value.length > 16 ? `${value.slice(0, 14)}…` : value
}

function roundedPath(points) {
  if (!points.length) return ''
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  }

  const radius = 8
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    const before = moveToward(current, previous, radius)
    const after = moveToward(current, next, radius)
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`
  }
  const end = points.at(-1)
  return `${path} L ${end.x} ${end.y}`
}

function moveToward(from, to, distance) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const appliedDistance = Math.min(distance, length / 2)
  return {
    x: from.x + (dx / length) * appliedDistance,
    y: from.y + (dy / length) * appliedDistance,
  }
}

function sanitizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : SVG_THEME.textMuted
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function escapeAttribute(value) {
  return escapeXml(value)
}
