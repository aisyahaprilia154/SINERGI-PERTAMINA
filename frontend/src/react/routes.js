import { pageAccess } from '../domain/page-access.js'

const loginRoute = async () => {
  const { LoginRoute } = await import('./login/LoginRoute.jsx')
  return { Component: LoginRoute }
}

// Preserve the old unknown-URL login fallback, without claiming protected pages.
export const reactRoutes = [
  { path: '/', lazy: loginRoute },
  ...['/map', '/peta'].map(path => ({ path, lazy: async () => {
    const { MapRoute } = await import('./map/MapRoute.jsx')
    return { Component: MapRoute }
  } })),
  ...['/topology','/topologi'].map(path=>({path,lazy:async()=>{const {TopologyRoute}=await import('./topology/TopologyRoute.jsx');return {Component:TopologyRoute}}})),
  { path: '/admin/datasets/import/:importId/preview', lazy: async () => {
    const { PreviewRoute } = await import('./preview/PreviewRoute.jsx')
    return { Component: PreviewRoute }
  } },
  { path: '/admin/datasets/import', lazy: async () => {
    const { ImportsRoute } = await import('./imports/ImportsRoute.jsx')
    return { Component: ImportsRoute }
  } },
  { path: '/admin/datasets/versions', lazy: async () => {
    const { VersionsRoute } = await import('./versions/VersionsRoute.jsx')
    return { Component: VersionsRoute }
  } },
  { path: '/admin/users', lazy: async () => {
    const { UsersRoute } = await import('./users/UsersRoute.jsx')
    return { Component: UsersRoute }
  } },
  { path: '*', lazy: loginRoute, handle: { acceptsPath: pathname => pageAccess(pathname) === 'login' } },
]
