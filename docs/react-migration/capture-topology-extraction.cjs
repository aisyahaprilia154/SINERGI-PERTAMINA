const fs=require('node:fs/promises'),{execFileSync}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict'),fixtures=require('./map-edit-fixtures.cjs')
async function main(){
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,channel:'chromium-headless-shell'}),output=path.join(__dirname,'stage-13',process.env.TOPOLOGY_CAPTURE_PHASE||'after'),results=[];await fs.mkdir(output,{recursive:true})
 try{for(const [size,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport,colorScheme:theme,locale:'id-ID',timezoneId:'Asia/Jakarta'}),page=await context.newPage(),errors=[],unexpected=[];let mode='overview'
  page.on('pageerror',error=>errors.push(error.message));await context.addInitScript(({theme,user})=>{localStorage.setItem('sinergi.theme',theme);sessionStorage.setItem('sinergiSessionToken','topology-visual-token');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))},{theme,user:fixtures.user})
  if(process.env.TOPOLOGY_CAPTURE_PHASE==='before'){const source=execFileSync('git',['show','bdb7358:frontend/src/pages/topology/topology-page.js'],{encoding:'utf8'});await page.route(/\/src\/pages\/topology\/topology-page\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:source}))}
  await page.route('**/api/**',route=>{const pathname=new URL(route.request().url()).pathname
   if(pathname.startsWith('/api/auth/'))return route.fulfill({json:{user:fixtures.user}})
   if(pathname.endsWith('/active'))return route.fulfill({status:mode==='error'?503:200,json:mode==='error'?{error:{message:'Dataset sementara tidak tersedia.'}}:mode==='empty'?{...fixtures.active,assets:[],relations:[],mountingRelations:[],topologyGraph:{nodes:[],edges:[]},topologyRoots:[]}:fixtures.active})
   if(pathname.endsWith('/topology/graph'))return route.fulfill({json:{graph:{nodes:[],edges:[]}}})
   unexpected.push(pathname);return route.fulfill({status:501,json:{}})
  })
  try{for(mode of (process.env.TOPOLOGY_CAPTURE_STATES||'overview,area,detail,search,empty,error').split(',')){
   await page.goto(`http://127.0.0.1:5173/topology?datasetId=dataset-semarang&area=${mode==='area'?'ft-semarang':'all'}${mode==='detail'?'&selectedAssetId=C-01':''}`,{waitUntil:'networkidle'})
   let fontReady=false;for(let attempt=0;attempt<3;attempt++){fontReady=await page.evaluate(async()=>{try{const faces=await document.fonts.load('24px "Material Symbols Outlined"');return faces.length>0&&faces.every(face=>face.status==='loaded')}catch{return false}});if(fontReady)break;await page.reload({waitUntil:'networkidle'})}assert.ok(fontReady)
   if(['overview','area','detail','search'].includes(mode))await page.locator('[data-topology-frame] svg').waitFor()
   if(mode==='search'){if(size==='mobile')await page.getByRole('button',{name:'Buka panel diagram',exact:true}).click();await page.getByRole('searchbox',{name:'Cari perangkat'}).fill('C-01');await page.getByRole('listbox',{name:'Hasil pencarian diagram'}).waitFor()}
   if(mode==='error')await page.getByText('Dataset sementara tidak tersedia.').waitFor()
   await page.waitForTimeout(500);const screenshot=`${mode}-${size}-${theme}.png`;await page.screenshot({path:path.join(output,screenshot),fullPage:true});results.push({state:mode,size,theme,screenshot})
  }assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(`Captured ${size}-${theme}`)}finally{await context.close()}
 }const prior=await fs.readFile(path.join(output,'capture-results.json'),'utf8').then(JSON.parse).catch(()=>({results:[]})),key=row=>[row.state,row.size,row.theme].join(':'),replaced=new Set(results.map(key));await fs.writeFile(path.join(output,'capture-results.json'),JSON.stringify({results:[...prior.results.filter(row=>!replaced.has(key(row))),...results]},null,2))}finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
