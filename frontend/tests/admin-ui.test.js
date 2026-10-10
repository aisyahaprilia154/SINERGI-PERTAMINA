import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import {saveSession} from '../src/services/account-session.js'
import {renderTopNavigation} from '../src/components/app-header.js'
import {renderUsersPage} from '../src/pages/admin/users-page.js'
import {renderImportDatasetPage} from '../src/pages/admin/import-dataset-page.js'
import {renderPreviewImportPage} from '../src/pages/admin/preview-import-page.js'

test('admin shares navigation and retains working forms, focus and drafts',async t=>{
 const dom=new JSDOM('<html><body><div id="app"></div></body></html>',{url:'http://localhost/admin/users?datasetId=shared&area=Site+A',pretendToBeVisual:true})
 const globals=['window','document','FormData','CustomEvent','requestAnimationFrame','fetch'],before=Object.fromEntries(globals.map(k=>[k,globalThis[k]]))
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,FormData:dom.window.FormData,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window)})
 const admin={id:'a',username:'admin',name:'admin',role:'Administrator',active:true,online:true,updatedAt:'2026-10-10T00:00:00Z'},viewer={id:'v',username:'viewer',role:'Viewer',active:true,online:false,updatedAt:'2026-10-10T00:00:00Z'}
 let users=[admin,viewer],fail=false,requests=[]
 const preview={import:{name:'Tambahan',dataset_id:'shared',status:'ready'},summary:{addedAssets:0,addedRelations:0,existingAssets:1,conflicts:1},baseRevision:4,items:[],additions:{assets:[],relations:[]},conflicts:[{id:'conflict',kind:'asset',status:'conflict',reason:'identity_conflict',proposal:{name:'Kulkas'},result:{}}]}
 globalThis.fetch=async(url,options={})=>{
  requests.push({url,...options})
  if(fail)throw new Error('Disconnected')
  if(url==='/api/admin/users'&&(!options.method||options.method==='GET'))return Response.json({users,serverTime:'2026-10-10T00:02:00Z'})
  if(url==='/api/admin/users'&&options.method==='POST'){const body=JSON.parse(options.body);users=[...users,{...body,id:'new',updatedAt:admin.updatedAt}];return Response.json({user:users.at(-1)},{status:201})}
  if(url==='/api/import-config')return Response.json({datasets:[{id:'shared'}],maxFileSize:1000000})
  if(url==='/api/imports')return Response.json({imports:[]})
  if(url.endsWith('/preview'))return Response.json(preview)
  if(url.includes('/items/'))return Response.json({})
  if(url.includes('/topology/graph'))return Response.json({nodes:[],edges:[]})
  if(url.includes('/active'))return Response.json({assets:[],geometries:[],layers:[],mountingRelations:[],topologyGraph:{nodes:[],edges:[]}})
  throw new Error(`Unexpected ${options.method} ${url}`)
 }
 const app=document.querySelector('#app'),click=selector=>{const el=app.querySelector(selector);assert.ok(el,selector);el.click()},settle=()=>new Promise(r=>setTimeout(r,30))
 const change=(el,value)=>{el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}))}
 try{
  saveSession({token:'session',user:admin})
  await t.test('role, active tab and facility context are preserved by one header',()=>{
   app.innerHTML=renderTopNavigation('admin',{datasetId:'shared',area:'Site A'})
   assert.equal(app.querySelectorAll('header nav a').length,3);assert.equal(app.querySelector('header nav a.active').textContent.trim(),'manage_accountsAdminAdmin')
   assert.match(app.querySelector('a[href^="/topology"]').href,/datasetId=shared&area=Site\+A/)
   saveSession({token:'viewer',user:viewer});app.innerHTML=renderTopNavigation('map');assert.equal(app.querySelectorAll('header nav a').length,2);assert.equal(app.querySelector('header nav a.active').getAttribute('aria-current'),'page')
   saveSession({token:'session',user:admin})
  })
  await t.test('drawer protects draft, traps focus, restores focus and saves real form values',async()=>{
   await renderUsersPage(app);const header=app.querySelector('header'),opener=app.querySelector('[data-new-user]');opener.focus();opener.click()
   let form=app.querySelector('form');change(form.elements.username,'created');change(form.elements.password,'password123')
   click('[data-refresh]');await settle();assert.equal(app.querySelector('header'),header);assert.equal(form.elements.username.value,'created')
   document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(app.querySelector('[data-discard-confirm]').hidden,false)
   click('[data-cancel-discard]');assert.equal(form.elements.username.value,'created')
   const last=form.querySelector('[type=submit]');last.focus();document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(document.activeElement,app.querySelector('.au-editor [data-close-editor]'))
   form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(app.querySelector('.au-editor').hidden,true);assert.equal(document.activeElement,opener)
   const posted=requests.find(r=>r.method==='POST'&&r.url==='/api/admin/users');assert.equal(JSON.parse(posted.body).username,'created')
   opener.click();change(app.querySelector('form').elements.username,'discard');document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));click('[data-confirm-discard]');assert.equal(app.querySelector('.au-editor').hidden,true)
   fail=true;click('[data-refresh]');await settle();assert.equal(app.querySelectorAll('tbody .is-online').length,0);assert.match(app.querySelector('tbody').textContent,/Belum diperbarui/);fail=false
   click('[data-theme-toggle]');assert.equal(document.documentElement.dataset.theme,'dark');assert.equal(window.localStorage.getItem('sinergi.theme'),'dark')
   click('[data-user-account-trigger]');assert.equal(app.querySelector('.user-menu-dropdown').hidden,false);document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(app.querySelector('.user-menu-dropdown').hidden,true)
  })
  dom.window.dispatchEvent(new dom.window.Event('pagehide'))
  await t.test('import and preview keep the shared header while content changes',async()=>{
   await renderImportDatasetPage(app);assert.equal(app.querySelectorAll('header').length,1);assert.equal(app.querySelector('.admin-tabs a.active').textContent,'Impor');assert.ok(app.querySelector('[data-import-form]'))
   await renderPreviewImportPage(app,'import');const header=app.querySelector('header');click('[data-item-action="skip"]');await settle();assert.equal(app.querySelector('header'),header);assert.ok(requests.some(r=>r.method==='PATCH'&&r.url.endsWith('/items/conflict')))
   assert.equal(app.querySelector('.admin-back').getAttribute('href'),'/admin/datasets/import');assert.equal(app.querySelectorAll('main').length,1)
  })
 }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();for(const k of globals)globalThis[k]=before[k]}
})

test('responsive admin CSS uses the same tokens and header geometry in both themes',async()=>{
 const files=['base.css','app-tokens.css','app-header.css','admin-users.css','operational-import.css']
 const css=(await Promise.all(files.map(f=>readFile(new URL(`../src/styles/${f}`,import.meta.url),'utf8')))).map(s=>s.replace(/@import[^;]+;/g,'')).join('\n')
 for(const width of [1440,1024,768,390])for(const theme of ['light','dark']){
  const dom=new JSDOM(`<html data-theme="${theme}"><head><style>${css}</style></head><body class="admin-body"><div id="app">${renderTopNavigation('admin')}<div class="au-editor"></div></div></body></html>`)
  const style=dom.window.document.querySelector('style'),rules=[...style.sheet.cssRules]
  const flatten=items=>items.flatMap(rule=>{if(rule.type!==4)return [rule.cssText];const condition=rule.conditionText;if(condition.includes('pointer'))return [];const max=condition.match(/max-width:\s*(\d+)px/),min=condition.match(/min-width:\s*(\d+)px/);return (!max||width<=Number(max[1]))&&(!min||width>=Number(min[1]))?flatten([...rule.cssRules]):[]})
  style.textContent=flatten(rules).join('\n')
  const header=dom.window.document.querySelector('header'),computed=dom.window.getComputedStyle(header)
  assert.equal(computed.height,width<=620?'108px':'64px',`${width}/${theme}`)
  assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('.au-editor')).width,width<=700?'100%':'400px')
  if(width<=620)assert.equal(dom.window.getComputedStyle(header.querySelector('.nav-label')).display,'none')
  dom.window.close()
 }
})
