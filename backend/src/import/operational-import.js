import { key, stableKey, facilityFromPath, geometryCollection, geometryParts, kindFor, diagramRoleFor, compactProperties, relationKey } from '../domain/operational-model.js'
import {DEFAULT_FOLDER_MAPPINGS} from '../config.js'
const knownFolders=new Set(DEFAULT_FOLDER_MAPPINGS.flatMap(m=>[m.category,...m.aliases]).map(key))
const subtypeFolder=/^(extended|passive|active|regular|existing|rekomendasi|recommended|rencana|default|indoor|outdoor|fixed|fix|dome|bullet|view|assets|aset|devices|perangkat|points|titik|lokasi)(\b|$)/i

export function proposalsFromCanonical(canonical, projection, datasetId) {
  const features=new Map(canonical.sourceFeatures.map(f=>[f.sourceFeatureId,f]))
  const objects=new Map(canonical.classifiedObjects.map(o=>[o.sourceFeatureId,o]))
  return projection.assets.map(asset=>{
    const feature=features.get(asset.sourceFeatureId ?? asset.properties?.sourceFeatureId) ?? {},object=objects.get(feature.sourceFeatureId) ?? {}
    const parts=canonical.sourceGeometries.filter(g=>g.sourceFeatureId===feature.sourceFeatureId)
    const kind=kindFor(parts),facility=facilityFromPath(feature.sourceFolderPath)
    const leaf=feature.sourceFolderPath?.split('/').filter(Boolean).at(-1)
    const customFolder=kind==='device'&&leaf&&key(leaf)!==facility.key&&!knownFolders.has(key(leaf))&&!subtypeFolder.test(leaf)
    const label=key(leaf)==='printer'?'Printer':object.categoryReview?.proposedLabel ?? (customFolder?leaf:object.category ?? asset.category)
    const category=!label||['unknown','unmapped','lainnya'].includes(key(label))?'Belum dikategorikan':label
    const explicit=object.identityResolutionStatus==='stable_explicit'?object.stableAssetId ?? object.assetId:null
    const id=explicit ?? `AUTO-${stableKey(datasetId,facility.key,feature.sourceIdentityKey ?? feature.sourceFeatureId).toUpperCase()}`
    const role=object.categoryReview||customFolder ? diagramRoleFor({},kind) : diagramRoleFor(object,kind)
    return {id,name:asset.name,kind,category,diagramRole:role,facility,
      explicitId:explicit,source:{featureId:feature.sourceFeatureId,key:feature.sourceIdentityKey,
        kmlId:feature.sourceKmlId,documentPath:feature.sourceDocumentPath,folderPath:feature.sourceFolderPath,
        fingerprint:feature.sourceFingerprint,geometry:geometryCollection(parts),
        parts:parts.map(g=>({sourceGeometryId:g.geometryId,sourceCoordinateText:g.sourceCoordinateText,altitudeMode:g.altitudeMode})),
        properties:{...feature.rawProperties,metadata:Object.fromEntries((canonical.sourceMetadataEntries ?? []).filter(e=>e.sourceFeatureId===feature.sourceFeatureId).map(e=>[e.sourceKey,e.sourceValue])),sourceIconHref:feature.sourceIconHref,visibility:feature.visibility}},
      properties:{...compactProperties({...object,...asset}),diagramRole:role,
        assetType:object.assetType ?? asset.type,dynamicCategory:!!object.categoryReview||!!customFolder||key(leaf)==='printer'}}
  })
}
export function proposalAliases(proposal) {
  return [['asset_id',proposal.explicitId],['source_key',proposal.source.key],
    ['source_kml_id',proposal.source.kmlId?`${proposal.source.documentPath ?? ''}|${proposal.source.kmlId}`:null],
    ['folder_name_type',proposal.matchFolderPath?`${key(proposal.matchFolderPath)}|${key(proposal.name)}|${key(proposal.properties.assetType)}`:null],
    ['folder_name_type',`${key(proposal.source.folderPath)}|${key(proposal.name)}|${key(proposal.properties.assetType)}`]]
    .filter(([,value])=>value).map(([type,value])=>({type,value:String(value)}))
}
export function matchAdditions(proposals,baseline) {
  for(const proposal of proposals) {
    const facilities=baseline.facilities.filter(f=>[f.name,...(f.aliases ?? [])].some(name=>key(name)===proposal.facility.key))
    if(facilities.length===1) {
      const originalKey=proposal.facility.key,parts=(proposal.source.folderPath ?? '').split('/')
      const index=parts.findIndex(part=>key(part)===originalKey)
      if(index>=0){parts[index]=facilities[0].name;proposal.matchFolderPath=parts.join('/')}
      proposal.facility={...proposal.facility,id:facilities[0].id,key:key(facilities[0].name),name:facilities[0].name}
    }
  }
  const assetById=new Map(baseline.assets.map(a=>[a.id,a])),aliasIndex=new Map()
  for(const alias of baseline.aliases) {
    const asset=assetById.get(alias.asset_id)
    if(!asset) continue
    const facility=baseline.facilities.find(f=>f.id===asset.facility_id)
    const aliasKey=`${key(facility?.name)}|${alias.match_type}|${alias.match_value}`
    const values=aliasIndex.get(aliasKey) ?? new Set();values.add(asset.id);aliasIndex.set(aliasKey,values)
  }
  const duplicateKeys=new Map()
  for(const proposal of proposals) {
    const value=proposal.explicitId?`id:${proposal.explicitId}`:`${proposal.facility.key}|${proposal.source.key}`
    duplicateKeys.set(value,(duplicateKeys.get(value) ?? 0)+1)
  }
  return proposals.map(proposal=>{
    let candidates=new Set()
    if(proposal.explicitId && assetById.has(proposal.explicitId)) candidates.add(proposal.explicitId)
    for(const alias of proposalAliases(proposal)) for(const id of aliasIndex.get(`${proposal.facility.key}|${alias.type}|${alias.value}`) ?? []) candidates.add(id)
    const exact=baseline.assets.filter(a=>proposal.source.fingerprint && a.fingerprint===proposal.source.fingerprint
      && key(baseline.facilities.find(f=>f.id===a.facility_id)?.name)===proposal.facility.key)
    const exactMatch=exact.length===1 && (!proposal.explicitId||proposal.explicitId===exact[0].id)
    if(exactMatch)candidates=new Set([exact[0].id])
    const dupKey=proposal.explicitId?`id:${proposal.explicitId}`:`${proposal.facility.key}|${proposal.source.key}`
    const explicitConflict=proposal.explicitId && candidates.size && !candidates.has(proposal.explicitId)
    const facilityConflict=[...candidates].some(id=>key(baseline.facilities.find(f=>f.id===assetById.get(id).facility_id)?.name)!==proposal.facility.key)
    const invalid=!validGeometry(proposal.source.geometry)
    const conflict=candidates.size>1||(!exactMatch&&duplicateKeys.get(dupKey)>1)||explicitConflict||facilityConflict
    return {id:`item-${stableKey(proposal.source.featureId,proposal.id)}`,kind:'asset',proposal,
      status:invalid?'invalid':conflict?'conflict':candidates.size?'existing':'new',
      matched_asset_id:!conflict&&candidates.size?[...candidates][0]:null,
      reason:invalid?'invalid_geometry':conflict?'identity_conflict':null,result:{candidates:[...candidates]}}
  })
}
export function validGeometry(geometry) {
  if(!geometry) return false
  const parts=geometryParts(geometry)
  const positions=value=>Array.isArray(value)&&typeof value[0]==='number'?[value]:Array.isArray(value)?value.flatMap(positions):[]
  return parts.length>0&&parts.every(g=>{
    const coords=positions(g.coordinates)
    return coords.length>0&&coords.every(p=>p.length>=2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90)
      &&(g.type!=='LineString'||coords.length>=2)
  })
}
export function distanceMeters(a,b) {
  const radians=Math.PI/180,dLat=(b[1]-a[1])*radians,dLon=(b[0]-a[0])*radians
  const h=Math.sin(dLat/2)**2+Math.cos(a[1]*radians)*Math.cos(b[1]*radians)*Math.sin(dLon/2)**2
  return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))
}
const coordinatesFor = asset => geometryParts(asset.geometry ?? asset.source?.geometry).find(g=>g.type==='Point')?.coordinates
export function detectConnections(items,baseline,{toleranceMeters=6,inlineToleranceMeters=2}={}) {
  const devices=baseline.assets.filter(a=>!a.deleted&&a.kind==='device').map(a=>({...a,facilityKey:key(baseline.facilities.find(f=>f.id===a.facility_id)?.name)}))
  for(const item of items) if(item.kind==='asset'&&item.status==='new'&&item.proposal.kind==='device') {
    devices.push({...item.proposal,facilityKey:item.proposal.facility.key})
  }
  const newDeviceIds=new Set(items.filter(i=>i.kind==='asset'&&i.status==='new'&&i.proposal.kind==='device').map(i=>i.proposal.id))
  const newDevices=devices.filter(d=>newDeviceIds.has(d.id))
  const existing=new Set(baseline.relations.filter(r=>r.kind==='connection').map(r=>relationKey(r.source_asset_id,r.target_asset_id)))
  const results=[],seen=new Set()
  for(const item of items) {
    if(item.kind!=='asset'||!['new','existing'].includes(item.status)||item.proposal.kind!=='path') continue
    const stored=item.status==='existing'?baseline.assets.find(a=>a.id===item.matched_asset_id&&!a.deleted):null
    if(item.status==='existing'&&!stored)continue
    if(stored&&!newDevices.length)continue
    const path=stored?{...item.proposal,id:stored.id,source:{...item.proposal.source,properties:stored.source_properties ?? {},featureId:stored.source_feature_id,geometry:stored.geometry,parts:stored.parts ?? []},properties:stored.properties}:item.proposal
    for(const [index,geometry] of geometryParts(path.source.geometry).entries()) {
      if(geometry.type!=='LineString') continue
      const eligible=devices.filter(device=>device.facilityKey===path.facility.key && device.diagramRole!=='physical-mount' && device.properties?.diagramRole!=='physical-mount')
      const metadata=Object.fromEntries(Object.entries(path.source.properties?.metadata ?? {}).map(([k,v])=>[key(k).replace(/[^a-z0-9]/g,''),String(v)]))
      const references=[metadata.sourceassetid ?? metadata.fromassetid ?? metadata.sourceid ?? metadata.from,
        metadata.targetassetid ?? metadata.toassetid ?? metadata.targetid ?? metadata.to]
      const points=geometry.coordinates
      if(stored&&!newDevices.some(d=>d.facilityKey===path.facility.key&&coordinatesFor(d)&&points.some(p=>distanceMeters(p,coordinatesFor(d))<=toleranceMeters)))continue
      const waypoints=[{point:points[0],reference:references[0]}]
      // Only intermediate junction vertices form cable segments. Bends and nearby
      // endpoints do not create incidental connections.
      for(const point of points.slice(1,-1)) {
        const junctions=eligible.filter(d=>['junction-peer','junction-extended'].includes(d.diagramRole ?? d.properties?.diagramRole))
          .filter(d=>coordinatesFor(d)&&distanceMeters(point,coordinatesFor(d))<=inlineToleranceMeters)
        if(junctions.length)waypoints.push({point,candidates:junctions})
      }
      waypoints.push({point:points.at(-1),reference:references[1]})
      const candidates=waypoints.map(w=>w.candidates ?? (w.reference?eligible.filter(d=>d.id===w.reference||key(d.name)===key(w.reference)):
        eligible.filter(d=>coordinatesFor(d)&&distanceMeters(w.point,coordinatesFor(d))<=toleranceMeters)))
      for(let segment=0;segment<candidates.length-1;segment++) {
      const matches=[candidates[segment],candidates[segment+1]]
      if(stored&&!matches.some(list=>list.some(d=>newDeviceIds.has(d.id))))continue
      const ambiguous=matches.some(list=>list.length!==1)
      const source=matches[0][0]?.id,target=matches[1][0]?.id
      const pair=source&&target?relationKey(source,target):null
      if(!ambiguous&&(source===target||existing.has(pair))) continue
      if(!ambiguous&&seen.has(pair)) {
        const previous=results.find(r=>relationKey(r.proposal.sourceAssetId,r.proposal.targetAssetId)===pair)
        previous?.proposal.sourceRefs.push({featureId:path.source.featureId,geometryId:path.source.parts[index]?.sourceGeometryId})
        continue
      }
      if(pair&&!ambiguous) seen.add(pair)
      results.push({id:`connection-item-${stableKey(item.id,index,segment)}`,kind:'relation',status:ambiguous?'conflict':'new',
        reason:ambiguous?'ambiguous_line_endpoint':null,proposal:{id:`connection-${stableKey(path.id,index,segment)}`,kind:'connection',
          sourceAssetId:source ?? null,targetAssetId:target ?? null,pathAssetId:path.id,
          sourceRefs:[{featureId:path.source.featureId,geometryId:path.source.parts[index]?.sourceGeometryId}],
          properties:{networkFamily:path.properties.networkFamily ?? 'unknown',mediaType:path.properties.mediaType ?? 'unknown',serviceDomain:path.properties.serviceDomain ?? 'unknown'}},
        result:{endpointCandidates:matches.map(list=>list.map(d=>({id:d.id,name:d.name})))}})
      }
    }
  }
  return results
}
export function detectMountings(items,baseline) {
  const devices=baseline.assets.filter(a=>!a.deleted&&a.kind==='device').map(a=>({...a,facilityKey:key(baseline.facilities.find(f=>f.id===a.facility_id)?.name)}))
  devices.push(...items.filter(i=>i.kind==='asset'&&i.status==='new'&&i.proposal.kind==='device').map(i=>({...i.proposal,facilityKey:i.proposal.facility.key})))
  const result=[]
  for(const item of items.filter(i=>i.kind==='asset'&&i.status==='new'&&i.proposal.kind==='device')) {
    const p=item.proposal,role=p.diagramRole,metadata=Object.fromEntries(Object.entries(p.source.properties?.metadata ?? {}).map(([k,v])=>[key(k).replace(/[^a-z0-9]/g,''),String(v)]))
    if(role==='physical-mount')continue
    const reference=metadata.mountedon ?? metadata.poleassetid ?? metadata.mountedonassetid
    const knownMountable=['junction-peer','junction-extended'].includes(role)||key(p.category)==='cctv'
    if(!reference&&!knownMountable)continue
    const poles=devices.filter(d=>d.facilityKey===p.facility.key&&(d.diagramRole ?? d.properties?.diagramRole)==='physical-mount')
    const candidates=reference?poles.filter(d=>d.id===reference||key(d.name)===key(reference)):
      poles.filter(d=>coordinatesFor(d)&&coordinatesFor(p)&&distanceMeters(coordinatesFor(p),coordinatesFor(d))<=5)
    if(!reference&&!candidates.length)continue
    const ambiguous=candidates.length!==1
    result.push({id:`mounting-item-${stableKey(item.id)}`,kind:'relation',status:ambiguous?'conflict':'new',reason:ambiguous?'ambiguous_mounting':null,
      proposal:{id:`mounting-${stableKey(p.id)}`,kind:'mounting',sourceAssetId:p.id,targetAssetId:candidates[0]?.id ?? null,pathAssetId:null,
        sourceRefs:[{featureId:p.source.featureId}],properties:{reason:reference?'explicit_source_mounting':'unique_pole_within_5m'}},
      result:{endpointCandidates:[[{id:p.id,name:p.name}],candidates.map(d=>({id:d.id,name:d.name}))]}})
  }
  return result
}
