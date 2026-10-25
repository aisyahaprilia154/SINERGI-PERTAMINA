import {registerNavigationGuard} from '../../services/navigation-guards.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AdminLayout } from '../components/AdminLayout.jsx'
import { DataTable } from '../components/DataTable.jsx'
import { Drawer } from '../components/Drawer.jsx'
import { Icon } from '../components/Icon.jsx'
import { documentNavigation } from '../../services/document-navigation.js'
import { useImports } from './useImports.js'

const statuses = { processing: 'Diproses', ready: 'Siap diperiksa', failed: 'Gagal', archived: 'Arsip', applied: 'Diterapkan' }
function statusLabel(item) { return item.status === 'applied' && item.included_in_active === false ? 'Pernah diterapkan · di luar data aktif' : statuses[item.status] || item.status }

function ImportEditor({ datasetId, maxFileSize, uploading, uploadStatus, upload, onClose }) {
  const [name, setName] = useState(''), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false), [validation, setValidation] = useState('')
  const field = useRef(null), file = useRef(null), keep = useRef(null), flight = useRef(false), leaving = useRef(false), alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const guard = event => { if (!leaving.current && (dirty || flight.current)) { event.preventDefault(); event.returnValue = '' } }
    const removeGuard=registerNavigationGuard(()=>({dirty:!leaving.current&&dirty,busy:!leaving.current&&flight.current}))
    window.addEventListener('beforeunload', guard)
    return () => {removeGuard();window.removeEventListener('beforeunload', guard)}
  }, [dirty])
  useLayoutEffect(() => { (discard ? keep.current : field.current)?.focus() }, [discard])
  const requestClose = () => { if (flight.current) return; if (discard) setDiscard(false); else if (dirty) setDiscard(true); else onClose() }
  const submit = async event => {
    event.preventDefault()
    if (flight.current) return
    const selected = file.current.files[0]
    if (!selected?.size || selected.size > maxFileSize || !/\.(kml|kmz)$/i.test(selected.name)) { setValidation('Pilih file KML/KMZ dengan ukuran yang diperbolehkan.'); return }
    flight.current = true; setValidation('')
    const destination = await upload({ datasetId, versionName: name, file: selected })
    if (!alive.current) return
    if (destination) { leaving.current = true; setDirty(false); documentNavigation.assign(destination) }
    else flight.current = false
  }
  return <Drawer open title="Impor KML/KMZ" busy={uploading} initialFocusRef={field} onClose={requestClose}>
    <form data-import-form hidden={discard} aria-busy={uploading} onSubmit={submit}>
      <input name="datasetId" type="hidden" value={datasetId} readOnly disabled={uploading} />
      <label>Nama impor<input ref={field} name="versionName" maxLength={180} placeholder="Tambahan aset Oktober" required value={name} disabled={uploading} onChange={event => { setName(event.target.value); setDirty(true) }} /></label>
      <label>File KML/KMZ<input ref={file} name="file" type="file" accept=".kml,.kmz" required disabled={uploading} onChange={() => setDirty(true)} /></label>
      <small>Maksimum {Math.round(maxFileSize / 1024 / 1024)} MB. Tambahan diperiksa sebelum diterapkan.</small>
      <p className="operational-status" role="status" data-upload-status>{validation || uploadStatus}</p>
      <div className="au-editor-footer"><button type="button" className="au-button" data-close-editor disabled={uploading} onClick={requestClose}>Batal</button><button className="au-button au-primary" type="submit" disabled={uploading}>Unggah dan lihat preview</button></div>
    </form>
    <section data-discard-confirm hidden={!discard}><h2>Buang draft impor?</h2><p>Nama dan file yang dipilih belum diunggah.</p><div className="au-editor-footer"><button ref={keep} type="button" className="au-button" data-keep-draft onClick={() => setDiscard(false)}>Lanjutkan mengisi</button><button type="button" className="au-button au-danger" data-discard-draft onClick={onClose}>Buang draft</button></div></section>
  </Drawer>
}

export function ImportsPage() {
  const { config, history, datasetId, loading, status, failed, uploading, uploadStatus, resetUploadStatus, upload, download, refresh, selectDataset } = useImports()
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [filter, setFilter] = useState('')
  const selected = history.filter(item => (!item.dataset_id || item.dataset_id === datasetId) && (!filter || item.status === filter) && `${item.name} ${item.source_filename ?? ''}`.toLocaleLowerCase('id').includes(query.toLocaleLowerCase('id')))
  const name = dataset => dataset.name || (dataset.id === 'dataset-semarang' ? 'SINERGI' : dataset.id)
  const columns = [
    { key: 'name', header: 'Impor', render: item => <><strong>{item.name}</strong><small>{item.source_filename}</small></> },
    { key: 'time', header: 'Waktu', render: item => new Date(item.created_at).toLocaleString('id-ID') },
    { key: 'summary', header: 'Hasil', render: item => item.summary?.legacy ? 'Baseline / arsip lama' : `${Number(item.summary?.addedAssets ?? 0)} aset · ${Number(item.summary?.addedRelations ?? 0)} koneksi` },
    { key: 'status', header: 'Status', render: statusLabel },
    { key: 'actions', header: '', render: item => <>{item.status === 'ready' && <a className="au-row-action" href={`/admin/datasets/import/${encodeURIComponent(item.id)}/preview`}>Preview</a>}{' '}{item.source_filename && <button type="button" className="au-row-action" data-download-source={item.id} onClick={() => void download(item.id)}>File sumber</button>}</> },
  ]
  return <AdminLayout active="imports" title="Riwayat import — SINERGI"><section className="operational-import" data-import-workspace>
    <div className="au-heading"><h1>Riwayat import</h1><button type="button" className="au-button au-primary" data-open-import disabled={!config || loading || uploading} onClick={() => setOpen(true)}><Icon>upload</Icon>Impor KML/KMZ</button></div>
    {config && <div data-import-content><div className="au-toolbar admin-dataset-context">{config.datasets.length === 1 ? <span>Dataset <strong>{name(config.datasets[0])}</strong></span> : <label>Dataset <select data-dataset-context aria-label="Dataset aktif" value={datasetId} disabled={open || uploading} onChange={event => selectDataset(event.target.value)}>{config.datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{name(dataset)}</option>)}</select></label>}</div>
      <div className="au-toolbar" data-history-filters><label className="au-search"><Icon>search</Icon><input aria-label="Cari riwayat impor" placeholder="Cari nama impor atau file" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filter status impor" value={filter} onChange={event => setFilter(event.target.value)}><option value="">Semua status</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <section className="admin-section"><div data-import-history>{selected.length ? <DataTable columns={columns} rows={selected} ariaLabel="Riwayat impor" /> : <p>{query || filter ? 'Tidak ada impor yang sesuai.' : 'Belum ada impor.'}</p>}</div></section>
    </div>}
    <p className="operational-status" data-page-status role="status">{loading ? 'Memuat data…' : status}</p>
    {failed && <button type="button" className="au-button" onClick={() => void refresh()}>Coba lagi</button>}
    {open && <ImportEditor datasetId={datasetId} maxFileSize={config.maxFileSize} uploading={uploading} uploadStatus={uploadStatus} upload={upload} onClose={() => { setOpen(false); resetUploadStatus() }} />}
  </section></AdminLayout>
}
