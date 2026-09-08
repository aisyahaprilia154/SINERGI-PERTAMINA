import {
  networkFamilyLabel,
  normalizeTopologyRole,
} from '../../domain/topology-diagram-model.js'
import { semanticZoomLevelForZoom } from './topology-viewport.js'

const THEME = Object.freeze({
  background: '#fdfcfb',
  surface: '#ffffff',
  section: '#f3f4f5',
  sectionBorder: '#c7c5ce',
  lane: '#ffffff',
  laneBorder: '#c7c5ce',
  text: '#03071d',
  secondary: '#46464d',
  muted: '#77767e',
  grid: '#e7e8e9',
  edgeUnderlay: '#ffffff',
  edge: '#006c4b',
  selected: '#5b7eff',
  dimmed: '#c7c5ce',
  candidate: '#f97316',
  suggested: '#f97316',
  unresolved: '#ba1a1a',
  connected: '#006c4b',
})

export function getTopologySelectionRoute(layout, selectedAssetId) {
  if (!layout || !selectedAssetId || layout.mode === 'area-overview') {
    return { nodeIds: [], edgeIds: [] }
  }
  const nodeById = new Map((layout.nodes ?? []).map((node) => [node.id, node]))
  const edgeByNodePair = new Map()
  ;(layout.edges ?? []).forEach((edge) => {
    edgeByNodePair.set(nodePairKey(edge.sourceId, edge.targetId), edge.id)
  })
  const nodeIds = []
  const edgeIds = []
  const visited = new Set()
  let current = nodeById.get(selectedAssetId)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    nodeIds.push(current.id)
    const parentId = current.layoutParentId ?? current.parentId
    if (!parentId) break
    const edgeId = edgeByNodePair.get(nodePairKey(current.id, parentId))
    if (!edgeId) break
    edgeIds.push(edgeId)
    current = nodeById.get(parentId)
  }
  return { nodeIds: nodeIds.reverse(), edgeIds: edgeIds.reverse() }
}

function nodePairKey(sourceId, targetId) {
  return [sourceId, targetId].sort().join('\u0000')
}

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
  semanticLevel = null,
  renderMode = 'interactive',
  hoveredAssetId = null,
  highlightAssetId = null,
  minimap = false,
} = {}) {
  if (!model || model.status !== 'ready' || !layout || layout.status !== 'ready') return ''
  const nodes = layout.nodes
  const edges = layout.edges
  const bottom = layout.height - layout.options.footerHeight
  const resolvedSemanticLevel = semanticLevel ?? semanticZoomLevelForZoom(zoom)
  const labelVisibility = getTopologyLabelVisibility({
    labelMode,
    zoom,
    minimap,
    semanticLevel: resolvedSemanticLevel,
    renderMode,
  })
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
  const selectionRoute = getTopologySelectionRoute(layout, selectedAssetId)
  const selectionPathIds = new Set(selectionRoute.edgeIds)
  const selectionPathNodes = new Set([...directNodes, ...selectionRoute.nodeIds])
  const selectedEdge = selectedEdgeId ? model.edgeById.get(selectedEdgeId) : null
  const selectedEdgeNodes = selectedEdge
    ? new Set([selectedEdge.sourceId, selectedEdge.targetId])
    : new Set()
  const selectionActive = Boolean(selectedAssetId || selectedEdgeId)
  return `
    <svg class="topology-diagram-svg${minimap ? ' is-minimap' : ''}"
      data-semantic-level="${escapeAttribute(resolvedSemanticLevel)}"
      data-render-mode="${escapeAttribute(renderMode)}"
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
          .topology-bg{fill:${renderMode === 'export' ? THEME.background : 'transparent'}}
          .topology-heading{font:700 20px Inter,ui-sans-serif,system-ui;fill:${THEME.text}}
          .topology-meta{font:500 11px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary}}
          .topology-summary{font:700 11px Inter,ui-sans-serif,system-ui;fill:${THEME.text}}
          .topology-section{fill:none;stroke:none}
          .topology-region-boundary{fill:rgba(243,244,245,.16);stroke:rgba(199,197,206,.58);stroke-width:1;pointer-events:none;vector-effect:non-scaling-stroke}
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
          .topology-area-overview-badge{font:800 9px Inter,ui-sans-serif,system-ui;fill:#8a5d17}
          .topology-area-overview-badge-bg{fill:#fff4d9;stroke:#efd8a8;stroke-width:1}
          .topology-island-boundary{fill:rgba(243,244,245,.18);stroke:rgba(199,197,206,.62);stroke-width:1;pointer-events:none;vector-effect:non-scaling-stroke}
          .topology-island-label{font:750 10px Inter,ui-sans-serif,system-ui;fill:#77767e;letter-spacing:.06em;pointer-events:none}
          .topology-island-root{font:700 10px Inter,ui-sans-serif,system-ui;fill:#03071d;pointer-events:none}
          .topology-island-meta{font:550 9px Inter,ui-sans-serif,system-ui;fill:#77767e;pointer-events:none}
          .topology-diagram-svg[data-semantic-level="overview"] .topology-island-boundary{fill:rgba(243,244,245,.24);stroke:rgba(199,197,206,.72);stroke-width:1}
          .topology-diagram-svg[data-semantic-level="overview"] .topology-island-label{font-size:16px;letter-spacing:.1em}
          .topology-diagram-svg[data-semantic-level="overview"] .topology-island-root{font-size:14px}
          .topology-diagram-svg[data-semantic-level="overview"] .topology-island-meta{font-size:12px}
          .topology-diagram-svg[data-semantic-level="overview"] .topology-node.core .topology-node-name{display:none}
          .topology-lane{fill:none;stroke:none}
          .topology-lane-kicker{font:800 8px Inter,ui-sans-serif,system-ui;fill:#718492;letter-spacing:.09em}
          .topology-lane-meta{font:600 8px Inter,ui-sans-serif,system-ui;fill:#91a0ab}
          .topology-lane-header-line{stroke:#e2e9ee;stroke-width:1}
          .topology-lane-title{font:750 9px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary};letter-spacing:.08em}
          .topology-lane-root{font:600 9px Inter,ui-sans-serif,system-ui;fill:${THEME.muted}}
          .topology-band-title{font:800 8px Inter,ui-sans-serif,system-ui;fill:${THEME.muted};letter-spacing:.09em}
          .topology-band-divider{stroke:${THEME.laneBorder};stroke-width:1;stroke-dasharray:3 5}
          .topology-mounting-group{cursor:pointer;outline:none}
          .topology-mounting-group.excluded,.topology-mounting-group.needs-mounting,.topology-mounting-group.unassigned{cursor:default}
          .topology-mounting-bubble{fill-opacity:.42;stroke-width:1.3;vector-effect:non-scaling-stroke;pointer-events:all}
          .topology-mounting-group.excluded .topology-mounting-bubble{fill:#fff4e8;stroke:#f97316}
          .topology-mounting-group.needs-mounting .topology-mounting-bubble{fill:#fff9db;stroke:#d89b00;stroke-dasharray:5 3}
          .topology-mounting-group.unassigned .topology-mounting-bubble{fill:#f8fafc;stroke:#94a3b8}
          .topology-mounting-group.empty .topology-mounting-bubble{fill:#f8fafc;stroke:#94a3b8;stroke-dasharray:4 3}
          .topology-mounting-group:hover .topology-mounting-bubble,.topology-mounting-group.selected .topology-mounting-bubble{stroke:${THEME.selected};stroke-width:2.2}
          .topology-mounting-header-line{stroke:rgba(113,132,146,.28);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
          .topology-mounting-label-bg{fill:rgba(255,255,255,.88);stroke:rgba(113,132,146,.28);stroke-width:1}
          .topology-mounting-label{font:800 9px Inter,ui-sans-serif,system-ui;fill:#4e6879;letter-spacing:.03em;pointer-events:none}
          .topology-mounting-meta{font:600 8px Inter,ui-sans-serif,system-ui;fill:#718492;pointer-events:none}
          .topology-mounting-group.excluded .topology-mounting-label{fill:#c44f0a}
          .topology-mounting-group.excluded .topology-mounting-meta{fill:#a44810}
          .topology-mounting-group.needs-mounting .topology-mounting-label{fill:#9a6700}
          .topology-mounting-group.needs-mounting .topology-mounting-meta{fill:#805600}
          .topology-mounting-group.unassigned .topology-mounting-label{fill:#526474}
          .topology-mounting-group.unassigned .topology-mounting-meta{fill:#718492}
          .topology-mounting-group.empty .topology-mounting-label{fill:#526474}
          .topology-mounting-group.empty .topology-mounting-meta{fill:#718492}
          .topology-cross-area-gateway{pointer-events:none}
          .topology-cross-area-line{stroke:#7294a7;stroke-width:1.4;stroke-dasharray:4 4}
          .topology-cross-area-marker{fill:#fff;stroke:#7294a7;stroke-width:1.3}
          .topology-cross-area-label{font:800 8px Inter,ui-sans-serif,system-ui;fill:#557486}
          .topology-presentation-backbone-underlay{fill:none;stroke:#fff;stroke-width:7;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
          .topology-presentation-backbone-line{fill:none;stroke:${THEME.edge};stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round;opacity:.9;vector-effect:non-scaling-stroke;pointer-events:none}
          .topology-presentation-backbone-junction{fill:#fff;stroke:${THEME.edge};stroke-width:1.5;vector-effect:non-scaling-stroke;pointer-events:none}
          .topology-isolated{fill:#fbfcfd;stroke:${THEME.sectionBorder};stroke-width:1.2}
          .topology-isolated-title{font:800 11px Inter,ui-sans-serif,system-ui;fill:${THEME.text}}
          .topology-unresolved-panel{fill:#fff7f7;stroke:#e9babe;stroke-width:1.2}
          .topology-unresolved-label{font:750 10px Inter,ui-sans-serif,system-ui;fill:${THEME.unresolved}}
          .topology-edge-underlay{fill:none;stroke:${THEME.edgeUnderlay};stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
          .topology-edge{fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
          .topology-edge.trace{stroke:${THEME.selected};stroke-width:5}
          .topology-edge.selected,.topology-edge.selected-path{stroke:${THEME.selected};stroke-width:4}
          .topology-edge.dimmed{stroke:${THEME.dimmed};opacity:.32}
          .topology-edge.direct{stroke-width:4}
          .topology-edge.suggested{stroke:${THEME.suggested};stroke-dasharray:9 7;stroke-width:2.8}
          .topology-edge.candidate{stroke:${THEME.candidate};stroke-dasharray:9 7;stroke-width:2.8}
          .topology-edge.candidate.dimmed{opacity:.22}
          .topology-node{cursor:pointer;outline:none}
          .topology-node-card{fill:#fff;stroke:#d7e0e8;stroke-width:1.2}
          .topology-node-accent{opacity:.92}
          .topology-node:hover .topology-node-card,.topology-node:focus .topology-node-card{fill:#fff;stroke:${THEME.selected};stroke-width:2}
          .topology-node.core .topology-node-card{fill:#fff;stroke:#c7c5ce;stroke-width:1.6}
          .topology-node.core .topology-device-icon{fill:#fff;stroke:#03071d;stroke-width:2.4}
          .topology-node.core .topology-device-glyph{fill:#fff}
          .topology-node.selected .topology-device-icon,.topology-node:focus .topology-device-icon{stroke:${THEME.selected};stroke-width:3.4}
          .topology-node.mounting-excluded:not(.selected) .topology-device-icon{stroke:#f97316;stroke-width:2.4}
          .topology-node.mounting-needs:not(.selected) .topology-device-icon{stroke:#d89b00;stroke-width:2.4}
          .topology-node.selected-path .topology-device-icon{stroke:${THEME.selected};stroke-width:2.6}
          .topology-node.selected .topology-node-card{fill:#eef7fc;stroke:${THEME.selected};stroke-width:2.4}
          .topology-node.direct .topology-device-icon{stroke:${THEME.selected};stroke-width:2.5}
          .topology-node.direct .topology-node-card{stroke:${THEME.selected};stroke-width:1.8}
          .topology-node.dimmed{opacity:.28}
          .topology-node.match .topology-device-icon{stroke:#13906d;stroke-width:2.5}
          .topology-node.pulse .topology-node-halo{opacity:.9;stroke:${THEME.selected};stroke-width:3;animation:topology-node-pulse 1.5s ease-out}
          @keyframes topology-node-pulse{0%{r:24;opacity:.85}100%{r:46;opacity:0}}
          .topology-node-hitbox{fill:transparent;stroke:none}
          .topology-node.disconnected .topology-node-card{fill:#fafbfc;stroke:#aeb9c3;stroke-dasharray:4 3}
          .topology-node.suggested-only .topology-node-card{fill:#fffaf0;stroke:${THEME.candidate};stroke-dasharray:5 3}
          .topology-node-halo{fill:none;stroke:${THEME.selected};stroke-width:2;opacity:0}
          .topology-node.selected .topology-node-halo,.topology-node:focus .topology-node-halo{opacity:.32}
          .topology-node-selection-glow{fill:rgba(91,126,255,.08);stroke:${THEME.selected};stroke-width:2;opacity:0;vector-effect:non-scaling-stroke}
          .topology-node.selected .topology-node-selection-glow,.topology-node:focus .topology-node-selection-glow{opacity:1}
          .topology-node.pulse .topology-node-selection-glow{animation:topology-selection-pulse 1.4s ease-out}
          @keyframes topology-selection-pulse{0%{opacity:1;stroke-width:4}100%{opacity:.35;stroke-width:2}}
          .topology-node-status-dot{stroke:#fff;stroke-width:2;vector-effect:non-scaling-stroke}
          .topology-node-status-dot.online{fill:#006c4b}
          .topology-node-status-dot.offline{fill:#ba1a1a}
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
           .topology-node-card{fill:none;stroke:none}
           .topology-node:hover .topology-node-card,.topology-node:focus .topology-node-card,.topology-node.selected .topology-node-card,.topology-node.core .topology-node-card,.topology-node.disconnected .topology-node-card,.topology-node.suggested-only .topology-node-card{fill:none;stroke:none;stroke-width:0}
           .topology-node-hitbox{fill:transparent;stroke:none;pointer-events:all}
           .topology-node-accent{display:none}
           .topology-device-icon{fill:#fff;stroke-width:1.8;vector-effect:non-scaling-stroke}
           .topology-device-glyph{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
           .topology-device-glyph-fill,.topology-device-led{fill:currentColor;stroke:none}
           .topology-rack-glyph .topology-device-glyph,.topology-distribution-glyph .topology-device-glyph,.topology-switch-glyph .topology-device-glyph{stroke:${THEME.secondary}}
           .topology-endpoint-glyph .topology-device-icon{fill:${THEME.surface};stroke-width:1.8}
           .topology-node-name{font:700 10px Inter,ui-sans-serif,system-ui;fill:${THEME.text};text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
           .topology-node-type{font:500 8px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary};text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:3px}
           .topology-node[data-label-detail="true"] .topology-node-name,.topology-node[data-label-detail="true"] .topology-node-type{opacity:0}
           .topology-node[data-label-detail="true"]:hover .topology-node-name,.topology-node[data-label-detail="true"]:focus .topology-node-name,.topology-node[data-label-detail="true"].selected .topology-node-name,.topology-node[data-label-detail="true"].hovered .topology-node-name,.topology-node[data-label-detail="true"]:hover .topology-node-type,.topology-node[data-label-detail="true"]:focus .topology-node-type,.topology-node[data-label-detail="true"].selected .topology-node-type,.topology-node[data-label-detail="true"].hovered .topology-node-type{opacity:1}
           .topology-node.selected .topology-device-icon,.topology-node:focus .topology-device-icon{stroke:${THEME.selected};stroke-width:2.8}
           .topology-node.selected-path .topology-device-icon{stroke:${THEME.selected};stroke-width:2.5}
           .topology-node.selected .topology-device-glyph,.topology-node.selected .topology-device-glyph-fill,.topology-node.selected .topology-device-led,.topology-node.selected-path .topology-device-glyph,.topology-node.selected-path .topology-device-glyph-fill,.topology-node.selected-path .topology-device-led{color:${THEME.selected};stroke:${THEME.selected};fill:${THEME.selected}}
           .topology-node.disconnected .topology-device-icon{fill:#ffdad6;stroke:#ba1a1a}
           .topology-node.disconnected .topology-device-glyph{color:#ba1a1a;stroke:#ba1a1a}
           .topology-node.dimmed{opacity:.26}
           .topology-edge-underlay{stroke:${THEME.edgeUnderlay};stroke-width:5;stroke-linecap:round;stroke-linejoin:round}
           .topology-edge{stroke:${THEME.edge};stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
           .topology-edge.edge-role-backbone{stroke-width:3.4}
           .topology-edge.edge-role-access{stroke-width:1.7;opacity:.76}
          .topology-edge.edge-role-peer{stroke-width:2;opacity:.82}
          .topology-backbone-gap-underlay{fill:none;stroke:#fff;stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
          .topology-backbone-gap-line{fill:none;stroke:${THEME.candidate};stroke-width:2.8;stroke-dasharray:10 8;stroke-linecap:round;stroke-linejoin:round;opacity:.9}
          .topology-backbone-gap-target{fill:#fff8e9;stroke:${THEME.candidate};stroke-width:2;stroke-dasharray:3 2}
          .topology-backbone-gap-label{font:800 8px Inter,ui-sans-serif,system-ui;fill:#9a691b;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
          .topology-edge.trace,.topology-edge.selected,.topology-edge.selected-path{stroke:${THEME.selected};stroke-width:4.6;opacity:1}
           .topology-edge.dimmed{stroke:${THEME.dimmed};opacity:.24}
           .topology-mounting-member-halo{fill:none;stroke-width:2;stroke-dasharray:2 4;opacity:.55;vector-effect:non-scaling-stroke}
           .topology-disconnected-tray-line{stroke:${THEME.sectionBorder};stroke-width:1;stroke-dasharray:4 5}
           .topology-disconnected-tray .topology-isolated-title{font:700 9px Inter,ui-sans-serif,system-ui;fill:${THEME.secondary}}
           .topology-area-overview-card rect{fill:#fff;stroke:${THEME.sectionBorder};stroke-width:1}
           .topology-area-overview-card:hover rect,.topology-area-overview-card:focus rect{stroke:${THEME.selected};stroke-width:1.8}
         </style>
      </defs>
      <rect class="topology-bg" width="${layout.width}" height="${layout.height}"/>
      ${layout.mode === 'area-overview'
        ? renderAreaOverview(layout)
        : `<g class="topology-sections" aria-label="Area fasilitas">
          ${layout.sections.map((section) => renderSection(section)).join('')}
        </g>`}
      ${showMountingPhysical && layout.mode !== 'area-overview'
        ? renderPresentationBackbones(layout, { minimap })
        : ''}
      ${showMountingPhysical && layout.mode !== 'area-overview'
        ? renderMountingGroups(model, layout, {
          selectedAssetId,
          selectedMountingGroupId,
          minimap,
        })
        : ''}
      ${layout.mode === 'area-overview' ? '' : renderBackboneGaps(layout, { minimap })}
      <g class="topology-edges" aria-label="Relasi terkonfirmasi">
        ${edges.map((edge) => renderEdge({
          ...model.edgeById.get(edge.id),
          ...edge,
          dimmed: edge.dimmed || (selectionActive && !edge.trace && (
            selectedEdgeId
              ? edge.id !== selectedEdgeId
              : !directIds.has(edge.id) && !selectionPathIds.has(edge.id)
          )),
        }, {
          selectedEdgeId,
          directIds,
          selectionPathIds,
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
              ? !selectionPathNodes.has(node.id) && node.id !== selectedAssetId
              : !selectedEdgeNodes.has(node.id)
          )),
        }, {
          selectedAssetId,
          directNodes,
          selectionPathNodes,
          labelVisibility,
          semanticLevel: resolvedSemanticLevel,
          hoveredAssetId,
          minimap,
          highlightAssetId,
        })).join('')}
      </g>
      ${layout.mode === 'area-overview' ? '' : renderCrossAreaMarkers(layout)}
      ${renderMode === 'export' && !minimap
        ? renderLegend(bottom, layout.width, showMountingPhysical)
        : ''}
    </svg>
  `
}

export function getTopologyLabelVisibility({
  labelMode = 'auto',
  zoom = 1,
  minimap = false,
  semanticLevel = null,
  renderMode = 'interactive',
} = {}) {
  if (minimap || labelMode === 'off') return 'off'
  if (renderMode === 'export' || labelMode === 'all') return 'all'
  const level = semanticLevel ?? semanticZoomLevelForZoom(zoom)
  if (level === 'overview') return 'core-peer'
  if (level === 'detail') return 'detail'
  return 'all'
}

export function getTopologySemanticLevel({ zoom = 1, renderMode = 'interactive' } = {}) {
  return renderMode === 'export' ? 'focus' : semanticZoomLevelForZoom(zoom)
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
  const regionHeight = section.isolated
    ? Math.max(80, section.isolated.y - 10)
    : section.height
  return `
    <g class="topology-section-group" data-area-key="${escapeAttribute(section.key)}">
      <rect class="topology-region-boundary" x="${section.x}" y="${section.y}" width="${section.width}" height="${regionHeight}" rx="12"/>
      <text class="topology-section-title" x="${section.x + 14}" y="${section.y + 22}">
        ${escapeXml(section.name)}
      </text>
      <text class="topology-section-count" x="${section.x + section.width - 14}" y="${section.y + 22}" text-anchor="end">
        ${section.nodeCount} perangkat${section.isolatedCount ? ` · ${section.isolatedCount} belum terhubung` : ''}${section.crossAreaCount ? ` · ${section.crossAreaCount} lintas area` : ''}
      </text>
      ${section.lanes.map((lane) => renderLane(lane, section)).join('')}
      ${section.isolated ? renderIsolated(section.isolated, section) : ''}
      ${section.unresolved ? renderUnresolvedPanel(section.unresolved, section) : ''}
    </g>
  `
}

function renderAreaOverview(layout) {
  return `<g class="topology-area-overview" aria-label="Ringkasan area fasilitas">
    ${(layout.overviewAreas ?? []).map((area) => `
      <g class="topology-area-overview-card" data-area-overview="${escapeAttribute(area.key)}"
        tabindex="0" role="button" aria-label="Buka detail area ${escapeAttribute(area.name)}">
        <rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" rx="14"/>
        <text class="topology-area-overview-name" x="${area.x + 18}" y="${area.y + 28}">${escapeXml(
          shorten(area.name, 34),
        )}</text>
        <text class="topology-area-overview-count" x="${area.x + 18}" y="${area.y + 53}">
          ${area.nodeCount} aset · ${area.poleCount} tiang total
        </text>
        <text class="topology-area-overview-metric" x="${area.x + 18}" y="${area.y + 78}">
          ${area.occupiedPoleCount} terisi · ${area.emptyPoleCount} kosong
        </text>
        <text class="topology-area-overview-metric" x="${area.x + 18}" y="${area.y + 100}">
          ${area.unmountedCount} perlu mounting · ${area.disconnectedCount} tanpa relasi
        </text>
        ${(area.unmountedCount || area.disconnectedCount) ? `<g class="topology-area-overview-badge">
          <rect class="topology-area-overview-badge-bg" x="${area.x + 18}" y="${area.y + 112}" width="${Math.max(110, String(area.unmountedCount).length * 6 + 94)}" height="18" rx="9"/>
          <text class="topology-area-overview-badge" x="${area.x + 27}" y="${area.y + 124}">${area.unmountedCount} belum dimount</text>
        </g>` : ''}
        <text class="topology-area-overview-action" x="${area.x + area.width - 18}" y="${area.y + area.height - 18}" text-anchor="end">
          Buka detail →
        </text>
      </g>
    `).join('')}
  </g>`
}

function renderMountingGroups(model, layout, {
  selectedAssetId = null,
  selectedMountingGroupId = null,
  minimap = false,
} = {}) {
  const boxes = layout.mountingBoxes ?? []
  return boxes.map((box, index) => {
    const hostName = shorten(box.label || box.hostName || box.hostId, 26)
    const palette = box.kind === 'excluded'
      ? { fill: '#fff4e8', stroke: '#f97316' }
      : box.kind === 'needs-mounting'
        ? { fill: '#fff9db', stroke: '#d89b00' }
        : box.kind === 'unassigned'
          ? { fill: '#f8fafc', stroke: '#94a3b8' }
      : box.kind === 'empty'
        ? { fill: '#f8fafc', stroke: '#94a3b8' }
        : mountingBubblePalette(box.hostId || box.id, index)
    const label = box.kind === 'excluded'
      ? 'Area non-tiang/indoor'
      : box.kind === 'needs-mounting'
        ? 'Perlu mounting'
      : box.kind === 'unassigned'
        ? 'Aset lainnya'
      : hostName
    const active = selectedMountingGroupId === box.id || box.nodeIds.includes(selectedAssetId)
    const classes = [
      'topology-mounting-group',
      box.kind === 'excluded'
        ? 'excluded'
        : box.kind === 'needs-mounting'
          ? 'needs-mounting'
          : box.kind === 'unassigned' ? 'unassigned'
          : box.kind === 'empty' ? 'empty' : 'confirmed',
      active ? 'selected' : '',
    ].filter(Boolean).join(' ')
    const interaction = !['excluded', 'needs-mounting'].includes(box.kind)
      ? ` data-mounting-group-id="${escapeAttribute(box.id)}" tabindex="0" role="button"`
      : ' role="group"'
    const inheritedCount = box.presentationInheritedNodeIds?.length ?? 0
    const mountedCount = Math.max(0, box.nodeIds.length - inheritedCount)
    const meta = box.kind === 'excluded'
      ? `${box.nodeIds.length} aset · indoor/standalone`
      : box.kind === 'needs-mounting'
        ? `${box.nodeIds.length} aset · perlu ditetapkan`
      : box.kind === 'unassigned'
        ? `${box.nodeIds.length} aset · tanpa penempatan tiang`
      : box.kind === 'empty'
        ? '0 aset · belum ada mounting'
      : inheritedCount
        ? `${mountedCount} terpasang · ${inheritedCount} non-tiang`
        : `${box.nodeIds.length} aset terpasang`
    return `<g class="${classes}"${interaction}
      aria-label="${escapeAttribute(`${label} · ${meta}`)}">
      <rect class="topology-mounting-bubble" x="${box.x}" y="${box.y}"
        width="${box.width}" height="${box.height}" rx="12"
        fill="${palette.fill}" stroke="${palette.stroke}"/>
      <line class="topology-mounting-header-line" x1="${box.x}" y1="${box.y + 30}"
        x2="${box.x + box.width}" y2="${box.y + 30}"/>
      <text class="topology-mounting-label" x="${box.x + 12}" y="${box.y + 19}">${escapeXml(label)}</text>
      <text class="topology-mounting-meta" x="${box.x + box.width - 12}" y="${box.y + 19}"
        text-anchor="end">${escapeXml(meta)}</text>
      ${box.mountingConflict && !minimap ? `<text class="topology-mounting-meta" x="${box.x + 12}"
        y="${box.y + box.height - 8}">Periksa konflik mounting</text>` : ''}
      <title>${escapeXml(`${label} · ${meta}`)}</title>
    </g>`
  }).join('')
}

function renderPresentationBackbones(layout, { minimap = false } = {}) {
  return (layout.sections ?? []).flatMap((section) => (
    (section.lanes ?? [])
      .filter((lane) => lane.presentation === 'pole-backbone')
      .map((lane) => renderPresentationBackbone(lane, section, { minimap }))
  )).join('')
}

function renderPresentationBackbone(lane, section, { minimap = false } = {}) {
  const boxes = lane.mountingBoxes ?? []
  const boxById = new Map(boxes.map((box) => [box.id, box]))
  const rootBoxes = boxes.filter((box) => !boxById.has(box.layoutParentBoxId))
  const core = (lane.nodes ?? [])
    .filter((node) => node.diagramClass === 'rack-root' || node.isCore)
    .sort((left, right) => left.diagram.topY - right.diagram.topY)[0]
  if (!core || !rootBoxes.length) return ''

  const firstBoxTop = Math.min(...rootBoxes.map((box) => box.y))
  const coreBottom = core.diagram.bottomY
  const railY = firstBoxTop - 18
  const laneLeft = section.x + (lane.x ?? 0)
  const laneRight = laneLeft + lane.width
  const centers = rootBoxes.map((box) => box.x + box.width / 2)
  const railStart = Number.isFinite(laneLeft) ? laneLeft + 2 : Math.min(...centers)
  const railEnd = Number.isFinite(laneRight) ? laneRight - 2 : Math.max(...centers)
  const segments = [
    [
      { x: core.diagram.centerX, y: coreBottom },
      { x: core.diagram.centerX, y: railY },
    ],
    [
      { x: Math.min(railStart, railEnd), y: railY },
      { x: Math.max(railStart, railEnd), y: railY },
    ],
    ...rootBoxes.flatMap((box) => box.nodes
      .filter((node) => (node.layoutParentId ?? node.parentId) === core.id)
      .map((node) => ([
        { x: node.diagram.centerX, y: railY },
        { x: node.diagram.centerX, y: node.diagram.topY },
      ]))),
  ]
  const path = segments.map((segment) => orthogonalPath(segment)).join(' ')
  const label = `Server parent visual · ${rootBoxes.length} kelompok asset`
  return `<g class="topology-presentation-backbone" data-parent-id="${escapeAttribute(core.id)}"
    aria-label="${escapeAttribute(label)}">
    <path class="topology-presentation-backbone-underlay" d="${path}"/>
    <path class="topology-presentation-backbone-line" d="${path}">
      ${minimap ? '' : `<title>${escapeXml(label)} · jalur penempatan visual</title>`}
    </path>
    ${rootBoxes.map((box) => `<circle class="topology-presentation-backbone-junction"
      cx="${box.x + box.width / 2}" cy="${railY}" r="3"/>`).join('')}
  </g>`
}

function renderLane(lane, section) {
  const x = section.x + lane.x
  const y = section.y + lane.y
  if (lane.presentation === 'pole-backbone') {
    const label = `Backbone tiang · ${lane.componentIds?.length ?? 0} komponen · ${lane.nodes.length} perangkat`
    return `<g class="topology-lane-group topology-lane-pole-backbone" data-component-id="${escapeAttribute(lane.componentId)}"
      aria-label="${escapeAttribute(label)}"><title>${escapeXml(label)}</title></g>`
  }
  if (lane.presentation === 'hub-spoke') {
    const islandLabel = `Network island ${String(lane.islandIndex ?? '').padStart(2, '0')}`.trim()
    return `<g class="topology-lane-group topology-lane-hub-spoke" data-component-id="${escapeAttribute(lane.componentId)}"
      aria-label="${escapeAttribute(`${islandLabel} · ${lane.nodes.length} perangkat · ${lane.edgeCount} koneksi`)}">
      <title>${escapeXml(`${islandLabel} · ${lane.nodes.length} perangkat · ${lane.edgeCount} koneksi`)}</title>
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
    <g class="topology-disconnected-tray topology-isolated-group">
      <line class="topology-disconnected-tray-line" x1="${x}" y1="${y + 5}" x2="${x + spec.width}" y2="${y + 5}"/>
      <text class="topology-isolated-title" x="${x + 2}" y="${y + 24}">${title}</text>
      <text class="topology-section-count" x="${x + spec.width - 2}" y="${y + 24}" text-anchor="end">
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

function renderEdge(edge, { selectedEdgeId, directIds, selectionPathIds, minimap }) {
  const path = orthogonalPath(edge.routePoints ?? edge.linePoints)
  const family = normalizeFamilyClass(edge.networkFamily)
  const selected = edge.id === selectedEdgeId
  const direct = directIds.has(edge.id)
  const selectedPath = selectionPathIds.has(edge.id)
  const classes = [
    'topology-edge',
    `family-${family}`,
    edge.trace ? 'trace' : '',
    selected ? 'selected' : '',
    selectedPath ? 'selected-path' : '',
    direct ? 'direct' : '',
    edge.edgeVisualRole ? `edge-role-${edge.edgeVisualRole}` : '',
    edge.dimmed ? 'dimmed' : '',
  ].filter(Boolean).join(' ')
  const color = edge.trace || selected || selectedPath
    ? THEME.selected
    : edge.dimmed ? THEME.dimmed : THEME.edge
  const marker = edge.trace || selected || selectedPath
    ? 'topology-arrow-selected'
    : 'topology-arrow'
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
  selectionPathNodes = new Set(),
  labelVisibility,
  semanticLevel = 'overview',
  hoveredAssetId = null,
  minimap,
  highlightAssetId = null,
}) {
  const { x, y, width, height } = node.diagram
  const selected = node.id === selectedAssetId
  const direct = directNodes.has(node.id) && !selected
  const selectedPath = selectionPathNodes.has(node.id) && !selected
  const classes = [
    'topology-node',
    node.dimmed ? 'dimmed' : '',
    node.isCore || ['root', 'core'].includes(node.topologyRole) ? 'core' : '',
    selected ? 'selected' : '',
    selectedPath ? 'selected-path' : '',
    node.id === hoveredAssetId ? 'hovered' : '',
    node.id === highlightAssetId ? 'pulse' : '',
    direct ? 'direct' : '',
    node.matched ? 'match' : '',
    node.connectivityStatus === 'disconnected' ? 'disconnected' : '',
    node.connectivityStatus === 'suggested-only' ? 'suggested-only' : '',
    node.mountingRelationStatus === 'excluded' ? 'mounting-excluded' : '',
    ['needs-mounting', 'unmounted'].includes(node.mountingRelationStatus) ? 'mounting-needs' : '',
  ].filter(Boolean).join(' ')
  const iconX = x + width / 2
  const iconY = y + height / 2
  const visualBox = topologyNodeVisualBox(node, iconX, iconY)
  const labelY = visualBox.y + visualBox.height + 15
  const typeY = visualBox.y + visualBox.height + 27
  const warning = node.connectivityStatus === 'disconnected'
    || node.connectivityStatus === 'suggested-only'
  const isCoreOrJunction = ['rack-root', 'junction-peer', 'junction-extended']
    .includes(node.diagramClass)
  const color = node.isCore
    ? THEME.text
    : isCoreOrJunction ? THEME.text : THEME.secondary
  const showLabels = labelVisibility === 'all'
    || labelVisibility === 'detail'
    || (labelVisibility === 'core-peer' && isCoreOrJunction)
  const endpointLabel = labelVisibility === 'all'
    || (labelVisibility === 'detail' && !isCoreOrJunction)
  const showType = labelVisibility === 'all' && node.presentation !== 'hub-spoke'
  const detailLabel = labelVisibility === 'detail' && !isCoreOrJunction
  const labelDetailAttribute = detailLabel
    ? ' data-label-detail="true"'
    : ''
  const focused = selected || node.id === hoveredAssetId
  const labelText = shorten(node.name || node.id, node.presentation === 'hub-spoke' ? 24 : 32)
  return `
    <g class="${classes}" data-node-id="${escapeAttribute(node.id)}"${detailLabel ? ' data-label-detail="true"' : ''} tabindex="0" role="button"
      aria-label="Pilih aset ${escapeAttribute(node.id)}">
      <title>${escapeXml(describeNode(node))}</title>
      <rect class="topology-node-card topology-node-hitbox" x="${x}" y="${y}" width="${Math.max(36, width)}" height="${Math.max(36, height)}"/>
      <rect class="topology-node-selection-glow" x="${visualBox.x - 6}" y="${visualBox.y - 6}"
        width="${visualBox.width + 12}" height="${visualBox.height + 12}" rx="${visualBox.radius + 4}"/>
      ${renderNodeGlyph(node, iconX, iconY, color)}
      <circle class="topology-node-status-dot${warning ? ' offline' : ' online'}"
        cx="${visualBox.x + visualBox.width - 1}" cy="${visualBox.y + 1}" r="${node.isEndpoint ? 3 : 4}"/>
      ${showLabels && (isCoreOrJunction || endpointLabel) ? `
        <text class="topology-node-name"${labelDetailAttribute} x="${iconX}" y="${labelY}">${escapeXml(labelText)}</text>
        ${showType ? `<text class="topology-node-type"${labelDetailAttribute} x="${iconX}" y="${typeY}">${escapeXml(shorten(node.type || 'Aset', 27))}</text>` : ''}
      ` : ''}
    </g>
  `
}

function topologyNodeVisualBox(node, centerX, centerY) {
  const role = normalizeTopologyRole(node.topologyRole)
  if (node.iconType === 'server-rack-core' || ['root', 'core', 'server', 'nvr', 'router'].includes(role)) {
    return { x: centerX - 30, y: centerY - 26, width: 60, height: 52, radius: 6 }
  }
  if (node.iconType === 'junction-box' || role === 'junction' || role === 'otb'
    || node.iconType === 'switch-otb' || role === 'switch' || role === 'distribution') {
    return { x: centerX - 22, y: centerY - 19, width: 44, height: 38, radius: 6 }
  }
  return { x: centerX - 12, y: centerY - 12, width: 24, height: 24, radius: 4 }
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

function renderBackboneGaps(layout, { minimap = false } = {}) {
  const layoutNodeById = new Map((layout.nodes ?? []).map((node) => [node.id, node]))
  return (layout.backboneGaps ?? []).map((gap) => {
    const target = layoutNodeById.get(gap.targetId)
    if (!target || !(gap.routePoints ?? []).length) return ''
    const path = orthogonalPath(gap.routePoints)
    return `<g class="topology-backbone-gap" aria-label="Network island ${escapeAttribute(
      gap.targetId,
    )} belum memiliki jalur backbone terkonfirmasi">
      <path class="topology-backbone-gap-underlay" d="${path}"/>
      <path class="topology-backbone-gap-line" d="${path}">
        ${minimap ? '' : '<title>Diagnostik island · jalur backbone belum terkonfirmasi</title>'}
      </path>
      <circle class="topology-backbone-gap-target" cx="${target.diagram.centerX}"
        cy="${target.diagram.topY}" r="5"/>
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
  if (node.iconType === 'server-rack-core' || ['root', 'core', 'server', 'nvr', 'router'].includes(role)) {
    return `<g class="topology-rack-glyph" stroke="${escapeAttribute(color)}">
      <rect class="topology-device-icon" x="${x - 30}" y="${y - 26}" width="60" height="52" rx="6"/>
      <rect class="topology-device-glyph" x="${x - 10}" y="${y - 13}" width="20" height="8" rx="1"/>
      <rect class="topology-device-glyph" x="${x - 10}" y="${y + 1}" width="20" height="8" rx="1"/>
      <circle class="topology-device-led" cx="${x + 6}" cy="${y - 9}" r="1.5"/>
      <circle class="topology-device-led" cx="${x + 6}" cy="${y + 5}" r="1.5"/>
    </g>`
  }
  if (node.iconType === 'junction-box' || role === 'junction' || role === 'otb') {
    return `<g class="topology-distribution-glyph" stroke="${escapeAttribute(color)}">
      <rect class="topology-device-icon" x="${x - 22}" y="${y - 19}" width="44" height="38" rx="6"/>
      <circle class="topology-device-glyph-fill" cx="${x}" cy="${y - 7}" r="2.2"/>
      <path class="topology-device-glyph" d="M ${x} ${y - 4} V ${y + 3} M ${x - 9} ${y + 3} H ${x + 9} M ${x - 9} ${y + 3} V ${y + 10} M ${x + 9} ${y + 3} V ${y + 10}"/>
      <circle class="topology-device-glyph-fill" cx="${x - 9}" cy="${y + 11}" r="1.8"/>
      <circle class="topology-device-glyph-fill" cx="${x + 9}" cy="${y + 11}" r="1.8"/>
    </g>`
  }
  if (node.iconType === 'switch-otb' || role === 'switch' || role === 'distribution') {
    return `<g class="topology-switch-glyph" stroke="${escapeAttribute(color)}">
      <rect class="topology-device-icon" x="${x - 22}" y="${y - 19}" width="44" height="38" rx="6"/>
      <path class="topology-device-glyph" d="M ${x - 10} ${y - 5} H ${x + 10} M ${x - 10} ${y + 5} H ${x + 10}"/>
    </g>`
  }
  if (node.iconType === 'pole-mounting') {
    return `<path class="topology-device-icon" d="M ${x} ${y - 17} L ${x + 12} ${y + 13} L ${x - 12} ${y + 13} Z" stroke="${escapeAttribute(color)}"/>`
  }
  if (node.iconType === 'cctv' || node.isEndpoint) {
    return `<g class="topology-endpoint-glyph" stroke="${escapeAttribute(color)}">
      <rect class="topology-device-icon" x="${x - 12}" y="${y - 12}" width="24" height="24" rx="4"/>
      <path class="topology-device-glyph" d="M ${x - 7} ${y - 4} H ${x + 3} Q ${x + 7} ${y - 4} ${x + 7} ${y} Q ${x + 7} ${y + 4} ${x + 3} ${y + 4} H ${x - 7} Z M ${x - 2} ${y + 4} L ${x - 6} ${y + 9}"/>
    </g>`
  }
  return `<rect class="topology-device-icon" x="${x - 12}" y="${y - 12}" width="24" height="24" rx="4" stroke="${escapeAttribute(color)}"/>`
}

function renderLegend(bottom, width, showMountingPhysical) {
  return `
    <line x1="32" y1="${bottom + 8}" x2="${width - 32}" y2="${bottom + 8}" stroke="${THEME.sectionBorder}"/>
    <g class="topology-legend">
      <text class="topology-legend-title" x="32" y="${bottom + 37}">KETERANGAN</text>
      <line x1="112" y1="${bottom + 34}" x2="134" y2="${bottom + 34}" stroke="${THEME.edge}" stroke-width="3.4"/>
      <text class="topology-legend-label" x="142" y="${bottom + 37}">Backbone core/JB</text>
      <line x1="256" y1="${bottom + 34}" x2="278" y2="${bottom + 34}" stroke="${THEME.edge}" stroke-width="1.7"/>
      <text class="topology-legend-label" x="286" y="${bottom + 37}">Akses endpoint</text>
      <line x1="382" y1="${bottom + 34}" x2="404" y2="${bottom + 34}" stroke="${THEME.candidate}" stroke-width="2.5" stroke-dasharray="8 6"/>
      <text class="topology-legend-label" x="412" y="${bottom + 37}">Suggested link</text>
      <circle cx="530" cy="${bottom + 31}" r="7" fill="${THEME.selected}"/>
      <text class="topology-legend-label" x="544" y="${bottom + 34}">Selected / trace</text>
      <circle cx="646" cy="${bottom + 31}" r="7" fill="#fff" stroke="${THEME.unresolved}" stroke-dasharray="4 3"/>
      <text class="topology-legend-label" x="660" y="${bottom + 34}">Disconnected</text>
      ${showMountingPhysical ? `<rect x="765" y="${bottom + 23}" width="18" height="15" rx="3" fill="#dfeff5" stroke="#8fb8c8"/>
      <text class="topology-legend-label" x="790" y="${bottom + 34}">Terikat tiang</text>
      <rect x="866" y="${bottom + 23}" width="18" height="15" rx="3" fill="#fff4e8" stroke="#f97316"/>
      <text class="topology-legend-label" x="891" y="${bottom + 34}">Indoor / standalone</text>
      <rect x="1015" y="${bottom + 23}" width="18" height="15" rx="3" fill="#fff9db" stroke="#d89b00"/>
      <text class="topology-legend-label" x="1040" y="${bottom + 34}">Perlu mounting</text>` : ''}
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
  if (points.length < 3) {
    return points.map((point, index) => `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`).join(' ')
  }
  const commands = [`M ${round(points[0].x)} ${round(points[0].y)}`]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    const previousLength = Math.hypot(current.x - previous.x, current.y - previous.y)
    const nextLength = Math.hypot(next.x - current.x, next.y - current.y)
    const radius = Math.min(7, previousLength / 2, nextLength / 2)
    if (!radius || (previous.x === current.x && current.x === next.x)
      || (previous.y === current.y && current.y === next.y)) {
      commands.push(`L ${round(current.x)} ${round(current.y)}`)
      continue
    }
    const before = {
      x: current.x + (previous.x - current.x) * radius / previousLength,
      y: current.y + (previous.y - current.y) * radius / previousLength,
    }
    const after = {
      x: current.x + (next.x - current.x) * radius / nextLength,
      y: current.y + (next.y - current.y) * radius / nextLength,
    }
    commands.push(`L ${round(before.x)} ${round(before.y)} Q ${round(current.x)} ${round(current.y)} ${round(after.x)} ${round(after.y)}`)
  }
  const last = points.at(-1)
  commands.push(`L ${round(last.x)} ${round(last.y)}`)
  return commands.join(' ')
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
