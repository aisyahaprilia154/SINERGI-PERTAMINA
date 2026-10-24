const base=require('./capture-baseline.cjs')
const active=structuredClone(base.active)
active.operationalSchema=2
active.context={datasetId:'dataset-semarang',datasetVersionId:'baseline',activePointerRevision:4}
active.topologyReadiness={operational:true,ready:true}
for(const [id,name,type] of [['junction','JB-01','Junction Box'],['pole','T-01','Pole'],['second-camera','C-02','CCTV']]){
 active.assets.push({...active.assets[1],id,assetId:name,name,type,category:type==='Pole'?'Infrastructure':'CCTV'})
 active.geometries.push({id:`point-${id}`,assetNodeId:id,geometryType:'point',coordinates:[110.418+active.assets.length*0.0001,-6.965]})
}
active.assets=active.assets.map(asset=>({...asset,id:asset.assetId}))
active.geometries=active.geometries.map(geometry=>({...geometry,assetNodeId:base.active.assets.find(asset=>asset.id===geometry.assetNodeId)?.assetId ?? {junction:'JB-01',pole:'T-01','second-camera':'C-02'}[geometry.assetNodeId] ?? geometry.assetNodeId}))
active.topologyGraph={nodes:active.assets.map(asset=>({...asset,assetId:asset.id})),edges:[{...base.active.relations[0],edgeId:'edge',relationId:'edge',sourceNodeId:'SW-01',targetNodeId:'C-01',relationKind:'device_edge',verificationStatus:'confirmed'}]}
function detail(id,payload=active){const asset=payload.assets.find(asset=>asset.id===id);return {operationalSchema:2,recordRevision:payload.recordRevision,revision:payload.revision,asset:{...asset},identity:{canonicalAssetId:id,aliasValues:[]},mountingRelations:(payload.mountingRelations||[]).filter(item=>[item.sourceAssetId,item.targetAssetId].includes(id))}}
function mutate(payload,request){
 if(request.changes){for(const change of request.changes){
  if(change.type==='remove-edge')payload.topologyGraph.edges=payload.topologyGraph.edges.filter(edge=>(edge.id||edge.edgeId)!==change.edgeId)
  if(change.type==='add-relation')payload.topologyGraph.edges.push({id:`manual-${payload.recordRevision}`,relationId:`manual-${payload.recordRevision}`,edgeId:`manual-${payload.recordRevision}`,sourceAssetId:change.sourceAssetId,targetAssetId:change.targetAssetId,sourceNodeId:change.sourceAssetId,targetNodeId:change.targetAssetId,relationKind:'device_edge',verificationStatus:'confirmed'})
  if(change.type==='mount'){payload.mountingRelations=payload.mountingRelations.filter(item=>item.sourceAssetId!==change.assetId);if(change.action==='assign')payload.mountingRelations.push({id:'mount',sourceAssetId:change.assetId,targetAssetId:change.poleAssetId,relationType:'mounted_on',provenance:'manual_admin'})}
 }}else{const asset=payload.assets.find(asset=>asset.id===request.assetId);asset.customIconUrl=request.dataUrl;asset.iconReset=false}
 payload.revision++;payload.recordRevision++;payload.context.activePointerRevision=payload.revision
 return request.changes?{recordRevision:payload.recordRevision,revision:payload.revision,graph:structuredClone(payload.topologyGraph),mountingRelations:structuredClone(payload.mountingRelations)}:{recordRevision:payload.recordRevision,revision:payload.revision}
}
module.exports={...base,active,detail,mutate}
