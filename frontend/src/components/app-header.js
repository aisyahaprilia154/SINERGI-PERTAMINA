import {patraNiagaLogoMarkup} from '../pages/brand-logo.js'
import {bindThemeToggle} from '../theme.js'
import {getSessionUser,isAdministrator,logout} from '../services/account-session.js'

let userAccountMenuInteractionsBound = false

export function bindUserAccountMenu() {
  if (typeof document === 'undefined') return
  bindThemeToggle()
  const account = getSessionUser()
  document.querySelectorAll('[data-user-account-menu]').forEach((menu) => {
    menu.querySelector('.user-menu-identity strong').textContent = account?.name || 'Pengguna'
    menu.querySelector('.user-menu-identity small').textContent =
      account?.role === 'Administrator' ? 'Administrator' : 'Pengguna'
    menu.querySelector('.user-menu-avatar').textContent =
      String(account?.name || 'SI').slice(0, 2).toUpperCase()
    menu.querySelector('[data-user-account-trigger]').setAttribute('aria-label',
      `Menu akun ${account?.name || 'Pengguna'}`)
  })
  if (userAccountMenuInteractionsBound) return
  userAccountMenuInteractionsBound = true

  document.addEventListener('click', (event) => {
    const target = event.target
    const trigger = target?.closest?.('[data-user-account-trigger]')
    if (trigger) {
      const menu = trigger.closest('[data-user-account-menu]')
      if (!menu) return

      const wasOpen = trigger.getAttribute('aria-expanded') === 'true'
      closeUserAccountMenus()
      if (!wasOpen) openUserAccountMenu(menu)
      return
    }

    if (target?.closest?.('[data-user-account-logout]')) {
      closeUserAccountMenus()
      void logout().finally(() => window.location.assign('/'))
      return
    }

    if (!target?.closest?.('[data-user-account-menu]')) closeUserAccountMenus()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    const openMenu = document.querySelector('[data-user-account-menu].is-open')
    if (!openMenu) return

    event.preventDefault()
    closeUserAccountMenus()
    openMenu.querySelector('[data-user-account-trigger]')?.focus()
  })
}

function openUserAccountMenu(menu) {
  const trigger = menu.querySelector('[data-user-account-trigger]')
  const dropdown = menu.querySelector('[data-user-account-dropdown]')
  if (!trigger || !dropdown) return

  menu.classList.add('is-open')
  trigger.setAttribute('aria-expanded', 'true')
  dropdown.hidden = false
}

function closeUserAccountMenus() {
  document.querySelectorAll('[data-user-account-menu].is-open').forEach((menu) => {
    menu.classList.remove('is-open')
    menu.querySelector('[data-user-account-trigger]')?.setAttribute('aria-expanded', 'false')
    const dropdown = menu.querySelector('[data-user-account-dropdown]')
    if (dropdown) dropdown.hidden = true
  })
}

export function renderTopNavigation(activeView = 'map', context = null) {
  const topologyNavigation = activeView === 'topology'
  const contextParams = context?.datasetId
    ? new URLSearchParams({
      datasetId: context.datasetId,
    })
    : null
  if (contextParams && context.area) contextParams.set('area', context.area)
  if (contextParams && context.draftVersionId) {
    contextParams.set('draftVersionId', context.draftVersionId)
  }
  const contextQuery = contextParams ? `?${contextParams}` : ''
  return `
    <header data-app-header class="top-navigation app-header${topologyNavigation ? ' topology-top-navigation' : ''}">
      <a class="brand-lockup nav-brand" href="/map${contextQuery}" aria-label="SINERGI — Peta Aset">
        ${patraNiagaLogoMarkup()}
      </a>
      <nav aria-label="Navigasi utama" style="--app-nav-count:${isAdministrator()?3:2}">
        <a href="/map${contextQuery}" aria-label="Peta Aset" ${activeView==='map'?'aria-current="page"':''} class="${activeView === 'map' ? 'active' : ''}">
          <span class="material-symbols-outlined" aria-hidden="true">map</span><span class="nav-label">Peta Aset</span><span class="nav-label-short">Peta</span>
        </a>
        <a href="/topology${contextQuery}" aria-label="Diagram Topologi" ${activeView==='topology'?'aria-current="page"':''} class="${activeView === 'topology' ? 'active' : ''}">
          <span class="material-symbols-outlined" aria-hidden="true">account_tree</span><span class="nav-label">Diagram Topologi</span><span class="nav-label-short">Diagram</span>
        </a>
        ${isAdministrator()?`<a href="/admin/users" ${activeView==='admin'?'class="active" aria-current="page"':''}><span class="material-symbols-outlined" aria-hidden="true">manage_accounts</span><span class="nav-label">Admin</span><span class="nav-label-short">Admin</span></a>`:''}
      </nav>
      <div class="nav-actions">
        <button class="icon-button theme-toggle" type="button" data-theme-toggle
          aria-label="Aktifkan mode gelap" aria-pressed="false" title="Mode gelap">
          <span class="material-symbols-outlined" data-theme-icon aria-hidden="true">dark_mode</span>
        </button>
        <div class="user-account-menu" data-user-account-menu>
          <button class="user-menu" data-user-account-trigger type="button"
            aria-label="Menu akun" aria-haspopup="menu" aria-expanded="false"
            aria-controls="user-account-dropdown">
            <span class="user-menu-avatar" aria-hidden="true">SI</span>
            <span class="user-menu-identity"><strong>Pengguna</strong><small>Pengguna</small></span>
            <span class="material-symbols-outlined user-menu-chevron" aria-hidden="true">expand_more</span>
          </button>
          <div class="user-menu-dropdown" data-user-account-dropdown id="user-account-dropdown"
            role="menu" aria-label="Menu akun" hidden>
            <div class="user-menu-dropdown-items user-menu-dropdown-items-last">
              <button class="user-menu-dropdown-item" data-user-account-logout
                type="button" role="menuitem">
                <span class="material-symbols-outlined" aria-hidden="true">logout</span>
                <span>Keluar</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  `
}
