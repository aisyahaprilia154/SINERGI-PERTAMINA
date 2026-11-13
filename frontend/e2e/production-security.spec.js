import {test,expect} from './test.js'
import {setupSpa} from './support/spa-api.js'

test('production CSP permits map workers, import preview, and SVG/PNG exports while blocking inline scripts',async({page})=>{
 test.skip(!process.env.SINERGI_E2E_BASE_URL,'Runs against the separately built nginx image, not the Vite development server.')
 const state=await setupSpa(page)
 await page.addInitScript(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push({directive:event.effectiveDirective,blocked:event.blockedURI}))})
 const response=await page.goto('/map?datasetId=dataset-semarang&area=ft-semarang',{waitUntil:'networkidle'})
 const policy=response.headers()['content-security-policy']
 expect(policy).toContain("script-src 'self'");expect(policy).not.toContain('unsafe-eval');expect(policy).not.toContain('*')
 expect(response.headers()['x-frame-options']).toBe('DENY')
 expect(response.headers()['x-content-type-options']).toBe('nosniff')
 await expect(page.locator('.maplibregl-canvas')).toBeVisible()
 expect(await page.evaluate(()=>new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob(["postMessage('worker-ready')"],{type:'text/javascript'})),worker=new Worker(url);worker.onmessage=e=>{worker.terminate();URL.revokeObjectURL(url);resolve(e.data)};worker.onerror=e=>{worker.terminate();URL.revokeObjectURL(url);reject(new Error(e.message))}}))).toBe('worker-ready')
 await page.getByLabel('Daftar aset pada peta').getByRole('button',{name:'C-01',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Diagram topologi',exact:true}).click();await expect(page.locator('[data-topology-frame] svg')).toBeVisible();await expect(page).toHaveURL(/selectedAssetId=C-01/);await expect(page.locator('dialog.schematic-dialog')).toHaveCount(0)
 await page.getByRole('link',{name:'Peta Aset',exact:true}).click();await page.getByRole('button',{name:'Tutup detail aset',exact:true}).click()
 await page.getByLabel('Aksi data peta').click();await page.getByRole('button',{name:'Import data peta',exact:true}).click();await expect(page.getByRole('dialog',{name:'Impor dan ekspor'})).toBeVisible();await page.getByRole('link',{name:'Buka riwayat impor'}).click();await page.getByRole('link',{name:'Preview',exact:true}).click();await expect(page.locator('[data-preview-name]')).toHaveText('Tambahan CCTV');await expect(page.locator('.maplibregl-canvas')).toBeVisible()
 await page.getByRole('link',{name:'Diagram Topologi',exact:true}).click();await expect(page.locator('[data-topology-frame] svg')).toBeVisible()
 for(const kind of ['SVG','PNG']){await page.getByRole('button',{name:'Ekspor diagram',exact:true}).click();const pending=page.waitForEvent('download');await page.getByRole('button',{name:new RegExp(`${kind} resolusi tinggi`)}).click();expect(await (await pending).failure()).toBeNull()}
 expect(await page.evaluate(()=>window.cspViolations)).toEqual([]);expect(state.errors).toEqual([])
 await page.evaluate(()=>{const script=document.createElement('script');script.textContent='window.untrustedScriptExecuted=true';document.body.append(script)})
 expect(await page.evaluate(()=>window.untrustedScriptExecuted)).toBeUndefined()
 await expect.poll(()=>page.evaluate(()=>window.cspViolations.some(v=>v.directive==='script-src-elem'&&v.blocked==='inline'))).toBe(true)
})
