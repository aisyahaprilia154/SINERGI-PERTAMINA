import {createHash} from 'node:crypto'
import {gzip,gunzip} from 'node:zlib'
import {promisify} from 'node:util'
import {newId} from '../domain/operational-model.js'
import {AppError} from '../errors.js'

const compress=promisify(gzip),decompress=promisify(gunzip)
export const CHECKPOINT_LIMIT=10
const META='id,dataset_id,name,actor_id,source_revision,created_at,reason,summary,compressed_size'
const JSON_FIELDS=new Set(['properties','custom_icon','parts','source_refs'])
const GEOMETRIES=new Set(['geometry','coordinate_override'])
const COLUMNS={
  facilities:['id','dataset_id','name','aliases'],
  asset_categories:['id','name','diagram_role','default_icon'],
  source_objects:['id','import_id','source_feature_id','source_key','document_path','folder_path','name','kml_id','fingerprint','geometry','parts','properties'],
  assets:['id','dataset_id','facility_id','category_id','source_object_id','name','kind','coordinate_override','custom_icon','properties','deleted','created_at','updated_at'],
  asset_aliases:['id','asset_id','namespace','facility_id','match_type','match_value','active'],
  relations:['id','dataset_id','source_asset_id','target_asset_id','kind','path_asset_id','provenance','protected','deleted','source_refs','properties','updated_at'],
}
export function canonicalJson(value) {
  if(value instanceof Date)return JSON.stringify(value.toISOString())
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
export async function encodeCheckpoint(payload) {
  const raw=Buffer.from(canonicalJson(payload))
  return {bytes:await compress(raw),checksum:createHash('sha256').update(raw).digest('hex'),rawSize:raw.length}
}
export async function decodeCheckpoint(row,datasetId) {
  try {
    if(row.format_version!==1)throw new Error('format')
    const raw=await decompress(row.payload,{maxOutputLength:512*1024*1024})
    if(raw.length!==Number(row.raw_size)||createHash('sha256').update(raw).digest('hex')!==row.checksum)throw new Error('checksum')
    const payload=JSON.parse(raw)
    if(payload.format!==1||payload.datasetId!==datasetId||!payload.state||!Array.isArray(payload.state.active_import_ids))throw new Error('dataset')
    for(const field of ['facilities','categories','sources','assets','aliases','relations','imports'])if(!Array.isArray(payload[field]))throw new Error(field)
    for(const field of ['facilities','assets','relations'])if(payload[field].some(r=>r.dataset_id!==datasetId))throw new Error('scope')
    return payload
  } catch {
    throw new AppError('Versi rusak atau formatnya tidak didukung. Data aktif tidak berubah.',{code:'checkpoint_invalid',statusCode:422})
  }
}
async function upsert(client,table,rows,{immutable=false}={}) {
  const columns=COLUMNS[table]
  let pending=rows
  if(immutable&&rows.length) {
    const existing=new Map((await client.query(`SELECT ${columns.map(k=>GEOMETRIES.has(k)?`encode(ST_AsEWKB(${k}),'hex') AS ${k}`:k).join(',')} FROM sinergi.${table} WHERE id=ANY($1::text[]) ORDER BY id`,[rows.map(r=>r.id)])).rows.map(r=>[r.id,r]))
    pending=rows.filter(row=>{
      const current=existing.get(row.id)
      if(!current)return true
      if(canonicalJson(current)!==canonicalJson(Object.fromEntries(columns.map(k=>[k,row[k]??null]))))throw new AppError('Registry atau sumber bersama berbeda dari versi tersimpan.',{code:'checkpoint_shared_conflict',statusCode:409})
      return false
    })
  }
  for(let offset=0;offset<pending.length;offset+=100) {
    const values=[]
    const tuples=pending.slice(offset,offset+100).map(row=>`(${columns.map(k=>{
      values.push(JSON_FIELDS.has(k)&&row[k]!=null?JSON.stringify(row[k]):row[k]??null)
      return GEOMETRIES.has(k)?`ST_GeomFromEWKB(decode($${values.length},'hex'))`:JSON_FIELDS.has(k)?`$${values.length}::jsonb`:`$${values.length}`
    }).join(',')})`)
    await client.query(`INSERT INTO sinergi.${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ON CONFLICT(id) ${immutable?'DO NOTHING':`DO UPDATE SET ${columns.filter(k=>k!=='id').map(k=>`${k}=EXCLUDED.${k}`).join(',')}`}`,values)
  }
}

export class DatasetCheckpoints {
  constructor({repository,fileStore}){this.repository=repository;this.fileStore=fileStore;repository.checkpoints=this}
  async capture(client,datasetId) {
    const state=await this.repository.state(client,datasetId)
    const query=async(sql,params=[datasetId])=>(await client.query(sql,params)).rows
    const payload={format:1,datasetId,state:{diagram_layout:state.diagram_layout,latest_import_id:state.latest_import_id,active_import_ids:[...state.active_import_ids].sort()}}
    payload.facilities=await query('SELECT * FROM sinergi.facilities WHERE dataset_id=$1 ORDER BY id')
    payload.assets=await query("SELECT a.*,a.created_at::text AS created_at,a.updated_at::text AS updated_at,encode(ST_AsEWKB(a.coordinate_override),'hex') AS coordinate_override FROM sinergi.assets a WHERE dataset_id=$1 ORDER BY id")
    payload.categories=await query('SELECT c.* FROM sinergi.asset_categories c WHERE c.id IN (SELECT category_id FROM sinergi.assets WHERE dataset_id=$1) ORDER BY id')
    payload.sources=await query("SELECT s.*,encode(ST_AsEWKB(s.geometry),'hex') AS geometry FROM sinergi.source_objects s WHERE s.id IN (SELECT source_object_id FROM sinergi.assets WHERE dataset_id=$1) ORDER BY id")
    payload.aliases=await query('SELECT x.* FROM sinergi.asset_aliases x JOIN sinergi.assets a ON a.id=x.asset_id WHERE a.dataset_id=$1 ORDER BY x.id')
    payload.relations=await query('SELECT r.*,r.updated_at::text AS updated_at FROM sinergi.relations r WHERE dataset_id=$1 ORDER BY id')
    // Preserve the closure of historical resource owners, without copying files.
    const ids=new Set([...payload.state.active_import_ids,...payload.sources.map(s=>s.import_id).filter(Boolean)])
    if(state.latest_import_id)ids.add(state.latest_import_id)
    payload.imports=[]
    let pending=[...ids]
    while(pending.length) {
      const records=await query('SELECT id,source_storage_key,source_checksum,source_size,source_manifest FROM sinergi.imports WHERE id=ANY($1::text[]) ORDER BY id',[pending])
      if(records.length!==pending.length)throw new AppError('Referensi sumber versi tidak lengkap.',{code:'checkpoint_source_missing',statusCode:409})
      payload.imports.push(...records);pending=[]
      for(const record of records)for(const resource of [...(record.source_manifest.resources??[]),...(record.source_manifest.overlays??[])]) {
        const owner=resource.originDatasetVersionId
        if(owner&&!ids.has(owner)){ids.add(owner);pending.push(owner)}
      }
    }
    payload.imports.sort((a,b)=>a.id.localeCompare(b.id))
    return payload
  }
  async save(client,{datasetId,name,actorId=null,reason='manual',markCurrent=true}) {
    const state=await this.repository.state(client,datasetId)
    const payload=await this.capture(client,datasetId),encoded=await encodeCheckpoint(payload)
    const summary={assets:payload.assets.filter(a=>!a.deleted).length,relations:payload.relations.filter(r=>!r.deleted&&r.kind==='connection').length,mounting:payload.relations.filter(r=>!r.deleted&&r.kind==='mounting').length,facilities:payload.facilities.length}
    const existing=(await client.query(`SELECT ${META} FROM sinergi.dataset_checkpoints WHERE dataset_id=$1 AND checksum=$2`,[datasetId,encoded.checksum])).rows[0]
    let version=existing
    if(existing)await client.query('UPDATE sinergi.dataset_checkpoints SET retained_at=now() WHERE id=$1',[existing.id])
    else version=(await client.query(`INSERT INTO sinergi.dataset_checkpoints(id,dataset_id,name,actor_id,source_revision,reason,summary,format_version,checksum,raw_size,compressed_size,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11) RETURNING ${META}`,[newId('version'),datasetId,name,actorId,state.revision,reason,summary,encoded.checksum,encoded.rawSize,encoded.bytes.length,encoded.bytes])).rows[0]
    if(markCurrent)await client.query('UPDATE sinergi.dataset_state SET current_checkpoint_id=$2 WHERE id=$1',[datasetId,version.id])
    return {version,existing:!!existing}
  }
  async prune(client,datasetId,protectedIds=[]) {
    const state=await this.repository.state(client,datasetId)
    const protectedSet=[...new Set([...protectedIds,state.current_checkpoint_id].filter(Boolean))]
    await client.query(`DELETE FROM sinergi.dataset_checkpoints WHERE id IN (
      SELECT id FROM sinergi.dataset_checkpoints WHERE dataset_id=$1 AND NOT(id=ANY($2::text[])) ORDER BY retained_at DESC,id DESC
      OFFSET GREATEST(0,$3-(SELECT count(*) FROM sinergi.dataset_checkpoints WHERE dataset_id=$1 AND id=ANY($2::text[]))))`,[datasetId,protectedSet,CHECKPOINT_LIMIT])
  }
  async list(datasetId) {
    return this.repository.transaction(async client=>{
      const state=await this.repository.state(client,datasetId)
      const versions=(await client.query(`SELECT ${META.split(',').map(k=>`v.${k}`).join(',')},u.username AS actor_name FROM sinergi.dataset_checkpoints v LEFT JOIN sinergi.app_users u ON u.id=v.actor_id WHERE dataset_id=$1 ORDER BY (v.id=$2) DESC NULLS LAST,retained_at DESC,source_revision DESC,v.id DESC`,[datasetId,state.current_checkpoint_id])).rows
      return {datasetId,revision:Number(state.revision),currentVersionId:state.current_checkpoint_id,limit:CHECKPOINT_LIMIT,versions}
    },{readOnly:true})
  }
  async manual({datasetId,name,expectedRevision,actorId}) {
    name=String(name??'').trim()
    if(!name||name.length>180)throw new AppError('Nama versi diperlukan, maksimum 180 karakter.',{code:'invalid_version_name',statusCode:400})
    return this.repository.transaction(async client=>{
      const state=await this.repository.state(client,datasetId,{lock:true});this.repository.assertRevision(state,expectedRevision)
      const result=await this.save(client,{datasetId,name,actorId})
      await this.repository.audit(client,'dataset.version_saved',{datasetId,actorId,details:{versionId:result.version.id,existing:result.existing}})
      await this.prune(client,datasetId)
      return {datasetId,revision:Number(state.revision),...result}
    })
  }
  async validateSources(client,payload) {
    for(const source of payload.imports) {
      const current=(await client.query('SELECT source_storage_key,source_checksum,source_size,source_manifest FROM sinergi.imports WHERE id=$1',[source.id])).rows[0]
      const expected={...source};delete expected.id
      if(!current||canonicalJson(current)!==canonicalJson(expected))throw new AppError('Metadata sumber versi tidak sesuai.',{code:'checkpoint_source_missing',statusCode:409})
      if(source.source_storage_key) {
        try {await this.fileStore.readVerifiedOriginal({storageKey:source.source_storage_key,expectedSize:Number(source.source_size),expectedChecksum:source.source_checksum})}
        catch {throw new AppError('File sumber versi hilang atau rusak. Data aktif tidak berubah.',{code:'checkpoint_source_missing',statusCode:409})}
      } else if(source.source_manifest.resources?.length||source.source_manifest.overlays?.length)throw new AppError('File sumber versi tidak tersedia.',{code:'checkpoint_source_missing',statusCode:409})
    }
  }
  async restore({datasetId,versionId,expectedRevision,actorId}) {
    return this.repository.transaction(async client=>{
      const state=await this.repository.state(client,datasetId,{lock:true});this.repository.assertRevision(state,expectedRevision)
      const row=(await client.query('SELECT * FROM sinergi.dataset_checkpoints WHERE id=$1 AND dataset_id=$2',[versionId,datasetId])).rows[0]
      if(!row)throw new AppError('Versi tidak ditemukan atau sudah melewati batas penyimpanan.',{code:'version_not_found',statusCode:404})
      const payload=await decodeCheckpoint(row,datasetId)
      await this.validateSources(client,payload)
      if(state.current_checkpoint_id===versionId)return {datasetId,revision:Number(state.revision),currentVersionId:versionId,alreadyActive:true}
      const backup=await this.save(client,{datasetId,name:'Sebelum pemulihan — '+new Date().toISOString(),actorId,reason:'before_restore',markCurrent:false})
      // Shared categories and sources are validated, never overwritten.
      for(const table of ['facilities','assets']) {
        const ids=payload[table].map(r=>r.id)
        if((await client.query(`SELECT 1 FROM sinergi.${table} WHERE id=ANY($1::text[]) AND dataset_id<>$2 LIMIT 1`,[ids,datasetId])).rowCount)throw new AppError('ID versi digunakan dataset lain.',{code:'checkpoint_scope_conflict',statusCode:409})
      }
      if((await client.query('SELECT 1 FROM sinergi.relations WHERE id=ANY($1::text[]) AND dataset_id<>$2 LIMIT 1',[payload.relations.map(r=>r.id),datasetId])).rowCount
        ||(await client.query('SELECT 1 FROM sinergi.asset_aliases x JOIN sinergi.assets a ON a.id=x.asset_id WHERE x.id=ANY($1::text[]) AND a.dataset_id<>$2 LIMIT 1',[payload.aliases.map(r=>r.id),datasetId])).rowCount)throw new AppError('ID versi digunakan dataset lain.',{code:'checkpoint_scope_conflict',statusCode:409})
      await upsert(client,'asset_categories',payload.categories,{immutable:true})
      await upsert(client,'source_objects',payload.sources,{immutable:true})
      await upsert(client,'facilities',payload.facilities)
      await client.query('DELETE FROM sinergi.asset_aliases WHERE asset_id IN (SELECT id FROM sinergi.assets WHERE dataset_id=$1)',[datasetId])
      await client.query('DELETE FROM sinergi.relations WHERE dataset_id=$1',[datasetId])
      await client.query('DELETE FROM sinergi.assets WHERE dataset_id=$1 AND NOT(id=ANY($2::text[]))',[datasetId,payload.assets.map(a=>a.id)])
      await upsert(client,'assets',payload.assets)
      await client.query('DELETE FROM sinergi.facilities WHERE dataset_id=$1 AND NOT(id=ANY($2::text[]))',[datasetId,payload.facilities.map(f=>f.id)])
      await upsert(client,'asset_aliases',payload.aliases)
      await upsert(client,'relations',payload.relations)
      await client.query('UPDATE sinergi.dataset_state SET diagram_layout=$2,latest_import_id=$3,active_import_ids=$4 WHERE id=$1',[datasetId,payload.state.diagram_layout,payload.state.latest_import_id,payload.state.active_import_ids])
      await this.repository.bump(client,datasetId)
      await client.query('UPDATE sinergi.dataset_state SET current_checkpoint_id=$2 WHERE id=$1',[datasetId,versionId])
      await client.query('UPDATE sinergi.dataset_checkpoints SET retained_at=now() WHERE id=$1',[versionId])
      await this.repository.audit(client,'dataset.version_restored',{datasetId,actorId,details:{versionId,backupVersionId:backup.version.id,sourceRevision:Number(row.source_revision)}})
      await this.prune(client,datasetId,[versionId,backup.version.id])
      return {datasetId,revision:Number(state.revision)+1,currentVersionId:versionId,backupVersionId:backup.version.id}
    })
  }
}
