import { reactRoutes } from './react/routes.js'

export async function usesReactRoute(pathname, routes = reactRoutes) {
  if (routes.length === 0) return false
  const { matchRoutes } = await import('react-router')
  const matches = matchRoutes(routes, pathname)
  return matches !== null && matches.every(({ route }) => !route.handle?.acceptsPath || route.handle.acceptsPath(pathname))
}

export async function startFrontend({
  pathname = window.location.pathname,
  container = document.querySelector('#app'),
  routes = reactRoutes,
  loadReact = () => import('./react/bootstrap.jsx'),
} = {}) {
  if (!await usesReactRoute(pathname, routes)) {
    throw new Error(`Rute React tidak tersedia: ${pathname}`)
  }
  const { mountReactApp } = await loadReact()
  return { implementation: 'react', ...mountReactApp(container, { routes }) }
}
