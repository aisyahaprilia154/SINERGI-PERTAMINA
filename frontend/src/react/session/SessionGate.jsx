import { useEffect } from 'react'
import { pageRedirect } from '../../domain/page-access.js'
import { documentNavigation } from '../../services/document-navigation.js'
import { LoadingScreen } from '../components/LoadingScreen.jsx'
import { useSession } from './session-context.js'

export function SessionGate({ children, pathname = window.location.pathname }) {
  const { status, user, entry } = useSession()
  const pending = status === 'checking' || status === 'signing-out'
  const destination = pending ? null : pageRedirect(pathname, user)
  useEffect(() => {
    if (destination) {
      if (entry === 'login') documentNavigation.assign(destination)
      else documentNavigation.replace(destination)
    }
  }, [destination, entry])
  useEffect(() => {
    // Document navigation may restore a cached login with stale session state.
    const resume = event => { if (event.persisted) documentNavigation.reload() }
    window.addEventListener('pageshow', resume)
    return () => window.removeEventListener('pageshow', resume)
  }, [])
  if (pending || destination) return <LoadingScreen />
  return children
}
