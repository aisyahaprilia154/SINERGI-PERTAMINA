import { useLayoutEffect, useSyncExternalStore } from 'react'
import { initializeTheme, toggleTheme } from '../../theme.js'

const snapshot = () => document.documentElement.dataset.theme || 'light'
const subscribe = listener => {
  window.addEventListener('sinergi:theme-change', listener)
  return () => window.removeEventListener('sinergi:theme-change', listener)
}

export function useLoginTheme() {
  useLayoutEffect(() => initializeTheme(), [])
  const theme = useSyncExternalStore(subscribe, snapshot)
  return { theme, toggleTheme }
}
