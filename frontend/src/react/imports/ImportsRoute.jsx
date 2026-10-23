import '../../style.css'
import '../../styles/admin-route.css'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'
import { SessionProvider } from '../session/SessionProvider.jsx'
import { SessionGate } from '../session/SessionGate.jsx'
import { ImportsPage } from './ImportsPage.jsx'

export function ImportsRoute() {
  return <ThemeProvider><SessionProvider><SessionGate><ImportsPage /></SessionGate></SessionProvider></ThemeProvider>
}
