import {RouteProviders} from '../RouteProviders.jsx'
import '../../styles/admin-route.css'
import { useParams } from 'react-router'
import { SessionGate } from '../session/SessionGate.jsx'
import { PreviewPage } from './PreviewPage.jsx'
export function PreviewRoute() {
  const { importId } = useParams()
  return <RouteProviders><SessionGate><PreviewPage key={importId} importId={importId} /></SessionGate></RouteProviders>
}
