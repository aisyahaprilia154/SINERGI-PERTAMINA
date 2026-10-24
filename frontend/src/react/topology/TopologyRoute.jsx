import '../../style.css'
import '../../styles/app-header.css'
import '../../styles/topology-route.css'
import '../../styles/topology-workspace.css'
import '../../styles/topology-refinement.css'
import '../../styles/app-harmony.css'
import './topology-read.css'
import {ThemeProvider} from '../theme/ThemeProvider.jsx'
import {SessionProvider} from '../session/SessionProvider.jsx'
import {SessionGate} from '../session/SessionGate.jsx'
import {TopologyReadPage} from './TopologyReadPage.jsx'

// Prepared in isolation; production aliases continue to use the legacy route until stage 15.
export function TopologyRoute(){return <ThemeProvider><SessionProvider><SessionGate pathname="/topology"><TopologyReadPage/></SessionGate></SessionProvider></ThemeProvider>}
