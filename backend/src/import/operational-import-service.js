import path from 'node:path'
import { extractKmzArchive, orderKmlCandidates } from './kmz-extractor.js'
import { parseKmlFile } from './kml-parser.js'
import { mergeKmlParserOutputs } from './kml-parser-output-merger.js'
import { buildCanonicalParserResult } from '../domain/parser-contract.js'
import { projectCanonicalImport } from './legacy-import-projection.js'
import { proposalsFromCanonical, matchAdditions, detectConnections, detectMountings, proposalAliases } from './operational-import.js'
import { key, stableKey, newId } from '../domain/operational-model.js'
import { insertRows } from '../storage/operational-repository.js'
import { AppError } from '../errors.js'

export class OperationalImportService {
  constructor({repository,fileStore,config}){Object.assign(this,{repository,fileStore,config})}
  async get(id,client=this.repository.pool,{lock=false}={}) {
    const row=(await client.query(`SELECT * FROM sinergi.imports WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0]
    if(!row) throw new AppError('Impor tidak ditemukan.',{code:'import_not_found',statusCode:404})
    return row
  }
  async process(id,{lease=null}={}) {
    const record=await this.get(id)
    if(['ready','applied'].includes(record.status))return
    if(record.status!=='processing')throw new AppError('Impor tidak sedang diproses.',{code:'import_not_processing',statusCode:409})
    const workspace=await this.fileStore.createWorkspace()
    try {
      const source=await this.fileStore.readVerifiedOriginal({storageKey:record.source_storage_key,expectedSize:Number(record.source_size),expectedChecksum:record.source_checksum})
      void source
      const sourcePath=this.fileStore.resolveOriginalPath(record.source_storage_key),extension=path.extname(record.source_filename).toLowerCase()
      let parser,resources=[],documents=[]
      if(extension==='.kmz') {
        const extracted=await extractKmzArchive(sourcePath,workspace,this.config.upload)
        const parsed=[]
        for(const candidate of orderKmlCandidates(extracted.kmlFiles)) {
          try {
            const output=await parseKmlFile(candidate.absolutePath,{...this.config.upload,folderMappings:this.config.folderMappings})
            parsed.push({relativePath:candidate.relativePath,parserOutput:output});documents.push(candidate.relativePath)
          } catch(error) {if(error.code==='unsafe_xml_declaration')throw error}
        }
        if(!parsed.length)throw new AppError('KMZ tidak berisi dokumen KML valid.',{code:'kmz_without_valid_kml',statusCode:422})
        parser=mergeKmlParserOutputs(parsed);resources=extracted.resources
      } else {parser=await parseKmlFile(sourcePath,{...this.config.upload,folderMappings:this.config.folderMappings});documents=['doc.kml']}
      const datasetVersion={id,datasetId:record.dataset_id,branchId:'global',versionName:record.name}
      const canonical=buildCanonicalParserResult({parserOutput:parser,datasetVersion,metadataAliases:this.config.metadataAliases,
        resources,sourceSelection:{selectedKmlPath:documents[0],mergedKmlPaths:documents,resources}})
      const projection=projectCanonicalImport({parserOutput:parser,canonicalParser:canonical,datasetVersion,sourceIdentityFallback:'folder-path-name'})
      const proposals=proposalsFromCanonical(canonical,projection,record.dataset_id)
      if(!proposals.length) throw new AppError('KMZ tidak berisi aset yang dapat diimpor.',{code:'empty_import',statusCode:422})
      await this.repository.transaction(async client=>{
        if(lease) {
          const owner=(await client.query("SELECT locked_by FROM sinergi.jobs WHERE import_id=$1 AND status='running' AND lock_expires_at>now() FOR UPDATE",[id])).rows[0]?.locked_by
          if(owner!==lease)throw new AppError('Job telah diambil worker lain.',{code:'job_lease_lost',statusCode:409})
        }
        const current=await this.get(id,client,{lock:true})
        if(current.status!=='processing')throw new AppError('Impor tidak sedang diproses.',{code:'import_not_processing',statusCode:409})
        const baseline=await this.repository.snapshot(record.dataset_id,{client,includeDeleted:true})
        const previous=new Map((await client.query('SELECT * FROM sinergi.import_items WHERE import_id=$1 AND decision IS NOT NULL',[id])).rows.map(i=>[i.id,i]))
        const categories=new Set((await client.query('SELECT name FROM sinergi.asset_categories')).rows.map(c=>key(c.name)))
        for(const p of proposals)p.newCategory=!categories.has(key(p.category))
        const items=matchAdditions(proposals,baseline)
        for(const item of items) {
          const prior=previous.get(`${id}:${item.id}`)
          if(prior?.decision==='skip')Object.assign(item,{status:'skipped',decision:'skip'})
          else if(prior?.decision==='match_existing'&&baseline.assets.some(a=>a.id===prior.matched_asset_id))Object.assign(item,{status:'existing',matched_asset_id:prior.matched_asset_id,decision:prior.decision})
          else if(prior?.decision==='create_new'&&['new','conflict'].includes(item.status))Object.assign(item,{status:'new',decision:prior.decision,proposal:{...item.proposal,id:prior.proposal.id}})
        }
        items.push(...detectConnections(items,baseline,{toleranceMeters:this.config.topology?.searchRadiusMeters ?? 6,inlineToleranceMeters:this.config.topology?.inlineSearchRadiusMeters ?? 2}))
        items.push(...detectMountings(items,baseline))
        const validEndpoints=new Set([...baseline.assets.filter(a=>!a.deleted).map(a=>a.id),...items.filter(i=>i.kind==='asset'&&i.status==='new').map(i=>i.proposal.id)])
        for(const item of items.filter(i=>i.kind==='relation')) {
          const prior=previous.get(`${id}:${item.id}`)
          if(prior?.decision==='skip')Object.assign(item,{status:'skipped',decision:'skip'})
          else if(prior?.decision==='connect'&&validEndpoints.has(prior.proposal.sourceAssetId)&&validEndpoints.has(prior.proposal.targetAssetId))Object.assign(item,{status:'new',decision:'connect',proposal:{...item.proposal,sourceAssetId:prior.proposal.sourceAssetId,targetAssetId:prior.proposal.targetAssetId}})
        }
        for(const item of items) {item.id=`${id}:${item.id}`;item.import_id=id}
        await client.query('DELETE FROM sinergi.import_items WHERE import_id=$1',[id]);await insertRows(client,'import_items',items)
        const summary=summarize(items)
        await client.query(`UPDATE sinergi.imports SET status='ready',base_revision=$2,summary=$3,source_manifest=$4,error=null WHERE id=$1`,
          [id,baseline.state.revision,JSON.stringify(summary),JSON.stringify({resources,documents,styles:parser.styles ?? {},overlays:canonical.sourceOverlays ?? []})])
        await this.repository.audit(client,'import.preview_ready',{actorId:record.actor_id,datasetId:record.dataset_id,importId:id,details:summary})
      })
    } finally {await this.fileStore.removeWorkspace(workspace)}
  }
  async preview(id) {
    const record=await this.get(id)
    const items=(await this.repository.pool.query('SELECT * FROM sinergi.import_items WHERE import_id=$1 ORDER BY kind,id',[id])).rows
    return {import:record,baseRevision:Number(record.base_revision),summary:record.status==='applied'?record.summary:summarize(items),items,
      additions:{assets:items.filter(i=>i.kind==='asset'&&i.status==='new').map(i=>i.proposal),relations:items.filter(i=>i.kind==='relation'&&i.status==='new').map(i=>i.proposal)},
      conflicts:items.filter(i=>['conflict','invalid'].includes(i.status))}
  }
  async decide(id,itemId,decision,actorId) {
    return this.repository.transaction(async client=>{
      const record=await this.get(id,client,{lock:true})
      if(record.status!=='ready') throw new AppError('Impor tidak dapat diedit.',{code:'import_not_ready',statusCode:409})
      const item=(await client.query('SELECT * FROM sinergi.import_items WHERE id=$1 AND import_id=$2',[itemId,id])).rows[0]
      if(!item) throw new AppError('Item tidak ditemukan.',{code:'item_not_found',statusCode:404})
      let status,matched=null,proposal=item.proposal
      if(decision.decision==='skip') status='skipped'
      else if(item.kind==='asset'&&decision.decision==='match_existing') {
        const asset=(await client.query('SELECT id,facility_id FROM sinergi.assets WHERE id=$1 AND dataset_id=$2',[decision.assetId,record.dataset_id])).rows[0]
        if(!asset) throw new AppError('Aset tujuan tidak ditemukan.',{code:'asset_not_found',statusCode:400})
        status='existing';matched=asset.id
      } else if(item.kind==='asset'&&decision.decision==='create_new'&&item.status!=='invalid') {
        status='new';proposal={...proposal,id:newId('asset')}
      } else if(item.kind==='relation'&&decision.decision==='connect') {
        status='new';proposal={...proposal,sourceAssetId:decision.sourceAssetId,targetAssetId:decision.targetAssetId}
        const baseline=await this.repository.snapshot(record.dataset_id,{client})
        const staged=(await client.query("SELECT proposal->>'id' AS id FROM sinergi.import_items WHERE import_id=$1 AND kind='asset' AND status='new'",[id])).rows
        const valid=new Set([...baseline.assets,...staged].map(a=>a.id))
        if(!valid.has(proposal.sourceAssetId)||!valid.has(proposal.targetAssetId)||proposal.sourceAssetId===proposal.targetAssetId) throw new AppError('Endpoint relasi tidak valid.',{code:'invalid_endpoint',statusCode:400})
      } else throw new AppError('Keputusan tidak valid.',{code:'invalid_decision',statusCode:400})
      await client.query('UPDATE sinergi.import_items SET status=$3,matched_asset_id=$4,decision=$5,proposal=$6 WHERE id=$1 AND import_id=$2',
        [itemId,id,status,matched,decision.decision,JSON.stringify(proposal)])
      // Recompute automatic connections after asset resolution; manually resolved
      // line decisions remain authoritative.
      if(item.kind==='asset') {
        const baseline=await this.repository.snapshot(record.dataset_id,{client,includeDeleted:true})
        const assets=(await client.query("SELECT * FROM sinergi.import_items WHERE import_id=$1 AND kind='asset'",[id])).rows
        await client.query("DELETE FROM sinergi.import_items WHERE import_id=$1 AND kind='relation' AND decision IS NULL",[id])
        const connections=[...detectConnections(assets,baseline,{toleranceMeters:this.config.topology?.searchRadiusMeters ?? 6,inlineToleranceMeters:this.config.topology?.inlineSearchRadiusMeters ?? 2}),...detectMountings(assets,baseline)].map(i=>({...i,id:`${id}:${i.id}`,import_id:id}))
        await insertRows(client,'import_items',connections)
      }
      await this.repository.audit(client,'import.item_decided',{actorId,datasetId:record.dataset_id,importId:id,details:{itemId,decision:decision.decision,assetId:matched}})
      return {ok:true}
    })
  }
  async apply(id,expectedRevision,actorId) {
    return this.repository.transaction(async client=>{
      const record=await this.get(id,client,{lock:true})
      const state=await this.repository.state(client,record.dataset_id,{lock:true})
      this.repository.assertRevision(state,expectedRevision)
      if(record.status==='applied') return {revision:Number(state.revision),alreadyApplied:true}
      if(record.status!=='ready') throw new AppError('Impor belum siap.',{code:'import_not_ready',statusCode:409})
      if(Number(record.base_revision)!==Number(state.revision)) throw new AppError('Baseline berubah; hitung ulang preview.',{code:'preview_stale',statusCode:409})
      const items=(await client.query('SELECT * FROM sinergi.import_items WHERE import_id=$1 ORDER BY id',[id])).rows
      if(items.some(i=>['conflict','invalid'].includes(i.status))) throw new AppError('Selesaikan atau lewati konflik sebelum menerapkan.',{code:'import_conflicts',statusCode:409})
      for(const item of items.filter(i=>i.kind==='asset'&&i.status==='new')) {
        const p=item.proposal,facilityId=p.facility.id ?? `facility-${stableKey(record.dataset_id,p.facility.key)}`,categoryId=`category-${stableKey(key(p.category))}`,sourceId=`source-${stableKey(id,p.source.featureId)}`
        await insertRows(client,'facilities',[{id:facilityId,dataset_id:record.dataset_id,name:p.facility.name,aliases:[p.facility.key]}])
        await insertRows(client,'asset_categories',[{id:categoryId,name:p.category,diagram_role:'endpoint'}])
        await insertRows(client,'source_objects',[{id:sourceId,import_id:id,source_feature_id:p.source.featureId,source_key:p.source.key,document_path:p.source.documentPath,
          folder_path:p.source.folderPath,name:p.name,kml_id:p.source.kmlId,fingerprint:p.source.fingerprint,geometry:p.source.geometry,parts:p.source.parts,properties:p.source.properties}])
        if((await client.query('SELECT 1 FROM sinergi.assets WHERE id=$1',[p.id])).rows.length) throw new AppError('Identitas aset bertabrakan.',{code:'identity_conflict',statusCode:409})
        await insertRows(client,'assets',[{id:p.id,dataset_id:record.dataset_id,facility_id:facilityId,category_id:categoryId,source_object_id:sourceId,name:p.name,
          kind:p.kind,properties:p.properties,deleted:false}])
      }
      for(const item of items.filter(i=>i.kind==='asset'&&['new','existing'].includes(i.status))) {
        const p=item.proposal,assetId=item.status==='existing'?item.matched_asset_id:p.id
        const asset=(await client.query('SELECT facility_id FROM sinergi.assets WHERE id=$1',[assetId])).rows[0]
        if(!asset) throw new AppError('Aset hasil pencocokan tidak tersedia.',{code:'identity_conflict',statusCode:409})
        await insertRows(client,'asset_aliases',proposalAliases(p).map(a=>({id:`alias-${stableKey(assetId,a.type,a.value)}`,asset_id:assetId,
          namespace:record.dataset_id,facility_id:asset.facility_id,match_type:a.type,match_value:a.value,active:true})))
      }
      const baseline=await this.repository.snapshot(record.dataset_id,{client,includeDeleted:true})
      for(const item of items.filter(i=>i.kind==='relation'&&i.status==='new')) {
        const p=item.proposal
        const valid=new Set(baseline.assets.filter(a=>!a.deleted).map(a=>a.id))
        if(!valid.has(p.sourceAssetId)||!valid.has(p.targetAssetId)||(p.pathAssetId&&!valid.has(p.pathAssetId))) throw new AppError('Endpoint atau jalur tambahan tidak tersedia.',{code:'invalid_endpoint',statusCode:409})
        const sourceAsset=baseline.assets.find(a=>a.id===p.sourceAssetId),targetAsset=baseline.assets.find(a=>a.id===p.targetAssetId)
        if(p.kind==='mounting'&&(sourceAsset.facility_id!==targetAsset.facility_id||targetAsset.properties.diagramRole!=='physical-mount'||sourceAsset.properties.diagramRole==='physical-mount')) throw new AppError('Mounting tidak valid.',{code:'invalid_mount',statusCode:409})
        if(p.kind==='connection'&&[sourceAsset,targetAsset].some(a=>a.properties.diagramRole==='physical-mount')) throw new AppError('Endpoint koneksi tidak valid.',{code:'invalid_endpoint',statusCode:409})
        const present=baseline.relations.some(r=>r.kind===p.kind&&(p.kind==='mounting'?r.source_asset_id===p.sourceAssetId:[r.source_asset_id,r.target_asset_id].sort().join('|')===[p.sourceAssetId,p.targetAssetId].sort().join('|')))
        if(present) continue
        await insertRows(client,'relations',[{id:p.id,dataset_id:record.dataset_id,source_asset_id:p.sourceAssetId,target_asset_id:p.targetAssetId,
          kind:p.kind,path_asset_id:p.pathAssetId,provenance:item.decision?'manual_admin':'source_geometry',protected:!!item.decision,
          deleted:false,source_refs:p.sourceRefs,properties:p.properties}])
      }
      const summary=summarize(items)
      await client.query("UPDATE sinergi.import_items SET result=result||jsonb_build_object('assetId',COALESCE(matched_asset_id,proposal->>'id')),status=CASE WHEN status='new' THEN 'applied' ELSE status END,proposal='{}' WHERE import_id=$1",[id])
      await client.query("UPDATE sinergi.imports SET status='applied',summary=$2,applied_at=now() WHERE id=$1",[id,JSON.stringify(summary)])
      await client.query('UPDATE sinergi.dataset_state SET latest_import_id=$2 WHERE id=$1',[record.dataset_id,id])
      await this.repository.audit(client,'import.applied',{actorId,datasetId:record.dataset_id,importId:id,details:summary})
      await this.repository.bump(client,record.dataset_id)
      return {datasetId:record.dataset_id,revision:Number(state.revision)+1,recordRevision:Number(state.revision)+1,summary}
    })
  }
}
export function summarize(items) {
  return {addedAssets:items.filter(i=>i.kind==='asset'&&i.status==='new').length,addedRelations:items.filter(i=>i.kind==='relation'&&i.status==='new').length,
    existingAssets:items.filter(i=>i.kind==='asset'&&i.status==='existing').length,conflicts:items.filter(i=>['conflict','invalid'].includes(i.status)).length,
    newCategories:[...new Set(items.filter(i=>i.kind==='asset'&&i.status==='new'&&i.proposal.newCategory!==false).map(i=>i.proposal.category).filter(Boolean))]}
}
