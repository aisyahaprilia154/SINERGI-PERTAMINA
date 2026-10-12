import {bindAdminOverlay} from '../../components/admin-overlay.js'
import {loadDatasetVersions,saveDatasetVersion,restoreDatasetVersion} from '../../services/dataset-versions-service.js'
import {escapeHtml as e} from './import-view-utils.js'

export function mountDatasetVersions(host,{datasetId,onRestored=()=>{},onBusy=()=>{}}) {
  let data=null,busy=false,blocked=false,generation=0,dialog=null,disposed=false
  host.innerHTML=`<div class="admin-section-heading version-panel-heading"><h2>Versi tersimpan <small>10 versi maksimum</small></h2><button type="button" class="au-button" data-save-version disabled>Simpan versi</button></div><p class="admin-caption" data-version-state></p><div data-version-list></div><p class="operational-status" role="status" data-version-status>Memuat versi database…</p><div data-version-dialog-host></div>`
  const list=host.querySelector('[data-version-list]'),status=host.querySelector('[data-version-status]'),state=host.querySelector('[data-version-state]'),save=host.querySelector('[data-save-version]'),dialogHost=host.querySelector('[data-version-dialog-host]')
  async function refresh({keepMessage=false}={}) {
    const current=++generation,id=datasetId
    try {
      const result=await loadDatasetVersions(id)
      if(disposed||current!==generation)return
      data=result
      const active=data.versions.find(v=>v.id===data.currentVersionId)
      state.textContent=active?`Data aktif: “${active.name}”.`:'Ada perubahan sejak versi terakhir disimpan.'
      list.innerHTML=data.versions.length?`<div class="operational-table-wrap"><table><thead><tr><th>Versi</th><th>Waktu</th><th>Pembuat</th><th>Isi</th><th></th></tr></thead><tbody>${data.versions.map(v=>`<tr><td>${e(v.name)}${v.id===data.currentVersionId?'<small>Aktif</small>':''}</td><td>${e(new Date(v.created_at).toLocaleString('id-ID'))}</td><td>${e(v.actor_name||v.actor_id||'Sistem')}</td><td>${Number(v.summary.assets)} aset · ${Number(v.summary.relations)} koneksi</td><td><button type="button" class="au-row-action" data-restore-version="${e(v.id)}" ${v.id===data.currentVersionId||busy?'disabled':''}>Pulihkan</button></td></tr>`).join('')}</tbody></table></div>`:'<p>Belum ada versi tersimpan. Simpan keadaan saat ini untuk membuat titik pemulihan.</p>'
      save.disabled=busy||blocked
      if(blocked)host.querySelectorAll('[data-restore-version]').forEach(b=>{b.disabled=true})
      if(!keepMessage)status.textContent=''
    } catch(error) {
      if(disposed||current!==generation)return
      data=null;save.disabled=true
      host.querySelectorAll('[data-restore-version]').forEach(b=>{b.disabled=true})
      state.textContent='Status versi belum diperbarui.';status.textContent=error.message
    }
  }
  function close() {
    if(busy||!dialog)return
    const opener=dialog.opener
    dialogHost.innerHTML='';dialog=null;document.body.classList.remove('version-dialog-open')
    save.disabled=!data||blocked
    host.querySelectorAll('[data-restore-version]').forEach(b=>{b.disabled=!data||blocked||b.dataset.restoreVersion===data.currentVersionId})
    if(opener?.isConnected)opener.focus();else save.focus()
  }
  function open(version=null,opener=save) {
    if(busy||blocked||!data)return
    const expectedRevision=data.revision,id=datasetId
    dialog={opener,version,id,expectedRevision}
    dialogHost.innerHTML=`<div class="version-dialog-layer"><section class="admin-dialog version-dialog" role="dialog" aria-modal="true" aria-labelledby="version-dialog-title"><form data-version-form><h2 id="version-dialog-title">${version?'Pulihkan versi database':'Simpan versi database'}</h2>${version?`<p>Kembali ke <strong>${e(version.name)}</strong>?</p><p>Aset, relasi, ikon, mounting, dan layout akan mengikuti versi ini. Keadaan sekarang disimpan otomatis sebelum digantikan. Akun dan riwayat audit tetap dipertahankan.</p>`:`<p>Perubahan yang sudah tersimpan di peta dan diagram akan menjadi titik pemulihan.</p><label>Nama versi<input name="name" maxlength="180" required placeholder="Diagram sudah dikoreksi"></label>`}<p class="operational-status" role="status" data-dialog-status></p><div class="version-dialog-actions"><button type="button" data-cancel-version>Batal</button><button type="submit" class="operational-primary">${version?'Pulihkan':'Simpan versi'}</button></div></form></section></div>`
    document.body.classList.add('version-dialog-open')
    dialogHost.querySelector('[data-cancel-version]').addEventListener('click',close)
    dialogHost.querySelector('.version-dialog-layer').addEventListener('click',event=>{if(event.target.classList.contains('version-dialog-layer'))close()})
    const form=dialogHost.querySelector('form'),message=dialogHost.querySelector('[data-dialog-status]')
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||blocked)return
      const name=version?null:new FormData(form).get('name')?.trim()
      if(!version&&!name){message.textContent='Isi nama versi terlebih dahulu.';form.elements.name.focus();return}
      busy=true;onBusy(true);form.querySelectorAll('button,input').forEach(b=>{b.disabled=true});save.disabled=true
      host.querySelectorAll('[data-restore-version]').forEach(b=>{b.disabled=true})
      message.textContent=version?'Memulihkan data…':'Menyimpan versi…'
      try {
        const result=version?await restoreDatasetVersion({datasetId:id,versionId:version.id,expectedRevision}):await saveDatasetVersion({datasetId:id,name,expectedRevision})
        busy=false;onBusy(false);close()
        status.textContent=version?`Versi “${version.name}” dipulihkan. Peta dan diagram mengikuti revision terbaru.`:result.existing?`Keadaan ini sudah tersimpan sebagai “${result.version.name}”.`:`Versi “${result.version.name}” tersimpan.`
        await refresh({keepMessage:true})
        if(document.activeElement===document.body)save.focus()
        if(version)await onRestored()
      } catch(error) {
        busy=false;onBusy(false)
        if(error.status===409){close();status.textContent=error.message;await refresh({keepMessage:true})}
        else {message.textContent=error.message;form.querySelectorAll('button,input').forEach(b=>{b.disabled=false});await refresh({keepMessage:true})}
      }
    })
    ;(form.querySelector('input')||form.querySelector('[data-cancel-version]')).focus()
  }
  const disposeKeys=bindAdminOverlay(dialogHost,{isOpen:()=>!!dialog,isBusy:()=>busy,onEscape:close})
  save.addEventListener('click',()=>open())
  list.addEventListener('click',event=>{const button=event.target.closest('[data-restore-version]');if(button&&!button.disabled)open(data?.versions.find(v=>v.id===button.dataset.restoreVersion),button)})
  const storage=event=>{if(!busy&&event.key===`sinergi:revision:${datasetId}`)void refresh()}
  const focus=()=>{if(!busy)void refresh()}
  window.addEventListener('storage',storage);window.addEventListener('focus',focus)
  const dispose=()=>{disposed=true;generation++;window.removeEventListener('storage',storage);window.removeEventListener('focus',focus);disposeKeys();document.body.classList.remove('version-dialog-open')}
  window.addEventListener('pagehide',dispose,{once:true})
  void refresh()
  return {refresh,dispose,setEnabled(enabled){blocked=!enabled;save.disabled=blocked||busy||!data;host.querySelectorAll('[data-restore-version]').forEach(b=>{b.disabled=blocked||busy||!data||b.dataset.restoreVersion===data.currentVersionId})},setDatasetId(id){if(busy)return false;close();datasetId=id;data=null;save.disabled=true;list.innerHTML='';void refresh();return true}}
}
