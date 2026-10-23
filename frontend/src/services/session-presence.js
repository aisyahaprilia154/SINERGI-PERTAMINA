import {getSessionToken,getSessionUser,saveSession,clearSession} from './account-session.js'
import {documentNavigation} from './document-navigation.js'

let activePresence = null

export async function sendSessionHeartbeat({token,fetchImpl=fetch,signal}){
  const response=await fetchImpl('/api/auth/heartbeat',{method:'POST',headers:{Authorization:`Bearer ${token}`},signal})
  if(response.status===401)return {expired:true}
  if(!response.ok)throw new Error('Heartbeat belum diterima server.')
  return response.json()
}

export function startSessionPresence({intervalMs=30_000,fetchImpl=fetch}={}){
  if(typeof window==='undefined'||!getSessionToken())return ()=>{}
  if(activePresence)return activePresence.acquire()
  const owners=new Set(),controller=new AbortController()
  const presence={acquire(){
    const owner={};owners.add(owner)
    return ()=>{if(owners.delete(owner)&&owners.size===0)stop()}
  }}
  activePresence=presence
  const release=presence.acquire()
  let stopped=false,inFlight=false
  const ping=async()=>{
    const token=getSessionToken();if(stopped||inFlight)return;if(!token){stop();return}
    inFlight=true
    try{
      const result=await sendSessionHeartbeat({token,fetchImpl,signal:controller.signal})
      if(stopped||getSessionToken()!==token)return
      if(result.expired){stop();clearSession();documentNavigation.replace('/');return}
      const previous=getSessionUser();saveSession({token,user:result.user})
      if(previous?.role!==result.user.role)documentNavigation.reload()
    }catch{/* Network loss does not turn an unconfirmed heartbeat into Online. */}
    finally{inFlight=false}
  }
  const timer=window.setInterval(()=>void ping(),intervalMs)
  const visible=()=>{if(document.visibilityState==='visible')void ping()}
  const hidden=event=>{if(!event.persisted)stop()}
  function stop(){if(stopped)return;stopped=true;controller.abort();owners.clear();if(activePresence===presence)activePresence=null;window.clearInterval(timer);window.removeEventListener('online',ping);window.removeEventListener('pageshow',ping);window.removeEventListener('pagehide',hidden);document.removeEventListener('visibilitychange',visible)}
  window.addEventListener('online',ping);window.addEventListener('pageshow',ping);window.addEventListener('pagehide',hidden);document.addEventListener('visibilitychange',visible)
  void ping();return release
}
