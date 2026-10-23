import { useLayoutEffect, useRef, useState } from 'react'
import { useSession } from '../session/session-context.js'
import { useLoginTheme } from './useLoginTheme.js'

export function LoginPage() {
  const { signIn } = useSession()
  const { theme, toggleTheme } = useLoginTheme()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
        <button className="login-theme-toggle" type="button" data-theme-toggle
          aria-label={theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
          title={theme === 'dark' ? 'Mode terang' : 'Mode gelap'} aria-pressed={theme === 'dark'} onClick={toggleTheme}>
          <svg className="login-icon login-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" /></svg>
          <svg className="login-icon login-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
        </button>
        <div className="brand-lockup" aria-label="SINERGI — Pertamina Patra Niaga">
          <span className="brand-logo" aria-hidden="true">
            <svg className="brand-logo-mark" viewBox="0 0 88 68" focusable="false" role="presentation">
              <path className="brand-logo-mark-red" d="M31 4h29l15 20H46z" /><path className="brand-logo-mark-blue" d="M24 30h32L31 64H0z" /><path className="brand-logo-mark-green" d="M58 30h30L72 51H43z" />
            </svg>
            <span className="brand-logo-wordmark"><strong>PERTAMINA</strong><small>PATRA NIAGA</small></span>
          </span>
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
            <p className="forgot-row">Lupa kata sandi? Hubungi administrator.</p>
          </div>
          <p className="login-error" role="alert" hidden={!error}>{error}</p>
          <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Memeriksa…' : 'Masuk'}</button>
        </form>
        <div className="secondary-action"><p>Belum memiliki akses? Hubungi administrator.</p></div>
      </section>
    </main>
  )
}
