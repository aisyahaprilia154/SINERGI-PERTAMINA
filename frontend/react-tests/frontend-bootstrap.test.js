import { describe, expect, it, vi } from 'vitest'
import { startFrontend, usesReactRoute } from '../src/frontend-bootstrap.js'
import { reactRoutes } from '../src/react/routes.js'

describe('transition entrypoint', () => {
  it('activates React login, users and versions while preserving other legacy pages and aliases', async () => {
    expect(reactRoutes).toHaveLength(5)
    expect(await usesReactRoute('/')).toBe(true)
    expect(await usesReactRoute('/unknown')).toBe(true)
    expect(await usesReactRoute('/admin/users')).toBe(true)
    expect(await usesReactRoute('/admin/users/')).toBe(true)
    expect(await usesReactRoute('/admin/datasets/versions')).toBe(true)
    expect(await usesReactRoute('/admin/datasets/versions/')).toBe(true)
    expect(await usesReactRoute('/admin/datasets/import')).toBe(true)
    expect(await usesReactRoute('/admin/datasets/import/')).toBe(true)
    for (const pathname of ['/map', '/peta', '/topology', '/topologi', '/admin/datasets/import/id/preview']) {
      expect(await usesReactRoute(pathname)).toBe(false)
    }
  })

  it('loads only the legacy entrypoint without taking ownership of its DOM', async () => {
    const container = document.createElement('div')
    container.textContent = 'Existing UI'
    const loadLegacy = vi.fn().mockResolvedValue({})
    const loadReact = vi.fn()
    expect(await startFrontend({ pathname: '/map', container, loadLegacy, loadReact })).toEqual({ implementation: 'legacy' })
    expect(loadLegacy).toHaveBeenCalledOnce()
    expect(loadReact).not.toHaveBeenCalled()
    expect(container.textContent).toBe('Existing UI')
  })

  it('matches a completed dynamic route and delegates to a single React mount', async () => {
    const routes = [{ path: '/preview/:id', element: null }]
    const mountReactApp = vi.fn().mockReturnValue({ dispose: vi.fn() })
    const loadLegacy = vi.fn()
    const container = document.createElement('div')
    const result = await startFrontend({ pathname: '/preview/abc', container, routes, loadLegacy, loadReact: async () => ({ mountReactApp }) })
    expect(result.implementation).toBe('react')
    expect(mountReactApp).toHaveBeenCalledExactlyOnceWith(container, { routes })
    expect(loadLegacy).not.toHaveBeenCalled()
    expect(await usesReactRoute('/map', routes)).toBe(false)
  })
})
