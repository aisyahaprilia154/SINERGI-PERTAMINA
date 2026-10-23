import '../../style.css'
import '../../styles/app-header.css'
import '../../styles/login.css'
import { SessionProvider } from '../session/SessionProvider.jsx'
import { SessionGate } from '../session/SessionGate.jsx'
import { LoginPage } from './LoginPage.jsx'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'

export function LoginRoute() {
  // Public login redirects authenticated users; the destination page owns presence.
  return <ThemeProvider><SessionProvider presence={false}><SessionGate><LoginPage /></SessionGate></SessionProvider></ThemeProvider>
}
