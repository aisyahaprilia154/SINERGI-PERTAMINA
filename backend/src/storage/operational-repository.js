import { newId, geometryParts, relationKey, facilityFromPath } from '../domain/operational-model.js'
import { AppError } from '../errors.js'

const TABLES={
  imports:['id','dataset_id','name','source_filename','source_storage_key','source_checksum','source_size','status','base_revision','actor_id','summary','source_manifest','created_at','applied_at'],
  dataset_state:['id','revision','latest_import_id','diagram_layout'], facilities:['id','dataset_id','name','aliases'],
  asset_categories:['id','name','diagram_role','default_icon'],
  source_objects:['id','import_id','source_feature_id','source_key','document_path','folder_path','name','kml_id','fingerprint','geometry','parts','properties'],
  assets:['id','dataset_id','facility_id','category_id','source_object_id','name','kind','coordinate_override','custom_icon','properties','deleted'],
  asset_aliases:['id','asset_id','namespace','facility_id','match_type','match_value','active'],
  relations:['id','dataset_id','source_asset_id','target_asset_id','kind','path_asset_id','provenance','protected','deleted','source_refs','properties'],
  import_items:['id','import_id','kind','status','matched_asset_id','decision','reason','proposal','result'],
}
const JSON_COLUMNS=new Set(['diagram_layout','summary','source_manifest','parts','properties','custom_icon','source_refs','proposal','result'])
const GEOMETRY_COLUMNS=new Set(['geometry','coordinate_override'])

export async function insertRows(client,table,rows) {
  if (!TABLES[table]) throw new TypeError('Unknown operational table.')
  if (!rows.length) return
  for(let offset=0;offset<rows.length;offset+=100) {
    const batch=rows.slice(offset,offset+100),columns=TABLES[table].filter(k=>batch.some(r=>r[k]!==undefined)),values=[]
    const tuples=batch.map(row=>`(${columns.map(column=>{
      const value=row[column] ?? null
      values.push(JSON_COLUMNS.has(column)||GEOMETRY_COLUMNS.has(column)?value===null?null:JSON.stringify(value):value)
      const parameter=`$${values.length}`
      return GEOMETRY_COLUMNS.has(column)?`ST_SetSRID(ST_GeomFromGeoJSON(${parameter}),4326)`:JSON_COLUMNS.has(column)?`${parameter}::jsonb`:parameter
    }).join(',')})`)
    await client.query(`INSERT INTO sinergi.${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ON CONFLICT(id) DO NOTHING`,values)
  }
}
export class OperationalRepository {
  constructor(pool){this.pool=pool;this.views=new Map()}
  async readView(datasetId) {
    const state=await this.state(this.pool,datasetId),cached=this.views.get(datasetId)
    if(cached&&cached.snapshot.state.revision===state.revision)return cached
    const snapshot=await this.snapshot(datasetId),result={snapshot,view:snapshotToView(snapshot)}
    this.views.delete(datasetId);this.views.set(datasetId,result)
    if(this.views.size>4)this.views.delete(this.views.keys().next().value)
    return result
  }
  async transaction(operation,{readOnly=false}={}) {
    const client=await this.pool.connect()
    try {
      await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN')
      const result=await operation(client); await client.query('COMMIT'); return result
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error}
    finally {client.release()}
  }
  async audit(client,event,{actorId=null,datasetId=null,importId=null,details={}}={}) {
    await client.query('INSERT INTO sinergi.audit_events(id,event,actor_id,dataset_id,import_id,details) VALUES($1,$2,$3,$4,$5,$6)',
      [newId('audit'),event,actorId,datasetId,importId,JSON.stringify(details)])
  }
  async state(client,datasetId,{lock=false}={}) {
    const state=(await client.query(`SELECT * FROM sinergi.dataset_state WHERE id=$1${lock?' FOR UPDATE':''}`,[datasetId])).rows[0]
    if(!state) throw new AppError('Dataset tidak ditemukan.',{code:'dataset_not_found',statusCode:404})
    return state
  }
  assertRevision(state,expected) {
    if(!Number.isSafeInteger(expected) || expected!==Number(state.revision)) {
      throw new AppError('Data berubah. Muat ulang sebelum menyimpan.',{code:'revision_conflict',statusCode:409})
    }
  }
  async bump(client,datasetId){await client.query('UPDATE sinergi.dataset_state SET revision=revision+1,updated_at=now() WHERE id=$1',[datasetId])}
  async snapshot(datasetId,{client=null,includeDeleted=false}={}) {
    if(!client) return this.transaction(c=>this.snapshot(datasetId,{client:c,includeDeleted}),{readOnly:true})
    const state=await this.state(client,datasetId)
    const assets=(await client.query(`SELECT a.*,c.name AS category,c.diagram_role,f.name AS facility_name,s.import_id AS source_import_id,s.folder_path,s.source_feature_id,s.source_key,s.document_path,s.kml_id,s.fingerprint,s.parts,s.properties AS source_properties,
      ST_AsGeoJSON(COALESCE(a.coordinate_override,s.geometry),15)::jsonb AS geometry
      FROM sinergi.assets a JOIN sinergi.asset_categories c ON c.id=a.category_id LEFT JOIN sinergi.facilities f ON f.id=a.facility_id
      LEFT JOIN sinergi.source_objects s ON s.id=a.source_object_id WHERE a.dataset_id=$1 ${includeDeleted?'':'AND NOT a.deleted'} ORDER BY a.id`,[datasetId])).rows
    const allRelations=(await client.query('SELECT * FROM sinergi.relations WHERE dataset_id=$1 ORDER BY id',[datasetId])).rows
    const relations=includeDeleted?allRelations:allRelations.filter(r=>!r.deleted)
    const facilities=(await client.query('SELECT * FROM sinergi.facilities WHERE dataset_id=$1 ORDER BY name',[datasetId])).rows
    const aliases=(await client.query('SELECT x.* FROM sinergi.asset_aliases x JOIN sinergi.assets a ON a.id=x.asset_id WHERE a.dataset_id=$1 AND x.active',[datasetId])).rows
    const latest=state.latest_import_id?(await client.query('SELECT * FROM sinergi.imports WHERE id=$1',[state.latest_import_id])).rows[0]:null
    const sourceImports=(await client.query("SELECT id,source_manifest FROM sinergi.imports WHERE id=ANY($1::text[]) OR (dataset_id=$2 AND status='applied') ORDER BY created_at",[[...new Set(assets.map(a=>a.source_import_id).filter(Boolean))],datasetId])).rows
    return {state,assets,relations,deletedRelations:allRelations.filter(r=>r.deleted),facilities,aliases,latest,sourceImports}
  }
  async saveIcon({datasetId,assetId,expectedRevision,dataUrl,actorId}) {
    if(dataUrl!==null && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)||dataUrl.length>2*1024*1024)) {
      throw new AppError('Ikon harus PNG, JPEG, atau WebP, maksimum 2 MB.',{code:'invalid_icon',statusCode:400})
    }
    return this.transaction(async client=>{
      const state=await this.state(client,datasetId,{lock:true});this.assertRevision(state,expectedRevision)
      const result=await client.query('UPDATE sinergi.assets SET custom_icon=$3,updated_at=now() WHERE dataset_id=$1 AND id=$2 AND NOT deleted RETURNING id',
        [datasetId,assetId,dataUrl?JSON.stringify({dataUrl}):null])
      if(!result.rows.length) throw new AppError('Aset tidak ditemukan.',{code:'asset_not_found',statusCode:404})
      await this.audit(client,'asset.icon_changed',{actorId,datasetId,details:{assetId,custom:!!dataUrl}})
      await this.bump(client,datasetId);return {recordRevision:Number(state.revision)+1,revision:Number(state.revision)+1}
    })
  }
  async saveDiagram({datasetId,expectedRevision,changes,actorId}) {
    if(!Array.isArray(changes)||!changes.length||changes.length>200) throw new AppError('Perubahan diagram tidak valid.',{code:'invalid_diagram_changes',statusCode:400})
    return this.transaction(async client=>{
      const state=await this.state(client,datasetId,{lock:true});this.assertRevision(state,expectedRevision)
      const layout=structuredClone(state.diagram_layout),snapshot=await this.snapshot(datasetId,{client}),assets=new Map(snapshot.assets.map(a=>[a.id,a]))
      const device=id=>{
        const asset=assets.get(id)
        if(!asset||asset.kind!=='device') throw new AppError('Aset perangkat tidak ditemukan.',{code:'asset_not_found',statusCode:400})
        return asset
      }
      const mount=async(assetId,poleId)=>{
        const asset=device(assetId),pole=poleId?device(poleId):null
        if(pole&&(pole.properties.diagramRole!=='physical-mount'||assetId===poleId||asset.facility_id!==pole.facility_id)) throw new AppError('Tiang pemasangan tidak valid.',{code:'invalid_mount',statusCode:400})
        await client.query("UPDATE sinergi.relations SET deleted=true,protected=true,updated_at=now() WHERE dataset_id=$1 AND source_asset_id=$2 AND kind='mounting'",[datasetId,assetId])
        if(pole) await insertRows(client,'relations',[{id:newId('mount'),dataset_id:datasetId,source_asset_id:assetId,target_asset_id:poleId,kind:'mounting',
          provenance:'manual_admin',protected:true,deleted:false,source_refs:[],properties:{}}])
        await client.query("UPDATE sinergi.assets SET properties=properties||jsonb_build_object('mountingExpectation',$3::text),updated_at=now() WHERE dataset_id=$1 AND id=$2",[datasetId,assetId,pole?'pole':'standalone'])
      }
      for(const change of changes) {
        if(change.type==='add-relation') {
          const source=device(change.sourceAssetId),target=device(change.targetAssetId)
          if(source.id===target.id||[source,target].some(a=>a.properties.diagramRole==='physical-mount')) throw new AppError('Endpoint koneksi tidak valid.',{code:'invalid_endpoint',statusCode:400})
          const existing=(await client.query("SELECT id FROM sinergi.relations WHERE dataset_id=$1 AND kind='connection' AND NOT deleted AND ((source_asset_id=$2 AND target_asset_id=$3) OR (source_asset_id=$3 AND target_asset_id=$2))",[datasetId,source.id,target.id])).rows
          if(!existing.length) await insertRows(client,'relations',[{id:newId('connection'),dataset_id:datasetId,source_asset_id:source.id,target_asset_id:target.id,
            kind:'connection',provenance:'manual_admin',protected:true,deleted:false,source_refs:[],properties:{direction:'undirected'}}])
        } else if(['remove-edge','remove-relation'].includes(change.type)) {
          const result=change.edgeId||change.relationId
            ?await client.query("UPDATE sinergi.relations SET deleted=true,protected=true,properties=properties||'{\"removedByAdmin\":true}'::jsonb,updated_at=now() WHERE dataset_id=$1 AND id=$2 AND kind='connection' AND NOT deleted RETURNING id",[datasetId,change.edgeId ?? change.relationId])
            :await client.query("UPDATE sinergi.relations SET deleted=true,protected=true,properties=properties||'{\"removedByAdmin\":true}'::jsonb,updated_at=now() WHERE dataset_id=$1 AND kind='connection' AND NOT deleted AND ((source_asset_id=$2 AND target_asset_id=$3) OR (source_asset_id=$3 AND target_asset_id=$2)) RETURNING id",[datasetId,change.sourceAssetId,change.targetAssetId])
          if(!result.rows.length) throw new AppError('Relasi tidak ditemukan; muat ulang diagram.',{code:'relation_not_found',statusCode:409})
        } else if(change.type==='mount') await mount(change.assetId,change.action==='detach'?null:change.poleAssetId)
        else if(change.type==='move-frame') {
          device(change.assetId)
          const frameId=change.frameId
          if(frameId&&!/^(pole-group|excluded-mounting|junction-endpoints|needs-mounting|unassigned-mounting):.{1,200}$/.test(frameId)) throw new AppError('Frame tidak valid.',{code:'invalid_frame',statusCode:400})
          if(frameId?.startsWith('pole-group:')) await mount(change.assetId,frameId.slice('pole-group:'.length))
          else if(frameId?.startsWith('excluded-mounting:')) await mount(change.assetId,null)
          layout.topologyFrameAssignments ??= {}
          if(frameId) layout.topologyFrameAssignments[change.assetId]=frameId;else delete layout.topologyFrameAssignments[change.assetId]
        } else if(change.type==='create-frame') {
          const frame=change.frame
          if(!frame||!['indoor','non-pole','pole'].includes(frame.type)||!/^((excluded-mounting:.+:custom:)|(pole-group:)).{1,200}$/.test(frame.id)||!frame.areaKey) throw new AppError('Frame tidak valid.',{code:'invalid_frame',statusCode:400})
          if(frame.type==='pole') {const pole=device(frame.poleAssetId);if(pole.properties.diagramRole!=='physical-mount') throw new AppError('Frame tiang tidak valid.',{code:'invalid_mount',statusCode:400})}
          layout.topologyFrames ??= {};layout.topologyFrames[frame.id]={...frame,name:String(frame.name ?? '').slice(0,80)}
        } else if(change.type==='rename-frame') {
          const frameId=change.frameId ?? (change.assetId?`pole-group:${device(change.assetId).id}`:null)
          if(typeof frameId!=='string'||!frameId.includes(':')) throw new AppError('Frame tidak valid.',{code:'invalid_frame',statusCode:400})
          layout.topologyFrameNames ??= {};layout.topologyFrameNames[frameId]=String(change.name ?? change.frameName ?? '').trim().slice(0,80)
        } else if(change.type==='move-node') {
          device(change.assetId)
          if(!Number.isFinite(change.x)||!Number.isFinite(change.y)) throw new AppError('Posisi diagram tidak valid.',{code:'invalid_position',statusCode:400})
          layout.nodePositions ??= {};layout.nodePositions[change.assetId]={x:change.x,y:change.y}
        } else if(change.type==='assign-root') {
          const root=device(change.rootAssetId),asset=device(change.assetId)
          if(root.properties.diagramRole!=='rack-root'||root.facility_id!==asset.facility_id) throw new AppError('Root diagram tidak valid.',{code:'invalid_root',statusCode:400})
          layout.topologyRootAssignments ??= {};layout.topologyRootAssignments[asset.id]=root.id
        } else throw new AppError('Jenis perubahan tidak valid.',{code:'invalid_diagram_change',statusCode:400})
      }
      await client.query('UPDATE sinergi.dataset_state SET diagram_layout=$2 WHERE id=$1',[datasetId,JSON.stringify(layout)])
      await this.audit(client,'diagram.saved',{actorId,datasetId,details:{changes}});await this.bump(client,datasetId)
      const view=snapshotToView(await this.snapshot(datasetId,{client}))
      return {revision:view.revision,recordRevision:view.revision,graph:view.topologyGraph,mountingRelations:view.mountingRelations,...layout}
    })
  }
}

export function snapshotToView(snapshot) {
  const {state,assets,latest}=snapshot,relations=snapshot.relations.filter(r=>!r.deleted),geometries=[],layers=new Map()
  const activePaths=new Set(relations.filter(r=>r.kind==='connection').map(r=>r.path_asset_id).filter(Boolean))
  const removedPaths=new Set((snapshot.deletedRelations ?? []).filter(r=>r.kind==='connection'&&r.properties.removedByAdmin&&!activePaths.has(r.path_asset_id)).map(r=>r.path_asset_id).filter(Boolean))
  const outputAssets=assets.map(asset=>{
    const folder=asset.folder_path ?? '/',layerId=`layer:${folder}`
    layers.set(layerId,{id:layerId,name:folder.split('/').filter(Boolean).at(-1) ?? asset.facility_name,sourceFolderPath:folder,defaultVisible:true,category:asset.category})
    geometryParts(asset.geometry).forEach((g,index)=>geometries.push({id:asset.parts?.[index]?.id ?? `geometry:${asset.id}:${index}`,assetNodeId:asset.id,
      sourceFeatureId:asset.source_feature_id,sourceGeometryId:asset.parts?.[index]?.sourceGeometryId,
      altitudeMode:asset.parts?.[index]?.altitudeMode,
      geometryType:({Point:'point',LineString:'line_string',Polygon:'polygon',MultiPoint:'multi_point',MultiLineString:'multi_line_string',MultiPolygon:'multi_polygon'})[g.type] ?? g.type,
      coordinates:g.coordinates}))
    const role=asset.properties.diagramRole ?? asset.diagram_role
    const resources=snapshot.sourceImports?.find(i=>i.id===asset.source_import_id)?.source_manifest?.resources ?? []
    const href=asset.source_properties?.sourceIconHref ?? asset.properties.sourceIconHref
    const decode=value=>{try{return decodeURIComponent(value)}catch{return value}}
    const resource=resources.find(r=>[r.relativePath,r.path,r.archivePath,r.href,...(r.relativePaths ?? [])].some(p=>p&&decode(p)===decode(href)))
    const sourceIconUrl=resource?`/api/imports/${encodeURIComponent(resource.originDatasetVersionId ?? asset.source_import_id)}/source-resources/${encodeURIComponent(resource.resourceId)}`:null
    return {id:asset.id,assetId:asset.id,canonicalAssetId:asset.id,stableAssetId:asset.id,name:asset.name,category:asset.category,
      categoryId:asset.category_id,facilityId:asset.facility_id,facilityName:asset.facility_name,
      ...asset.properties,...(removedPaths.has(asset.id)?{mapVisible:false,relationPathRemoved:true}:{}),diagramRole:role,diagramClass:role,identityStatus:'stable',sourceFeatureId:asset.source_feature_id,
      sourceFolderPath:folder,layerId,objectRole:asset.kind==='device'?'device_node':asset.kind==='path'?'cable_path':'visual_only',
      coordinate:geometryParts(asset.geometry).find(g=>g.type==='Point')?.coordinates ?? null,
      geometries:geometryParts(asset.geometry).map((g,index)=>({id:asset.parts?.[index]?.id ?? `geometry:${asset.id}:${index}`,geometryType:({Point:'point',LineString:'line_string',Polygon:'polygon'})[g.type],coordinates:g.coordinates,valid:true})),
      properties:{...asset.source_properties,...asset.properties,sourceFeatureId:asset.source_feature_id,
        classification:{...asset.properties,diagramClass:role,assetType:asset.properties.assetType ?? asset.category},
        customIcon:asset.custom_icon},customIcon:asset.custom_icon,customIconUrl:asset.custom_icon?.dataUrl ?? null,sourceIconUrl}
  })
  const ids=new Set(outputAssets.map(a=>a.id))
  const edges=relations.filter(r=>r.kind==='connection'&&ids.has(r.source_asset_id)&&ids.has(r.target_asset_id)).map(r=>({id:r.id,relationId:r.id,
    sourceAssetId:r.source_asset_id,targetAssetId:r.target_asset_id,sourceNodeId:r.source_asset_id,targetNodeId:r.target_asset_id,
    relationType:'connected-to',relationKind:'device_edge',verificationStatus:'confirmed',provenance:r.provenance,
    pathAssetIds:r.path_asset_id?[r.path_asset_id]:[],sourceGeometryIds:r.source_refs.map(ref=>ref.geometryId).filter(Boolean),...r.properties}))
  const mounting=relations.filter(r=>r.kind==='mounting'&&ids.has(r.source_asset_id)&&ids.has(r.target_asset_id)).map(r=>({id:r.id,relationId:r.id,
    sourceAssetId:r.source_asset_id,targetAssetId:r.target_asset_id,relationType:'mounted_on',relationKind:'installation_attachment',verificationStatus:'confirmed',provenance:r.provenance}))
  return {operationalSchema:2,datasetId:state.id,revision:Number(state.revision),recordRevision:Number(state.revision),
    datasetVersion:{id:latest?.id ?? state.id,datasetId:state.id,versionName:latest?.name ?? 'SINERGI',sourceFilename:latest?.source_filename,status:'active'},
    context:{datasetId:state.id,datasetVersionId:latest?.id ?? state.id,activePointerRevision:Number(state.revision)},
    assets:outputAssets,geometries,layers:[...layers.values()],relations:[...edges,...mounting],mountingRelations:mounting,
    mountingExpectations:assets.map(a=>({assetId:a.id,expectation:a.properties.mountingExpectation ?? 'unknown'})),
    topologyGraph:{nodes:outputAssets.filter(a=>a.objectRole==='device_node').map(a=>({...a,assetId:a.id})),edges,removedPathAssetIds:[...removedPaths],revision:String(state.revision),graphRevision:String(state.revision)},
    topologyRoots:outputAssets.filter(a=>a.diagramRole==='rack-root').map(a=>({id:a.id,assetId:a.id,rootAssetId:a.id,name:a.name,verified:true})),
    topologyReadiness:{ready:true,operational:true},...state.diagram_layout,
    overlays:[...new Map((snapshot.sourceImports ?? []).flatMap(i=>(i.source_manifest?.overlays ?? []).map(o=>({...o,originDatasetVersionId:o.originDatasetVersionId ?? i.id,
      resourceUrl:`/api/imports/${encodeURIComponent(o.originDatasetVersionId ?? i.id)}/overlay-resources/${encodeURIComponent(o.resourceId)}`,
      bounds:o.bounds ?? o.latLonBox,siteId:snapshot.facilities.find(f=>f.aliases.includes(facilityFromPath(o.sourceFolderPath).key))?.id ?? null}))).map(o=>[o.sourceFeatureKey ?? o.sourceOverlayId ?? o.id ?? JSON.stringify(o),o])).values()],
    sites:snapshot.facilities.map(f=>({siteId:f.id,id:f.id,name:f.name})),
    capabilities:{map:true,topologyDiagram:true,topologyTrace:false,topologyImpact:false},
    summary:{totalAssets:assets.length,totalRelations:edges.length,totalFacilities:snapshot.facilities.length}}
}
