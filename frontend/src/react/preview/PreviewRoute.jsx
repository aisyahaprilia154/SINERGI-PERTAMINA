import '../../style.css'
import '../../styles/admin-route.css'
import { useParams } from 'react-router'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'
import { SessionProvider } from '../session/SessionProvider.jsx'
import { SessionGate } from '../session/SessionGate.jsx'
import { PreviewPage } from './PreviewPage.jsx'
export function PreviewRoute() {
  const { importId } = useParams()
  return <ThemeProvider><SessionProvider><SessionGate><PreviewPage key={importId} importId={importId} /></SessionGate></SessionProvider></ThemeProvider>
}
