import {createTopologyWorkspaceScope} from './topology-workspace-scope.js'
import {createTopologyGraphRenderer} from './topology-graph-renderer.js'
import {createSourceIconLoader} from '../domain/source-icon-loader.js'
import {anchoredZoomScrollPosition,computeFitZoom,computeReadableZoom,effectiveViewportFor,zoomSurfaceMetrics} from '../pages/topology/topology-viewport.js'
const DEFAULT_ZOOM=1,MIN_ZOOM=.001,MAX_ZOOM=1.35,CANVAS_HORIZONTAL_PADDING=30,CANVAS_TOP_PADDING=24,CANVAS_BOTTOM_PADDING=30
const numericStyle=(value,fallback=0)=>{const parsed=Number.parseFloat(value);return Number.isFinite(parsed)?parsed:Number(fallback)||0}
const prefersReducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false

// The caller owns all UI. This adapter owns only SVG contents, viewport styles/events and icon requests.
export function createTopologyReadAdapter(container,options={}) {
  const scope=createTopologyWorkspaceScope()
  try{return mountTopologyReadAdapter(container,options,scope)}catch(error){scope.dispose();throw error}
}

function mountTopologyReadAdapter(container,{onSelect,onZoom=()=>{},onLabels=()=>{},onResize=()=>{},onMessage=()=>{},onIcons=()=>{}},scope) {
  const sourceIconLoader=createSourceIconLoader({signal:scope.signal})
  const viewport=container.querySelector('[data-topology-viewport]'),frame=container.querySelector('[data-topology-frame]')
  let model=null,layout=null,mapData=null,activeContext=null,state={zoom:1},pan=null,scopeKey=null,lastFocus=null
  const renderer=createTopologyGraphRenderer({frame,getSnapshot:()=>({model,layout,mapData,activeContext,state}),sourceIconLoader,scope,syncGraphSurface,renderOverviewLabels,onIconsReady:()=>onIcons(new Map(sourceIconLoader.dataByUrl)),isDragging:()=>false,preserveFocus:true})
  function renderGraph(){renderer.render()}
  function updateToolbar(){onZoom(state.zoom)}
  function showToast(message){onMessage(message)}
  function changeZoom(delta) {
    zoomGraphTo(state.zoom + delta)
  }

  function setZoom(value) {
    state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value) || DEFAULT_ZOOM))
  }

  function graphSafeViewport(viewport) {
    const bounds = viewport.getBoundingClientRect()
    const visibleOverlay = (selector) => {
      const element = container.querySelector(selector)
      if (!element || element.hidden || getComputedStyle(element).visibility === 'hidden') return null
      return element.getBoundingClientRect()
    }
    const context = visibleOverlay('.topology-context-card')
    const actions = visibleOverlay('.topology-stitch-toolbar')
    const navigation = visibleOverlay('.topology-canvas-navigation')
    const overviewHint = visibleOverlay('.topology-overview-hint')
    const sidebar = !state.sidebarCollapsed && window.matchMedia?.('(min-width: 961px)').matches
      ? visibleOverlay('.topology-sidebar') : null
    const sidebarLeft = sidebar ? Math.max(0, sidebar.right - bounds.left + 20) : 0
    const overlayTop = Math.max(CANVAS_TOP_PADDING,
      ...[context, actions].filter(Boolean).map((rect) => rect.bottom - bounds.top + 16))
    const overlayBottom = Math.max(CANVAS_BOTTOM_PADDING,
      ...[navigation, overviewHint].filter(Boolean).map((rect) => bounds.bottom - rect.top + 12))
    return effectiveViewportFor({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      paddingLeft: Math.max(CANVAS_HORIZONTAL_PADDING, sidebarLeft),
      paddingRight: CANVAS_HORIZONTAL_PADDING,
      overlayTop,
      overlayBottom,
    })
  }

  function fitGraph() {
    if (!layout?.width || !layout?.height) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    const safe = graphSafeViewport(viewport)
    setZoom(computeFitZoom({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      minZoom: MIN_ZOOM,
      maxZoom: 1.12,
      horizontalPadding: viewport.clientWidth - safe.width,
      verticalPadding: viewport.clientHeight - safe.height,
    }))
    renderGraph()
    updateToolbar()
    scope.frame(() => centerGraph({ smooth: true, wholeContent: true }))
  }

  function focusAssetCard(assetId) {
    const target = layout?.nodes?.find((node) => node.id === assetId)
    if (!target?.diagram) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    const relatedIds = new Set([assetId])
    for (const edgeId of model.nodeById.get(assetId)?.directEdgeIds ?? []) {
      const edge = model.edgeById.get(edgeId)
      if (edge) {
        relatedIds.add(edge.sourceId)
        relatedIds.add(edge.targetId)
      }
    }
    const related = layout.nodes.map((node) => node.diagram)
      .filter((box, index) => box && relatedIds.has(layout.nodes[index].id))
    const left = Math.min(...related.map((box) => box.x)) - 48
    const right = Math.max(...related.map((box) => box.x + box.width)) + 48
    const top = Math.min(...related.map((box) => box.y)) - 64
    const bottom = Math.max(...related.map((box) => box.y + box.height)) + 64
    const safe = graphSafeViewport(viewport)
    const fitZoom = Math.min(.85, safe.width / Math.max(1, right - left),
      safe.height / Math.max(1, bottom - top))
    const nextZoom = Math.max(state.zoom, fitZoom)
    if (nextZoom !== state.zoom) {
      setZoom(nextZoom)
      renderGraph()
      updateToolbar()
    }
    scope.frame(() => {
      const frame = container.querySelector('[data-topology-frame]')
      if (!frame) return
      restoreViewportCenter(viewport, frame, {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
      }, { respectOverlays: true })
    })
  }

  function focusMountingGroup(groupId) {
    const target = layout?.mountingBoxes?.find((box) => box.id === groupId)
    if (!target) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    const center = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    }
    const viewportSafe = graphSafeViewport(viewport)
    const fitZoom = Math.min(.85,
      viewportSafe.width / Math.max(1, target.width + 72),
      viewportSafe.height / Math.max(1, target.height + 112))
    const nextZoom = Math.max(state.zoom, fitZoom)
    if (nextZoom !== state.zoom) {
      setZoom(nextZoom)
      renderGraph()
      updateToolbar()
    }
    scope.frame(() => {
      const frame = container.querySelector('[data-topology-frame]')
      if (!frame) return
      restoreViewportCenter(viewport, frame, center, { respectOverlays: true })
    })
  }

  function focusRelations() {
    const selected = model.nodeById.get(state.selectedAssetId)
    if (!selected) return showToast('Pilih JB atau kamera, lalu klik Fokus relasi.')
    const ids = new Set([selected.id])
    for (const edgeId of selected.directEdgeIds ?? []) {
      const edge = model.edgeById.get(edgeId)
      if (edge) { ids.add(edge.sourceId); ids.add(edge.targetId) }
    }
    const nodes = layout.nodes.filter(node => ids.has(node.id))
    const bounds = nodes.map(node => node.diagram)
    const left = Math.min(...bounds.map(box => box.x)) - 36
    const right = Math.max(...bounds.map(box => box.x + box.width)) + 36
    const top = Math.min(...bounds.map(box => box.y)) - 72
    const bottom = Math.max(...bounds.map(box => box.y + box.height)) + 36
    const viewport = container.querySelector('[data-topology-viewport]')
    const frame = container.querySelector('[data-topology-frame]')
    if (!viewport || !frame) return
    const safe = graphSafeViewport(viewport)
    const fittedZoom = Math.min(1.12, safe.width / (right - left),
      safe.height / (bottom - top))
    setZoom(Math.min(.85, fittedZoom))
    renderGraph()
    updateToolbar()
    const selectedDiagram = nodes.find((node) => node.id === selected.id)?.diagram
    scope.frame(() => restoreViewportCenter(viewport, frame, {
      x: fittedZoom < 0.5 && selectedDiagram ? selectedDiagram.centerX : (left + right) / 2,
      y: fittedZoom < 0.5 && selectedDiagram ? selectedDiagram.centerY : (top + bottom) / 2,
    }, { respectOverlays: true }))
  }

  function resetGraphViewport() {
    if (!layout?.width || !layout?.height) return
    const viewport = container.querySelector('[data-topology-viewport]')
    if (!viewport) return
    const safe = graphSafeViewport(viewport)
    if (layout.options?.layoutStyle === 'facility-schematic') {
      setZoom(Math.max(viewport.clientWidth < 620 ? 0.7 : 0.8, Math.min(DEFAULT_ZOOM,
        safe.width / layout.width)))
      renderGraph()
      updateToolbar()
      scope.frame(() => centerGraph())
      return
    }
    const readableFloor = viewport.clientWidth < 620 ? 0.85 : DEFAULT_ZOOM
    setZoom(computeReadableZoom({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      minZoom: readableFloor,
      maxZoom: DEFAULT_ZOOM,
      horizontalPadding: viewport.clientWidth - safe.width,
      verticalPadding: viewport.clientHeight - safe.height,
    }))
    renderGraph()
    updateToolbar()
    scope.frame(() => centerGraph())
  }

  function zoomGraphTo(value, pointer = null) {
    const viewport = container.querySelector('[data-topology-viewport]')
    const frame = container.querySelector('[data-topology-frame]')
    if (!viewport || !frame || !layout?.width || !layout?.height) return
    const previousZoom = state.zoom
    const rect = viewport.getBoundingClientRect()
    const anchorX = pointer ? pointer.clientX - rect.left : viewport.clientWidth / 2
    const anchorY = pointer ? pointer.clientY - rect.top : viewport.clientHeight / 2
    const oldScrollLeft = viewport.scrollLeft
    const oldScrollTop = viewport.scrollTop
    const oldFrameLeft = numericStyle(frame.style.left, frame.offsetLeft)
    const oldFrameTop = numericStyle(frame.style.top, frame.offsetTop)

    setZoom(value)
    if (state.zoom === previousZoom) return
    renderGraph()

    const position = anchoredZoomScrollPosition({
      scrollLeft: oldScrollLeft,
      scrollTop: oldScrollTop,
      anchorX,
      anchorY,
      oldZoom: previousZoom,
      newZoom: state.zoom,
      oldFrameLeft,
      oldFrameTop,
      newFrameLeft: numericStyle(frame.style.left, frame.offsetLeft),
      newFrameTop: numericStyle(frame.style.top, frame.offsetTop),
    })
    viewport.scrollTo({ ...position, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    updateToolbar()
  }

  function syncGraphSurface({ preserveCenter = false } = {}) {
    const viewport = container.querySelector('[data-topology-viewport]')
    const canvas = container.querySelector('.topology-stitch-canvas')
    const frame = container.querySelector('[data-topology-frame]')
    if (!viewport || !canvas || !frame || !layout?.width || !layout?.height) return
    const snapshot = preserveCenter ? viewportCenterSnapshot(viewport, frame) : null
    const safe = graphSafeViewport(viewport)
    const metrics = zoomSurfaceMetrics({
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      zoom: state.zoom,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      horizontalPadding: viewport.clientWidth < 820 ? 16 : CANVAS_HORIZONTAL_PADDING,
      topPadding: safe.top,
      bottomPadding: viewport.clientHeight - safe.bottom,
    })
    canvas.style.width = `${metrics.width}px`
    canvas.style.height = `${metrics.height}px`
    frame.style.left = `${metrics.frameLeft}px`
    frame.style.top = `${metrics.frameTop}px`
    if (snapshot) restoreViewportCenter(viewport, frame, snapshot)
  }

  function centerGraph({ smooth = false, wholeContent = false } = {}) {
    const viewport = container.querySelector('[data-topology-viewport]')
    const frame = container.querySelector('[data-topology-frame]')
    if (!viewport || !frame) return
    const mountedBoxes = (layout.mountingBoxes ?? [])
      .map(({ x, y, width, height }) => ({ x, y, width, height }))
    const diagramBoxes = mountedBoxes.length ? mountedBoxes
      : (layout.nodes ?? []).map(({ diagram }) => diagram).filter(Boolean)
    const boxes = diagramBoxes.length ? diagramBoxes
      : [{ x: 0, y: 0, width: layout.width, height: layout.height }]
    const content = boxes.length ? {
      left: Math.min(...boxes.map((box) => box.x)),
      right: Math.max(...boxes.map((box) => box.x + box.width)),
      top: Math.min(...boxes.map((box) => box.y)),
      bottom: Math.max(...boxes.map((box) => box.y + box.height)),
    } : { left: 0, right: layout.width, top: 0, bottom: layout.height }
    const frameLeft = numericStyle(frame.style.left, frame.offsetLeft)
    const frameTop = numericStyle(frame.style.top, frame.offsetTop)
    const safe = graphSafeViewport(viewport)
    const root = !wholeContent && layout.nodes?.find((node) => (
      node.diagramClass === 'rack-root' && node.diagram
    ))
    const contentWidth = (content.right - content.left) * state.zoom
    const left = root
      ? frameLeft + root.diagram.centerX * state.zoom - (safe.left + safe.width / 2)
      : contentWidth <= viewport.clientWidth - 64
      ? frameLeft + (content.left + content.right) * state.zoom / 2 - viewport.clientWidth / 2
      : frameLeft + content.left * state.zoom - 32
    const visibleContent = boxes.filter((box) => (
      box.x + box.width > (Math.max(0, left) - frameLeft) / state.zoom
      && box.x < (Math.max(0, left) - frameLeft + viewport.clientWidth) / state.zoom
    ))
    const verticalBoxes = visibleContent.length ? visibleContent : boxes
    const visibleTop = Math.min(...verticalBoxes.map((box) => box.y))
    const firstRow = verticalBoxes.filter((box) => box.y <= visibleTop + 40)
    const visibleBottom = Math.max(...firstRow.map((box) => box.y + box.height))
    const focusY = wholeContent ? (content.top + content.bottom) / 2
      : (visibleTop + visibleBottom) / 2
    const targetY = wholeContent ? safe.top + safe.height / 2
      : safe.top + safe.height * .43
    const top = root
      ? frameTop + root.diagram.centerY * state.zoom - (safe.top + safe.height * .28)
      : frameTop + focusY * state.zoom - targetY
    viewport.scrollTo({
      left: Math.max(0, Math.min(left, viewport.scrollWidth - viewport.clientWidth)),
      top: Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight)),
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
    })
  }

  function viewportCenterSnapshot(viewport, frame) {
    return {
      x: (viewport.scrollLeft + viewport.clientWidth / 2
        - numericStyle(frame.style.left, frame.offsetLeft)) / state.zoom,
      y: (viewport.scrollTop + viewport.clientHeight / 2
        - numericStyle(frame.style.top, frame.offsetTop)) / state.zoom,
    }
  }

  function restoreViewportCenter(viewport, frame, snapshot, { respectOverlays = false } = {}) {
    const safe = respectOverlays ? graphSafeViewport(viewport) : null
    const targetX = safe ? safe.left + safe.width / 2 : viewport.clientWidth / 2
    const targetY = safe ? safe.top + safe.height / 2 : viewport.clientHeight / 2
    viewport.scrollLeft = Math.max(0, numericStyle(frame.style.left, frame.offsetLeft)
      + snapshot.x * state.zoom - targetX)
    viewport.scrollTop = Math.max(0, numericStyle(frame.style.top, frame.offsetTop)
      + snapshot.y * state.zoom - targetY)
  }

  function renderOverviewLabels() {
    const viewport = container.querySelector('[data-topology-viewport]')
    const frame = container.querySelector('[data-topology-frame]')
    const main = container.querySelector('.topology-stitch-main')
    if (!viewport || !frame || !main || !layout || state.zoom >= 0.52) {
      onLabels([])
      return
    }
    const viewportBounds = viewport.getBoundingClientRect()
    const mainBounds = main.getBoundingClientRect()
    const frameLeft = numericStyle(frame.style.left, frame.offsetLeft)
    const frameTop = numericStyle(frame.style.top, frame.offsetTop)
    const areaOverview = layout.mode === 'area-overview'
    const items = areaOverview
      ? (layout.overviewAreas ?? []).map((area) => ({
        kind: 'area',
        id: area.key,
        name: area.name,
        count: area.nodeCount,
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
      }))
      : (layout.mountingBoxes ?? [])
        .filter((box) => (
          box.kind !== 'needs-mounting'
            && (box.kind !== 'empty' || box.custom)
        ))
        .map((box) => ({
          kind: 'mounting',
          id: box.id,
          name: state.frameNames[box.id] || box.label || box.hostName || box.hostId
            || 'Kelompok pemasangan',
          count: box.nodeIds?.length ?? 0,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        }))
    const positions = items.map((item) => {
      const x = viewportBounds.left - mainBounds.left + frameLeft
        + (item.x + item.width / 2) * state.zoom - viewport.scrollLeft
      const y = viewportBounds.top - mainBounds.top + frameTop
        + (item.y + item.height / 2) * state.zoom - viewport.scrollTop
      const width = Math.min(196, Math.max(112, String(item.name).length * 7 + 38))
      return { ...item, x, y, labelWidth: width }
    }).filter((item) => (
      item.x >= viewportBounds.left - mainBounds.left + item.labelWidth / 2 + 6
        && item.x <= viewportBounds.right - mainBounds.left - item.labelWidth / 2 - 6
        && item.y >= viewportBounds.top - mainBounds.top + 22
        && item.y <= viewportBounds.bottom - mainBounds.top - 22
    )).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'id'))
    const placed = []
    const visible = positions.filter((item) => {
      const bounds = {
        left: item.x - item.labelWidth / 2,
        right: item.x + item.labelWidth / 2,
        top: item.y - 19,
        bottom: item.y + 19,
      }
      if (placed.some((other) => (
        bounds.left < other.right && bounds.right > other.left
          && bounds.top < other.bottom && bounds.bottom > other.top
      ))) return false
      placed.push(bounds)
      return true
    })
    onLabels(visible)
  }

  const activate=event=>{
    if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return
    const node=event.target.closest('[data-node-id]'),edge=event.target.closest('[data-edge-id]'),group=event.target.closest('[data-mounting-group-id]'),area=event.target.closest('[data-overview-area]')
    const selected=node?{kind:'asset',id:node.dataset.nodeId}:edge?{kind:'edge',id:edge.dataset.edgeId}:group?{kind:'mounting',id:group.dataset.mountingGroupId}:area?{kind:'area',id:area.dataset.overviewArea}:null
    if(selected){if(event.type==='keydown')event.preventDefault();onSelect?.(selected)}
  }
  scope.listen(frame,'click',activate);scope.listen(frame,'keydown',activate)
  scope.listen(viewport,'wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();zoomGraphTo(state.zoom+(event.deltaY>0?-.08:.08),event)},{passive:false})
  scope.listen(viewport,'pointerdown',event=>{
    if(event.button!==0||event.pointerType==='touch'||event.target.closest('[data-node-id],[data-edge-id],[data-mounting-group-id],button,a,input,select'))return
    pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-panning')
  })
  scope.listen(viewport,'pointermove',event=>{if(pan?.id!==event.pointerId)return;viewport.scrollLeft=pan.left-(event.clientX-pan.x);viewport.scrollTop=pan.top-(event.clientY-pan.y)})
  const end=event=>{if(pan?.id!==event.pointerId)return;const id=pan.id;pan=null;if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id);viewport.classList.remove('is-panning')}
  scope.listen(viewport,'pointerup',end);scope.listen(viewport,'pointercancel',end);scope.listen(viewport,'lostpointercapture',end)
  scope.listen(viewport,'scroll',renderOverviewLabels,{passive:true})
  if(typeof ResizeObserver==='function')scope.observe(new ResizeObserver(()=>{if(scope.disposed)return;onResize();syncGraphSurface({preserveCenter:true});renderOverviewLabels()}),viewport)
  scope.own(()=>{if(pan&&viewport.hasPointerCapture(pan.id))viewport.releasePointerCapture(pan.id);pan=null;viewport.classList.remove('is-panning')})
  const alive=callback=>(...args)=>{if(!scope.disposed)return callback(...args)}
  return {
    update(snapshot,{key,focus=null}={}){
      if(scope.disposed)return
      const reset=key!==scopeKey,focusChanged=focus&&focus.sequence!==lastFocus;scopeKey=key;if(focusChanged)lastFocus=focus.sequence;const previousZoom=state.zoom
      ;({model,layout,mapData,activeContext}=snapshot);state={...snapshot.state,zoom:previousZoom}
      renderGraph();updateToolbar()
      const focusCurrent=()=>{if(focus.kind==='relations')focusRelations();else if(focus.kind==='asset')focusAssetCard(focus.id);else if(focus.kind==='mounting')focusMountingGroup(focus.id)}
      if(reset)scope.frame(()=>{if(focusChanged)focusCurrent();else if(window.matchMedia('(max-width: 960px)').matches)fitGraph();else resetGraphViewport()})
      else if(focusChanged)scope.frame(focusCurrent)
      else scope.frame(()=>syncGraphSurface({preserveCenter:true}))
    },
    zoomIn:alive(()=>changeZoom(.1)),zoomOut:alive(()=>changeZoom(-.1)),resetZoom:alive(()=>zoomGraphTo(1)),fit:alive(fitGraph),reset:alive(resetGraphViewport),
    focusItem:alive(choice=>{const key=choice.kind==='asset'?'nodeId':'edgeId';[...frame.querySelectorAll('[data-node-id],[data-edge-id]')].find(node=>node.dataset[key]===choice.id)?.focus({preventScroll:true})}),
    focusAsset:alive(focusAssetCard),focusGroup:alive(focusMountingGroup),focusRelations:alive(focusRelations),
    refresh(){if(!scope.disposed){renderGraph();renderOverviewLabels()}},
    dispose:()=>scope.dispose(),
  }
}
