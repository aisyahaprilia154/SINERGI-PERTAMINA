import {requestJson} from './operational-api.js'
const endpoint=id=>`/api/datasets/${encodeURIComponent(id)}/versions`
export const loadDatasetVersions=(datasetId,options)=>requestJson(endpoint(datasetId),options)
export const saveDatasetVersion=({datasetId,name,expectedRevision},options={})=>requestJson(endpoint(datasetId),{...options,method:'POST',body:{name,expectedRevision}})
export const restoreDatasetVersion=({datasetId,versionId,expectedRevision},options={})=>requestJson(`${endpoint(datasetId)}/${encodeURIComponent(versionId)}/restore`,{...options,method:'POST',body:{expectedRevision}})
