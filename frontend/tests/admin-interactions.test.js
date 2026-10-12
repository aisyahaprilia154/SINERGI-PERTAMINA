import {test} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {saveSession} from '../src/services/account-session.js'
import {renderImportDatasetPage} from '../src/pages/admin/import-dataset-page.js'
import {renderPreviewImportPage} from '../src/pages/admin/preview-import-page.js'
import {renderUsersPage} from '../src/pages/admin/users-page.js'

test('admin operations retain drafts, context and map position',async t=>{
  const dom=new JSDOM('<html><body><div id="app"></div></body></html>',{url:'http://localhost/admin/datasets/import',pretendToBeVisual:true})
  const keys=['window','document','FormData','CustomEvent','XMLHttpRequest','fetch'],prior=Object.fromEntries(keys.map(k=>[k,globalThis[k]]))
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,FormData:dom.window.FormData,CustomEvent:dom.window.CustomEvent})
  const app=document.querySelector('#app'),requests=[],xhrRequests=[]
  let datasets=[{id:'shared',name:'SINERGI'}],history=[],baseline={datasetVersion:{id:'baseline',datasetId:'shared',versionName:'Baseline'},assets:[],geometries:[],layers:[],mountingRelations:[],topologyGraph:{nodes:[],edges:[]}},conflictFailure=false,resetFailure=false
  let user={id:'viewer',username:'viewer',email:null,role:'Viewer',online:false,lastSeenAt:null,updatedAt:'2026-10-10T00:00:00Z'}
  let preview={import:{name:'Tambahan',dataset_id:'shared',status:'ready'},summary:{addedAssets:0,addedRelations:0,existingAssets:1,conflicts:1},baseRevision:4,items:[],additions:{assets:[],relations:[]},conflicts:[{id:'conflict',kind:'asset',status:'conflict',reason:'identity_conflict',proposal:{name:'Kulkas'},result:{}}]}
  globalThis.fetch=async(url,options={})=>{
    requests.push({url,...options})
    if(url==='/api/import-config')return Response.json({datasets,maxFileSize:1000000})
    if(url==='/api/imports')return Response.json({imports:history})
    if(url.endsWith('/versions'))return Response.json({revision:4,currentVersionId:null,versions:[]})
    if(url.endsWith('/preview'))return Response.json(preview)
    if(url.endsWith('/refresh'))return Response.json({})
    if(url==='/api/imports/import')return Response.json({import:{status:'ready'}})
    if(url.includes('/items/')){
      if(conflictFailure)return Response.json({error:{message:'Data berubah; hitung ulang.'}},{status:409})
      preview={...preview,summary:{...preview.summary,conflicts:0},conflicts:[]};return Response.json({})
    }
    if(url.endsWith('/active'))return Response.json(baseline)
    if(url==='/api/admin/users')return Response.json({users:[{id:'admin',username:'admin',role:'Administrator'},user],serverTime:'2026-10-10T00:02:00Z'})
    if(url.endsWith('/password')){
      if(resetFailure)return Response.json({error:{message:'Data pengguna berubah.'}},{status:409})
      user={...user,updatedAt:'2026-10-10T00:03:00Z'};return Response.json({user,sessionsRevoked:true})
    }
    throw new Error('Unexpected '+url)
  }
  globalThis.XMLHttpRequest=class extends dom.window.EventTarget{
    constructor(){super();this.upload=new dom.window.EventTarget();xhrRequests.push(this)}
    open(method,url){this.method=method;this.url=url}
    setRequestHeader(){}
    send(form){this.form=form}
  }
  const settle=()=>new Promise(r=>setTimeout(r,15)),click=selector=>{const el=app.querySelector(selector);assert.ok(el,selector);el.click()},change=(el,value)=>{el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}))}
  const reset=()=>window.dispatchEvent(new dom.window.Event('pagehide'))
  try{
    saveSession({token:'session',user:{id:'admin',username:'admin',role:'Administrator'}})
    await t.test('upload drawer traps focus, blocks closing during upload and keeps a failed draft',async()=>{
      await renderImportDatasetPage(app);await settle()
      assert.equal(app.querySelector('[data-dataset-context]'),null)
      const header=app.querySelector('header'),opener=app.querySelector('[data-open-import]');opener.focus();opener.click()
      const form=app.querySelector('[data-import-form]'),layer=app.querySelector('[data-drawer="import-editor"]')
      assert.equal(document.activeElement,form.elements.versionName)
      change(form.elements.versionName,'Tambahan Oktober')
      const file=new dom.window.File(['<kml/>'],'tambahan.kmz',{type:'application/vnd.google-earth.kmz'})
      Object.defineProperty(form.elements.file,'files',{value:[file],configurable:true})
      const OriginalFormData=globalThis.FormData
      globalThis.FormData=class extends OriginalFormData{constructor(element){super(element);if(element===form)this.set('file',file)}}
      form.querySelector('[type=submit]').focus();document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))
      assert.equal(document.activeElement,layer.querySelector('.au-editor-heading button'))
      form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle()
      const xhr=xhrRequests.at(-1);assert.equal(xhr.form.get('datasetId'),'shared');assert.equal(xhr.form.get('versionName'),'Tambahan Oktober');assert.equal(xhr.form.get('file').name,'tambahan.kmz')
      xhr.upload.dispatchEvent(new dom.window.ProgressEvent('progress',{lengthComputable:true,loaded:50,total:100}));assert.match(app.querySelector('[data-upload-status]').textContent,/50%/)
      document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(layer.hidden,false);assert.equal(app.querySelector('[data-save-version]'),null)
      xhr.dispatchEvent(new dom.window.Event('error'));await settle();assert.match(app.querySelector('[data-upload-status]').textContent,/Koneksi terputus/)
      assert.equal(form.elements.versionName.value,'Tambahan Oktober');assert.equal(form.elements.file.files[0],file);assert.equal(app.querySelector('header'),header)
      document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(app.querySelector('[data-discard-confirm]').hidden,false)
      click('[data-keep-draft]');assert.equal(form.elements.versionName.value,'Tambahan Oktober')
      document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));click('[data-discard-draft]');assert.equal(layer.hidden,true);assert.equal(document.activeElement,opener);assert.equal(form.elements.versionName.value,'')
      globalThis.FormData=OriginalFormData
    })
    reset()
    await t.test('dataset selection filters import history and the upload form',async()=>{
      datasets=[{id:'one',name:'Satu'},{id:'two',name:'Dua'}];history=[{id:'first',dataset_id:'one',name:'Pertama',status:'applied'},{id:'second',dataset_id:'two',name:'Kedua',status:'ready'}]
      await renderImportDatasetPage(app);await settle()
      const selector=app.querySelector('[data-dataset-context]');selector.value='two';selector.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await settle()
      assert.match(app.querySelector('[data-import-history]').textContent,/Kedua/);assert.doesNotMatch(app.querySelector('[data-import-history]').textContent,/Pertama/)
      assert.equal(app.querySelector('[data-dataset-versions]'),null)
      click('[data-open-import]');assert.equal(app.querySelector('[data-import-form]').elements.datasetId.value,'two');assert.equal(selector.disabled,true)
      document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(selector.disabled,false)
    })
    reset()
    await t.test('conflict decisions preserve DOM, selections, focus and map camera',async()=>{
      const camera={center:[110,-7],zoom:19,bearing:0,pitch:0},surfaces=[]
      const factory=(host,model)=>{surfaces.push({host,model});return {getCamera:()=>camera,destroy(){}}}
      await renderPreviewImportPage(app,'import',{createSurface:factory});await settle()
      const header=app.querySelector('header'),mapHost=app.querySelector('[data-preview-map]'),checkbox=app.querySelector('[data-context]'),select=app.querySelector('[data-existing-asset]')
      conflictFailure=true;const skip=app.querySelector('[data-item-action="skip"]');skip.focus();skip.click();await settle()
      assert.match(app.querySelector('[data-preview-error]').textContent,/Data berubah/);assert.equal(app.querySelector('[data-existing-asset]'),select);assert.equal(document.activeElement,skip);assert.equal(surfaces.length,1)
      conflictFailure=false;skip.click();await settle();assert.equal(app.querySelector('header'),header);assert.equal(app.querySelector('[data-preview-map]'),mapHost);assert.equal(app.querySelector('[data-context]'),checkbox);assert.equal(surfaces.length,1);assert.equal(app.querySelector('[data-apply]').disabled,false)
      baseline={...baseline,layers:[{id:'new-layer',name:'Kulkas',defaultVisible:true}]}
      click('[data-refresh]');await settle()
      assert.ok(surfaces.length>=2);assert.deepEqual(surfaces.at(-1).model.initialCamera,camera)
    })
    reset()
    await t.test('password reset retains a stale draft and last administrator role stays protected',async()=>{
      await renderUsersPage(app);app.querySelector('[data-edit-user="admin"]').click();assert.equal(app.querySelector('[name=role]').disabled,true);assert.equal(app.querySelector('[name=active]'),null);assert.doesNotMatch(app.querySelector('.au-editor').textContent,/Akun aktif/)
      document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));click('[data-edit-user="viewer"]');click('[data-reset-password]')
      const form=app.querySelector('[data-user-form]');change(form.elements.password,'replacement123');resetFailure=true
      form.dispatchEvent(new dom.window.Event('submit',{bubbles:true}));await settle();assert.match(app.querySelector('[data-editor-error]').textContent,/Data pengguna berubah/);assert.equal(form.elements.password.value,'replacement123')
      resetFailure=false;form.dispatchEvent(new dom.window.Event('submit',{bubbles:true}));await settle();assert.equal(app.querySelector('.au-editor').hidden,true)
      const sent=requests.findLast(r=>r.url.endsWith('/password'));assert.deepEqual(JSON.parse(sent.body),{password:'replacement123',expectedUpdatedAt:'2026-10-10T00:00:00Z'})
    })
  }finally{reset();dom.window.close();for(const key of keys)globalThis[key]=prior[key]}
})
