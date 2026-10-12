import {test} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {saveSession} from '../src/services/account-session.js'
import {renderDatasetVersionsPage} from '../src/pages/admin/dataset-versions-page.js'

test('database version page saves/restores with focus and failure handling',async()=>{
 const dom=new JSDOM('<html><body><div id="app"></div></body></html>',{url:'http://localhost/admin/datasets/versions',pretendToBeVisual:true})
 const globals=['window','document','FormData','fetch','CustomEvent'],prior=Object.fromEntries(globals.map(k=>[k,globalThis[k]]))
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,FormData:dom.window.FormData,CustomEvent:dom.window.CustomEvent})
 const version=id=>({id,name:id,created_at:'2026-10-10T00:00:00Z',actor_name:'admin',summary:{assets:1376,relations:594}})
 let data={revision:4,currentVersionId:'B',versions:[version('B'),version('A')]},failList=false,failSave=false,stale=false,release=null,requests=[]
 globalThis.fetch=async(url,options={})=>{
  requests.push({url,...options})
  if(url==='/api/import-config')return Response.json({datasets:[{id:'shared'},{id:'other'}],maxFileSize:1000000})
  if(url==='/api/imports')return Response.json({imports:[]})
  if(url.endsWith('/restore')){await new Promise(resolve=>{release=resolve});data={...data,revision:5,currentVersionId:'A'};return Response.json({datasetId:'shared',revision:5,currentVersionId:'A'})}
  if(url.endsWith('/versions')&&options.method==='POST'){
   if(stale){data={...data,revision:6};return Response.json({error:{code:'revision_conflict',message:'Data berubah; muat ulang.'}},{status:409})}
   if(failSave)throw new Error('Disconnected')
   const body=JSON.parse(options.body),created={...version('C'),name:body.name}
   data={...data,currentVersionId:'C',versions:[created,...data.versions]};return Response.json({datasetId:'shared',revision:data.revision,existing:false,version:created},{status:201})
  }
  if(url.endsWith('/versions')){if(failList)throw new Error('Disconnected');return Response.json(data)}
  throw new Error('Unexpected '+url)
 }
 const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5))}assert.fail('UI did not settle')}
 const app=document.querySelector('#app'),click=selector=>{const el=app.querySelector(selector);assert.ok(el,selector);el.click()}
 try {
  saveSession({token:'test',user:{id:'a',username:'admin',role:'Administrator'}})
  await renderDatasetVersionsPage(app);await wait(()=>!app.querySelector('[data-save-version]').disabled)
  const header=app.querySelector('header'),selector=app.querySelector('[data-dataset-context]')
  assert.equal(app.querySelector('h1').textContent,'Versi database');assert.equal(app.querySelector('[data-import-form]'),null);assert.equal(app.querySelector('.user-menu-dropdown [aria-current=page] span:last-child').textContent,'Versi database')
  const save=app.querySelector('[data-save-version]');save.focus();save.click()
  let dialog=app.querySelector('[role=dialog]:not([hidden])'),input=dialog.querySelector('input');assert.equal(document.activeElement,input)
  input.value='C corrected';const submit=dialog.querySelector('[type=submit]');submit.focus()
  submit.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(document.activeElement,input)
  dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))
  await wait(()=>!app.querySelector('[role=dialog]:not([hidden])'))
  await wait(()=>app.querySelector('[data-version-state]').textContent.includes('C corrected'))
  assert.equal(document.activeElement,save);assert.equal(app.querySelector('header'),header)
  const saved=requests.find(r=>r.method==='POST'&&r.url.endsWith('/versions'));assert.deepEqual(JSON.parse(saved.body),{name:'C corrected',expectedRevision:4})
  click('[data-restore-version="A"]');dialog=app.querySelector('[role=dialog]:not([hidden])');assert.match(dialog.textContent,/Keadaan sekarang disimpan otomatis/)
  dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(app.querySelector('[role=dialog]:not([hidden])'),null);assert.equal(document.activeElement.dataset.restoreVersion,'A')
  click('[data-restore-version="A"]');dialog=app.querySelector('[role=dialog]:not([hidden])');dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))
  await wait(()=>release);assert.equal(selector.disabled,true)
  dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.ok(app.querySelector('[role=dialog]:not([hidden])'))
  release();await wait(()=>!app.querySelector('[role=dialog]:not([hidden])'));await wait(()=>app.querySelector('[data-version-state]').textContent.includes('“A”'))
  assert.equal(selector.disabled,false);assert.equal(window.localStorage.getItem('sinergi:revision:shared'),'5')
  assert.equal(requests.filter(r=>r.url==='/api/imports').length,0)
  failSave=true;click('[data-save-version]');dialog=app.querySelector('[role=dialog]:not([hidden])');input=dialog.querySelector('input');input.value='Keep dialog draft';dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))
  await wait(()=>dialog.querySelector('[data-dialog-status]').textContent.includes('Disconnected'));assert.equal(input.value,'Keep dialog draft')
  await wait(()=>!dialog.querySelector('[type=submit]').disabled);click('[data-cancel-version]');failSave=false
  stale=true;click('[data-save-version]');dialog=app.querySelector('[role=dialog]:not([hidden])');dialog.querySelector('input').value='Old revision';dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))
  await wait(()=>!app.querySelector('[role=dialog]:not([hidden])'));assert.match(app.querySelector('[data-version-status]').textContent,/Data berubah/)
  failList=true;window.dispatchEvent(new dom.window.Event('focus'));await wait(()=>app.querySelector('[data-version-state]').textContent.includes('belum diperbarui'));assert.equal(save.disabled,true)
  assert.equal(app.querySelector('header'),header)
 } finally {window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();for(const k of globals)globalThis[k]=prior[k]}
})
