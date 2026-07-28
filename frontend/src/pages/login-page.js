export function renderLoginPage(container) {
  document.title = 'SINERGI — Masuk'
  document.body.className = 'login-body'

  container.innerHTML = `
    <main class="login-page" aria-label="Halaman login SINERGI">
      <section class="login-card" aria-labelledby="login-title">
        <div class="brand-lockup" aria-label="SINERGI">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="brand-name">SINERGI</span>
        </div>
        <header class="login-header">
          <h1 id="login-title">Masuk ke SINERGI</h1>
          <p>Gunakan akun yang telah disetujui administrator.</p>
        </header>
        <form class="login-form" id="login-form">
          <div class="field-group">
            <label for="email">Email atau username</label>
            <input id="email" name="email" type="text" autocomplete="username"
              placeholder="nama@perusahaan.com atau username" />
          </div>
          <div class="field-group password-field-group">
            <label for="password">Kata sandi</label>
            <div class="password-field">
              <input id="password" name="password" type="password" autocomplete="current-password"
                placeholder="Masukkan kata sandi" />
              <button class="password-toggle" type="button" aria-label="Tampilkan kata sandi" aria-pressed="false">
                <span class="material-symbols-outlined" aria-hidden="true">visibility</span>
              </button>
            </div>
            <div class="forgot-row"><a href="#forgot-password">Lupa kata sandi? Hubungi administrator.</a></div>
          </div>
          <button class="primary-action" type="submit">Masuk</button>
        </form>
        <div class="secondary-action">
          <span>Belum memiliki akses?</span>
          <button class="secondary-button" type="button">Ajukan Akses</button>
          <p>Pengajuan akses akan ditinjau oleh administrator.</p>
        </div>
      </section>
    </main>
  `

  const passwordInput = container.querySelector('#password')
  const passwordToggle = container.querySelector('.password-toggle')

  passwordToggle.addEventListener('click', () => {
    const isVisible = passwordInput.type === 'text'
    passwordInput.type = isVisible ? 'password' : 'text'
    passwordToggle.setAttribute('aria-pressed', String(!isVisible))
    passwordToggle.setAttribute('aria-label', isVisible ? 'Tampilkan kata sandi' : 'Sembunyikan kata sandi')
    passwordToggle.querySelector('.material-symbols-outlined').textContent = isVisible ? 'visibility' : 'visibility_off'
  })

  container.querySelector('#login-form').addEventListener('submit', (event) => {
    event.preventDefault()
    window.location.assign('/map')
  })
}
