import {useEffect,useRef,useState} from 'react'
import {AuthDialog} from '../components/AuthDialog.jsx'
import {submitAccessRequest} from '../../services/access-requests-service.js'

export function AccessRequestDialog({kind,google,onClose}){
  const [draft,setDraft]=useState({fullName:google?.profile.name??'',email:google?.profile.email??'',unit:'',identifier:''})
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('')
  const controller=useRef(null),flight=useRef(false)
  useEffect(()=>{const c=new AbortController();controller.current=c;return()=>c.abort()},[])
  const change=e=>setDraft(previous=>({...previous,[e.target.name]:e.target.value}))
  async function submit(e){
    e.preventDefault();if(flight.current)return;flight.current=true;setBusy(true);setError('')
    try{const result=await submitAccessRequest({kind,...draft,...(google?{applicationToken:google.applicationToken}:{})},{signal:controller.current.signal});if(!controller.current.signal.aborted)setSuccess(result.message)}
    catch(cause){if(!controller.current.signal.aborted)setError(cause.message)}
    finally{flight.current=false;if(!controller.current.signal.aborted)setBusy(false)}
  }
  return <AuthDialog title={kind==='access'?'Ajukan akses SINERGI':'Bantuan reset kata sandi'} onClose={onClose}>
    {success?<><p role="status">{success}</p><p>{google?'Setelah disetujui, pilih Lanjutkan dengan Google untuk masuk.':'Administrator akan menindaklanjuti melalui kanal internal resmi. Tidak ada email otomatis yang dikirim.'}</p><button className="auth-primary" type="button" onClick={onClose}>Kembali ke login</button></>:<form onSubmit={submit}>
      <p>{kind==='access'?'Lengkapi data berikut. Akses diberikan setelah disetujui administrator.':'Masukkan email atau username SINERGI. Administrator akan memeriksa permintaan dan memverifikasi identitas Anda.'}</p>
      {kind==='access'?<>
        <label>Nama lengkap<input name="fullName" autoComplete="name" required maxLength={128} value={draft.fullName} readOnly={!!google?.profile.name} onChange={change} disabled={busy}/></label>
        <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} value={draft.email} readOnly={!!google} onChange={change} disabled={busy}/></label>
        {google&&<small>Identitas Google terverifikasi. Pengajuan tetap perlu persetujuan administrator.</small>}
        <label>Unit / bagian<input name="unit" autoComplete="organization" required maxLength={120} value={draft.unit} onChange={change} disabled={busy}/></label>
      </>:<><label>Email atau username<input name="identifier" autoComplete="username" required maxLength={254} value={draft.identifier} onChange={change} disabled={busy}/></label><small>Administrator akan memverifikasi identitas Anda melalui kanal internal resmi.</small></>}
      {error&&<p className="auth-error" role="alert">{error}</p>}
      <button className="auth-primary" type="submit" disabled={busy}>{busy?'Mengirim…':kind==='access'?'Ajukan akses':'Kirim permintaan'}</button>
    </form>}
  </AuthDialog>
}
