const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),fixtures=require('./map-edit-fixtures.cjs')
async function main(){
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.BASELINE_BROWSER_CHANNEL||'chromium-headless-shell'}),output=path.join(__dirname,'stage-11'),results=[];await fs.mkdir(output,{recursive:true})
 try{for(const [size,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]].filter(([size])=>!process.env.MAP_CAPTURE_SIZES||process.env.MAP_CAPTURE_SIZES.split(',').includes(size)))for(const theme of (process.env.MAP_CAPTURE_THEMES||'light,dark').split(','))for(const implementation of (process.env.MAP_CAPTURE_IMPLEMENTATIONS||'legacy,react').split(',')){
  const context=await browser.newContext({viewport,colorScheme:theme,locale:'id-ID',timezoneId:'Asia/Jakarta'}),page=await context.newPage(),errors=[],unexpected=[],modules=[];let mode='detail'
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>modules.push(request.url()))
  await context.addInitScript(({theme,user})=>{localStorage.setItem('sinergi.theme',theme);sessionStorage.setItem('sinergiSessionToken','map-visual-token');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))},{theme,user:fixtures.user})
  // Isolate the retained legacy entrypoint; never change the active route just for captures.
  if(implementation==='legacy')await page.route(/\/src\/main\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:"import '/src/legacy-main.js'"}))
  await page.route('**/api/**',route=>{const request=route.request(),pathname=new URL(request.url()).pathname
   if(request.method()!=='GET'&&!pathname.startsWith('/api/auth/')){unexpected.push(`${request.method()} ${pathname}`);return route.fulfill({status:501,json:{}})}
   if(pathname.startsWith('/api/auth/'))return route.fulfill({json:{user:fixtures.user}})
   if(pathname.endsWith('/active'))return route.fulfill({json:fixtures.active})
   if(pathname.includes('/active/assets/'))return route.fulfill({status:mode==='error'?500:200,json:mode==='error'?{error:{message:'Detail aset sementara tidak tersedia.'}}:{...fixtures.detail(decodeURIComponent(pathname.split('/').at(-1))),activePointer:{revision:4}}})
   if(pathname.endsWith('/planet'))return route.fulfill({json:fixtures.basemap})
   if(pathname.includes('/fonts/'))return route.fulfill({body:Buffer.alloc(0)})
   unexpected.push(pathname);return route.fulfill({status:501,json:{}})
  })
  try{for(mode of (process.env.MAP_CAPTURE_STATES||'detail,relation,mounting,icon,error').split(',')){
   modules.length=0
   await page.goto(`http://127.0.0.1:5173${implementation==='legacy'?'/map':'/e2e/fixtures/map.html'}?datasetId=dataset-semarang&selectedAssetId=C-01`,{waitUntil:'networkidle'})
   await page.locator('.maplibregl-canvas').waitFor();assert.ok(modules.some(url=>url.includes(implementation==='legacy'?'/src/pages/map/map-page.js':'/src/react/map/MapReadPage.jsx')))
   let fontReady=false;for(let attempt=0;attempt<3;attempt++){fontReady=await page.evaluate(async()=>{try{const faces=await document.fonts.load('24px "Material Symbols Outlined"');return faces.length>0&&faces.every(face=>face.status==='loaded')}catch{return false}});if(fontReady)break;await page.reload({waitUntil:'networkidle'})}assert.ok(fontReady,'Material Symbols must load before visual comparison')
   if(mode==='error')await page.getByText('Detail aset sementara tidak tersedia.').waitFor({state:'attached'})
   else await page.getByRole('button',{name:'Ubah ikon aset',includeHidden:true}).waitFor({state:'attached'})
   if(size==='mobile')await page.getByRole('button',{name:'Perluas detail aset'}).click()
   if(mode==='relation'){await page.getByRole('button',{name:'Tambah atau ganti relasi'}).click();await page.getByRole('searchbox',{name:'Cari aset untuk menambah relasi'}).fill('JB-01')}
   if(mode==='mounting'){await page.getByRole('button',{name:'Tambah tiang'}).click();await page.getByRole('searchbox',{name:'Cari tiang'}).fill('T-01')}
   if(mode==='icon')await page.getByRole('button',{name:'Ubah ikon aset'}).click()
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500)
   const screenshot=`${implementation}-${mode}-${size}-${theme}.png`;await page.screenshot({path:path.join(output,screenshot),fullPage:true});await page.locator('.asset-drawer').screenshot({path:path.join(output,`${implementation}-${mode}-drawer-${size}-${theme}.png`)});results.push({implementation,state:mode,size,theme,screenshot})
  }assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(`Captured ${implementation} detail ${size}-${theme}`)}finally{await context.close()}
 }const previous=await fs.readFile(path.join(output,'capture-results.json'),'utf8').then(JSON.parse).catch(()=>({results:[]})),key=row=>[row.implementation,row.state,row.size,row.theme].join(':'),replaced=new Set(results.map(key));await fs.writeFile(path.join(output,'capture-results.json'),JSON.stringify({results:[...previous.results.filter(row=>!replaced.has(key(row))),...results]},null,2))}finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
