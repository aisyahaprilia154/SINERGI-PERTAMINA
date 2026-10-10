import {loadImportConfig,loadImportHistory,loadImportStatus,uploadDataset,downloadDatasetSource} from '../../services/import-dataset-service.js'
import {escapeHtml as e} from './import-view-utils.js'
import {mountAdminShell} from '../../components/admin-shell.js'

export async function renderImportDatasetPage(container) {
  document.title='Impor Aset — SINERGI'
  const content=mountAdminShell(container,{active:'imports'})
  content.innerHTML=`<section class="operational-import"><div class="au-heading"><div><h1 class="admin-page-title">Impor aset</h1><p class="admin-page-subtitle">Tambahkan aset dan periksa hasilnya sebelum diterapkan.</p></div></div><p class="operational-status" role="status">Memuat riwayat impor…</p></section>`
  try {
    const [config,history]=await Promise.all([loadImportConfig(),loadImportHistory()])
    content.innerHTML=`<section class="operational-import"><div class="au-heading"><div><h1 class="admin-page-title">Impor aset</h1><p class="admin-page-subtitle">Tambahkan aset dan periksa hasilnya sebelum diterapkan.</p></div></div>
      <section class="operational-card"><h2>Tambahkan aset dari KML/KMZ</h2><p>File dapat berisi seluruh fasilitas atau hanya tambahan. Data dan koreksi yang sudah tersimpan tetap dipertahankan.</p>
      <form data-import-form><label>Dataset<select name="datasetId">${config.datasets.map(d=>`<option value="${e(d.id)}">${e(d.id)}</option>`).join('')}</select></label>
      <label>Nama impor<input name="versionName" maxlength="180" placeholder="Tambahan aset Oktober" required></label>
      <label>File KML/KMZ<input name="file" type="file" accept=".kml,.kmz" required></label>
      <p>Maksimum ${Math.round(config.maxFileSize/1024/1024)} MB. Hasil diperiksa melalui preview sebelum diterapkan.</p>
      <button class="operational-primary" type="submit">Unggah dan lihat preview</button></form><p class="operational-status" role="status"></p></section>
      <section class="operational-card"><h2>Riwayat impor</h2>${renderHistory(history.imports)}</section></section>`
    const form=content.querySelector('[data-import-form]'),status=container.querySelector('.operational-status'),button=form.querySelector('button')
    form.addEventListener('submit',async event=>{
      event.preventDefault();const values=new FormData(form),file=values.get('file')
      if(!file?.size||file.size>config.maxFileSize||!/(\.kml|\.kmz)$/i.test(file.name)){status.textContent='Pilih file KML/KMZ dengan ukuran yang diperbolehkan.';return}
      button.disabled=true
      try {
        const response=await uploadDataset({fields:{datasetId:values.get('datasetId'),versionName:values.get('versionName')},file,onProgress:p=>{status.textContent=`Mengunggah${p===null?'':` ${p}%`}…`}})
        status.textContent='File diterima. Membaca aset dan mencari tambahan…'
        while(container.isConnected) {
          const result=await loadImportStatus({statusUrl:response.statusUrl})
          if(result.import.status==='ready') {window.location.assign(`/admin/datasets/import/${encodeURIComponent(response.importId)}/preview`);return}
          if(result.import.status==='failed')throw new Error(result.import.error?.message || 'File gagal diproses.')
          await new Promise(resolve=>setTimeout(resolve,1200))
        }
      } catch(error){status.textContent=error.message;button.disabled=false}
    })
    content.querySelectorAll('[data-download-source]').forEach(button=>button.addEventListener('click',async()=>{
      try{download(await downloadDatasetSource({importId:button.dataset.downloadSource}))}catch(error){status.textContent=error.message}
    }))
  } catch(error){container.querySelector('.operational-status').textContent=error.message}
}
export function renderHistory(imports=[]) {
  if(!imports.length)return '<p>Belum ada impor.</p>'
  return `<div class="operational-table-wrap"><table><thead><tr><th>Impor</th><th>Waktu</th><th>Hasil</th><th>Status</th><th></th></tr></thead><tbody>${imports.map(i=>`<tr><td>${e(i.name)}<small>${e(i.source_filename)}</small></td><td>${e(new Date(i.created_at).toLocaleString('id-ID'))}</td>
    <td>${i.summary?.legacy?'Baseline / arsip lama':`${Number(i.summary?.addedAssets ?? 0)} aset · ${Number(i.summary?.addedRelations ?? 0)} koneksi`}</td><td>${e(({processing:'Diproses',ready:'Siap diperiksa',applied:'Diterapkan',failed:'Gagal',archived:'Arsip'})[i.status])}</td>
    <td>${i.status==='ready'?`<a href="/admin/datasets/import/${encodeURIComponent(i.id)}/preview">Preview</a>`:''} ${i.source_filename?`<button type="button" data-download-source="${e(i.id)}">File sumber</button>`:''}</td></tr>`).join('')}</tbody></table></div>`
}
export function download({blob,filename}){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
