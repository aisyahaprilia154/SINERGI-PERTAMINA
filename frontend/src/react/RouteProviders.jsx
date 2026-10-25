import {useContext} from 'react'
import {SessionContext} from './session/session-context.js'
import {SessionProvider} from './session/SessionProvider.jsx'
import {ThemeProvider} from './theme/ThemeProvider.jsx'

// Standalone test fixtures can supply their own providers; the app owns one persistent session.
export function RouteProviders({children,presence=true}){
 const session=useContext(SessionContext)
 return session?children:<ThemeProvider><SessionProvider presence={presence}>{children}</SessionProvider></ThemeProvider>
}
