import {
  SCHEMATIC_CATEGORY_STYLES as CATEGORY_STYLES,
  SCHEMATIC_THEME as SVG_THEME,
} from './schematic-theme.js'

export function renderSchematicSvg({
  graph,
  layout,
  context,
  selectedAssetId = null,
  sourceIconDataByUrl = null,
  collapsedPoleGroupIds = new Set(),
}) {
  if (graph.status !== 'ready' || layout.status !== 'ready') return ''

  const legendCategories = uniqueNodeTypes(layout.nodes)
  const legendNetworks = uniqueNetworks(layout.edges, graph.mode)
  const poleGroupState = buildPoleGroupState({
    groups: graph.poleGroups ?? [],
    layoutNodes: layout.nodes,
    collapsedPoleGroupIds,
    selectedAssetId,
  })
  const renderedEdges = layout.edges.flatMap((edge) => (
    remapCollapsedEdge(edge, poleGroupState)
  ))
  const renderedNodes = layout.nodes.filter((node) => (
    !poleGroupState.hiddenAssetIds.has(node.id)
  ))
  const diagramBottom = layout.height - layout.options.footerHeight
  const headingDividerY = graph.mode === 'all-assets' ? 96 : 78
  const diagramTop = headingDividerY + 4

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
          .diagram-coverage{font:700 12px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text}}
          .section-overview-title{font:700 11px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text};letter-spacing:.08em}
          .category-section{stroke-width:1.5}
          .category-section-title{font:700 14px Inter,ui-sans-serif,system-ui}
          .category-section-count{font:600 10px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textSecondary}}
          .diagram-edge-underlay{fill:none;stroke:${SVG_THEME.edgeUnderlay};stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
          .diagram-edge{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
          .diagram-edge.trace{stroke-width:4}
          .diagram-edge.logical{stroke-dasharray:6 5;stroke-width:2}
          .diagram-edge.recommended{stroke-dasharray:9 7;stroke-width:2.5}
          .diagram-edge.recommended-underlay{stroke-dasharray:9 7}
          .diagram-pole-group{fill:${SVG_THEME.backgroundSubtle};fill-opacity:.58;stroke:#7c8794;stroke-width:1.4;stroke-dasharray:7 5}
          .diagram-pole-group-toggle{cursor:pointer}
          .diagram-pole-group-toggle:hover .diagram-pole-group,.diagram-pole-group-toggle:focus .diagram-pole-group{stroke:${SVG_THEME.selected};stroke-width:2}
          .diagram-pole-group-label{font:700 9px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textSecondary};letter-spacing:.02em}
          .diagram-pole-group-label-backdrop{fill:${SVG_THEME.background};stroke:#7c8794;stroke-width:1}
          .diagram-node{cursor:pointer;outline:none}
          .node-card{fill:${SVG_THEME.backgroundSubtle};stroke:${SVG_THEME.border};stroke-width:1.5}
          .diagram-node.anchor .node-card,.diagram-node.selected .node-card{stroke:${SVG_THEME.selected};stroke-width:2.5}
          .diagram-node:hover .node-card,.diagram-node:focus .node-card{stroke:${SVG_THEME.selected};stroke-width:2}
          .diagram-node.resolution-review .node-card{stroke:${SVG_THEME.warning};stroke-dasharray:5 3}
          .diagram-node.resolution-unresolved .node-card{stroke:${SVG_THEME.textMuted};stroke-dasharray:3 3}
          .node-halo{fill:none;stroke:${SVG_THEME.selected};stroke-width:3;opacity:0}
          .diagram-node.anchor .node-halo{opacity:.18}
          .diagram-node.selected .node-halo,.diagram-node:focus .node-halo{opacity:1}
          .node-icon-backdrop{stroke:none}
          .node-source-icon{pointer-events:none}
          .node-ring{fill:${SVG_THEME.background};stroke-width:2.5}
          .diagram-node.connector .node-ring{stroke-width:3}
          .node-glyph{font:700 8px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text};letter-spacing:-.02em}
          .node-id{font:700 12.5px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.text}}
          .node-name{font:500 10.5px Inter,ui-sans-serif,system-ui;fill:${SVG_THEME.textSecondary}}
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
      <rect class="diagram-grid" y="${diagramTop}" width="${layout.width}"
        height="${Math.max(0, diagramBottom - diagramTop)}"/>

      ${renderDiagramHeading(graph, layout, context, headingDividerY)}

      <g class="diagram-category-sections" aria-label="Section kategori aset">
        ${renderCategorySections(layout.sections ?? [])}
      </g>

      <g class="diagram-pole-groups" aria-label="Kelompok pemasangan fisik">
        ${renderPoleGroups(graph.poleGroups ?? [], layout.nodes, poleGroupState)}
      </g>

      <g class="diagram-edges" aria-label="Relasi aset">
        ${renderedEdges.map((edge) => renderEdge(edge, graph.mode)).join('')}
      </g>

      <g class="diagram-nodes" aria-label="Aset">
        ${renderedNodes.map((node) => renderNode(
          node,
          selectedAssetId,
          sourceIconDataByUrl,
        )).join('')}
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

function buildPoleGroupState({
  groups = [],
  layoutNodes = [],
  collapsedPoleGroupIds = new Set(),
  selectedAssetId = null,
} = {}) {
  const nodeById = new Map(layoutNodes.map((node) => [node.id, node]))
  const hiddenAssetIds = new Set()
  const collapsedByAssetId = new Map()
  const renderedGroups = groups.flatMap((group) => {
    const groupId = group.id || group.poleAssetId
    const nodes = (group.assetIds ?? [])
      .map((assetId) => nodeById.get(assetId))
      .filter((node) => node?.diagram)
    if (nodes.length < 2) return []
    const collapsed = collapsedPoleGroupIds.has(groupId)
      && !(group.assetIds ?? []).includes(selectedAssetId)
    const poleNode = nodeById.get(group.poleAssetId)
    if (collapsed) {
      group.assetIds
        .filter((assetId) => assetId !== group.poleAssetId)
        .forEach((assetId) => {
          hiddenAssetIds.add(assetId)
          collapsedByAssetId.set(assetId, poleNode)
        })
    }
    return [{ group, groupId, nodes, collapsed }]
  })
  return { nodeById, hiddenAssetIds, collapsedByAssetId, renderedGroups }
}

function remapCollapsedEdge(edge, state) {
  const sourceAnchor = state.collapsedByAssetId.get(edge.sourceId)
  const targetAnchor = state.collapsedByAssetId.get(edge.targetId)
  const sourceId = sourceAnchor?.id ?? edge.sourceId
  const targetId = targetAnchor?.id ?? edge.targetId
  if (sourceId === targetId) return []
  const routePoints = (edge.routePoints ?? []).map((point, index, points) => {
    if (index === 0 && sourceAnchor?.diagram) return nodeCenter(sourceAnchor)
    if (index === points.length - 1 && targetAnchor?.diagram) return nodeCenter(targetAnchor)
    return point
  })
  return [{ ...edge, sourceId, targetId, routePoints }]
}

function renderPoleGroups(groups, layoutNodes, state = buildPoleGroupState({ groups, layoutNodes })) {
  return state.renderedGroups.flatMap(({ group, groupId, nodes, collapsed }) => {
    const visibleNodes = collapsed
      ? nodes.filter((node) => node.id === group.poleAssetId)
      : nodes
    const minX = Math.min(...visibleNodes.map((node) => node.diagram.x)) - 18
    const minY = Math.min(...visibleNodes.map((node) => node.diagram.y)) - 34
    const maxX = Math.max(...visibleNodes.map((node) => node.diagram.x + node.diagram.width)) + 18
    const maxY = Math.max(...visibleNodes.map((node) => node.diagram.y + node.diagram.height)) + 18
    const label = `Tiang ${shortenGroupLabel(group.pole?.name || group.poleAssetId)} · ${Math.max(0, nodes.length - 1)} aset`
    const labelWidth = Math.min(250, Math.max(116, label.length * 5.5 + 22))
    return [`
      <g class="diagram-pole-group-toggle" data-pole-group-toggle="${escapeAttribute(groupId)}"
        data-pole-group-id="${escapeAttribute(groupId)}" tabindex="0" role="button"
        aria-expanded="${String(!collapsed)}" aria-label="${escapeAttribute(
          `${collapsed ? 'Buka' : 'Ringkas'} kelompok ${label}`,
        )}">
        <title>${escapeXml(label)} · relasi pemasangan fisik · ${collapsed ? 'ringkas' : 'terbuka'}</title>
        <rect class="diagram-pole-group" x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" rx="16"/>
        <rect class="diagram-pole-group-label-backdrop" x="${minX + 10}" y="${minY - 1}"
          width="${labelWidth}" height="18" rx="8"/>
        <text class="diagram-pole-group-label" x="${minX + 19}" y="${minY + 12}">${escapeXml(label)}</text>
        ${collapsed ? `<text class="diagram-pole-group-label" x="${maxX - 12}" y="${minY + 12}" text-anchor="end">+</text>` : ''}
      </g>
    `]
  }).join('')
}

function nodeCenter(node) {
  return {
    x: node.diagram.x + node.diagram.width / 2,
    y: node.diagram.y + node.diagram.height / 2,
  }
}

function renderEdge(edge, mode) {
  const path = roundedPath(edge.routePoints)
  const color = sanitizeColor(edge.networkColor)
  const logicalClass = edge.networkType === 'Server' ? 'logical' : ''
  const traceClass = mode === 'trace' ? 'trace' : ''
  const recommendedClass = edge.relationStatus === 'recommended' ? 'recommended' : ''
  return `
    <path class="diagram-edge-underlay ${recommendedClass ? 'recommended-underlay' : ''}"
      d="${path}" aria-hidden="true"/>
    <path class="diagram-edge ${traceClass} ${logicalClass} ${recommendedClass}"
      d="${path}" stroke="${color}" data-edge-id="${escapeAttribute(edge.id)}"
      data-network-id="${escapeAttribute(edge.networkId || '')}"
      data-relation-status="${escapeAttribute(edge.relationStatus || 'confirmed')}">
      <title>${escapeXml(describeEdgeEvidence(edge))}</title>
    </path>
  `
}

function renderNode(node, selectedAssetId, sourceIconDataByUrl) {
  if (node.presentation === 'compact') {
    return renderCompactNode(node, selectedAssetId, sourceIconDataByUrl)
  }
  const categoryStyle = CATEGORY_STYLES[node.category] || CATEGORY_STYLES.infrastructure
  const { x, y, width, height } = node.diagram
  const nodeX = x + 25
  const nodeY = y + height / 2
  const labelX = x + 52
  const labelY = y + 28
  const radius = node.isAnchor ? 16 : 14
  const classes = [
    'diagram-node',
    node.isConnector ? 'connector' : '',
    node.isAnchor ? 'anchor' : '',
    node.id === selectedAssetId ? 'selected' : '',
  ].filter(Boolean).join(' ')
  const detailLabel = shortenType(node.type)
  const displayName = shortenNodeLabel(node.name || 'Aset tanpa nama')
  const sourceIcon = sourceIconDataByUrl?.get?.(node.sourceIconUrl) ?? null

  return `
    <g class="${classes}" data-asset-id="${escapeAttribute(node.id)}" tabindex="0"
      role="button" aria-label="Pilih aset ${escapeAttribute(node.id)}">
      <title>${escapeXml(node.id)} · ${escapeXml(node.name)} · ${escapeXml(node.type)} · ${escapeXml(node.location)}${node.ip ? ` · ${escapeXml(node.ip)}` : ''}</title>
      <rect class="node-halo" x="${x - 5}" y="${y - 5}" width="${width + 10}" height="${height + 10}" rx="14"/>
      <rect class="node-card" x="${x}" y="${y}" width="${width}" height="${height}" rx="12"/>
      <rect class="node-icon-backdrop" x="${nodeX - 19}" y="${nodeY - 19}" width="38" height="38" rx="10"
        fill="${categoryStyle.color}" fill-opacity=".14"/>
      ${sourceIcon
        ? renderSourceIcon(sourceIcon, nodeX, nodeY, 30)
        : `${renderNodeShape(node, nodeX, nodeY, radius, categoryStyle.color)}
          <text class="node-glyph" x="${nodeX}" y="${nodeY + 2.5}" text-anchor="middle">
            ${escapeXml(nodeGlyph(node.type))}
          </text>`}
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
      <text class="node-id" x="${labelX}" y="${labelY}" text-anchor="start">${escapeXml(displayName)}</text>
      <text class="node-name" x="${labelX}" y="${labelY + 17}"
        text-anchor="start">${escapeXml(detailLabel)}</text>
    </g>
  `
}

function renderCompactNode(node, selectedAssetId, sourceIconDataByUrl) {
  const categoryStyle = CATEGORY_STYLES[node.category] || CATEGORY_STYLES.infrastructure
  const { x, y, width, height } = node.diagram
  const nodeX = x + 20
  const nodeY = y + height / 2
  const labelX = x + 39
  const sourceIcon = sourceIconDataByUrl?.get?.(node.sourceIconUrl) ?? null
  const classes = [
    'diagram-node',
    'compact',
    `resolution-${node.resolutionStatus || 'unresolved'}`,
    node.isConnector ? 'connector' : '',
    node.id === selectedAssetId ? 'selected' : '',
  ].filter(Boolean).join(' ')
  return `
    <g class="${classes}" data-asset-id="${escapeAttribute(node.id)}" tabindex="0"
      role="button" aria-label="Pilih aset ${escapeAttribute(node.id)}">
      <title>${escapeXml(node.id)} · ${escapeXml(node.name)} · ${escapeXml(node.type)} · ${escapeXml(node.location)} · ${escapeXml(resolutionLabel(node.resolutionStatus))}</title>
      <rect class="node-halo" x="${x - 4}" y="${y - 4}" width="${width + 8}" height="${height + 8}" rx="12"/>
      <rect class="node-card" x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/>
      ${sourceIcon
        ? renderSourceIcon(sourceIcon, nodeX, nodeY, 20)
        : `${renderNodeShape(node, nodeX, nodeY, 9, categoryStyle.color)}
          <text class="node-glyph" x="${nodeX}" y="${nodeY + 2.5}" text-anchor="middle">
            ${escapeXml(nodeGlyph(node.type))}
          </text>`}
      <text class="node-id" x="${labelX}" y="${nodeY + 4}" text-anchor="start">
        ${escapeXml(shortenCompactLabel(node.name || node.id))}
      </text>
      ${renderResolutionBadge(node, x + width - 12, nodeY)}
    </g>
  `
}

function renderSourceIcon(sourceIcon, x, y, size) {
  const half = size / 2
  return `<image class="node-source-icon" x="${x - half}" y="${y - half}"
    width="${size}" height="${size}" href="${escapeAttribute(sourceIcon)}"
    preserveAspectRatio="xMidYMid meet" aria-hidden="true"/>`
}

function renderNodeShape(node, x, y, radius, color) {
  const normalized = String(node.type || '').toLowerCase()
  if (normalized.includes('junction')) {
    return `<polygon class="node-ring" points="${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}" stroke="${color}"/>`
  }
  if (normalized.includes('switch')) {
    return `<rect class="node-ring" x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" rx="5" stroke="${color}"/>`
  }
  if (normalized.includes('server') || normalized.includes('nvr')) {
    return `<rect class="node-ring" x="${x - radius - 4}" y="${y - radius + 2}" width="${(radius + 4) * 2}" height="${(radius - 2) * 2}" rx="3" stroke="${color}"/>`
  }
  if (normalized.includes('otb')) {
    const points = Array.from({ length: 6 }, (_, index) => {
      const angle = Math.PI / 3 * index - Math.PI / 6
      return `${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`
    }).join(' ')
    return `<polygon class="node-ring" points="${points}" stroke="${color}"/>`
  }
  return `<circle class="node-ring" cx="${x}" cy="${y}" r="${radius}" stroke="${color}"/>`
}

function shortenType(value = '') {
  const normalized = String(value).trim()
  if (!normalized) return 'Jenis aset belum tersedia'
  return normalized.length > 18 ? `${normalized.slice(0, 16)}…` : normalized
}

function renderCategorySections(sections) {
  return sections.map((section) => {
    const style = CATEGORY_STYLES[section.category] || CATEGORY_STYLES.infrastructure
    const title = section.title || style.label
    if (section.kind === 'connected-overview' || section.kind === 'isolated') {
      const detail = section.kind === 'connected-overview'
        ? `${section.nodeCount} aset · ${section.componentCount} komponen`
        : `${section.nodeCount} aset`
      return `
        <g class="diagram-category-section overview" data-section-kind="${section.kind}">
          <rect class="category-section" x="${section.x}" y="${section.y}"
            width="${section.width}" height="${section.height}" rx="18"
            fill="${SVG_THEME.backgroundSubtle}" stroke="${SVG_THEME.border}"/>
          <text class="section-overview-title" x="${section.x + 22}" y="${section.y + 32}">
            ${escapeXml(title.toUpperCase())}
          </text>
          <text class="category-section-count" x="${section.x + section.width - 22}"
            y="${section.y + 32}" text-anchor="end">${escapeXml(detail)}</text>
        </g>
      `
    }
    if (section.kind === 'isolated-category') {
      return `
        <g class="diagram-category-section isolated-category"
          data-category="${escapeAttribute(section.category)}">
          <circle cx="${section.x + 6}" cy="${section.y + 18}" r="5" fill="${style.color}"/>
          <text class="category-section-title" x="${section.x + 19}" y="${section.y + 23}"
            fill="${SVG_THEME.text}">${escapeXml(title)}</text>
          <text class="category-section-count" x="${section.x + section.width}"
            y="${section.y + 22}" text-anchor="end">${section.nodeCount} aset</text>
          <line class="diagram-divider" x1="${section.x}" y1="${section.y + 35}"
            x2="${section.x + section.width}" y2="${section.y + 35}"/>
        </g>
      `
    }
    return `
      <g class="diagram-category-section" data-category="${escapeAttribute(section.category)}">
        <rect class="category-section" x="${section.x}" y="${section.y}"
          width="${section.width}" height="${section.height}" rx="18"
          fill="${style.color}" fill-opacity=".055" stroke="${style.color}" stroke-opacity=".4"/>
        <circle cx="${section.x + 22}" cy="${section.y + 25}" r="6" fill="${style.color}"/>
        <text class="category-section-title" x="${section.x + 36}" y="${section.y + 30}"
          fill="${style.color}">${escapeXml(title)}</text>
        <text class="category-section-count" x="${section.x + section.width - 20}"
          y="${section.y + 29}" text-anchor="end">${section.nodeCount} aset</text>
      </g>
    `
  }).join('')
}

function renderDiagramHeading(graph, layout, context, dividerY) {
  if (graph.mode !== 'all-assets') {
    return `
      <g class="diagram-heading">
        <text class="diagram-title" x="32" y="34">${escapeXml(graph.title)}</text>
        <text class="diagram-meta" x="32" y="56">
          ${escapeXml(context.branchName)} · Dataset ${escapeXml(context.version)} · ${layout.nodes.length} aset · ${modeLabel(graph.mode)}
        </text>
        <line class="diagram-divider" x1="32" y1="${dividerY}"
          x2="${layout.width - 32}" y2="${dividerY}"/>
      </g>
    `
  }
  const summary = layout.summary || {}
  const totalCount = summary.totalCount ?? layout.nodes.length
  const connectedCount = summary.connectedCount ?? totalCount - (summary.isolatedCount || 0)
  const isolatedCount = summary.isolatedCount ?? 0
  const coveragePercent = summary.coveragePercent ?? 100
  return `
    <g class="diagram-heading all-assets-heading">
      <text class="diagram-title" x="32" y="32">Seluruh aset · ${totalCount}</text>
      <text class="diagram-coverage" x="${layout.width - 32}" y="32" text-anchor="end">
        ${coveragePercent}% tercakup
      </text>
      <text class="diagram-meta" x="32" y="54">
        ${connectedCount} aset terhubung · ${isolatedCount} aset tanpa relasi · ${summary.componentCount ?? 0} komponen
      </text>
      <text class="diagram-meta" x="32" y="76">
        ${summary.confirmedCount ?? 0} aset memiliki relasi otomatis · ${summary.unresolvedCount ?? isolatedCount} aset belum tersambung
      </text>
      <line class="diagram-divider" x1="32" y1="${dividerY}"
        x2="${layout.width - 32}" y2="${dividerY}"/>
    </g>
  `
}

function renderResolutionBadge(node, x, y) {
  // Unconnected assets are already grouped in the dedicated "Aset tanpa
  // relasi" section. Avoid putting review/recommendation badges on every
  // node now that the operational graph is automatically confirmed.
  return ''
}

function describeEdgeEvidence(edge) {
  const status = 'terkonfirmasi otomatis'
  const confidence = Number.isFinite(edge.confidence)
    ? ` · confidence ${Math.round(edge.confidence * 100)}%`
    : ''
  const distance = Number.isFinite(edge.distanceMeters)
    ? ` · jarak ${edge.distanceMeters.toFixed(2)} m`
    : ''
  const provenance = edge.relationSource ? ` · ${edge.relationSource}` : ''
  return `${edge.networkName || 'Relasi'} · ${status}${confidence}${distance}${provenance}`
}

function resolutionLabel(status) {
  if (status === 'confirmed') return 'Relasi otomatis terkonfirmasi'
  return 'Belum tersambung'
}

function renderLegend(categories, networks, diagramBottom) {
  return `
    <g class="diagram-legend" transform="translate(32 ${diagramBottom + 28})">
      <text class="legend-title" x="0" y="0">NODE</text>
      ${categories.map((entry, index) => {
        const offsetX = 48 + index * 136
        return `
          ${renderLegendShape(entry, offsetX)}
          <text class="legend-label" x="${offsetX + 12}" y="0">${escapeXml(entry.label)}</text>
        `
      }).join('')}
    </g>
    <g class="diagram-network-legend" transform="translate(32 ${diagramBottom + 54})">
      <text class="legend-title" x="0" y="0">JALUR</text>
      ${networks.map((network, index) => {
        const offsetX = 48 + index * 128
        return `
          <line x1="${offsetX}" y1="-3" x2="${offsetX + 18}" y2="-3"
            stroke="${sanitizeColor(network.color)}" stroke-width="3" stroke-linecap="round"
            ${network.relationStatus === 'recommended' ? 'stroke-dasharray="6 4"' : ''}/>
          <text class="legend-label" x="${offsetX + 25}" y="0">${escapeXml(shortenLegend(network.name || 'Relasi terkonfirmasi'))}</text>
        `
      }).join('')}
    </g>
  `
}

function uniqueNodeTypes(nodes) {
  const seen = new Set()
  return nodes.map((node) => {
    const label = nodeTypeLabel(node.type)
    if (seen.has(label)) return null
    seen.add(label)
    const style = CATEGORY_STYLES[node.category] || CATEGORY_STYLES.infrastructure
    return { label, color: style.color, type: node.type }
  }).filter(Boolean)
}

function renderLegendShape(entry, x) {
  const type = String(entry.type || '').toLowerCase()
  if (type.includes('junction')) {
    return `<polygon points="${x},-9 ${x + 7},-3 ${x},3 ${x - 7},-3" fill="${SVG_THEME.background}" stroke="${entry.color}" stroke-width="2"/>`
  }
  if (type.includes('switch')) {
    return `<rect x="${x - 6}" y="-9" width="12" height="12" rx="3" fill="${SVG_THEME.background}" stroke="${entry.color}" stroke-width="2"/>`
  }
  return `<circle cx="${x}" cy="-3" r="6" fill="${SVG_THEME.background}" stroke="${entry.color}" stroke-width="2"/>`
}

function uniqueNetworks(edges, mode) {
  const seen = new Set()
  const entries = edges
    .filter((edge) => {
      const key = `${edge.networkId || edge.networkName}|${edge.relationStatus || 'confirmed'}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((edge) => ({
      id: edge.networkId,
      name: edge.relationStatus === 'recommended'
        ? 'Rekomendasi kuat'
        : mode === 'selected'
          ? 'Relasi terkonfirmasi'
          : (edge.networkName || 'Relasi terkonfirmasi'),
      color: edge.networkColor,
      relationStatus: edge.relationStatus || 'confirmed',
    }))
  return entries.length ? entries : [{
    id: 'confirmed-relation',
    name: 'Relasi terkonfirmasi',
    color: SVG_THEME.textSecondary,
  }]
}

function nodeTypeLabel(type = '') {
  const normalized = String(type).toLowerCase()
  if (normalized.includes('junction')) return 'Junction Box'
  if (normalized.includes('cctv') || normalized.includes('camera')) return 'CCTV'
  if (normalized.includes('switch')) return 'Switch'
  if (normalized.includes('server') || normalized.includes('nvr')) return 'Server / NVR'
  if (normalized.includes('otb')) return 'OTB'
  if (normalized.includes('tiang') || normalized.includes('pole')) return 'Tiang'
  return type || 'Aset lainnya'
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
  if (mode === 'selected') return 'relasi aset terpilih'
  if (mode === 'trace') return 'hasil tracing'
  if (mode === 'all-assets') return 'seluruh aset'
  if (mode === 'full-map') return 'peta jaringan lengkap'
  if (mode === 'focus') return 'relasi langsung aset fokus'
  return 'jaringan terpilih'
}

function shortenLegend(value = '') {
  return value.length > 16 ? `${value.slice(0, 14)}…` : value
}

function shortenNodeLabel(value = '') {
  return value.length > 20 ? `${value.slice(0, 18)}â€¦` : value
}

function shortenCompactLabel(value = '') {
  return value.length > 16 ? `${value.slice(0, 14)}…` : value
}

function shortenGroupLabel(value = '') {
  const normalized = String(value || '').trim() || 'tanpa nama'
  return normalized.length > 30 ? `${normalized.slice(0, 28)}…` : normalized
}

function shortAssetId(value = '') {
  const parts = value.split(':').filter(Boolean)
  const candidate = parts.at(-1) || value
  return candidate.length > 22 ? `${candidate.slice(0, 20)}â€¦` : candidate
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
