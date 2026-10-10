import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { buildActiveAssetCatalog } from '../src/domain/active-dataset-query.js'
import { buildAssetIdentityMapFromRecord } from '../src/domain/canonical-asset-identity.js'
import { projectFacilityRecord } from '../src/topology/facility-record-projection.js'
import { adaptActiveDatasetForMap } from '../../frontend/src/adapters/active-dataset-map-adapter.js'
import { materializeBaseline } from '../src/domain/operational-model.js'
import {loadMigration,runMigration} from '../src/database/migration-runner.js'
import { OperationalRepository, insertRows, snapshotToView } from '../src/storage/operational-repository.js'

const root=path.resolve(import.meta.dirname,'../..')
const live=process.argv.includes('--live'),database=live?null:(process.argv.find(a=>a.startsWith('--database='))?.split('=')[1] ?? 'sinergi_migration_check')
if(live && !process.argv.includes('--verified-backup')) throw new Error('Live migration requires a verified backup and stopped backend.')
const config=JSON.parse(execFileSync('docker',['compose','--env-file','.env.docker','config','--format','json'],{cwd:root,encoding:'utf8'})).services.db.environment
const pool=new pg.Pool({host:'127.0.0.1',port:5433,user:config.POSTGRES_USER,password:config.POSTGRES_PASSWORD,database:database ?? config.POSTGRES_DB,max:3})
try {
 const existing=(await pool.query("SELECT to_regclass('sinergi.dataset_state') AS table_name")).rows[0].table_name
 if(existing && (await pool.query('SELECT 1 FROM sinergi.dataset_state LIMIT 1')).rows.length) throw new Error('Operational baseline already exists; refusing to overwrite it.')
 const running=(await pool.query("SELECT count(*)::int AS n FROM topology_jobs WHERE status IN ('queued','running','retry_wait')")).rows[0].n
 if(running) throw new Error('Pending legacy jobs must finish before migration.')
 if(live) {
  const backupDir=process.argv.find(a=>a.startsWith('--backup='))?.slice('--backup='.length)
  if(!backupDir)throw new Error('Supply the verified backup directory with --backup=.')
  const manifest=JSON.parse(await readFile(path.join(backupDir,'manifest.json'),'utf8'))
  const {createHash}=await import('node:crypto')
  if(createHash('sha256').update(await readFile(path.join(backupDir,'database.dump'))).digest('hex')!==manifest.databaseSha256)throw new Error('Backup checksum mismatch.')
  const active=execFileSync('docker',['compose','--env-file','.env.docker','ps','--status','running','-q','backend'],{cwd:root,encoding:'utf8'}).trim()
  if(active)throw new Error('Stop the backend before live migration.')
  const restored=new pg.Pool({host:'127.0.0.1',port:5433,user:config.POSTGRES_USER,password:config.POSTGRES_PASSWORD,database:manifest.restoreDatabase,max:1})
  try {
   const query='SELECT id,md5(payload::text) AS digest FROM public.dataset_versions ORDER BY id'
   if(JSON.stringify((await pool.query(query)).rows)!==JSON.stringify((await restored.query(query)).rows))throw new Error('Live baseline has changed since the verified backup.')
  }finally{await restored.end()}
 }
 if(!existing) {
  const migration=await loadMigration(path.join(root,'backend/src/database/migrations'),'0009_simplified_operational')
  const client=await pool.connect();try{await runMigration(client,migration)}finally{client.release()}
 }
 const pointers=(await pool.query('SELECT dataset_id,branch_id,dataset_version_id FROM dataset_active_pointers')).rows
 const operational=new OperationalRepository(pool),reports=[]
 await operational.transaction(async client=>{
  const versions=(await client.query(`SELECT id,dataset_id,version_name,source_filename,source_storage_key,source_checksum,source_size,status,created_at,
    payload->'sourceResources' AS resources,payload->'sourceOverlays' AS overlays,payload->'sourceStyles' AS styles,payload->'datasetVersion' AS metadata FROM dataset_versions ORDER BY created_at`)).rows
  await insertRows(client,'imports',versions.map(v=>({id:v.id,dataset_id:v.dataset_id,name:v.version_name,source_filename:v.source_filename,
    source_storage_key:v.source_storage_key,source_checksum:v.source_checksum,source_size:v.source_size,
    status:v.status==='active'?'applied':v.status==='invalid'?'failed':'archived',base_revision:0,summary:{legacy:true},
    source_manifest:{resources:v.resources ?? [],overlays:v.overlays ?? [],styles:v.styles ?? {},legacyDatasetVersion:v.metadata},created_at:v.created_at})))
  for(const pointer of pointers) {
   const legacy=(await client.query("SELECT v.payload,v.xmin::text AS storage_revision,r.payload->'activeMapDataset' AS map,r.storage_revision AS cached_revision FROM public.dataset_versions v LEFT JOIN public.dataset_version_active_reads r ON r.dataset_version_id=v.id AND r.read_view='map-read' WHERE v.id=$1",[pointer.dataset_version_id])).rows[0]
   if(!legacy?.map || (live&&legacy.storage_revision!==legacy.cached_revision))throw new Error('Legacy effective map cache must be current before migration.')
   const record=projectFacilityRecord(legacy.payload)
   const payload=legacy.map
   const map=adaptActiveDatasetForMap(payload)
   const catalog=buildActiveAssetCatalog({record,identityMap:buildAssetIdentityMapFromRecord(record),topologyGraph:record.topologyGraph})
   const rows=materializeBaseline({record,catalog,map})
   await insertRows(client,'dataset_state',[rows.dataset]);await insertRows(client,'facilities',rows.facilities)
   await insertRows(client,'asset_categories',rows.categories);await insertRows(client,'source_objects',rows.sources)
   await insertRows(client,'assets',rows.assets);await insertRows(client,'asset_aliases',rows.aliases);await insertRows(client,'relations',rows.relations)
   const snapshot=await operational.snapshot(pointer.dataset_id,{client})
   const view=snapshotToView(snapshot),newMap=adaptActiveDatasetForMap(view)
   const edgeKeys=m=>[...new Set(m.topologyGraph.edges.map(e=>[e.sourceAssetId ?? e.sourceNodeId,e.targetAssetId ?? e.targetNodeId].sort().join('|')))].sort()
   const mountKeys=m=>[...new Set(m.mountingRelations.map(e=>`${e.sourceAssetId}|${e.targetAssetId}`))].sort()
   const checks={assetIds:JSON.stringify(rows.assets.map(a=>a.id).sort())===JSON.stringify(snapshot.assets.map(a=>a.id).sort()),
    mapEdges:JSON.stringify(edgeKeys(map))===JSON.stringify(edgeKeys(newMap)),mounting:JSON.stringify(mountKeys(map))===JSON.stringify(mountKeys(newMap)),
    coordinates:JSON.stringify(payload.geometries.map(g=>g.coordinates).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))===
      JSON.stringify(view.geometries.map(g=>g.coordinates).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))),
    visibleGeometry:JSON.stringify(map.geometries.map(g=>g.coordinates).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))===
      JSON.stringify(newMap.geometries.map(g=>g.coordinates).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))}
   if(Object.values(checks).some(v=>!v)) {
    const oldEdges=edgeKeys(map),newEdges=edgeKeys(newMap)
    console.error(JSON.stringify({oldEdges:oldEdges.length,newEdges:newEdges.length,missing:oldEdges.filter(k=>!newEdges.includes(k)).slice(0,12),added:newEdges.filter(k=>!oldEdges.includes(k)).slice(0,12)}))
    throw new Error(`Baseline parity failed: ${JSON.stringify(checks)}`)
   }
   reports.push({datasetId:pointer.dataset_id,assets:rows.assets.length,facilities:rows.facilities.length,connections:edgeKeys(map).length,mounting:mountKeys(map).length,checks})
  }
  await client.query(`INSERT INTO sinergi.app_users(id,username,email,password_hash,role,active,created_at,updated_at)
    SELECT id,username,email,password_hash,role,active,created_at,updated_at FROM public.app_users ON CONFLICT(id) DO NOTHING`)
  await client.query(`INSERT INTO sinergi.audit_events(id,event,actor_id,dataset_id,import_id,occurred_at,details)
    SELECT a.event_id,a.event,a.actor_id,v.dataset_id,a.dataset_version_id,a.occurred_at,a.details FROM public.audit_events a
    LEFT JOIN public.dataset_versions v ON v.id=a.dataset_version_id ON CONFLICT(id) DO NOTHING`)
 })
 const dir=path.join(root,'.local-runtime','operational-migration');await mkdir(dir,{recursive:true})
 await writeFile(path.join(dir,live?'live-report.json':'restore-report.json'),JSON.stringify({database:database ?? config.POSTGRES_DB,reports},null,2))
 console.log(JSON.stringify({database:database ?? config.POSTGRES_DB,reports}))
} finally {await pool.end()}
