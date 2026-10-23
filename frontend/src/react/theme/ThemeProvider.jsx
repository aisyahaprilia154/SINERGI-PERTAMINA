import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import { initializeTheme, toggleTheme } from '../../theme.js'
import { ThemeContext } from './theme-context.js'

const snapshot = () => document.documentElement.dataset.theme || 'light'
const subscribe = listener => {
  window.addEventListener('sinergi:theme-change', listener)
  return () => window.removeEventListener('sinergi:theme-change', listener)
}

export function ThemeProvider({ children }) {
  useLayoutEffect(() => initializeTheme(), [])
  const theme = useSyncExternalStore(subscribe, snapshot)
  const value = useMemo(() => ({ theme, toggleTheme }), [theme])
  return <ThemeContext value={value}>{children}</ThemeContext>
}
