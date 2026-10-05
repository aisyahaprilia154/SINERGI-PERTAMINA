const TOKEN_KEY = 'sinergiSessionToken'
const USER_KEY = 'sinergiSessionUser'

export function getSessionToken() {
  try { return window.sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export function getSessionUser() {
  try { return JSON.parse(window.sessionStorage.getItem(USER_KEY) || 'null') } catch { return null }
}

export function isAdministrator(user = getSessionUser()) {
  return String(user?.role ?? '').trim().toLowerCase() === 'administrator'
}

export function saveSession({ token, user }) {
  window.sessionStorage.setItem(TOKEN_KEY, token)
  window.sessionStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY)
    window.sessionStorage.removeItem(USER_KEY)
  } catch { /* A failed storage write already prevents a session. */ }
}

export async function login(identifier, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error?.message || 'Tidak dapat masuk. Coba lagi.')
  saveSession(body)
  return body.user
}

export async function loadCurrentUser() {
  const response = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${getSessionToken()}` },
  })
  if (!response.ok) throw new Error('Sesi sudah berakhir.')
  const user = (await response.json()).user
  window.sessionStorage.setItem(USER_KEY, JSON.stringify(user))
  return user
}

export async function logout() {
  const token = getSessionToken()
  clearSession()
  if (token) {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
  }
}
