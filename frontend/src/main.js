import './style.css'
import { renderLoginPage } from './pages/login-page.js'
import { renderImportDatasetPage } from './pages/admin/import-dataset-page.js'
import { renderPreviewImportPage } from './pages/admin/preview-import-page.js'
import { renderMapPage } from './pages/map/map-page.js'

const app = document.querySelector('#app')
const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'

const importPreviewMatch = normalizedPath.match(/^\/admin\/datasets\/import\/([^/]+)\/preview$/)

if (importPreviewMatch) {
  renderPreviewImportPage(app, decodeURIComponent(importPreviewMatch[1]))
} else if (normalizedPath === '/admin/datasets/import') {
  renderImportDatasetPage(app)
} else if (normalizedPath === '/map' || normalizedPath === '/peta') {
  renderMapPage(app)
} else {
  renderLoginPage(app)
}
