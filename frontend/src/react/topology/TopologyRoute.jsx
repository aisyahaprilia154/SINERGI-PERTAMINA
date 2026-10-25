import {RouteProviders} from '../RouteProviders.jsx'
import '../../styles/topology-route.css'
import '../../styles/topology-workspace.css'
import '../../styles/topology-refinement.css'
import '../../styles/app-harmony.css'
import './topology-read.css'
import {SessionGate} from '../session/SessionGate.jsx'
import {TopologyReadPage} from './TopologyReadPage.jsx'

// Production topology aliases share the React workspace.
export function TopologyRoute(){return <RouteProviders><SessionGate pathname="/topology"><TopologyReadPage/></SessionGate></RouteProviders>}
