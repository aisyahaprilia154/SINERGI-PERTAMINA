import '../../style.css'
import '../../styles/app-header.css'
import '../../styles/map-route.css'
import './map-read.css'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'
import { SessionProvider } from '../session/SessionProvider.jsx'
import { SessionGate } from '../session/SessionGate.jsx'
import { MapReadPage } from './MapReadPage.jsx'
// Detail/edit complete: both map aliases now use this React route.
export function MapRoute() {
  return <ThemeProvider><SessionProvider><SessionGate pathname="/map"><MapReadPage /></SessionGate></SessionProvider></ThemeProvider>
}
