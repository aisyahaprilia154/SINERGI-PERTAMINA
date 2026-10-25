import '../../src/style.css'
import '../../src/styles/app-header.css'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {TopologyRoute} from '../../src/react/topology/TopologyRoute.jsx'
const root=createRoot(document.querySelector('#app'));root.render(<StrictMode><TopologyRoute/></StrictMode>)
window.addEventListener('pagehide',event=>{if(!event.persisted)root.unmount()},{once:true})
