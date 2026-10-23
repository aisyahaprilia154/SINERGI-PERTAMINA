import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { AdminLayout } from '../components/AdminLayout.jsx'
import { DataTable } from '../components/DataTable.jsx'
import { Dialog } from '../components/Dialog.jsx'
import { useDatasetConfig } from './useDatasetConfig.js'
import { useDatasetVersions } from './useDatasetVersions.js'

function VersionDialog({ snapshot, busy, onClose, onSubmit }) {
  const [name, setName] = useState(''), [message, setMessage] = useState('')
  const field = useRef(null), flight = useRef(false), alive = useRef(false), titleId = useId()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const version = snapshot.version
  const submit = async event => {
    event.preventDefault()
    if (flight.current) return
    if (!version && !name.trim()) { setMessage('Isi nama versi terlebih dahulu.'); field.current.focus(); return }
    flight.current = true
    setMessage(version ? 'Memulihkan data…' : 'Menyimpan versi…')
    try {
      const error = await onSubmit(name.trim())
      if (alive.current && error) setMessage(error.message)
    } finally { flight.current = false }
  }
  return <Dialog open heading={false} labelledBy={titleId} className="operational-import" busy={busy} initialFocusRef={field} onClose={onClose}>
    <form data-version-form onSubmit={submit}>
      <h2 id={titleId}>{version ? 'Pulihkan versi database' : 'Simpan versi database'}</h2>
      {version ? <><p>Kembali ke <strong>{version.name}</strong>?</p><p>Aset, relasi, ikon, mounting, dan layout akan mengikuti versi ini. Keadaan sekarang disimpan otomatis sebelum digantikan. Akun dan riwayat audit tetap dipertahankan.</p></>
        : <><p>Perubahan yang sudah tersimpan di peta dan diagram akan menjadi titik pemulihan.</p><label>Nama versi<input ref={field} name="name" maxLength={180} required placeholder="Diagram sudah dikoreksi" value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label></>}
      <p className="operational-status" role="status" data-dialog-status>{message}</p>
      <div className="version-dialog-actions"><button ref={version ? field : undefined} type="button" data-cancel-version disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="operational-primary" disabled={busy}>{version ? 'Pulihkan' : 'Simpan versi'}</button></div>
    </form>
  </Dialog>
}

function VersionsPanel({ datasetId, onBusy }) {
  const { data, valid, loading, status, failed, busy, refresh, write, setMessage } = useDatasetVersions(datasetId, onBusy)
  const [dialog, setDialog] = useState(null)
  const saveButton = useRef(null), mounted = useRef(false), returnFocus = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useLayoutEffect(() => {
    if (!returnFocus.current || loading || busy || dialog) return
    if (document.activeElement === document.body) saveButton.current?.focus()
    returnFocus.current = false
  }, [loading, busy, dialog])
  const active = valid && data.versions.find(version => version.id === data.currentVersionId)
  const open = (version = null) => { if (valid && !busy && !loading) setDialog({ datasetId, expectedRevision: data.revision, version: version ? structuredClone(version) : null }) }
  const submit = async name => {
    try {
      const result = await write(dialog, name)
      if (!result || !mounted.current) return null
      returnFocus.current = true; setDialog(null)
      setMessage(dialog.version ? `Versi “${dialog.version.name}” dipulihkan. Peta dan diagram mengikuti revision terbaru.`
        : result.existing ? `Keadaan ini sudah tersimpan sebagai “${result.version.name}”.` : `Versi “${result.version.name}” tersimpan.`)
      await refresh({ keepMessage: true })
      return null
    } catch (error) {
      if (!mounted.current) return null
      if (error.status === 409) { returnFocus.current = true; setDialog(null); setMessage(error.message) }
      await refresh({ keepMessage: true })
      return error.status === 409 ? null : error
    }
  }
  const columns = [
    { key: 'name', header: 'Versi', render: version => <>{version.name}{version.id === data.currentVersionId && <small>Aktif</small>}</> },
    { key: 'time', header: 'Waktu', render: version => new Date(version.created_at).toLocaleString('id-ID') },
    { key: 'actor', header: 'Pembuat', render: version => version.actor_name || version.actor_id || 'Sistem' },
    { key: 'summary', header: 'Isi', render: version => `${Number(version.summary.assets)} aset · ${Number(version.summary.relations)} koneksi` },
    { key: 'restore', header: '', render: version => <button type="button" className="au-row-action" data-restore-version={version.id} disabled={!valid || busy || loading || version.id === data.currentVersionId} onClick={() => open(version)}>Pulihkan</button> },
  ]
  return <section className="admin-section" data-dataset-versions>
    <div className="admin-section-heading version-panel-heading"><h2>Versi tersimpan <small>10 versi maksimum</small></h2><button ref={saveButton} type="button" className="au-button" data-save-version disabled={!valid || loading || busy} onClick={() => open()}>Simpan versi</button></div>
    <p className="admin-caption" data-version-state>{failed ? 'Status versi belum diperbarui.' : valid ? active ? `Data aktif: “${active.name}”.` : 'Ada perubahan sejak versi terakhir disimpan.' : ''}</p>
    <div data-version-list>{data?.versions.length ? <DataTable columns={columns} rows={data.versions} ariaLabel="Versi database" loading={loading} /> : valid && <p>Belum ada versi tersimpan. Simpan keadaan saat ini untuk membuat titik pemulihan.</p>}</div>
    <p className="operational-status" role="status" data-version-status>{status}</p>
    {failed && <button type="button" className="au-button" disabled={loading} onClick={() => void refresh()}>Coba lagi</button>}
    {dialog && <VersionDialog snapshot={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null) }} onSubmit={submit} />}
  </section>
}

export function VersionsPage() {
  const { datasets, datasetId, loading, error, retry, selectDataset } = useDatasetConfig()
  const [busy, setBusy] = useState(false)
  const name = dataset => dataset.name || (dataset.id === 'dataset-semarang' ? 'SINERGI' : dataset.id)
  return <AdminLayout active="versions" title="Versi database — SINERGI"><section className="operational-import">
    <div className="au-heading"><div><h1>Versi database</h1><p>Simpan keadaan database atau pulihkan ke versi sebelumnya.</p></div></div>
    {datasets.length > 0 && <div data-versions-content><div className="au-toolbar admin-dataset-context">{datasets.length === 1 ? <span>Dataset <strong>{name(datasets[0])}</strong></span> : <label>Dataset <select data-dataset-context aria-label="Dataset aktif" value={datasetId} disabled={busy} onChange={event => selectDataset(event.target.value)}>{datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{name(dataset)}</option>)}</select></label>}</div><VersionsPanel key={datasetId} datasetId={datasetId} onBusy={setBusy} /></div>}
    <p className="operational-status" data-page-status role="status">{loading ? 'Memuat data…' : error}</p>
    {error && <button type="button" className="au-button" onClick={retry}>Coba lagi</button>}
  </section></AdminLayout>
}
