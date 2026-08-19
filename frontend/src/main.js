import './style.css'

const app = document.querySelector('#app')
const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'

const importPreviewMatch = normalizedPath.match(/^\/admin\/datasets\/import\/([^/]+)\/preview$/)

if (importPreviewMatch) {
  const { renderPreviewImportPage } = await import('./pages/admin/preview-import-page.js')
  renderPreviewImportPage(app, decodeURIComponent(importPreviewMatch[1]))
} else if (normalizedPath === '/admin/topology-review') {
  // The review screen is retired. Keep old bookmarks usable by opening the
  // source-first map with the same dataset context instead of rendering a
  // second, heavyweight confirmation workflow.
  window.history.replaceState(null, '', `/map${window.location.search}`)
  const { renderMapPage } = await import('./pages/map/map-page.js')
  renderMapPage(app)
} else if (normalizedPath === '/admin/datasets/import') {
  const { renderImportDatasetPage } = await import('./pages/admin/import-dataset-page.js')
  renderImportDatasetPage(app)
} else if (normalizedPath === '/map' || normalizedPath === '/peta') {
  const { renderMapPage } = await import('./pages/map/map-page.js')
  renderMapPage(app)
} else if (normalizedPath === '/topology' || normalizedPath === '/topologi') {
  const { renderTopologyPage } = await import('./pages/topology/topology-page.js')
  renderTopologyPage(app)
} else {
  const { renderLoginPage } = await import('./pages/login-page.js')
  renderLoginPage(app)
}
