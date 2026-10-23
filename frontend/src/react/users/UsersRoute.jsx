import '../../style.css'
import '../../styles/admin-users.css'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'
import { SessionProvider } from '../session/SessionProvider.jsx'
import { SessionGate } from '../session/SessionGate.jsx'
import { UsersPage } from './UsersPage.jsx'

export function UsersRoute() {
  return <ThemeProvider><SessionProvider><SessionGate><UsersPage /></SessionGate></SessionProvider></ThemeProvider>
}
