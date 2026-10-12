import {requestJson} from './operational-api.js'
const base='/api/admin/users'
export const loadUsers=options=>requestJson(base,options)
export const createUser=(body,options={})=>requestJson(base,{...options,method:'POST',body})
export const updateUser=(id,body,options={})=>requestJson(`${base}/${encodeURIComponent(id)}`,{...options,method:'PATCH',body})
export const resetUserPassword=(id,body,options={})=>requestJson(`${base}/${encodeURIComponent(id)}/password`,{...options,method:'POST',body})
