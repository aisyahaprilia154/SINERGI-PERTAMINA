import {registerNavigationGuard} from '../../services/navigation-guards.js'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AdminLayout } from '../components/AdminLayout.jsx'
import { DataTable } from '../components/DataTable.jsx'
import { Icon } from '../components/Icon.jsx'
import { previewMapPayload } from '../../domain/import-preview.js'
import { createPreviewMapAdapter } from '../../adapters/preview-map-adapter.js'
import { useImportPreview } from './useImportPreview.js'

function PreviewMap({ payload, createAdapter }) {
  const host = useRef(null), adapter = useRef(null)
  useEffect(() => {
    const instance = createAdapter(host.current); adapter.current = instance
    const stop = () => instance.dispose()
    window.addEventListener('pagehide', stop)
    return () => { stop(); adapter.current = null; window.removeEventListener('pagehide', stop) }
  }, [createAdapter])
  useEffect(() => { void adapter.current?.update(payload) }, [payload, createAdapter])
  return <div ref={host} className="operational-preview-map" data-preview-map />
}
function Conflict({ item, baseline, preview, busy, act }) {
  const [draft, setDraft] = useState({ existing: '', start: '', end: '' })
  useEffect(()=>registerNavigationGuard(()=>({dirty:Object.values(draft).some(Boolean),busy})),[draft,busy])
  const options = baseline.assets.filter(asset => !item.result?.candidates?.length || item.result.candidates.includes(asset.id))
  const available = [...baseline.assets.filter(asset => asset.objectRole === 'device_node'), ...preview.additions.assets.filter(asset => asset.kind === 'device')]
  const endpoints = [0, 1].map(index => item.result?.endpointCandidates?.[index]?.length ? item.result.endpointCandidates[index] : available.filter(asset => item.proposal.kind === 'mounting' && index === 1 ? asset.diagramRole === 'physical-mount' : asset.diagramRole !== 'physical-mount'))
  const value = (key, values) => values.some(asset => asset.id === draft[key]) ? draft[key] : ''
  const select = (key, values, label, attributes, existing = false) => <label>{label}<select {...attributes} disabled={busy} value={value(key, values)} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))}><option value="">{existing ? 'Pilih aset…' : 'Pilih…'}</option>{values.map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {existing ? `${asset.facilityName} · ` : ''}{asset.id}</option>)}</select></label>
  const action = decision => act('decision', item.id, { decision, ...(decision === 'match_existing' ? { assetId: value('existing', options) } : decision === 'connect' ? { sourceAssetId: value('start', endpoints[0]), targetAssetId: value('end', endpoints[1]) } : {}) })
  const button = (decision, label) => <button type="button" data-item-action={decision} disabled={busy} onClick={() => action(decision)}>{label}</button>
  return <article className="operational-conflict" data-conflict-item={item.id}><h3>{item.kind === 'relation' ? item.proposal.kind === 'mounting' ? 'Tiang pemasangan belum pasti' : 'Endpoint garis belum pasti' : item.proposal.name}</h3><p>{item.reason === 'identity_conflict' ? 'Identitas aset memiliki beberapa kemungkinan.' : item.reason === 'invalid_geometry' ? 'Koordinat sumber tidak valid.' : 'Garis belum memiliki satu pasangan endpoint yang pasti.'}</p>
    {item.kind === 'asset' && item.status !== 'invalid' && <>{select('existing', options, 'Aset lama', { 'data-existing-asset': true }, true)}{button('match_existing', 'Cocokkan ke aset lama')}{button('create_new', 'Pastikan sebagai aset baru')}</>}
    {item.kind === 'relation' && <>{select('start', endpoints[0], 'Endpoint awal', { 'data-endpoint-start': true })}{select('end', endpoints[1], 'Endpoint akhir', { 'data-endpoint-end': true })}{button('connect', 'Simpan pasangan')}</>}
    {button('skip', 'Lewati item')}
  </article>
}
const columns = [
  { key: 'name', header: 'Aset', render: item => item.proposal.name },
  { key: 'facility', header: 'Fasilitas', render: item => item.proposal.facility.name },
  { key: 'category', header: 'Kategori', render: item => item.proposal.category },
  { key: 'role', header: 'Peran', render: item => item.proposal.diagramRole },
]
export function PreviewPage({ importId, createAdapter = createPreviewMapAdapter }) {
  const { preview, baseline, busy, loading, error, run } = useImportPreview(importId)
  const [context, setContext] = useState(true), focus = useRef(null), refresh = useRef(null)
  const payload = useMemo(() => preview && baseline ? previewMapPayload(preview, baseline, context) : null, [preview, baseline, context])
  const act = (...args) => { focus.current = document.activeElement; void run(...args) }
  useLayoutEffect(() => {
    if (!busy && focus.current) { const target = focus.current.isConnected && !focus.current.disabled ? focus.current : refresh.current; target?.focus(); focus.current = null }
  }, [busy])
  return <AdminLayout active="imports" title="Preview — SINERGI"><section className="operational-import operational-preview" aria-busy={busy}>
    <a className="admin-back" href="/admin/datasets/import"><Icon>arrow_back</Icon>Riwayat import</a>
    <div className="au-heading preview-heading"><div><h1 data-preview-name>{preview?.import.name || 'Preview'}</h1><p className="admin-caption" data-preview-summary>{preview ? `${preview.summary.addedAssets} aset baru · ${preview.summary.addedRelations} relasi baru · ${preview.summary.conflicts} konflik` : loading ? 'Memuat tambahan…' : 'Preview belum dapat dimuat.'}</p></div><div className="operational-actions">
      <button type="button" data-apply className="au-button au-primary" disabled={busy || !preview || !!preview.summary.conflicts || preview.import.status !== 'ready'} onClick={() => act('apply')}>Terapkan tambahan</button>
      <button ref={refresh} type="button" className="au-icon" data-refresh disabled={busy || !preview} aria-label="Hitung ulang preview" title="Hitung ulang preview" onClick={() => act('refresh')}><Icon>refresh</Icon></button>
      <button type="button" className="au-icon" data-source disabled={busy || !preview} aria-label="Unduh sumber" title="Unduh sumber" onClick={() => act('source')}><Icon>download</Icon></button>
    </div></div>
    <p className="operational-error" role="alert" data-preview-error hidden={!error}>{error}</p>
    <p className="operational-status" role="status" data-preview-status>{busy ? 'Memproses…' : ''}</p>
    {error && <button type="button" className="au-button" disabled={busy} onClick={() => act('load')}>Coba lagi</button>}
    <section className="admin-section preview-map-section"><div className="admin-section-heading"><h2>Lokasi tambahan</h2><label className="admin-check"><input data-context type="checkbox" checked={context} onChange={event => setContext(event.target.checked)} />Tampilkan aset lama</label></div>{payload ? <PreviewMap payload={payload} createAdapter={createAdapter} /> : <div className="operational-preview-map" data-preview-map />}</section>
    <section className="admin-section"><div className="admin-section-heading"><h2>Tambahan aset</h2></div><div data-additions>{preview && (preview.items.some(item => item.kind === 'asset' && item.status === 'new') ? <DataTable columns={columns} rows={preview.items.filter(item => item.kind === 'asset' && item.status === 'new')} /> : <p>Tidak ada tambahan aset.</p>)}</div></section>
    <section className="admin-section" data-conflicts-section hidden={!preview?.conflicts.length}><div className="admin-section-heading"><h2>Konflik</h2></div><div data-conflicts>{preview?.conflicts.map(item => <Conflict key={item.id} item={item} preview={preview} baseline={baseline} busy={busy} act={act} />)}</div></section>
  </section></AdminLayout>
}
