import '../../style.css'
import '../../styles/admin-route.css'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'
import { SessionProvider } from '../session/SessionProvider.jsx'
import { SessionGate } from '../session/SessionGate.jsx'
import { VersionsPage } from './VersionsPage.jsx'

export function VersionsRoute() {
  return <ThemeProvider><SessionProvider><SessionGate><VersionsPage /></SessionGate></SessionProvider></ThemeProvider>
}
