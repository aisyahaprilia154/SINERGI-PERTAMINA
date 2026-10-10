import {mountAdminShell} from '../../components/admin-shell.js'
import {loadImportPreview,loadImportStatus,decideImportItem,activateDatasetVersion,refreshImportPreview,downloadDatasetSource} from '../../services/import-dataset-service.js'
import {loadActiveDataset} from '../../services/active-dataset-service.js'
import {adaptActiveDatasetForMap} from '../../adapters/active-dataset-map-adapter.js'
import {download} from './import-dataset-page.js'
import {escapeHtml as e} from './import-view-utils.js'

export async function renderPreviewImportPage(container,importId) {
  document.title='Preview Tambahan — SINERGI'
  const content=mountAdminShell(container,{active:'imports'})
  let map=null,preview,baseline,showContext=true,busy=false,error=''
  const load=async()=>{preview=await loadImportPreview({importId});baseline=await loadActiveDataset({datasetId:preview.import.dataset_id});render()}
  const run=async action=>{if(busy)return;busy=true;render();try{await action();error='';await load()}catch(caught){error=caught.message;render()}finally{busy=false;render()}}
  function render(){
    map?.destroy?.();map=null
    content.innerHTML=`<section class="operational-import"><a class="admin-back" href="/admin/datasets/import"><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>Kembali ke Impor</a><div class="au-heading"><div><h1 class="admin-page-title">Preview tambahan</h1><p class="admin-page-subtitle">Periksa lokasi dan konflik sebelum menerapkan tambahan.</p></div></div><section class="operational-card"><h2>${e(preview.import.name)}</h2>
      <p>${preview.summary.addedAssets} aset baru · ${preview.summary.addedRelations} relasi baru · ${preview.summary.existingAssets} aset sudah tersimpan · ${preview.summary.conflicts} konflik</p>
      <p>Aset lama yang cocok tetap memakai data database. Kategori baru ditempatkan sebagai perangkat akhir.</p>
      ${error?`<p role="alert" class="operational-error">${e(error)}</p>`:''}
      <div class="operational-actions"><button data-apply class="operational-primary" ${busy||preview.summary.conflicts||preview.import.status!=='ready'?'disabled':''}>Terapkan tambahan</button>
      <button data-refresh ${busy?'disabled':''}>Hitung ulang preview</button><button data-source>Unduh sumber</button></div></section>
      <section class="operational-card"><div class="operational-actions"><h2>Lokasi tambahan</h2><label><input data-context type="checkbox" ${showContext?'checked':''}> Tampilkan aset lama sebagai konteks</label></div><div class="operational-preview-map" data-preview-map></div></section>
      <section class="operational-card"><h2>Tambahan aset dan kategori</h2>${renderAdditions(preview.items)}</section>
      ${preview.conflicts.length?`<section class="operational-card"><h2>Konflik yang perlu diputuskan</h2>${preview.conflicts.map(item=>renderConflict(item,baseline,preview)).join('')}</section>`:''}</section>`
    content.querySelector('[data-context]').addEventListener('change',event=>{showContext=event.target.checked;render()})
    content.querySelector('[data-source]').addEventListener('click',()=>void run(async()=>download(await downloadDatasetSource({importId}))))
    content.querySelector('[data-apply]').addEventListener('click',()=>void run(async()=>{await activateDatasetVersion({importId,expectedRevision:preview.baseRevision});window.location.assign(`/map?datasetId=${encodeURIComponent(preview.import.dataset_id)}`)}))
    content.querySelector('[data-refresh]').addEventListener('click',()=>void run(async()=>{
      await refreshImportPreview({importId})
      while(container.isConnected){const status=await loadImportStatus({statusUrl:`/api/imports/${encodeURIComponent(importId)}`});if(status.import.status==='ready')break;if(status.import.status==='failed')throw new Error(status.import.error?.message || 'Preview gagal diperbarui.');await new Promise(resolve=>setTimeout(resolve,1200))}
    }))
    content.querySelectorAll('[data-item-action]').forEach(button=>button.addEventListener('click',()=>void run(async()=>{
      const row=button.closest('[data-conflict-item]'),decision={decision:button.dataset.itemAction}
      if(decision.decision==='match_existing')decision.assetId=row.querySelector('[data-existing-asset]').value
      if(decision.decision==='connect'){decision.sourceAssetId=row.querySelector('[data-endpoint-start]').value;decision.targetAssetId=row.querySelector('[data-endpoint-end]').value}
      await decideImportItem({importId,itemId:row.dataset.conflictItem,decision})
    })))
    const host=content.querySelector('[data-preview-map]'),payload=previewMapPayload(preview,baseline,showContext)
    void import('../map/maplibre-map.js').then(({createMapLibreSurface})=>{
      if(!host.isConnected)return
      const model=adaptActiveDatasetForMap(payload);map=createMapLibreSurface(host,model)
    }).catch(caught=>{if(host.isConnected)host.textContent=`Peta tidak dapat dimuat: ${caught.message}`})
  }
  content.innerHTML=`<section class="operational-import"><a class="admin-back" href="/admin/datasets/import"><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>Kembali ke Impor</a><div class="au-heading"><div><h1 class="admin-page-title">Preview tambahan</h1><p class="admin-page-subtitle">Periksa lokasi dan konflik sebelum menerapkan tambahan.</p></div></div><p role="status">Memuat tambahan…</p></section>`
  try{await load()}catch(caught){content.querySelector('[role=status]').textContent=caught.message}
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
