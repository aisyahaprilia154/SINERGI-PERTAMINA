import {frameMoveAssetIds} from '../pages/topology/topology-frame-descendants.js'

export function canMountAssetOnPole(node) {
  if(['endpoint','junction-peer','junction-extended'].includes(node?.diagramClass))return true
  const identity = `${node?.type ?? ''} ${node?.assetType ?? ''} ${node?.name ?? ''}`
  return !/\btiang\b|\bpole\b|\bpylon\b/i.test(identity)
    && /junction\s*box|\bjb\b|cctv|camera|kamera/i.test(identity)
}

// Commands mutate only the document draft. React owns the controls and publishes a snapshot per command.
export function createTopologyEditing({mapData,state,document,getModel,getLayout,publish,message}) {
  function moveAssetToFrame(assetId,box) {
    const model=getModel(),layout=getLayout(),node=model.nodeById.get(assetId)
    if(!node||!box||state.mutationBusy)return
    if(box.kind!=='excluded'&&!box.hostId)return
    if(box.kind!=='excluded'&&!canMountAssetOnPole(node)){message('Pilih perangkat akhir atau Junction Box untuk pemasangan pada tiang.');return}
    const source=layout.nodes.find(item=>item.id===assetId)
    const ids=['junction-peer','junction-extended'].includes(source?.diagramClass)?frameMoveAssetIds(layout.nodes,assetId,mapData.mountingRelations):[assetId]
    const assignments={...mapData.topologyFrameAssignments}
    let relations=[...(mapData.mountingRelations??[])],mountingChanged=false
    for(const id of ids){
      const member=model.nodeById.get(id)
      if(!member||(box.kind!=='excluded'&&!canMountAssetOnPole(member)))continue
      const displayed=layout.nodes.find(item=>item.id===id)?.mountingBoxId??null
      if(assignments[id]!==box.id||displayed!==box.id){assignments[id]=box.id;document.stageChange({type:'move-frame',assetId:id,frameId:box.id})}
      const current=relations.find(item=>item.sourceAssetId===id&&!['rejected','revoked'].includes(String(item.verificationStatus).toLowerCase()))
      if(box.kind==='excluded'&&current){relations=relations.filter(item=>item.sourceAssetId!==id);mountingChanged=true}
      else if(box.kind!=='excluded'&&canMountAssetOnPole(member)&&current?.targetAssetId!==box.hostId){relations=[...relations.filter(item=>item.sourceAssetId!==id),{sourceAssetId:id,targetAssetId:box.hostId,relationType:'mounted_on',verificationStatus:'confirmed',provenance:'manual_admin'}];mountingChanged=true}
    }
    mapData.topologyFrameAssignments=assignments
    if(mountingChanged)document.applyMutationResponse({mountingRelations:relations})
    publish()
  }
  function closeComposer({discard=true}={}){
    const id=state.pendingFrameId;state.frameComposerOpen=false;state.pendingFrameId=null
    if(discard&&state.selectedMountingGroupId===id){state.selectedMountingGroupId=null;state.focus=null}
    if(discard&&id){const next={...mapData.topologyFrames};delete next[id];mapData.topologyFrames=next}
    publish()
  }
  function openComposer(){
    if(state.mutationBusy||state.frameComposerOpen)return
    const areaKey=state.area??getModel().areas?.[0]?.key??mapData.locationGroups[0]?.key
    if(!areaKey){message('Area untuk frame belum tersedia.');return}
    state.area=areaKey
    const id=`excluded-mounting:${areaKey}:custom:${crypto.randomUUID()}`
    mapData.topologyFrames={...mapData.topologyFrames,[id]:{id,type:'non-pole',areaKey,name:'Frame baru'}}
    state.pendingFrameId=id;state.frameComposerOpen=true;state.selectedMountingGroupId=id;state.focus={kind:'frame',id,sequence:(state.focus?.sequence??0)+1};publish()
  }
  function chooseFrame(value){
    const id=state.pendingFrameId,pending=mapData.topologyFrames?.[id]
    if(!pending||state.mutationBusy)return
    let frame
    if(['type:indoor','type:non-pole'].includes(value)){const type=value.slice(5);frame={...pending,type,name:type==='indoor'?'Indoor':'Non-tiang'}}
    else if(value.startsWith('pole:')){const pole=getModel().physicalMounts.find(item=>item.id===value.slice(5));if(!pole)return;frame={id:`pole-group:${pole.id}`,type:'pole',areaKey:pole.areaKey,poleAssetId:pole.id,name:pole.name||pole.id};state.area=pole.areaKey}
    else return
    const next={...mapData.topologyFrames};delete next[id];next[frame.id]=frame;mapData.topologyFrames=next
    document.stageChange({type:'create-frame',frame});state.selectedMountingGroupId=frame.id;state.focus={kind:'frame',id:frame.id,sequence:(state.focus?.sequence??0)+1};closeComposer({discard:false})
    message(`${frame.name} ditambahkan. Pilih Simpan untuk menerapkan.`)
  }
  function renameFrame(id,text){
    const box=getLayout().mountingBoxes?.find(item=>item.id===id),value=text.trim()
    if(!box||(!box.hostId&&!mapData.topologyFrames?.[id])||state.mutationBusy)return
    if(value)state.frameNames={...state.frameNames,[id]:value};else{state.frameNames={...state.frameNames};delete state.frameNames[id]}
    if(mapData.topologyFrames?.[id]){const frame={...mapData.topologyFrames[id],name:value||box.hostName};mapData.topologyFrames={...mapData.topologyFrames,[id]:frame};document.stageChange({type:'create-frame',frame})}
    else document.stageChange({type:'rename-frame',assetId:box.hostId,name:value})
    publish()
  }
  function drop({assetId,drop,dx,dy,zoom}){
    if(state.mutationBusy)return
    if(drop.kind==='connect'){void document.addRelation(assetId,drop.targetId);message('Relasi ditambahkan. Pilih Simpan untuk menerapkan.');return}
    const source=getLayout().nodes.find(item=>item.id===assetId)
    if(source&&drop.box?.id===source.mountingBoxId){
      const x=source.diagram.x+dx/zoom,y=source.diagram.y+dy/zoom
      mapData.nodePositions={...mapData.nodePositions,[assetId]:{x,y}}
      document.stageChange({type:'move-node',assetId,x,y});publish();message('Posisi tampilan diubah. Pilih Simpan untuk menerapkan.')
    }else moveAssetToFrame(assetId,drop.box)
  }
  return {moveAssetToFrame,openComposer,closeComposer,chooseFrame,renameFrame,drop}
}
