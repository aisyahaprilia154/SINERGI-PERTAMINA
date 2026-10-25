import '../../src/style.css'
import '../../src/styles/app-header.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MapRoute } from '../../src/react/map/MapRoute.jsx'
const root = createRoot(document.querySelector('#app'))
root.render(<StrictMode><MapRoute /></StrictMode>)
window.addEventListener('pagehide', event => { if (!event.persisted) root.unmount() }, { once: true })
