import {adminDrawerMarkup,adminDrawerHeading,bindAdminOverlay} from '../../components/admin-overlay.js'
import {loadUsers,createUser,updateUser,resetUserPassword} from '../../services/admin-users-service.js'
import {getSessionUser,clearSession} from '../../services/account-session.js'
import {mountAdminShell} from '../../components/admin-shell.js'
import {escapeHtml as e} from './import-view-utils.js'

export function lastSeenLabel(value,serverTime){
  if(!value)return 'Belum pernah masuk'
  const seconds=Math.max(0,(new Date(serverTime)-new Date(value))/1000)
  if(seconds<60)return 'Baru saja'
  if(seconds<3600)return `${Math.floor(seconds/60)} menit lalu`
  return new Date(value).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})
}
export function renderUserRows(users,{serverTime,unconfirmed=false}={}){
  if(!users.length)return '<tr><td colspan="4" class="au-empty">Tidak ada pengguna yang sesuai.</td></tr>'
  return users.map(u=>`<tr><td><strong>${e(u.username)}</strong>${u.email?`<small>${e(u.email)}</small>`:''}</td><td>${e(u.role)}</td><td><span class="au-presence ${!unconfirmed&&u.online?'is-online':''}">${e(unconfirmed?'Belum diperbarui':u.online?'Online':lastSeenLabel(u.lastSeenAt,serverTime))}</span></td><td><button type="button" class="au-row-action" data-edit-user="${e(u.id)}">Kelola</button></td></tr>`).join('')
}

export async function renderUsersPage(container){
  document.title='Kelola pengguna — SINERGI';
  const current=getSessionUser(),state={users:[],serverTime:null,unconfirmed:false,selected:null,mode:'edit',loading:false,saving:false,query:'',role:'',lastLoaded:null,dirty:false,returnFocus:null,discardAction:null}
  const content=mountAdminShell(container,{active:'users'})
  content.innerHTML=`    <section class="au-main"><div class="au-heading"><div><h1>Kelola pengguna</h1></div><button type="button" class="au-button au-primary" data-new-user><span class="material-symbols-outlined" aria-hidden="true">add</span>Tambah pengguna</button></div><div class="au-toolbar"><label class="au-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><input data-search placeholder="Cari username atau email" aria-label="Cari pengguna"></label><select data-role aria-label="Filter peran"><option value="">Semua peran</option><option>Administrator</option><option>Viewer</option></select><button class="au-button" type="button" data-refresh>Muat ulang</button></div>
    <p data-error class="au-error" role="alert" hidden></p><p data-notice class="au-notice" role="status" hidden></p><div class="au-table-wrap"><table><thead><tr><th>Pengguna</th><th>Peran</th><th>Terakhir online</th><th>Kelola</th></tr></thead><tbody data-rows><tr><td colspan="4" class="au-empty">Memuat pengguna…</td></tr></tbody></table></div><div class="au-table-footer"><span data-count></span><span data-updated></span></div></section>${adminDrawerMarkup('au-editor')}`
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
  function closeEditor(){if(state.saving)return;state.selected=null;state.dirty=false;state.discardAction=null;editor.hidden=true;layer.hidden=true;content.querySelector('.au-main').inert=false;editor.innerHTML='';document.body.classList.remove('admin-editor-open');if(state.returnFocus?.isConnected)state.returnFocus.focus();else container.querySelector('[data-new-user]').focus()}
  function requestEditorAction(action){
    if(state.saving)return
    if(!state.dirty){action();return}
    state.discardAction=action;editor.querySelector('form').hidden=true;editor.querySelector('[data-discard-confirm]').hidden=false;editor.querySelector('[data-cancel-discard]').focus()
  }
  function openEditor(user=null,mode='edit'){
    if(layer.hidden)state.returnFocus=document.activeElement
    state.selected=user?structuredClone(user):null;state.mode=mode;state.dirty=false;state.discardAction=null;editor.hidden=false;layer.hidden=false;content.querySelector('.au-main').inert=true;document.body.classList.add('admin-editor-open')
    const lastAdmin=user?.role==='Administrator'&&state.users.filter(u=>u.role==='Administrator').length===1
    const title=mode==='password'?'Reset password':user?'Kelola pengguna':'Tambah pengguna'
    editor.innerHTML=`${adminDrawerHeading(title,'au-editor')}<p class="au-error" data-editor-error role="alert" hidden></p><form data-user-form>
      ${mode==='password'?`<p>${e(user.username)}</p><label>Password baru<input type="password" name="password" autocomplete="new-password" minlength="8" maxlength="1024" required></label><small>Sesi pengguna akan diakhiri setelah password diubah.</small>`:
      `<label>Username<input name="username" value="${e(user?.username ?? '')}" ${user?'readonly':''} pattern="[a-zA-Z0-9._-]{1,64}" maxlength="64" required></label><label>Email (opsional)<input name="email" type="email" value="${e(user?.email ?? '')}" maxlength="254"></label><label>Peran<select name="role" ${lastAdmin?'disabled':''}><option ${user?.role!=='Administrator'?'selected':''}>Viewer</option><option ${user?.role==='Administrator'?'selected':''}>Administrator</option></select></label>${!user?'<label>Password awal<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="1024" required></label>':''}${lastAdmin?'<small>Administrator terakhir harus tetap tersedia.</small>':''}${user?'<button type="button" class="au-button" data-reset-password>Reset password</button>':''}`}
      <div class="au-editor-footer"><button type="button" class="au-button" data-close-editor>Batal</button><button type="submit" class="au-button au-primary">${mode==='password'?'Ubah password':user?'Simpan perubahan':'Tambah pengguna'}</button></div></form><div data-discard-confirm hidden><h2>Buang perubahan?</h2><p>Perubahan pada form ini belum disimpan.</p><div class="au-editor-footer"><button type="button" class="au-button" data-cancel-discard>Lanjutkan mengedit</button><button type="button" class="au-button au-danger" data-confirm-discard>Buang perubahan</button></div></div>`
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
    if(event.target.closest('[data-cancel-discard]')){editor.querySelector('[data-discard-confirm]').hidden=true;editor.querySelector('form').hidden=false;state.discardAction=null;editor.querySelector('input:not([readonly])')?.focus();return}
    if(event.target.closest('[data-confirm-discard]')){const action=state.discardAction;state.dirty=false;state.discardAction=null;action?.();return}
  })
  container.addEventListener('submit',event=>{
    if(!event.target.matches('[data-user-form]'))return;event.preventDefault();if(state.saving)return
    const form=event.target,values=new FormData(form),payload=state.mode==='password'?{password:values.get('password')}:{username:values.get('username'),email:values.get('email'),role:values.get('role') ?? state.selected?.role,...(!state.selected?{password:values.get('password')}:{})}
    if(state.selected)payload.expectedUpdatedAt=state.selected.updatedAt
    void save(payload)
  })
  await refresh()
  const timer=window.setInterval(()=>{if(!container.isConnected){window.clearInterval(timer);return}if(document.visibilityState==='visible')void refresh()},15_000)
  const visible=()=>{if(document.visibilityState==='visible')void refresh()}
  const disposeKeys=bindAdminOverlay(editor,{isOpen:()=>!editor.hidden,isBusy:()=>state.saving,onEscape:()=>{if(state.discardAction)editor.querySelector('[data-cancel-discard]').click();else requestEditorAction(closeEditor)}})
  const beforeUnload=event=>{if(state.dirty){event.preventDefault();event.returnValue=''}}
  const hidden=event=>{if(event.persisted)return;window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);disposeKeys();window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('pagehide',hidden)}
  window.addEventListener('beforeunload',beforeUnload)
  document.addEventListener('visibilitychange',visible);window.addEventListener('pagehide',hidden)
}
