// Isolated baseline for extraction regression tests; never a production route.
import '../../src/style.css'
import '../../src/styles/app-header.css'
import '../../src/styles/topology-route.css'
import {renderTopologyPage} from '../../src/pages/topology/topology-page.js'
await renderTopologyPage(document.querySelector('#app'))
