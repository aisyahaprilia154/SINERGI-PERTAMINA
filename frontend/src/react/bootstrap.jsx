import '../style.css'
import '../styles/app-header.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { createAppRouter } from './router.jsx'
import {installAppNavigation} from '../services/document-navigation.js'
import { reactRoutes } from './routes.js'

let activeApp = null

export function mountReactApp(container, { routes = reactRoutes, routerFactory } = {}) {
  if (!container) throw new Error('Container aplikasi React tidak ditemukan.')
  if (activeApp) throw new Error('Aplikasi React sudah terpasang. Lepaskan root terlebih dahulu.')
  const router = createAppRouter(routes, routerFactory)
  let root
  try {
    root = createRoot(container)
  } catch (error) {
    router.dispose()
    throw error
  }
  const removeNavigation=installAppNavigation(router)
  let disposed = false
  const app = {
    router,
    dispose() {
      if (disposed) return
      disposed = true
      removeNavigation()
      root.unmount()
      router.dispose()
      window.removeEventListener('pagehide', onPageHide)
      if (activeApp === app) activeApp = null
    },
  }
  function onPageHide(event) {
    if (!event.persisted) app.dispose()
  }
  activeApp = app
  window.addEventListener('pagehide', onPageHide)
  root.render(<StrictMode><RouterProvider router={router} /></StrictMode>)
  return app
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => activeApp?.dispose())
}
