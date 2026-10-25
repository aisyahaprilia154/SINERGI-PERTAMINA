import {test,expect} from './test.js'
import {setupSpa} from './support/spa-api.js'


async function map(page){await page.goto('/map?datasetId=dataset-semarang&area=ft-semarang',{waitUntil:'networkidle'});await expect(page.locator('.maplibregl-canvas')).toBeVisible();await page.evaluate(()=>window.spaDocument='same-document')}
async function admin(page,name){await page.getByRole('button',{name:/Menu akun/}).click();await page.getByRole('menuitem',{name,exact:true}).click()}

test('SPA keeps one document/session through all main protected pages and browser history',async({page})=>{
 const state=await setupSpa(page);await map(page);const checks=state.calls.filter(call=>call.path==='/api/auth/me').length
 await page.getByRole('link',{name:'Diagram Topologi',exact:true}).click();await expect(page.locator('[data-topology-frame] svg')).toBeVisible();await expect(page.locator('.maplibregl-canvas')).toHaveCount(0)
 await admin(page,'Kelola pengguna');await expect(page.getByText('viewer@example.test')).toBeVisible();await expect(page.locator('body')).toHaveClass('admin-body')
 await admin(page,'Versi database');await expect(page.locator('[data-save-version]')).toBeVisible();await admin(page,'Riwayat import');await expect(page.getByRole('table',{name:'Riwayat impor'})).toBeVisible()
 await page.goBack();await expect(page.locator('[data-save-version]')).toBeVisible();await page.goForward();await expect(page.getByRole('table',{name:'Riwayat impor'})).toBeVisible();await page.getByRole('link',{name:'Preview',exact:true}).click();await expect(page.locator('[data-preview-name]')).toHaveText('Tambahan CCTV');await page.getByRole('link',{name:'Riwayat import',exact:true}).click();await expect(page.getByRole('table',{name:'Riwayat impor'})).toBeVisible()
 await page.getByRole('link',{name:'Peta Aset',exact:true}).click();await expect(page.locator('.maplibregl-canvas')).toBeVisible();expect(await page.evaluate(()=>window.spaDocument)).toBe('same-document');expect(state.documents).toHaveLength(1);expect(state.calls.filter(call=>call.path==='/api/auth/me')).toHaveLength(checks);expect(state.errors).toEqual([])
})
test('Viewer mobile dark navigation and protected admin redirects remain in the same document',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});const state=await setupSpa(page,'Viewer');await map(page)
 await page.getByRole('link',{name:'Diagram Topologi',exact:true}).click();await expect(page.locator('[data-topology-frame] svg')).toBeVisible();await expect(page.getByRole('button',{name:'Tambah frame',exact:true})).toHaveCount(0);await page.goBack();await expect(page.locator('.maplibregl-canvas')).toBeVisible();await page.goForward();await expect(page.locator('[data-topology-frame] svg')).toBeVisible()
 await page.evaluate(()=>{const link=document.createElement('a');link.href='/admin/users';link.textContent='admin test';document.querySelector('#app').append(link);link.click();link.remove()});await expect(page).toHaveURL(/\/map/);await expect(page.locator('.maplibregl-canvas')).toBeVisible();expect(await page.evaluate(()=>window.spaDocument)).toBe('same-document');expect(state.documents).toHaveLength(1);expect(state.errors).toEqual([])
})
test('dirty topology protects internal links and browser Back without losing the draft',async({page})=>{
 const state=await setupSpa(page);await map(page);await page.getByRole('link',{name:'Diagram Topologi',exact:true}).click();await expect(page.locator('[data-topology-frame] svg')).toBeVisible();const search=page.getByRole('searchbox',{name:'Cari perangkat',exact:true});await search.fill('C-01');await search.press('Enter');await page.getByRole('button',{name:'Hapus relasi dengan SW-01'}).click()
 page.once('dialog',dialog=>{expect(dialog.type()).toBe('confirm');void dialog.dismiss()});await page.getByRole('link',{name:'Peta Aset',exact:true}).click();await expect(page.locator('[data-draft-count]')).toHaveText('1 perubahan belum disimpan')
 page.once('dialog',dialog=>void dialog.dismiss());await page.goBack();await expect(page).toHaveURL(/topology/);await expect(page.locator('[data-draft-count]')).toHaveText('1 perubahan belum disimpan')
 page.once('dialog',dialog=>void dialog.accept());await page.goBack();await expect(page.locator('.maplibregl-canvas')).toBeVisible();expect(await page.evaluate(()=>window.spaDocument)).toBe('same-document');expect(state.documents).toHaveLength(1);expect(state.errors).toEqual([])
 await page.getByRole('link',{name:'Diagram Topologi',exact:true}).click();await expect(page.locator('[data-topology-frame] svg')).toBeVisible();await page.getByRole('searchbox',{name:'Cari perangkat',exact:true}).fill('C-01');await page.getByRole('searchbox',{name:'Cari perangkat',exact:true}).press('Enter');await page.getByRole('button',{name:'Hapus relasi dengan SW-01'}).click();await page.getByRole('button',{name:/Menu akun/}).click();const logoutCalls=()=>state.calls.filter(call=>call.path==='/api/auth/logout').length;const beforeLogout=logoutCalls();page.once('dialog',dialog=>void dialog.dismiss());await page.getByRole('menuitem',{name:'Keluar',exact:true}).click();await expect(page.locator('[data-draft-count]')).toHaveText('1 perubahan belum disimpan');expect(logoutCalls()).toBe(beforeLogout);expect(await page.evaluate(()=>sessionStorage.getItem('sinergiSessionToken'))).toBe('spa-test');page.once('dialog',dialog=>void dialog.accept());await page.getByRole('menuitem',{name:'Keluar',exact:true}).click();await expect(page.locator('#login-form')).toBeVisible();expect(logoutCalls()).toBe(beforeLogout+1);expect(state.documents).toHaveLength(1);expect(state.errors).toEqual([])
})
test('map selection Back/Forward preserves its canvas and URL state inside the SPA',async({page})=>{
 const state=await setupSpa(page);await map(page);await page.locator('.maplibregl-canvas').evaluate(canvas=>window.initialCanvas=canvas)
 const select=async id=>{await page.getByLabel('Daftar aset pada peta').getByRole('button',{name:id,exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(new RegExp(`selectedAssetId=${id}`))}
 await select('C-01');await select('JB-01');await page.goBack();await expect(page).toHaveURL(/selectedAssetId=C-01/);await expect(page.getByRole('complementary',{name:'Detail aset'})).toContainText('C-01');await page.goForward();await expect(page).toHaveURL(/selectedAssetId=JB-01/);expect(await page.locator('.maplibregl-canvas').evaluate(canvas=>canvas===window.initialCanvas)).toBe(true);expect(state.documents).toHaveLength(1);expect(state.errors).toEqual([])
})
test('leaving a pending topology read aborts it and ignores its late result',async({page})=>{
 const state=await setupSpa(page);await map(page);let release;state.pending=new Promise(resolve=>release=resolve);await page.getByRole('link',{name:'Diagram Topologi',exact:true}).click();await expect(page.getByRole('heading',{name:'Memuat dataset aktif'})).toBeVisible();state.pending=null;await page.getByRole('link',{name:'Peta Aset',exact:true}).click();release();await expect(page.locator('.maplibregl-canvas')).toBeVisible();await expect(page.locator('[data-topology-frame]')).toHaveCount(0);expect(state.errors).toEqual([])
})

for(const role of ['Administrator','Viewer'])for(const path of ['/peta?datasetId=dataset-semarang&area=ft-semarang','/topologi?datasetId=dataset-semarang&area=ft-semarang','/admin/users','/admin/datasets/import/baseline-import/preview'])test(`direct URL and refresh ${role} ${path}`,async({page})=>{
 const state=await setupSpa(page,role);await page.goto(path,{waitUntil:'networkidle'});await page.reload({waitUntil:'networkidle'})
 if(role==='Viewer'&&path.startsWith('/admin/')){await expect(page).toHaveURL(/\/map/);await expect(page.locator('.maplibregl-canvas')).toBeVisible()}
 else if(path.startsWith('/peta'))await expect(page.locator('.maplibregl-canvas')).toBeVisible()
 else if(path.startsWith('/topologi'))await expect(page.locator('[data-topology-frame] svg')).toBeVisible()
 else if(path==='/admin/users')await expect(page.getByText('viewer@example.test')).toBeVisible()
 else await expect(page.locator('[data-preview-name]')).toHaveText('Tambahan CCTV')
 expect(state.errors).toEqual([])
})
