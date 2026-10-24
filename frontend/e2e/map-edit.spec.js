import {test,expect} from './test.js'
import fixtures from '../../docs/react-migration/map-edit-fixtures.cjs'
async function setup(page,{role='Administrator',url='/map?datasetId=dataset-semarang',failure=0}={}){
 const state={payload:structuredClone(fixtures.active),writes:[],failure,detailFailure:0,pending:null,pendingId:null},errors=[],modules=[]
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>modules.push(request.url()))
 await page.addInitScript(user=>{sessionStorage.setItem('sinergiSessionToken','map-edit-token');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))},{...fixtures.user,role})
 await page.route(/^https:\/\/.*arcgisonline\.com\//,route=>route.fulfill({status:404,body:''}))
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname
  if(path.startsWith('/api/auth/'))return route.fulfill({json:{user:{...fixtures.user,role}}})
  if(path.endsWith('/active'))return route.fulfill({json:state.payload})
  if(path.endsWith('/diagram')||path.endsWith('/icon')){
   const body=request.postDataJSON();state.writes.push({method:request.method(),path,body})
   if(state.failure)return route.fulfill({status:state.failure,json:{error:{message:state.failure===409?'Revision usang':'Simpan gagal'}}})
   return route.fulfill({json:fixtures.mutate(state.payload,{...body,assetId:decodeURIComponent(path.split('/').at(-2))})})
  }
  if(path.includes('/active/assets/')){
   const id=decodeURIComponent(path.split('/').at(-1));if(state.pending&&id===state.pendingId)await state.pending
   return route.fulfill({status:state.detailFailure||200,json:state.detailFailure?{error:{message:'Detail gagal'}}:fixtures.detail(id,state.payload)})
  }
  if(path.endsWith('/planet'))return route.fulfill({json:fixtures.basemap})
  if(path.includes('/fonts/'))return route.fulfill({body:Buffer.alloc(0)})
  if(path==='/api/import-config')return route.fulfill({json:{maxFileSize:60000000,datasets:[{id:'dataset-semarang',name:'SINERGI'}]}})
  throw new Error(`Unmocked ${request.method()} ${path}`)
 })
 await page.goto(url,{waitUntil:'networkidle'});await expect(page.locator('.maplibregl-canvas')).toBeVisible()
 return {state,errors,modules}
}
const drawer=page=>page.getByRole('complementary',{name:'Detail aset'})
async function select(page,id='C-01',admin=true){await page.getByLabel('Daftar aset pada peta').getByRole('button',{name:id,exact:true}).focus();await page.keyboard.press('Enter');if(admin)await expect(drawer(page).getByRole('button',{name:'Ubah ikon aset',includeHidden:true})).toBeEnabled();else await expect(drawer(page).getByText('Memuat data tambahan aset…')).toHaveCount(0)}
async function relationPicker(page){await drawer(page).getByRole('button',{name:'Tambah atau ganti relasi'}).click();await drawer(page).getByRole('searchbox',{name:'Cari aset untuk menambah relasi'}).fill('JB-01')}
test('active React map adds, atomically replaces and removes relations with increasing revisions and a stable canvas',async({page})=>{
 const {state,errors,modules}=await setup(page);expect(modules.some(url=>url.includes('/react/map/MapReadPage.jsx'))).toBe(true);expect(modules.some(url=>url.includes('/pages/map/map-page.js'))).toBe(false)
 await page.locator('.maplibregl-canvas').evaluate(canvas=>{window.editCanvas=canvas});await select(page);await relationPicker(page);await drawer(page).getByRole('option',{name:'Tambah relasi ke JB-01'}).click()
 await expect(drawer(page).getByRole('button',{name:'Hapus relasi dengan JB-01'})).toBeEnabled();expect(state.writes[0].body).toEqual({expectedRevision:4,changes:[{type:'add-relation',sourceAssetId:'C-01',targetAssetId:'JB-01'}]})
 await drawer(page).getByRole('button',{name:'Ganti relasi dengan SW-01'}).click();await drawer(page).getByRole('searchbox',{name:'Cari aset untuk mengganti relasi'}).fill('C-02');await drawer(page).getByRole('option',{name:'Ganti relasi dengan C-02'}).click()
 await expect(drawer(page).getByRole('button',{name:'Hapus relasi dengan C-02'})).toBeEnabled();expect(state.writes[1].body.changes).toEqual([{type:'remove-edge',edgeId:'edge'},{type:'add-relation',sourceAssetId:'C-01',targetAssetId:'C-02'}])
 await drawer(page).getByRole('button',{name:'Hapus relasi dengan C-02'}).click();await expect(drawer(page).getByText('Relasi berhasil dihapus.')).toBeVisible();expect(state.writes.map(write=>write.body.expectedRevision)).toEqual([4,5,6]);expect(await page.locator('.maplibregl-canvas').evaluate(canvas=>canvas===window.editCanvas)).toBe(true);expect(errors).toEqual([])
})
test('mobile detail expands, searches poles, assigns and detaches confirmed mounting',async({page})=>{
 await page.setViewportSize({width:390,height:844});const {state,errors}=await setup(page);await select(page);await drawer(page).getByRole('button',{name:'Perluas detail aset'}).click()
 await drawer(page).getByRole('button',{name:'Tambah tiang'}).click();await drawer(page).getByRole('searchbox',{name:'Cari tiang'}).fill('T-01');await drawer(page).getByRole('button',{name:/T-01.*jarak tidak tersedia/}).click()
 await expect(drawer(page).getByRole('button',{name:'Hapus relasi dengan tiang T-01'})).toBeEnabled();await drawer(page).getByRole('button',{name:'Hapus relasi dengan tiang T-01'}).click();await expect(drawer(page).getByRole('button',{name:'Tambah tiang'})).toBeEnabled();expect(state.writes.map(write=>write.body.changes[0].action)).toEqual(['assign','detach']);expect(errors).toEqual([])
})
test('real image preparation uploads then deletes an icon with a revision-only response',async({page})=>{
 const {state,errors}=await setup(page);await select(page)
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz0AAAAASUVORK5CYII=','base64')
 await drawer(page).getByLabel('File ikon aset').setInputFiles({name:'icon.png',mimeType:'image/png',buffer:png});await expect(drawer(page).getByText('Ikon diperbarui.')).toBeVisible();await expect(drawer(page).getByRole('button',{name:'Ubah ikon aset'})).toBeEnabled();expect(state.writes[0].body.dataUrl).toMatch(/^data:image\/png;base64,/)
 await drawer(page).getByRole('button',{name:'Ubah ikon aset'}).click();await expect(drawer(page).getByRole('button',{name:'Ganti ikon'})).toBeFocused();await drawer(page).getByRole('button',{name:'Hapus ikon'}).click();await expect(drawer(page).getByText('Ikon dihapus.')).toBeVisible();expect(state.writes[1]).toMatchObject({method:'DELETE',body:{expectedRevision:5,dataUrl:null}});expect(errors).toEqual([])
})
test('failure retains relation search; stale revision preserves draft and blocks another write',async({page})=>{
 const {state,errors}=await setup(page,{failure:500});await select(page);await relationPicker(page);await drawer(page).getByRole('option',{name:'Tambah relasi ke JB-01'}).click();await expect(drawer(page).getByText('Simpan gagal')).toBeVisible();await expect(drawer(page).getByRole('searchbox',{name:'Cari aset untuk menambah relasi'})).toHaveValue('JB-01')
 state.failure=409;await drawer(page).getByRole('option',{name:'Tambah relasi ke JB-01'}).click();await expect(page.getByText('Data sudah berubah. Muat ulang peta sebelum mencoba menyimpan kembali.')).toBeVisible();await expect(drawer(page).getByRole('option',{name:'Tambah relasi ke JB-01'})).toBeDisabled();expect(state.writes).toHaveLength(2);expect(errors).toEqual([])
})
test('Viewer map alias permits detail reading and transfer export without edit or import controls',async({page})=>{
 const {state,errors}=await setup(page,{role:'Viewer',url:'/peta/?datasetId=dataset-semarang'});await select(page,'C-01',false)
 await expect(drawer(page).getByRole('heading',{name:'Relasi aset'})).toBeVisible();await expect(drawer(page).getByRole('button',{name:'Ubah ikon aset'})).toHaveCount(0);await expect(drawer(page).getByRole('button',{name:/Hapus relasi/})).toHaveCount(0)
 await drawer(page).getByRole('button',{name:'Tutup detail aset'}).click();await page.getByLabel('Aksi data peta').click();await expect(page.getByRole('button',{name:'Import data peta'})).toHaveCount(0);await page.getByRole('button',{name:'Export data peta'}).click();await expect(page.getByRole('dialog').getByText('Ekspor KML operasional')).toBeVisible();await page.getByRole('button',{name:'Tutup',exact:true}).click();expect(state.writes).toEqual([]);expect(errors).toEqual([])
})
test('detail retry and switching selection ignore an old delayed detail response',async({page})=>{
 const {state,errors}=await setup(page);state.detailFailure=500
 await page.getByLabel('Daftar aset pada peta').getByRole('button',{name:'C-01',exact:true}).focus();await page.keyboard.press('Enter');await expect(drawer(page).getByText('Detail gagal')).toBeVisible();state.detailFailure=0;await drawer(page).getByRole('button',{name:'Coba lagi'}).click();await expect(drawer(page).getByRole('button',{name:'Ubah ikon aset'})).toBeEnabled()
 let release;state.pending=new Promise(resolve=>{release=resolve});state.pendingId='C-02'
 await page.getByLabel('Daftar aset pada peta').getByRole('button',{name:'C-02',exact:true}).focus();await page.keyboard.press('Enter');await expect(drawer(page).getByText('Memuat data tambahan aset…')).toBeVisible();await select(page,'JB-01');release();await expect(drawer(page).getByRole('heading',{name:'Detail aset JB-01'})).toBeVisible();expect(errors).toEqual([])
})
test('relation draft blocks closing and document unload; Escape closes picker before drawer',async({page})=>{
 const {errors}=await setup(page);await select(page);await relationPicker(page)
 page.once('dialog',dialog=>dialog.dismiss());await drawer(page).getByRole('button',{name:'Tutup detail aset'}).click();await expect(drawer(page).getByRole('searchbox',{name:'Cari aset untuk menambah relasi'})).toHaveValue('JB-01')
 await page.keyboard.press('Escape');await expect(drawer(page).getByRole('searchbox',{name:'Cari aset untuk menambah relasi'})).toHaveCount(0);await page.keyboard.press('Escape');await expect(drawer(page)).toHaveCount(0);expect(errors).toEqual([])
})
