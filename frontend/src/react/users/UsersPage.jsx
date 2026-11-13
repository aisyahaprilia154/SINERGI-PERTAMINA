import {registerNavigationGuard} from '../../services/navigation-guards.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AdminLayout } from '../components/AdminLayout.jsx'
import { DataTable } from '../components/DataTable.jsx'
import { Drawer } from '../components/Drawer.jsx'
import { Icon } from '../components/Icon.jsx'
import { useSession } from '../session/session-context.js'
import { useUsers } from './useUsers.js'
import {AccessRequestsPanel} from './AccessRequestsPanel.jsx'

function lastSeenLabel(value, serverTime) {
  if (!value) return 'Belum pernah masuk'
  const seconds = Math.max(0, (new Date(serverTime) - new Date(value)) / 1000)
  if (seconds < 60) return 'Baru saja'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} menit lalu`
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

function UserEditor({ selected, users, save, onClose, onSaved }) {
  const [mode, setMode] = useState('edit')
  const [draft, setDraft] = useState({ username: selected?.username ?? '', email: selected?.email ?? '', role: selected?.role ?? 'Viewer', password: '' })
  const [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(null)
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const flight = useRef(false), alive = useRef(false), field = useRef(null), cancelDiscard = useRef(null)
  const lastAdmin = selected?.role === 'Administrator' && users.filter(user => user.role === 'Administrator').length === 1
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const guard = event => { if (dirty || flight.current) { event.preventDefault(); event.returnValue = '' } }
    const removeGuard=registerNavigationGuard(()=>({dirty,busy:flight.current}))
    window.addEventListener('beforeunload', guard)
    return () => {removeGuard();window.removeEventListener('beforeunload', guard)}
  }, [dirty])
  useLayoutEffect(() => { (discard ? cancelDiscard.current : field.current)?.focus() }, [mode, discard])
  const request = action => {
    if (flight.current) return
    if (dirty) setDiscard({ run: action })
    else action()
  }
  const close = () => { if (discard) setDiscard(null); else request(onClose) }
  const reset = () => { setMode('password'); setDraft(previous => ({ ...previous, password: '' })); setDirty(false); setError(''); setDiscard(null) }
  const change = event => { setDraft(previous => ({ ...previous, [event.target.name]: event.target.value })); setDirty(true) }
  const submit = async event => {
    event.preventDefault()
    if (flight.current) return
    flight.current = true; setSaving(true); setError('')
    const payload = mode === 'password' ? { password: draft.password }
      : { username: draft.username, email: draft.email, role: lastAdmin ? selected.role : draft.role, ...(!selected ? { password: draft.password } : {}) }
    if (selected) payload.expectedUpdatedAt = selected.updatedAt
    try {
      const result = await save(selected, mode, payload)
      if (result && alive.current) { setDirty(false); onSaved(mode) }
    } catch (caught) { if (alive.current) setError(caught.message) }
    finally { flight.current = false; if (alive.current) setSaving(false) }
  }
  const title = mode === 'password' ? 'Reset password' : selected ? 'Kelola pengguna' : 'Tambah pengguna'
  return <Drawer open title={title} busy={saving} initialFocusRef={field} onClose={close}>
    <p className="au-error" data-editor-error role="alert" hidden={!error}>{error}</p>
    <form data-user-form hidden={!!discard} onSubmit={submit}>
      {mode === 'password' ? <>
        <p>{selected.username}</p>
        <label>Password baru<input ref={field} type="password" name="password" autoComplete="new-password" minLength={15} maxLength={1024} required value={draft.password} onChange={change} disabled={saving} /></label>
        <small>Sesi pengguna akan diakhiri setelah password diubah.</small>
      </> : <>
        <label>Username<input ref={selected ? undefined : field} name="username" readOnly={!!selected} pattern="[a-zA-Z0-9._-]{1,64}" maxLength={64} required value={draft.username} onChange={change} disabled={saving} /></label>
        <label>Email (opsional)<input ref={selected ? field : undefined} name="email" type="email" maxLength={254} value={draft.email} onChange={change} disabled={saving} /></label>
        <label>Peran<select name="role" disabled={lastAdmin || saving} value={lastAdmin ? selected.role : draft.role} onChange={change}><option>Viewer</option><option>Administrator</option></select></label>
        {!selected && <label>Password awal<input name="password" type="password" autoComplete="new-password" minLength={15} maxLength={1024} required value={draft.password} onChange={change} disabled={saving} /></label>}
        {lastAdmin && <small>Administrator terakhir harus tetap tersedia.</small>}
        {selected && <button type="button" className="au-button" data-reset-password disabled={saving} onClick={() => request(reset)}>Reset password</button>}
      </>}
      <div className="au-editor-footer"><button type="button" className="au-button" data-close-editor disabled={saving} onClick={() => request(onClose)}>Batal</button><button type="submit" className="au-button au-primary" disabled={saving}>{mode === 'password' ? 'Ubah password' : selected ? 'Simpan perubahan' : 'Tambah pengguna'}</button></div>
    </form>
    <div data-discard-confirm hidden={!discard}><h2>Buang perubahan?</h2><p>Perubahan pada form ini belum disimpan.</p><div className="au-editor-footer"><button ref={cancelDiscard} type="button" className="au-button" data-cancel-discard onClick={() => setDiscard(null)}>Lanjutkan mengedit</button><button type="button" className="au-button au-danger" data-confirm-discard onClick={() => { setDirty(false); discard?.run() }}>Buang perubahan</button></div></div>
  </Drawer>
}

export function UsersPage() {
  const { user } = useSession()
  const { users, serverTime, lastLoaded, unconfirmed, loading, error, refresh, save } = useUsers(user?.id)
  const [query, setQuery] = useState(''), [role, setRole] = useState(''), [editor, setEditor] = useState(null), [notice, setNotice] = useState('')
  const [tab,setTab]=useState('users'),[pending,setPending]=useState(0)
  const filtered = users.filter(item => (!role || item.role === role) && `${item.username} ${item.email ?? ''}`.toLocaleLowerCase('id').includes(query.toLocaleLowerCase('id')))
  const columns = [
    { key: 'username', header: 'Pengguna', render: item => <><strong>{item.username}</strong>{item.email && <small>{item.email}</small>}</> },
    { key: 'role', header: 'Peran' },
    { key: 'presence', header: 'Terakhir online', render: item => <span className={`au-presence${!unconfirmed && item.online ? ' is-online' : ''}`}>{unconfirmed ? 'Belum diperbarui' : item.online ? 'Online' : lastSeenLabel(item.lastSeenAt, serverTime)}</span> },
    { key: 'manage', header: 'Kelola', render: item => <button type="button" className="au-row-action" data-edit-user={item.id} onClick={() => setEditor({ selected: structuredClone(item) })}>Kelola</button> },
  ]
  return <AdminLayout active="users" title="Kelola pengguna — SINERGI">
    <section className="au-main">
      <div className="au-heading"><div><h1>Kelola pengguna</h1></div><button type="button" className="au-button au-primary" data-new-user onClick={() => setEditor({ selected: null })}><Icon>add</Icon>Tambah pengguna</button></div>
      <div className="access-tabs" aria-label="Bagian kelola pengguna"><button type="button" aria-pressed={tab==='users'} onClick={()=>setTab('users')}>Pengguna</button><button type="button" aria-pressed={tab==='requests'} onClick={()=>setTab('requests')}>Permintaan akses &amp; bantuan{pending>0&&<span className="request-count">{pending}</span>}</button></div>
      <div hidden={tab!=='users'}>
      <div className="au-toolbar"><label className="au-search"><Icon>search</Icon><input data-search placeholder="Cari username atau email" aria-label="Cari pengguna" value={query} onChange={event => setQuery(event.target.value)} /></label><select data-role aria-label="Filter peran" value={role} onChange={event => setRole(event.target.value)}><option value="">Semua peran</option><option>Administrator</option><option>Viewer</option></select><button className="au-button" type="button" data-refresh disabled={loading} onClick={() => void refresh()}>Muat ulang</button></div>
      <p data-error className="au-error" role="alert" hidden={!error}>{error}</p><p data-notice className="au-notice" role="status" hidden={!notice}>{notice}</p>
      <DataTable columns={columns} rows={filtered} loading={loading} loadingMessage="Memuat pengguna…" emptyMessage="Tidak ada pengguna yang sesuai." ariaLabel="Pengguna" className="au-table-wrap" />
      <div className="au-table-footer"><span data-count>{loading && !lastLoaded ? '' : `${filtered.length} pengguna`}</span><span data-updated>{lastLoaded ? `Diperbarui ${new Date(lastLoaded).toLocaleTimeString('id-ID')}` : ''}</span></div>
      </div>
      <AccessRequestsPanel hidden={tab!=='requests'} onCount={setPending} onChanged={refresh}/>
    </section>
    {editor && <UserEditor selected={editor.selected} users={users} save={save} onClose={() => setEditor(null)} onSaved={mode => { setEditor(null); setNotice(mode === 'password' ? 'Password diubah dan sesi pengguna diakhiri.' : 'Data pengguna tersimpan.') }} />}
  </AdminLayout>
}
