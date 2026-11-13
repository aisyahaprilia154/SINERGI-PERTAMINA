import { useCallback, useEffect, useRef, useState } from 'react'
import { getSessionToken, login, logout, restoreSession,loadCurrentUser,saveSession } from '../../services/account-session.js'
import { startSessionPresence } from '../../services/session-presence.js'
import { documentNavigation } from '../../services/document-navigation.js'
import { SessionContext } from './session-context.js'

export function SessionProvider({ children, presence = true }) {
  const [session, setSession] = useState(() => ({ status: getSessionToken() ? 'checking' : 'anonymous', user: null }))
  const checkController = useRef(null)
  const loginFlight = useRef(null)
  const logoutFlight = useRef(null)
  const stopPresence = useRef(null)
  const signingOut=useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    checkController.current = controller
    if (getSessionToken()) {
      void restoreSession({ signal: controller.signal }).then(user => {
        if (!controller.signal.aborted) setSession({ status: user ? 'authenticated' : 'anonymous', user })
      }).catch(error => {
        if (!controller.signal.aborted && error.name !== 'AbortError') setSession({ status: 'anonymous', user: null })
      })
    }
    const cleared=()=>{if(signingOut.current)return;stopPresence.current?.();setSession({status:'anonymous',user:null})}
    window.addEventListener('sinergi:session-cleared',cleared)
    const cancelRequests = () => {
      controller.abort()
      loginFlight.current?.controller.abort()
      logoutFlight.current?.controller.abort()
    }
    window.addEventListener('pagehide', cancelRequests)
    return () => {
      cancelRequests()
      window.removeEventListener('pagehide', cancelRequests)
      window.removeEventListener('sinergi:session-cleared',cleared)
    }
  }, [])

  useEffect(() => {
    if (!presence || session.status !== 'authenticated') return
    const stop = startSessionPresence()
    stopPresence.current = stop
    return () => { stop(); if (stopPresence.current === stop) stopPresence.current = null }
  }, [presence, session.status])

  const signIn = useCallback((identifier, password) => {
    if (loginFlight.current) return loginFlight.current.promise
    const controller = new AbortController()
    const promise = login(identifier, password, { signal: controller.signal }).then(user => {
      controller.signal.throwIfAborted()
      setSession({ status: 'authenticated', user, entry: 'login' })
      return user
    }).finally(() => { if (loginFlight.current?.controller === controller) loginFlight.current = null })
    loginFlight.current = { controller, promise }
    return promise
  }, [])

  const signOut = useCallback(() => {
    if (logoutFlight.current) return logoutFlight.current.promise
    checkController.current?.abort()
    loginFlight.current?.controller.abort()
    stopPresence.current?.()
    const controller = new AbortController()
    signingOut.current=true
    setSession({ status: 'signing-out', user: null })
    const promise = logout({ signal: controller.signal }).then(() => {
      if (!controller.signal.aborted) {signingOut.current=false;setSession({status:'anonymous',user:null});documentNavigation.assign('/')}
    }).finally(() => { if (logoutFlight.current?.controller === controller) logoutFlight.current = null })
    logoutFlight.current = { controller, promise }
    return promise
  }, [])

  const refreshUser=useCallback(async()=>{
    const signal=checkController.current?.signal
    if(!signal||signal.aborted)return
    const user=await loadCurrentUser({signal})
    if(!signal.aborted)setSession(previous=>({...previous,user}))
  },[])
  const completeSignIn=useCallback(result=>{
    saveSession(result)
    setSession({status:'authenticated',user:result.user,entry:'login'})
  },[])
  return <SessionContext value={{ ...session, signIn, signOut,refreshUser,completeSignIn }}>{children}</SessionContext>
}
