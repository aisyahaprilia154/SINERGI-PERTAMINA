import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { MapDialog } from './MapDialog.jsx'
import { Icon } from '../components/Icon.jsx'
import { DiagramSummary } from './DiagramSummary.jsx'
import { diagramFilename, diagramMeta, resolutionText } from '../../domain/map-diagrams.js'
import { searchMatchScore } from '../../domain/search-normalization.js'
import { createSchematicBoardAdapter } from '../../adapters/schematic-board-adapter.js'
import { createDownloadScope } from '../../services/download-scope.js'
import { downloadSchematicSvg, downloadSchematicPng } from '../../pages/map/schematic-export.js'

async function loadDiagrams(model,id,signal){const {createMapDiagrams}=await import('../../domain/map-diagrams.js');signal.throwIfAborted();return createMapDiagrams(model,id)}
function DiagramBoard({diagram,context,selected,collapsed,apiRef,onSelect,onToggle,onZoom,onReady,createAdapter}){
  const host=useRef(null),callbacks=useRef(null)
  useLayoutEffect(()=>{callbacks.current={onSelect,onToggle,onZoom,onReady}})
  useEffect(()=>{
    const api=createAdapter(host.current,{onSelect:id=>callbacks.current.onSelect(id),onToggleGroup:id=>callbacks.current.onToggle(id),onZoom:value=>callbacks.current.onZoom(value),onReady:value=>callbacks.current.onReady(value)})
    apiRef.current=api;const stop=()=>api.dispose();window.addEventListener('pagehide',stop)
    return()=>{stop();if(apiRef.current===api)apiRef.current=null;window.removeEventListener('pagehide',stop)}
  },[apiRef,createAdapter])
  useEffect(()=>{apiRef.current?.render(diagram,{context,selectedAssetId:selected,collapsedPoleGroupIds:collapsed})},[diagram,context,selected,collapsed,apiRef])
  return <div ref={host} className="schematic-board" aria-label="Preview diagram skematik" tabIndex={0}/>
}
export function SchematicDialog({snapshot,onClose,onSelectAsset,createAdapter=createSchematicBoardAdapter,prepareDiagrams=loadDiagrams}) {
  const title=useId(),context=snapshot.context
  const [diagrams,setDiagrams]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
  const [mode,setMode]=useState('all-assets'),[selected,setSelected]=useState(snapshot.selectedAssetId),[collapsed,setCollapsed]=useState(new Set())
  const [query,setQuery]=useState(''),[searchOpen,setSearchOpen]=useState(false),[zoom,setZoom]=useState(100),[iconsReady,setIconsReady]=useState(false)
  const [exportStatus,setExportStatus]=useState(''),[exportBusy,setExportBusy]=useState(false),[fullscreen,setFullscreen]=useState(false),[fallback,setFallback]=useState(false)
  const apiRef=useRef(null),shellRef=useRef(null),ownerRef=useRef(null),fullscreenSnapshotRef=useRef(null),resultsRef=useRef(null),searchRef=useRef(null)
  useEffect(()=>{
    const controller=new AbortController(),downloads=createDownloadScope(controller.signal),owner={controller,downloads,busy:false};ownerRef.current=owner
    const stop=()=>{controller.abort();downloads.dispose()}
    window.addEventListener('pagehide',stop)
    const shell=shellRef.current
    const change=()=>{if(!controller.signal.aborted){setFullscreen(document.fullscreenElement===shell);if(fullscreenSnapshotRef.current){apiRef.current?.restore(fullscreenSnapshotRef.current);fullscreenSnapshotRef.current=null}}}
    document.addEventListener('fullscreenchange',change)
    return()=>{stop();window.removeEventListener('pagehide',stop);document.removeEventListener('fullscreenchange',change);if(document.fullscreenElement===shell)void document.exitFullscreen()?.catch(()=>{})}
  },[])
  useEffect(()=>{
    const controller=new AbortController(),stop=()=>controller.abort();window.addEventListener('pagehide',stop)
    void prepareDiagrams(snapshot.model,snapshot.selectedAssetId,controller.signal).then(result=>{if(!controller.signal.aborted)setDiagrams(result)}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message)})
    return()=>{stop();window.removeEventListener('pagehide',stop)}
  },[snapshot,attempt,prepareDiagrams])
  const current=diagrams?.[mode],ready=current?.graph.status==='ready'&&current.layout.status==='ready'
  const matches=query.trim()?(current?.layout.nodes||[]).filter(node=>searchMatchScore([node.id,node.name,node.type],query.trim())>0).slice(0,8):[]
  const choose=id=>{const group=current?.graph.poleGroups?.find(group=>group.assetIds.includes(id));if(group&&collapsed.has(group.id||group.poleAssetId))setCollapsed(previous=>{const next=new Set(previous);next.delete(group.id||group.poleAssetId);return next});if(onSelectAsset?.(id)!==false)setSelected(id)}
  const searchChoose=node=>{choose(node.id);apiRef.current?.center(node.id);setQuery(node.name||node.id);setSearchOpen(false);searchRef.current?.focus()}
  const toggleGroup=id=>setCollapsed(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next})
  async function toggleFullscreen(){
    const owner=ownerRef.current,shell=shellRef.current;if(!owner||owner.controller.signal.aborted)return
    const saved=apiRef.current?.snapshot();fullscreenSnapshotRef.current=saved
    try{
      if(fallback){setFallback(false);setFullscreen(false);apiRef.current?.restore(saved)}
      else if(document.fullscreenElement===shell)await document.exitFullscreen()
      else if(shell.requestFullscreen){await shell.requestFullscreen();if(owner.controller.signal.aborted){if(document.fullscreenElement===shell)await document.exitFullscreen();return};if(document.fullscreenElement!==shell){setFallback(true);setFullscreen(true);apiRef.current?.restore(saved)}}
      else{setFallback(true);setFullscreen(true);apiRef.current?.restore(saved)}
    }catch{if(!owner.controller.signal.aborted){setFallback(true);setFullscreen(true);apiRef.current?.restore(saved)}}
  }
  const escape=()=>{if(fullscreen){void toggleFullscreen();return};onClose()}
  async function exportDiagram(png){
    const owner=ownerRef.current,svg=apiRef.current?.getSvg();if(!owner||owner.controller.signal.aborted||owner.busy||!ready||!iconsReady||!svg)return
    owner.busy=true;setExportBusy(true);setExportStatus(png?'Menyiapkan PNG…':'Menyiapkan SVG…')
    const options={signal:owner.controller.signal,saveBlob:owner.downloads.saveBlob}
    try{if(png)await downloadSchematicPng(svg,`${diagramFilename(current.graph,context)}.png`,2,options);else downloadSchematicSvg(svg,`${diagramFilename(current.graph,context)}.svg`,options);if(!options.signal.aborted)setExportStatus(`File ${png?'PNG':'SVG'} berhasil disiapkan.`)}catch(cause){if(!options.signal.aborted)setExportStatus(cause.message)}finally{owner.busy=false;if(!options.signal.aborted)setExportBusy(false)}
  }
  const changeMode=next=>{setMode(next);setQuery('');setSearchOpen(false);setExportStatus('');setIconsReady(false)}
  return <MapDialog className="schematic-dialog" labelledBy={title} onClose={onClose} onEscape={escape}><div ref={shellRef} className={`schematic-shell${fallback?' schematic-shell-fullscreen':''}`}>
    <header className="schematic-header"><div><span className="eyebrow">DIAGRAM SKEMATIK 2D</span><h2 id={title} className="schematic-current-title">{ready?current.graph.title:!diagrams&&!error?'Memuat diagram':'Diagram belum dapat dibuat'}</h2><p className="schematic-current-meta">{ready?diagramMeta(current.graph,current.layout,context):'Periksa cakupan data diagram.'}</p></div><div className="schematic-header-actions"><button className="icon-button close-schematic" type="button" aria-label="Tutup diagram" onClick={onClose}><Icon>close</Icon></button></div></header>
    <div className="schematic-mode-bar"><div className="schematic-mode-switch" role="tablist" aria-label="Cakupan diagram">{[['all-assets','hub','Seluruh aset','Semua aset pada area aktif'],['full-map','account_tree','Topologi jaringan','Relasi terkonfirmasi pada area aktif'],['selected','conversion_path','Jalur terpilih','Relasi langsung dari aset yang dipilih']].map(([key,icon,label,hint])=><button key={key} className={`schematic-mode-option${mode===key?' active':''}`} type="button" role="tab" aria-selected={mode===key} disabled={exportBusy||(key==='selected'&&!snapshot.selectedAssetId)} onClick={()=>changeMode(key)}><Icon>{icon}</Icon><span><strong>{label}</strong><small>{hint}</small></span></button>)}</div></div>
    <div className="schematic-toolbar"><div className="schematic-tool-group" aria-label="Kontrol tampilan diagram"><button className="icon-button diagram-zoom-out" type="button" aria-label="Perkecil diagram" disabled={!ready} onClick={()=>apiRef.current?.zoomOut()}><Icon>remove</Icon></button><button className="diagram-zoom-level" type="button" aria-label="Fit diagram" disabled={!ready} onClick={()=>apiRef.current?.fit()}>{zoom}%</button><button className="icon-button diagram-zoom-in" type="button" aria-label="Perbesar diagram" disabled={!ready} onClick={()=>apiRef.current?.zoomIn()}><Icon>add</Icon></button><button className="tool-button diagram-fit" type="button" disabled={!ready} onClick={()=>apiRef.current?.fit()}><Icon>fit_screen</Icon><span>Fit diagram</span></button><button className="tool-button diagram-reset" type="button" disabled={!ready} onClick={()=>apiRef.current?.reset()}><Icon>restart_alt</Icon><span>Reset tampilan</span></button><button className="tool-button diagram-fullscreen" type="button" aria-label={fullscreen?'Keluar dari layar penuh':'Buka ruang kerja diagram layar penuh'} aria-pressed={fullscreen} onClick={()=>void toggleFullscreen()}><Icon>{fullscreen?'fullscreen_exit':'fullscreen'}</Icon><span className="diagram-fullscreen-label">{fullscreen?'Keluar fullscreen':'Fullscreen'}</span></button></div>
      <div className="schematic-search" role="search"><Icon>search</Icon><input ref={searchRef} className="diagram-search-input" type="search" placeholder="Cari ID atau nama aset" aria-label="Cari aset dalam diagram" autoComplete="off" value={query} disabled={!ready} onChange={event=>{setQuery(event.target.value);setSearchOpen(true)}} onBlur={event=>{if(!event.currentTarget.parentElement.contains(event.relatedTarget))setSearchOpen(false)}} onKeyDown={event=>{if(event.key==='Enter'&&matches[0]){event.preventDefault();searchChoose(matches[0])}else if(event.key==='ArrowDown'){event.preventDefault();resultsRef.current?.querySelector('button')?.focus()}else if(event.key==='Escape'&&searchOpen){event.preventDefault();event.stopPropagation();setSearchOpen(false)}}}/><div ref={resultsRef} className="diagram-search-results" role="listbox" aria-label="Hasil pencarian diagram" hidden={!searchOpen||!query.trim()} onBlur={event=>{if(!event.currentTarget.parentElement.contains(event.relatedTarget))setSearchOpen(false)}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setSearchOpen(false);searchRef.current?.focus()}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const buttons=[...resultsRef.current.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);buttons[Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus()}}}>{matches.length?matches.map(node=><button key={node.id} type="button" role="option" onClick={()=>searchChoose(node)}><strong>{node.name||node.id}</strong><small>{node.type||'Aset'} · {resolutionText(node.resolutionStatus)}</small></button>):<p>Tidak ada aset yang cocok.</p>}</div></div><span className="schematic-readonly"><Icon>lock</Icon>Read-only</span></div>
    <div className="schematic-content" data-schematic-mode={mode}>{ready?<DiagramBoard diagram={current} context={context} selected={selected} collapsed={collapsed} apiRef={apiRef} onSelect={choose} onToggle={toggleGroup} onZoom={setZoom} onReady={setIconsReady} createAdapter={createAdapter}/>:<div className="schematic-board">{!diagrams&&!error?<p role="status">Membentuk diagram…</p>:<div className="schematic-state" role="alert"><Icon>account_tree_off</Icon><strong>{error?'Diagram gagal dimuat':'Data diagram belum tersedia'}</strong><p>{error||current?.graph.message||'Diagram belum tersedia.'}</p>{error&&<button type="button" onClick={()=>{setError('');setDiagrams(null);setAttempt(value=>value+1)}}>Coba lagi diagram</button>}</div>}</div>}<aside className="schematic-summary" aria-label="Ringkasan aset" hidden={!ready}>{ready&&<DiagramSummary graph={current.graph} layout={current.layout} selectedAssetId={selected}/>}</aside></div>
    <footer className="schematic-footer"><p>Posisi relatif dan arah koneksi mengikuti peta. Diagram tidak mengubah koordinat sumber.</p><div><button className="button secondary close-schematic" type="button" onClick={onClose}>Kembali ke peta</button><button className="button secondary export-svg" type="button" disabled={!ready||!iconsReady||exportBusy} onClick={()=>void exportDiagram(false)}><Icon>code</Icon>Export SVG</button><button className="button primary export-png" type="button" disabled={!ready||!iconsReady||exportBusy} onClick={()=>void exportDiagram(true)}><Icon>image</Icon>Export PNG</button></div><span className="schematic-export-status" role="status" aria-live="polite">{exportStatus}</span></footer>
  </div></MapDialog>
}
