import {useCallback,useEffect,useRef,useState} from 'react'
import {DataTable} from '../components/DataTable.jsx'
import {Drawer} from '../components/Drawer.jsx'
import {loadAccessRequests,reviewAccessRequest} from '../../services/access-requests-service.js'
import {clearSession} from '../../services/account-session.js'
import {documentNavigation} from '../../services/document-navigation.js'
import '../../styles/access-requests.css'

const labels={pending:'Menunggu',approved:'Disetujui',rejected:'Ditolak'}
function RequestReview({request,onClose,onDone}){
  const [draft,setDraft]=useState({username:(request.email??'').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,64),password:'',note:'',identityVerified:false,deliveryConfirmed:false})
  const [action,setAction]=useState('approve'),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const controller=useRef(null),flight=useRef(false)
  useEffect(()=>{const c=new AbortController();controller.current=c;return()=>c.abort()},[])
  const needsPassword=request.kind==='password_reset'||!request.google_subject
  const unavailable=request.kind==='password_reset'&&(!request.matched_user_id||request.has_password===false)
  async function submit(e){
    e.preventDefault();if(flight.current)return;flight.current=true;setBusy(true);setError('')
    try{await reviewAccessRequest(request.id,{action,...draft},{signal:controller.current.signal});if(!controller.current.signal.aborted)onDone()}
    catch(cause){if(!controller.current.signal.aborted)setError(cause.message)}
    finally{flight.current=false;if(!controller.current.signal.aborted)setBusy(false)}
  }
  const change=e=>setDraft(previous=>({...previous,[e.target.name]:e.target.type==='checkbox'?e.target.checked:e.target.value}))
  return <Drawer open title="Tinjau permintaan" busy={busy} onClose={onClose}>
    <div className="access-request-summary"><strong>{request.full_name||request.identifier}</strong><span>{request.email||request.identifier}</span>{request.unit_name&&<span>{request.unit_name}</span>}<small>{request.kind==='access'?'Pengajuan akses':'Bantuan reset password'}{request.google_subject?' · Identitas Google terverifikasi':''}</small></div>
    {request.status!=='pending'?<><p>Status: {labels[request.status]}</p><p>{request.review_note||'Tidak ada catatan.'}</p></>:<form className="access-review-form" onSubmit={submit}>
      <label>Tindakan<select value={action} onChange={e=>{setAction(e.target.value);setError('')}} disabled={busy}><option value="approve">{request.kind==='access'?'Setujui dan buat akun':'Verifikasi dan reset password'}</option><option value="reject">Tolak permintaan</option></select></label>
      {action==='approve'&&<>
        {request.kind==='access'?<><label>Username<input name="username" pattern="[a-zA-Z0-9._-]{1,64}" maxLength={64} required value={draft.username} onChange={change} disabled={busy}/></label><p className="au-notice">Akun dibuat sebagai Viewer.{request.google_subject?' Pemohon dapat langsung masuk dengan Google setelah disetujui.':''}</p>{request.matched_user_id&&<p className="au-error">Email ini sudah memiliki akun {request.matched_username}. Jangan membuat akun duplikat. Gunakan penghubungan Google dari akun tersebut bila diperlukan.</p>}</>:<p className={unavailable?'au-error':'au-notice'}>{!request.matched_user_id?'Akun tidak ditemukan. Periksa identitas dan tolak permintaan jika tidak sesuai.':request.has_password===false?'Akun ini menggunakan Google. Pemulihan dilakukan melalui Google; jangan menambahkan password melalui permintaan ini.':`Akun: ${request.matched_username}. Kontak terdaftar: ${request.registered_email||'Belum diisi'}.`}</p>}
        <label className="access-check"><input type="checkbox" name="identityVerified" checked={draft.identityVerified} onChange={change} required disabled={busy}/><span>Saya sudah memverifikasi identitas dan kewenangan akses pemohon melalui kanal internal resmi.</span></label>
        {needsPassword&&<><label>{request.kind==='access'?'Password awal':'Password baru'}<input name="password" type="password" autoComplete="new-password" minLength={15} maxLength={1024} required value={draft.password} onChange={change} disabled={busy}/></label><small>Minimal 15 karakter. Password tidak disimpan pada permintaan atau dikirim melalui email.</small><label className="access-check"><input type="checkbox" name="deliveryConfirmed" checked={draft.deliveryConfirmed} onChange={change} required disabled={busy}/><span>Saya akan menyampaikan akses langsung kepada pemilik akun melalui kanal internal resmi.</span></label></>}
      </>}
      <label>{action==='reject'?'Alasan penolakan':'Catatan admin (opsional)'}<textarea name="note" maxLength={500} required={action==='reject'} rows={3} value={draft.note} onChange={change} disabled={busy}/></label>
      {error&&<p className="au-error" role="alert">{error}</p>}
      <div className="au-editor-footer"><button className="au-button" type="button" disabled={busy} onClick={onClose}>Batal</button><button className="au-button au-primary" type="submit" disabled={busy||(action==='approve'&&(unavailable||!!(request.kind==='access'&&request.matched_user_id)))}>{busy?'Memproses…':action==='reject'?'Tolak permintaan':request.kind==='access'?'Setujui dan buat akun':'Reset dan selesaikan'}</button></div>
    </form>}
  </Drawer>
}

export function AccessRequestsPanel({hidden,onCount,onChanged}){
  const [state,setState]=useState({requests:[],loading:true,error:''}),[selected,setSelected]=useState(null),[filter,setFilter]=useState('pending'),[notice,setNotice]=useState('')
  const owner=useRef(null)
  const refresh=useCallback(async()=>{
    const c=owner.current;if(!c||c.signal.aborted)return
    try{const result=await loadAccessRequests({signal:c.signal});if(c.signal.aborted)return;setState({requests:result.requests??[],loading:false,error:''});onCount(result.pendingCount??0)}
    catch(cause){if(c.signal.aborted)return;if([401,403].includes(cause.status)){clearSession();documentNavigation.replace('/');return}setState(previous=>({...previous,loading:false,error:cause.message}))}
  },[onCount])
  useEffect(()=>{const c=new AbortController();owner.current=c;void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},15000);const stop=()=>{c.abort();clearInterval(timer)};window.addEventListener('pagehide',stop);return()=>{stop();window.removeEventListener('pagehide',stop)}},[refresh])
  const rows=state.requests.filter(r=>!filter||r.status===filter)
  return <section hidden={hidden} aria-label="Permintaan akses dan bantuan">
    <div className="au-toolbar"><label>Status permintaan <select aria-label="Status permintaan" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Semua status</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button type="button" className="au-button" onClick={()=>void refresh()}>Muat ulang permintaan</button></div>
    {state.error&&<p className="au-error" role="alert">{state.error}</p>}{notice&&<p className="au-notice" role="status">{notice}</p>}
    <DataTable columns={[
      {key:'kind',header:'Jenis',render:r=>r.kind==='access'?'Pengajuan akses':'Reset password'},
      {key:'identity',header:'Pemohon',render:r=><><strong>{r.full_name||r.identifier}</strong>{r.email&&<small>{r.email}</small>}{r.unit_name&&<small>{r.unit_name}</small>}{r.google_subject&&<small>Google terverifikasi</small>}</>},
      {key:'created_at',header:'Waktu',render:r=>new Date(r.created_at).toLocaleString('id-ID')},
      {key:'status',header:'Status',render:r=>labels[r.status]},
      {key:'review',header:'Tindakan',render:r=><button type="button" className="au-row-action" onClick={()=>setSelected(r)}>{r.status==='pending'?'Tinjau':'Lihat hasil'}</button>},
    ]} rows={rows} loading={state.loading} emptyMessage="Tidak ada permintaan pada status ini." ariaLabel="Permintaan akses dan bantuan" className="au-table-wrap"/>
    {selected&&<RequestReview request={selected} onClose={()=>setSelected(null)} onDone={()=>{setSelected(null);setNotice('Permintaan telah diproses.');void refresh();void onChanged()}}/>}
  </section>
}
