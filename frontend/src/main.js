import '@fontsource-variable/inter/wght.css'
import './style.css'
import { initializeTheme } from './theme.js'

initializeTheme()

const app = document.querySelector('#app')
const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'

const importPreviewMatch = normalizedPath.match(/^\/admin\/datasets\/import\/([^/]+)\/preview$/)

if (importPreviewMatch) {
  await import('./styles/admin-preview-route.css')
  const { renderPreviewImportPage } = await import('./pages/admin/preview-import-page.js')
  renderPreviewImportPage(app, decodeURIComponent(importPreviewMatch[1]))
} else if (normalizedPath === '/admin/topology-review') {
  await import('./styles/topology-review-route.css')
  const { renderTopologyReviewPage } = await import('./pages/admin/topology-review-page.js')
  renderTopologyReviewPage(app)
} else if (normalizedPath === '/admin/topology-sync') {
  await import('./styles/topology-route.css')
  const { renderTopologySyncPage } = await import('./pages/admin/topology-sync-page.js')
  renderTopologySyncPage(app)
} else if (normalizedPath === '/admin/datasets/import') {
  await import('./styles/admin-import.css')
  const { renderImportDatasetPage } = await import('./pages/admin/import-dataset-page.js')
  renderImportDatasetPage(app)
} else if (normalizedPath === '/map' || normalizedPath === '/peta') {
  await import('./styles/map-route.css')
  const { renderMapPage } = await import('./pages/map/map-page.js')
  renderMapPage(app)
} else if (normalizedPath === '/topology' || normalizedPath === '/topologi') {
  await import('./styles/topology-route.css')
  const { renderTopologyPage } = await import('./pages/topology/topology-page.js')
  renderTopologyPage(app)
} else {
  await import('./styles/login.css')
  const { renderLoginPage } = await import('./pages/login-page.js')
  renderLoginPage(app)
}
