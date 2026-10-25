import {RouteProviders} from '../RouteProviders.jsx'
import '../../styles/admin-route.css'
import { SessionGate } from '../session/SessionGate.jsx'
import { VersionsPage } from './VersionsPage.jsx'

export function VersionsRoute() {
  return <RouteProviders><SessionGate><VersionsPage /></SessionGate></RouteProviders>
}
