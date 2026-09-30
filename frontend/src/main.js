import './style.css'
import { initializeTheme } from './theme.js'
import { clearSession, getSessionToken, loadCurrentUser } from './services/account-session.js'

initializeTheme()

const app = document.querySelector('#app')
const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'

const previewMatch = normalizedPath.match(/^\/admin\/datasets\/import\/([^/]+)\/preview$/)

const routeLoaders = {
  '/admin/topology-review': {
    loadStyle: () => import('./styles/topology-review-route.css'),
    loadPage: () => import('./pages/admin/topology-review-page.js'),
    render: 'renderTopologyReviewPage',
  },
  '/admin/topology-sync': {
    loadStyle: () => import('./styles/topology-route.css'),
    loadPage: () => import('./pages/admin/topology-sync-page.js'),
    render: 'renderTopologySyncPage',
  },
  '/admin/datasets/import': {
    loadStyle: () => import('./styles/admin-import.css'),
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
  loadStyle: () => import('./styles/admin-preview-route.css'),
  loadPage: () => import('./pages/admin/preview-import-page.js'),
  render: 'renderPreviewImportPage',
}
const routePath = { '/peta': '/map', '/topologi': '/topology' }[normalizedPath] ?? normalizedPath
const isLoginRoute = !previewMatch && !routeLoaders[routePath]
let destination = null
if (getSessionToken()) {
  try {
    const user = await loadCurrentUser()
    if (isLoginRoute) destination = '/map'
    else if (routePath.startsWith('/admin/') && user.role !== 'Administrator') destination = '/map'
  } catch {
    clearSession()
    if (!isLoginRoute) destination = '/'
  }
} else if (!isLoginRoute) {
  destination = '/'
}
if (destination) window.location.replace(destination)

const { loadStyle, loadPage, render } = previewMatch
  ? previewRoute
  : routeLoaders[routePath] ?? fallbackRoute
if (!destination) {
  const [, page] = await Promise.all([loadStyle(), loadPage()])
  page[render](app, ...(previewMatch ? [decodeURIComponent(previewMatch[1])] : []))
}
