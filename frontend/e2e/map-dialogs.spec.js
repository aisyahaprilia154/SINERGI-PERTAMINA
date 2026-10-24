import {test,expect} from './test.js'
import {readFile} from 'node:fs/promises'
import fixtures from '../../docs/react-migration/map-edit-fixtures.cjs'
import {createMapReadModel} from '../src/domain/map-read-model.js'
import {collectSelectedNetworkAssetIds} from '../src/pages/map/active-dataset-kml-export.js'

async function setup(page,{role='Administrator'}={}){
 const state={calls:[],uploads:0,statusReads:0,failure:0,configFailure:0,processing:false,pollFailure:false,pending:null},errors=[],modules=[]
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>modules.push(request.url()))
 await page.addInitScript(user=>{
  sessionStorage.setItem('sinergiSessionToken','dialog-browser-token');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))
  window.dialogUrls={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL)
  URL.createObjectURL=blob=>{const url=create(blob);window.dialogUrls.created.push(url);return url};URL.revokeObjectURL=url=>{window.dialogUrls.revoked.push(url);revoke(url)}
 },{...fixtures.user,role})
 await page.route(/^https:\/\/.*arcgisonline\.com\//,route=>route.fulfill({status:404,body:''}))
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,method=request.method();state.calls.push({path,method,body:request.postData(),token:request.headers().authorization})
  if(path.startsWith('/api/auth/'))return route.fulfill({json:{user:{...fixtures.user,role}}})
  if(path.endsWith('/active'))return route.fulfill({json:fixtures.active})
  if(path.includes('/active/assets/'))return route.fulfill({json:fixtures.detail(decodeURIComponent(path.split('/').at(-1)))})
  if(path.endsWith('/planet'))return route.fulfill({json:fixtures.basemap})
  if(path.includes('/fonts/'))return route.fulfill({body:Buffer.alloc(0)})
  if(path==='/api/import-config')return route.fulfill({status:state.configFailure||200,json:state.configFailure?{error:{message:'Konfigurasi gagal'}}:{maxFileSize:1000000,datasets:[{id:'dataset-semarang',name:'SINERGI'}]}})
  if(path==='/api/imports'&&method==='POST'){state.uploads++;if(state.pending)await state.pending;return route.fulfill({status:state.failure||202,json:state.failure?{error:{message:'Unggah gagal'}}:{importId:'dialog import',statusUrl:'/api/jobs/dialog-status'}})}
  if(path==='/api/jobs/dialog-status'){state.statusReads++;if(state.pollFailure)return route.fulfill({status:503,json:{error:{message:'Status gagal'}}});return route.fulfill({json:{import:{id:'dialog import',status:state.processing?'processing':'ready'}}})}
  if(path.endsWith('/source-file'))return route.fulfill({body:Buffer.from('KMZ-source'),headers:{'content-type':'application/octet-stream','content-disposition':"attachment; filename*=UTF-8''Sumber%20%C3%A9.kmz"}})
  if(path.endsWith('/exports/kml'))return route.fulfill({body:`<?xml version="1.0"?><kml><Document><description>${JSON.stringify(request.postDataJSON().assetIds)}</description></Document></kml>`,contentType:'application/vnd.google-earth.kml+xml'})
  if(path.endsWith('/preview'))return route.fulfill({json:{...fixtures.preview,import:{...fixtures.preview.import,id:'dialog import'}}})
  throw new Error(`Unmocked dialog API ${method} ${path}`)
 })
 await page.goto('/map?datasetId=dataset-semarang',{waitUntil:'networkidle'});await expect(page.locator('.maplibregl-canvas')).toBeVisible()
 return {state,errors,modules}
}
async function openTransfer(page,mode='import'){
 await page.getByLabel('Aksi data peta').click();await page.getByRole('button',{name:mode==='import'?'Import data peta':'Export data peta'}).click()
 return page.getByRole('dialog',{name:'Impor dan ekspor'})
}
async function fillImport(page){await page.getByLabel('Nama impor').fill('Tambahan seminar');await page.getByLabel('File KML/KMZ').setInputFiles({name:'tambahan.kmz',mimeType:'application/vnd.google-earth.kmz',buffer:Buffer.from('KMZ')})}
async function openDiagram(page,asset=false){
 if(asset){await page.getByLabel('Daftar aset pada peta').getByRole('button',{name:'C-01',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Ubah ikon aset',includeHidden:true})).toBeEnabled();await page.getByRole('button',{name:'Diagram topologi',exact:true}).click()}
 else await page.locator('button.diagram-toggle').click()
 await expect(page.locator('dialog.schematic-dialog svg.schematic-svg')).toBeVisible();await expect(page.getByRole('button',{name:'Export SVG'})).toBeEnabled();return page.locator('dialog.schematic-dialog')
}
test('React transfer preserves failed upload draft/file and sends one upload to the returned preview',async({page})=>{
 const {state,errors,modules}=await setup(page);const dialog=await openTransfer(page);expect(await dialog.getAttribute('data-react-map-dialog')).not.toBeNull();expect(modules.some(url=>url.includes('/pages/map/map-data-transfer-dialog.js'))).toBe(false)
 state.failure=500;await fillImport(page);await dialog.getByRole('button',{name:'Unggah dan lihat preview'}).click();await expect(dialog.getByText('Unggah gagal')).toBeVisible();await expect(page.getByLabel('Nama impor')).toHaveValue('Tambahan seminar');expect(await page.getByLabel('File KML/KMZ').evaluate(input=>input.files[0].name)).toBe('tambahan.kmz')
 state.failure=0;state.processing=true;await dialog.getByRole('button',{name:'Unggah dan lihat preview'}).dblclick();await expect(dialog.getByRole('button',{name:'Unggah dan lihat preview'})).toBeDisabled();expect(state.uploads).toBe(2);state.processing=false;await expect(page).toHaveURL(/\/admin\/datasets\/import\/dialog%20import\/preview/);expect(errors).toEqual([])
})
test('config retry and native file validation block invalid writes; Escape preserves a declined draft',async({page})=>{
 const {state,errors}=await setup(page);state.configFailure=503;const dialog=await openTransfer(page);await expect(dialog.getByText('Konfigurasi gagal')).toBeVisible();await expect(dialog.getByRole('button',{name:'Unggah dan lihat preview'})).toBeDisabled();state.configFailure=0;await dialog.getByRole('button',{name:'Coba lagi konfigurasi'}).click();await expect(dialog.getByRole('button',{name:'Unggah dan lihat preview'})).toBeEnabled()
 await dialog.getByRole('button',{name:'Unggah dan lihat preview'}).click();expect(state.uploads).toBe(0);await fillImport(page);await dialog.getByRole('button',{name:'Ekspor data'}).click();await dialog.getByRole('button',{name:'Impor tambahan'}).click();await expect(page.getByLabel('Nama impor')).toHaveValue('Tambahan seminar')
 page.once('dialog',confirm=>confirm.dismiss());await page.keyboard.press('Escape');await expect(dialog).toBeVisible();page.once('dialog',confirm=>confirm.accept());await dialog.getByRole('button',{name:'Tutup',exact:true}).click();await expect(dialog).toHaveCount(0);expect(errors).toEqual([])
})
test('retrying job status keeps the upload ID and does not upload twice',async({page})=>{
 const {state,errors}=await setup(page);state.pollFailure=true;const dialog=await openTransfer(page);await fillImport(page);await dialog.getByRole('button',{name:'Unggah dan lihat preview'}).click();await expect(dialog.getByText('Status gagal')).toBeVisible();state.pollFailure=false;await dialog.getByRole('button',{name:'Coba lagi status impor'}).click();await expect(page).toHaveURL(/dialog%20import\/preview/);expect(state.uploads).toBe(1);expect(errors).toEqual([])
})
test('Viewer KML export uses selected network IDs, source filename survives and URL cleanup completes',async({page})=>{
 const {state,errors}=await setup(page,{role:'Viewer'}),model=createMapReadModel(fixtures.active),expected=collectSelectedNetworkAssetIds(model.networks,new Set(model.networks.map(network=>network.id)))
 const dialog=await openTransfer(page,'export');await expect(dialog.getByRole('button',{name:'Impor tambahan'})).toHaveCount(0)
 const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Ekspor KML operasional'}).click();const download=await downloadEvent;expect(await readFile(await download.path(),'utf8')).toContain('<kml>');expect(JSON.parse(state.calls.find(call=>call.path.endsWith('/exports/kml')).body)).toEqual({assetIds:expected})
 const sourceEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Unduh sumber terakhir'}).click();expect((await sourceEvent).suggestedFilename()).toBe('Sumber é.kmz');await dialog.getByRole('button',{name:'Tutup',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.dialogUrls.created.filter(url=>!window.dialogUrls.revoked.includes(url)).length)).toBe(0);expect(state.uploads).toBe(0);expect(errors).toEqual([])
})
test('empty network selection cannot export the whole dataset by accident',async({page})=>{
 const {state}=await setup(page);await page.getByRole('button',{name:'Sembunyikan Jaringan CCTV'}).click();const dialog=await openTransfer(page,'export');await dialog.getByRole('button',{name:'Ekspor KML operasional'}).click();await expect(dialog.getByText('Pilih jaringan berisi aset sebelum mengekspor KML.')).toBeVisible();expect(state.calls.filter(call=>call.path.endsWith('/exports/kml'))).toEqual([])
})
test('schematic dialog keeps the map canvas, supports scopes/search/zoom and downloads real SVG and PNG',async({page})=>{
 const {errors,modules}=await setup(page);await page.locator('.maplibregl-canvas').evaluate(canvas=>{window.dialogMapCanvas=canvas});const dialog=await openDiagram(page,true)
 await expect(dialog.getByRole('heading',{name:'Ringkasan aset'})).toBeVisible();await dialog.getByRole('tab',{name:/Topologi jaringan/}).click();await dialog.getByRole('tab',{name:/Jalur terpilih/}).click();await dialog.getByRole('tab',{name:/Seluruh aset/}).click()
 await dialog.getByRole('searchbox',{name:'Cari aset dalam diagram'}).fill('C-01');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(dialog.getByRole('heading',{name:'Relasi aset terpilih'})).toBeVisible();await dialog.getByRole('button',{name:'Perbesar diagram'}).click();await dialog.getByRole('button',{name:'Reset tampilan'}).click()
 const svgEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export SVG'}).click();const svg=await svgEvent,xml=await readFile(await svg.path(),'utf8');expect(xml).toContain('<svg');expect(xml).toContain('data:image/png;base64,');expect(svg.suggestedFilename()).toMatch(/\.svg$/)
 const pngEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export PNG'}).click();const png=await pngEvent,buffer=await readFile(await png.path());expect(buffer.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(buffer.readUInt32BE(16)).toBeGreaterThan(0);expect(buffer.readUInt32BE(16)).toBeLessThanOrEqual(8192);expect(buffer.readUInt32BE(16)*buffer.readUInt32BE(20)).toBeLessThanOrEqual(40000000)
 await dialog.getByRole('button',{name:'Kembali ke peta'}).click();expect(await page.locator('.maplibregl-canvas').evaluate(canvas=>canvas===window.dialogMapCanvas)).toBe(true);await expect.poll(()=>page.evaluate(()=>window.dialogUrls.created.filter(url=>!window.dialogUrls.revoked.includes(url)).length)).toBe(0);expect(modules.some(url=>url.includes('/pages/map/diagram-dialog.js'))).toBe(false);expect(errors).toEqual([])
})
test('mobile diagram uses fullscreen fallback, keyboard search and closes cleanly',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=async()=>{throw new Error('Fullscreen unavailable')}});const {errors}=await setup(page);const dialog=await openDiagram(page)
 await expect(dialog.getByRole('tab',{name:/Jalur terpilih/})).toBeDisabled();await dialog.getByRole('button',{name:'Buka ruang kerja diagram layar penuh'}).click();await expect(dialog.locator('.schematic-shell')).toHaveClass(/schematic-shell-fullscreen/);await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(dialog.locator('.schematic-shell')).not.toHaveClass(/schematic-shell-fullscreen/)
 await dialog.getByRole('searchbox').fill('no asset');await expect(dialog.getByText('Tidak ada aset yang cocok.')).toBeVisible();await page.keyboard.press('Escape');await dialog.getByRole('button',{name:'Tutup diagram'}).click();await expect(dialog).toHaveCount(0);expect(errors).toEqual([])
})
test('closing during processing aborts polling and external revisions do not discard the upload draft',async({page})=>{
 const {state,errors}=await setup(page);state.processing=true;const dialog=await openTransfer(page);await fillImport(page);await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'sinergi:revision:dataset-semarang',newValue:'5'})));await expect(dialog).toBeVisible();await expect(page.getByLabel('Nama impor')).toHaveValue('Tambahan seminar')
 await dialog.getByRole('button',{name:'Unggah dan lihat preview'}).click();await expect(dialog.getByText('Membaca file dan mencari tambahan…')).toBeVisible();const reads=state.statusReads;page.once('dialog',confirm=>confirm.accept());await dialog.getByRole('button',{name:'Tutup',exact:true}).click();await page.waitForTimeout(1400);expect(state.statusReads).toBe(reads);await expect(dialog).toHaveCount(0);expect(errors).toEqual([])
})
