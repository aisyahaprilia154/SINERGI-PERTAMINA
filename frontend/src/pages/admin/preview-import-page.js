import {mountAdminShell} from '../../components/admin-shell.js'
import {loadImportPreview,loadImportStatus,decideImportItem,activateDatasetVersion,refreshImportPreview,downloadDatasetSource} from '../../services/import-dataset-service.js'
import {loadActiveDataset} from '../../services/active-dataset-service.js'
import {adaptActiveDatasetForMap} from '../../adapters/active-dataset-map-adapter.js'
import {download} from './import-dataset-page.js'
import {escapeHtml as e} from './import-view-utils.js'

export async function renderPreviewImportPage(container,importId,{createSurface=null}={}) {
  document.title='Preview — SINERGI'
  const content=mountAdminShell(container,{active:'imports'})
  let map=null,preview,baseline,showContext=true,busy=false,mapGeneration=0,mapSignature='',camera=null,disposed=false,conflictsMarkup='',focusAfter=null
  content.innerHTML=`<section class="operational-import operational-preview"><a class="admin-back" href="/admin/datasets/import"><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>Riwayat import</a><div class="au-heading preview-heading"><div><h1 data-preview-name>Preview</h1><p class="admin-caption" data-preview-summary>Memuat tambahan…</p></div><div class="operational-actions"><button data-apply class="au-button au-primary" disabled>Terapkan tambahan</button><button class="au-icon" data-refresh disabled aria-label="Hitung ulang preview" title="Hitung ulang preview"><span class="material-symbols-outlined" aria-hidden="true">refresh</span></button><button class="au-icon" data-source disabled aria-label="Unduh sumber" title="Unduh sumber"><span class="material-symbols-outlined" aria-hidden="true">download</span></button></div></div><p class="operational-error" role="alert" data-preview-error hidden></p><p class="operational-status" role="status" data-preview-status></p><section class="admin-section preview-map-section"><div class="admin-section-heading"><h2>Lokasi tambahan</h2><label class="admin-check"><input data-context type="checkbox" checked>Tampilkan aset lama</label></div><div class="operational-preview-map" data-preview-map></div></section><section class="admin-section"><div class="admin-section-heading"><h2>Tambahan aset</h2></div><div data-additions></div></section><section class="admin-section" data-conflicts-section hidden><div class="admin-section-heading"><h2>Konflik</h2></div><div data-conflicts></div></section></section>`
  const host=content.querySelector('[data-preview-map]'),error=content.querySelector('[data-preview-error]'),status=content.querySelector('[data-preview-status]'),conflicts=content.querySelector('[data-conflicts]')
  const showError=caught=>{error.textContent=caught?.message||'';error.hidden=!caught}
  const syncControls=()=>{
    content.querySelector('[data-apply]').disabled=busy||!preview||!!preview.summary.conflicts||preview.import.status!=='ready'
    content.querySelectorAll('[data-refresh],[data-source],[data-item-action],[data-conflict-item] select').forEach(el=>{el.disabled=busy||!preview})
    status.textContent=busy?'Memproses…':''
    content.querySelector('.operational-preview').setAttribute('aria-busy',String(busy))
  }
  async function updateMap() {
    const payload=previewMapPayload(preview,baseline,showContext),signature=JSON.stringify(payload)
    if(signature===mapSignature)return
    mapSignature=signature;camera=map?.getCamera?.()||camera;map?.destroy?.();map=null
    const generation=++mapGeneration
    try {
      const factory=createSurface||(await import('../map/maplibre-map.js')).createMapLibreSurface
      if(disposed||generation!==mapGeneration||!host.isConnected)return
      host.replaceChildren()
      map=factory(host,{...adaptActiveDatasetForMap(payload),initialCamera:camera})
    }catch(caught){if(!disposed&&generation===mapGeneration){mapSignature='';host.textContent=`Peta tidak dapat dimuat: ${caught.message}`}}
  }
  function render() {
    content.querySelector('[data-preview-name]').textContent=preview.import.name
    content.querySelector('[data-preview-summary]').textContent=`${preview.summary.addedAssets} aset baru · ${preview.summary.addedRelations} relasi baru · ${preview.summary.conflicts} konflik`
    const additions=content.querySelector('[data-additions]'),additionHtml=renderAdditions(preview.items)
    if(additions.innerHTML!==additionHtml)additions.innerHTML=additionHtml
    const html=preview.conflicts.map(item=>renderConflict(item,baseline,preview)).join('')
    if(conflictsMarkup!==html){
      conflictsMarkup=html
      const focused=document.activeElement,row=focused?.closest('[data-conflict-item]'),key=row?.dataset.conflictItem
      const attr=focused?.matches('select')?[...focused.attributes].find(a=>a.name.startsWith('data-'))?.name:null,action=focused?.dataset.itemAction
      const selections=[...conflicts.querySelectorAll('select')].map(el=>({id:el.closest('[data-conflict-item]').dataset.conflictItem,attr:[...el.attributes].find(a=>a.name.startsWith('data-'))?.name,value:el.value}))
      conflicts.innerHTML=html
      for(const selection of selections){const target=[...conflicts.querySelectorAll('[data-conflict-item]')].find(el=>el.dataset.conflictItem===selection.id)?.querySelector(`[${selection.attr}]`);if(target&&[...target.options].some(o=>o.value===selection.value))target.value=selection.value}
      if(key){const target=[...conflicts.querySelectorAll('[data-conflict-item]')].find(el=>el.dataset.conflictItem===key);focusAfter=(target?.querySelector(attr?`[${attr}]`:`[data-item-action="${action}"]`)||conflicts.querySelector('button')||content.querySelector('[data-refresh]'))}
    }
    content.querySelector('[data-conflicts-section]').hidden=!preview.conflicts.length
    syncControls();void updateMap()
  }
  const load=async()=>{
    const next=await loadImportPreview({importId}),active=await loadActiveDataset({datasetId:next.import.dataset_id})
    if(disposed)return
    preview=next;baseline=active;render()
  }
  const run=async(action,{reload=true}={})=>{
    if(busy)return
    focusAfter=document.activeElement;busy=true;showError(null);syncControls()
    try{await action();if(reload)await load()}catch(caught){showError(caught)}finally{busy=false;syncControls();if(focusAfter?.isConnected&&!focusAfter.disabled)focusAfter.focus();focusAfter=null}
  }
  content.querySelector('[data-context]').addEventListener('change',event=>{showContext=event.target.checked;if(preview)void updateMap()})
  content.querySelector('[data-source]').addEventListener('click',()=>void run(async()=>download(await downloadDatasetSource({importId})),{reload:false}))
  content.querySelector('[data-apply]').addEventListener('click',()=>void run(async()=>{await activateDatasetVersion({importId,expectedRevision:preview.baseRevision});window.location.assign(`/map?datasetId=${encodeURIComponent(preview.import.dataset_id)}`)},{reload:false}))
  content.querySelector('[data-refresh]').addEventListener('click',()=>void run(async()=>{
    await refreshImportPreview({importId})
    while(container.isConnected&&!disposed){const result=await loadImportStatus({statusUrl:`/api/imports/${encodeURIComponent(importId)}`});if(result.import.status==='ready')break;if(result.import.status==='failed')throw new Error(result.import.error?.message||'Preview gagal diperbarui.');await new Promise(resolve=>setTimeout(resolve,1200))}
  }))
  conflicts.addEventListener('click',event=>{
    const button=event.target.closest('[data-item-action]');if(!button)return
    void run(async()=>{
      const row=button.closest('[data-conflict-item]'),decision={decision:button.dataset.itemAction}
      if(decision.decision==='match_existing')decision.assetId=row.querySelector('[data-existing-asset]').value
      if(decision.decision==='connect'){decision.sourceAssetId=row.querySelector('[data-endpoint-start]').value;decision.targetAssetId=row.querySelector('[data-endpoint-end]').value}
      await decideImportItem({importId,itemId:row.dataset.conflictItem,decision})
    })
  })
  window.addEventListener('pagehide',()=>{disposed=true;mapGeneration++;map?.destroy?.()},{once:true})
  try{await load()}catch(caught){showError(caught);content.querySelector('[data-preview-summary]').textContent='Preview belum dapat dimuat.'}
}
export function renderAdditions(items=[]) {
  const assets=items.filter(i=>i.kind==='asset'&&i.status==='new')
  return assets.length?`<div class="operational-table-wrap"><table><thead><tr><th>Aset</th><th>Fasilitas</th><th>Kategori</th><th>Peran</th></tr></thead><tbody>${assets.map(({proposal:p})=>`<tr><td>${e(p.name)}</td><td>${e(p.facility.name)}</td><td>${e(p.category)}</td><td>${e(p.diagramRole)}</td></tr>`).join('')}</tbody></table></div>`:'<p>Tidak ada tambahan aset.</p>'
}
function renderConflict(item,baseline,preview) {
  const options=baseline.assets.filter(a=>!item.result?.candidates?.length||item.result.candidates.includes(a.id)).map(a=>`<option value="${e(a.id)}">${e(a.name)} · ${e(a.facilityName)} · ${e(a.id)}</option>`).join('')
  const title=item.kind==='relation'?(item.proposal.kind==='mounting'?'Tiang pemasangan belum pasti':'Endpoint garis belum pasti'):item.proposal.name
  if(item.kind==='relation') {
    const available=[...baseline.assets.filter(a=>a.objectRole==='device_node'),...preview.additions.assets.filter(a=>a.kind==='device')]
    item={...item,result:{...item.result,endpointCandidates:[0,1].map(i=>item.result?.endpointCandidates?.[i]?.length?item.result.endpointCandidates[i]:available.filter(a=>item.proposal.kind==='mounting'&&i===1?a.diagramRole==='physical-mount':a.diagramRole!=='physical-mount'))}}
  }
  return `<article class="operational-conflict" data-conflict-item="${e(item.id)}"><h3>${e(title)}</h3><p>${e(item.reason==='identity_conflict'?'Identitas aset memiliki beberapa kemungkinan.':item.reason==='invalid_geometry'?'Koordinat sumber tidak valid.':'Garis belum memiliki satu pasangan endpoint yang pasti.')}</p>
    ${item.kind==='asset'&&item.status!=='invalid'?`<label>Aset lama<select data-existing-asset><option value="">Pilih aset…</option>${options}</select></label><button data-item-action="match_existing">Cocokkan ke aset lama</button><button data-item-action="create_new">Pastikan sebagai aset baru</button>`:''}
    ${item.kind==='relation'?`<label>Endpoint awal<select data-endpoint-start><option value="">Pilih…</option>${endpointOptions(item.result?.endpointCandidates?.[0] ?? [])}</select></label><label>Endpoint akhir<select data-endpoint-end><option value="">Pilih…</option>${endpointOptions(item.result?.endpointCandidates?.[1] ?? [])}</select></label><button data-item-action="connect">Simpan pasangan</button>`:''}
    <button data-item-action="skip">Lewati item</button></article>`
}
const endpointOptions=assets=>assets.map(a=>`<option value="${e(a.id)}">${e(a.name)} · ${e(a.id)}</option>`).join('')
export function previewMapPayload(preview,baseline,context) {
  const payload={...baseline,assets:context?[...baseline.assets]:[],geometries:context?[...baseline.geometries]:[],layers:[...baseline.layers],mountingRelations:context?[...baseline.mountingRelations]:[],topologyGraph:{nodes:[],edges:[]}}
  const parts=geometry=>geometry?.type==='GeometryCollection'?geometry.geometries.flatMap(parts):geometry?[geometry]:[]
  for(const p of preview.additions.assets) {
    const layerId=`preview:${p.facility.key}:${p.category}`
    payload.layers.push({id:layerId,name:p.category,sourceFolderPath:p.source.folderPath,defaultVisible:true})
    payload.assets.push({id:p.id,assetId:p.id,canonicalAssetId:p.id,name:p.name,type:p.properties.assetType,category:p.category,dynamicCategory:p.properties.dynamicCategory,
      diagramRole:p.diagramRole,diagramClass:p.diagramRole,facilityId:p.facility.key,sourceFolderPath:p.source.folderPath,layerId,objectRole:p.kind==='device'?'device_node':'cable_path',properties:{classification:{...p.properties,diagramClass:p.diagramRole}}})
    parts(p.source.geometry).forEach((g,index)=>payload.geometries.push({id:`preview:${p.id}:${index}`,assetNodeId:p.id,geometryType:({Point:'point',LineString:'line_string',Polygon:'polygon'})[g.type],coordinates:g.coordinates}))
  }
  payload.topologyGraph.nodes=payload.assets.filter(a=>a.objectRole==='device_node').map(a=>({...a,assetId:a.id}))
  const ids=new Set(payload.assets.map(a=>a.id))
  payload.topologyGraph.edges=preview.additions.relations.filter(r=>r.kind!=='mounting'&&ids.has(r.sourceAssetId)&&ids.has(r.targetAssetId)).map(r=>({...r,sourceNodeId:r.sourceAssetId,targetNodeId:r.targetAssetId,relationType:'connected-to',verificationStatus:'confirmed'}))
  payload.mountingRelations.push(...preview.additions.relations.filter(r=>r.kind==='mounting').map(r=>({...r,relationType:'mounted_on',verificationStatus:'confirmed'})))
  return payload
}
