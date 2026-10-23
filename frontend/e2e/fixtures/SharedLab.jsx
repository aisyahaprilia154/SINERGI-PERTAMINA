import { useRef, useState } from 'react'
import '../../src/style.css'
import '../../src/styles/admin-route.css'
import '../../src/styles/topology-workspace.css'
import '../../src/styles/topology-refinement.css'
import '../../src/styles/app-harmony.css'
import { ThemeProvider } from '../../src/react/theme/ThemeProvider.jsx'
import { SessionContext } from '../../src/react/session/session-context.js'
import { AdminLayout } from '../../src/react/components/AdminLayout.jsx'
import { DataTable } from '../../src/react/components/DataTable.jsx'
import { Drawer } from '../../src/react/components/Drawer.jsx'
import { Dialog } from '../../src/react/components/Dialog.jsx'
import { WorkspaceControls } from '../../src/react/components/WorkspaceControls.jsx'
import { Icon } from '../../src/react/components/Icon.jsx'

const admin = { id: 'baseline-admin', username: 'baseline', name: 'Baseline Administrator', role: 'Administrator' }
const viewer = { id: 'baseline-viewer', username: 'viewer', name: 'Baseline Viewer', role: 'Viewer' }
const columns = [{ key: 'username', header: 'Pengguna' }, { key: 'role', header: 'Peran' }]

export function SharedLab() {
  const user = new URLSearchParams(window.location.search).get('role') === 'Viewer' ? viewer : admin
  const [drawer, setDrawer] = useState(false), [dialog, setDialog] = useState(false), [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(''), [zoom, setZoom] = useState(1), [logoutCount, setLogoutCount] = useState(0)
  const initialFocus = useRef(null)
  return <ThemeProvider><SessionContext value={{ user, status: 'authenticated', signOut: () => setLogoutCount(value => value + 1) }}>
    <AdminLayout active="users" context={{ datasetId: 'dataset-semarang' }} title="Komponen bersama — SINERGI">
      <section className="au-main">
        <div className="au-heading"><h1>Kelola pengguna</h1><button type="button" className="au-button au-primary" onClick={() => setDrawer(true)}><Icon>add</Icon>Tambah pengguna</button></div>
        <DataTable columns={columns} rows={[admin, viewer]} className="au-table-wrap" ariaLabel="Pengguna" />
        <p data-logout-count>Logout: {logoutCount}</p>
        <div style={{ position: 'relative', height: 100 }}><WorkspaceControls zoom={zoom} onZoomIn={() => setZoom(value => value + 0.25)} onZoomOut={() => setZoom(value => value - 0.25)} onReset={() => setZoom(1)} onFit={() => setZoom(0.75)} /></div>
        <Drawer open={drawer} title="Tambah pengguna" onClose={() => setDrawer(false)} busy={busy} initialFocusRef={initialFocus}>
          <form onSubmit={event => event.preventDefault()}>
            <label>Username<input ref={initialFocus} value={draft} onChange={event => setDraft(event.target.value)} /></label>
            <div className="au-editor-footer">
              <button type="button" className="au-button" onClick={() => setBusy(value => !value)}>{busy ? 'Selesai' : 'Mulai proses'}</button>
              <button type="button" className="au-button au-primary" onClick={() => setDialog(true)}>Konfirmasi</button>
            </div>
          </form>
          <Dialog open={dialog} title="Konfirmasi perubahan" onClose={() => setDialog(false)} footer={<button type="button" className="au-button" onClick={() => setDialog(false)}>Kembali</button>}><p>Periksa draft sebelum melanjutkan.</p></Dialog>
        </Drawer>
      </section>
    </AdminLayout>
  </SessionContext></ThemeProvider>
}
