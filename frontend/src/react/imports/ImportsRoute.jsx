import {RouteProviders} from '../RouteProviders.jsx'
import '../../styles/admin-route.css'
import { SessionGate } from '../session/SessionGate.jsx'
import { ImportsPage } from './ImportsPage.jsx'

export function ImportsRoute() {
  return <RouteProviders><SessionGate><ImportsPage /></SessionGate></RouteProviders>
}
