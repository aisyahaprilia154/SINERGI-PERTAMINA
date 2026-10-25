import {RouteProviders} from '../RouteProviders.jsx'
import '../../styles/admin-users.css'
import { SessionGate } from '../session/SessionGate.jsx'
import { UsersPage } from './UsersPage.jsx'

export function UsersRoute() {
  return <RouteProviders><SessionGate><UsersPage /></SessionGate></RouteProviders>
}
