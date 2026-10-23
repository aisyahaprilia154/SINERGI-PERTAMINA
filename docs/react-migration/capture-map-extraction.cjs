// Run after extraction; keep the earlier stage-8 screenshots in stage-9/before.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict')
const {user,active,basemap}=require('./capture-baseline.cjs')
async function main(){
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.BASELINE_BROWSER_CHANNEL||'chromium-headless-shell'}),output=path.join(__dirname,'stage-9/after'),results=[]
 try{for(const [size,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport,colorScheme:theme,locale:'id-ID',timezoneId:'Asia/Jakarta'}),page=await context.newPage(),errors=[],unexpected=[]
  page.on('pageerror',e=>errors.push(e.message))
  await context.addInitScript(({theme,user})=>{localStorage.setItem('sinergi.theme',theme);sessionStorage.setItem('sinergiSessionToken','mock-map-token');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))},{theme,user})
  await page.route('**/api/**',route=>{const p=new URL(route.request().url()).pathname
   if(p.startsWith('/api/auth/'))return route.fulfill({json:{user}})
   if(p.endsWith('/active'))return route.fulfill({json:active})
   if(p.endsWith('/planet'))return route.fulfill({json:basemap})
   if(p.includes('/fonts/'))return route.fulfill({body:Buffer.alloc(0)})
   unexpected.push(p);return route.fulfill({status:501,json:{}})
  })
  try{await page.goto('http://127.0.0.1:5173/map',{waitUntil:'networkidle'});await page.locator('.maplibregl-canvas').waitFor();await page.evaluate(()=>document.fonts.ready)
   await page.waitForFunction(()=>document.querySelector('.map-stage')?.dataset.visibleLabels!==undefined)
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   // Marker HTML and GPU line-source uploads finish on different frames.
   await page.waitForTimeout(500)
   await page.screenshot({path:path.join(output,`map-${size}-${theme}.png`),fullPage:true})
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);results.push({size,theme,errors,unexpected});console.log(`Captured settled map ${size}-${theme}`)
  }finally{await context.close()}
 }await fs.writeFile(path.join(output,'capture-results.json'),JSON.stringify({settledMapFrames:true,results},null,2))}finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
