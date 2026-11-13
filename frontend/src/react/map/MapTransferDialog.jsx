import {registerNavigationGuard} from '../../services/navigation-guards.js'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { MapDialog } from './MapDialog.jsx'
import { useTransferActions } from './useTransferActions.js'
import { useSession } from '../session/session-context.js'
import '../../styles/map-transfer.css'

export function MapTransferDialog({ snapshot, onClose, onGuardChange }) {
  const {user}=useSession(),canImport=user?.role==='Administrator',title=useId()
  const [mode,setMode]=useState(canImport?snapshot.mode:'export'), [initialName]=useState(()=>`Tambahan aset ${new Date().toLocaleDateString('id-ID')}`)
  const [name,setName]=useState(initialName),[file,setFile]=useState(null)
  const guardRef=useRef({dirty:false,busy:false}), releasedRef=useRef(false)
  const releaseGuard=()=>{releasedRef.current=true;guardRef.current={dirty:false,busy:false};onGuardChange?.(guardRef.current)}
  const actions=useTransferActions({...snapshot,canImport,releaseGuard})
  const dirty=!!file||name!==initialName
  useLayoutEffect(()=>{
    const guard={dirty:!releasedRef.current&&dirty,busy:!releasedRef.current&&actions.busy};guardRef.current=guard;onGuardChange?.(guard)
    return()=>onGuardChange?.({dirty:false,busy:false})
  },[dirty,actions.busy,onGuardChange])
  useLayoutEffect(()=>{
    const unload=event=>{if(guardRef.current.dirty||guardRef.current.busy){event.preventDefault();event.returnValue=''}}
    const removeGuard=registerNavigationGuard(()=>guardRef.current)
    window.addEventListener('beforeunload',unload);return()=>{removeGuard();window.removeEventListener('beforeunload',unload)}
  },[])
  const close=()=>{
    if(actions.busy&&!window.confirm('Batalkan proses dan tutup dialog?'))return
    if(!actions.busy&&dirty&&!window.confirm('Buang draft impor yang belum diunggah?'))return
    releaseGuard();onClose()
  }
  return <MapDialog className="map-transfer-dialog" labelledBy={title} onClose={close}><div className="map-transfer-shell"><header className="map-transfer-header"><div><span className="eyebrow">DATA ASET</span><h2 id={title}>Impor dan ekspor</h2></div><button className="icon-button" type="button" aria-label="Tutup" onClick={close}>×</button></header>
    <nav className="map-transfer-tabs" aria-label="Pilihan transfer data">{canImport&&<button type="button" aria-pressed={mode==='import'} disabled={actions.busy} onClick={()=>setMode('import')}>Impor tambahan</button>}<button type="button" aria-pressed={mode==='export'} disabled={actions.busy} onClick={()=>setMode('export')}>Ekspor data</button></nav>
    <div className="map-transfer-body"><div hidden={mode!=='import'}><p>KMZ dapat berisi seluruh fasilitas. Sistem mencocokkan aset lama dan menampilkan tambahan untuk diperiksa.</p>
      {canImport&&<form data-upload onSubmit={event=>{event.preventDefault();void actions.upload({name,file})}}><label>Nama impor<input name="versionName" maxLength={180} value={name} required disabled={actions.busy} onChange={event=>setName(event.target.value)}/></label><label>File KML/KMZ<input name="file" type="file" accept=".kml,.kmz" required disabled={actions.busy} onChange={event=>setFile(event.target.files?.[0]||null)}/></label><button type="submit" disabled={actions.busy||actions.config.loading||!!actions.config.error}>Unggah dan lihat preview</button></form>}
      {canImport&&actions.config.loading&&<p role="status">Memuat konfigurasi unggahan…</p>}{canImport&&actions.config.error&&<p role="alert">{actions.config.error} <button type="button" onClick={actions.retryConfig}>Coba lagi konfigurasi</button></p>}
    </div><div hidden={mode!=='export'}><p>Unduh data operasional {snapshot.areaScopeLabel||'dataset aktif'} atau file asli dari impor terakhir.</p><div className="map-transfer-export-actions"><button type="button" disabled={actions.busy} onClick={()=>void actions.download()}>Ekspor KML operasional</button><button type="button" disabled={actions.busy||!snapshot.context.datasetVersionId} onClick={()=>void actions.download(true)}>Unduh sumber terakhir</button></div></div>
      <p role="status">{actions.progress}</p>{actions.error&&<p role="alert">{actions.error}</p>}{actions.resumable&&<button type="button" disabled={actions.busy} onClick={()=>void actions.resume()}>Coba lagi status impor</button>}{canImport&&<a href="/admin/datasets/import">Buka riwayat impor</a>}
    </div></div></MapDialog>
}
