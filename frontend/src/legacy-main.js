import './style.css'
import './styles/app-header.css'
import { initializeTheme } from './theme.js'
import { getSessionToken, restoreSession } from './services/account-session.js'
import {startSessionPresence} from './services/session-presence.js'
import { pageRedirect } from './domain/page-access.js'

initializeTheme()

const app = document.querySelector('#app')
const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'

const previewMatch = normalizedPath.match(/^\/admin\/datasets\/import\/([^/]+)\/preview$/)

const routeLoaders = {
  '/admin/datasets/versions': {
    loadStyle: () => import('./styles/admin-route.css'),
    loadPage: () => import('./pages/admin/dataset-versions-page.js'),
    render: 'renderDatasetVersionsPage',
  },
  '/admin/users': {
    loadStyle:()=>import('./styles/admin-users.css'),
    loadPage:()=>import('./pages/admin/users-page.js'),
    render:'renderUsersPage',
  },
  '/admin/datasets/import': {
    loadStyle: () => import('./styles/admin-route.css'),
    loadPage: () => import('./pages/admin/import-dataset-page.js'),
    render: 'renderImportDatasetPage',
  },
  '/map': {
    loadStyle: () => import('./styles/map-route.css'),
    loadPage: () => import('./pages/map/map-page.js'),
    render: 'renderMapPage',
  },
  '/topology': {
    loadStyle: () => import('./styles/topology-route.css'),
    loadPage: () => import('./pages/topology/topology-page.js'),
    render: 'renderTopologyPage',
  },
}
const fallbackRoute = {
  loadStyle: () => import('./styles/login.css'),
  loadPage: () => import('./pages/login-page.js'),
  render: 'renderLoginPage',
}
const previewRoute = {
  loadStyle: () => import('./styles/admin-route.css'),
  loadPage: () => import('./pages/admin/preview-import-page.js'),
  render: 'renderPreviewImportPage',
}
const routePath = { '/peta': '/map', '/topologi': '/topology' }[normalizedPath] ?? normalizedPath
const destination = pageRedirect(routePath, await restoreSession())
if (destination) window.location.replace(destination)

const { loadStyle, loadPage, render } = previewMatch
  ? previewRoute
  : routeLoaders[routePath] ?? fallbackRoute
if (!destination) {
  if(getSessionToken())startSessionPresence()
  const [, page] = await Promise.all([loadStyle(), loadPage()])
  page[render](app, ...(previewMatch ? [decodeURIComponent(previewMatch[1])] : []))
}
