import {test,expect} from './test.js'
import fixtures from '../../docs/react-migration/map-edit-fixtures.cjs'

async function setup(page,role='Administrator'){
 const state={payload:structuredClone(fixtures.active),failRead:false,failSave:false,writes:[],pending:null,readPending:null},errors=[],modules=[]
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>modules.push(request.url()))
 await page.addInitScript(user=>{sessionStorage.setItem('sinergiSessionToken','topology-test');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))},{...fixtures.user,role})
 await page.route('**/api/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname
  if(path.startsWith('/api/auth/'))return route.fulfill({json:{user:{...fixtures.user,role}}})
  if(path.endsWith('/active')){if(state.readPending)await state.readPending;return route.fulfill({status:state.failRead?503:200,json:state.failRead?{error:{message:'Pembacaan gagal'}}:state.payload})}
  if(path.endsWith('/topology/graph'))return route.fulfill({json:{graph:state.payload.topologyGraph}})
  if(path.endsWith('/diagram')&&request.method()==='POST'){
   const body=request.postDataJSON();state.writes.push(body);if(state.pending)await state.pending
   if(state.failSave)return route.fulfill({status:409,json:{error:{message:'Revision berubah'}}})
   for(const change of body.changes)if(change.type==='remove-edge')state.payload.topologyGraph.edges=state.payload.topologyGraph.edges.filter(edge=>(edge.id??edge.edgeId??edge.relationId)!==change.edgeId)
   state.payload.recordRevision++;state.payload.revision=state.payload.recordRevision
   return route.fulfill({json:{recordRevision:state.payload.recordRevision,graph:state.payload.topologyGraph,topologyFrameAssignments:{},topologyFrames:{},nodePositions:{},topologyFrameNames:{},mountingRelations:state.payload.mountingRelations||[]}})
  }
  throw new Error(`Unmocked topology API ${request.method()} ${path}`)
 })
 return {state,errors,modules}
}
async function open(page){await page.goto('/e2e/fixtures/topology-legacy.html?datasetId=dataset-semarang&area=ft-semarang&selectedAssetId=C-01',{waitUntil:'networkidle'});await expect(page.locator('[data-topology-frame] svg')).toBeVisible()}

test('legacy topology retains selection/search, area and Viewer read-only controls after extraction',async({page})=>{
 const {state,errors,modules}=await setup(page,'Viewer');await open(page);expect(modules.some(url=>url.includes('/pages/topology/topology-page.js'))).toBe(true);expect(modules.some(url=>url.includes('/react/topology/'))).toBe(false)
 await expect(page.getByRole('button',{name:'Tambah frame',exact:true})).toHaveCount(0);await expect(page.locator('[data-action="remove-relation"]')).toHaveCount(0)
 await page.getByRole('searchbox',{name:'Cari perangkat',exact:true}).fill('JB-01');await page.getByRole('listbox',{name:'Hasil pencarian diagram'}).getByRole('button').first().click();await expect(page).toHaveURL(/selectedAssetId=JB-01/)
 await page.getByRole('button',{name:'Perbesar diagram',exact:true}).click();await page.getByRole('button',{name:'Tampilkan seluruh diagram',exact:true}).click();expect(state.writes).toEqual([]);expect(errors).toEqual([])
})

test('draft cancel restores the relation; failed save retains draft and repeated retry sends once',async({page})=>{
 const {state,errors}=await setup(page);await open(page);await page.getByRole('button',{name:'Hapus relasi dengan SW-01'}).click();await expect(page.locator('[data-draft-count]')).toContainText('1 perubahan');expect(state.writes).toHaveLength(0)
 await page.getByRole('button',{name:'Batal',exact:true}).click();await expect(page.getByRole('button',{name:'Hapus relasi dengan SW-01'})).toBeVisible();await page.getByRole('button',{name:'Hapus relasi dengan SW-01'}).click()
 state.failSave=true;await page.getByRole('button',{name:'Simpan perubahan'}).click();await expect(page.locator('[data-draft-error]')).toHaveText('Revision berubah');expect(state.writes).toHaveLength(1);expect(state.writes[0]).toMatchObject({expectedRevision:fixtures.active.recordRevision,changes:[{type:'remove-edge',edgeId:'edge'}]})
 state.failSave=false;let release;state.pending=new Promise(resolve=>release=resolve);await page.getByRole('button',{name:'Simpan perubahan'}).dblclick();await expect.poll(()=>state.writes.length).toBe(2);release();state.pending=null;await expect(page.locator('[data-draft-bar]')).toBeHidden();expect(state.writes[1]).toEqual(state.writes[0]);expect(errors).toEqual([])
})

test('read error retries to empty state and ignores a pending load after pagehide',async({page})=>{
 const {state,errors}=await setup(page);state.failRead=true;await page.goto('/e2e/fixtures/topology-legacy.html');await expect(page.getByText('Pembacaan gagal')).toBeVisible();state.failRead=false;state.payload={...state.payload,assets:[],relations:[],topologyGraph:{nodes:[],edges:[]},topologyRoots:[]}
 await page.getByRole('button',{name:'Coba lagi',exact:true}).click();await expect(page.locator('[data-topology-frame]')).toContainText('Pilih area lain');let release;state.readPending=new Promise(resolve=>release=resolve)
 await page.evaluate(()=>{void import('/test-support/legacy/pages/topology/topology-page.js').then(module=>module.renderTopologyPage(document.querySelector('#app')))})
 await expect(page.getByRole('heading',{name:/Memuat/})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));release();state.readPending=null;await page.waitForTimeout(250);await expect(page.getByRole('heading',{name:/Memuat/})).toBeVisible();expect(errors).toEqual([])
})

test('remount cleans old handlers and disposal stops debounced search and SVG updates',async({page})=>{
 const {errors}=await setup(page);await open(page)
 await page.evaluate(async()=>{const module=await import('/test-support/legacy/pages/topology/topology-page.js');window.topologyDispose=await module.renderTopologyPage(document.querySelector('#app'))})
 const label=page.locator('[data-topology-zoom-label]'),before=parseInt(await label.textContent());await page.getByRole('button',{name:'Perbesar diagram',exact:true}).click();await expect(label).toHaveText(`${Math.min(before+10,135)}%`)
 await page.getByRole('searchbox',{name:'Cari perangkat',exact:true}).fill('not-found');await page.evaluate(()=>window.topologyDispose());const markup=await page.locator('[data-topology-frame]').innerHTML();await page.waitForTimeout(250);expect(await page.locator('[data-topology-frame]').innerHTML()).toBe(markup);expect(errors).toEqual([])
})
