import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy, useEffect, useState } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountReactApp } from '../src/react/bootstrap.jsx'
import { createAppRouter } from '../src/react/router.jsx'
import { AppErrorBoundary } from '../src/react/components/AppErrorBoundary.jsx'

let mounted
const routers = []
afterEach(() => {
  if (mounted) act(() => mounted.dispose())
  mounted = null
  routers.splice(0).forEach(router => router.dispose())
  vi.useRealTimers()
})

function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(value => value + 1)}>Hitungan {count}</button>
}

function renderRoute(route) {
  const router = createAppRouter([{ path: '/', ...route }], createMemoryRouter)
  routers.push(router)
  render(<RouterProvider router={router} />)
  return router
}

describe('React foundation', () => {
  it('renders JSX through the router and handles user interaction', async () => {
    renderRoute({ element: <Counter /> })
    await userEvent.click(screen.getByRole('button', { name: 'Hitungan 0' }))
    expect(screen.getByRole('button', { name: 'Hitungan 1' })).toBeVisible()
  })

  it('shows loading until the initial route loader resolves', async () => {
    let release
    const pending = new Promise(resolve => { release = resolve })
    renderRoute({ loader: () => pending, element: <Counter /> })
    expect(screen.getByRole('status')).toHaveTextContent('Memuat halaman')
    await act(async () => release(null))
    expect(await screen.findByRole('button')).toHaveTextContent('Hitungan 0')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('provides a Suspense fallback for a lazy component', async () => {
    let release
    const LazyPage = lazy(() => new Promise(resolve => { release = resolve }))
    renderRoute({ element: <LazyPage /> })
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    await act(async () => release({ default: Counter }))
    expect(await screen.findByRole('button')).toHaveTextContent('Hitungan 0')
  })

  it('contains route loader failure and offers a full-document retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderRoute({ loader: () => { throw new Error('Private backend detail') }, element: <Counter /> })
    expect(await screen.findByRole('alert')).toHaveTextContent('Halaman tidak dapat dimuat')
    expect(screen.getByRole('link', { name: 'Muat ulang' })).toHaveAttribute('href', window.location.href)
    expect(screen.queryByText('Private backend detail')).not.toBeInTheDocument()
  })

  it('contains a component render failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken() { throw new Error('Render failure') }
    render(<AppErrorBoundary><Broken /></AppErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Halaman tidak dapat dimuat')
  })

  it('rejects a missing container before creating a root', () => {
    expect(() => mountReactApp(null)).toThrow('Container aplikasi React tidak ditemukan')
  })

  it('allows one root and disposes the router exactly once before remounting', () => {
    const container = document.createElement('div')
    act(() => { mounted = mountReactApp(container, { routes: [{ path: '/', element: <Counter /> }], routerFactory: createMemoryRouter }) })
    const dispose = vi.spyOn(mounted.router, 'dispose')
    expect(container.textContent).toContain('Hitungan 0')
    expect(() => mountReactApp(container)).toThrow('sudah terpasang')
    act(() => { mounted.dispose(); mounted.dispose() })
    expect(dispose).toHaveBeenCalledOnce()
    expect(container).toBeEmptyDOMElement()
    act(() => { mounted = mountReactApp(container, { routes: [{ path: '/', element: <Counter /> }], routerFactory: createMemoryRouter }) })
    expect(container.textContent).toContain('Hitungan 0')
  })

  it('cleans listeners and timers through StrictMode and pagehide without breaking bfcache', () => {
    vi.useFakeTimers()
    let effects = 0, cleanups = 0, events = 0
    function LifecycleProbe() {
      useEffect(() => {
        effects++
        const listener = () => { events++ }
        window.addEventListener('foundation-probe', listener)
        const timer = window.setInterval(listener, 1000)
        return () => { cleanups++; window.removeEventListener('foundation-probe', listener); window.clearInterval(timer) }
      }, [])
      return <p>Lifecycle probe</p>
    }
    const container = document.createElement('div')
    act(() => { mounted = mountReactApp(container, { routes: [{ path: '/', element: <LifecycleProbe /> }], routerFactory: createMemoryRouter }) })
    expect(effects).toBe(2)
    expect(cleanups).toBe(1)
    expect(vi.getTimerCount()).toBe(1)
    window.dispatchEvent(new Event('foundation-probe'))
    expect(events).toBe(1)
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(container.textContent).toContain('Lifecycle probe')
    act(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })))
    expect(cleanups).toBe(effects)
    expect(vi.getTimerCount()).toBe(0)
    window.dispatchEvent(new Event('foundation-probe'))
    expect(events).toBe(1)
    expect(container).toBeEmptyDOMElement()
  })
})
