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
   for(const change of body.changes){
    if(change.type==='remove-edge')state.payload.topologyGraph.edges=state.payload.topologyGraph.edges.filter(edge=>(edge.id??edge.edgeId??edge.relationId)!==change.edgeId)
    if(change.type==='create-frame'){state.payload.topologyFrames??={};state.payload.topologyFrames[change.frame.id]=change.frame}
    if(change.type==='move-node'){state.payload.nodePositions??={};state.payload.nodePositions[change.assetId]={x:change.x,y:change.y}}
    if(change.type==='move-frame'){state.payload.topologyFrameAssignments??={};state.payload.topologyFrameAssignments[change.assetId]=change.frameId}
   }
   state.payload.recordRevision++;state.payload.revision=state.payload.recordRevision
   return route.fulfill({json:{recordRevision:state.payload.recordRevision,graph:state.payload.topologyGraph,topologyFrameAssignments:state.payload.topologyFrameAssignments??{},topologyFrames:state.payload.topologyFrames??{},nodePositions:state.payload.nodePositions??{},topologyFrameNames:state.payload.topologyFrameNames??{},mountingRelations:state.payload.mountingRelations||[]}})
  }
  throw new Error(`Unmocked topology API ${request.method()} ${path}`)
 })
 return {state,errors,modules}
}
async function open(page){await page.goto('/topology?datasetId=dataset-semarang&area=ft-semarang&selectedAssetId=C-01',{waitUntil:'networkidle'});await expect(page.locator('[data-topology-frame] svg')).toBeVisible()}


test('React topology edits relations, preserves revision conflicts and serializes repeated saves',async({page})=>{
 const {state,errors,modules}=await setup(page);await open(page);expect(modules.some(url=>url.includes('/pages/topology/topology-page.js'))).toBe(false)
 await page.getByRole('button',{name:'Hapus relasi dengan SW-01'}).click();await expect(page.locator('[data-draft-count]')).toHaveText('1 perubahan belum disimpan');await page.getByRole('button',{name:'Batal',exact:true}).click();await expect(page.getByRole('button',{name:'Hapus relasi dengan SW-01'})).toBeVisible()
 await page.getByPlaceholder('Cari aset untuk dihubungkan…').fill('JB-01');await page.getByRole('listbox',{name:'Aset yang dapat dihubungkan'}).getByRole('button').click();await expect(page.getByRole('button',{name:'Hapus relasi dengan JB-01'})).toBeVisible();await page.getByRole('button',{name:'Batal',exact:true}).click()
 await page.getByRole('button',{name:'Hapus relasi dengan SW-01'}).click();state.failSave=true;await page.getByRole('button',{name:'Simpan perubahan'}).click();await expect(page.locator('[data-draft-error]')).toHaveText('Revision berubah');expect(state.writes[0]).toMatchObject({expectedRevision:fixtures.active.recordRevision,changes:[{type:'remove-edge',edgeId:'edge'}]})
 state.failSave=false;let release;state.pending=new Promise(resolve=>release=resolve);await page.getByRole('button',{name:'Simpan perubahan'}).dblclick();await expect.poll(()=>state.writes.length).toBe(2);release();state.pending=null;await expect(page.locator('[data-draft-bar]')).toBeHidden();expect(state.writes[1]).toEqual(state.writes[0]);expect(errors).toEqual([])
})
test('frame creation, rename, moving assets and saved documents survive reload',async({page})=>{
 const {state,errors}=await setup(page);await open(page);await page.getByRole('button',{name:'Tutup detail',exact:true}).click()
 await page.getByRole('button',{name:'Tambah frame',exact:true}).click();await expect(page.getByRole('searchbox',{name:'Cari jenis frame atau tiang'})).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('[data-draft-bar]')).toBeHidden()
 await page.getByRole('button',{name:'Tambah frame',exact:true}).click();await page.getByRole('option',{name:/Indoor/}).click();const id=await page.locator('[data-topology-frame] [data-frame-label]').evaluateAll(items=>items.find(item=>item.dataset.frameLabel.includes(':custom:')).dataset.frameLabel)
 await page.locator(`[data-frame-label="${id}"]`).focus();await page.keyboard.press('Enter');await page.getByLabel('Nama frame',{exact:true}).fill('Ruang kontrol');await page.getByRole('button',{name:'Terapkan nama'}).click();await expect(page.locator(`[data-frame-label="${id}"]`)).toContainText('Ruang kontrol')
 await page.getByRole('searchbox',{name:'Cari perangkat',exact:true}).fill('C-01');await page.getByRole('searchbox',{name:'Cari perangkat',exact:true}).press('Enter');await page.getByLabel('Pindahkan ke frame').selectOption(id);await page.getByRole('button',{name:'Simpan perubahan'}).click();await expect(page.locator('[data-draft-bar]')).toBeHidden();expect(state.writes[0].changes).toContainEqual({type:'move-frame',assetId:'C-01',frameId:id});expect(state.payload.topologyFrames[id].name).toBe('Ruang kontrol')
 await page.reload({waitUntil:'networkidle'});await expect(page.locator(`[data-frame-label="${id}"]`)).toContainText('Ruang kontrol');expect(errors).toEqual([])
})
test('drag connects assets without pointer-motion UI redraws and cancellation never stages a drop',async({page})=>{
 const {state,errors}=await setup(page);await open(page);await page.getByRole('button',{name:'Tutup detail',exact:true}).click();await page.getByRole('button',{name:'Tampilkan seluruh diagram'}).click();await page.waitForTimeout(400)
 const camera=page.locator('[data-topology-frame] [data-node-id="C-01"]'),target=page.locator('[data-topology-frame] [data-node-id="JB-01"]');const from=await camera.boundingBox(),to=await target.boundingBox();expect(from).not.toBeNull();expect(to).not.toBeNull()
 await camera.evaluate(node=>{window.dragSource=node;window.dragMutations=0;window.dragObserver=new MutationObserver(()=>window.dragMutations++);window.dragObserver.observe(document.querySelector('.topology-stitch-toolbar'),{subtree:true,childList:true,characterData:true})})
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:12});await expect(page.locator('.topology-drag-ghost')).toHaveCount(1);expect(await camera.evaluate(node=>node===window.dragSource)).toBe(true);expect(await page.evaluate(()=>window.dragMutations)).toBe(0)
 await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.topology-drag-ghost')).toHaveCount(0);await expect(page.locator('[data-draft-bar]')).toBeHidden()
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:12});await page.mouse.up();await expect(page.locator('[data-draft-count]')).toHaveText('1 perubahan belum disimpan');expect(state.writes).toHaveLength(0);await page.getByRole('button',{name:'Batal',exact:true}).click();expect(errors).toEqual([])
})
test('Viewer can export SVG and PNG while edits remain unavailable',async({page})=>{
 const {state,errors}=await setup(page,'Viewer');await open(page);await expect(page.getByRole('button',{name:'Tambah frame',exact:true})).toHaveCount(0);await expect(page.getByLabel('Pindahkan ke frame')).toHaveCount(0)
 for(const kind of ['SVG','PNG']){await page.getByRole('button',{name:'Ekspor diagram',exact:true}).click();const pending=page.waitForEvent('download',{timeout:5000});await page.getByRole('button',{name:new RegExp(`${kind} resolusi tinggi`)}).click();const download=await pending.catch(async error=>{throw new Error(`${error.message}; toast=${await page.locator('.topology-stitch-toast').textContent()}`)});expect(await download.failure()).toBeNull();expect(download.suggestedFilename()).toMatch(new RegExp(`sinergi-topologi-.*[.]${kind.toLowerCase()}$`))}
 expect(state.writes).toHaveLength(0);expect(errors).toEqual([])
})
test('unsaved navigation is guarded and pagehide cancels an in-flight save without late redraw',async({page})=>{
 const {state,errors}=await setup(page);await open(page);await page.getByRole('button',{name:'Hapus relasi dengan SW-01'}).click();const dialog=page.waitForEvent('dialog').then(async dialog=>{expect(dialog.type()).toBe('beforeunload');await dialog.dismiss()});await Promise.all([dialog,page.getByRole('link',{name:'Peta Aset',exact:true}).click()]);await expect(page).toHaveURL(/topology/)
 let release;state.pending=new Promise(resolve=>release=resolve);await page.getByRole('button',{name:'Simpan perubahan'}).click();await expect.poll(()=>state.writes.length).toBe(1);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));const html=await page.locator('#app').innerHTML();release();state.pending=null;await page.waitForTimeout(250);expect(await page.locator('#app').innerHTML()).toBe(html);expect(errors).toEqual([])
})

test('node drag positions are saved with the draft and rendered again after reload',async({page})=>{
 const {state,errors}=await setup(page);await open(page);await page.getByRole('button',{name:'Tutup detail',exact:true}).click();await page.getByRole('button',{name:'Tambah frame',exact:true}).click();await page.getByRole('option',{name:/Indoor/}).click()
 const id=await page.locator('[data-frame-label]').evaluateAll(items=>items.find(item=>item.dataset.frameLabel.includes(':custom:')).dataset.frameLabel)
 await page.getByRole('searchbox',{name:'Cari perangkat',exact:true}).fill('C-01');await page.getByRole('searchbox',{name:'Cari perangkat',exact:true}).press('Enter');await page.getByLabel('Pindahkan ke frame').selectOption(id);await page.getByRole('button',{name:'Tutup detail',exact:true}).click();await page.getByRole('button',{name:'Tampilkan seluruh diagram'}).click();await page.waitForTimeout(400)
 const camera=page.locator('[data-topology-frame] [data-node-id="C-01"]'),from=await camera.boundingBox(),label=await page.locator(`[data-frame-label="${id}"]`).boundingBox()
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(label.x+label.width/2,label.y+label.height/2,{steps:10});await page.mouse.up();await expect(page.locator('[data-draft-count]')).toHaveText('3 perubahan belum disimpan');await page.getByRole('button',{name:'Simpan perubahan'}).click();await expect(page.locator('[data-draft-bar]')).toBeHidden()
 const position=state.payload.nodePositions['C-01'];expect(position).toMatchObject({x:expect.any(Number),y:expect.any(Number)});expect(state.writes[0].changes).toContainEqual({type:'move-node',assetId:'C-01',...position});await page.reload({waitUntil:'networkidle'});await expect(page.locator('[data-topology-frame] svg')).toBeVisible();const markup=await camera.innerHTML();expect(markup).toContain(`x="${position.x}`);expect(markup).toContain(`y="${position.y}`);expect(errors).toEqual([])
})
