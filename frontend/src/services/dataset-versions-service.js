import {requestJson} from './operational-api.js'
const endpoint=id=>`/api/datasets/${encodeURIComponent(id)}/versions`
export const loadDatasetVersions=datasetId=>requestJson(endpoint(datasetId))
export const saveDatasetVersion=({datasetId,name,expectedRevision})=>requestJson(endpoint(datasetId),{method:'POST',body:{name,expectedRevision}})
export const restoreDatasetVersion=({datasetId,versionId,expectedRevision})=>requestJson(`${endpoint(datasetId)}/${encodeURIComponent(versionId)}/restore`,{method:'POST',body:{expectedRevision}})
