const fs=require('node:fs/promises'),crypto=require('node:crypto'),path=require('node:path'),assert=require('node:assert/strict'),fixtures=require('./map-edit-fixtures.cjs')
async function writeText(file,value){for(let attempt=0;attempt<5;attempt++){try{return await fs.writeFile(file,value)}catch(error){if(attempt===4)throw error;await new Promise(resolve=>setTimeout(resolve,250))}}}
async function main(){
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,channel:'chromium-headless-shell'}),output=path.join(__dirname,'stage-15'),results=[];await fs.mkdir(output,{recursive:true})
 try{for(const [size,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]])for(const theme of ['light','dark'])for(const implementation of (process.env.TOPOLOGY_CAPTURE_IMPLEMENTATIONS||'legacy,react').split(',')){
  const context=await browser.newContext({viewport,colorScheme:theme,reducedMotion:'reduce',locale:'id-ID',timezoneId:'Asia/Jakarta'}),page=await context.newPage(),errors=[],unexpected=[];let mode='overview'
  page.on('dialog',dialog=>dialog.accept());page.on('pageerror',error=>errors.push(error.message));await context.addInitScript(({theme,user})=>{crypto.randomUUID=()=> '11111111-1111-4111-8111-111111111111';localStorage.setItem('sinergi.theme',theme);sessionStorage.setItem('sinergiSessionToken','topology-visual-token');sessionStorage.setItem('sinergiSessionUser',JSON.stringify({...user,role:'Administrator'}))},{theme,user:fixtures.user})
  await page.route('**/api/**',route=>{const pathname=new URL(route.request().url()).pathname
   if(pathname.startsWith('/api/auth/'))return route.fulfill({json:{user:{...fixtures.user,role:'Administrator'}}})
   if(pathname.endsWith('/active'))return route.fulfill({status:mode==='error'?503:200,json:mode==='error'?{error:{message:'Dataset sementara tidak tersedia.'}}:mode==='empty'?{...fixtures.active,assets:[],relations:[],mountingRelations:[],topologyGraph:{nodes:[],edges:[]},topologyRoots:[]}:fixtures.active})
   if(pathname.endsWith('/topology/graph'))return route.fulfill({json:{graph:{nodes:[],edges:[]}}})
   unexpected.push(`${route.request().method()} ${pathname}`);return route.fulfill({status:501,json:{}})
  })
  try{for(mode of (process.env.TOPOLOGY_CAPTURE_STATES||'detail,composer,draft,export,rename').split(',')){
   const area=['area','detail','legend','composer','draft','export','rename'].includes(mode)?'ft-semarang':'all',url=`http://127.0.0.1:5173${implementation==='legacy'?'/e2e/fixtures/topology-legacy.html':'/topology'}?datasetId=dataset-semarang&area=${area}${['detail','draft','export'].includes(mode)?'&selectedAssetId=C-01':''}`
   await page.goto(url,{waitUntil:'networkidle'})
   let fontReady=false;for(let attempt=0;attempt<3;attempt++){fontReady=await page.evaluate(async()=>{try{const faces=await document.fonts.load('24px "Material Symbols Outlined"');return faces.length>0&&faces.every(face=>face.status==='loaded')}catch{return false}});if(fontReady)break;await page.reload({waitUntil:'networkidle'})}assert.ok(fontReady)
   if(!['empty','error'].includes(mode))await page.locator('[data-topology-frame] svg').waitFor()
   if(mode==='search'){if(size==='mobile')await page.getByRole('button',{name:'Buka panel diagram',exact:true}).click();await page.getByRole('searchbox',{name:'Cari perangkat'}).fill('C-01');await page.getByRole('listbox',{name:'Hasil pencarian diagram'}).waitFor()}
   if(mode==='legend')await page.getByRole('button',{name:'Tampilkan legenda diagram',exact:true}).click()
   if(mode==='composer')await page.getByRole('button',{name:'Tambah frame',exact:true}).click()
   if(mode==='draft'){await page.getByRole('button',{name:'Hapus relasi dengan SW-01'}).click();await page.getByRole('button',{name:'Tutup detail',exact:true}).click()}
   if(mode==='export'){if(size==='mobile')await page.getByRole('button',{name:'Tutup detail',exact:true}).click();await page.getByRole('button',{name:'Ekspor diagram',exact:true}).click()}
   if(mode==='rename'){await page.getByRole('button',{name:'Tambah frame',exact:true}).click();await page.getByRole('option',{name:/T-01/}).click();const label=page.locator('[data-frame-label][tabindex]').first();await label.evaluate(element=>element.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));await page.getByLabel('Nama frame',{exact:true}).fill('Ruang kontrol')}
   if(mode==='error')await page.getByText('Dataset sementara tidak tersedia.').waitFor()
   await page.waitForTimeout(500)
   const screenshot=`${implementation}-${mode}-${size}-${theme}.png`,crop=`${implementation}-${mode}-crop-${size}-${theme}.png`
   await page.screenshot({path:path.join(output,screenshot),fullPage:true})
   const target=page.locator(mode==='draft'?'.topology-draft-bar':mode==='detail'?'.topology-stitch-inspector':mode==='composer'?'.topology-frame-composer':mode==='export'?'.topology-stitch-export-panel':mode==='rename'?'.topology-frame-name-editor':mode==='search'?'.topology-sidebar':mode==='legend'?'.topology-legend-popover':mode==='error'?'.topology-stitch-state.error':'.topology-stitch-main');await target.screenshot({path:path.join(output,crop)})
   const svg=await page.locator('[data-topology-frame] svg').evaluateAll(elements=>elements[0]?.outerHTML||null)
   const svgFile=svg?`${implementation}-${mode}-${size}-${theme}.svg`:null;const rawSvgSha256=svg?crypto.createHash('sha256').update(svg).digest('hex'):null;if(svgFile)await writeText(path.join(output,svgFile),svg.split(/\r?\n/).map(line=>line.replace(/[ \t]+$/,'')).join('\n').trim()+'\n')
   const viewportMetrics=await page.evaluate(()=>{const viewport=document.querySelector('[data-topology-viewport]'),frame=document.querySelector('[data-topology-frame]');return viewport&&frame?{scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop,frameLeft:frame.style.left,frameTop:frame.style.top,transform:frame.style.transform,zoom:document.querySelector('[data-topology-zoom-label]')?.textContent}:null});results.push({implementation,state:mode,size,theme,screenshot,crop,svgFile,rawSvgSha256,viewportMetrics,reducedMotion:'reduce'})
  }assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(`Captured ${implementation} ${size}-${theme}`)}finally{await context.close()}
 }const prior=await fs.readFile(path.join(output,'capture-results.json'),'utf8').then(JSON.parse).catch(()=>({results:[]})),key=row=>[row.implementation,row.state,row.size,row.theme].join(':'),replaced=new Set(results.map(key));await writeText(path.join(output,'capture-results.json'),JSON.stringify({browserVersion:browser.version(),results:[...prior.results.filter(row=>!replaced.has(key(row))),...results]},null,2))}finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
