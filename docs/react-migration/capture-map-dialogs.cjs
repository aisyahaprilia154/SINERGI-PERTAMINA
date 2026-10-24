// Visual fixture only: legacy dialog modules are never re-enabled on production routes.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),fixtures=require('./map-edit-fixtures.cjs')
async function main(){
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,channel:'chromium-headless-shell'}),output=path.join(__dirname,'stage-12'),results=[];await fs.mkdir(output,{recursive:true})
 try{for(const [size,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]])for(const theme of ['light','dark'])for(const implementation of ['legacy','react']){
  const context=await browser.newContext({viewport,colorScheme:theme,locale:'id-ID',timezoneId:'Asia/Jakarta'}),page=await context.newPage(),errors=[],unexpected=[]
  page.on('pageerror',error=>errors.push(error.message))
  await context.addInitScript(({theme,user})=>{localStorage.setItem('sinergi.theme',theme);sessionStorage.setItem('sinergiSessionToken','visual-token');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))},{theme,user:fixtures.user})
  await page.route('**/api/**',route=>{const pathname=new URL(route.request().url()).pathname
   if(pathname.endsWith('/active'))return route.fulfill({json:fixtures.active})
   if(pathname==='/api/import-config')return route.fulfill({json:{maxFileSize:1000000}})
   unexpected.push(pathname);return route.fulfill({status:501,json:{}})
  })
  try{for(const state of ['import','export','all','full','selected','search','empty']){
   await page.goto(`http://127.0.0.1:5173/e2e/fixtures/map-dialogs.html?implementation=${implementation}${state==='empty'?'&empty=1':''}`,{waitUntil:'networkidle'})
   let fonts=false;for(let attempt=0;attempt<3;attempt++){fonts=await page.evaluate(async()=>{try{const faces=await document.fonts.load('24px "Material Symbols Outlined"');return faces.length>0&&faces.every(face=>face.status==='loaded')}catch{return false}});if(fonts)break;await page.reload({waitUntil:'networkidle'})}assert.ok(fonts)
   const transfer=['import','export'].includes(state);await page.getByRole('button',{name:`Fixture ${transfer?state:'diagram'}`,exact:true}).click()
   const dialog=page.locator(transfer?'dialog.map-transfer-dialog':'dialog.schematic-dialog');await dialog.waitFor()
   if(!transfer&&state!=='empty'){await dialog.locator('svg.schematic-svg').waitFor();await page.waitForFunction(()=>!document.querySelector('.export-svg').disabled)}
   if(state==='full')await dialog.getByRole('tab',{name:'Topologi jaringan'}).click()
   if(state==='selected')await dialog.getByRole('tab',{name:'Jalur terpilih'}).click()
   if(state==='search')await dialog.getByRole('searchbox',{name:'Cari aset dalam diagram'}).fill('C-01')
   if(state==='empty')await dialog.getByText('Data diagram belum tersedia').waitFor()
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500)
   const screenshot=`${implementation}-${state}-${size}-${theme}.png`,crop=`${implementation}-${state}-dialog-${size}-${theme}.png`
   await page.screenshot({path:path.join(output,screenshot),fullPage:true});await dialog.screenshot({path:path.join(output,crop)});results.push({implementation,state,size,theme,screenshot,crop})
  }assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(`Captured ${implementation} ${size}-${theme}`)}finally{await context.close()}
 }await fs.writeFile(path.join(output,'capture-results.json'),JSON.stringify({results},null,2))}finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
