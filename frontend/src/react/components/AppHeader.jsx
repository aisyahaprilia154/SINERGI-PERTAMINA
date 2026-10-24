import { useId, useLayoutEffect, useRef, useState } from 'react'
import { isAdministrator } from '../../services/account-session.js'
import { useSession } from '../session/session-context.js'
import { BrandLogo } from './BrandLogo.jsx'
import { Icon } from './Icon.jsx'
import { ThemeToggle } from './ThemeToggle.jsx'

const adminLinks = [
  ['users', '/admin/users', 'manage_accounts', 'Kelola pengguna'],
  ['imports', '/admin/datasets/import', 'history', 'Riwayat import'],
  ['versions', '/admin/datasets/versions', 'restore', 'Versi database'],
]

export function AppHeader({ active = 'map', context = null }) {
  const { user, status, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const root = useRef(null), trigger = useRef(null), menu = useRef(null), focusOnOpen = useRef(null)
  const menuId = useId()
  const params = context?.datasetId ? new URLSearchParams({ datasetId: context.datasetId }) : null
  if (params && context.area) params.set('area', context.area)
  if (params && context.draftVersionId) params.set('draftVersionId', context.draftVersionId)
  const query = params ? `?${params}` : ''
  const mapParams = params ? new URLSearchParams(params) : null
  if (mapParams && context.selectedAssetId) mapParams.set('selectedAssetId', context.selectedAssetId)
  const mapQuery = mapParams ? `?${mapParams}` : ''
  const name = user?.name || 'Pengguna'

  useLayoutEffect(() => {
    if (!open) return
    const fields = () => [...menu.current.querySelectorAll('[role=menuitem]:not(:disabled)')]
    if (focusOnOpen.current) {
      const items = fields()
      ;(focusOnOpen.current === 'last' ? items.at(-1) : items[0])?.focus()
      focusOnOpen.current = null
    }
    const outside = event => { if (!root.current.contains(event.target)) setOpen(false) }
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current.focus(); return }
      if (event.key === 'Tab') { setOpen(false); return }
      if (!root.current.contains(document.activeElement)) return
      const items = fields(), index = items.indexOf(document.activeElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard) }
  }, [open])

  return (
    <header data-app-header className={`top-navigation app-header${active === 'topology' ? ' topology-top-navigation' : ''}`}>
      <a className="brand-lockup nav-brand" href={`/map${mapQuery}`} aria-label="SINERGI — Peta Aset"><BrandLogo /></a>
      <nav aria-label="Navigasi utama" style={{ '--app-nav-count': 2 }}>
        {[['map', '/map', 'map', 'Peta Aset', 'Peta'], ['topology', '/topology', 'account_tree', 'Diagram Topologi', 'Diagram']].map(([view, path, icon, label, short]) =>
          <a key={view} href={`${path}${view === 'map' ? mapQuery : query}`} aria-label={label} aria-current={active === view ? 'page' : undefined} className={active === view ? 'active' : ''}>
            <Icon>{icon}</Icon><span className="nav-label">{label}</span><span className="nav-label-short">{short}</span>
          </a>)}
      </nav>
      <div className="nav-actions">
        <ThemeToggle />
        <div ref={root} className={`user-account-menu${open ? ' is-open' : ''}`} data-user-account-menu>
          <button ref={trigger} className="user-menu" data-user-account-trigger type="button" aria-label={`Menu akun ${name}`}
            aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}
            onKeyDown={event => { if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); focusOnOpen.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true) } }}>
            <span className="user-menu-avatar" aria-hidden="true">{String(user?.name || 'SI').slice(0, 2).toUpperCase()}</span>
            <span className="user-menu-identity"><strong>{name}</strong><small>{user?.role === 'Administrator' ? 'Administrator' : 'Pengguna'}</small></span>
            <Icon className="user-menu-chevron">expand_more</Icon>
          </button>
          <div ref={menu} className="user-menu-dropdown" data-user-account-dropdown id={menuId} role="menu" aria-label="Menu akun" hidden={!open}>
            {isAdministrator(user) && <><div className="user-menu-dropdown-items">
              {adminLinks.map(([view, path, icon, label]) => <a key={view} className="user-menu-dropdown-item" href={`${path}${query}`} role="menuitem" tabIndex={-1} aria-current={active === view ? 'page' : undefined}><Icon>{icon}</Icon><span>{label}</span></a>)}
            </div><div className="user-menu-dropdown-divider" role="separator" /></>}
            <div className="user-menu-dropdown-items user-menu-dropdown-items-last">
              <button className="user-menu-dropdown-item" data-user-account-logout type="button" role="menuitem" tabIndex={-1} disabled={status === 'signing-out'} onClick={() => { setOpen(false); void signOut() }}><Icon>logout</Icon><span>Keluar</span></button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
