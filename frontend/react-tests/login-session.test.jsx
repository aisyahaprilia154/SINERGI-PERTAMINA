import { StrictMode, useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginRoute } from '../src/react/login/LoginRoute.jsx'
import { SessionProvider } from '../src/react/session/SessionProvider.jsx'
import { SessionGate } from '../src/react/session/SessionGate.jsx'
import { useSession } from '../src/react/session/session-context.js'
import { getSessionToken, getSessionUser, login, loadCurrentUser, saveSession } from '../src/services/account-session.js'
import { startSessionPresence } from '../src/services/session-presence.js'
import { documentNavigation } from '../src/services/document-navigation.js'
import { pageRedirect } from '../src/domain/page-access.js'

const admin = { id: 'a', username: 'admin', role: 'Administrator' }
const viewer = { id: 'v', username: 'viewer', role: 'Viewer' }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.spyOn(documentNavigation, 'assign').mockImplementation(() => {})
  vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {})
  vi.spyOn(documentNavigation, 'reload').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function SessionProbe() {
  const { status, user, signOut } = useSession()
  return <><p>{status}:{user?.username}</p><button onClick={() => void signOut()}>Logout</button></>
}

describe('React login', () => {
  it('keeps inputs, password visibility, theme and required validation', async () => {
    render(<StrictMode><LoginRoute /></StrictMode>)
    expect(document.body).toHaveClass('login-body')
    expect(screen.getByLabelText('Email atau username')).toBeRequired()
    expect(screen.getByLabelText('Kata sandi')).toHaveAttribute('autocomplete', 'current-password')
    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan kata sandi' }))
    expect(screen.getByLabelText('Kata sandi')).toHaveAttribute('type', 'text')
    await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan kata sandi' }))
    expect(screen.getByLabelText('Kata sandi')).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Aktifkan mode gelap' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem('sinergi.theme')).toBe('dark')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk', exact: true }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains draft and focus after an error, then logs in with one document redirect', async () => {
    fetch.mockResolvedValueOnce(Response.json({ error: { message: 'Akun tidak cocok' } }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ token: 'signed-in', user: viewer }))
    render(<StrictMode><LoginRoute /></StrictMode>)
    await userEvent.type(screen.getByLabelText('Email atau username'), '  viewer  ')
    await userEvent.type(screen.getByLabelText('Kata sandi'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk', exact: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Akun tidak cocok')
    expect(screen.getByLabelText('Kata sandi')).toHaveFocus()
    expect(screen.getByLabelText('Email atau username')).toHaveValue('  viewer  ')
    expect(screen.getByLabelText('Kata sandi')).toHaveValue('secret')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk', exact: true }))
    await waitFor(() => expect(documentNavigation.assign).toHaveBeenCalledExactlyOnceWith('/map'))
    expect(documentNavigation.replace).not.toHaveBeenCalled()
    expect(getSessionToken()).toBe('signed-in')
    expect(getSessionUser()).toEqual(viewer)
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ identifier: 'viewer', password: 'secret' })
  })

  it('prevents duplicate submissions while a request is pending', async () => {
    const pending = deferred()
    fetch.mockReturnValue(pending.promise)
    render(<LoginRoute />)
    fireEvent.change(screen.getByLabelText('Email atau username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'secret' } })
    const form = document.querySelector('#login-form')
    fireEvent.submit(form); fireEvent.submit(form)
    expect(fetch).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Memeriksa…' })).toBeDisabled()
    await act(async () => pending.resolve(Response.json({ error: { message: 'Offline' } }, { status: 503 })))
    expect(screen.getByRole('button', { name: 'Masuk', exact: true })).toBeEnabled()
  })

  it('aborts login on unmount and ignores a late response even if fetch ignores abort', async () => {
    const pending = deferred()
    fetch.mockReturnValue(pending.promise)
    const view = render(<LoginRoute />)
    fireEvent.change(screen.getByLabelText('Email atau username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'secret' } })
    fireEvent.submit(document.querySelector('#login-form'))
    const signal = fetch.mock.calls[0][1].signal
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(Response.json({ token: 'too-late', user: admin })))
    expect(getSessionToken()).toBe('')
    expect(documentNavigation.assign).not.toHaveBeenCalled()
  })
})

describe('session lifecycle and access', () => {
  it('cancels a suspended login and rechecks cached documents on bfcache restore', async () => {
    const pending = deferred()
    fetch.mockReturnValue(pending.promise)
    const view = render(<StrictMode><LoginRoute /></StrictMode>)
    fireEvent.change(screen.getByLabelText('Email atau username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'secret' } })
    fireEvent.submit(document.querySelector('#login-form'))
    const signal = fetch.mock.calls[0][1].signal
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(Response.json({ token: 'cached-late', user: admin })))
    expect(getSessionToken()).toBe('')
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    expect(documentNavigation.reload).not.toHaveBeenCalled()
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(documentNavigation.reload).toHaveBeenCalledOnce()
    view.unmount()
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(documentNavigation.reload).toHaveBeenCalledOnce()
  })

  it('tracks system theme and releases its media listener through StrictMode cleanup', async () => {
    const media = new EventTarget()
    media.matches = false
    const add = vi.spyOn(media, 'addEventListener'), remove = vi.spyOn(media, 'removeEventListener')
    vi.stubGlobal('matchMedia', () => media)
    const view = render(<StrictMode><LoginRoute /></StrictMode>)
    expect(add).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledTimes(1)
    await act(async () => { media.matches = true; media.dispatchEvent(new Event('change')) })
    expect(screen.getByRole('button', { name: 'Aktifkan mode terang' })).toHaveAttribute('aria-pressed', 'true')
    view.unmount()
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('validates an existing session and redirects from login without starting heartbeat', async () => {
    saveSession({ token: 'existing', user: viewer })
    fetch.mockResolvedValue(Response.json({ user: admin }))
    render(<LoginRoute />)
    expect(screen.getByRole('status')).toHaveTextContent('Memuat halaman')
    await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledExactlyOnceWith('/map'))
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/auth/me', expect.objectContaining({ headers: { Authorization: 'Bearer existing' } }))
    expect(getSessionUser()).toEqual(admin)
    expect(screen.queryByRole('heading', { name: 'Masuk ke SINERGI' })).not.toBeInTheDocument()
  })

  it('clears an expired session and displays login', async () => {
    saveSession({ token: 'expired', user: admin })
    fetch.mockResolvedValue(Response.json({}, { status: 401 }))
    render(<LoginRoute />)
    expect(await screen.findByRole('heading', { name: 'Masuk ke SINERGI' })).toBeVisible()
    expect(getSessionToken()).toBe('')
    expect(getSessionUser()).toBeNull()
  })

  it.each([200, 401])('ignores a late /me response (%s) after logout changes the stored session', async status => {
    saveSession({ token: 'old', user: admin })
    const pending = deferred()
    fetch.mockReturnValue(pending.promise)
    const request = loadCurrentUser()
    sessionStorage.clear()
    pending.resolve(Response.json({ user: admin }, { status }))
    await expect(request).rejects.toHaveProperty('name', 'AbortError')
    expect(getSessionUser()).toBeNull()
  })

  it('does not save a service login result after cancellation', async () => {
    const pending = deferred(), controller = new AbortController()
    fetch.mockReturnValue(pending.promise)
    const request = login('admin', 'secret', { signal: controller.signal })
    controller.abort(); pending.resolve(Response.json({ token: 'late', user: admin }))
    await expect(request).rejects.toHaveProperty('name', 'AbortError')
    expect(getSessionToken()).toBe('')
  })

  it('uses the same role and fallback policy for React and legacy pages', () => {
    for (const path of ['/map', '/map/', '/peta', '/topology', '/topologi']) {
      expect(pageRedirect(path, null)).toBe('/')
      expect(pageRedirect(path, viewer)).toBeNull()
    }
    for (const path of ['/admin/users', '/admin/datasets/versions', '/admin/datasets/import', '/admin/datasets/import/x/preview']) {
      expect(pageRedirect(path, null)).toBe('/')
      expect(pageRedirect(path, viewer)).toBe('/map')
      expect(pageRedirect(path, admin)).toBeNull()
    }
    expect(pageRedirect('/unknown?not-a-real-path', null)).toBeNull()
    expect(pageRedirect('/unknown', viewer)).toBe('/map')
  })

  it('guards a React administrator page before rendering protected content', async () => {
    saveSession({ token: 'viewer', user: viewer })
    fetch.mockResolvedValue(Response.json({ user: viewer }))
    render(<SessionProvider presence={false}><SessionGate pathname="/admin/users"><p>Protected content</p></SessionGate></SessionProvider>)
    await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledExactlyOnceWith('/map'))
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('blocks anonymous React protected content and allows a validated Administrator', async () => {
    const view = render(<SessionProvider presence={false}><SessionGate pathname="/map"><p>Protected content</p></SessionGate></SessionProvider>)
    expect(documentNavigation.replace).toHaveBeenCalledWith('/')
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    view.unmount()
    saveSession({ token: 'admin', user: admin })
    fetch.mockResolvedValue(Response.json({ user: admin }))
    render(<SessionProvider presence={false}><SessionGate pathname="/admin/users"><p>Protected content</p></SessionGate></SessionProvider>)
    expect(await screen.findByText('Protected content')).toBeVisible()
  })

  it('shares one heartbeat between owners and aborts only when the final owner releases', async () => {
    vi.useFakeTimers()
    saveSession({ token: 'session', user: viewer })
    const pending = deferred()
    fetch.mockReturnValue(pending.promise)
    const releaseA = startSessionPresence(), releaseB = startSessionPresence()
    expect(fetch).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    const signal = fetch.mock.calls[0][1].signal
    releaseA(); expect(signal.aborted).toBe(false)
    releaseB(); expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    pending.resolve(Response.json({ user: admin }))
    await act(async () => {})
    expect(getSessionUser()).toEqual(viewer)
    expect(documentNavigation.reload).not.toHaveBeenCalled()
  })

  it('cleans a StrictMode provider heartbeat and signs out using the original token', async () => {
    saveSession({ token: 'live', user: admin })
    fetch.mockImplementation(async url => Response.json(url === '/api/auth/logout' ? {} : { user: admin }))
    const view = render(<StrictMode><SessionProvider><SessionProbe /></SessionProvider></StrictMode>)
    expect(await screen.findByText('authenticated:admin')).toBeVisible()
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/api/auth/heartbeat')).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }))
    await waitFor(() => expect(documentNavigation.assign).toHaveBeenCalledExactlyOnceWith('/'))
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ headers: { Authorization: 'Bearer live' } }))
    expect(getSessionToken()).toBe('')
    const calls = fetch.mock.calls.length
    view.unmount()
    window.dispatchEvent(new Event('online'))
    await act(async () => {})
    expect(fetch).toHaveBeenCalledTimes(calls)
  })

  it('waits for logout acknowledgement before navigating and deduplicates logout actions', async () => {
    saveSession({ token: 'live', user: admin })
    const pending = deferred(), actions = {}
    fetch.mockImplementation(url => url === '/api/auth/logout' ? pending.promise : Promise.resolve(Response.json({ user: admin })))
    function ProtectedPage() {
      const { signOut } = useSession()
      useEffect(() => { actions.signOut = signOut }, [signOut])
      return <p>Protected page</p>
    }
    render(<SessionProvider presence={false}><SessionGate pathname="/map"><ProtectedPage /></SessionGate></SessionProvider>)
    await screen.findByText('Protected page')
    act(() => { expect(actions.signOut()).toBe(actions.signOut()) })
    expect(screen.getByRole('status')).toHaveTextContent('Memuat halaman')
    expect(getSessionToken()).toBe('')
    expect(documentNavigation.replace).not.toHaveBeenCalled()
    expect(documentNavigation.assign).not.toHaveBeenCalled()
    expect(fetch.mock.calls.filter(([url]) => url === '/api/auth/logout')).toHaveLength(1)
    await act(async () => pending.resolve(Response.json({})))
    expect(documentNavigation.assign).toHaveBeenCalledExactlyOnceWith('/')
  })
})
