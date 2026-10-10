import {execFileSync} from 'node:child_process'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import pg from 'pg'
import assert from 'node:assert/strict'
import {OperationalRepository,snapshotToView} from '../src/storage/operational-repository.js'
import {materializeBaseline} from '../src/domain/operational-model.js'
import {buildActiveAssetCatalog} from '../src/domain/active-dataset-query.js'
import {buildAssetIdentityMapFromRecord} from '../src/domain/canonical-asset-identity.js'
import {projectFacilityRecord} from '../src/topology/facility-record-projection.js'
import {adaptActiveDatasetForMap} from '../../frontend/src/adapters/active-dataset-map-adapter.js'

const root=path.resolve(import.meta.dirname,'../..'),live=process.argv.includes('--live')
const backup=process.argv.find(a=>a.startsWith('--backup='))?.slice(9)
if(!backup)throw new Error('A verified backup directory is required.')
const manifest=JSON.parse(await readFile(path.join(backup,'manifest.json'),'utf8'))
assert.equal(createHash('sha256').update(await readFile(path.join(backup,'database.dump'))).digest('hex'),manifest.databaseSha256)
const e=JSON.parse(execFileSync('docker',['compose','--env-file','.env.docker','config','--format','json'],{cwd:root,encoding:'utf8'})).services.db.environment
const database=live?e.POSTGRES_DB:'sinergi_final_check'
const pool=new pg.Pool({host:'127.0.0.1',port:5433,user:e.POSTGRES_USER,password:e.POSTGRES_PASSWORD,database})
const tables=['accuracy_evaluations','app_users','asset_identity_registry','audit_events','classified_objects','confirmed_relations',
 'dataset_active_pointers','dataset_version_active_reads','dataset_version_diffs','dataset_versions','graph_edges','graph_nodes','graph_revisions',
 'source_features','source_geometries','topology_candidates','topology_components','topology_interfaces','topology_jobs']
try {
 if(!(await pool.query("SELECT to_regclass('public.dataset_versions') name")).rows[0].name)throw new Error('Legacy schema has already been retired.')
 const repository=new OperationalRepository(pool)
 const report=await repository.transaction(async client=>{
  const state=await repository.state(client,'dataset-semarang',{lock:true})
  const legacy=(await client.query("SELECT v.payload,r.payload->'activeMapDataset' AS map FROM public.dataset_versions v JOIN public.dataset_version_active_reads r ON r.dataset_version_id=v.id AND r.read_view='map-read' WHERE v.id=$1",[state.latest_import_id])).rows[0]
  if(!legacy)throw new Error('Baseline changed since migration; legacy retirement requires a new parity review.')
  const record=projectFacilityRecord(legacy.payload),oldMap=adaptActiveDatasetForMap(legacy.map)
  const catalog=buildActiveAssetCatalog({record,identityMap:buildAssetIdentityMapFromRecord(record),topologyGraph:record.topologyGraph})
  const rows=materializeBaseline({record,catalog,map:oldMap})
  // Materialize former display corrections once, rather than running legacy
  // facility policies in every map request. Coordinates and business IDs stay intact.
  for(const asset of rows.assets)await client.query("UPDATE sinergi.assets SET properties=properties||jsonb_build_object('mapVisible',$2::boolean) WHERE id=$1",[asset.id,asset.properties.mapVisible])
  for(const source of rows.sources)await client.query('UPDATE sinergi.source_objects SET parts=$2 WHERE id=$1',[source.id,JSON.stringify(source.parts)])
  await client.query("UPDATE sinergi.imports i SET source_manifest=i.source_manifest||jsonb_build_object('legacyDatasetVersion',v.payload->'datasetVersion') FROM public.dataset_versions v WHERE i.id=v.id")
  const snapshot=await repository.snapshot(state.id,{client}),view=snapshotToView(snapshot),newMap=adaptActiveDatasetForMap(view)
  assert.equal(snapshot.assets.length,1376);assert.equal(snapshot.facilities.length,9)
  const pairs=m=>[...new Set(m.topologyGraph.edges.map(r=>[r.sourceAssetId ?? r.sourceNodeId,r.targetAssetId ?? r.targetNodeId].sort().join('|')))].sort()
  assert.deepEqual(pairs(oldMap),pairs(newMap))
  const coordinates=m=>m.geometries.map(g=>g.coordinates).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
  assert.deepEqual(coordinates(oldMap),coordinates(newMap))
  const missingUsers=(await client.query('SELECT count(*)::int n FROM (SELECT id,username,password_hash,role,active FROM public.app_users EXCEPT SELECT id,username,password_hash,role,active FROM sinergi.app_users) missing')).rows[0].n
  assert.equal(missingUsers,0)
  const missingHistory=(await client.query('SELECT count(*)::int n FROM public.dataset_versions v LEFT JOIN sinergi.imports i ON i.id=v.id WHERE i.id IS NULL OR i.source_checksum IS DISTINCT FROM v.source_checksum')).rows[0].n
  assert.equal(missingHistory,0)
  await client.query(`DROP TABLE ${tables.map(t=>`public.${t}`).join(',')}`)
  await repository.audit(client,'migration.legacy_retired',{actorId:'system:migration',datasetId:state.id,details:{tables,visibleGeometry:newMap.geometries.length}})
  await repository.bump(client,state.id)
  return {database,retiredTables:tables.length,applicationTables:12,assets:snapshot.assets.length,facilities:snapshot.facilities.length,
   connections:pairs(newMap).length,mounting:newMap.mountingRelations.length,visibleGeometry:newMap.geometries.length,accountsPreserved:true,historyArchived:true}
 })
 await writeFile(path.join(root,'.local-runtime/operational-migration',live?'retirement-live.json':'retirement-restore.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify(report))
}finally{await pool.end()}
