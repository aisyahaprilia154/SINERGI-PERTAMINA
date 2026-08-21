import {
  networkFamilyColor,
  networkFamilyLabel,
  normalizeTopologyRole,
} from '../../domain/topology-diagram-model.js'

const THEME = Object.freeze({
  background: '#ffffff',
  surface: '#ffffff',
  section: '#eef4f8',
  sectionBorder: '#cfdae4',
  lane: '#ffffff',
  laneBorder: '#d7e0e8',
  text: '#172231',
  secondary: '#5e6e7d',
  muted: '#8a98a5',
  grid: '#e9f0f4',
  edgeUnderlay: '#ffffff',
  edge: '#64798b',
  selected: '#174a73',
  dimmed: '#b6c0c9',
  candidate: '#bf7e16',
  suggested: '#b87913',
  unresolved: '#c4464f',
  connected: '#137c61',
})

export function renderTopologyDiagramSvg({
  model,
  layout,
  context = {},
  selectedAssetId = null,
  selectedEdgeId = null,
  selectedCandidateId = null,
  selectedUnresolvedId = null,
  selectedMountingGroupId = null,
  labelMode = 'auto',
  showAdminLayers = false,
  showMountingPhysical = true,
  zoom = 1,
  minimap = false,
} = {}) {
  if (!model || model.status !== 'ready' || !layout || layout.status !== 'ready') return ''
  const nodes = layout.nodes
  const edges = layout.edges
  const bottom = layout.height - layout.options.footerHeight
  const labelVisibility = getTopologyLabelVisibility({ labelMode, zoom, minimap })
  const directIds = selectedAssetId ? new Set(
    model.nodeById.get(selectedAssetId)?.directEdgeIds ?? [],
  ) : new Set()
  const directNodes = selectedAssetId
    ? new Set((model.nodeById.get(selectedAssetId)?.directEdgeIds ?? [])
      .flatMap((edgeId) => {
        const edge = model.edgeById.get(edgeId)
        return edge ? [edge.sourceId, edge.targetId] : []
      }))
    : new Set()
  const selectedEdge = selectedEdgeId ? model.edgeById.get(selectedEdgeId) : null
  const selectedEdgeNodes = selectedEdge
    ? new Set([selectedEdge.sourceId, selectedEdge.targetId])
    : new Set()
  const selectionActive = Boolean(selectedAssetId || selectedEdgeId)
  return `
    <svg class="topology-diagram-svg${minimap ? ' is-minimap' : ''}"
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}"
      width="${layout.width}" height="${layout.height}" role="img"
      aria-labelledby="topology-diagram-title topology-diagram-description">
      <title id="topology-diagram-title">Diagram Topologi ${escapeXml(context.branchName ?? model.branchId ?? '')}</title>
      <desc id="topology-diagram-description">Graph logis dari root atau core menuju perangkat endpoint.
        ${model.summary.totalAssetCount} aset, ${model.summary.confirmedEdgeCount} relasi terkonfirmasi.</desc>
      <metadata id="topology-diagram-metadata">branchId=${escapeXml(context.branchId ?? model.branchId ?? '')};
        datasetId=${escapeXml(context.datasetId ?? model.datasetId ?? '')};
        datasetVersionId=${escapeXml(context.datasetVersionId ?? model.datasetVersionId ?? '')};
        area=${escapeXml(model.area ?? 'all')}</metadata>
      <defs>
        <marker id="topology-arrow" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="${THEME.connected}"/>
        </marker>
        <marker id="topology-arrow-selected" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="${THEME.selected}"/>
        </marker>
        <style>
          .topology-bg{fill:${THEME.background}}
          .topology-heading{font:700 20px Inter,ui-sans-serif,system-ui;fill:${THEME.text}}
          .topology-meta{font:500 11px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary}}
          .topology-summary{font:700 11px Inter,ui-sans-serif,system-ui;fill:${THEME.text}}
          .topology-section{fill:none;stroke:none}
          .topology-section-title{font:800 11px Inter,ui-sans-serif,system-ui;fill:${THEME.text};letter-spacing:.08em}
          .topology-section-count{font:600 10px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary}}
          .topology-section-divider{stroke:${THEME.sectionBorder};stroke-width:1}
          .topology-overview-kicker{font:800 9px Inter,ui-sans-serif,system-ui;fill:${THEME.muted};letter-spacing:.1em}
          .topology-area-overview-card{cursor:pointer}
          .topology-area-overview-card rect{fill:rgba(255,255,255,.92);stroke:${THEME.sectionBorder};stroke-width:1.2}
          .topology-area-overview-card:hover rect,.topology-area-overview-card:focus rect{fill:#fff;stroke:${THEME.selected};stroke-width:1.8}
          .topology-area-overview-name{font:800 14px Inter,ui-sans-serif,system-ui;fill:${THEME.text}}
          .topology-area-overview-count{font:700 10px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary}}
          .topology-area-overview-metric{font:500 10px Inter,ui-sans-serif,system-ui;fill:${THEME.muted}}
          .topology-area-overview-action{font:800 10px Inter,ui-sans-serif,system-ui;fill:${THEME.selected}}
          .topology-lane{fill:none;stroke:none}
          .topology-lane-kicker{font:800 8px Inter,ui-sans-serif,system-ui;fill:#718492;letter-spacing:.09em}
          .topology-lane-meta{font:600 8px Inter,ui-sans-serif,system-ui;fill:#91a0ab}
          .topology-lane-header-line{stroke:#e2e9ee;stroke-width:1}
          .topology-lane-title{font:750 9px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary};letter-spacing:.08em}
          .topology-lane-root{font:600 9px Inter,ui-sans-serif,system-ui;fill:${THEME.muted}}
          .topology-band-title{font:800 8px Inter,ui-sans-serif,system-ui;fill:${THEME.muted};letter-spacing:.09em}
          .topology-band-divider{stroke:${THEME.laneBorder};stroke-width:1;stroke-dasharray:3 5}
          .topology-mounting-group{cursor:pointer;outline:none}
          .topology-mounting-bubble{fill-opacity:.56;stroke-width:1.4;vector-effect:non-scaling-stroke}
          .topology-mounting-group:hover .topology-mounting-bubble,.topology-mounting-group.selected .topology-mounting-bubble{stroke:${THEME.selected};stroke-width:2.2}
          .topology-mounting-label-bg{fill:rgba(255,255,255,.88);stroke:rgba(113,132,146,.28);stroke-width:1}
          .topology-mounting-label{font:800 8px Inter,ui-sans-serif,system-ui;fill:#4e6879;letter-spacing:.03em}
          .topology-cross-area-gateway{pointer-events:none}
          .topology-cross-area-line{stroke:#7294a7;stroke-width:1.4;stroke-dasharray:4 4}
          .topology-cross-area-marker{fill:#fff;stroke:#7294a7;stroke-width:1.3}
          .topology-cross-area-label{font:800 8px Inter,ui-sans-serif,system-ui;fill:#557486}
          .topology-isolated{fill:#fbfcfd;stroke:${THEME.sectionBorder};stroke-width:1.2}
          .topology-isolated-title{font:800 11px Inter,ui-sans-serif,system-ui;fill:${THEME.text}}
          .topology-unresolved-panel{fill:#fff7f7;stroke:#e9babe;stroke-width:1.2}
          .topology-unresolved-label{font:750 10px Inter,ui-sans-serif,system-ui;fill:${THEME.unresolved}}
          .topology-edge-underlay{fill:none;stroke:${THEME.edgeUnderlay};stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
          .topology-edge{fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
          .topology-edge.trace{stroke:${THEME.selected};stroke-width:5}
          .topology-edge.selected{stroke:${THEME.selected};stroke-width:4}
          .topology-edge.dimmed{stroke:${THEME.dimmed};opacity:.32}
          .topology-edge.direct{stroke-width:4}
          .topology-edge.suggested{stroke:${THEME.suggested};stroke-dasharray:9 7;stroke-width:2.8}
          .topology-edge.candidate{stroke:${THEME.candidate};stroke-dasharray:9 7;stroke-width:2.8}
          .topology-edge.candidate.dimmed{opacity:.22}
          .topology-node{cursor:pointer;outline:none}
          .topology-node-card{fill:#fff;stroke:#d7e0e8;stroke-width:1.2}
          .topology-node-accent{opacity:.92}
          .topology-node:hover .topology-node-card,.topology-node:focus .topology-node-card{fill:#fff;stroke:${THEME.selected};stroke-width:2}
          .topology-node.core .topology-node-card{fill:#f1f8fc;stroke:#a8c8da;stroke-width:1.6}
          .topology-node.core .topology-device-icon{fill:#2388b9;stroke:#12638c;stroke-width:2.8}
          .topology-node.core .topology-device-glyph{fill:#fff}
          .topology-node.selected .topology-device-icon,.topology-node:focus .topology-device-icon{stroke:${THEME.selected};stroke-width:3.4}
          .topology-node.selected .topology-node-card{fill:#eef7fc;stroke:${THEME.selected};stroke-width:2.4}
          .topology-node.direct .topology-device-icon{stroke:#5a8bad;stroke-width:2.5}
          .topology-node.direct .topology-node-card{stroke:#83a9bf;stroke-width:1.8}
          .topology-node.dimmed{opacity:.28}
          .topology-node.match .topology-device-icon{stroke:#13906d;stroke-width:2.5}
          .topology-node-hitbox{fill:transparent;stroke:none}
          .topology-node.disconnected .topology-node-card{fill:#fafbfc;stroke:#aeb9c3;stroke-dasharray:4 3}
          .topology-node.suggested-only .topology-node-card{fill:#fffaf0;stroke:${THEME.candidate};stroke-dasharray:5 3}
          .topology-node-halo{fill:none;stroke:${THEME.selected};stroke-width:2;opacity:0}
          .topology-node.selected .topology-node-halo,.topology-node:focus .topology-node-halo{opacity:.32}
          .topology-device-icon{fill:${THEME.surface};stroke-width:2.2}
          .topology-device-glyph{font:900 8px Inter,ui-sans-serif,system-ui;fill:${THEME.text};pointer-events:none}
          .topology-node-name{font:750 11px Inter,ui-sans-serif,system-ui;fill:${THEME.text};text-anchor:middle}
          .topology-node-type{font:500 9px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary};text-anchor:middle}
          .topology-node-status{font:600 8px Inter,ui-sans-serif,system-ui;fill:${THEME.muted}}
          .topology-root-badge{fill:#e0f3ec;stroke:#a9d9c9;stroke-width:1}
          .topology-root-text{font:800 7px Inter,ui-sans-serif,system-ui;fill:#17684f;letter-spacing:.06em}
          .topology-compact-name{font:700 10px Inter,ui-sans-serif,system-ui;fill:${THEME.text}}
          .topology-compact-type{font:500 8px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary}}
          .topology-node-warning{fill:#fff7e5;stroke:${THEME.candidate};stroke-width:1.5}
          .topology-node-warning-text{font:900 9px Inter,ui-sans-serif,system-ui;fill:${THEME.candidate};text-anchor:middle}
          .topology-candidate{cursor:pointer}
          .topology-candidate-marker{fill:#fff9ed;stroke:${THEME.candidate};stroke-width:2;stroke-dasharray:4 3}
          .topology-candidate-text{font:800 8px Inter,ui-sans-serif,system-ui;fill:${THEME.candidate}}
          .topology-candidate-warning{fill:#fff9ed;stroke:${THEME.candidate};stroke-width:1.5}
          .topology-candidate-warning-text{font:900 10px Inter,ui-sans-serif,system-ui;fill:${THEME.candidate}}
          .topology-suggested-label{font:850 8px Inter,ui-sans-serif,system-ui;fill:${THEME.suggested};text-anchor:middle}
          .topology-unresolved-marker{cursor:pointer;fill:#fff;stroke:${THEME.unresolved};stroke-width:2;stroke-dasharray:4 3}
          .topology-unresolved-x{stroke:${THEME.unresolved};stroke-width:1.7}
          .topology-legend-label{font:600 9px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary}}
          .topology-legend-title{font:800 8px Inter,ui-sans-serif,system-ui;fill:${THEME.muted};letter-spacing:.08em}
          .topology-disclaimer{font:500 9px Inter,ui-sans-serif,system-ui;fill:${THEME.muted}}
        </style>
      </defs>
      <rect class="topology-bg" width="${layout.width}" height="${layout.height}"/>
      ${renderHeading(model, layout, context, minimap)}
      ${layout.mode === 'area-overview'
        ? renderAreaOverview(layout)
        : `<g class="topology-sections" aria-label="Area fasilitas">
          ${layout.sections.map((section) => renderSection(section)).join('')}
        </g>`}
      ${showMountingPhysical && layout.mode !== 'area-overview'
        ? renderMountingGroups(model, layout, { selectedMountingGroupId, minimap })
        : ''}
      <g class="topology-edges" aria-label="Relasi terkonfirmasi">
        ${edges.map((edge) => renderEdge({
          ...model.edgeById.get(edge.id),
          ...edge,
          dimmed: edge.dimmed || (selectionActive && !edge.trace && (
            selectedEdgeId ? edge.id !== selectedEdgeId : !directIds.has(edge.id)
          )),
        }, {
          selectedEdgeId,
          directIds,
          minimap,
        })).join('')}
      </g>
      ${showAdminLayers ? renderAdminLayer(model, layout, {
        selectedCandidateId,
        selectedUnresolvedId,
        minimap,
      }) : ''}
      <g class="topology-nodes" aria-label="Aset">
        ${nodes.map((node) => renderNode({
          ...model.nodeById.get(node.id),
          ...node,
          dimmed: node.dimmed || (selectionActive && !node.trace && (
            selectedAssetId
              ? !directNodes.has(node.id) && node.id !== selectedAssetId
              : !selectedEdgeNodes.has(node.id)
          )),
        }, {
          selectedAssetId,
          directNodes,
          labelVisibility,
          minimap,
        })).join('')}
      </g>
      ${layout.mode === 'area-overview' ? '' : renderCrossAreaMarkers(layout)}
      ${minimap ? '' : renderLegend(bottom, layout.width, showMountingPhysical)}
    </svg>
  `
}

export function getTopologyLabelVisibility({
  labelMode = 'auto',
  zoom = 1,
  minimap = false,
} = {}) {
  if (minimap || labelMode === 'off') return 'off'
  if (labelMode === 'all') return 'all'
  return Number(zoom) >= .75 ? 'all' : 'core-peer'
}

export function renderTopologyDiagramLegend(model) {
  return (model?.networkOptions ?? []).map((family) => ({
    ...family,
    label: networkFamilyLabel(family.id),
  }))
}

function renderHeading(model, layout, context, minimap) {
  if (minimap) return ''
  const summary = model.summary
  const areaLabel = model.area
    ? model.areas[0]?.name ?? model.area
    : layout.mode === 'area-overview' ? 'pilih area untuk membuka detail' : 'Seluruh area fasilitas'
  const title = layout.mode === 'area-overview' ? 'Overview Area' : 'Diagram Topologi'
  const meta = layout.mode === 'area-overview'
    ? `${summary.areaCount} area · ${summary.totalAssetCount} aset tersedia`
    : `${areaLabel} · ${summary.totalAssetCount} aset · ${summary.confirmedEdgeCount} edge`
  return `
    <g class="topology-heading-group">
      <text class="topology-heading" x="32" y="36">${escapeXml(title)} · ${escapeXml(
        context.branchName ?? model.branchId ?? 'Cabang aktif',
      )}</text>
      <text class="topology-meta" x="32" y="58">${escapeXml(meta)}</text>
      <text class="topology-summary" x="${layout.width - 32}" y="36" text-anchor="end">
        ${summary.totalAssetCount} aset · ${summary.connectedAssetCount} terhubung
      </text>
      <text class="topology-meta" x="${layout.width - 32}" y="58" text-anchor="end">
        ${summary.areaCount} area · ${summary.crossAreaEdgeCount ?? 0} continuation antar-area
      </text>
      <line x1="32" y1="78" x2="${layout.width - 32}" y2="78" stroke="${THEME.sectionBorder}"/>
    </g>
  `
}

function renderSection(section) {
  return `
    <g class="topology-section-group" data-area-key="${escapeAttribute(section.key)}">
      <text class="topology-section-title" x="${section.x + 24}" y="${section.y + 30}">
        ${escapeXml(section.name.toUpperCase())}
      </text>
      <text class="topology-section-count" x="${section.x + section.width - 24}" y="${section.y + 30}" text-anchor="end">
        ${section.nodeCount} aset · ${section.componentCount} kelompok jalur · ${section.isolatedCount} belum terhubung${section.suggestedOnlyCount ? ` · ${section.suggestedOnlyCount} memiliki saran` : ''}${section.crossAreaCount ? ` · ${section.crossAreaCount} lintas area` : ''}
      </text>
      <line class="topology-section-divider" x1="${section.x + 24}" y1="${section.y + 42}"
        x2="${section.x + section.width - 24}" y2="${section.y + 42}"/>
      ${section.lanes.map((lane) => renderLane(lane, section)).join('')}
      ${section.isolated ? renderIsolated(section.isolated, section) : ''}
      ${section.unresolved ? renderUnresolvedPanel(section.unresolved, section) : ''}
    </g>
  `
}

function renderAreaOverview(layout) {
  const margin = layout.options.overviewMargin ?? layout.options.margin
  return `<g class="topology-area-overview" aria-label="Ringkasan area fasilitas">
    <text class="topology-overview-kicker" x="${margin}" y="${margin + 78}">
      AREA OVERVIEW · PILIH AREA UNTUK DETAIL
    </text>
    ${(layout.overviewAreas ?? []).map((area) => `
      <g class="topology-area-overview-card" data-area-overview="${escapeAttribute(area.key)}"
        tabindex="0" role="button" aria-label="Buka detail area ${escapeAttribute(area.name)}">
        <rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" rx="14"/>
        <text class="topology-area-overview-name" x="${area.x + 18}" y="${area.y + 28}">${escapeXml(
          shorten(area.name, 34),
        )}</text>
        <text class="topology-area-overview-count" x="${area.x + 18}" y="${area.y + 53}">
          ${area.nodeCount} aset · ${area.componentCount} kelompok jalur
        </text>
        <text class="topology-area-overview-metric" x="${area.x + 18}" y="${area.y + 78}">
          ${area.connectedCount} terhubung · ${area.disconnectedCount} tanpa relasi
        </text>
        <text class="topology-area-overview-metric" x="${area.x + 18}" y="${area.y + 100}">
          ${area.crossAreaEdgeCount ? `${area.crossAreaEdgeCount} koneksi antar-area` : 'Tidak ada koneksi antar-area'}
        </text>
        <text class="topology-area-overview-action" x="${area.x + area.width - 18}" y="${area.y + area.height - 18}" text-anchor="end">
          Buka detail →
        </text>
      </g>
    `).join('')}
  </g>`
}

function renderMountingGroups(model, layout, { selectedMountingGroupId = null, minimap = false } = {}) {
  const layoutNodeById = new Map(layout.nodes.map((node) => [node.id, node]))
  return (model.mountingGroups ?? []).map((group, index) => {
    const childNodes = group.childIds.map((id) => layoutNodeById.get(id)).filter(Boolean)
    if (!childNodes.length) return ''
    const hostName = shorten(group.hostName || group.hostId, 18)
    const minX = Math.min(...childNodes.map((node) => node.diagram.x))
    const minY = Math.min(...childNodes.map((node) => node.diagram.y))
    const maxX = Math.max(...childNodes.map((node) => node.diagram.x + node.diagram.width))
    const maxY = Math.max(...childNodes.map((node) => node.diagram.y + node.diagram.height))
    const width = maxX - minX
    const height = maxY - minY
    const cx = minX + width / 2
    const cy = minY + height / 2
    const rx = Math.max(54, width / 2 + 26)
    const ry = Math.max(48, height / 2 + 30)
    const palette = mountingBubblePalette(group.hostId, index)
    const label = `${hostName} · ${childNodes.length} aset`
    const labelWidth = Math.max(64, label.length * 5.1 + 18)
    const labelX = cx - rx + 14
    const labelY = cy - ry + 12
    return `<g class="topology-mounting-group${selectedMountingGroupId === group.id ? ' selected' : ''}"
      data-mounting-group-id="${escapeAttribute(group.id)}" tabindex="0" role="button"
      aria-label="${escapeAttribute(label)} terpasang pada tiang yang sama">
      <ellipse class="topology-mounting-bubble" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
        fill="${palette.fill}" stroke="${palette.stroke}"/>
      ${minimap ? '' : `<rect class="topology-mounting-label-bg" x="${labelX}" y="${labelY}"
        width="${labelWidth}" height="20" rx="10"/>
      <text class="topology-mounting-label" x="${labelX + 9}" y="${labelY + 13}">${escapeXml(label)}</text>`}
      <title>${escapeXml(label)} · area berwarna menunjukkan perangkat pada tiang yang sama</title>
    </g>`
  }).join('')
}

function renderLane(lane, section) {
  const x = section.x + lane.x
  const y = section.y + lane.y
  if (lane.presentation === 'hub-spoke') {
    return `<g class="topology-lane-group topology-lane-hub-spoke" data-component-id="${escapeAttribute(lane.componentId)}">
      <text class="topology-lane-kicker" x="${x + 4}" y="${y + 13}">${escapeXml(lane.title.toUpperCase())}</text>
      <text class="topology-lane-meta" x="${x + lane.width - 4}" y="${y + 13}" text-anchor="end">
        ${lane.nodes.length} perangkat · ${lane.edgeCount} koneksi
      </text>
      <line class="topology-lane-header-line" x1="${x + 4}" y1="${y + 23}" x2="${x + lane.width - 4}" y2="${y + 23}"/>
    </g>`
  }
  return `
    <g class="topology-lane-group" data-component-id="${escapeAttribute(lane.componentId)}">
      <line class="topology-band-divider" x1="${x}" y1="${y}" x2="${x + lane.width}" y2="${y}"/>
      ${lane.bands.map((band) => renderBand(band, x, y)).join('')}
    </g>
  `
}

function renderBand(band, offsetX, offsetY) {
  const x = offsetX + band.x
  const y = offsetY + band.y
  return `<g class="topology-band topology-band-${escapeAttribute(band.kind)}">
    <text class="topology-band-title" x="${x + 2}" y="${y + 14}">${escapeXml(band.title)}</text>
    <line class="topology-band-divider" x1="${x}" y1="${y + band.height}" x2="${x + band.width}" y2="${y + band.height}"/>
  </g>`
}

function renderIsolated(spec, section) {
  const x = section.x + spec.x
  const y = section.y + spec.y
  const title = spec.disconnectedCount
    ? 'Belum Terhubung · Aset tanpa relasi terkonfirmasi'
    : 'Aset dengan saran koneksi'
  return `
    <g class="topology-isolated-group">
      <rect class="topology-isolated" x="${x}" y="${y}" width="${spec.width}" height="${spec.height}" rx="13"/>
      <text class="topology-isolated-title" x="${x + 18}" y="${y + 27}">${title}</text>
      <text class="topology-section-count" x="${x + spec.width - 18}" y="${y + 27}" text-anchor="end">
        ${spec.disconnectedCount} tanpa relasi${spec.suggestedOnlyCount ? ` · ${spec.suggestedOnlyCount} memiliki saran` : ''} · tidak ada koneksi buatan
      </text>
    </g>
  `
}

function renderUnresolvedPanel(panel, section) {
  const x = section.x + panel.x
  const y = section.y + panel.y
  return `
    <g class="topology-unresolved-panel-group">
      <rect class="topology-unresolved-panel" x="${x}" y="${y}" width="${panel.width}" height="${panel.height}" rx="10"/>
      <text class="topology-unresolved-label" x="${x + 18}" y="${y + 25}">
        Jalur belum terpetakan · ${panel.items.length}
      </text>
      <text class="topology-section-count" x="${x + panel.width - 18}" y="${y + 25}" text-anchor="end">
        layer administrator · bukan relasi operasional
      </text>
    </g>
  `
}

function renderEdge(edge, { selectedEdgeId, directIds, minimap }) {
  const path = orthogonalPath(edge.routePoints ?? edge.linePoints)
  const family = normalizeFamilyClass(edge.networkFamily)
  const selected = edge.id === selectedEdgeId
  const direct = directIds.has(edge.id)
  const classes = [
    'topology-edge',
    `family-${family}`,
    edge.trace ? 'trace' : '',
    selected ? 'selected' : '',
    direct ? 'direct' : '',
    edge.dimmed ? 'dimmed' : '',
  ].filter(Boolean).join(' ')
  const color = edge.trace || selected ? THEME.selected : edge.dimmed ? THEME.dimmed : THEME.edge
  const marker = edge.trace || selected ? 'topology-arrow-selected' : 'topology-arrow'
  const arrow = !edge.dimmed && !minimap && edge.direction !== 'undirected'
    ? `${edge.direction === 'target_to_source' || edge.direction === 'bidirectional'
      ? ` marker-start="url(#${marker})"`
      : ''}${edge.direction === 'source_to_target' || edge.direction === 'bidirectional'
      ? ` marker-end="url(#${marker})"`
      : ''}`
    : ''
  return `
    <g class="topology-edge-target" data-edge-id="${escapeAttribute(edge.id)}" tabindex="0"
      role="button" aria-label="Detail relasi ${escapeAttribute(edge.id)}">
      <path class="topology-edge-underlay" d="${path}"/>
      <path class="${classes}" d="${path}" stroke="${escapeAttribute(color)}"${arrow}>
        <title>${escapeXml(describeEdge(edge))}</title>
      </path>
    </g>
  `
}

function renderNode(node, {
  selectedAssetId,
  directNodes,
  labelVisibility,
  minimap,
}) {
  const { x, y, width, height } = node.diagram
  const selected = node.id === selectedAssetId
  const direct = directNodes.has(node.id) && !selected
  const classes = [
    'topology-node',
    node.dimmed ? 'dimmed' : '',
    node.isCore || ['root', 'core'].includes(node.topologyRole) ? 'core' : '',
    selected ? 'selected' : '',
    direct ? 'direct' : '',
    node.matched ? 'match' : '',
    node.connectivityStatus === 'disconnected' ? 'disconnected' : '',
    node.connectivityStatus === 'suggested-only' ? 'suggested-only' : '',
  ].filter(Boolean).join(' ')
  const color = networkFamilyColor(node.networkFamily)
  const iconX = x + width / 2
  const iconY = y + (node.presentation === 'compact' ? 38 : 42)
  const labelY = y + 13
  const typeY = y + 25
  const warning = node.connectivityStatus === 'disconnected'
    ? '!'
    : node.connectivityStatus === 'suggested-only' ? 'S' : ''
  const showLabels = labelVisibility === 'all'
    || (labelVisibility === 'core-peer'
      && ['rack-root', 'junction-peer', 'junction-extended'].includes(node.diagramClass))
  const showType = showLabels && node.presentation !== 'hub-spoke'
  return `
    <g class="${classes}" data-node-id="${escapeAttribute(node.id)}" tabindex="0" role="button"
      aria-label="Pilih aset ${escapeAttribute(node.id)}">
      <title>${escapeXml(describeNode(node))}</title>
      <rect class="topology-node-card" x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/>
      <rect class="topology-node-accent" x="${x + 8}" y="${y}" width="${Math.max(14, width - 16)}" height="3" rx="1.5"
        fill="${escapeAttribute(color)}"/>
      <rect class="topology-node-hitbox" x="${x}" y="${y}" width="${width}" height="${height}"/>
      <circle class="topology-node-halo" cx="${iconX}" cy="${iconY}" r="${node.isCore ? 28 : 24}"/>
      ${renderNodeGlyph(node, iconX, iconY, color)}
      ${showLabels ? `
        <text class="topology-node-name" x="${iconX}" y="${labelY}">${escapeXml(shorten(node.name || node.id, node.presentation === 'hub-spoke' ? 18 : 24))}</text>
        ${showType ? `<text class="topology-node-type" x="${iconX}" y="${typeY}">${escapeXml(shorten(node.type || 'Aset', 27))}</text>` : ''}
      ` : ''}
      ${warning ? `<circle class="topology-node-warning" cx="${x + width - 8}" cy="${y + 8}" r="8"/>
        <text class="topology-node-warning-text" x="${x + width - 8}" y="${y + 11}">${warning}</text>` : ''}
      ${node.isVerifiedRoot && !minimap ? `
        <rect class="topology-root-badge" x="${iconX - 24}" y="${y - 15}" width="48" height="14" rx="7"/>
        <text class="topology-root-text" x="${iconX}" y="${y - 5}" text-anchor="middle">ROOT</text>
      ` : ''}
    </g>
  `
}

function renderCrossAreaMarkers(layout) {
  return (layout.crossAreaMarkers ?? []).map((marker) => {
    const labelX = marker.x + 12
    const labelY = marker.y + 14
    const lineEndX = marker.x < marker.anchorX ? marker.x + marker.width : marker.x
    return `<g class="topology-cross-area-gateway" aria-label="${escapeAttribute(
      `Continuation menuju ${marker.outsideAreaName || marker.outsideAreaKey}`,
    )}">
      <line class="topology-cross-area-line" x1="${marker.anchorX}" y1="${marker.anchorY}"
        x2="${lineEndX}" y2="${marker.y + marker.height / 2}"/>
      <rect class="topology-cross-area-marker" x="${marker.x}" y="${marker.y}"
        width="${marker.width}" height="${marker.height}" rx="11"/>
      <text class="topology-cross-area-label" x="${labelX}" y="${labelY}">${escapeXml(
        marker.label,
      )}</text>
    </g>`
  }).join('')
}

function renderAdminLayer(model, layout, { selectedCandidateId, selectedUnresolvedId, minimap }) {
  const layoutNodeById = new Map(layout.nodes.map((node) => [node.id, node]))
  const candidates = (model.suggestedLinks ?? model.candidates ?? []).filter((candidate) => (
    layoutNodeById.has(candidate.sourceId) && layoutNodeById.has(candidate.targetId)
  ))
  const candidateEdges = candidates.map((candidate) => {
    const source = layoutNodeById.get(candidate.sourceId)
    const target = layoutNodeById.get(candidate.targetId)
    const route = candidateRoute(source, target)
    const warningX = (route[0].x + route[route.length - 1].x) / 2
    const warningY = (route[0].y + route[route.length - 1].y) / 2
    const ambiguous = candidate.candidateStatus === 'ambiguous'
    return `<g class="topology-candidate suggested${candidate.candidateId === selectedCandidateId ? ' selected' : ''}"
      data-candidate-id="${escapeAttribute(candidate.candidateId)}" tabindex="0" role="button"
      aria-label="Kandidat koneksi ${escapeAttribute(candidate.candidateId)}">
      <path class="topology-edge-underlay" d="${orthogonalPath(route)}"/>
      <path class="topology-edge candidate" d="${straightPath(route)}">
        <title>${escapeXml(describeCandidate(candidate))}</title>
      </path>${!minimap ? `<text class="topology-suggested-label" x="${warningX}" y="${warningY - 8}">Saran</text>` : ''}${ambiguous ? `<circle class="topology-candidate-warning" cx="${warningX}" cy="${warningY}" r="9">
        <title>Ambiguous: kandidat memiliki lebih dari satu interpretasi endpoint.</title>
      </circle><text class="topology-candidate-warning-text" x="${warningX}" y="${warningY + 4}" text-anchor="middle">!</text>` : ''}
    </g>`
  }).join('')
  const markers = layout.unresolvedMarkers.map((item) => `
    <g class="topology-unresolved-target${item.unresolvedId === selectedUnresolvedId ? ' selected' : ''}"
      data-unresolved-id="${escapeAttribute(item.unresolvedId)}" tabindex="0" role="button"
      aria-label="Endpoint unresolved ${escapeAttribute(item.unresolvedId)}">
      <circle class="topology-unresolved-marker" cx="${item.x}" cy="${item.y}" r="9"/>
      <path class="topology-unresolved-x" d="M ${item.x - 4} ${item.y - 4} L ${item.x + 4} ${item.y + 4} M ${item.x + 4} ${item.y - 4} L ${item.x - 4} ${item.y + 4}"/>
      ${minimap ? '' : `<title>${escapeXml(describeUnresolved(item))}</title>`}
    </g>
  `).join('')
  return `<g class="topology-admin-layer" aria-label="Layer administrator">${candidateEdges}${markers}</g>`
}

function renderNodeGlyph(node, x, y, color) {
  const role = normalizeTopologyRole(node.topologyRole)
  const radius = node.isCore ? 18 : 15
  if (node.iconType === 'server-rack-core' || ['root', 'core', 'server', 'nvr', 'router'].includes(role)) {
    return `<rect class="topology-device-icon" x="${x - 18}" y="${y - 18}" width="36" height="36" rx="6" stroke="${color}"/>
      <text class="topology-device-glyph" x="${x}" y="${y + 3}" text-anchor="middle">${role === 'router' ? 'R' : 'SR'}</text>`
  }
  if (node.iconType === 'junction-box' || role === 'junction' || role === 'otb') {
    return `<polygon class="topology-device-icon" points="${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}" stroke="${color}"/>
      <text class="topology-device-glyph" x="${x}" y="${y + 3}" text-anchor="middle">${role === 'otb' ? 'OT' : 'JB'}</text>`
  }
  if (node.iconType === 'switch-otb' || role === 'switch' || role === 'distribution') {
    return `<rect class="topology-device-icon" x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" rx="5" stroke="${color}"/>
      <text class="topology-device-glyph" x="${x}" y="${y + 3}" text-anchor="middle">SW</text>`
  }
  if (node.iconType === 'pole-mounting') {
    return `<path class="topology-device-icon" d="M ${x} ${y - 18} L ${x + 13} ${y + 14} L ${x - 13} ${y + 14} Z" stroke="${color}"/>
      <text class="topology-device-glyph" x="${x}" y="${y + 6}" text-anchor="middle">P</text>`
  }
  return `<circle class="topology-device-icon" cx="${x}" cy="${y}" r="${radius}" stroke="${color}"/>
    <text class="topology-device-glyph" x="${x}" y="${y + 3}" text-anchor="middle">${escapeXml(glyphFor(node))}</text>`
}

function renderLegend(bottom, width, showMountingPhysical) {
  return `
    <line x1="32" y1="${bottom + 8}" x2="${width - 32}" y2="${bottom + 8}" stroke="${THEME.sectionBorder}"/>
    <g class="topology-legend">
      <text class="topology-legend-title" x="32" y="${bottom + 37}">KETERANGAN</text>
      <line x1="112" y1="${bottom + 34}" x2="134" y2="${bottom + 34}" stroke="${THEME.edge}" stroke-width="2.6"/>
      <text class="topology-legend-label" x="142" y="${bottom + 37}">Terhubung</text>
      <line x1="224" y1="${bottom + 34}" x2="246" y2="${bottom + 34}" stroke="${THEME.candidate}" stroke-width="2.5" stroke-dasharray="8 6"/>
      <text class="topology-legend-label" x="254" y="${bottom + 37}">Saran koneksi</text>
      <circle cx="366" cy="${bottom + 31}" r="7" fill="#fff" stroke="${THEME.unresolved}" stroke-dasharray="4 3"/>
      <text class="topology-legend-label" x="380" y="${bottom + 34}">Belum terhubung</text>
      ${showMountingPhysical ? `<ellipse cx="506" cy="${bottom + 31}" rx="14" ry="9" fill="#dfeff5" stroke="#8fb8c8"/>
      <text class="topology-legend-label" x="528" y="${bottom + 34}">Satu tiang</text>` : ''}
      <text class="topology-disclaimer" x="32" y="${bottom + 64}">Klik perangkat atau garis untuk melihat identitas dan detail relasinya.</text>
    </g>
  `
}

function mountingBubblePalette(hostId, fallbackIndex = 0) {
  const palettes = [
    { fill: '#dfeff5', stroke: '#8fb8c8' },
    { fill: '#e4f3ed', stroke: '#91c2b1' },
    { fill: '#eee9f7', stroke: '#b5a5d2' },
    { fill: '#f7eddc', stroke: '#d2b27e' },
  ]
  const hash = [...String(hostId ?? '')].reduce((total, character) => (
    (total * 31 + character.charCodeAt(0)) >>> 0
  ), Number(fallbackIndex) || 0)
  return palettes[hash % palettes.length]
}

function candidateRoute(source, target) {
  const sourceBox = source.diagram
  const targetBox = target.diagram
  if (targetBox.centerY > sourceBox.centerY + 2) {
    return [
      { x: sourceBox.centerX, y: sourceBox.bottomY },
      { x: targetBox.centerX, y: targetBox.topY },
    ]
  }
  if (targetBox.centerY < sourceBox.centerY - 2) {
    return [
      { x: sourceBox.centerX, y: sourceBox.topY },
      { x: targetBox.centerX, y: targetBox.bottomY },
    ]
  }
  if (targetBox.centerX >= sourceBox.centerX) {
    return [
      { x: sourceBox.x + sourceBox.width, y: sourceBox.centerY },
      { x: targetBox.x, y: targetBox.centerY },
    ]
  }
  return [
    { x: sourceBox.x, y: sourceBox.centerY },
    { x: targetBox.x + targetBox.width, y: targetBox.centerY },
  ]
}

function orthogonalPath(points = []) {
  if (!points.length) return ''
  return points.map((point, index) => `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`).join(' ')
}

function straightPath(points = []) {
  if (!points.length) return ''
  return points.map((point, index) => `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`).join(' ')
}

function describeEdge(edge) {
  const details = [
    edge.relationId && `Relasi ${edge.relationId}`,
    edge.networkFamilyLabel,
    edge.direction !== 'undirected' ? `arah ${edge.direction}` : 'undirected',
    edge.sourceGeometryId && `geometry ${edge.sourceGeometryId}`,
    edge.lengthMeters !== null && `panjang ${formatNumber(edge.lengthMeters)} m`,
    edge.confidence !== null && `confidence ${Math.round(edge.confidence * 100)}%`,
    edge.provenance,
  ].filter(Boolean)
  return details.join(' · ')
}

function describeNode(node) {
  return [
    node.id,
    node.name,
    node.type,
    node.status && `status ${node.status}`,
    node.areaName,
    node.relationStatus === 'confirmed' ? 'memiliki relasi terkonfirmasi' : 'aset tanpa relasi',
  ].filter(Boolean).join(' · ')
}

function describeCandidate(candidate) {
  return [
    `Kandidat ${candidate.candidateId}`,
    candidate.sourceId,
    candidate.targetId,
    candidate.networkFamilyLabel,
    Number.isFinite(Number(candidate.score)) && `confidence ${Math.round(Number(candidate.score) * 100)}%`,
    candidate.provenance,
  ].filter(Boolean).join(' · ')
}

function describeUnresolved(item) {
  return [
    `Unresolved ${item.unresolvedId}`,
    item.sourcePathAssetId,
    item.endpointRole,
    item.reason,
  ].filter(Boolean).join(' · ')
}

function glyphFor(node) {
  const source = `${node.type ?? ''} ${node.name ?? ''}`.toLowerCase()
  if (source.includes('cctv') || source.includes('camera')) return 'C'
  if (source.includes('server')) return 'S'
  if (source.includes('nvr')) return 'N'
  if (source.includes('router')) return 'R'
  if (source.includes('access point')) return 'AP'
  if (source.includes('printer')) return 'P'
  return '•'
}

function normalizeFamilyClass(value) {
  return String(value ?? 'unmapped').toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

function shorten(value, max) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('id-ID', { maximumFractionDigits: 1 }) : '—'
}

function round(value) {
  return Math.round(Number(value) * 100) / 100
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
