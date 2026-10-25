import {act,render,screen,waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {afterEach,it,expect,vi} from 'vitest'
import {createMemoryRouter} from 'react-router'
import {RouterProvider} from 'react-router/dom'
import {createAppRouter} from '../src/react/router.jsx'
import {SessionContext} from '../src/react/session/session-context.js'
import {documentNavigation,installAppNavigation,updateViewUrl,routePageKey} from '../src/services/document-navigation.js'
import {registerNavigationGuard,permitAppNavigation} from '../src/services/navigation-guards.js'
let cleanup,release,router
const user={status:'authenticated',user:{name:'User',role:'Administrator'}}
afterEach(()=>{cleanup?.();release?.();router?.dispose();cleanup=null;release=null;router=null;vi.restoreAllMocks()})
it('uses one installed router for assign/replace and keeps history view updates marked',async()=>{
 const navigate=vi.fn().mockResolvedValue();cleanup=installAppNavigation({navigate});await documentNavigation.assign('/map?area=all');await documentNavigation.replace('/');await updateViewUrl('/map?selectedAssetId=A',{replace:true});expect(navigate.mock.calls).toEqual([['/map?area=all',{replace:false}],['/',{replace:true}],['/map?selectedAssetId=A',{replace:true,state:{sinergiViewState:true,sinergiPageKey:expect.any(String)},preventScrollReset:true}]])
})
it('aggregates guards into one confirmation and releases them when their owner leaves',()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),a=registerNavigationGuard(()=>({dirty:true})),b=registerNavigationGuard(()=>({busy:true}));expect(permitAppNavigation()).toBe(false);expect(confirm).toHaveBeenCalledOnce();expect(confirm.mock.calls[0][0]).toContain('Proses');a();b();expect(permitAppNavigation()).toBe(true);expect(confirm).toHaveBeenCalledOnce()
})
it('intercepts an internal link, preserves the root and supports reject/accept and Back',async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),container=document.createElement('div');container.id='app';document.body.append(container)
 router=createAppRouter([{path:'/first',element:<><h1>First</h1><a href="/second">Second</a></>},{path:'/second',element:<h1>Second page</h1>}],routes=>createMemoryRouter(routes,{initialEntries:['/first']}))
 const view=render(<SessionContext value={user}><RouterProvider router={router}/></SessionContext>,{container});release=registerNavigationGuard(()=>({dirty:true}));await userEvent.click(screen.getByRole('link',{name:'Second'}));expect(screen.getByRole('heading',{name:'First'})).toBeVisible();expect(confirm).toHaveBeenCalledOnce();confirm.mockReturnValue(true);await userEvent.click(screen.getByRole('link',{name:'Second'}));expect(await screen.findByRole('heading',{name:'Second page'})).toBeVisible();release();release=null;await act(()=>router.navigate(-1));await waitFor(()=>expect(screen.getByRole('heading',{name:'First'})).toBeVisible());expect(document.querySelector('#app')).toBe(container);view.unmount();container.remove()
})

it('uses a fresh instance for explicit navigation but preserves the instance for view-only history',()=>{
 const first={pathname:'/map',search:'?datasetId=D&area=A',key:'first'}
 expect(routePageKey({...first,key:'second'})).not.toBe(routePageKey(first))
 expect(routePageKey({...first,key:'selection',search:first.search+'&selectedAssetId=C',state:{sinergiPageKey:routePageKey(first),sinergiViewState:true}})).toBe(routePageKey(first))
})
