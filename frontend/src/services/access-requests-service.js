import {requestJson} from './operational-api.js'
export const submitAccessRequest=(body,options={})=>requestJson('/api/auth/requests',{...options,method:'POST',body})
export const loadAccessRequests=options=>requestJson('/api/admin/access-requests',options)
export const reviewAccessRequest=(id,body,options={})=>requestJson(`/api/admin/access-requests/${encodeURIComponent(id)}/review`,{...options,method:'POST',body})
