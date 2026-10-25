import {useEffect,Suspense} from 'react'
import { Outlet, createBrowserRouter, useBlocker, useLocation, useNavigate, matchRoutes } from 'react-router'
import { AppErrorBoundary } from './components/AppErrorBoundary.jsx'
import { ErrorScreen } from './components/ErrorScreen.jsx'
import { LoadingScreen } from './components/LoadingScreen.jsx'

import {routePageKey} from '../services/document-navigation.js'
import {pageAccess} from '../domain/page-access.js'
import {RouteProviders} from './RouteProviders.jsx'
import {permitAppNavigation} from '../services/navigation-guards.js'

function AppShell({routes}) {
  const location=useLocation(),navigate=useNavigate()
  const blocker=useBlocker(({currentLocation,nextLocation})=>{
    const current=new URLSearchParams(currentLocation.search),next=new URLSearchParams(nextLocation.search)
    const viewOnly=nextLocation.state?.sinergiViewState&&routePageKey(currentLocation)===routePageKey(nextLocation)&&currentLocation.pathname===nextLocation.pathname&&['datasetId','area','siteId','draftVersionId'].every(key=>current.get(key)===next.get(key))
    return !viewOnly&&(routePageKey(currentLocation)!==routePageKey(nextLocation)||currentLocation.pathname!==nextLocation.pathname||currentLocation.search!==nextLocation.search)&&!permitAppNavigation()
  })
  useEffect(()=>{if(blocker.state==='blocked')blocker.reset()},[blocker])
  useEffect(()=>{
    const click=event=>{
      if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return
      const link=event.target.closest?.('a[href]')
      if(!link||!(document.querySelector('#app')?.contains(link)||link.closest('[data-react-map-dialog]'))||link.hasAttribute('download')||link.hasAttribute('data-document-navigation')||(link.target&&link.target!=='_self'))return
      const url=new URL(link.href,window.location.href)
      if(url.origin!==window.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/assets/')||url.pathname.startsWith('/e2e/'))return
      const matches=matchRoutes(routes,url.pathname)
      if(!matches||matches.some(({route})=>route.handle?.acceptsPath&&!route.handle.acceptsPath(url.pathname)))return
      event.preventDefault();if(url.href===window.location.href)return;void navigate(url.pathname+url.search+url.hash)
    }
    document.addEventListener('click',click);return()=>document.removeEventListener('click',click)
  },[navigate,routes])
  const pageKey=routePageKey(location)
  return (
    <RouteProviders presence={pageAccess(location.pathname)!=='login'}><AppErrorBoundary key={pageKey}>
      <Suspense fallback={<LoadingScreen />}>
        <Outlet />
      </Suspense>
    </AppErrorBoundary></RouteProviders>
  )
}

export function createAppRouter(routes, routerFactory = createBrowserRouter) {
  return routerFactory([{
    element: <AppShell routes={routes} />,
    errorElement: <ErrorScreen />,
    hydrateFallbackElement: <LoadingScreen />,
    children: routes,
  }])
}
