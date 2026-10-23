import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportsPage } from '../src/react/imports/ImportsPage.jsx'
import { SessionContext } from '../src/react/session/session-context.js'
import { ThemeProvider } from '../src/react/theme/ThemeProvider.jsx'
import { documentNavigation } from '../src/services/document-navigation.js'
import { uploadDataset } from '../src/services/import-dataset-service.js'
const admin = { id: 'admin', role: 'Administrator', username: 'admin' }
const item = (id, status = 'ready') => ({ id, name: id, dataset_id: 'shared', status, source_filename: `${id}.kmz`, created_at: '2026-10-10T00:00:00Z', summary: { addedAssets: 2, addedRelations: 1 } })
let state
class Request extends EventTarget {
  constructor() { super(); this.upload = new EventTarget(); this.headers = {}; state.xhrs.push(this) }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(key, value) { this.headers[key] = value }
  send(body) { this.body = body }
  abort() { this.aborted = true; this.dispatchEvent(new Event('abort')) }
  complete(status, response) { this.status = status; this.response = response; this.dispatchEvent(new Event('load')) }
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/admin/datasets/import?datasetId=shared')
  state = { xhrs: [], calls: [], history: [item('Seminar'), { ...item('Archive', 'applied'), included_in_active: false }, { ...item('Other'), dataset_id: 'other' }], failure: 0, process: 'processing', pending: null }
  vi.spyOn(documentNavigation, 'assign').mockImplementation(() => {})
  vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {})
  vi.stubGlobal('XMLHttpRequest', Request)
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    state.calls.push({ url, ...options })
    if (state.pending) return state.pending
    if (state.failure) return Response.json({ error: { message: 'API gagal' } }, { status: state.failure })
    if (url === '/api/import-config') return Response.json({ datasets: [{ id: 'shared' }, { id: 'other' }], maxFileSize: 100 })
    if (url === '/api/imports') return Response.json({ imports: state.history })
    if (url.endsWith('/source-file')) return new Response('kml', { headers: { 'content-disposition': "attachment; filename*=UTF-8''Peta%20baru.kmz" } })
    return Response.json({ import: { status: state.process, error: { message: 'Proses gagal' } } })
  }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
function mount() { return render(<StrictMode><ThemeProvider><SessionContext value={{ user: admin, status: 'authenticated', signOut: () => {} }}><ImportsPage /></SessionContext></ThemeProvider></StrictMode>) }
async function ready() { const view = mount(); await screen.findByRole('table'); return view }
async function editor() { await userEvent.click(screen.getByRole('button', { name: 'Impor KML/KMZ' })); fireEvent.change(screen.getByLabelText('Nama impor'), { target: { value: '  Seminar  ' } }); fireEvent.change(screen.getByLabelText('File KML/KMZ'), { target: { files: [new File(['kml'], 'Peta.KMZ')] } }) }
function submit() { fireEvent.submit(document.querySelector('[data-import-form]')) }
async function complete(status, response) { await act(async () => state.xhrs.at(-1).complete(status, response)) }

describe('React import history and uploads', () => {
  it('filters dataset, search and status locally without changing storage or URL', async () => {
    await ready(); expect(screen.getByText('Pernah diterapkan · di luar data aktif')).toBeVisible()
    expect(screen.queryByText('Other', { selector: 'strong' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Cari riwayat impor'), 'seminar.kmz')
    expect(screen.queryByText('Archive', { selector: 'strong' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Filter status impor'), 'failed')
    expect(screen.getByText('Tidak ada impor yang sesuai.')).toBeVisible()
    expect(window.location.search).toBe('?datasetId=shared'); expect(sessionStorage.getItem('sinergiActiveDatasetId')).toBeNull()
    expect(state.xhrs).toHaveLength(0)
  })
  it('reports an empty history and retries failed initial reads', async () => {
    state.failure = 500; mount(); expect(await screen.findByText('API gagal')).toBeVisible()
    state.failure = 0; state.history = []; await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(await screen.findByText('Belum ada impor.')).toBeVisible()
  })
  it('validates file extension, size and empty files without uploading', async () => {
    await ready(); await editor()
    for (const file of [new File(['kml'], 'bad.txt'), new File([], 'empty.kml'), new File(['x'.repeat(101)], 'large.kmz')]) {
      fireEvent.change(screen.getByLabelText('File KML/KMZ'), { target: { files: [file] } }); submit()
      expect(screen.getByText('Pilih file KML/KMZ dengan ukuran yang diperbolehkan.')).toBeVisible()
    }
    expect(state.xhrs).toHaveLength(0)
  })
  it('keeps failed draft, confirms discard and clears errors when reopened', async () => {
    await ready(); await editor(); submit(); await complete(500, { error: { message: 'Unggah gagal' } })
    expect(screen.getByLabelText('Nama impor')).toHaveValue('  Seminar  ')
    expect(screen.getByLabelText('File KML/KMZ').files[0].name).toBe('Peta.KMZ')
    await userEvent.keyboard('{Escape}'); expect(screen.getByText('Buang draft impor?')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Lanjutkan mengisi' })); expect(screen.getByLabelText('Nama impor')).toHaveFocus()
    expect(screen.getByText('Unggah gagal')).toBeVisible()
    await userEvent.keyboard('{Escape}'); await userEvent.click(screen.getByRole('button', { name: 'Buang draft', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Impor KML/KMZ' }))
    expect(screen.getByLabelText('Nama impor')).toHaveValue(''); expect(screen.queryByText('Unggah gagal')).not.toBeInTheDocument()
  })
  it('sends original multipart payload once with bearer, reports progress and protects busy draft', async () => {
    sessionStorage.setItem('sinergiSessionToken', 'token'); await ready(); await editor(); submit(); submit()
    expect(state.xhrs).toHaveLength(1)
    const xhr = state.xhrs[0]
    expect(xhr.body.get('datasetId')).toBe('shared'); expect(xhr.body.get('versionName')).toBe('  Seminar  '); expect(xhr.body.get('file').name).toBe('Peta.KMZ')
    expect(xhr.headers.Authorization).toBe('Bearer token')
    act(() => xhr.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: 1, total: 2 })))
    expect(screen.getByText('Mengunggah 50%…')).toBeVisible(); expect(screen.getByLabelText('Dataset aktif')).toBeDisabled()
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true)
    await userEvent.keyboard('{Escape}'); expect(screen.getByRole('dialog')).toBeVisible()
    await complete(500, {}); expect(await screen.findByText('Upload gagal.')).toBeVisible()
    expect(screen.getByLabelText('Nama impor')).toBeEnabled()
  })
  it('opens preview using returned import ID, and handles processing failure without losing file', async () => {
    await ready(); await editor(); state.process = 'failed'; submit(); await complete(202, { importId: 'real/id', statusUrl: '/api/jobs/unrelated' })
    expect(await screen.findByText('Proses gagal')).toBeVisible(); expect(screen.getByLabelText('File KML/KMZ').files).toHaveLength(1)
    state.process = 'ready'; submit(); await complete(202, { importId: 'real/id', statusUrl: '/api/jobs/unrelated' })
    expect(documentNavigation.assign).toHaveBeenCalledWith('/admin/datasets/import/real%2Fid/preview')
    expect(state.calls.some(call => call.url === '/api/jobs/unrelated')).toBe(true)
  })
  it('aborts XHR and removes draft navigation guard on unmount', async () => {
    const view = await ready(); await editor(); submit(); view.unmount()
    expect(state.xhrs[0].aborted).toBe(true)
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false)
    expect(documentNavigation.assign).not.toHaveBeenCalled()
  })
  it('stops polling timer and read requests on pagehide', async () => {
    await ready(); await editor(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); submit()
    await complete(202, { importId: 'id', statusUrl: '/api/jobs/id' })
    const count = state.calls.length
    act(() => window.dispatchEvent(new Event('pagehide')))
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(state.calls).toHaveLength(count); expect(documentNavigation.assign).not.toHaveBeenCalled()
  })
  it('polls at 1200 ms and aborts an in-flight status request on unmount', async () => {
    const view = await ready(); await editor(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); submit()
    await complete(202, { importId: 'id', statusUrl: '/api/jobs/id' })
    const polls = () => state.calls.filter(call => call.url === '/api/jobs/id')
    expect(polls()).toHaveLength(1)
    await act(async () => vi.advanceTimersByTimeAsync(1199)); expect(polls()).toHaveLength(1)
    let resolve; state.pending = new Promise(done => { resolve = done })
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(polls()).toHaveLength(2)
    view.unmount(); expect(polls()[1].signal.aborted).toBe(true)
    await act(async () => resolve(Response.json({ import: { status: 'ready' } })))
    expect(documentNavigation.assign).not.toHaveBeenCalled()
  })
  it('handles a disconnected upload and unknown progress without discarding the draft', async () => {
    await ready(); await editor(); submit()
    act(() => state.xhrs[0].upload.dispatchEvent(new ProgressEvent('progress')))
    expect(screen.getByText('Mengunggah…')).toBeVisible()
    await act(async () => state.xhrs[0].dispatchEvent(new Event('error')))
    expect(screen.getByText('Koneksi terputus. Periksa riwayat impor sebelum mencoba lagi.')).toBeVisible()
    expect(screen.getByLabelText('Nama impor')).toHaveValue('  Seminar  ')
  })
  it('expires an unauthorized upload and aborts a pending source download on unmount', async () => {
    const view = await ready(); await editor(); submit(); await complete(403, {})
    expect(documentNavigation.replace).toHaveBeenCalledWith('/')
    view.unmount()
    state.failure = 0; const second = await ready()
    let resolve; state.pending = new Promise(done => { resolve = done })
    await userEvent.click(screen.getAllByRole('button', { name: 'File sumber' })[0])
    const call = state.calls.at(-1); second.unmount(); expect(call.signal.aborted).toBe(true)
    await act(async () => resolve(new Response('source')))
  })
  it('aborts outstanding reads and ignores late responses after unmount', async () => {
    let resolve; state.pending = new Promise(done => { resolve = done }); const view = mount()
    view.unmount(); expect(state.calls.every(call => call.signal.aborted)).toBe(true)
    await act(async () => resolve(Response.json({ datasets: [], imports: [] })))
    expect(documentNavigation.replace).not.toHaveBeenCalled()
  })
  it('expires unauthorized sessions and rejects an already aborted upload without XHR', async () => {
    state.failure = 401; mount(); await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledWith('/'))
    const controller = new AbortController(); controller.abort()
    await expect(uploadDataset({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.xhrs).toHaveLength(0)
  })
  it('revokes a downloaded object URL immediately on unmount', async () => {
    const create = vi.fn(() => 'blob:source'), revoke = vi.fn(); URL.createObjectURL = create; URL.revokeObjectURL = revoke
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const view = await ready(); await userEvent.click(screen.getAllByRole('button', { name: 'File sumber' })[0])
    expect(create).toHaveBeenCalledOnce(); view.unmount(); expect(revoke).toHaveBeenCalledWith('blob:source')
  })
})
