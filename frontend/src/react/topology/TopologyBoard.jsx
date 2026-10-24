import {useEffect,useLayoutEffect,useRef,useState} from 'react'

export function TopologyBoard({rootRef,snapshot,scopeKey,initialFocus,apiRef,createAdapter,onSelect,onZoom,onResize,onMessage,onIcons}){
 const [labels,setLabels]=useState([]),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),callbacks=useRef(null)
 useLayoutEffect(()=>{callbacks.current={onSelect,onZoom,onResize,onMessage,onIcons}})
 useEffect(()=>{
  let api,active=true
  try{api=createAdapter(rootRef.current,{onSelect:value=>callbacks.current.onSelect(value),onZoom:value=>callbacks.current.onZoom(value),onResize:()=>callbacks.current.onResize(),onMessage:value=>callbacks.current.onMessage(value),onIcons:value=>callbacks.current.onIcons(value),onLabels:setLabels})}
  catch(cause){queueMicrotask(()=>{if(active)setError(cause.message)});return()=>{active=false}}
  apiRef.current=api
  const stop=()=>api.dispose();window.addEventListener('pagehide',stop)
  return()=>{active=false;stop();if(apiRef.current===api)apiRef.current=null;window.removeEventListener('pagehide',stop)}
 },[rootRef,apiRef,createAdapter,attempt])
 useEffect(()=>{let active=true;try{apiRef.current?.update(snapshot,{key:scopeKey,focus:initialFocus})}catch(cause){apiRef.current?.dispose();apiRef.current=null;queueMicrotask(()=>{if(active)setError(cause.message)})}return()=>{active=false}},[snapshot,scopeKey,initialFocus,apiRef,attempt])
 return <><div className="topology-stitch-viewport" data-topology-viewport tabIndex={0} aria-label="Canvas diagram topologi"><div className="topology-stitch-canvas"><div className="topology-stitch-graph-frame" data-topology-frame/></div></div>{error&&<section className="map-empty-layer" role="alert"><strong>Diagram tidak dapat ditampilkan</strong><p>{error}</p><button type="button" onClick={()=>{setError('');setAttempt(value=>value+1)}}>Coba lagi diagram</button></section>}<div className="topology-overview-labels" data-topology-overview-labels hidden={!labels.length}>{labels.map(item=><button type="button" className="topology-overview-label" key={`${item.kind}:${item.id}`} aria-label={`${item.name} · ${item.count} aset · pilih untuk fokus`} title={`${item.name} · ${item.count} aset`} style={{left:item.x,top:item.y}} onClick={()=>onSelect({kind:item.kind==='area'?'area':'mounting',id:item.id,focus:true})}><strong>{item.name}</strong><small>{item.count} aset</small></button>)}</div></>
}
