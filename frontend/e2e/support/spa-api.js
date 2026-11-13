import fixtures from '../../../docs/react-migration/map-edit-fixtures.cjs'
import baseline from '../../../docs/react-migration/capture-baseline.cjs'

export async function setupSpa(page,role='Administrator',{authenticated=true}={}){
 const user={...fixtures.user,role},state={calls:[],errors:[],documents:[],pending:null}
 page.on('pageerror',error=>state.errors.push(error.message));page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())state.documents.push(request.url())})
 await page.addInitScript(({user,authenticated})=>{if(authenticated){sessionStorage.setItem('sinergiSessionToken','spa-test');sessionStorage.setItem('sinergiSessionUser',JSON.stringify(user))}},{user,authenticated})
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;state.calls.push({path,method:request.method()})
  if(path.startsWith('/api/auth/'))return route.fulfill({json:{token:'spa-test',user}})
  if(request.method()!=='GET')throw new Error(`Unexpected SPA write ${path}`)
  if(path.endsWith('/active')){if(state.pending)await state.pending;return route.fulfill({json:fixtures.active})}
  if(path.includes('/active/assets/'))return route.fulfill({json:fixtures.detail(decodeURIComponent(path.split('/').at(-1)),fixtures.active)})
  if(path.endsWith('/planet'))return route.fulfill({json:fixtures.basemap})
  if(path.includes('/fonts/'))return route.fulfill({body:Buffer.alloc(0)})
  if(path.endsWith('/overlays'))return route.fulfill({json:{overlays:[]}})
  if(path.endsWith('/topology/graph'))return route.fulfill({json:{graph:fixtures.active.topologyGraph}})
  if(path==='/api/admin/access-requests')return route.fulfill({json:{requests:[],pendingCount:0}})
  if(path==='/api/admin/users')return route.fulfill({json:{users:[user,{...baseline.viewer,email:'viewer@example.test'}],serverTime:'2026-10-24T00:00:00Z'}})
  if(path==='/api/import-config')return route.fulfill({json:{datasets:[{id:'dataset-semarang',name:'SINERGI'}],maxFileSize:60000000}})
  if(path.endsWith('/versions'))return route.fulfill({json:{revision:4,currentVersionId:null,versions:[]}})
  if(path==='/api/imports')return route.fulfill({json:{imports:[baseline.imported]}})
  if(path.endsWith('/preview'))return route.fulfill({json:baseline.preview})
  throw new Error(`Unexpected SPA read ${path}`)
 })
 return state
}
