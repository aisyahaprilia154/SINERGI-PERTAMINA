import {execFileSync} from 'node:child_process'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import assert from 'node:assert/strict'
import {createOperationalApp} from '../src/operational-app.js'
import {TokenAuthenticator} from '../src/security/authorization.js'
import {createConfig} from '../src/config.js'
import {OperationalRepository,insertRows,snapshotToView} from '../src/storage/operational-repository.js'
import {OperationalImportService} from '../src/import/operational-import-service.js'
import {ImportFileStore} from '../src/storage/file-store.js'
import {newId} from '../src/domain/operational-model.js'
import {adaptActiveDatasetForMap,adaptActiveDatasetForTopology} from '../../frontend/src/adapters/active-dataset-map-adapter.js'

const root=path.resolve(import.meta.dirname,'../..')
const database=process.argv.find(a=>a.startsWith('--database='))?.split('=')[1] ?? 'sinergi_final_check'
if(!/^sinergi_[a-z0-9_]+$/.test(database))throw new Error('Use a separate sinergi_ validation database.')
const dataRoot=process.argv.find(a=>a.startsWith('--source-root='))?.slice('--source-root='.length)
if(!dataRoot)throw new Error('Supply --source-root= for the restored immutable source files.')
const e=JSON.parse(execFileSync('docker',['compose','--env-file','.env.docker','config','--format','json'],{cwd:root,encoding:'utf8'})).services.db.environment
const pool=new pg.Pool({host:'127.0.0.1',port:5433,user:e.POSTGRES_USER,password:e.POSTGRES_PASSWORD,database})
try {
 const repository=new OperationalRepository(pool),snapshot=await repository.snapshot('dataset-semarang')
 const source=snapshot.latest,view=snapshotToView(snapshot),map=adaptActiveDatasetForMap(view),topology=adaptActiveDatasetForTopology(view)
 const pairs=graph=>[...new Set(graph.edges.map(e=>[e.sourceAssetId ?? e.sourceNodeId,e.targetAssetId ?? e.targetNodeId].sort().join('|')))].sort()
 assert.equal(snapshot.assets.length,1376);assert.equal(snapshot.facilities.length,9)
 assert.deepEqual(pairs(map.topologyGraph),pairs(topology.topologyGraph))
 const fileStore=new ImportFileStore(dataRoot),config=createConfig({}, {dataRoot}),service=new OperationalImportService({repository,fileStore,config})
 await fileStore.initialize()
 const original=await fileStore.readVerifiedOriginal({storageKey:source.source_storage_key,expectedSize:Number(source.source_size),expectedChecksum:source.source_checksum})
 assert.ok(view.assets.some(a=>a.sourceIconUrl),'Source icons must remain resolved')
 assert.ok(view.overlays.some(o=>o.resourceUrl),'Source overlays must remain resolved')
 const server=createOperationalApp({repository,importService:service,fileStore,config,authenticator:new TokenAuthenticator({verify:{id:'verify',role:'Viewer'}}),accountStore:{}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer verify'}
 try {
  const sourceResponse=await fetch(`${base}/api/imports/${source.id}/source-file`,{headers})
  assert.equal(sourceResponse.status,200);assert.deepEqual(Buffer.from(await sourceResponse.arrayBuffer()),original.bytes)
  for(const url of [view.assets.find(a=>a.sourceIconUrl).sourceIconUrl,view.overlays.find(o=>o.resourceUrl).resourceUrl]) {
   const response=await fetch(base+url,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png')
   assert.equal(Buffer.from(await response.arrayBuffer()).subarray(1,4).toString(),'PNG')
  }
 }finally{await new Promise(resolve=>server.close(resolve))}
 const id=newId('verify-import')
 await repository.transaction(c=>insertRows(c,'imports',[{id,dataset_id:source.dataset_id,name:'Full original KMZ verification',source_filename:source.source_filename,
  source_storage_key:source.source_storage_key,source_checksum:source.source_checksum,source_size:source.source_size,status:'processing',base_revision:Number(snapshot.state.revision),summary:{},source_manifest:{}}]))
 await service.process(id)
 const preview=await service.preview(id)
 assert.equal(preview.summary.addedAssets,0,JSON.stringify(preview.summary));assert.equal(preview.summary.addedRelations,0)
 assert.equal(preview.summary.conflicts,0,JSON.stringify(preview.conflicts.map(i=>({name:i.proposal.name,reason:i.reason,candidates:i.result.candidates}))))
 const report={database,assets:snapshot.assets.length,facilities:snapshot.facilities.length,connections:pairs(map.topologyGraph).length,
  sourceBytes:original.bytes.length,sourceChecksum:source.source_checksum,fullReimport:preview.summary,mapTopologyParity:true,sourceDownload:true,sourceIcons:true,sourceOverlays:true}
 const directory=path.join(root,'.local-runtime/operational-migration');await mkdir(directory,{recursive:true})
 await writeFile(path.join(directory,'baseline-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{await pool.end()}
