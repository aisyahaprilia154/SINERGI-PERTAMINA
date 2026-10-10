import {uploadDataset,loadImportConfig,loadImportStatus,downloadDatasetSource} from '../../services/import-dataset-service.js'
import {exportActiveKml} from '../../services/active-dataset-service.js'
import {collectSelectedNetworkAssetIds} from './active-dataset-kml-export.js'
import {escapeHtml as e} from '../admin/import-view-utils.js'
import {isAdministrator} from '../../services/account-session.js'

export function openMapDataTransferDialog({activeContext,networks=[],selectedNetworkIds=new Set(),initialMode='import',areaScopeLabel=null}) {
  const dialog=document.createElement('dialog');dialog.className='map-transfer-dialog'
  const controller=new AbortController(),state={mode:isAdministrator()?initialMode:'export',canImport:isAdministrator(),busy:false,error:'',progress:'',maxFileSize:null}
  const render=()=>{
    dialog.innerHTML=renderMapDataTransferDialog({state,activeContext,areaScopeLabel})
    dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close())
    dialog.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{state.mode=button.dataset.mode;state.error='';render()}))
    dialog.querySelector('[data-upload]')?.addEventListener('submit',async event=>{
      event.preventDefault();const file=dialog.querySelector('[name=file]').files[0],name=dialog.querySelector('[name=versionName]').value
      if(!file||!/(\.kml|\.kmz)$/i.test(file.name)||file.size>(state.maxFileSize ?? Infinity)){state.error='Pilih file KML/KMZ dengan ukuran yang diperbolehkan.';render();return}
      state.busy=true;render()
      try {
        const uploaded=await uploadDataset({file,fields:{datasetId:activeContext.datasetId,versionName:name},signal:controller.signal,
          onProgress:p=>{state.progress=`Mengunggah${p===null?'':` ${p}%`}…`;dialog.querySelector('[role=status]').textContent=state.progress}})
        state.progress='Membaca file dan mencari tambahan…';render()
        while(dialog.open) {
          const status=await loadImportStatus({statusUrl:uploaded.statusUrl,signal:controller.signal})
          if(status.import.status==='ready'){window.location.assign(`/admin/datasets/import/${encodeURIComponent(uploaded.importId)}/preview`);return}
          if(status.import.status==='failed')throw new Error(status.import.error?.message || 'Impor gagal diproses.')
          await new Promise(resolve=>setTimeout(resolve,1200))
        }
      }catch(error){if(error.name!=='AbortError')state.error=error.message;state.busy=false;if(dialog.open)render()}
    })
    dialog.querySelector('[data-export]')?.addEventListener('click',()=>void perform(async()=>{
      const ids=collectSelectedNetworkAssetIds(networks,selectedNetworkIds)
      saveDownload(await exportActiveKml({datasetId:activeContext.datasetId,assetIds:ids,signal:controller.signal}))
    }))
    dialog.querySelector('[data-source]')?.addEventListener('click',()=>void perform(async()=>saveDownload(await downloadDatasetSource({importId:activeContext.datasetVersionId,signal:controller.signal}))))
  }
  const perform=async action=>{state.busy=true;state.error='';render();try{await action()}catch(error){state.error=error.message}finally{state.busy=false;if(dialog.open)render()}}
  dialog.addEventListener('close',()=>{controller.abort();dialog.remove()},{once:true})
  document.body.append(dialog);dialog.showModal();render()
  void loadImportConfig({signal:controller.signal}).then(config=>{state.maxFileSize=config.maxFileSize}).catch(()=>{})
  return dialog
}
export function renderMapDataTransferDialog({state,activeContext,areaScopeLabel}) {
  return `<div class="map-transfer-shell"><header class="map-transfer-header"><div><span class="eyebrow">DATA ASET</span><h2>Impor dan ekspor</h2></div><button class="icon-button" data-close aria-label="Tutup">×</button></header>
    <nav class="map-transfer-tabs">${state.canImport===false?'':`<button data-mode="import" ${state.busy?'disabled':''}>Impor tambahan</button>`}<button data-mode="export" ${state.busy?'disabled':''}>Ekspor data</button></nav>
    <div class="map-transfer-body">${state.mode==='import'?`<p>KMZ dapat berisi seluruh fasilitas. Sistem mencocokkan aset lama dan menampilkan tambahan untuk diperiksa.</p>
      <form data-upload><label>Nama impor<input name="versionName" maxlength="180" value="Tambahan aset ${e(new Date().toLocaleDateString('id-ID'))}" required ${state.busy?'disabled':''}></label>
      <label>File KML/KMZ<input name="file" type="file" accept=".kml,.kmz" required ${state.busy?'disabled':''}></label><button type="submit" ${state.busy?'disabled':''}>Unggah dan lihat preview</button></form>`:
      `<p>Unduh data operasional ${e(areaScopeLabel ?? 'dataset aktif')} atau file asli dari impor terakhir.</p><button data-export ${state.busy?'disabled':''}>Ekspor KML operasional</button>
      <button data-source ${state.busy||!activeContext.datasetVersionId?'disabled':''}>Unduh sumber terakhir</button>`}
      <p role="status">${e(state.progress)}</p>${state.error?`<p role="alert">${e(state.error)}</p>`:''}${state.canImport===false?'':'<a href="/admin/datasets/import">Buka riwayat impor</a>'}</div></div>`
}
function saveDownload({blob,filename}){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
