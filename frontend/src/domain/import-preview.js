export function previewMapPayload(preview,baseline,context) {
  const payload={...baseline,assets:context?[...baseline.assets]:[],geometries:context?[...baseline.geometries]:[],layers:[...baseline.layers],mountingRelations:context?[...baseline.mountingRelations]:[],topologyGraph:{nodes:[],edges:[]}}
  const parts=geometry=>geometry?.type==='GeometryCollection'?geometry.geometries.flatMap(parts):geometry?[geometry]:[]
  for(const p of preview.additions.assets) {
    const layerId=`preview:${p.facility.key}:${p.category}`
    payload.layers.push({id:layerId,name:p.category,sourceFolderPath:p.source.folderPath,defaultVisible:true})
    payload.assets.push({id:p.id,assetId:p.id,canonicalAssetId:p.id,name:p.name,type:p.properties.assetType,category:p.category,dynamicCategory:p.properties.dynamicCategory,
      diagramRole:p.diagramRole,diagramClass:p.diagramRole,facilityId:p.facility.key,sourceFolderPath:p.source.folderPath,layerId,objectRole:p.kind==='device'?'device_node':'cable_path',properties:{classification:{...p.properties,diagramClass:p.diagramRole}}})
    parts(p.source.geometry).forEach((g,index)=>payload.geometries.push({id:`preview:${p.id}:${index}`,assetNodeId:p.id,geometryType:({Point:'point',LineString:'line_string',Polygon:'polygon'})[g.type],coordinates:g.coordinates}))
  }
  payload.topologyGraph.nodes=payload.assets.filter(a=>a.objectRole==='device_node').map(a=>({...a,assetId:a.id}))
  const ids=new Set(payload.assets.map(a=>a.id))
  payload.topologyGraph.edges=preview.additions.relations.filter(r=>r.kind!=='mounting'&&ids.has(r.sourceAssetId)&&ids.has(r.targetAssetId)).map(r=>({...r,sourceNodeId:r.sourceAssetId,targetNodeId:r.targetAssetId,relationType:'connected-to',verificationStatus:'confirmed'}))
  payload.mountingRelations.push(...preview.additions.relations.filter(r=>r.kind==='mounting').map(r=>({...r,relationType:'mounted_on',verificationStatus:'confirmed'})))
  return payload
}
