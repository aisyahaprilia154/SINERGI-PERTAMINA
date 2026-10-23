import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'
import { PreviewPage } from '../src/react/preview/PreviewPage.jsx'
import { createPreviewMapAdapter } from '../src/adapters/preview-map-adapter.js'
import { SessionContext } from '../src/react/session/session-context.js'
import { ThemeProvider } from '../src/react/theme/ThemeProvider.jsx'
import { documentNavigation } from '../src/services/document-navigation.js'
let state
const conflict = { id: 'identity', kind: 'asset', status: 'conflict', reason: 'identity_conflict', proposal: { name: 'Ambiguous' }, result: { candidates: ['camera'] } }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/admin/datasets/import/test/preview')
  state = { preview: structuredClone(fixtures.preview), active: structuredClone(fixtures.active), calls: [], adapters: [], failure: 0, writeFailure: 0, pending: null, process: 'ready', mutations: 0 }
  vi.spyOn(documentNavigation, 'assign').mockImplementation(() => {})
  vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    state.calls.push({ url, ...options })
    if (state.pending) return state.pending.promise
    if (state.failure) return Response.json({ error: { message: 'Baca gagal' } }, { status: state.failure })
    if (options.method !== 'GET' && options.method) {
      state.mutations++
      if (state.writeFailure) { state.preview.baseRevision = 8; return Response.json({ error: { message: 'Revision berubah' } }, { status: state.writeFailure }) }
      return Response.json({ revision: 5, datasetId: 'dataset-semarang' })
    }
    if (url.endsWith('/preview')) return Response.json(state.preview)
    if (url.endsWith('/active')) return Response.json(state.active)
    if (url.endsWith('/source-file')) return new Response('source')
    return Response.json({ import: { status: state.process, error: { message: 'Hitung ulang gagal' } } })
  }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
const factory = () => { const adapter = { update: vi.fn(), dispose: vi.fn() }; state.adapters.push(adapter); return adapter }
function mount() { return render(<StrictMode><ThemeProvider><SessionContext value={{ user: fixtures.user, status: 'authenticated', signOut: () => {} }}><PreviewPage importId="test" createAdapter={factory} /></SessionContext></ThemeProvider></StrictMode>) }
async function ready() { const view = mount(); await waitFor(() => expect(screen.getByRole('button', { name: 'Hitung ulang preview' })).toBeEnabled()); return view }
const writes = () => state.calls.filter(call => call.method && call.method !== 'GET')

describe('React import preview', () => {
  it('shows summary, additions and context without writes, and disposes map ownership', async () => {
    const view = await ready(); expect(screen.getByText('1 aset baru · 0 relasi baru · 0 konflik')).toBeVisible()
    expect(screen.getByText('C-02', { selector: 'td' })).toBeVisible(); expect(writes()).toHaveLength(0)
    const adapter = state.adapters.at(-1)
    expect(adapter.update.mock.calls.at(-1)[0].assets).toHaveLength(3)
    await userEvent.click(screen.getByLabelText('Tampilkan aset lama'))
    expect(adapter.update.mock.calls.at(-1)[0].assets).toHaveLength(1)
    view.unmount(); expect(state.adapters.every(item => item.dispose.mock.calls.length > 0)).toBe(true)
  })
  it('renders empty additions and retries failed initial reads', async () => {
    state.failure = 500; mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Baca gagal')
    state.failure = 0; state.preview.items = []
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' })); expect(await screen.findByText('Tidak ada tambahan aset.')).toBeVisible()
  })
  it('resolves identity with original item ID and token, prevents double writes and retains selections on failure', async () => {
    state.preview.conflicts = [conflict]; state.preview.summary.conflicts = 1; sessionStorage.setItem('sinergiSessionToken', 'token')
    await ready(); expect(screen.getByRole('button', { name: 'Terapkan tambahan' })).toBeDisabled()
    expect(screen.getByLabelText('Aset lama').options).toHaveLength(2)
    await userEvent.selectOptions(screen.getByLabelText('Aset lama'), 'camera')
    state.pending = deferred()
    const button = screen.getByRole('button', { name: 'Cocokkan ke aset lama' }); fireEvent.click(button); fireEvent.click(button)
    expect(writes()).toHaveLength(1); expect(writes()[0].url).toBe('/api/imports/test/items/identity')
    expect(JSON.parse(writes()[0].body)).toEqual({ decision: 'match_existing', assetId: 'camera' }); expect(writes()[0].headers.Authorization).toBe('Bearer token')
    await act(async () => state.pending.resolve(Response.json({ error: { message: 'Simpan gagal' } }, { status: 500 })))
    expect(await screen.findByText('Simpan gagal')).toBeVisible(); expect(screen.getByLabelText('Aset lama')).toHaveValue('camera'); expect(button).toBeEnabled()
  })
  it('filters mounting endpoints to devices and physical mounts and preserves drafts after refresh', async () => {
    state.active.assets.forEach(asset => { asset.objectRole = 'device_node' })
    state.active.assets.push({ id: 'pole', name: 'Tiang', objectRole: 'device_node', diagramRole: 'physical-mount' })
    state.preview.conflicts = [{ id: 'mount', kind: 'relation', proposal: { kind: 'mounting' }, result: {} }]; state.preview.summary.conflicts = 1
    await ready(); expect(screen.getByLabelText('Endpoint akhir').options).toHaveLength(2)
    await userEvent.selectOptions(screen.getByLabelText('Endpoint awal'), 'camera'); await userEvent.selectOptions(screen.getByLabelText('Endpoint akhir'), 'pole')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan pasangan' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simpan pasangan' })).toBeEnabled())
    expect(JSON.parse(writes()[0].body)).toEqual({ decision: 'connect', sourceAssetId: 'camera', targetAssetId: 'pole' })
    expect(screen.getByLabelText('Endpoint akhir')).toHaveValue('pole')
  })
  it('uses baseRevision, reloads a conflict and applies the fresh revision on retry', async () => {
    await ready(); state.writeFailure = 409
    await userEvent.click(screen.getByRole('button', { name: 'Terapkan tambahan' }))
    expect(await screen.findByText('Revision berubah')).toBeVisible(); expect(JSON.parse(writes()[0].body)).toEqual({ expectedRevision: 4 })
    state.writeFailure = 0; await userEvent.click(screen.getByRole('button', { name: 'Terapkan tambahan' }))
    await waitFor(() => expect(documentNavigation.assign).toHaveBeenCalledWith('/map?datasetId=dataset-semarang'))
    expect(JSON.parse(writes()[1].body)).toEqual({ expectedRevision: 8 })
  })
  it('polls recalculation, reports processing failure and leaves preview usable', async () => {
    await ready(); state.process = 'failed'; await userEvent.click(screen.getByRole('button', { name: 'Hitung ulang preview' }))
    expect(await screen.findByText('Hitung ulang gagal')).toBeVisible(); expect(writes()[0].url).toBe('/api/imports/test/refresh')
    expect(screen.getByRole('button', { name: 'Hitung ulang preview' })).toBeEnabled()
  })
  it('aborts polling and ignores late read/mutation results on pagehide and unmount', async () => {
    const view = await ready(); state.process = 'processing'; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Hitung ulang preview' })))
    const count = state.calls.length; act(() => window.dispatchEvent(new Event('pagehide')))
    await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(state.calls).toHaveLength(count)
    view.unmount(); vi.useRealTimers()
    state.pending = deferred(); const next = mount(); next.unmount(); expect(state.calls.at(-1).signal.aborted).toBe(true)
    await act(async () => state.pending.resolve(Response.json(state.preview)))
    expect(documentNavigation.assign).not.toHaveBeenCalled()
  })
  it('redirects expired access without mounting the map', async () => {
    state.failure = 403; mount(); await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledWith('/'))
    expect(state.adapters).toHaveLength(0)
  })
})

describe('isolated MapLibre preview adapter', () => {
  it('keeps the instance for table-only updates, preserves camera on payload changes and disposes', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const surfaces = [], create = vi.fn(() => { const surface = { getCamera: () => ({ center: [110, -7], zoom: 18 }), destroy: vi.fn() }; surfaces.push(surface); return surface })
    const adapter = createPreviewMapAdapter(host, { loadFactory: async () => create })
    await adapter.update(fixtures.active); await adapter.update(structuredClone(fixtures.active)); expect(create).toHaveBeenCalledOnce()
    await adapter.update({ ...fixtures.active, revision: 6 }); expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][1].initialCamera).toEqual({ center: [110, -7], zoom: 18 }); expect(surfaces[0].destroy).toHaveBeenCalledOnce()
    adapter.dispose(); expect(surfaces[1].destroy).toHaveBeenCalledOnce(); host.remove()
  })
  it('aborts source-icon requests owned by the preview surface and ignores late data', async () => {
    const host = document.createElement('div'); document.body.append(host); state.pending = deferred()
    let request, loader
    const adapter = createPreviewMapAdapter(host, { loadFactory: async () => (_host, options) => { loader = options.iconLoader; request = loader.load('/api/icons/preview'); return { destroy() {} } } })
    await adapter.update(fixtures.active)
    const signal = state.calls.at(-1).signal; expect(signal.aborted).toBe(false)
    adapter.dispose(); expect(signal.aborted).toBe(true)
    state.pending.resolve(new Response('source-image')); expect(await request).toBeNull(); expect(loader.dataByUrl.size).toBe(0); host.remove()
  })
  it('ignores delayed factory resolution after disposal and allows retry after load failure', async () => {
    const host = document.createElement('div'); document.body.append(host); const pending = deferred(), create = vi.fn()
    const adapter = createPreviewMapAdapter(host, { loadFactory: () => pending.promise })
    const update = adapter.update(fixtures.active); adapter.dispose(); pending.resolve(create); await update; expect(create).not.toHaveBeenCalled()
    let fail = true
    const retry = createPreviewMapAdapter(host, { loadFactory: async () => { if (fail) throw new Error('Module gagal'); return () => ({ destroy() {} }) } })
    await retry.update(fixtures.active); expect(host).toHaveTextContent('Peta tidak dapat dimuat: Module gagal')
    fail = false; await retry.update(fixtures.active); expect(host).toBeEmptyDOMElement(); retry.dispose(); host.remove()
  })
})
