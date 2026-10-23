import { useTheme } from '../theme/theme-context.js'

export function ThemeToggle({ variant = 'header' }) {
  const { theme, toggleTheme } = useTheme()
  const dark = theme === 'dark'
  return (
    <button className={variant === 'login' ? 'login-theme-toggle' : 'icon-button theme-toggle'} type="button"
      data-theme-toggle data-react-theme-control aria-label={dark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
      title={dark ? 'Mode terang' : 'Mode gelap'} aria-pressed={dark} onClick={toggleTheme}>
      {variant === 'login' ? <>
        <svg className="login-icon login-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" /></svg>
        <svg className="login-icon login-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
      </> : <span className="material-symbols-outlined" data-theme-icon aria-hidden="true">{dark ? 'light_mode' : 'dark_mode'}</span>}
    </button>
  )
}
