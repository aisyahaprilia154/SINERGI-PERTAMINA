import { createHash, randomUUID } from 'node:crypto'

export const key = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id')
export const stableKey = (...values) => createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0,24)
export const newId = prefix => `${prefix}-${randomUUID()}`
export function facilityFromPath(folderPath) {
  const parts = String(folderPath ?? '').replaceAll('\\','/').split('/').filter(Boolean)
  const root = parts.findIndex(part => key(part) === 'rjbt')
  const name = parts[root >= 0 ? root + 1 : 0] || 'Tanpa fasilitas'
  return { key: key(name), name }
}
export function geometryType(type) {
  return ({point:'Point',line_string:'LineString',linestring:'LineString',polygon:'Polygon',multi_point:'MultiPoint',multi_line_string:'MultiLineString',multi_polygon:'MultiPolygon'})[key(type)] ?? type
}
export function geometryCollection(parts) {
  const geometries = parts.filter(part => part.coordinates).map(part => ({type:geometryType(part.geometryType ?? part.type),coordinates:part.coordinates}))
  return geometries.length === 1 ? geometries[0] : geometries.length ? {type:'GeometryCollection',geometries} : null
}
export function geometryParts(geometry) {
  if (!geometry) return []
  return geometry.type === 'GeometryCollection' ? geometry.geometries.flatMap(geometryParts) : [geometry]
}
export const kindFor = parts => parts.some(p => geometryType(p.geometryType ?? p.type) === 'Point') ? 'device'
  : parts.some(p => /Line/.test(geometryType(p.geometryType ?? p.type))) ? 'path'
    : parts.some(p => /Polygon/.test(geometryType(p.geometryType ?? p.type))) ? 'area' : 'annotation'
export function diagramRoleFor(asset, kind = 'device') {
  if (kind !== 'device') return kind === 'path' ? 'path' : 'area'
  const explicit = asset.diagramRole ?? asset.diagramClass
  if (['rack-root','junction-peer','junction-extended','physical-mount','endpoint'].includes(explicit)) return explicit
  return 'endpoint'
}
export function relationKey(source, target, kind = 'connection') {
  return `${kind}:${kind === 'mounting' ? [source,target].join('|') : [source,target].sort().join('|')}`
}
export function compactProperties(item) {
  const allowed = ['type','assetType','canonicalAssetType','objectRole','topologyRole','networkFamily','serviceDomain','mediaType','cableRole','sourceStatus','sourceIconHref','sourceIconUrl','sourceStyleId','resolvedStyleId','location','description','visibility','sourceFolderPath','legacyAssetId','mountingExpectation']
  return Object.fromEntries(allowed.filter(k => item[k] !== undefined).map(k => [k,item[k]]))
}

// Called only by the migration. Effective map/diagram relationships are supplied
// after the legacy read corrections; runtime never reapplies facility facts.
export function materializeBaseline({record,catalog,map}) {
  const datasetId=record.datasetVersion.datasetId
  const sourceById=new Map((record.sourceFeatures ?? []).map(f=>[f.sourceFeatureId,f]))
  const geosByFeature=new Map()
  for (const g of record.sourceGeometries ?? []) {
    const list=geosByFeature.get(g.sourceFeatureId) ?? []; list.push(g); geosByFeature.set(g.sourceFeatureId,list)
  }
  const facilities=new Map(), categories=new Map(), sources=new Map(), assets=[], aliases=[]
  const expectations=new Map((record.mountingExpectations ?? []).map(x=>[x.assetId,x.expectation]))
  const visibleGeometryIds=new Set((map.geometries ?? []).map(g=>g.id))
  for (const item of catalog) {
    const facility=facilityFromPath(item.sourceFolderPath), facilityId=`facility-${stableKey(datasetId,facility.key)}`
    facilities.set(facilityId,{id:facilityId,dataset_id:datasetId,name:facility.name,aliases:[facility.key]})
    const kind=kindFor(item.geometries), role=diagramRoleFor(item,kind)
    const label=item.category || 'Belum dikategorikan', categoryId=`category-${stableKey(key(label),role)}`
    // Existing Infrastructure contains poles and roots. Categories describe the
    // vocabulary; each asset retains its explicit role in properties.
    const idForName=`category-${stableKey(key(label))}`
    categories.set(idForName,{id:idForName,name:label,diagram_role:'endpoint'})
    const feature=sourceById.get(item.sourceFeatureId) ?? {}
    const sourceId=`source-${stableKey(datasetId,item.sourceFeatureId ?? item.canonicalAssetId)}`
    const parts=geosByFeature.get(item.sourceFeatureId) ?? item.geometries
    const geometry=geometryCollection(parts)
    sources.set(sourceId,{id:sourceId,import_id:record.datasetVersion.id,source_feature_id:item.sourceFeatureId ?? item.canonicalAssetId,
      source_key:feature.sourceIdentityKey ?? item.rawAsset?.sourceMatchValue ?? null,document_path:feature.sourceDocumentPath ?? null,
      folder_path:item.sourceFolderPath,name:feature.sourceName ?? item.name,kml_id:feature.sourceKmlId ?? null,
      fingerprint:feature.sourceFingerprint ?? null,geometry,
      parts:parts.map((g,index)=>({id:item.geometries[index]?.id ?? g.id,sourceGeometryId:g.sourceGeometryId ?? g.geometryId,sourceCoordinateText:g.sourceCoordinateText,altitudeMode:g.altitudeMode})),
      properties:{...(feature.rawProperties ?? {}),metadata:Object.fromEntries((record.sourceMetadataEntries ?? []).filter(e=>e.sourceFeatureId===item.sourceFeatureId).map(e=>[e.sourceKey,e.sourceValue])),sourceIconHref:feature.sourceIconHref,visibility:feature.visibility}})
    const effective=geometryCollection(item.geometries)
    assets.push({id:item.canonicalAssetId,dataset_id:datasetId,facility_id:facilityId,category_id:idForName,source_object_id:sourceId,name:item.name,kind,
      coordinate_override:JSON.stringify(effective)===JSON.stringify(geometry) ? null : effective,
      custom_icon:record.assetIconOverrides?.[item.canonicalAssetId] ?? null,
      properties:{...compactProperties(item.rawAsset?.properties ?? {}),...compactProperties(item),diagramRole:role,nodeId:item.nodeId,
        mapVisible:kind==='device'||item.geometries.some(g=>visibleGeometryIds.has(g.id)),
        mountingExpectation:expectations.get(item.canonicalAssetId) ?? 'unknown'},deleted:false})
    const namespace=datasetId
    const values=[['asset_id',item.canonicalAssetId],['node_id',item.nodeId],['source_feature_id',item.sourceFeatureId],['source_key',feature.sourceIdentityKey],
      ['source_kml_id',feature.sourceKmlId ? `${feature.sourceDocumentPath ?? ''}|${feature.sourceKmlId}` : null],
      ['folder_name_type',`${key(item.sourceFolderPath)}|${key(item.name)}|${key(item.assetType)}`],
      ...Object.entries(item.identityAliases ?? {}).flatMap(([type,list])=>(Array.isArray(list)?list:[]).map(value=>[type,value]))]
    for (const [type,value] of values) if (value) aliases.push({id:`alias-${stableKey(item.canonicalAssetId,type,value)}`,asset_id:item.canonicalAssetId,
      namespace,facility_id:facilityId,match_type:type,match_value:String(value),active:true})
  }
  const valid=new Set(assets.map(a=>a.id)), relations=new Map()
  for(const entry of record.identityRegistry ?? []) {
    if(entry.status!=='active'||!valid.has(entry.assetId)||!entry.sourceMatchValue)continue
    const type=entry.sourceMatchType==='source_feature_key'?'source_key':entry.sourceMatchType
    const asset=assets.find(a=>a.id===entry.assetId)
    aliases.push({id:`alias-${stableKey(entry.assetId,type,entry.sourceMatchValue)}`,asset_id:entry.assetId,
      namespace:entry.branchId ?? datasetId,facility_id:asset.facility_id,match_type:type,match_value:String(entry.sourceMatchValue),active:true})
  }
  const insert=(r,kind,deleted=false)=>{
    const source=r.sourceAssetId ?? r.sourceNodeId ?? r.assetId,target=r.targetAssetId ?? r.targetNodeId
    if (!valid.has(source)||!valid.has(target)||source===target) return
    const pair=relationKey(source,target,kind),entryKey=deleted?`deleted:${r.edgeId ?? stableKey(r.edgeKey,pair)}`:pair
    if (!relations.has(entryKey)) relations.set(entryKey,{id:deleted?`deleted-${stableKey(entryKey)}`:r.id ?? r.relationId ?? `relation-${stableKey(pair)}`,dataset_id:datasetId,
      source_asset_id:source,target_asset_id:target,kind,path_asset_id:(r.pathAssetIds ?? []).find(id=>valid.has(id)) ?? null,
      provenance:r.provenance ?? r.relationSource ?? 'legacy',protected:deleted || /manual|correction/.test(r.provenance ?? ''),deleted,
      source_refs:(r.sourceGeometryIds ?? []).map(id=>({geometryId:id})),
      properties:{...compactProperties(r),reason:r.reason ?? null,direction:r.direction ?? 'undirected'}})
  }
  for (const r of map.topologyGraph?.edges ?? []) insert(r,'connection')
  for (const r of map.mountingRelations ?? []) insert(r,'mounting')
  for (const r of record.topologyEdgeOverrides ?? []) if (r.action==='remove'||r.removed===true||r.deleted===true) insert(r,'connection',true)
  return {dataset:{id:datasetId,revision:Number(record.recordRevision ?? 0),latest_import_id:record.datasetVersion.id,
    diagram_layout:Object.fromEntries(['topologyFrameNames','topologyFrameAssignments','topologyFrames','topologyRootAssignments'].map(k=>[k,record[k] ?? {}]))},
    facilities:[...facilities.values()],categories:[...categories.values()],sources:[...sources.values()],assets,aliases,relations:[...relations.values()]}
}
