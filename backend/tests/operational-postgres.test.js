import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'
import {createConfig} from '../src/config.js'
import {OperationalRepository,insertRows,snapshotToView} from '../src/storage/operational-repository.js'
import {OperationalImportService} from '../src/import/operational-import-service.js'
import {ImportFileStore} from '../src/storage/file-store.js'
import {createOperationalApp} from '../src/operational-app.js'
import {TokenAuthenticator} from '../src/security/authorization.js'
import {newId,stableKey} from '../src/domain/operational-model.js'
import {createHash} from 'node:crypto'
import {OperationalWorker} from '../src/jobs/operational-worker.js'
import {PostgresAccountStore} from '../src/security/account-store.js'

const enabled=!!process.env.SINERGI_TEST_DATABASE_URL
let pool,repository,service,store,server,base,datasetId,importId,baselineAsset='test-old-jb',clockOffset=0
const request=async(route,{method='GET',body,token='test-admin'}={})=>{
 const response=await fetch(`${base}${route}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
 return {status:response.status,body:await response.json()}
}
const kml=`<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>RJBT</name><Folder><name>Test Facility</name>
 <Folder><name>Kulkas</name><Placemark><name>KULKAS-01</name><Point><coordinates>110.0002,-7,0</coordinates></Point></Placemark></Folder>
 <Folder><name>LAN</name><Placemark><name>JB OLD - KULKAS-01</name><Style><LineStyle><color>ff00ff00</color></LineStyle></Style><LineString><coordinates>110,-7,0 110.0002,-7,0</coordinates></LineString></Placemark></Folder>
 </Folder></Folder></Document></kml>`
before(async()=>{
 if(!enabled)return
 pool=new pg.Pool({connectionString:process.env.SINERGI_TEST_DATABASE_URL,max:4});repository=new OperationalRepository(pool)
 await pool.query("UPDATE sinergi.jobs SET status='failed',locked_by=null,lock_expires_at=null WHERE status IN ('queued','retry_wait','running') AND import_id IN (SELECT id FROM sinergi.imports WHERE dataset_id LIKE 'test-dataset-%')")
 const dataRoot=await mkdtemp(path.join(os.tmpdir(),'sinergi-operational-test-')),config=createConfig({}, {dataRoot})
 store=new ImportFileStore(dataRoot);await store.initialize();service=new OperationalImportService({repository,fileStore:store,config})
 datasetId=newId('test-dataset');baselineAsset=newId('test-jb')
 const facilityId=`facility-${stableKey(datasetId,'test facility')}`
 await repository.transaction(async c=>{
  await insertRows(c,'dataset_state',[{id:datasetId,revision:0,diagram_layout:{}}])
  await insertRows(c,'facilities',[{id:facilityId,dataset_id:datasetId,name:'Test Facility',aliases:['test facility']}])
  await insertRows(c,'asset_categories',[{id:'test-category-jb',name:'Test Junction',diagram_role:'junction-peer'}])
  await insertRows(c,'source_objects',[{id:newId('test-source'),source_feature_id:'test-jb',folder_path:'/RJBT/Test Facility/JB',name:'JB OLD',geometry:{type:'Point',coordinates:[110,-7,0]},parts:[],properties:{}}])
  const source=(await c.query("SELECT id FROM sinergi.source_objects WHERE source_feature_id='test-jb' ORDER BY id DESC LIMIT 1")).rows[0].id
  await insertRows(c,'assets',[{id:baselineAsset,dataset_id:datasetId,facility_id:facilityId,category_id:'test-category-jb',source_object_id:source,name:'JB OLD',kind:'device',properties:{diagramRole:'junction-peer'},deleted:false}])
 })
 server=createOperationalApp({repository,importService:service,fileStore:store,config,authenticator:new TokenAuthenticator({'test-admin':{id:'test-admin',role:'Administrator'},'test-viewer':{id:'test-viewer',role:'Viewer'}},{now:()=>Date.now()+clockOffset}),accountStore:new PostgresAccountStore(pool)})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`
})
after(async()=>{if(server)await new Promise(r=>server.close(r));if(pool)await pool.end()})
test('operational PostgreSQL workflow and atomic edits',{skip:!enabled},async t=>{
 await t.test('database accounts authenticate and expose only their role',async()=>{
  const username=newId('test-viewer'),password=newId('password')
  await new PostgresAccountStore(pool).save({username,password,role:'Viewer'})
  const response=await request('/api/auth/login',{method:'POST',body:{identifier:username,password}})
  assert.equal(response.status,200);assert.equal(response.body.user.role,'Viewer');assert.equal('branchIds' in response.body.user,false)
  assert.equal((await request(`/api/datasets/${datasetId}/active`,{token:response.body.token})).status,200)
  assert.equal((await request('/api/auth/login',{method:'POST',body:{identifier:username,password:'wrong'}})).status,401)
 })
 await t.test('real account presence, multiple sessions, timeout and administrative changes',async()=>{
  const username=newId('presence'),password=newId('password'),replacement=newId('replacement')
  const created=await request('/api/admin/users',{method:'POST',body:{username,password,role:'Viewer'}})
  assert.equal(created.status,201,JSON.stringify(created.body));let account=created.body.user
  const login=async(secret=password)=>request('/api/auth/login',{method:'POST',body:{identifier:username,password:secret}})
  const listed=async()=>{const result=await request('/api/admin/users');assert.equal(result.status,200);return result.body.users.find(u=>u.id===account.id)}
  assert.equal((await listed()).online,false);assert.equal((await listed()).lastSeenAt,null)
  assert.equal((await request('/api/admin/users',{token:'test-viewer'})).status,403)
  const first=await login(),second=await login();assert.equal(first.status,200);assert.equal(second.status,200)
  assert.equal((await listed()).online,true);assert.ok((await listed()).lastSeenAt)
  assert.equal(JSON.stringify(await listed()).includes('password_hash'),false)
  assert.equal(JSON.stringify(first.body).includes('authVersion'),false)
  assert.equal((await request('/api/auth/logout',{method:'POST',token:first.body.token})).status,200)
  assert.equal((await listed()).online,true)
  try{
   clockOffset=90_001;assert.equal((await listed()).online,false)
   assert.equal((await request('/api/auth/heartbeat',{method:'POST',token:second.body.token})).status,200)
   assert.equal((await listed()).online,true)
  }finally{clockOffset=0}
  await request('/api/auth/logout',{method:'POST',token:second.body.token});assert.equal((await listed()).online,false)
  const third=await login()
  const disabled=await request(`/api/admin/users/${account.id}`,{method:'PATCH',body:{active:false,expectedUpdatedAt:account.updatedAt}})
  assert.equal(disabled.status,200);assert.equal(disabled.body.sessionsRevoked,true);account=disabled.body.user
  assert.equal((await request('/api/auth/me',{token:third.body.token})).status,401)
  assert.equal((await login()).status,401);assert.equal((await listed()).online,false)
  const stale=await request(`/api/admin/users/${account.id}`,{method:'PATCH',body:{active:true,expectedUpdatedAt:created.body.user.updatedAt}})
  assert.equal(stale.status,409)
  const enabled=await request(`/api/admin/users/${account.id}`,{method:'PATCH',body:{active:true,expectedUpdatedAt:account.updatedAt}})
  assert.equal(enabled.status,200);account=enabled.body.user
  const fourth=await login()
  const reset=await request(`/api/admin/users/${account.id}/password`,{method:'POST',body:{password:replacement,expectedUpdatedAt:account.updatedAt}})
  assert.equal(reset.status,200);account=reset.body.user
  assert.equal((await request('/api/auth/heartbeat',{method:'POST',token:fourth.body.token})).status,401)
  assert.equal((await login()).status,401);const fifth=await login(replacement);assert.equal(fifth.status,200)
  const promoted=await request(`/api/admin/users/${account.id}`,{method:'PATCH',body:{role:'Administrator',expectedUpdatedAt:account.updatedAt}})
  assert.equal(promoted.status,200)
  assert.equal((await request('/api/admin/users',{token:fifth.body.token})).status,401)
  const sixth=await login(replacement);assert.equal(sixth.body.user.role,'Administrator')
  assert.equal((await request('/api/admin/users',{token:sixth.body.token})).status,200)
  assert.equal((await request('/api/admin/users',{method:'POST',body:{username,password}})).status,409)
  const events=(await pool.query('SELECT event,details FROM sinergi.audit_events WHERE details->>\'userId\'=$1',[account.id])).rows
  assert.deepEqual(events.map(e=>e.event).sort(),['user.created','user.password_reset','user.updated','user.updated','user.updated'].sort())
  assert.equal(JSON.stringify(events).includes(password),false);assert.equal(JSON.stringify(events).includes(replacement),false)
  await request('/api/auth/logout',{method:'POST',token:sixth.body.token})
 })
 await t.test('upload creates preview; generic fridge connects to baseline JB',async()=>{
  const form=new FormData();form.append('datasetId',datasetId);form.append('versionName','Fridge import');form.append('file',new Blob([kml],{type:'application/vnd.google-earth.kml+xml'}),'fixture.kml')
  const response=await fetch(`${base}/api/imports`,{method:'POST',headers:{Authorization:'Bearer test-admin'},body:form})
  const body=await response.json();assert.equal(response.status,202,JSON.stringify(body));importId=body.importId
  await service.process(importId)
  await pool.query("UPDATE sinergi.jobs SET status='succeeded' WHERE import_id=$1",[importId])
  const preview=await service.preview(importId)
  assert.equal(preview.summary.conflicts,0,JSON.stringify(preview.conflicts))
  assert.equal(preview.summary.addedAssets,2);assert.equal(preview.summary.addedRelations,1)
  assert.equal(preview.additions.assets.find(a=>a.category==='Kulkas').diagramRole,'endpoint')
 })
 let current,fridge
 await t.test('apply writes one cumulative operational dataset',async()=>{
  const response=await request(`/api/imports/${importId}/apply`,{method:'POST',body:{expectedRevision:0}})
  assert.equal(response.status,200,JSON.stringify(response.body))
  current=await repository.snapshot(datasetId);assert.equal(current.assets.length,3);assert.equal(current.relations.length,1)
  fridge=current.assets.find(a=>a.category==='Kulkas')
  assert.equal(fridge.properties.diagramRole,'endpoint')
  const view=snapshotToView(current);assert.equal(view.topologyGraph.edges[0].sourceAssetId,baselineAsset)
  assert.equal(view.topologyGraph.edges[0].targetAssetId,fridge.id)
 })
 await t.test('Viewer can read all facilities and cannot write',async()=>{
  assert.equal((await request(`/api/datasets/${datasetId}/active`,{token:'test-viewer'})).status,200)
  assert.equal((await request(`/api/datasets/${datasetId}/diagram`,{token:'test-viewer',method:'POST',body:{expectedRevision:1,changes:[{type:'remove-edge',edgeId:current.relations[0].id}]}})).status,403)
 })
 await t.test('stale edit cannot change data',async()=>{
  assert.equal((await request(`/api/datasets/${datasetId}/diagram`,{method:'POST',body:{expectedRevision:0,changes:[{type:'remove-edge',edgeId:current.relations[0].id}]}})).status,409)
  assert.equal((await repository.snapshot(datasetId)).relations.length,1)
 })
 await t.test('delete persists as tombstone and revisions agree across views',async()=>{
  const result=await request(`/api/datasets/${datasetId}/diagram`,{method:'POST',body:{expectedRevision:1,changes:[{type:'remove-edge',edgeId:current.relations[0].id}]}})
  assert.equal(result.status,200);assert.equal(result.body.graph.edges.length,0)
  const active=await request(`/api/datasets/${datasetId}/active`),graph=await request(`/api/datasets/${datasetId}/topology/graph`)
  assert.deepEqual(active.body.topologyGraph.edges,graph.body.edges);assert.equal(active.body.revision,2)
  assert.equal(active.body.assets.find(a=>a.objectRole==='cable_path').mapVisible,false)
  assert.deepEqual(result.body.graph.removedPathAssetIds,[active.body.assets.find(a=>a.objectRole==='cable_path').id])
  const exported=await fetch(`${base}/api/datasets/${datasetId}/active/exports/kml`,{method:'POST',headers:{Authorization:'Bearer test-admin','content-type':'application/json'},body:'{}'})
  assert.equal(exported.status,200);assert.equal((await exported.text()).includes('<LineString>'),false)
  assert.equal((await repository.readView(datasetId)).view.revision,2)
  assert.equal((await repository.snapshot(datasetId,{includeDeleted:true})).relations[0].deleted,true)
 })
 await t.test('same KMZ/KML recognizes old assets and preserves tombstones',async()=>{
  const id=newId('import'),temporary=await store.createTemporaryUpload();await writeFile(temporary,kml)
  const saved=await store.commitOriginal(temporary,id,'.kml')
  await repository.transaction(c=>insertRows(c,'imports',[{id,dataset_id:datasetId,name:'Repeat',source_filename:'fixture.kml',source_storage_key:saved.storageKey,
    source_checksum:`sha256:${createHash('sha256').update(kml).digest('hex')}`,source_size:Buffer.byteLength(kml),status:'processing',base_revision:2,summary:{},source_manifest:{}}]))
  await service.process(id)
  const preview=await service.preview(id);assert.equal(preview.summary.addedAssets,0);assert.equal(preview.summary.addedRelations,0)
  await service.apply(id,2,'test-admin');assert.equal((await repository.snapshot(datasetId)).assets.length,3)
 })
 await t.test('failure in audit rolls back icon and revision',async()=>{
  const before=await repository.snapshot(datasetId)
  await pool.query(`CREATE OR REPLACE FUNCTION sinergi.test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id='reject-test-audit' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_reject_audit BEFORE INSERT ON sinergi.audit_events FOR EACH ROW EXECUTE FUNCTION sinergi.test_reject_audit()`)
  try {
   await assert.rejects(repository.saveIcon({datasetId,assetId:fridge.id,expectedRevision:Number(before.state.revision),dataUrl:'data:image/png;base64,YQ==',actorId:'reject-test-audit'}))
   const after=await repository.snapshot(datasetId);assert.equal(after.state.revision,before.state.revision);assert.equal(after.assets.find(a=>a.id===fridge.id).custom_icon,null)
  } finally {await pool.query('DROP TRIGGER test_reject_audit ON sinergi.audit_events; DROP FUNCTION sinergi.test_reject_audit()')}
 })
 await t.test('restart recovers an expired import job; an edited baseline makes its preview stale',async()=>{
  const id=newId('import'),jobId=newId('job'),temporary=await store.createTemporaryUpload();await writeFile(temporary,kml)
  const saved=await store.commitOriginal(temporary,id,'.kml')
  await repository.transaction(async c=>{
   await insertRows(c,'imports',[{id,dataset_id:datasetId,name:'Recovery',source_filename:'fixture.kml',source_storage_key:saved.storageKey,
    source_checksum:`sha256:${createHash('sha256').update(kml).digest('hex')}`,source_size:Buffer.byteLength(kml),status:'processing',summary:{},source_manifest:{}}])
   await c.query("INSERT INTO sinergi.jobs(id,import_id,status,locked_by,lock_expires_at) VALUES($1,$2,'running','dead-worker',now()-interval '1 minute')",[jobId,id])
  })
  const worker=new OperationalWorker({repository,importService:service});await worker.tick()
  assert.equal((await service.get(id)).status,'ready')
  assert.equal((await pool.query('SELECT status FROM sinergi.jobs WHERE id=$1',[jobId])).rows[0].status,'succeeded')
  const preview=await service.preview(id)
  await repository.saveIcon({datasetId,assetId:fridge.id,expectedRevision:preview.baseRevision,dataUrl:'data:image/png;base64,YQ==',actorId:'test-admin'})
  await assert.rejects(service.apply(id,preview.baseRevision,'test-admin'),{code:'revision_conflict'})
  const revision=Number((await repository.snapshot(datasetId)).state.revision)
  await repository.saveDiagram({datasetId,expectedRevision:revision,actorId:'test-admin',changes:[{type:'move-node',assetId:fridge.id,x:250,y:120}]})
  await pool.query("UPDATE sinergi.imports SET status='processing' WHERE id=$1",[id]);await service.process(id)
  const refreshed=await service.preview(id);await service.apply(id,refreshed.baseRevision,'test-admin')
  const after=await repository.snapshot(datasetId)
  assert.equal(after.assets.find(a=>a.id===fridge.id).custom_icon.dataUrl,'data:image/png;base64,YQ==')
  assert.deepEqual(after.assets.find(a=>a.id===fridge.id).geometry,fridge.geometry)
  assert.deepEqual(after.state.diagram_layout.nodePositions[fridge.id],{x:250,y:120})
  assert.equal(after.relations.length,0)
 })
 await t.test('Printer keeps its category name and endpoint hierarchy',async()=>{
  const file='<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>RJBT</name><Folder><name>Test Facility</name><Folder><name>Printer</name><Placemark><name>PRINTER-01</name><Point><coordinates>110.0004,-7</coordinates></Point></Placemark></Folder></Folder></Folder></Document></kml>'
  const form=new FormData();form.append('datasetId',datasetId);form.append('file',new Blob([file],{type:'application/vnd.google-earth.kml+xml'}),'printer.kml')
  const upload=await fetch(`${base}/api/imports`,{method:'POST',headers:{Authorization:'Bearer test-admin'},body:form});const id=(await upload.json()).importId
  assert.equal(upload.status,202);await service.process(id)
  const preview=await service.preview(id),printer=preview.additions.assets[0]
  assert.equal(printer.category,'Printer');assert.equal(printer.diagramRole,'endpoint');assert.equal(printer.properties.dynamicCategory,true)
  await service.apply(id,preview.baseRevision,'test-admin')
  assert.equal(snapshotToView(await repository.snapshot(datasetId)).assets.find(a=>a.id===printer.id).category,'Printer')
 })
 await t.test('manual connection and mounting share map/diagram revision without moving geography',async()=>{
  const before=await repository.readView(datasetId),facility=before.snapshot.facilities[0],poleId=newId('test-pole'),sourceId=newId('test-source')
  await repository.transaction(async c=>{
   await insertRows(c,'asset_categories',[{id:'test-category-pole',name:'Test Pole',diagram_role:'physical-mount'}])
   await insertRows(c,'source_objects',[{id:sourceId,source_feature_id:poleId,name:'TEST POLE',geometry:{type:'Point',coordinates:[110.0002,-7]},parts:[],properties:{}}])
   await insertRows(c,'assets',[{id:poleId,dataset_id:datasetId,facility_id:facility.id,category_id:'test-category-pole',source_object_id:sourceId,name:'TEST POLE',kind:'device',properties:{diagramRole:'physical-mount'},deleted:false}])
   await repository.bump(c,datasetId)
  })
  const state=await repository.snapshot(datasetId)
  const saved=await repository.saveDiagram({datasetId,expectedRevision:Number(state.state.revision),actorId:'test-admin',changes:[
   {type:'add-relation',sourceAssetId:baselineAsset,targetAssetId:fridge.id},
   {type:'mount',assetId:fridge.id,poleAssetId:poleId},
   {type:'move-node',assetId:fridge.id,x:700,y:300},
  ]})
  const after=await repository.readView(datasetId)
  assert.notEqual(after,before);assert.equal(after.view.revision,saved.revision)
  assert.deepEqual(after.snapshot.assets.find(a=>a.id===fridge.id).geometry,fridge.geometry)
  assert.equal(after.view.mountingRelations.find(r=>r.sourceAssetId===fridge.id).targetAssetId,poleId)
  assert.equal(after.view.topologyGraph.edges.length,1);assert.deepEqual(after.view.topologyGraph.edges[0].pathAssetIds,[])
  const active=await request(`/api/datasets/${datasetId}/active`),graph=await request(`/api/datasets/${datasetId}/topology/graph`)
  assert.deepEqual(active.body.topologyGraph.edges,graph.body.edges)
  const exported=await fetch(`${base}/api/datasets/${datasetId}/active/exports/kml`,{method:'POST',headers:{Authorization:'Bearer test-admin','content-type':'application/json'},body:'{}'})
  assert.equal(exported.status,200);const text=await exported.text()
  assert.ok(text.includes('<LineString>'));assert.ok(text.includes('mounted_on'));assert.ok(text.includes('source_asset_id'))
 })
})
