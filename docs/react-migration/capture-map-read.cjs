const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict')
const {user,active,basemap}=require('./capture-baseline.cjs')
async function main(){
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.BASELINE_BROWSER_CHANNEL||'chromium-headless-shell'}),output=path.join(__dirname,'stage-10'),results=[];await fs.mkdir(output,{recursive:true})
 try{for(const [size,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]].filter(([size])=>!process.env.MAP_CAPTURE_SIZES||process.env.MAP_CAPTURE_SIZES.split(',').includes(size)))for(const theme of ['light','dark'])for(const implementation of (process.env.MAP_CAPTURE_IMPLEMENTATIONS || 'legacy,react').split(',')){
  const context=await browser.newContext({viewport,colorScheme:theme,locale:'id-ID',timezoneId:'Asia/Jakarta'}),page=await context.newPage(),errors=[],unexpected=[],modules=[];let mode='default'
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>modules.push(r.url()))
  await context.addInitScript(({theme,user})=>{localStorage.setItem('sinergi.theme',theme);sessionStorage.setItem('sinergiSessionToken','visual-map-token');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))},{theme,user})
  await page.route('**/api/**',route=>{const p=new URL(route.request().url()).pathname
   if(p.startsWith('/api/auth/'))return route.fulfill({json:{user}})
   if(p.endsWith('/active'))return route.fulfill({status:mode==='error'?500:200,json:mode==='error'?{error:{message:'Dataset belum tersedia.'}}:mode==='empty'?{...active,assets:[],geometries:[],relations:[],layers:[]}:active})
   if(p.endsWith('/planet'))return route.fulfill({json:basemap})
   if(p.includes('/fonts/'))return route.fulfill({body:Buffer.alloc(0)})
   unexpected.push(p);return route.fulfill({status:501,json:{}})
  })
  const url=implementation==='legacy'?'/map':'/e2e/fixtures/map.html'
  try{for(mode of ['default','networks','legend','basemap','search','empty','error']){
   await page.goto(`http://127.0.0.1:5173${url}?datasetId=dataset-semarang`,{waitUntil:'networkidle'})
   if(mode==='error')await page.getByRole('heading',{name:'Dataset aktif tidak dapat dimuat'}).waitFor()
   else{await page.locator('.maplibregl-canvas').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500)}
   assert.ok(modules.some(u=>u.includes(implementation==='legacy'?'/src/pages/map/map-page.js':'/src/react/map/MapReadPage.jsx')))
   if(mode==='networks'){if(size==='mobile')await page.getByRole('button',{name:'Layer',exact:true}).click();await page.getByRole('button',{name:'Buka subkategori Jaringan CCTV'}).click()}
   if(mode==='legend')await page.getByRole('button',{name:'Tampilkan legenda'}).click()
   if(mode==='basemap')await page.getByRole('button',{name:'Pilih tampilan peta dasar'}).click()
   if(mode==='search'){if(size==='mobile')await page.getByRole('button',{name:'Aset',exact:true}).click();await page.getByRole('combobox',{name:'Cari Asset ID, nama aset, lokasi, atau hostname'}).fill('C-01')}
   await page.evaluate(()=>document.fonts.ready)
   const screenshot=`${implementation}-${mode}-${size}-${theme}.png`;await page.screenshot({path:path.join(output,screenshot),fullPage:true});results.push({implementation,state:mode,size,theme,screenshot})
   const part={default:'[data-app-header]',networks:'.network-sidebar',legend:'.legend-popover',basemap:'.basemap-popover',search:'.sidebar-asset-search-results'}[mode]
   if(part)await page.locator(part).screenshot({path:path.join(output,`${implementation}-${mode}-part-${size}-${theme}.png`)})
  }assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(`Captured ${implementation} read map ${size}-${theme}`)}finally{await context.close()}
 }const previous=await fs.readFile(path.join(output,'capture-results.json'),'utf8').then(JSON.parse).catch(()=>({results:[]}));const key=r=>[r.implementation,r.state,r.size,r.theme].join(':');const replaced=new Set(results.map(key));await fs.writeFile(path.join(output,'capture-results.json'),JSON.stringify({results:[...previous.results.filter(r=>!replaced.has(key(r))),...results]},null,2))}finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
