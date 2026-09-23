const THEME_STORAGE_KEY = 'sinergi.theme'
const THEME_VALUES = new Set(['light', 'dark', 'system'])

let themeInteractionsBound = false
let systemThemeListenerBound = false

function readThemePreference() {
  if (typeof window === 'undefined') return 'system'

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return THEME_VALUES.has(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolvedTheme(preference) {
  return preference === 'system'
    ? systemPrefersDark() ? 'dark' : 'light'
    : preference
}

function persistThemePreference(preference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // The UI still works when storage is disabled.
  }
}

function updateThemeToggleButtons(theme) {
  if (typeof document === 'undefined') return

  const dark = theme === 'dark'
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.setAttribute('aria-pressed', String(dark))
    button.setAttribute('aria-label', dark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap')
    button.setAttribute('title', dark ? 'Mode terang' : 'Mode gelap')
    const icon = button.querySelector('[data-theme-icon]')
    if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode'
  })
}

export function applyTheme(preference = readThemePreference(), { persist = false } = {}) {
  const safePreference = THEME_VALUES.has(preference) ? preference : 'system'
  const theme = resolvedTheme(safePreference)
  const previousTheme = typeof document !== 'undefined'
    ? document.documentElement.dataset.theme
    : undefined

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }

  if (persist) persistThemePreference(safePreference)
  updateThemeToggleButtons(theme)
  if (typeof window !== 'undefined' && previousTheme && previousTheme !== theme) {
    window.dispatchEvent(new CustomEvent('sinergi:theme-change', { detail: { theme } }))
  }
  return theme
}

export function initializeTheme() {
  const preference = readThemePreference()
  applyTheme(preference)

  if (systemThemeListenerBound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handleSystemThemeChange = () => {
    if (readThemePreference() === 'system') applyTheme('system')
  }
  if (typeof media.addEventListener === 'function') media.addEventListener('change', handleSystemThemeChange)
  else media.addListener(handleSystemThemeChange)
  systemThemeListenerBound = true
}

export function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme || applyTheme()
  return applyTheme(currentTheme === 'dark' ? 'light' : 'dark', { persist: true })
}

export function bindThemeToggle() {
  if (typeof document === 'undefined') return

  if (!themeInteractionsBound) {
    document.addEventListener('click', (event) => {
      const trigger = event.target?.closest?.('[data-theme-toggle]')
      if (!trigger) return
      event.preventDefault()
      toggleTheme()
    })
    themeInteractionsBound = true
  }

  updateThemeToggleButtons(document.documentElement.dataset.theme || applyTheme())
}
