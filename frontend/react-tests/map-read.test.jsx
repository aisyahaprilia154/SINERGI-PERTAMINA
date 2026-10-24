import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'
import { MapReadPage } from '../src/react/map/MapReadPage.jsx'
import { ThemeProvider } from '../src/react/theme/ThemeProvider.jsx'
import { SessionContext } from '../src/react/session/session-context.js'
import { documentNavigation } from '../src/services/document-navigation.js'
import { createMapReadAdapter } from '../src/adapters/map-read-adapter.js'
import { createSourceIconLoader } from '../src/domain/source-icon-loader.js'
import { usesReactRoute } from '../src/frontend-bootstrap.js'
let state
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/map?datasetId=dataset-semarang')
  state = { calls: [], adapters: [], payload: structuredClone(fixtures.active), pending: null, failure: 0, mobile: false }
  vi.stubGlobal('matchMedia', () => ({ matches: state.mobile, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(documentNavigation, 'assign').mockImplementation(() => {})
  vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {})
  vi.spyOn(documentNavigation, 'reload').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    state.calls.push({ url, ...options })
    if (state.pending) return state.pending.promise
    return Response.json(state.failure ? { error: { message: 'Data gagal dibaca' } } : state.payload, { status: state.failure || 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
const factory = (host, options) => {
  let active = true
  const adapter = Object.fromEntries(['update', 'dispose', 'zoomIn', 'zoomOut', 'reset', 'highlightAsset', 'focusAsset', 'focusNetwork', 'highlightNetwork', 'invalidateSize'].map(name => [name, vi.fn()]))
  adapter.setBasemapMode = vi.fn(() => true); adapter.dispose.mockImplementation(() => { active = false })
  state.adapters.push({ host, options, adapter }); queueMicrotask(() => { if (active) { if (state.surfaceFailure) options.onError(new Error('Renderer gagal')); else options.onReady({ mode: 'street', street: true, satellite: true }) } }); return adapter
}
function mount(role = 'Administrator') { return render(<StrictMode><ThemeProvider><SessionContext value={{ user: { ...fixtures.user, role }, status: 'authenticated', signOut: () => {} }}><MapReadPage createAdapter={factory} /></SessionContext></ThemeProvider></StrictMode>) }
async function ready(role) { const view = mount(role); await waitFor(() => expect(screen.getByRole('button', { name: 'Perbesar peta' })).toBeEnabled()); return view }
const current = () => state.adapters.at(-1)
const search = () => screen.getByRole('combobox', { name: 'Cari Asset ID, nama aset, lokasi, atau hostname' })

describe('prepared React map read UI', () => {
  it('activates both map routes, renders read controls and performs no dataset writes', async () => {
    await ready(); expect(await usesReactRoute('/map')).toBe(true); expect(await usesReactRoute('/peta')).toBe(true)
    expect(screen.getByRole('heading', { name: 'Jaringan aset' })).toBeVisible()
    expect(screen.getByLabelText('Area fasilitas')).toHaveValue('ft-semarang')
    expect(state.calls.every(call => call.method === 'GET')).toBe(true)
    expect(document.querySelector('.selected-count')).toHaveTextContent('1')
  })
  it('supports empty data and retry after an initial error', async () => {
    state.failure = 500; mount(); expect(await screen.findByText('Data gagal dibaca')).toBeVisible()
    state.failure = 0; state.payload = { ...fixtures.active, assets: [], geometries: [], relations: [], layers: [] }
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(await screen.findByText('Belum ada jaringan pada dataset aktif.')).toBeVisible()
    expect(screen.getByText('Layer aktif belum mempunyai geometri yang dapat ditampilkan')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Diagram Topologi' })).toBeDisabled()
  })
  it('toggles networks, explicit empty URL, presets, CCTV and subcategories without creating another surface', async () => {
    await ready(); const count = state.adapters.length, api = current().adapter
    await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan Jaringan CCTV' }))
    expect(screen.getByText('Semua jaringan disembunyikan')).toBeVisible(); expect(new URLSearchParams(location.search).get('selectedNetworkIds')).toBe('')
    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan jaringan' }))
    await userEvent.click(screen.getByRole('switch')); expect(api.update.mock.calls.at(-1)[0].showCctvCoverage).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Buka subkategori Jaringan CCTV' }))
    expect(document.querySelector('.network-subcategories')).not.toHaveAttribute('hidden')
    await userEvent.click(screen.getByRole('button', { name: 'Fiber Optic', exact: true }))
    expect(new URLSearchParams(location.search).get('selectedNetworkIds')).toBe('network:cctv')
    expect(state.adapters).toHaveLength(count)
  })
  it('searches and selects via keyboard using canonical ID, updates URL and restores back/forward state', async () => {
    await ready(); await userEvent.type(search(), 'C-01')
    expect(screen.getByRole('listbox')).toBeVisible()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(new URLSearchParams(location.search).get('selectedAssetId')).toBe('C-01')
    expect(current().adapter.highlightAsset).toHaveBeenCalledWith('C-01')
    act(() => { window.history.replaceState(null, '', '/map?selectedNetworkIds=&selectedAssetId=SW-01'); window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(current().adapter.update.mock.calls.at(-1)[0].selectedAssetId).toBe('SW-01')
    expect(screen.getByText('Semua jaringan disembunyikan')).toBeVisible()
  })
  it('reselects the same asset without duplicating browser history', async () => {
    await ready(); await userEvent.type(search(), 'C-01'); await userEvent.click(screen.getByRole('option', { name: /Pilih C-01/ }))
    const length = window.history.length
    await userEvent.click(search()); await userEvent.click(screen.getByRole('option', { name: /Pilih C-01/ }))
    expect(window.history.length).toBe(length); expect(current().adapter.focusAsset).toHaveBeenCalledWith('C-01')
  })
  it('keeps the network list during an empty search and supports Ctrl K and Escape', async () => {
    await ready(); await userEvent.type(search(), 'no match here')
    expect(screen.getByText('Aset tidak ditemukan pada area aktif.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sembunyikan Jaringan CCTV' })).toBeVisible()
    await userEvent.keyboard('{Escape}'); expect(screen.getByRole('combobox', { name: /Cari Asset/ })).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Tutup panel jaringan' })); await userEvent.keyboard('{Control>}k{/Control}')
    expect(search()).toHaveFocus()
  })
  it('wires zoom/focus, mutually exclusive legend/basemap and restores picker focus on Escape', async () => {
    await ready(); const api = current().adapter
    await userEvent.click(screen.getByRole('button', { name: 'Perbesar peta' })); expect(api.zoomIn).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Fokuskan peta ke Jaringan CCTV' })); expect(api.focusNetwork).toHaveBeenCalledWith('network:cctv')
    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan legenda' })); expect(screen.getByText('Legenda peta')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Pilih tampilan peta dasar' })); expect(screen.getByText('Legenda peta')).not.toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Citra satelit/ })); expect(api.setBasemapMode).toHaveBeenCalledWith('satellite')
    await userEvent.click(screen.getByRole('button', { name: 'Pilih tampilan peta dasar' })); await userEvent.click(screen.getByRole('button', { name: 'Tutup pilihan peta dasar' }))
    expect(screen.getByRole('button', { name: 'Pilih tampilan peta dasar' })).toHaveFocus()
  })
  it('supports mobile panels and closes them after asset selection', async () => {
    state.mobile = true; await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Aset', exact: true })); expect(search()).toHaveFocus(); expect(document.querySelector('.map-workspace')).toHaveClass('sidebar-open')
    await userEvent.type(search(), 'C-01'); await userEvent.click(screen.getByRole('option', { name: /Pilih C-01/ }))
    expect(document.querySelector('.map-workspace')).not.toHaveClass('sidebar-open')
  })
  it('scope-checks revision events and removes global listeners and adapter on unmount', async () => {
    const view = await ready()
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'sinergi:revision:other', newValue: '9' })); window.dispatchEvent(new StorageEvent('storage', { key: 'sinergi:revision:dataset-semarang', newValue: '4' })) })
    expect(documentNavigation.reload).not.toHaveBeenCalled()
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'sinergi:revision:dataset-semarang', newValue: '5' })))
    expect(documentNavigation.reload).toHaveBeenCalledOnce(); view.unmount()
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'sinergi:revision:dataset-semarang', newValue: '6' })))
    expect(documentNavigation.reload).toHaveBeenCalledOnce(); expect(state.adapters.every(item => item.adapter.dispose.mock.calls.length)).toBe(true)
  })
  it('aborts and ignores late dataset results and expired access', async () => {
    state.pending = deferred(); const view = mount(); view.unmount(); expect(state.calls.every(call => call.signal.aborted)).toBe(true)
    await act(async () => state.pending.resolve(Response.json(fixtures.active)))
    expect(state.adapters).toHaveLength(0)
    state.pending = null; state.failure = 401; mount(); await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledWith('/'))
  })
  it('retries a failed renderer without refetching the dataset and disposes the failed adapter', async () => {
    state.surfaceFailure = true; mount(); expect(await screen.findByText('Renderer gagal')).toBeVisible()
    const failed = current().adapter, reads = state.calls.length
    state.surfaceFailure = false; await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Perbesar peta' })).toBeEnabled())
    expect(failed.dispose).toHaveBeenCalled(); expect(state.calls).toHaveLength(reads)
  })
  it('changes area by document navigation, removes asset selection and preserves unrelated URL state', async () => {
    window.history.replaceState(null, '', '/map?datasetId=dataset-semarang&selectedAssetId=C-01&other=keep')
    const asset = { ...fixtures.active.assets[0], id: 'other', assetId: 'OTHER', name: 'Other', locationGroupKey: 'ft-tegal-baru', locationGroupName: 'FT Tegal Baru', facilityName: 'FT Tegal Baru', sourceFolderPath: '/RJBT/FT Tegal Baru/Infrastructure', layerId: 'other-layer' }
    state.payload.assets.push(asset); state.payload.layers.push({ id: 'other-layer', name: 'FT Tegal Baru', defaultVisible: true, sourceFolderPath: asset.sourceFolderPath }); state.payload.geometries.push({ id: 'other-point', assetNodeId: 'other', geometryType: 'point', coordinates: [109, -6.8] })
    await ready(); await userEvent.selectOptions(screen.getByLabelText('Area fasilitas'), 'ft-tegal-baru')
    const next = new URL(documentNavigation.assign.mock.calls[0][0], 'http://localhost')
    expect(next.searchParams.get('area')).toBe('ft-tegal-baru'); expect(next.searchParams.get('selectedAssetId')).toBeNull(); expect(next.searchParams.get('other')).toBe('keep')
    expect(current().adapter.dispose).toHaveBeenCalled()
  })
  it('Viewer only receives read controls and cannot reach administrator actions', async () => {
    await ready('Viewer'); await userEvent.click(screen.getByRole('button', { name: /Menu akun/ }))
    expect(screen.queryByRole('menuitem', { name: 'Kelola pengguna' })).not.toBeInTheDocument()
    expect(state.calls.every(call => call.method === 'GET')).toBe(true)
  })
})

describe('persistent read map adapter and icon requests', () => {
  it('queues latest state, pans only when asset changes and disposes exactly once', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const surface = { setState: vi.fn(), setFocusedNetworkId: vi.fn(), getBasemapCapabilities: () => ({ mode: 'street' }), destroy: vi.fn() }
    const create = vi.fn(() => surface), adapter = createMapReadAdapter(host, {}, { loadFactory: async () => create })
    adapter.update({ selectedAssetId: 'C-01', selectedNetworkIds: new Set(['network']) }); await adapter.ready
    adapter.update({ selectedAssetId: 'C-01', selectedNetworkIds: new Set() })
    expect(surface.setState.mock.calls[0][0].selectedAssetId).toBe('C-01')
    expect(surface.setState.mock.calls[1][0]).not.toHaveProperty('selectedAssetId'); expect(create).toHaveBeenCalledOnce()
    adapter.dispose(); adapter.dispose(); expect(surface.destroy).toHaveBeenCalledOnce(); host.remove()
  })
  it('ignores delayed factory and callbacks after disposal', async () => {
    const host = document.createElement('div'); document.body.append(host); const pending = deferred(), create = vi.fn(), ready = vi.fn()
    const adapter = createMapReadAdapter(host, { onReady: ready }, { loadFactory: () => pending.promise }); adapter.dispose(); pending.resolve(create); await adapter.ready
    expect(create).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled(); host.remove()
  })
  it('aborts source-icon fetch and never caches the late result or starts a new request', async () => {
    state.pending = deferred(); const controller = new AbortController(), loader = createSourceIconLoader({ signal: controller.signal })
    const promise = loader.load('/api/icons/test'); expect(state.calls.at(-1).signal).toBe(controller.signal)
    controller.abort(); state.pending.resolve(new Response('image')); expect(await promise).toBeNull()
    expect(loader.dataByUrl.size).toBe(0); const count = state.calls.length; expect(await loader.load('/api/icons/other')).toBeNull(); expect(state.calls).toHaveLength(count)
  })
})
