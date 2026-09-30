import { patraNiagaLogoMarkup } from './brand-logo.js'
import { login } from '../services/account-session.js'
import { bindThemeToggle } from '../theme.js'

export function renderLoginPage(container) {
  document.title = 'SINERGI — Masuk'
  document.body.className = 'login-body'

  container.innerHTML = `
    <main class="login-page" aria-label="Halaman login SINERGI">
      <section class="login-card" aria-labelledby="login-title">
        <button class="login-theme-toggle" type="button" data-theme-toggle
          aria-label="Ganti tema" title="Ganti tema">
          <svg class="login-icon login-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
          </svg>
          <svg class="login-icon login-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        </button>
        <div class="brand-lockup" aria-label="SINERGI — Pertamina Patra Niaga">
          ${patraNiagaLogoMarkup()}
        </div>
        <header class="login-header">
          <h1 id="login-title">Masuk ke SINERGI</h1>
          <p>Gunakan akun yang telah disetujui administrator.</p>
        </header>
        <form class="login-form" id="login-form">
          <div class="field-group">
            <label for="email">Email atau username</label>
            <input id="email" name="email" type="text" autocomplete="username" required
              placeholder="nama@perusahaan.com atau username" />
          </div>
          <div class="field-group password-field-group">
            <label for="password">Kata sandi</label>
            <div class="password-field">
              <input id="password" name="password" type="password" autocomplete="current-password" required
                placeholder="Masukkan kata sandi" />
              <button class="password-toggle" type="button" aria-label="Tampilkan kata sandi" aria-pressed="false">
                <svg class="login-icon login-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                  <circle cx="12" cy="12" r="2.7" />
                </svg>
                <svg class="login-icon login-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 3l18 18M10.6 6.1A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a14.6 14.6 0 0 1-3 3.4M6.2 6.8A15.3 15.3 0 0 0 2.5 12s3.5 6 9.5 6c1 0 1.9-.2 2.8-.5" />
                </svg>
              </button>
            </div>
            <p class="forgot-row">Lupa kata sandi? Hubungi administrator.</p>
          </div>
          <p class="login-error" role="alert" hidden></p>
          <button class="primary-action" type="submit">Masuk</button>
        </form>
        <div class="secondary-action">
          <p>Belum memiliki akses? Hubungi administrator.</p>
        </div>
      </section>
    </main>
  `

  const passwordInput = container.querySelector('#password')
  const passwordToggle = container.querySelector('.password-toggle')
  bindThemeToggle()

  passwordToggle.addEventListener('click', () => {
    const isVisible = passwordInput.type === 'text'
    passwordInput.type = isVisible ? 'password' : 'text'
    passwordToggle.setAttribute('aria-pressed', String(!isVisible))
    passwordToggle.setAttribute('aria-label', isVisible ? 'Tampilkan kata sandi' : 'Sembunyikan kata sandi')
  })

  container.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const submit = event.currentTarget.querySelector('[type="submit"]')
    const errorMessage = container.querySelector('.login-error')
    errorMessage.hidden = true
    submit.disabled = true
    submit.textContent = 'Memeriksa…'
    try {
      await login(container.querySelector('#email').value.trim(), passwordInput.value)
      window.location.assign('/map')
    } catch (error) {
      errorMessage.textContent = error.message || 'Tidak dapat masuk. Coba lagi.'
      errorMessage.hidden = false
      passwordInput.focus()
    } finally {
      submit.disabled = false
      submit.textContent = 'Masuk'
    }
  })
}
