import {RouteProviders} from '../RouteProviders.jsx'
import '../../styles/login.css'
import { SessionGate } from '../session/SessionGate.jsx'
import { LoginPage } from './LoginPage.jsx'

export function LoginRoute() {
  // Public login redirects through the router; protected routes enable presence.
  return <RouteProviders presence={false}><SessionGate><LoginPage /></SessionGate></RouteProviders>
}
