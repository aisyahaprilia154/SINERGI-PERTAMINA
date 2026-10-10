import {getSessionToken} from './account-session.js'
export const currentDatasetId = value => value || (typeof window!=='undefined'?window.sessionStorage.getItem('sinergiActiveDatasetId'):null) || 'dataset-semarang'
export async function requestJson(url,{token=typeof window==='undefined'?'':getSessionToken(),signal,method='GET',body}={}) {
  const response=await fetch(url,{method,signal,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
  const payload=await response.json().catch(()=>({}))
  if(!response.ok) {const error=new Error(payload.error?.message || `Request gagal (${response.status}).`);Object.assign(error,{status:response.status,code:payload.error?.code,details:payload.error?.details});throw error}
  if(method!=='GET'&&Number.isSafeInteger(payload.revision)&&typeof window!=='undefined') {
    const datasetId=payload.datasetId ?? url.match(/\/api\/datasets\/([^/]+)/)?.[1]
    if(datasetId)try{window.localStorage.setItem(`sinergi:revision:${decodeURIComponent(datasetId)}`,String(payload.revision))}catch{/* Storage is optional. */}
  }
  return payload
}
export function listenForDatasetRevision({datasetId,revision,isDirty=()=>false,onDirty=()=>{}}) {
  if(typeof window==='undefined')return ()=>{}
  const listener=event=>{
    if(event.key!==`sinergi:revision:${datasetId}`||!event.newValue||Number(event.newValue)<=revision())return
    if(isDirty())onDirty();else window.location.reload()
  }
  window.addEventListener('storage',listener)
  const remove=()=>window.removeEventListener('storage',listener)
  window.addEventListener('pagehide',remove,{once:true});return remove
}
