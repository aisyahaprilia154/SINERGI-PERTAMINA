const THEME_STORAGE_KEY = 'sinergi.theme'
const THEME_VALUES = new Set(['light', 'dark', 'system'])

let themeOwners = 0
let detachSystemTheme = null
let transitionFrame = null

function stopThemeTransition() {
  if (transitionFrame !== null) cancelAnimationFrame(transitionFrame)
  transitionFrame = null
  document.documentElement.classList.remove('theme-switching')
}

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

export function applyTheme(preference = readThemePreference(), { persist = false } = {}) {
  const safePreference = THEME_VALUES.has(preference) ? preference : 'system'
  const theme = resolvedTheme(safePreference)
  const previousTheme = typeof document !== 'undefined'
    ? document.documentElement.dataset.theme
    : undefined

  if (typeof document !== 'undefined') {
    if (previousTheme && previousTheme !== theme) {
      stopThemeTransition()
      document.documentElement.classList.add('theme-switching')
      transitionFrame = requestAnimationFrame(() => { transitionFrame = requestAnimationFrame(() => {
        transitionFrame = null
        document.documentElement.classList.remove('theme-switching')
      }) })
    }
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }

  if (persist) persistThemePreference(safePreference)
  if (typeof window !== 'undefined' && previousTheme && previousTheme !== theme) {
    window.dispatchEvent(new CustomEvent('sinergi:theme-change', { detail: { theme } }))
  }
  return theme
}

export function initializeTheme() {
  const preference = readThemePreference()
  applyTheme(preference)

  if (typeof window === 'undefined') return () => {}
  themeOwners++
  if (themeOwners === 1 && typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const change = () => { if (readThemePreference() === 'system') applyTheme('system') }
    if (typeof media.addEventListener === 'function') media.addEventListener('change', change)
    else media.addListener(change)
    detachSystemTheme = () => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', change)
      else media.removeListener(change)
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--themeOwners === 0) { detachSystemTheme?.(); detachSystemTheme = null; stopThemeTransition() }
  }
}

export function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme || applyTheme()
  return applyTheme(currentTheme === 'dark' ? 'light' : 'dark', { persist: true })
}
