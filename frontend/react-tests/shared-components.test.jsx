import { StrictMode, useRef, useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from '../src/react/components/AppHeader.jsx'
import { AdminLayout } from '../src/react/components/AdminLayout.jsx'
import { ThemeToggle } from '../src/react/components/ThemeToggle.jsx'
import { ThemeProvider } from '../src/react/theme/ThemeProvider.jsx'
import { SessionContext } from '../src/react/session/session-context.js'
import { Dialog } from '../src/react/components/Dialog.jsx'
import { Drawer } from '../src/react/components/Drawer.jsx'
import { DataTable } from '../src/react/components/DataTable.jsx'
import { WorkspaceControls } from '../src/react/components/WorkspaceControls.jsx'
import { bindThemeToggle } from '../src/theme.js'

const admin = { id: 'a', name: 'Administrator', role: 'Administrator' }
const viewer = { id: 'v', name: 'Viewer', role: 'Viewer' }
const context = { datasetId: 'shared', area: 'Site A', draftVersionId: 'draft/1' }
function Providers({ children, user = admin, signOut = () => {} }) {
  return <ThemeProvider><SessionContext value={{ user, status: 'authenticated', signOut }}>{children}</SessionContext></ThemeProvider>
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); document.documentElement.dataset.theme = 'light' })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('shared navigation and layout', () => {
  it('preserves dataset, area, draft and active navigation for each role', () => {
    const view = render(<Providers><AppHeader active="users" context={context} /></Providers>)
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Diagram Topologi' })).toHaveAttribute('href', '/topology?datasetId=shared&area=Site+A&draftVersionId=draft%2F1')
    expect(document.querySelector('[aria-current=page]')).toHaveTextContent('Kelola pengguna')
    expect(document.querySelectorAll('.user-menu-dropdown a')).toHaveLength(3)
    view.rerender(<Providers user={viewer}><AppHeader active="map" context={context} /></Providers>)
    expect(document.querySelectorAll('.user-menu-dropdown a')).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Peta Aset', exact: true })).toHaveAttribute('aria-current', 'page')
  })

  it('supports menu keyboard navigation, Escape, outside pointer and single logout', async () => {
    const signOut = vi.fn()
    render(<StrictMode><Providers signOut={signOut}><AppHeader /></Providers></StrictMode>)
    const trigger = screen.getByRole('button', { name: 'Menu akun Administrator' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Kelola pengguna' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Keluar' })).toHaveFocus()
    await userEvent.keyboard('{Home}{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Keluar' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Keluar' }))
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('escapes account identity and restores body metadata when admin layout unmounts', () => {
    const title = document.title, bodyClass = document.body.className
    const view = render(<Providers user={{ ...admin, name: '<img src=x>' }}><AdminLayout active="versions" title="Versi database — SINERGI" context={context}><h1>Versi database</h1></AdminLayout></Providers>)
    expect(document.title).toBe('Versi database — SINERGI')
    expect(document.body).toHaveClass('admin-body')
    expect(document.querySelector('.user-menu-identity img')).toBeNull()
    expect(document.querySelector('[data-admin-content] h1')).toHaveTextContent('Versi database')
    view.unmount()
    expect(document.title).toBe(title)
    expect(document.body.className).toBe(bodyClass)
  })
})

describe('shared theme', () => {
  it('toggles once even when a legacy delegated binder exists', async () => {
    bindThemeToggle()
    render(<Providers><ThemeToggle /><ThemeToggle variant="login" /></Providers>)
    await userEvent.click(screen.getAllByRole('button', { name: 'Aktifkan mode gelap' })[0])
    expect(localStorage.getItem('sinergi.theme')).toBe('dark')
    expect(screen.getAllByRole('button', { name: 'Aktifkan mode terang' })).toHaveLength(2)
    await userEvent.click(screen.getAllByRole('button', { name: 'Aktifkan mode terang' })[1])
    expect(localStorage.getItem('sinergi.theme')).toBe('light')
  })

  it('shares the system listener between providers until the last owner releases', () => {
    const media = new EventTarget()
    media.matches = false
    const add = vi.spyOn(media, 'addEventListener'), remove = vi.spyOn(media, 'removeEventListener')
    vi.stubGlobal('matchMedia', () => media)
    const view = render(<ThemeProvider><ThemeToggle /><ThemeProvider><ThemeToggle /></ThemeProvider></ThemeProvider>)
    expect(add).toHaveBeenCalledOnce()
    view.rerender(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    expect(remove).not.toHaveBeenCalled()
    view.unmount()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('cancels animation frames when the theme owner unmounts', () => {
    vi.useFakeTimers()
    const view = render(<Providers><ThemeToggle /></Providers>)
    fireEvent.click(screen.getByRole('button', { name: 'Aktifkan mode gelap' }))
    expect(document.documentElement).toHaveClass('theme-switching')
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(document.documentElement).not.toHaveClass('theme-switching')
  })
})

function OverlayLab({ drawer = false, initialBusy = false }) {
  const [open, setOpen] = useState(false), [nested, setNested] = useState(false), [busy, setBusy] = useState(initialBusy)
  const field = useRef(null)
  const Component = drawer ? Drawer : Dialog
  return <>
    <button onClick={() => setOpen(true)}>Buka</button>
    <Component open={open} title="Editor" busy={busy} onClose={() => setOpen(false)} initialFocusRef={field}
      footer={<button onClick={() => setOpen(false)}>Simpan</button>}>
      <label>Nama<input ref={field} defaultValue="Draft" /></label>
      <button onClick={() => setBusy(value => !value)}>{busy ? 'Selesai' : 'Mulai proses'}</button>
      <button onClick={() => setNested(true)}>Konfirmasi</button>
      <Dialog open={nested} title="Konfirmasi" onClose={() => setNested(false)}><p>Periksa kembali.</p></Dialog>
    </Component>
  </>
}

describe('overlay lifecycle', () => {
  it.each([false, true])('traps focus, preserves draft across renders, blocks busy Escape and restores focus (drawer=%s)', async drawer => {
    const overflow = document.body.style.overflow
    const view = render(<StrictMode><OverlayLab drawer={drawer} /></StrictMode>)
    const opener = screen.getByRole('button', { name: 'Buka' })
    await userEvent.click(opener)
    expect(screen.getByLabelText('Nama')).toHaveFocus()
    expect(view.container).toHaveAttribute('inert')
    fireEvent.change(screen.getByLabelText('Nama'), { target: { value: 'Draft terbaru' } })
    screen.getByRole('button', { name: 'Simpan' }).focus()
    await userEvent.keyboard('{Tab}')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: drawer ? 'Tutup panel' : 'Tutup dialog' })).toHaveFocus()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(screen.getByRole('button', { name: 'Simpan' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Mulai proses' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByLabelText('Nama')).toHaveValue('Draft terbaru')
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(view.container).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe(overflow)
  })

  it('closes only the top nested overlay and restores its parent focus', async () => {
    render(<OverlayLab drawer />)
    await userEvent.click(screen.getByRole('button', { name: 'Buka' }))
    const parent = screen.getByRole('dialog'), nestedOpener = screen.getByRole('button', { name: 'Konfirmasi' })
    await userEvent.click(nestedOpener)
    const nested = screen.getByRole('dialog', { name: 'Konfirmasi' })
    expect(parent.closest('[data-react-overlay]')).toHaveAttribute('inert')
    expect(Number(nested.parentElement.style.zIndex)).toBeGreaterThan(Number(parent.parentElement.style.zIndex))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Konfirmasi' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Editor' })).toBeVisible()
    expect(nestedOpener).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Buka' })).toHaveFocus()
  })

  it('restores existing inert and scroll state when unmounted while open', async () => {
    const existing = document.createElement('div')
    existing.inert = true; existing.setAttribute('inert', '')
    document.body.append(existing)
    document.body.style.overflow = 'clip'
    const view = render(<OverlayLab />)
    await userEvent.click(screen.getByRole('button', { name: 'Buka' }))
    view.unmount()
    expect(existing).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('clip')
    expect(document.querySelector('[data-react-overlay]')).toBeNull()
    existing.remove(); document.body.style.overflow = ''
  })
})

describe('table and workspace controls', () => {
  it('renders loading, empty, escaped values and retry without losing existing rows', async () => {
    const columns = [{ key: 'name', header: 'Nama' }], retry = vi.fn()
    const view = render(<DataTable columns={columns} rows={[]} loading />)
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('cell')).toHaveTextContent('Memuat data')
    view.rerender(<DataTable columns={columns} rows={[]} />)
    expect(screen.getByRole('cell')).toHaveTextContent('Tidak ada data')
    view.rerender(<DataTable columns={columns} rows={[{ id: '1', name: '<img src=x>' }]} error="Koneksi terputus" onRetry={retry} />)
    expect(screen.getByRole('cell')).toHaveTextContent('<img src=x>')
    expect(document.querySelector('table img')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('preserves row input state when rows reorder', () => {
    const columns = [{ key: 'name', header: 'Nama', render: row => <input aria-label={row.id} defaultValue={row.name} /> }]
    const rows = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    const view = render(<DataTable columns={columns} rows={rows} />)
    fireEvent.change(screen.getByLabelText('a'), { target: { value: 'Draft A' } })
    view.rerender(<DataTable columns={columns} rows={[...rows].reverse()} />)
    expect(screen.getByLabelText('a')).toHaveValue('Draft A')
  })

  it('delegates zoom/fit actions once and respects disabled state', async () => {
    const onZoomIn = vi.fn(), onFit = vi.fn()
    const view = render(<WorkspaceControls zoom={1.25} onZoomIn={onZoomIn} onFit={onFit} />)
    expect(screen.getByRole('button', { name: 'Kembalikan zoom ke 100%' })).toHaveTextContent('125%')
    await userEvent.click(screen.getByRole('button', { name: 'Perbesar diagram' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan seluruh diagram' }))
    expect(onZoomIn).toHaveBeenCalledOnce(); expect(onFit).toHaveBeenCalledOnce()
    view.rerender(<WorkspaceControls disabled onZoomIn={onZoomIn} onFit={onFit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Perbesar diagram' }))
    expect(onZoomIn).toHaveBeenCalledOnce()
  })
})
