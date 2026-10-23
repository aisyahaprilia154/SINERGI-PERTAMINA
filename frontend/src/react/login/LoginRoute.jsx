import '../../style.css'
import '../../styles/app-header.css'
import '../../styles/login.css'
import { SessionProvider } from '../session/SessionProvider.jsx'
import { SessionGate } from '../session/SessionGate.jsx'
import { LoginPage } from './LoginPage.jsx'

export function LoginRoute() {
  // Public login redirects authenticated users; the destination page owns presence.
  return <SessionProvider presence={false}><SessionGate><LoginPage /></SessionGate></SessionProvider>
}
