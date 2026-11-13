import { useLayoutEffect, useRef, useState } from 'react'
import { useSession } from '../session/session-context.js'
import { BrandLogo } from '../components/BrandLogo.jsx'
import { ThemeToggle } from '../components/ThemeToggle.jsx'
import {AccessRequestDialog} from './AccessRequestDialog.jsx'

export function LoginPage() {
  const { signIn } = useSession()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [help,setHelp]=useState(null)
  const passwordInput = useRef(null)
  const inFlight = useRef(false)
  const active = useRef(false)

  useLayoutEffect(() => {
    active.current = true
    const title = document.title, className = document.body.className
    document.title = 'SINERGI — Masuk'
    document.body.className = 'login-body'
    return () => { active.current = false; document.title = title; document.body.className = className }
  }, [])

  async function submit(event) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setError(''); setBusy(true)
    try {
      await signIn(identifier.trim(), password)
    } catch (caught) {
      if (active.current && caught.name !== 'AbortError') {
        setError(caught.message || 'Tidak dapat masuk. Coba lagi.')
        passwordInput.current?.focus()
      }
    } finally {
      inFlight.current = false
      if (active.current) setBusy(false)
    }
  }

  return (
    <main className="login-page" aria-label="Halaman login SINERGI">
      <section className="login-card" aria-labelledby="login-title">
        <ThemeToggle variant="login" />
        <div className="brand-lockup" aria-label="SINERGI — Pertamina Patra Niaga">
          <BrandLogo />
        </div>
        <header className="login-header"><h1 id="login-title">Masuk ke SINERGI</h1><p>Gunakan akun yang telah disetujui administrator.</p></header>
        <form className="login-form" id="login-form" onSubmit={submit}>
          <div className="field-group">
            <label htmlFor="email">Email atau username</label>
            <input id="email" name="email" type="text" autoComplete="username" required placeholder="nama@perusahaan.com atau username" value={identifier} onChange={event => setIdentifier(event.target.value)} />
          </div>
          <div className="field-group password-field-group">
            <label htmlFor="password">Kata sandi</label>
            <div className="password-field">
              <input ref={passwordInput} id="password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required placeholder="Masukkan kata sandi" value={password} onChange={event => setPassword(event.target.value)} />
              <button className="password-toggle" type="button" aria-label={visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} aria-pressed={visible} onClick={() => setVisible(value => !value)}>
                <svg className="login-icon login-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.7" /></svg>
                <svg className="login-icon login-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a14.6 14.6 0 0 1-3 3.4M6.2 6.8A15.3 15.3 0 0 0 2.5 12s3.5 6 9.5 6c1 0 1.9-.2 2.8-.5" /></svg>
              </button>
            </div>
            <p className="forgot-row"><button type="button" className="auth-link" onClick={()=>setHelp({kind:'password_reset'})}>Lupa kata sandi?</button></p>
          </div>
          <p className="login-error" role="alert" hidden={!error}>{error}</p>
          <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Memeriksa…' : 'Masuk'}</button>
        </form>
        <div className="secondary-action"><p>Belum memiliki akses? <button type="button" className="auth-link" onClick={()=>setHelp({kind:'access'})}>Ajukan akses</button></p></div>
      </section>
      {help&&<AccessRequestDialog key={help.kind} {...help} onClose={()=>setHelp(null)}/>}
    </main>
  )
}
