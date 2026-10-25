let activeRouter=null
export function installAppNavigation(router){activeRouter=router;return()=>{if(activeRouter===router)activeRouter=null}}
function navigate(url,replace=false){
  if(activeRouter){
    const target=new URL(url,window.location.href)
    if(target.origin===window.location.origin)return activeRouter.navigate(`${target.pathname}${target.search}${target.hash}`,{replace})
  }
  window.location[replace?'replace':'assign'](url)
}
// View-only history entries share the page instance; explicit route navigation gets a fresh one.
export function routePageKey(location){
  if(location.state?.sinergiPageKey)return location.state.sinergiPageKey
  const query=new URLSearchParams(location.search)
  return JSON.stringify([location.pathname,...['datasetId','area','siteId','draftVersionId'].map(key=>query.get(key)),location.key??'document'])
}
export function currentViewPageKey(){return activeRouter?.state?.location?routePageKey(activeRouter.state.location):null}
export function canRestoreView(pageKey){
  const state=activeRouter?.state
  if(!state)return true
  if([...(state.blockers?.values()??[])].some(blocker=>blocker.state==='blocked'))return false
  return routePageKey(state.navigation?.location??state.location)===pageKey
}
export function updateViewUrl(url,{replace=false}={}){
  if(activeRouter)return activeRouter.navigate(url,{replace,state:{sinergiViewState:true,sinergiPageKey:routePageKey(activeRouter.state?.location??{pathname:window.location.pathname,search:window.location.search,key:'document'})},preventScrollReset:true})
  window.history[replace?'replaceState':'pushState'](window.history.state,'',url)
}
export const documentNavigation = {
  assign: url => navigate(url),
  replace: url => navigate(url,true),
  reload: () => window.location.reload(),
}
