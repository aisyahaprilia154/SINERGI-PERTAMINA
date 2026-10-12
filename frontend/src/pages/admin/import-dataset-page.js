import {loadImportConfig,loadImportHistory,loadImportStatus,uploadDataset,downloadDatasetSource} from '../../services/import-dataset-service.js'
import {escapeHtml as e} from './import-view-utils.js'
import {mountAdminShell} from '../../components/admin-shell.js'
import {adminDrawerMarkup,adminDrawerHeading,bindAdminOverlay} from '../../components/admin-overlay.js'
import {currentDatasetId} from '../../services/operational-api.js'

export async function renderImportDatasetPage(container) {
  document.title='Riwayat import — SINERGI'
  const content=mountAdminShell(container,{active:'imports'})
  content.innerHTML=`<section class="operational-import" data-import-workspace><div class="au-heading"><h1>Riwayat import</h1><button type="button" class="au-button au-primary" data-open-import disabled><span class="material-symbols-outlined" aria-hidden="true">upload</span>Impor KML/KMZ</button></div><div data-import-content></div><p class="operational-status" data-page-status role="status">Memuat data…</p></section>${adminDrawerMarkup('import-editor')}`
  const workspace=content.querySelector('[data-import-workspace]'),pageStatus=content.querySelector('[data-page-status]'),openButton=content.querySelector('[data-open-import]')
  try {
    const [config,initialHistory]=await Promise.all([loadImportConfig(),loadImportHistory()])
    if(!container.isConnected)return
    if(!config.datasets.length)throw new Error('Belum ada dataset yang tersedia.')
    const requested=new URLSearchParams(window.location.search).get('datasetId')||currentDatasetId()
    let datasetId=config.datasets.some(d=>d.id===requested)?requested:config.datasets[0].id
    let history=initialHistory.imports,uploading=false,dirty=false,discarding=false,disposed=false
    const datasetName=d=>d.name||(d.id==='dataset-semarang'?'SINERGI':d.id)
    content.querySelector('[data-import-content]').innerHTML=`<div class="au-toolbar admin-dataset-context">${config.datasets.length===1?`<span>Dataset <strong>${e(datasetName(config.datasets[0]))}</strong></span>`:`<label>Dataset <select data-dataset-context aria-label="Dataset aktif">${config.datasets.map(d=>`<option value="${e(d.id)}" ${d.id===datasetId?'selected':''}>${e(datasetName(d))}</option>`).join('')}</select></label>`}</div><section class="admin-section"><div data-import-history></div></section>`
    const historyHost=content.querySelector('[data-import-history]'),selector=content.querySelector('[data-dataset-context]'),layer=content.querySelector('[data-drawer="import-editor"]'),editor=layer.querySelector('.au-editor')
    editor.innerHTML=`${adminDrawerHeading('Impor KML/KMZ','import-editor')}<form data-import-form><input name="datasetId" type="hidden" value="${e(datasetId)}"><label>Nama impor<input name="versionName" maxlength="180" placeholder="Tambahan aset Oktober" required></label><label>File KML/KMZ<input name="file" type="file" accept=".kml,.kmz" required></label><small>Maksimum ${Math.round(config.maxFileSize/1024/1024)} MB. Tambahan diperiksa sebelum diterapkan.</small><p class="operational-status" role="status" data-upload-status></p><div class="au-editor-footer"><button type="button" class="au-button" data-close-editor>Batal</button><button class="au-button au-primary" type="submit">Unggah dan lihat preview</button></div></form><section data-discard-confirm hidden><h2>Buang draft impor?</h2><p>Nama dan file yang dipilih belum diunggah.</p><div class="au-editor-footer"><button type="button" class="au-button" data-keep-draft>Lanjutkan mengisi</button><button type="button" class="au-button au-danger" data-discard-draft>Buang draft</button></div></section>`
    const form=editor.querySelector('form'),uploadStatus=editor.querySelector('[data-upload-status]'),confirmation=editor.querySelector('[data-discard-confirm]')
    const renderRows=()=>{historyHost.innerHTML=renderHistory(history.filter(i=>!i.dataset_id||i.dataset_id===datasetId))}
    renderRows();pageStatus.textContent=''
    const syncControls=()=>{
      openButton.disabled=uploading
      if(selector)selector.disabled=uploading||!layer.hidden
      form.querySelectorAll('input,button').forEach(el=>{el.disabled=uploading})
      editor.querySelectorAll('[data-close-editor]').forEach(el=>{el.disabled=uploading})
      form.setAttribute('aria-busy',String(uploading))
    }
    function close({discard=false}={}) {
      if(uploading)return
      if(discard){form.reset();form.elements.datasetId.value=datasetId;dirty=false;uploadStatus.textContent=''}
      layer.hidden=true;editor.hidden=true;workspace.inert=false;discarding=false;confirmation.hidden=true;form.hidden=false
      document.body.classList.remove('admin-editor-open');syncControls();openButton.focus()
    }
    function requestClose(){
      if(uploading)return
      if(!dirty){close();return}
      discarding=true;form.hidden=true;confirmation.hidden=false;editor.querySelector('[data-keep-draft]').focus()
    }
    const keepDraft=()=>{discarding=false;confirmation.hidden=true;form.hidden=false;form.elements.versionName.focus()}
    openButton.addEventListener('click',()=>{
      if(uploading)return
      layer.hidden=false;editor.hidden=false;workspace.inert=true;document.body.classList.add('admin-editor-open');syncControls();form.elements.versionName.focus()
    })
    layer.addEventListener('click',event=>{
      if(event.target.closest('[data-close-editor]'))requestClose()
      if(event.target.closest('[data-keep-draft]'))keepDraft()
      if(event.target.closest('[data-discard-draft]'))close({discard:true})
    })
    const disposeKeys=bindAdminOverlay(editor,{isOpen:()=>!editor.hidden,isBusy:()=>uploading,onEscape:()=>discarding?keepDraft():requestClose()})
    const beforeUnload=event=>{if(dirty||uploading){event.preventDefault();event.returnValue=''}}
    window.addEventListener('beforeunload',beforeUnload)
    window.addEventListener('pagehide',()=>{disposed=true;disposeKeys();window.removeEventListener('beforeunload',beforeUnload);document.body.classList.remove('admin-editor-open')},{once:true})
    form.addEventListener('input',()=>{dirty=true});form.addEventListener('change',()=>{dirty=true})
    selector?.addEventListener('change',()=>{datasetId=selector.value;form.elements.datasetId.value=datasetId;renderRows()})
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(uploading)return
      const values=new FormData(form),file=values.get('file')
      if(!file?.size||file.size>config.maxFileSize||!/(\.kml|\.kmz)$/i.test(file.name)){uploadStatus.textContent='Pilih file KML/KMZ dengan ukuran yang diperbolehkan.';return}
      uploading=true;syncControls()
      try {
        const response=await uploadDataset({fields:{datasetId,versionName:values.get('versionName')},file,onProgress:p=>{uploadStatus.textContent=`Mengunggah${p===null?'':` ${p}%`}…`}})
        uploadStatus.textContent='Membaca aset dan mencari tambahan…'
        while(container.isConnected&&!disposed) {
          const result=await loadImportStatus({statusUrl:response.statusUrl})
          if(result.import.status==='ready'){dirty=false;window.location.assign(`/admin/datasets/import/${encodeURIComponent(response.importId)}/preview`);return}
          if(result.import.status==='failed')throw new Error(result.import.error?.message||'File gagal diproses.')
          await new Promise(resolve=>setTimeout(resolve,1200))
        }
      }catch(error){uploadStatus.textContent=error.message;uploading=false;syncControls()}
    })
    historyHost.addEventListener('click',async event=>{
      const button=event.target.closest('[data-download-source]');if(!button)return
      try{download(await downloadDatasetSource({importId:button.dataset.downloadSource}))}catch(error){pageStatus.textContent=error.message}
    })
    syncControls()
  }catch(error){pageStatus.textContent=error.message}
}
export function renderHistory(imports=[]) {
  if(!imports.length)return '<p>Belum ada impor.</p>'
  return `<div class="operational-table-wrap"><table><thead><tr><th>Impor</th><th>Waktu</th><th>Hasil</th><th>Status</th><th></th></tr></thead><tbody>${imports.map(i=>`<tr><td><strong>${e(i.name)}</strong><small>${e(i.source_filename)}</small></td><td>${e(new Date(i.created_at).toLocaleString('id-ID'))}</td>
    <td>${i.summary?.legacy?'Baseline / arsip lama':`${Number(i.summary?.addedAssets ?? 0)} aset · ${Number(i.summary?.addedRelations ?? 0)} koneksi`}</td><td>${e(i.status==='applied'?(i.included_in_active===false?'Pernah diterapkan · di luar data aktif':'Diterapkan'):({processing:'Diproses',ready:'Siap diperiksa',failed:'Gagal',archived:'Arsip'})[i.status])}</td>
    <td>${i.status==='ready'?`<a class="au-row-action" href="/admin/datasets/import/${encodeURIComponent(i.id)}/preview">Preview</a>`:''} ${i.source_filename?`<button type="button" class="au-row-action" data-download-source="${e(i.id)}">File sumber</button>`:''}</td></tr>`).join('')}</tbody></table></div>`
}
export function download({blob,filename}){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
