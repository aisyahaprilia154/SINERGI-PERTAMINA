import {RouteProviders} from '../RouteProviders.jsx'
import '../../styles/map-route.css'
import './map-read.css'
import { SessionGate } from '../session/SessionGate.jsx'
import { MapReadPage } from './MapReadPage.jsx'
// Map aliases share the React workspace.
export function MapRoute() {
  return <RouteProviders><SessionGate pathname="/map"><MapReadPage /></SessionGate></RouteProviders>
}
