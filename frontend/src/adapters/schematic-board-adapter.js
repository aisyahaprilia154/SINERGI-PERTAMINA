import { renderSchematicSvg } from '../pages/map/schematic-svg.js'
import { calculateSchematicFitScale, ALL_ASSET_FIT_MIN_ZOOM, MIN_SCHEMATIC_ZOOM } from '../pages/map/schematic-viewport.js'
import { createSourceIconLoader } from '../domain/source-icon-loader.js'
import { assetIconUrl } from '../domain/asset-icon.js'

// Only the SVG/viewport container belongs to this adapter, never toolbar or summary.
export function createSchematicBoardAdapter(board,{onSelect,onToggleGroup,onZoom,onReady}={}) {
  const controller=new AbortController(),signal=controller.signal,loader=createSourceIconLoader({signal})
  let current=null,options=null,zoom=1,autoFit=true,frame=null,pan=null,sequence=0
  const svg=()=>board.querySelector('.schematic-svg')
  const box=()=>{const [x,y,width,height]=(svg()?.getAttribute('viewBox')||'0 0 1 1').split(/\s+/).map(Number);return {x,y,width,height}}
  const available=()=>({width:Math.max(board.clientWidth-32,240),height:Math.max(board.clientHeight-32,180)})
  const schedule=callback=>{if(frame!==null)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=null;if(!signal.aborted)callback()})}
  const apply=()=>{const element=svg();if(!element)return;const view=box(),viewport=available();zoom=Math.max(MIN_SCHEMATIC_ZOOM,zoom);element.style.width=`${Math.max(1,Math.round(view.width*zoom))}px`;element.style.height=`${Math.max(1,Math.round(view.height*zoom))}px`;element.style.margin=view.width*zoom<=viewport.width?'0 auto':'0';onZoom?.(Math.round(zoom*100))}
  const fit=()=>{if(!svg())return;const view=box(),viewport=available(),all=current?.graph.mode==='all-assets';zoom=calculateSchematicFitScale({viewBoxWidth:view.width,viewBoxHeight:view.height,viewportWidth:viewport.width,viewportHeight:viewport.height,minZoom:all?ALL_ASSET_FIT_MIN_ZOOM:MIN_SCHEMATIC_ZOOM,preferWidth:all});autoFit=true;apply();board.scrollTo({top:0,left:0})}
  const center=id=>{const node=current?.layout.nodes.find(node=>node.id===id);if(!node)return;autoFit=false;zoom=Math.max(zoom,.75);apply();const viewport=available();board.scrollTo({left:Math.max(0,(node.diagram.x+node.diagram.width/2)*zoom-viewport.width/2),top:Math.max(0,(node.diagram.y+node.diagram.height/2)*zoom-viewport.height/2),behavior:'smooth'})}
  const position=()=>{if(current?.graph.mode==='all-assets'){board.scrollTo({top:0,left:0});return};const id=current?.layout.focusNodeId||current?.graph.anchorAssetId,node=current?.layout.nodes.find(node=>node.id===id);if(node){const viewport=available();board.scrollTo({left:Math.max(0,(node.diagram.x+node.diagram.width/2)*zoom-viewport.width/2),top:Math.max(0,(node.diagram.y+node.diagram.height/2)*zoom-viewport.height/2)})}}
  const draw=()=>{if(signal.aborted||!current)return;const left=board.scrollLeft,top=board.scrollTop,focused=board.contains(document.activeElement)?document.activeElement.closest('[data-asset-id],[data-pole-group-toggle]'):null,focusAsset=focused?.dataset.assetId,focusGroup=focused?.dataset.poleGroupToggle;board.innerHTML=`<div class="schematic-viewport">${renderSchematicSvg({...options,...current,sourceIconDataByUrl:loader.dataByUrl})}</div>`;apply();board.scrollLeft=left;board.scrollTop=top;if(focusAsset||focusGroup)[...board.querySelectorAll('[data-asset-id],[data-pole-group-toggle]')].find(node=>focusAsset?node.dataset.assetId===focusAsset:node.dataset.poleGroupToggle===focusGroup)?.focus({preventScroll:true})}
  const activate=event=>{const group=event.target.closest('[data-pole-group-toggle]'),node=event.target.closest('.diagram-node');if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;if(group||node){if(event.type==='keydown')event.preventDefault();if(group)onToggleGroup?.(group.dataset.poleGroupToggle);else onSelect?.(node.dataset.assetId)}}
  board.addEventListener('click',activate,{signal});board.addEventListener('keydown',activate,{signal})
  board.addEventListener('wheel',event=>{if(!svg())return;event.preventDefault();const rect=board.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,sourceX=(board.scrollLeft+x)/zoom,sourceY=(board.scrollTop+y)/zoom;autoFit=false;zoom=Math.max(MIN_SCHEMATIC_ZOOM,Math.min(2.5,zoom+(event.deltaY<0?.1:-.1)));apply();board.scrollLeft=Math.max(0,sourceX*zoom-x);board.scrollTop=Math.max(0,sourceY*zoom-y)},{passive:false,signal})
  board.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('.diagram-node,[data-pole-group-toggle]'))return;pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:board.scrollLeft,top:board.scrollTop};board.setPointerCapture?.(event.pointerId);board.classList.add('is-panning')},{signal})
  board.addEventListener('pointermove',event=>{if(!pan||pan.id!==event.pointerId)return;board.scrollLeft=pan.left-(event.clientX-pan.x);board.scrollTop=pan.top-(event.clientY-pan.y)},{signal})
  const end=event=>{if(!pan||pan.id!==event.pointerId)return;if(board.hasPointerCapture?.(event.pointerId))board.releasePointerCapture(event.pointerId);pan=null;board.classList.remove('is-panning')}
  board.addEventListener('pointerup',end,{signal});board.addEventListener('pointercancel',end,{signal});board.addEventListener('lostpointercapture',end,{signal})
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{if(autoFit)fit()});resize?.observe(board)
  return {
    render(diagram,nextOptions,{reset=false}={}){
      const changed=diagram!==current;current=diagram;options=nextOptions;const token=++sequence
      if(!diagram||diagram.graph.status!=='ready'||diagram.layout.status!=='ready'){board.replaceChildren();onReady?.(false);return}
      draw();if(reset||changed){autoFit=diagram.graph.mode==='all-assets';if(diagram.graph.mode==='all-assets')fit();else{zoom=diagram.layout.defaultZoom??(diagram.graph.mode==='selected'?1:.62);apply();position()};schedule(position)}
      const missing=[...new Set(diagram.layout.nodes.map(assetIconUrl).filter(Boolean))].filter(url=>!loader.dataByUrl.has(url)),loading=missing.length?Promise.all(missing.map(loader.load)):null
      onReady?.(!loading)
      if(loading)void loading.then(()=>{if(!signal.aborted&&token===sequence){draw();onReady?.(true)}})
    },
    getSvg:svg,fit,center,
    zoomIn(){autoFit=false;zoom=Math.min(2.5,zoom+.15);apply()},zoomOut(){autoFit=false;zoom=Math.max(MIN_SCHEMATIC_ZOOM,zoom-.15);apply()},
    reset(){autoFit=false;zoom=current?.layout.defaultZoom??(current?.graph.mode==='selected'?1:.62);apply();position()},
    snapshot(){return {zoom,x:(board.scrollLeft+board.clientWidth/2)/zoom,y:(board.scrollTop+board.clientHeight/2)/zoom,autoFit}},
    restore(snapshot){schedule(()=>{if(snapshot.autoFit){fit();return};autoFit=false;zoom=snapshot.zoom;apply();board.scrollLeft=Math.max(0,snapshot.x*zoom-board.clientWidth/2);board.scrollTop=Math.max(0,snapshot.y*zoom-board.clientHeight/2)})},
    dispose(){if(signal.aborted)return;controller.abort();sequence++;resize?.disconnect();if(frame!==null)cancelAnimationFrame(frame);if(pan&&board.hasPointerCapture?.(pan.id))board.releasePointerCapture(pan.id);pan=null;board.classList.remove('is-panning');board.replaceChildren()},
  }
}
