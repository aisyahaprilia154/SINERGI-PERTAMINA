import {loadUsers,createUser,updateUser,resetUserPassword} from '../../services/admin-users-service.js'
import {getSessionUser,clearSession} from '../../services/account-session.js'
import {mountAdminShell} from '../../components/admin-shell.js'
import {escapeHtml as e} from './import-view-utils.js'

export function presenceLabel(user,{unconfirmed=false}={}){return unconfirmed?'Belum diperbarui':user.online?'Online':'Offline'}
export function lastSeenLabel(value,serverTime){
  if(!value)return 'Belum pernah masuk'
  const seconds=Math.max(0,(new Date(serverTime)-new Date(value))/1000)
  if(seconds<60)return 'Baru saja'
  if(seconds<3600)return `${Math.floor(seconds/60)} menit lalu`
  return new Date(value).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})
}
export function renderUserRows(users,{serverTime,unconfirmed=false}={}){
  if(!users.length)return '<tr><td colspan="5" class="au-empty">Tidak ada pengguna yang sesuai.</td></tr>'
  return users.map(u=>`<tr><td><strong>${e(u.username)}</strong>${u.email?`<small>${e(u.email)}</small>`:''}</td><td><span class="au-badge">${e(u.role)}</span></td><td><span class="au-badge ${u.active?'au-success':''}">${u.active?'Aktif':'Nonaktif'}</span></td><td><span class="au-presence ${!unconfirmed&&u.online?'is-online':''}"><span aria-hidden="true"></span>${presenceLabel(u,{unconfirmed})}</span><small>${e(lastSeenLabel(u.lastSeenAt,serverTime))}</small></td><td><button type="button" class="au-row-action" data-edit-user="${e(u.id)}">Kelola</button></td></tr>`).join('')
}

export async function renderUsersPage(container){
  document.title='Pengguna — SINERGI';
  const current=getSessionUser(),state={users:[],serverTime:null,unconfirmed:false,selected:null,mode:'edit',pending:null,loading:false,saving:false,query:'',role:'',lastLoaded:null,dirty:false,returnFocus:null,discardAction:null}
  const content=mountAdminShell(container,{active:'users'})
  content.innerHTML=`    <section class="au-main"><div class="au-heading"><div><h1>Pengguna</h1><p>Kelola akun dan akses seluruh fasilitas.</p></div><button type="button" class="au-button au-primary" data-new-user><span class="material-symbols-outlined" aria-hidden="true">add</span>Tambah pengguna</button></div><div class="au-toolbar"><label class="au-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input data-search placeholder="Cari username atau email" aria-label="Cari pengguna"></label><select data-role aria-label="Filter peran"><option value="">Semua peran</option><option>Administrator</option><option>Viewer</option></select><button class="au-button" type="button" data-refresh>Muat ulang</button></div>
    <p data-error class="au-error" role="alert" hidden></p><p data-notice class="au-notice" role="status" hidden></p><div class="au-table-wrap"><table><thead><tr><th>Pengguna</th><th>Peran</th><th>Akun</th><th>Kehadiran</th><th></th></tr></thead><tbody data-rows><tr><td colspan="5" class="au-empty">Memuat pengguna…</td></tr></tbody></table></div><div class="au-table-footer"><span data-count></span><span data-updated></span></div><p class="au-presence-help">Online berarti web masih mengirim sinyal dalam 90 detik terakhir. Status akun Aktif menentukan izin masuk.</p></section><div class="au-editor-layer" hidden><button class="au-editor-backdrop" data-close-editor type="button" aria-label="Tutup editor" tabindex="-1"></button><aside class="au-editor" role="dialog" aria-modal="true" aria-labelledby="au-editor-title" hidden></aside></div>`
  const rows=container.querySelector('[data-rows]'),editor=container.querySelector('.au-editor'),layer=container.querySelector('.au-editor-layer'),error=container.querySelector('[data-error]'),notice=container.querySelector('[data-notice]')
  const setNotice=text=>{notice.textContent=text;notice.hidden=!text}
  const signedOut=()=>{clearSession();window.location.replace('/')}
  function renderRows(){const query=state.query.toLocaleLowerCase('id');const selected=state.users.filter(u=>(!state.role||u.role===state.role)&&`${u.username} ${u.email ?? ''}`.toLocaleLowerCase('id').includes(query));rows.innerHTML=renderUserRows(selected,state);container.querySelector('[data-count]').textContent=`${selected.length} pengguna`;container.querySelector('[data-updated]').textContent=state.lastLoaded?`Diperbarui ${new Date(state.lastLoaded).toLocaleTimeString('id-ID')}`:''}
  async function refresh(){
    if(state.loading||!container.isConnected)return;state.loading=true
    try{const response=await loadUsers();state.users=response.users;state.serverTime=response.serverTime;state.lastLoaded=response.serverTime;state.unconfirmed=false;error.hidden=true;renderRows()}
    catch(caught){if([401,403].includes(caught.status)){signedOut();return}state.unconfirmed=true;error.textContent=`Status pengguna belum dapat diperbarui. ${caught.message}`;error.hidden=false;renderRows()}
    finally{state.loading=false}
  }
  function closeEditor(){if(state.saving)return;state.selected=null;state.pending=null;state.dirty=false;state.discardAction=null;editor.hidden=true;layer.hidden=true;editor.innerHTML='';document.body.classList.remove('admin-editor-open');if(state.returnFocus?.isConnected)state.returnFocus.focus();else container.querySelector('[data-new-user]').focus()}
  function requestEditorAction(action){
    if(state.saving)return
    if(!state.dirty){action();return}
    state.discardAction=action;editor.querySelector('form').hidden=true;editor.querySelector('[data-deactivate-confirm]').hidden=true;editor.querySelector('[data-discard-confirm]').hidden=false;editor.querySelector('[data-cancel-discard]').focus()
  }
  function openEditor(user=null,mode='edit'){
    if(layer.hidden)state.returnFocus=document.activeElement
    state.selected=user?structuredClone(user):null;state.mode=mode;state.pending=null;state.dirty=false;state.discardAction=null;editor.hidden=false;layer.hidden=false;document.body.classList.add('admin-editor-open')
    const lastAdmin=user?.active&&user.role==='Administrator'&&state.users.filter(u=>u.active&&u.role==='Administrator').length===1
    const title=mode==='password'?'Reset password':user?'Kelola pengguna':'Tambah pengguna'
    editor.innerHTML=`<div class="au-editor-heading"><div><small>Pengguna</small><h2 id="au-editor-title">${title}</h2></div><button type="button" class="au-icon" data-close-editor aria-label="Tutup editor"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div><p class="au-error" data-editor-error role="alert" hidden></p><form data-user-form>
      ${mode==='password'?`<p>${e(user.username)}</p><label>Password baru<input type="password" name="password" autocomplete="new-password" minlength="8" maxlength="1024" required></label><small>Sesi pengguna akan diakhiri setelah password diubah.</small>`:
      `<label>Username<input name="username" value="${e(user?.username ?? '')}" ${user?'readonly':''} pattern="[a-zA-Z0-9._-]{1,64}" maxlength="64" required></label><label>Email (opsional)<input name="email" type="email" value="${e(user?.email ?? '')}" maxlength="254"></label><label>Peran<select name="role" ${lastAdmin?'disabled':''}><option ${user?.role!=='Administrator'?'selected':''}>Viewer</option><option ${user?.role==='Administrator'?'selected':''}>Administrator</option></select></label>${!user?'<label>Password awal<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="1024" required></label>':''}<label class="au-check"><input name="active" type="checkbox" ${!user||user.active?'checked':''} ${lastAdmin?'disabled':''}>Akun aktif</label>${lastAdmin?'<small>Administrator aktif terakhir harus tetap tersedia.</small>':''}${user?'<button type="button" class="au-button" data-reset-password>Reset password</button>':''}`}
      <div class="au-editor-footer"><button type="button" class="au-button" data-close-editor>Batal</button><button type="submit" class="au-button au-primary">${mode==='password'?'Ubah password':user?'Simpan perubahan':'Tambah pengguna'}</button></div></form><div data-deactivate-confirm hidden><h2>Nonaktifkan akun?</h2><p>Pengguna akan keluar dari sesi aktif dan tidak dapat masuk hingga akunnya diaktifkan kembali.</p><div class="au-editor-footer"><button type="button" class="au-button" data-cancel-deactivate>Batal</button><button type="button" class="au-button au-danger" data-confirm-deactivate>Nonaktifkan akun</button></div></div><div data-discard-confirm hidden><h2>Buang perubahan?</h2><p>Perubahan pada form ini belum disimpan.</p><div class="au-editor-footer"><button type="button" class="au-button" data-cancel-discard>Lanjutkan mengedit</button><button type="button" class="au-button au-danger" data-confirm-discard>Buang perubahan</button></div></div>`
    editor.querySelector('input:not([readonly])')?.focus()
  }
  async function save(payload){
    if(state.saving)return;state.saving=true;editor.querySelectorAll('button').forEach(b=>b.disabled=true)
    const fieldError=editor.querySelector('[data-editor-error]');fieldError.hidden=true
    try{
      const result=state.mode==='password'?await resetUserPassword(state.selected.id,payload):state.selected?await updateUser(state.selected.id,payload):await createUser(payload)
      state.dirty=false
      if(result.sessionsRevoked&&result.user.id===current?.id){signedOut();return}
      state.saving=false;closeEditor();setNotice(state.mode==='password'?'Password diubah dan sesi pengguna diakhiri.':'Data pengguna tersimpan.');await refresh()
    }catch(caught){if([401,403].includes(caught.status)){signedOut();return}fieldError.textContent=caught.message;fieldError.hidden=false}
    finally{state.saving=false;editor.querySelectorAll('button').forEach(b=>b.disabled=false)}
  }
  container.addEventListener('input',event=>{if(event.target.closest('[data-user-form]'))state.dirty=true;if(event.target.matches('[data-search]')){state.query=event.target.value;renderRows()}})
  container.addEventListener('change',event=>{if(event.target.closest('[data-user-form]'))state.dirty=true;if(event.target.matches('[data-role]')){state.role=event.target.value;renderRows()}})
  container.addEventListener('click',event=>{
    if(event.target.closest('[data-refresh]')){void refresh();return}
    if(state.saving)return
    if(event.target.closest('[data-new-user]')){requestEditorAction(()=>openEditor());return}
    const edit=event.target.closest('[data-edit-user]');if(edit){requestEditorAction(()=>openEditor(state.users.find(u=>u.id===edit.dataset.editUser)));return}
    if(event.target.closest('[data-close-editor]')){requestEditorAction(closeEditor);return}
    if(event.target.closest('[data-reset-password]')){requestEditorAction(()=>openEditor(state.selected,'password'));return}
    if(event.target.closest('[data-cancel-discard]')){editor.querySelector('[data-discard-confirm]').hidden=true;editor.querySelector('form').hidden=!!state.pending;editor.querySelector('[data-deactivate-confirm]').hidden=!state.pending;state.discardAction=null;editor.querySelector(state.pending?'[data-cancel-deactivate]':'input:not([readonly])')?.focus();return}
    if(event.target.closest('[data-confirm-discard]')){const action=state.discardAction;state.dirty=false;state.discardAction=null;action?.();return}
    if(event.target.closest('[data-cancel-deactivate]')){editor.querySelector('[data-deactivate-confirm]').hidden=true;editor.querySelector('form').hidden=false;state.pending=null;return}
    if(event.target.closest('[data-confirm-deactivate]'))void save(state.pending)
  })
  container.addEventListener('submit',event=>{
    if(!event.target.matches('[data-user-form]'))return;event.preventDefault();if(state.saving)return
    const form=event.target,values=new FormData(form),payload=state.mode==='password'?{password:values.get('password')}:{username:values.get('username'),email:values.get('email'),role:values.get('role') ?? state.selected?.role,active:form.elements.active.checked,...(!state.selected?{password:values.get('password')}:{})}
    if(state.selected)payload.expectedUpdatedAt=state.selected.updatedAt
    if(state.selected?.active&&payload.active===false){state.pending=payload;form.hidden=true;editor.querySelector('[data-deactivate-confirm]').hidden=false;editor.querySelector('[data-cancel-deactivate]').focus();return}
    void save(payload)
  })
  await refresh()
  const timer=window.setInterval(()=>{if(!container.isConnected){window.clearInterval(timer);return}if(document.visibilityState==='visible')void refresh()},15_000)
  const visible=()=>{if(document.visibilityState==='visible')void refresh()}
  const keys=event=>{
    if(editor.hidden)return
    if(event.key==='Escape'){event.preventDefault();if(state.discardAction)editor.querySelector('[data-cancel-discard]').click();else requestEditorAction(closeEditor)}
    if(event.key==='Tab'){const fields=[...editor.querySelectorAll('button,input,select,a[href]')].filter(el=>!el.disabled&&!el.closest('[hidden]'));const first=fields[0],last=fields.at(-1);if(!first)return;if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
  }
  const beforeUnload=event=>{if(state.dirty){event.preventDefault();event.returnValue=''}}
  const hidden=event=>{if(event.persisted)return;window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);document.removeEventListener('keydown',keys);window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('pagehide',hidden)}
  window.addEventListener('beforeunload',beforeUnload)
  document.addEventListener('keydown',keys)
  document.addEventListener('visibilitychange',visible);window.addEventListener('pagehide',hidden)
}
