import {
  SCHEMATIC_CATEGORY_STYLES as CATEGORY_STYLES,
  SCHEMATIC_THEME as SVG_THEME,
} from './schematic-theme.js'
import { getAssetRenderLabels } from '../../domain/asset-display-name.js'

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
  const exportDate = formatExportDate(context.exportedAt)
  const connectionCount = layout.edges.reduce(
    (sum, edge) => sum + (edge.connectionCount || 1),
    0,
  )
  const siteName = context.siteScopeName || context.branchName || 'Pengapon'
  const inventoryNodeCount = layout.nodes.filter((node) => (
    !node.isVirtual && !node.isGroup && !node.isIsolatedAggregate
  )).length
  const virtualJunctionCount = layout.nodes.filter(({ isVirtual }) => isVirtual).length

  return `
    <svg class="schematic-svg topology-schematic" xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}"
      data-diagram-width="${layout.diagramBounds?.width || layout.width}"
      data-diagram-height="${layout.diagramBounds?.height || layout.height}"
      role="img" aria-labelledby="schematic-svg-title schematic-svg-description">
      <title id="schematic-svg-title">${escapeXml(graph.title)}</title>
      <desc id="schematic-svg-description">
        Diagram topologi skematik ${inventoryNodeCount} aset${virtualJunctionCount
          ? ` dan ${virtualJunctionCount} junction internal`
          : ''} berdasarkan scoped TopologyGraph Pengapon.
      </desc>
      <defs>
        <pattern id="topology-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${SVG_THEME.grid}" stroke-width=".45"/>
        </pattern>
        <marker id="diagram-edge-arrow" viewBox="0 0 8 8" refX="7" refY="4"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 Z" fill="context-stroke"/>
        </marker>
        <style>
          .diagram-bg{fill:${SVG_THEME.background}}
          .diagram-grid{fill:url(#topology-grid);opacity:.32}
          .diagram-title{font:700 19px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text}}
          .diagram-meta{font:500 11px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textSecondary}}
          .diagram-meta-secondary{font:500 9px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textMuted}}
          .diagram-edge-underlay{fill:none;stroke:${SVG_THEME.edgeUnderlay};stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
          .diagram-edge{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
          .diagram-edge.trace{stroke-width:4}
          .diagram-edge.inferred{stroke-dasharray:7 4}
          .diagram-edge.cycle{stroke-dasharray:3 4;stroke-width:2.5}
          .diagram-edge.logical{stroke-dasharray:6 5;stroke-width:2}
          .diagram-section{fill:${SVG_THEME.backgroundSubtle};stroke:${SVG_THEME.border};stroke-width:1}
          .diagram-section.isolated{fill:${SVG_THEME.background}}
          .section-title{font:700 10px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textSecondary};letter-spacing:.04em}
          .diagram-node{cursor:pointer;outline:none}
          .node-ring{fill:${SVG_THEME.background};stroke-width:2.5}
          .diagram-node.connector .node-ring{stroke-width:4}
          .diagram-node.core .node-ring{stroke-width:4.5}
          .diagram-node.anchor .node-halo{fill:none;stroke:${SVG_THEME.warning};stroke-width:2;opacity:.75}
          .diagram-node.selected .node-halo,.diagram-node:focus .node-halo{fill:none;stroke:${SVG_THEME.selected};stroke-width:3;opacity:1}
          .diagram-node:hover .node-halo{fill:none;stroke:${SVG_THEME.selected};stroke-width:2;opacity:.8}
          .diagram-node.selected .node-ring{fill:${SVG_THEME.selected};stroke:${SVG_THEME.selected}}
          .diagram-node.selected .node-glyph{fill:${SVG_THEME.backgroundSubtle}}
          .node-glyph{font:700 7px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text};letter-spacing:-.02em}
          .node-id{font:700 9.5px Inter,ui-sans-serif,system-ui}
          .node-type{font:600 7.5px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textMuted}}
          .aggregate-card{stroke-width:1.5}
          .aggregate-title{font:700 12px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text}}
          .aggregate-stat{font:600 8.5px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textSecondary}}
          .aggregate-path{font:500 8px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textMuted}}
          .virtual-junction{fill:${SVG_THEME.backgroundSubtle};stroke:${SVG_THEME.textSecondary};stroke-width:1.5}
          .virtual-junction-line{stroke:${SVG_THEME.textSecondary};stroke-width:1.3;stroke-linecap:round}
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
      <rect class="diagram-grid" y="92" width="${layout.width}" height="${diagramBottom - 92}"/>

      <g class="diagram-heading">
        <text class="diagram-title" x="32" y="34">${escapeXml(graph.title)}</text>
        <text class="diagram-meta" x="32" y="56">
          Site ${escapeXml(siteName)} · Branch ${escapeXml(context.branchId || 'semarang')} · Dataset ${escapeXml(context.version)} · ${diagramCountLabel(graph, layout)} · ${connectionCount} edge (${connectionCount} koneksi)
        </text>
        <text class="diagram-meta-secondary" x="32" y="73">
          Scope: ${escapeXml(graph.title || modeLabel(graph.mode))} · Diexport ${escapeXml(exportDate)}
        </text>
        <line class="diagram-divider" x1="32" y1="88" x2="${layout.width - 32}" y2="88"/>
      </g>

      <g class="diagram-sections" aria-label="Bagian diagram">
        ${(layout.sections || []).map(renderSection).join('')}
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
        Diagram skematik. Posisi aset telah disederhanakan dan tidak menunjukkan skala geografis.
      </text>
    </svg>
  `
}

function renderSection(section) {
  const { x, y, width, height } = section.bounds
  return `
    <g class="diagram-section-group">
      <rect class="diagram-section ${section.kind === 'isolated' ? 'isolated' : ''}"
        x="${x}" y="${y}" width="${width}" height="${height}" rx="12"/>
      <text class="section-title" x="${x + 14}" y="${y - 9}">${escapeXml(section.title)}</text>
    </g>
  `
}

function renderEdge(edge, mode) {
  const path = roundedPath(edge.routePoints)
  const color = sanitizeColor(edge.networkColor)
  const logicalClass = edge.networkType === 'Server' ? 'logical' : ''
  const traceClass = mode === 'trace' ? 'trace' : ''
  const inferredClass = String(edge.relationSource || '').startsWith('inferred')
    ? 'inferred'
    : 'explicit'
  const cycleClass = edge.routeKind === 'cycle' ? 'cycle' : ''
  return `
    <path class="diagram-edge-underlay" d="${path}" aria-hidden="true"/>
    <path class="diagram-edge ${traceClass} ${logicalClass} ${inferredClass} ${cycleClass}"
      d="${path}" stroke="${color}" data-edge-id="${escapeAttribute(edge.id)}"
      data-network-id="${escapeAttribute(edge.networkId || '')}"
      ${isDirectionalRelation(edge) ? 'marker-end="url(#diagram-edge-arrow)" data-directional="true"' : ''}>
      <title>${escapeXml(edge.networkName)} · ${edge.connectionCount || 1} koneksi · ${escapeXml(relationLabel(edge))}</title>
    </path>
  `
}

function renderNode(node, selectedAssetId) {
  if (node.isVirtual) return renderVirtualJunction(node)
  if (node.isGroup) return renderAggregateNode(node)

  const categoryStyle = CATEGORY_STYLES[node.category] || CATEGORY_STYLES.infrastructure
  const { nodeX, nodeY, labelX, labelY, radius } = node.diagram
  const classes = [
    'diagram-node',
    node.isConnector ? 'connector' : '',
    node.isCoreNode ? 'core' : '',
    node.isAnchor ? 'anchor' : '',
    node.id === selectedAssetId ? 'selected' : '',
  ].filter(Boolean).join(' ')
  const labels = getAssetRenderLabels(node, {
    shortMax: 18,
    displayMax: 30,
  })
  const labelLines = node.labelLines?.length ? node.labelLines : [labels.shortLabel]

  return `
    <g class="${classes}" data-asset-id="${escapeAttribute(node.id)}" tabindex="0"
      role="button" aria-label="${escapeAttribute(`Pilih aset ${labels.fullShortLabel}, ${labels.fullDisplayName}`)}">
      <title>${escapeXml(labels.fullShortLabel)} · ${escapeXml(labels.fullDisplayName)} · ${escapeXml(node.type)} · ${escapeXml(node.location)}${node.ip ? ` · ${escapeXml(node.ip)}` : ''}</title>
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
      ${node.hasIssue ? `
        <circle class="status-alert" cx="${nodeX - radius - 3}" cy="${nodeY - radius + 1}" r="5"/>
        <text class="status-alert-text" x="${nodeX - radius - 3}" y="${nodeY - radius + 3}"
          text-anchor="middle">!</text>
      ` : ''}
      <text class="node-id" x="${labelX}" y="${labelY}" text-anchor="middle"
        fill="${categoryStyle.color}">${renderLabelTspans(labelLines, labelX)}</text>
      <text class="node-type" x="${labelX}" y="${labelY + labelLines.length * 10 + 2}"
        text-anchor="middle">${escapeXml(shortType(node.type))}</text>
    </g>
  `
}

function renderAggregateNode(node) {
  const categoryStyle = CATEGORY_STYLES[node.category] || CATEGORY_STYLES.infrastructure
  const { x, y, width, height } = node.diagram
  const nodeCount = node.nodeCount ?? node.memberCount ?? 0
  const lineCount = node.lineCount || 0
  const edgeCount = node.edgeCount || 0
  const isolatedCount = node.isolatedNodeCount ?? (
    node.isIsolatedAggregate ? node.memberCount : 0
  )
  const interactionAttribute = node.detailScopeKey
    ? `data-detail-scope="${escapeAttribute(node.detailScopeKey)}"`
    : `data-isolated-list="${escapeAttribute((node.memberIds || []).join(','))}"`
  const detail = `${nodeCount} aset · ${edgeCount} koneksi · ${lineCount} line`
  const secondary = `${isolatedCount} tanpa relasi · ${node.connectedComponentCount || 0} komponen`
  return `
    <g class="diagram-node group ${node.isAnchor ? 'anchor' : ''}"
      ${interactionAttribute} tabindex="0" role="button"
      aria-label="${escapeAttribute(`${node.name}, ${detail}, ${secondary}`)}">
      <title>${escapeXml(node.name)} · ${escapeXml(detail)} · ${escapeXml(secondary)}${node.memberLabels?.length
        ? ` · ${escapeXml(node.memberLabels.join(', '))}`
        : ''}</title>
      <rect class="node-halo" x="${x - 5}" y="${y - 5}" width="${width + 10}"
        height="${height + 10}" rx="16" opacity="0"/>
      <rect class="aggregate-card" x="${x}" y="${y}" width="${width}" height="${height}"
        rx="12" fill="${categoryStyle.softColor || SVG_THEME.background}"
        stroke="${categoryStyle.color}"/>
      <circle cx="${x + 20}" cy="${y + 21}" r="7" fill="${SVG_THEME.backgroundSubtle}"
        stroke="${categoryStyle.color}" stroke-width="2.5"/>
      <text class="node-glyph" x="${x + 20}" y="${y + 23.5}" text-anchor="middle">
        ${escapeXml(nodeGlyph(node.type))}
      </text>
      <text class="aggregate-title" x="${x + 34}" y="${y + 25}">${escapeXml(node.name)}</text>
      <text class="aggregate-stat" x="${x + 14}" y="${y + 51}">${escapeXml(detail)}</text>
      <text class="aggregate-path" x="${x + 14}" y="${y + 70}">${escapeXml(secondary)}</text>
      <text class="aggregate-path" x="${x + 14}" y="${y + 86}">
        ${node.isIsolatedAggregate ? 'Buka daftar aset terisolasi' : 'Buka detail jaringan'}
      </text>
    </g>
  `
}

function renderVirtualJunction(node) {
  const { nodeX, nodeY } = node.diagram
  return `
    <g class="diagram-node virtual" data-virtual-junction-id="${escapeAttribute(node.id)}"
      tabindex="0" role="img" aria-label="Junction topologi internal">
      <title>Junction topologi internal · bukan aset inventaris</title>
      <rect class="virtual-junction" x="${nodeX - 5}" y="${nodeY - 5}"
        width="10" height="10" rx="2" transform="rotate(45 ${nodeX} ${nodeY})"/>
      <line class="virtual-junction-line" x1="${nodeX - 7}" y1="${nodeY}"
        x2="${nodeX + 7}" y2="${nodeY}"/>
      <line class="virtual-junction-line" x1="${nodeX}" y1="${nodeY - 7}"
        x2="${nodeX}" y2="${nodeY + 7}"/>
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

function renderLabelTspans(lines, x) {
  return lines.map((line, index) => (
    `<tspan x="${x}" dy="${index ? 10 : 0}">${escapeXml(line)}</tspan>`
  )).join('')
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

function shortType(type = '') {
  const normalized = String(type || '')
  return normalized.length > 22 ? `${normalized.slice(0, 20)}…` : normalized
}

function relationLabel(edge) {
  if (edge.relationStatus === 'inferred_pending') {
    return 'Kandidat relasi dari geometri, menunggu konfirmasi Administrator'
  }
  if (String(edge.relationSource || '').startsWith('inferred')) {
    return edge.relationStatus === 'admin_confirmed'
      ? 'Relasi dari geometri yang dikonfirmasi Administrator'
      : 'Relasi hasil rekonstruksi topologi'
  }
  return 'Relasi eksplisit'
}

function isDirectionalRelation(edge) {
  return /upstream|downstream|parent|source[-_ ]?target|feeds?/i.test(
    edge.relationType || '',
  )
}

function modeLabel(mode) {
  if (mode === 'trace') return 'hasil tracing'
  if (mode === 'full-map') return 'peta jaringan lengkap'
  if (mode === 'focus') return 'relasi langsung aset fokus'
  if (mode === 'viewport') return 'area peta saat ini'
  if (mode === 'layer') return 'area atau layer terpilih'
  if (mode === 'overview') return 'overview jaringan'
  if (mode === 'multi-page') return 'diagram multi-halaman'
  return 'jaringan terpilih'
}

function diagramCountLabel(graph, layout) {
  if (graph.mode === 'overview') {
    return `${layout.nodes.length} kelompok · ${graph.representedAssetCount} aset`
  }
  const inventoryNodeCount = layout.nodes.filter((node) => (
    !node.isVirtual && !node.isGroup && !node.isIsolatedAggregate
  )).length
  const virtualJunctionCount = layout.nodes.filter(({ isVirtual }) => isVirtual).length
  return `${inventoryNodeCount} aset${
    virtualJunctionCount ? ` + ${virtualJunctionCount} junction internal` : ''
  }`
}

function formatExportDate(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return String(value || '')
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
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
