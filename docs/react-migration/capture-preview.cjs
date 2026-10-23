const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict')
const fixtures = require('./capture-baseline.cjs')
async function main() {
 const {chromium}=require('playwright'), browser=await chromium.launch({headless:true,channel:process.env.BASELINE_BROWSER_CHANNEL || 'chromium-headless-shell'})
 const output=path.join(__dirname,'stage-8');await fs.mkdir(output,{recursive:true});const results=[]
 try { for (const [size,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) for(const theme of ['light','dark']) for(const implementation of ['legacy','react']) {
  const context=await browser.newContext({viewport,colorScheme:theme,locale:'id-ID',timezoneId:'Asia/Jakarta'}),page=await context.newPage(),errors=[],unexpected=[],modules=[]
  let state='ready';page.on('request',request=>modules.push(request.url()));page.on('pageerror',e=>errors.push(e.message))
  await context.addInitScript(({theme,user})=>{localStorage.setItem('sinergi.theme',theme);sessionStorage.setItem('sinergiSessionToken','visual-token');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))},{theme,user:fixtures.user})
  if(implementation==='legacy')await page.route(/\/src\/main\.js(?:\?.*)?$/,r=>r.fulfill({contentType:'text/javascript',body:"import '/src/legacy-main.js'"}))
  await page.route('**/api/**',r=>{
   const p=new URL(r.request().url()).pathname
   if(p.startsWith('/api/auth/'))return r.fulfill({json:{user:fixtures.user}})
   if(p.endsWith('/preview')){
    if(state==='error')return r.fulfill({status:500,json:{error:{message:'Preview belum tersedia.'}}})
    const preview=structuredClone(fixtures.preview)
    if(state==='conflict'){preview.summary.conflicts=1;preview.conflicts=[{id:'identity',kind:'asset',status:'conflict',reason:'identity_conflict',proposal:{name:'CCTV ambigu'},result:{candidates:['camera']}}]}
    if(state==='empty'){preview.items=[];preview.additions={assets:[],relations:[]};preview.summary.addedAssets=0}
    return r.fulfill({json:preview})
   }
   if(p.endsWith('/active'))return r.fulfill({json:fixtures.active})
   if(p.endsWith('/planet'))return r.fulfill({json:fixtures.basemap})
   if(p.includes('/fonts/'))return r.fulfill({body:Buffer.alloc(0)})
   unexpected.push(p);return r.fulfill({status:501,json:{}})
  })
  try {for(state of ['ready','conflict','empty','error']) {
   await page.goto('http://127.0.0.1:5173/admin/datasets/import/baseline-import/preview',{waitUntil:'networkidle'})
   if(state==='error')await page.locator('[data-preview-error]').filter({visible:true}).waitFor()
   else {await page.locator('[data-preview-name]').filter({hasText:'Tambahan CCTV'}).waitFor();await page.locator('.maplibregl-canvas').waitFor()}
   assert.ok(modules.some(url=>url.includes(implementation==='legacy'?'/src/pages/admin/preview-import-page.js':'/src/react/preview/PreviewPage.jsx')),`Wrong implementation: ${implementation}`)
   await page.evaluate(()=>document.fonts.ready)
   const screenshot=`${implementation}-${state}-${size}-${theme}.png`;await page.screenshot({path:path.join(output,screenshot),fullPage:true});results.push({implementation,state,size,theme,screenshot})
   if(state==='ready')for(const [part,selector] of [['header','header'],['additions','[data-additions]']])await page.locator(selector).screenshot({path:path.join(output,`${implementation}-${part}-${size}-${theme}.png`)})
   if(state==='conflict')await page.locator('[data-conflicts-section]').screenshot({path:path.join(output,`${implementation}-conflicts-${size}-${theme}.png`)})
  }assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(`Captured ${implementation} preview ${size}-${theme}`)}finally{await context.close()}
 }await fs.writeFile(path.join(output,'capture-results.json'),JSON.stringify({results},null,2))}finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
