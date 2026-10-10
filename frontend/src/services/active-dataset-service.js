import {getSessionToken} from './account-session.js'
import {currentDatasetId,requestJson} from './operational-api.js'
export const getDefaultMapToken=()=>typeof window==='undefined'?'':getSessionToken()
const activeUrl=o=>`${o.apiBase ?? ''}/api/datasets/${encodeURIComponent(currentDatasetId(o.datasetId))}/active`
export function loadActiveDataset(options={}) {return requestJson(activeUrl(options),options)}
export function loadActiveAssetDetail(options={}) {return requestJson(`${activeUrl(options)}/assets/${encodeURIComponent(options.assetId)}`,options)}
export function loadActiveAssets(options={}) {
  const query=new URLSearchParams()
  for(const name of ['q','siteId','cursor','limit']) if(options[name]) query.set(name,options[name])
  for(const name of ['category','assetType','networkFamily','assetId']) {
    const values=options[name] ?? (name==='assetId'?options.assetIds:[]) ?? []
    for(const value of Array.isArray(values)?values:[values])query.append(name,value)
  }
  if(options.bounds) query.set('bounds',[options.bounds.west,options.bounds.south,options.bounds.east,options.bounds.north].join(','))
  return requestJson(`${activeUrl(options)}/assets?${query}`,options)
}
export function loadActiveSites(options={}) {return requestJson(`${activeUrl(options)}/sites`,options)}
export function loadActiveOverlays(options={}) {return requestJson(`${activeUrl(options)}/overlays`,options)}
export function saveActiveAssetIcon(options={}) {
  return requestJson(`${activeUrl(options)}/assets/${encodeURIComponent(options.assetId)}/icon`,{...options,method:options.dataUrl===null?'DELETE':'PUT',
    body:{expectedRevision:options.expectedRevision ?? options.expectedRecordRevision,dataUrl:options.dataUrl}})
}
export function saveTopologyDiagram(options={}) {
  return requestJson(`${options.apiBase ?? ''}/api/datasets/${encodeURIComponent(currentDatasetId(options.datasetId))}/diagram`,{...options,method:'POST',
    body:{expectedRevision:options.expectedRevision ?? options.expectedRecordRevision,changes:options.changes}})
}
export function createTopologyRelation(options={}) {
  return saveTopologyDiagram({...options,changes:[{type:'add-relation',sourceAssetId:options.sourceAssetId,targetAssetId:options.targetAssetId}]})
}
export function revokeTopologyRelation(options={}) {
  return saveTopologyDiagram({...options,changes:[{type:'remove-edge',edgeId:options.relationId}]})
}
export function setMountingRelation(options={}) {
  return saveTopologyDiagram({...options,changes:[{type:'mount',assetId:options.assetId,poleAssetId:options.poleAssetId,action:options.action}]})
}
export function loadTopologyProjection(options={}) {
  return requestJson(`${options.apiBase ?? ''}/api/datasets/${encodeURIComponent(currentDatasetId(options.datasetId))}/topology/graph`,options)
}
export async function loadTopologyRoots(options={}) {
  const view=await loadActiveDataset(options)
  return {roots:view.assets.filter(a=>a.diagramRole==='rack-root').map(a=>({...a,rootAssetId:a.id,rootId:a.id})),assignments:view.topologyRootAssignments ?? {}}
}
export async function loadDatasetProjection(options={}) {
  const view=await loadActiveDataset(options)
  return options.projection==='overlays'?{overlays:view.overlays ?? []}:view
}
export async function exportActiveKml(options={}) {
  const {datasetId,branchId,token,apiBase,signal,...query}=options
  const response=await fetch(`${activeUrl(options)}/exports/kml`,{method:'POST',signal,headers:{Authorization:`Bearer ${token ?? getDefaultMapToken()}`,'Content-Type':'application/json'},body:JSON.stringify(query)})
  if(!response.ok) {const body=await response.json();throw new Error(body.error?.message || 'Ekspor gagal.')}
  return {blob:await response.blob(),filename:'sinergi-active.kml',datasetVersionId:response.headers.get('x-dataset-version-id'),activePointerRevision:response.headers.get('x-active-pointer-revision')}
}
