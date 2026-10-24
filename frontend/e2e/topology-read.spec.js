import {test,expect} from './test.js'
import fixtures from '../../docs/react-migration/map-edit-fixtures.cjs'

async function setup(page,{role='Administrator',failure=0}={}){
 const state={payload:structuredClone(fixtures.active),failure,pending:null,calls:[],errors:[],modules:[]}
 page.on('pageerror',error=>state.errors.push(error.message));page.on('request',request=>state.modules.push(request.url()))
 await page.addInitScript(user=>{sessionStorage.setItem('sinergiSessionToken','topology-react-test');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))},{...fixtures.user,role})
 await page.route('**/api/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;state.calls.push({path,method:request.method()})
  if(path.startsWith('/api/auth/'))return route.fulfill({json:{user:{...fixtures.user,role}}})
  if(path.endsWith('/active')){if(state.pending)await state.pending;return route.fulfill({status:state.failure||200,json:state.failure?{error:{message:'Dataset gagal dibaca'}}:state.payload})}
  if(path.endsWith('/topology/graph'))return route.fulfill({json:{graph:state.payload.topologyGraph}})
  throw new Error(`Unexpected topology read API ${request.method()} ${path}`)
 })
 return state
}
async function open(page,query='area=ft-semarang'){await page.goto(`/e2e/fixtures/topology.html?datasetId=dataset-semarang&${query}`,{waitUntil:'networkidle'});await expect(page.locator('[data-react-topology-read] [data-topology-frame] svg')).toBeVisible()}

test('prepared topology reads through the real SVG adapter without legacy UI or write requests',async({page})=>{
 const state=await setup(page);await open(page);expect(state.modules.some(url=>url.includes('/react/topology/TopologyReadPage.jsx'))).toBe(true);expect(state.modules.some(url=>url.includes('/pages/topology/topology-page.js'))).toBe(false)
 await expect(page.getByRole('button',{name:'Tambah frame',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Ekspor diagram',exact:true})).toBeDisabled()
 await page.locator('[data-topology-frame]').evaluate(element=>window.topologyFrame=element);await page.locator('[data-topology-frame] [data-node-id="C-01"]').click();await expect(page.getByRole('heading',{name:'C-01',exact:true})).toBeVisible();await expect(page).toHaveURL(/selectedAssetId=C-01/)
 await expect(page.getByRole('link',{name:'Peta Aset',exact:true})).toHaveAttribute('href',/selectedAssetId=C-01/);await page.getByRole('button',{name:'Perbesar diagram',exact:true}).click();await expect(page.locator('[data-topology-zoom-label]')).not.toHaveText('100%')
 const camera=await page.locator('[data-topology-viewport]').evaluate(element=>{element.scrollTo({left:25,top:40,behavior:'instant'});return [element.scrollLeft,element.scrollTop]});await page.getByRole('button',{name:'Aktifkan mode gelap',exact:true}).click();expect(await page.locator('[data-topology-frame]').evaluate(element=>element===window.topologyFrame)).toBe(true);expect(await page.locator('[data-topology-viewport]').evaluate(element=>[element.scrollLeft,element.scrollTop])).toEqual(camera)
 await page.locator('[data-topology-frame] [data-edge-id]').first().focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Detail Relasi',exact:true})).toBeVisible()
 expect(state.calls.filter(call=>!call.path.startsWith('/api/auth/')).every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([])
})

test('search drills overview into a facility, focuses selection and supports result keyboard controls',async({page})=>{
 const state=await setup(page);await open(page,'area=all');await page.keyboard.press('Control+k');const search=page.getByRole('searchbox',{name:'Cari perangkat',exact:true});await expect(search).toBeFocused();await search.fill('C-01');await expect(page.getByRole('listbox',{name:'Hasil pencarian diagram'})).toContainText('C-01');await search.press('ArrowDown');await page.keyboard.press('Enter')
 await expect(page.getByRole('combobox',{name:'Cabang atau fasilitas'})).toHaveValue('ft-semarang');await expect(page.getByRole('heading',{name:'C-01',exact:true})).toBeVisible();await expect(search).toHaveValue('');await expect(page).toHaveURL(/area=ft-semarang/)
 await search.fill('missing-device');await expect(page.getByText('Perangkat tidak ditemukan.')).toBeVisible();await search.press('Escape');await expect(page.getByRole('listbox',{name:'Hasil pencarian diagram'})).toBeHidden();await page.getByRole('button',{name:'Tampilkan seluruh diagram'}).click();expect(state.errors).toEqual([])
})

test('mobile sidebar, legend, asset and relation inspection remain usable for a Viewer',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await setup(page,{role:'Viewer'});await open(page);await expect(page.getByRole('button',{name:'Tambah frame',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Buka panel diagram',exact:true}).click();await page.getByRole('searchbox',{name:'Cari perangkat'}).fill('C-01');await page.getByRole('searchbox',{name:'Cari perangkat'}).press('Enter');await expect(page.getByRole('heading',{name:'C-01',exact:true})).toBeVisible();await page.getByRole('button',{name:'Tutup detail',exact:true}).click()
 await page.getByRole('button',{name:'Tutup panel diagram',exact:true}).click();await expect(page.getByRole('button',{name:'Buka panel diagram',exact:true})).toBeFocused();await page.getByRole('button',{name:'Tampilkan legenda diagram',exact:true}).click();await expect(page.getByText('Legenda diagram',{exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Tampilkan legenda diagram',exact:true})).toBeFocused();expect(state.errors).toEqual([])
})

test('API loading/error/retry and empty dataset do not leave active navigation controls',async({page})=>{
 const state=await setup(page,{failure:503});await page.goto('/e2e/fixtures/topology.html');await expect(page.getByText('Dataset gagal dibaca')).toBeVisible();state.failure=0;state.payload={...state.payload,assets:[],relations:[],mountingRelations:[],topologyGraph:{nodes:[],edges:[]},topologyRoots:[]}
 await page.getByRole('button',{name:'Coba lagi',exact:true}).click();await expect(page.locator('[data-topology-frame]')).toContainText('Pilih area lain');await expect(page.getByRole('button',{name:'Perbesar diagram',exact:true})).toBeDisabled();expect(state.errors).toEqual([])
})

test('pagehide aborts pending reads and source icon work without a late mount',async({page})=>{
 const state=await setup(page);let release;state.pending=new Promise(resolve=>release=resolve);await page.goto('/e2e/fixtures/topology.html',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Memuat dataset aktif'})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));release();state.pending=null;await page.waitForTimeout(250);await expect(page.locator('[data-topology-frame]')).toHaveCount(0);expect(state.errors).toEqual([])
})

test('production topology aliases retain their legacy renderer until stage 15',async({page})=>{
 const state=await setup(page);await page.goto('/topologi?datasetId=dataset-semarang&area=ft-semarang',{waitUntil:'networkidle'});await expect(page.locator('[data-topology-frame] svg')).toBeVisible();expect(state.modules.some(url=>url.includes('/pages/topology/topology-page.js'))).toBe(true);expect(state.modules.some(url=>url.includes('/react/topology/TopologyReadPage.jsx'))).toBe(false)
})
