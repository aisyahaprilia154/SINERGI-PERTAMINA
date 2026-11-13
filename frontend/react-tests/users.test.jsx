import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsersPage } from '../src/react/users/UsersPage.jsx'
import { UsersRoute } from '../src/react/users/UsersRoute.jsx'
import { SessionContext } from '../src/react/session/session-context.js'
import { ThemeProvider } from '../src/react/theme/ThemeProvider.jsx'
import { documentNavigation } from '../src/services/document-navigation.js'

const admin = { id: 'a', username: 'admin', role: 'Administrator', online: true, updatedAt: 'v1' }
// Request polling/review is covered separately from the existing user editor lifecycle.
vi.mock('../src/react/users/AccessRequestsPanel.jsx',()=>({AccessRequestsPanel:()=>null}))
const viewer = { id: 'v', username: 'viewer', email: 'viewer@example.test', role: 'Viewer', online: false, updatedAt: 'v2' }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
let state
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear()
  window.history.replaceState(null, '', '/admin/users')
  state = { users: [admin, viewer], listFailure: 0, writeFailure: 0, pendingWrite: null, calls: [] }
  vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {})
  vi.spyOn(documentNavigation, 'reload').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    state.calls.push({ url, ...options })
    if (url === '/api/auth/me' || url === '/api/auth/heartbeat') return Response.json({ user: state.sessionUser ?? admin })
    if (options.method === 'GET') return Response.json(state.listFailure ? { error: { message: 'Daftar gagal' } } : { users: state.users, serverTime: '2026-10-23T00:00:00Z' }, { status: state.listFailure || 200 })
    if (state.pendingWrite) return state.pendingWrite.promise
    return Response.json(state.writeFailure ? { error: { message: 'Data sudah berubah' } } : { user: viewer, sessionsRevoked: true }, { status: state.writeFailure || 200 })
  }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
function mount() {
  return render(<StrictMode><ThemeProvider><SessionContext value={{ user: admin, status: 'authenticated', signOut: () => {} }}><UsersPage /></SessionContext></ThemeProvider></StrictMode>)
}
async function ready() { const view = mount(); await screen.findByText('viewer@example.test'); return view }
async function editViewer() { await userEvent.click(within(screen.getByText('viewer@example.test').closest('tr')).getByRole('button', { name: 'Kelola' })) }
const writes = () => state.calls.filter(call => call.method !== 'GET' && call.url.startsWith('/api/admin/users'))

describe('React users', () => {
  it('renders users, online state, local search and role filter without extra requests', async () => {
    await ready()
    expect(screen.getByText('Online')).toHaveClass('is-online')
    expect(screen.getByText('Belum pernah masuk')).toBeVisible()
    const calls = state.calls.length
    await userEvent.type(screen.getByLabelText('Cari pengguna'), 'EXAMPLE.TEST')
    expect(screen.getAllByRole('button', { name: 'Kelola', exact: true })).toHaveLength(1)
    await userEvent.selectOptions(screen.getByLabelText('Filter peran'), 'Administrator')
    expect(screen.getByText('Tidak ada pengguna yang sesuai.')).toBeVisible()
    expect(state.calls).toHaveLength(calls)
    expect(document.title).toBe('Kelola pengguna — SINERGI')
  })

  it('shows loading, empty and API error, then retries without a false online indicator', async () => {
    const pending = deferred()
    fetch.mockImplementationOnce(() => pending.promise)
    const view = mount()
    await screen.findByText('viewer@example.test')
    expect(state.calls[0].signal.aborted).toBe(false)
    state.listFailure = 500
    await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Daftar gagal')
    expect(screen.getAllByText('Belum diperbarui')).toHaveLength(2)
    expect(screen.queryByText('Online')).not.toBeInTheDocument()
    state.listFailure = 0; state.users = []
    await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }))
    expect(await screen.findByText('Tidak ada pengguna yang sesuai.')).toBeVisible()
    await act(async () => pending.resolve(Response.json({ users: [admin], serverTime: 'old' })))
    expect(screen.queryByText('Online')).not.toBeInTheDocument()
    view.unmount()
  })

  it('creates once with the original payload and refreshes after success', async () => {
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Tambah pengguna', exact: true }))
    expect(screen.getByLabelText('Username')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new-user' } })
    fireEvent.change(screen.getByLabelText('Email (opsional)'), { target: { value: 'new@example.test' } })
    fireEvent.change(screen.getByLabelText('Password awal'), { target: { value: 'a-new-password-123' } })
    state.pendingWrite = deferred()
    const form = document.querySelector('[data-user-form]')
    fireEvent.submit(form); fireEvent.submit(form)
    expect(writes()).toHaveLength(1)
    expect(JSON.parse(writes()[0].body)).toEqual({ username: 'new-user', email: 'new@example.test', role: 'Viewer', password: 'a-new-password-123' })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeVisible()
    await act(async () => state.pendingWrite.resolve(Response.json({ user: viewer })))
    expect(await screen.findByRole('status')).toHaveTextContent('Data pengguna tersimpan.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tambah pengguna', exact: true })).toHaveFocus()
  })

  it('retains a conflicting edit and expectedUpdatedAt across polling and retry', async () => {
    await ready(); await editViewer()
    expect(screen.getByLabelText('Username')).toHaveAttribute('readonly')
    fireEvent.change(screen.getByLabelText('Email (opsional)'), { target: { value: 'draft@example.test' } })
    state.users = [admin, { ...viewer, updatedAt: 'v3' }]
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(state.calls.filter(call => call.method === 'GET')).toHaveLength(3))
    state.writeFailure = 409
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah berubah')
    expect(screen.getByLabelText('Email (opsional)')).toHaveValue('draft@example.test')
    expect(writes()[0].url).toBe('/api/admin/users/v')
    expect(JSON.parse(writes()[0].body)).toEqual({ username: 'viewer', email: 'draft@example.test', role: 'Viewer', expectedUpdatedAt: 'v2' })
    state.writeFailure = 0
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(JSON.parse(writes()[1].body).expectedUpdatedAt).toBe('v2')
  })

  it('preserves dirty draft on Escape and confirms discard before switching to password reset', async () => {
    await ready(); await editViewer()
    fireEvent.change(screen.getByLabelText('Email (opsional)'), { target: { value: 'draft@example.test' } })
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('heading', { name: 'Buang perubahan?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Lanjutkan mengedit' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByLabelText('Email (opsional)')).toHaveValue('draft@example.test')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    await userEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
    expect(screen.getByLabelText('Password baru')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Password baru'), { target: { value: 'another-password-123' } })
    await userEvent.click(screen.getByRole('button', { name: 'Ubah password' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(writes()[0].url).toBe('/api/admin/users/v/password')
    expect(JSON.parse(writes()[0].body)).toEqual({ password: 'another-password-123', expectedUpdatedAt: 'v2' })
    expect(screen.getByRole('status')).toHaveTextContent('Password diubah dan sesi pengguna diakhiri.')
  })

  it('keeps the last administrator role and still handles server rejection', async () => {
    await ready()
    await userEvent.click(within(screen.getByText('admin', { exact: true }).closest('tr')).getByRole('button'))
    expect(screen.getByLabelText('Peran', { exact: true })).toBeDisabled()
    expect(screen.getByText('Administrator terakhir harus tetap tersedia.')).toBeVisible()
    state.writeFailure = 409
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah berubah')
    expect(JSON.parse(writes()[0].body).role).toBe('Administrator')
  })

  it.each([401, 403])('clears local session and redirects when a list returns %s', async status => {
    sessionStorage.setItem('sinergiSessionToken', 'session')
    sessionStorage.setItem('sinergiSessionUser', JSON.stringify(admin))
    state.listFailure = status
    mount()
    await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledWith('/'))
    expect(sessionStorage.getItem('sinergiSessionToken')).toBeNull()
  })

  it('clears a revoked current session after resetting its password', async () => {
    sessionStorage.setItem('sinergiSessionToken', 'session')
    await ready()
    await userEvent.click(within(screen.getByText('admin', { exact: true }).closest('tr')).getByRole('button'))
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    fireEvent.change(screen.getByLabelText('Password baru'), { target: { value: 'another-password-123' } })
    state.pendingWrite = deferred()
    await userEvent.click(screen.getByRole('button', { name: 'Ubah password' }))
    await act(async () => state.pendingWrite.resolve(Response.json({ user: admin, sessionsRevoked: true })))
    expect(documentNavigation.replace).toHaveBeenCalledWith('/')
    expect(sessionStorage.getItem('sinergiSessionToken')).toBeNull()
    expect(screen.queryByText('Password diubah dan sesi pengguna diakhiri.')).not.toBeInTheDocument()
  })

  it.each([401, 403])('stops requests and clears the session after a write returns %s', async status => {
    sessionStorage.setItem('sinergiSessionToken', 'session')
    await ready(); await editViewer()
    state.writeFailure = status
    const readsBefore = state.calls.filter(call => call.method === 'GET').length
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))
    await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledWith('/'))
    expect(sessionStorage.getItem('sinergiSessionToken')).toBeNull()
    fireEvent(document, new Event('visibilitychange'))
    expect(state.calls.filter(call => call.method === 'GET')).toHaveLength(readsBefore)
  })

  it('polls only while visible and removes timers, listeners and pending writes on unmount', async () => {
    const view = await ready()
    // Keep React's Node setImmediate scheduler real; count browser-owned timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    // Remount under fake timers to count the actual interval owner in StrictMode.
    view.unmount()
    const active = mount()
    await act(async () => {})
    expect(vi.getTimerCount()).toBe(1)
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const count = state.calls.length
    await act(async () => vi.advanceTimersByTime(15_000))
    expect(state.calls).toHaveLength(count)
    visible.mockReturnValue('visible')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(state.calls).toHaveLength(count + 1)
    await act(async () => vi.advanceTimersByTime(15_000))
    expect(state.calls).toHaveLength(count + 2)
    fireEvent.click(screen.getByRole('button', { name: 'Tambah pengguna', exact: true }))
    state.pendingWrite = deferred()
    fireEvent.submit(document.querySelector('[data-user-form]'))
    const write = writes()[0]
    expect(write.signal.aborted).toBe(false)
    active.unmount()
    expect(write.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    const after = state.calls.length
    await act(async () => state.pendingWrite.resolve(Response.json({ user: admin, sessionsRevoked: true })))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(state.calls).toHaveLength(after)
    expect(documentNavigation.replace).not.toHaveBeenCalled()
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(false)
  })

  it('ignores delayed reads from the first StrictMode mount and after pagehide', async () => {
    const first = deferred(), second = deferred()
    fetch.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    mount()
    expect(screen.getByText('Memuat pengguna…')).toBeVisible()
    await act(async () => second.resolve(Response.json({ users: [viewer], serverTime: '2026-10-23T00:00:00Z' })))
    expect(screen.getByText('viewer@example.test')).toBeVisible()
    await act(async () => first.resolve(Response.json({ users: [admin], serverTime: 'old' })))
    expect(screen.queryByText('Online')).not.toBeInTheDocument()
    const delayed = deferred()
    fetch.mockImplementationOnce(() => delayed.promise)
    await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }))
    const last = fetch.mock.calls.at(-1)[1]
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(last.signal.aborted).toBe(true)
    await act(async () => delayed.resolve(Response.json({ error: { message: 'Old forbidden response' } }, { status: 403 })))
    expect(documentNavigation.replace).not.toHaveBeenCalled()
  })

  it('checks Viewer access before mounting the users page or requesting users', async () => {
    sessionStorage.setItem('sinergiSessionToken', 'viewer-session')
    state.sessionUser = viewer
    render(<StrictMode><UsersRoute /></StrictMode>)
    await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledWith('/map'))
    expect(state.calls.filter(call => call.url === '/api/admin/users')).toHaveLength(0)
  })
})
