import {useCallback,useLayoutEffect,useRef,useState} from 'react'
import {createTopologyDocument} from '../../domain/topology-document.js'
import {createTopologyEditing} from '../../domain/topology-editing.js'
import {createDownloadScope} from '../../services/download-scope.js'
import {renderTopologyDiagramSvg} from '../../pages/topology/topology-diagram-svg.js'
import {downloadSchematicSvg,downloadSchematicPng} from '../../pages/map/schematic-export.js'
import {branchNameForFacility} from '../../domain/facility-branch.js'
import {areaName} from '../../domain/topology-view.js'
import {listenForDatasetRevision} from '../../services/operational-api.js'

export function useTopologyEditor({data,state,dispatch,canEdit,message,closeName}){
  const [view,setView]=useState(data)
  const current=useRef(null),owner=useRef(null),draft=useRef(null)
  useLayoutEffect(()=>{current.current={state,dispatch,canEdit,message,closeName};if(draft.current)Object.assign(draft.current,state)})
  const publish=useCallback(()=>{
    if(owner.current?.signal.aborted)return
    const resource=owner.current
    setView(structuredClone({...resource.working,graph:resource.document.graph,roots:resource.document.roots}))
    current.current.dispatch({...draft.current,changes:[...draft.current.changes],frameNames:{...draft.current.frameNames}})
  },[])
  useLayoutEffect(()=>{
    const working=structuredClone(data)
    const controller=new AbortController(),downloads=createDownloadScope(controller.signal)
    const mutable={...current.current.state,changes:[...current.current.state.changes],frameNames:{...current.current.state.frameNames}}
    draft.current=mutable
    const document=createTopologyDocument({mapData:working.mapData,graph:working.graph,roots:working.roots,state:mutable,canEditTopology:current.current.canEdit,
      signal:controller.signal,getModel:()=>owner.current.model,rebuild:publish,updatePanelState:publish,showToast:text=>current.current.message(text),closeFrameNameEditor:()=>current.current.closeName()})
    const editing=createTopologyEditing({mapData:working.mapData,state:mutable,document,getModel:()=>owner.current.model,getLayout:()=>owner.current.layout,publish,message:text=>current.current.message(text)})
    const resource={working,document,editing,signal:controller.signal,downloads,model:null,layout:null,icons:new Map()};owner.current=resource
    const stop=()=>controller.abort(),guard=event=>{if(mutable.changes.length||mutable.mutationBusy){event.preventDefault();event.returnValue=''}}
    const removeRevision=listenForDatasetRevision({datasetId:working.mapData.activeContext.datasetId,revision:()=>working.mapData.recordRevision,isDirty:()=>mutable.changes.length>0||mutable.mutationBusy,onDirty:()=>current.current.message('Data berubah di halaman lain. Periksa perubahan sebelum menyimpan.')})
    window.addEventListener('pagehide',stop);window.addEventListener('beforeunload',guard)
    return()=>{stop();downloads.dispose();removeRevision();window.removeEventListener('pagehide',stop);window.removeEventListener('beforeunload',guard);if(owner.current===resource)owner.current=null}
  },[data,publish])
  const setSnapshot=useCallback((model,layout,icons)=>{if(owner.current)Object.assign(owner.current,{model,layout,icons})},[])
  const command=useCallback((name,...args)=>{
    const resource=owner.current
    if(!resource||resource.signal.aborted||!current.current.canEdit)return
    const target=resource.document[name]?resource.document:resource.editing
    return target[name]?.(...args)
  },[])
  const exportDiagram=useCallback(async kind=>{
    const resource=owner.current
    if(!resource||resource.signal.aborted||resource.exportBusy)return
    const {model,layout,icons,signal,downloads}=resource,{mapData}=resource.working,s=draft.current
    if(layout?.status!=='ready'){current.current.message('Diagram belum siap untuk diekspor.');return}
    resource.exportBusy=true
    try{
      const branch=branchNameForFacility(mapData.locationGroups.find(item=>item.key===s.area),mapData.activeContext.branchName)
      const svg=new DOMParser().parseFromString(renderTopologyDiagramSvg({model,layout,context:{...mapData.activeContext,branchName:branch,areaKey:s.area},renderMode:'export',showMountingPhysical:s.showMountingPhysical,sourceIconDataByUrl:icons,mountingLabelById:s.frameNames}),'image/svg+xml').documentElement
      const slug=`${branch||mapData.activeContext.branchId}-${areaName(s.area,mapData.locationGroups)}`.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
      current.current.dispatch({exportOpen:false})
      if(kind==='png')await downloadSchematicPng(svg,`sinergi-topologi-${slug}.png`,2,{signal,saveBlob:downloads.saveBlob})
      else downloadSchematicSvg(svg,`sinergi-topologi-${slug}.svg`,{signal,saveBlob:downloads.saveBlob})
    }catch(error){if(!signal.aborted)current.current.message(error.message)}finally{resource.exportBusy=false}
  },[])
  return {...view,command,setSnapshot,exportDiagram}
}
