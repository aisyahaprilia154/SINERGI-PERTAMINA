import {getSessionToken} from './account-session.js'
import {requestJson} from './operational-api.js'
export const getDefaultAdminToken=()=>typeof window==='undefined'?'':getSessionToken()
export const loadImportConfig=options=>requestJson(`${options?.apiBase ?? ''}/api/import-config`,options)
export const loadImportHistory=options=>requestJson(`${options?.apiBase ?? ''}/api/imports`,options)
export const loadImportStatus=options=>requestJson(`${options.apiBase ?? ''}${options.statusUrl}`,options)
export const loadImportPreview=options=>requestJson(`${options.apiBase ?? ''}/api/imports/${encodeURIComponent(options.importId ?? options.datasetVersionId)}/preview`,options)
export const decideImportItem=options=>requestJson(`${options.apiBase ?? ''}/api/imports/${encodeURIComponent(options.importId)}/items/${encodeURIComponent(options.itemId)}`,{...options,method:'PATCH',body:options.decision})
export const refreshImportPreview=options=>requestJson(`${options.apiBase ?? ''}/api/imports/${encodeURIComponent(options.importId)}/refresh`,{...options,method:'POST'})
export const activateDatasetVersion=options=>requestJson(`${options.apiBase ?? ''}/api/imports/${encodeURIComponent(options.importId ?? options.datasetVersionId)}/apply`,{...options,method:'POST',body:{expectedRevision:options.expectedRevision ?? options.expectedRecordRevision}})
export function uploadDataset({token=getDefaultAdminToken(),fields={},file,signal,onProgress,apiBase=''}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Object.assign(new Error('Upload dibatalkan.'),{name:'AbortError'}));return}
    const request=new XMLHttpRequest(),form=new FormData()
    let settled=false
    const abort=()=>request.abort()
    const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value)}
    for(const name of ['datasetId','versionName']) if(fields[name])form.append(name,fields[name])
    form.append('file',file);request.open('POST',`${apiBase}/api/imports`);request.setRequestHeader('Authorization',`Bearer ${token}`);request.responseType='json'
    request.upload.addEventListener('progress',event=>{if(!settled)onProgress?.(event.lengthComputable?Math.round(event.loaded/event.total*100):null)})
    request.addEventListener('load',()=>{
      if(signal?.aborted){finish(Object.assign(new Error('Upload dibatalkan.'),{name:'AbortError'}));return}
      const body=request.response ?? {};if(request.status>=200&&request.status<300)finish(null,body)
      else {const error=new Error(body.error?.message || 'Upload gagal.');error.status=request.status;finish(error)}
    })
    request.addEventListener('error',()=>finish(new Error('Koneksi terputus. Periksa riwayat impor sebelum mencoba lagi.')))
    request.addEventListener('abort',()=>finish(Object.assign(new Error('Upload dibatalkan.'),{name:'AbortError'})))
    signal?.addEventListener('abort',abort,{once:true})
    try{request.send(form)}catch(error){finish(error)}
  })
}
export async function downloadDatasetSource(options={}) {
  const id=options.importId ?? options.datasetVersionId
  const response=await fetch(`${options.apiBase ?? ''}/api/imports/${encodeURIComponent(id)}/source-file`,{headers:{Authorization:`Bearer ${options.token ?? getDefaultAdminToken()}`},signal:options.signal})
  options.signal?.throwIfAborted()
  if(!response.ok){const error=new Error((await response.json()).error?.message || 'Unduhan gagal.');error.status=response.status;throw error}
  const blob=await response.blob();options.signal?.throwIfAborted()
  return {blob,filename:parseAttachmentFilename(response.headers.get('content-disposition'),`source-${id}`)}
}
export function parseAttachmentFilename(header,fallback) {
  const encoded=String(header ?? '').match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if(encoded)try{return decodeURIComponent(encoded)}catch{ /* use fallback */ }
  return String(header ?? '').match(/filename="([^"]+)"/i)?.[1] || fallback
}
