import {useCallback,useEffect,useLayoutEffect,useMemo,useReducer,useRef,useState} from 'react'
import {AppHeader} from '../components/AppHeader.jsx'
import {Icon} from '../components/Icon.jsx'
import {useSession} from '../session/session-context.js'
import {useTopologyDataset} from './useTopologyDataset.js'
import {TopologyBoard} from './TopologyBoard.jsx'
import {NodeIcon,TopologyInspector,TopologyLegend} from './TopologyPanels.jsx'
import {createTopologyReadAdapter} from '../../adapters/topology-read-adapter.js'
import {createTopologyWorkspaceState} from '../../domain/topology-workspace-state.js'
import {buildTopologyWorkspaceModel,buildTopologyWorkspaceLayout} from '../../domain/topology-workspace-model.js'
import {getDeviceSearchResults} from '../../domain/topology-search.js'
import {branchNameForFacility} from '../../domain/facility-branch.js'
import {areaName} from '../../domain/topology-view.js'
import {listenForDatasetRevision} from '../../services/operational-api.js'

function screenSize(){return {compact:window.matchMedia('(max-width: 960px)').matches,narrow:window.matchMedia('(max-width: 620px)').matches}}
function reducer(state,patch){if(Object.keys(patch).every(key=>state[key]===patch[key]))return state;return {...state,...patch}}
function initialState(mapData){let stored=null;try{stored=localStorage.getItem(`sinergi.topology.last-area:${mapData.activeContext.datasetId}`)}catch{/* Optional storage. */}const initial=createTopologyWorkspaceState({mapData,search:window.location.search,storedArea:stored,compact:screenSize().compact});return {...initial,query:'',searchOpen:false,focus:initial.selectedAssetId?{kind:'relations',sequence:0}:null}}

function Workspace({data,createAdapter}){
 const {mapData,graph,roots}=data,{user}=useSession(),canEdit=user?.role==='Administrator'
 const [state,dispatch]=useReducer(reducer,mapData,initialState),[size,setSize]=useState(screenSize),[icons,setIcons]=useState(()=>new Map()),[message,setMessage]=useState('')
 const root=useRef(null),api=useRef(null),search=useRef(null),results=useRef(null),legend=useRef(null),reopen=useRef(null),focusSequence=useRef(0),restoreSidebarFocus=useRef(false),restoreCanvasFocus=useRef(null)
 const {area,search:filterSearch,selectedFamilies,showMountingPhysical,pendingFrameId,changes}=state
 const model=useMemo(()=>buildTopologyWorkspaceModel({mapData,graph,roots,state:{area,search:filterSearch,selectedFamilies,showMountingPhysical}}),[mapData,graph,roots,area,filterSearch,selectedFamilies,showMountingPhysical])
 const layout=useMemo(()=>buildTopologyWorkspaceLayout(model,{mapData,state:{area,pendingFrameId,changes},compact:size.compact,narrow:size.narrow}),[model,mapData,area,pendingFrameId,changes,size.compact,size.narrow])
 const validAsset=model.nodeById.has(state.selectedAssetId)?state.selectedAssetId:null
 const viewState=useMemo(()=>({...state,selectedAssetId:validAsset}),[state,validAsset])
 const snapshot=useMemo(()=>({model,layout,mapData,activeContext:mapData.activeContext,state:viewState}),[model,layout,mapData,viewState])
 const focus=state.focus,scopeKey=`${mapData.activeContext.datasetVersionId}:${state.area}:${size.compact}:${size.narrow}`
 const matches=useMemo(()=>state.search.trim()?getDeviceSearchResults(model,state.search):[],[model,state.search])
 const onResize=useCallback(()=>setSize(previous=>{const next=screenSize();return previous.compact===next.compact&&previous.narrow===next.narrow?previous:next}),[])
 useEffect(()=>{document.title='Diagram Topologi — SINERGI';document.body.className='map-body topology-body';window.addEventListener('resize',onResize);return()=>window.removeEventListener('resize',onResize)},[onResize])
 useEffect(()=>{const timer=setTimeout(()=>dispatch({search:state.query}),120);const stop=()=>clearTimeout(timer);window.addEventListener('pagehide',stop);return()=>{stop();window.removeEventListener('pagehide',stop)}},[state.query])
 useEffect(()=>listenForDatasetRevision({datasetId:mapData.activeContext.datasetId,revision:()=>mapData.recordRevision}),[mapData])
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search);params.set('datasetId',mapData.activeContext.datasetId);params.delete('branchId');params.set('area',state.area??'all');if(validAsset)params.set('selectedAssetId',validAsset);else params.delete('selectedAssetId')
  window.history.replaceState(null,'',`${window.location.pathname}?${params}`)
  try{localStorage.setItem(`sinergi.topology.last-area:${mapData.activeContext.datasetId}`,state.area??'all')}catch{/* Optional storage. */}
 },[mapData,state.area,validAsset])
 useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),2200);return()=>clearTimeout(timer)},[message])
 const onSelect=choice=>{
  if(choice.kind==='area'){
   if(!mapData.locationGroups.some(area=>area.key===choice.id))return
   dispatch({area:choice.id,selectedAssetId:null,selectedEdgeId:null,selectedMountingGroupId:null,inspectorOpen:false,query:'',search:'',searchOpen:false,focus:null});return
  }
  if(choice.kind==='asset'&&!model.nodeById.has(choice.id))return
  if(choice.kind==='edge'&&!model.edgeById.has(choice.id))return
  if(choice.kind==='mounting'&&!layout.mountingBoxes?.some(box=>box.id===choice.id&&['confirmed','empty','excluded'].includes(box.kind)))return
  const requestFocus=choice.focus??(size.compact&&choice.kind!=='edge')
  dispatch({selectedAssetId:choice.kind==='asset'?choice.id:null,selectedEdgeId:choice.kind==='edge'?choice.id:null,selectedMountingGroupId:choice.kind==='mounting'?choice.id:null,inspectorOpen:choice.kind!=='mounting',focus:requestFocus?{kind:choice.kind,id:choice.id,sequence:++focusSequence.current}:state.focus})
 }
 const chooseSearch=result=>{
  const id=result.assetId??result.id,node=model.nodeById.get(id)||mapData.assets.find(asset=>asset.id===id),area=node?.areaKey??node?.locationGroupKey
  dispatch({area:layout.mode==='area-overview'&&area?area:state.area,selectedAssetId:id,selectedEdgeId:null,selectedMountingGroupId:null,inspectorOpen:true,query:'',search:'',searchOpen:false,focus:{kind:'asset',id,sequence:++focusSequence.current}})
  search.current?.focus()
 }
 const closeSidebar=()=>{restoreSidebarFocus.current=true;dispatch({sidebarCollapsed:true})}
 const closeLegend=()=>{dispatch({legendOpen:false});legend.current?.focus()}
 const closeInspector=()=>{restoreCanvasFocus.current=state.selectedAssetId?{kind:'asset',id:state.selectedAssetId}:state.selectedEdgeId?{kind:'edge',id:state.selectedEdgeId}:null;dispatch({inspectorOpen:false,selectedAssetId:null,selectedEdgeId:null,selectedMountingGroupId:null})}
 useEffect(()=>{
  let focusFrame=null
  const key=event=>{
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();dispatch({sidebarCollapsed:false});focusFrame=requestAnimationFrame(()=>search.current?.focus())}
   if(event.key==='Escape'){if(state.legendOpen){event.preventDefault();dispatch({legendOpen:false});legend.current?.focus()}else if(state.searchOpen){dispatch({searchOpen:false})}}
  }
  window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);if(focusFrame!==null)cancelAnimationFrame(focusFrame)}
 },[state.legendOpen,state.searchOpen])
 useLayoutEffect(()=>{if(state.sidebarCollapsed){if(restoreSidebarFocus.current){restoreSidebarFocus.current=false;reopen.current?.focus()}}else if(document.activeElement===reopen.current)search.current?.focus()},[state.sidebarCollapsed])
 useLayoutEffect(()=>{if(!state.inspectorOpen&&restoreCanvasFocus.current){api.current?.focusItem?.(restoreCanvasFocus.current);restoreCanvasFocus.current=null}},[state.inspectorOpen])
 const activeContext={...mapData.activeContext,area:state.area??'all',selectedAssetId:validAsset},branch=branchNameForFacility(mapData.locationGroups.find(area=>area.key===state.area),mapData.activeContext.branchName)||mapData.activeContext.branchId,summary=model.summary||{}
 return <div ref={root} className={`topology-stitch-app react-topology-read${state.sidebarCollapsed?' topology-sidebar-collapsed':''}`} data-react-topology-read><AppHeader active="topology" context={activeContext}/><div className="topology-stitch-shell">
  <aside className="network-sidebar topology-sidebar" id="topology-sidebar" data-topology-sidebar aria-label="Kontrol diagram topologi"><header className="sidebar-heading"><div><h1>Diagram topologi</h1></div><div className="sidebar-heading-actions">{[['desktop-only sidebar-collapse','left_panel_close'],['mobile-only close-sidebar','close']].map(([classes,icon])=><button key={icon} className={`icon-button ${classes}`} type="button" aria-label="Tutup panel diagram" aria-expanded={!state.sidebarCollapsed} onClick={closeSidebar}><Icon>{icon}</Icon></button>)}</div></header><div className="sidebar-content"><label className="area-selector"><span>Cabang / fasilitas</span><span className="area-selector-control"><select aria-label="Cabang atau fasilitas" data-area-filter value={state.area??'all'} onChange={event=>{if(event.target.value==='all')dispatch({area:null,selectedAssetId:null,selectedEdgeId:null,selectedMountingGroupId:null,inspectorOpen:false,query:'',search:'',searchOpen:false,focus:null});else onSelect({kind:'area',id:event.target.value})}}><option value="all">Semua area</option>{mapData.locationGroups.map(area=><option key={area.key} value={area.key}>{`${branchNameForFacility(area)||'Cabang'} · ${area.name}`}</option>)}</select><Icon className="area-selector-icon">expand_more</Icon></span></label>
   <div className="asset-search-combobox" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))dispatch({searchOpen:false})}}><label className="search-control"><Icon>search</Icon><input ref={search} id="topology-search" type="search" data-topology-search placeholder="Cari perangkat" autoComplete="off" spellCheck={false} aria-label="Cari perangkat" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="topology-search-results" aria-expanded={state.searchOpen&&!!state.query.trim()} value={state.query} onFocus={()=>dispatch({searchOpen:true})} onChange={event=>dispatch({query:event.target.value,searchOpen:true})} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();const first=matches[0]||getDeviceSearchResults(model,state.query)[0];if(first)chooseSearch(first);else setMessage('Perangkat tidak ditemukan.')}if(event.key==='ArrowDown'){event.preventDefault();results.current?.querySelector('button')?.focus()}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dispatch({searchOpen:false})}}}/><kbd>Ctrl K</kbd></label><div ref={results} className="sidebar-asset-search-results topology-search-results" id="topology-search-results" data-topology-search-results role="listbox" aria-label="Hasil pencarian diagram" hidden={!state.searchOpen||!state.query.trim()} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dispatch({searchOpen:false});search.current?.focus()}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const buttons=[...results.current.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);buttons[Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus()}}}>{matches.length?matches.map(result=><button type="button" key={result.id} onClick={()=>chooseSearch(result)}><Icon>device_hub</Icon><span><strong>{result.label}</strong><small>{result.typeLabel} · {result.area}</small></span><Icon>chevron_right</Icon></button>):<p>Perangkat tidak ditemukan.</p>}</div></div>
  </div></aside>
  <main className={`topology-stitch-main${model.isolatedNodes?.length?' has-disconnected-tray':''}`} aria-label="Workspace Diagram Topologi"><button ref={reopen} type="button" className="topology-sidebar-reopen" aria-label="Buka panel diagram" aria-controls="topology-sidebar" aria-expanded={!state.sidebarCollapsed} onClick={()=>dispatch({sidebarCollapsed:false})}><Icon>left_panel_open</Icon></button><section className="topology-context-card location-context-panel" aria-label="Konteks diagram aktif"><div className="location-context-fields">{[['apartment','Kantor cabang',branch],['location_on','Area',areaName(state.area,mapData.locationGroups)]].map(([icon,label,value])=><span className="location-context-item" key={label}><Icon className="location-context-icon">{icon}</Icon><span className="location-context-copy"><small>{label}</small><strong title={value}>{value}</strong></span></span>)}</div></section>
   <div className="topology-stitch-toolbar" role="group" aria-label="Alat diagram"><div className="topology-stitch-toolbar-actions"><div className="topology-toolbar-group topology-toolbar-edit-actions" aria-label="Edit diagram">{canEdit&&<button type="button" className="topology-stitch-toolbar-button topology-toolbar-labeled topology-toolbar-primary" aria-label="Tambah frame" disabled><Icon>add_box</Icon><span>Tambah frame</span></button>}<button type="button" className="topology-stitch-toolbar-button topology-toolbar-labeled" aria-label="Ekspor diagram" disabled><Icon>ios_share</Icon><span>Ekspor</span></button>{canEdit&&<button type="button" className="topology-stitch-toolbar-button topology-toolbar-labeled" aria-label="Tindakan lainnya" disabled><Icon>more_horiz</Icon><span>Lainnya</span></button>}</div></div></div>
   <TopologyBoard rootRef={root} snapshot={snapshot} scopeKey={scopeKey} initialFocus={focus} apiRef={api} createAdapter={createAdapter} onSelect={onSelect} onZoom={zoom=>dispatch({zoom})} onResize={onResize} onMessage={setMessage} onIcons={setIcons}/>
   <p className="topology-overview-hint" data-topology-overview-hint hidden={!(state.zoom<.5&&size.compact)}>Ketuk diagram untuk memperbesar, atau cari aset di panel.</p>
   <div className="topology-canvas-navigation" role="group" aria-label="Navigasi kanvas"><div className="topology-toolbar-group topology-toolbar-navigation" aria-label="Navigasi diagram"><div className="topology-stitch-zoom-control"><button type="button" data-action="zoom-out" aria-label="Perkecil diagram" disabled={model.status!=='ready'} onClick={()=>api.current?.zoomOut()}><Icon>remove</Icon></button><button type="button" className="topology-zoom-reset" data-topology-zoom-label title="Kembalikan zoom ke 100%" data-action="zoom-reset" aria-label="Kembalikan zoom ke 100%" disabled={model.status!=='ready'} onClick={()=>api.current?.resetZoom()}>{Math.round(state.zoom*100)}%</button><button type="button" data-action="zoom-in" aria-label="Perbesar diagram" disabled={model.status!=='ready'} onClick={()=>api.current?.zoomIn()}><Icon>add</Icon></button></div><button type="button" className="topology-stitch-toolbar-button topology-toolbar-navigation-button" data-action="fit" aria-label="Tampilkan seluruh diagram" disabled={model.status!=='ready'} onClick={()=>api.current?.fit()}><Icon>fit_screen</Icon><span>Semua</span></button><button type="button" className="topology-stitch-toolbar-button topology-toolbar-navigation-button" data-action="focus-relations" aria-label="Fokus ke relasi aset terpilih" disabled={!validAsset} onClick={()=>api.current?.focusRelations()}><Icon>center_focus_strong</Icon><span>Aset</span></button><span className="topology-navigation-divider"/><button ref={legend} data-action="toggle-legend" type="button" className="topology-stitch-toolbar-button topology-toolbar-navigation-button topology-legend-toggle" aria-label={state.legendOpen?'Sembunyikan legenda diagram':'Tampilkan legenda diagram'} aria-controls="topology-legend" aria-expanded={state.legendOpen} onClick={()=>dispatch({legendOpen:!state.legendOpen})}><Icon>info</Icon></button></div></div>
   <div className="topology-stitch-tray" data-topology-tray hidden={!model.isolatedNodes?.length}><div className="topology-stitch-tray-title"><Icon>link_off</Icon><span>Belum terhubung</span><strong>{model.isolatedNodes?.length||0}</strong></div><div className="topology-stitch-tray-list">{model.isolatedNodes?.map(node=><button type="button" className="topology-stitch-tray-item" key={node.id} title={`Klik untuk memilih: ${node.name||node.id}`} onClick={()=>onSelect({kind:'asset',id:node.id})}><span className="topology-stitch-tray-icon"><NodeIcon node={node} icons={icons}/></span><span>{node.name||node.id}</span></button>)}</div></div>
   <TopologyLegend open={state.legendOpen} onClose={closeLegend}/><span className="map-sr-only" role="status">{summary.totalAssetCount??0} aset · {summary.confirmedEdgeCount??0} relasi</span>
  </main><TopologyInspector model={model} mapData={mapData} state={viewState} icons={icons} onSelect={onSelect} onClose={closeInspector}/></div><div className={`topology-stitch-toast${message?' visible':''}`} role="status" aria-live="polite">{message}</div></div>
}

export function TopologyReadPage({createAdapter=createTopologyReadAdapter}){
 const data=useTopologyDataset()
 useEffect(()=>{document.title='Diagram Topologi — SINERGI';document.body.className='map-body topology-body'},[])
 if(data.loading||data.error)return <div className="topology-stitch-app topology-stitch-state-app react-topology-read"><AppHeader active="topology"/><main className={data.error?'topology-stitch-state error':'map-data-state is-loading'} aria-live="polite" aria-busy={data.loading}><Icon>{data.error?'error':'progress_activity'}</Icon><h1>{data.error?'Diagram Topologi belum tersedia':'Memuat dataset aktif'}</h1><p>{data.error||'Aset dan relasi sedang dibaca dari versi aktif yang sama.'}</p>{data.error&&<button type="button" className="topology-stitch-primary-button" onClick={data.retry}>Coba lagi</button>}</main></div>
 return <Workspace data={data.data} createAdapter={createAdapter}/>
}
