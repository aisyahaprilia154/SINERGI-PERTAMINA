import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VersionsPage } from '../src/react/versions/VersionsPage.jsx'
import { VersionsRoute } from '../src/react/versions/VersionsRoute.jsx'
import { SessionContext } from '../src/react/session/session-context.js'
import { ThemeProvider } from '../src/react/theme/ThemeProvider.jsx'
import { documentNavigation } from '../src/services/document-navigation.js'

const admin = { id: 'admin', role: 'Administrator', username: 'admin' }
const version = id => ({ id, name: id, created_at: '2026-10-10T00:00:00Z', actor_name: 'admin', summary: { assets: 1376, relations: 594 } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
let state
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  window.history.replaceState(null, '', '/admin/datasets/versions?datasetId=shared')
  state = { datasets: [{ id: 'shared', name: 'Shared' }, { id: 'other', name: 'Other' }], data: { revision: 4, currentVersionId: 'B', versions: [version('B'), version('A')] }, calls: [], configFailure: 0, listFailure: 0, writeFailure: 0, pendingReads: new Map(), pendingWrite: null, existing: false }
  vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {})
  vi.spyOn(documentNavigation, 'reload').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    state.calls.push({ url, ...options })
    if (url.startsWith('/api/auth/')) return Response.json({ user: { ...admin, role: 'Viewer' } })
    if (url === '/api/import-config') return Response.json(state.configFailure ? { error: { message: 'Config gagal' } } : { datasets: state.datasets }, { status: state.configFailure || 200 })
    if (options.method === 'GET') {
      if (state.pendingReads.has(url)) return state.pendingReads.get(url).promise
      return Response.json(state.listFailure ? { error: { message: 'Daftar gagal' } } : state.data, { status: state.listFailure || 200 })
    }
    if (state.pendingWrite) return state.pendingWrite.promise
    if (state.writeFailure) return Response.json({ error: { message: 'Data berubah; muat ulang.' } }, { status: state.writeFailure })
    const restore = url.endsWith('/restore')
    state.data = { ...state.data, revision: 9, currentVersionId: restore ? 'A' : 'C', versions: restore ? state.data.versions : [{ ...version('C'), name: JSON.parse(options.body).name }, ...state.data.versions] }
    return Response.json(restore ? { datasetId: 'shared', revision: 9, currentVersionId: 'A' } : { datasetId: 'shared', revision: 9, existing: state.existing, version: state.data.versions[0] })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
function mount() { return render(<StrictMode><ThemeProvider><SessionContext value={{ user: admin, status: 'authenticated', signOut: () => {} }}><VersionsPage /></SessionContext></ThemeProvider></StrictMode>) }
async function ready() { const view = mount(); await screen.findByText('Data aktif: “B”.'); return view }
const saveButton = () => screen.getByRole('button', { name: 'Simpan versi', exact: true })
const writes = () => state.calls.filter(call => call.method === 'POST')
const reads = () => state.calls.filter(call => call.method === 'GET' && call.url.endsWith('/versions'))
async function openSave() { await userEvent.click(saveButton()); return screen.getByRole('dialog') }

describe('React database versions', () => {
  it('renders dataset, active version, summaries and maximum without importing history', async () => {
    await ready()
    expect(document.title).toBe('Versi database — SINERGI')
    expect(screen.getByLabelText('Dataset aktif')).toHaveValue('shared')
    expect(screen.getByText('10 versi maksimum')).toBeVisible()
    expect(screen.getAllByText('1376 aset · 594 koneksi')).toHaveLength(2)
    expect(within(screen.getByText('Aktif').closest('tr')).getByRole('button', { name: 'Pulihkan' })).toBeDisabled()
    expect(state.calls.some(call => call.url === '/api/imports')).toBe(false)
  })

  it.each([
    ['?datasetId=other', 'shared', 'other'],
    ['', 'other', 'other'],
    ['?datasetId=missing', 'other', 'shared'],
  ])('resolves dataset from URL %s and storage %s to %s', async (query, stored, expected) => {
    window.history.replaceState(null, '', `/admin/datasets/versions${query}`)
    sessionStorage.setItem('sinergiActiveDatasetId', stored)
    await ready()
    expect(screen.getByLabelText('Dataset aktif')).toHaveValue(expected)
    expect(reads().every(call => call.url === `/api/datasets/${expected}/versions`)).toBe(true)
    expect(sessionStorage.getItem('sinergiActiveDatasetId')).toBe(stored)
    expect(window.location.search).toBe(query)
  })

  it('supports a single unnamed dataset and empty checkpoints', async () => {
    state.datasets = [{ id: 'dataset-semarang' }]
    state.data = { revision: 0, currentVersionId: null, versions: [] }
    mount()
    expect(await screen.findByText('SINERGI', { selector: 'strong' })).toBeVisible()
    expect(await screen.findByText('Belum ada versi tersimpan. Simpan keadaan saat ini untuk membuat titik pemulihan.')).toBeVisible()
    expect(screen.queryByLabelText('Dataset aktif')).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it('shows missing configuration and retries a failed config without requesting versions', async () => {
    state.configFailure = 500
    mount()
    expect(await screen.findByText('Config gagal')).toBeVisible()
    expect(reads()).toHaveLength(0)
    state.configFailure = 0; state.datasets = []
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(await screen.findByText('Belum ada dataset yang tersedia.')).toBeVisible()
    state.datasets = [{ id: 'shared' }]
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(await screen.findByText('Data aktif: “B”.')).toBeVisible()
  })

  it('saves a trimmed name with snapshot revision once, blocks busy controls, publishes revision and returns focus', async () => {
    sessionStorage.setItem('sinergiSessionToken', 'token')
    await ready()
    const dialog = await openSave()
    expect(screen.getByLabelText('Nama versi')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Nama versi'), { target: { value: '  Seminar  ' } })
    state.pendingWrite = deferred()
    const form = dialog.querySelector('form')
    fireEvent.submit(form); fireEvent.submit(form)
    expect(writes()).toHaveLength(1)
    expect(writes()[0].url).toBe('/api/datasets/shared/versions')
    expect(writes()[0].headers.Authorization).toBe('Bearer token')
    expect(JSON.parse(writes()[0].body)).toEqual({ name: 'Seminar', expectedRevision: 4 })
    expect(screen.getByLabelText('Dataset aktif')).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Menyimpan versi…')).toBeVisible()
    state.data = { ...state.data, currentVersionId: 'C', versions: [{ ...version('C'), name: 'Seminar' }] }
    await act(async () => state.pendingWrite.resolve(Response.json({ datasetId: 'shared', revision: 9, version: { name: 'Seminar' } })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Data aktif: “Seminar”.')).toBeVisible()
    expect(screen.getByText('Versi “Seminar” tersimpan.')).toBeVisible()
    expect(localStorage.getItem('sinergi:revision:shared')).toBe('9')
    expect(saveButton()).toHaveFocus()
    expect(screen.getByLabelText('Dataset aktif')).toBeEnabled()
  })

  it('rejects a whitespace name and reports an already existing checkpoint', async () => {
    await ready(); await openSave()
    fireEvent.change(screen.getByLabelText('Nama versi'), { target: { value: '   ' } })
    fireEvent.submit(document.querySelector('[data-version-form]'))
    expect(screen.getByText('Isi nama versi terlebih dahulu.')).toBeVisible()
    expect(writes()).toHaveLength(0)
    expect(screen.getByLabelText('Nama versi')).toHaveAttribute('maxlength', '180')
    state.existing = true
    fireEvent.change(screen.getByLabelText('Nama versi'), { target: { value: 'Already saved' } })
    fireEvent.submit(document.querySelector('[data-version-form]'))
    expect(await screen.findByText('Keadaan ini sudah tersimpan sebagai “Already saved”.')).toBeVisible()
  })

  it('preserves failed save draft and original revision across a background refresh and retry', async () => {
    await ready(); await openSave()
    fireEvent.change(screen.getByLabelText('Nama versi'), { target: { value: 'Keep draft' } })
    state.data = { ...state.data, revision: 6 }
    await act(async () => window.dispatchEvent(new Event('focus')))
    state.writeFailure = 500
    fireEvent.submit(document.querySelector('[data-version-form]'))
    expect(await screen.findByText('Data berubah; muat ulang.')).toBeVisible()
    expect(screen.getByLabelText('Nama versi')).toHaveValue('Keep draft')
    expect(JSON.parse(writes()[0].body).expectedRevision).toBe(4)
    state.writeFailure = 0
    fireEvent.submit(document.querySelector('[data-version-form]'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(JSON.parse(writes()[1].body).expectedRevision).toBe(4)
  })

  it('confirms restore, uses the revision from opening and updates active state after success', async () => {
    await ready()
    const restore = within(screen.getByText('A', { exact: true }).closest('tr')).getByRole('button', { name: 'Pulihkan' })
    await userEvent.click(restore)
    expect(screen.getByText(/Keadaan sekarang disimpan otomatis/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Batal' })).toHaveFocus()
    expect(writes()).toHaveLength(0)
    await userEvent.keyboard('{Escape}')
    expect(restore).toHaveFocus()
    await userEvent.click(restore)
    state.data = { ...state.data, revision: 6 }
    await act(async () => window.dispatchEvent(new Event('focus')))
    await userEvent.click(screen.getByRole('dialog').querySelector('[type=submit]'))
    expect(await screen.findByText('Data aktif: “A”.')).toBeVisible()
    expect(writes()[0].url).toBe('/api/datasets/shared/versions/A/restore')
    expect(JSON.parse(writes()[0].body)).toEqual({ expectedRevision: 4 })
    expect(screen.getByText('Versi “A” dipulihkan. Peta dan diagram mengikuti revision terbaru.')).toBeVisible()
    expect(saveButton()).toHaveFocus()
  })

  it('closes a revision conflict, refreshes and reopens with the latest revision', async () => {
    await ready(); await openSave()
    state.writeFailure = 409; state.data = { ...state.data, revision: 6 }
    fireEvent.change(screen.getByLabelText('Nama versi'), { target: { value: 'Stale' } })
    fireEvent.submit(document.querySelector('[data-version-form]'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Data berubah; muat ulang.')).toBeVisible()
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await openSave()
    fireEvent.change(screen.getByLabelText('Nama versi'), { target: { value: 'Fresh' } })
    fireEvent.submit(document.querySelector('[data-version-form]'))
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(JSON.parse(writes()[1].body).expectedRevision).toBe(6)
  })

  it('disables stale rows after read failure and allows explicit retry', async () => {
    await ready()
    state.listFailure = 500
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(screen.getByText('Status versi belum diperbarui.')).toBeVisible()
    expect(saveButton()).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Pulihkan' }).every(button => button.disabled)).toBe(true)
    state.listFailure = 0
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(screen.queryByText('Daftar gagal')).not.toBeInTheDocument()
  })

  it('switches dataset, aborts its old request and scopes storage/focus listeners without duplicates', async () => {
    const view = await ready()
    const pending = deferred()
    state.pendingReads.set('/api/datasets/shared/versions', pending)
    fireEvent(window, new Event('focus'))
    const old = reads().at(-1)
    fireEvent.change(screen.getByLabelText('Dataset aktif'), { target: { value: 'other' } })
    expect(await screen.findByText('Data aktif: “B”.')).toBeVisible()
    expect(old.signal.aborted).toBe(true)
    await act(async () => pending.resolve(Response.json({ revision: 99, currentVersionId: null, versions: [version('STALE')] })))
    expect(screen.queryByText('STALE')).not.toBeInTheDocument()
    const count = reads().length
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'sinergi:revision:shared', newValue: '99' })))
    expect(reads()).toHaveLength(count)
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'sinergi:revision:other', newValue: '99' })))
    expect(reads()).toHaveLength(count + 1)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(reads()).toHaveLength(count + 2)
    view.unmount()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new StorageEvent('storage', { key: 'sinergi:revision:other' }))
    expect(reads()).toHaveLength(count + 2)
  })

  it('aborts a write on unmount and never publishes its delayed revision or starts another request', async () => {
    const view = await ready(); await openSave()
    fireEvent.change(screen.getByLabelText('Nama versi'), { target: { value: 'Leaving' } })
    state.pendingWrite = deferred()
    fireEvent.submit(document.querySelector('[data-version-form]'))
    const write = writes()[0], count = state.calls.length
    view.unmount()
    expect(write.signal.aborted).toBe(true)
    await act(async () => state.pendingWrite.resolve(Response.json({ datasetId: 'shared', revision: 99, version: { name: 'Late' } })))
    expect(localStorage.getItem('sinergi:revision:shared')).toBeNull()
    expect(state.calls).toHaveLength(count)
    expect(documentNavigation.replace).not.toHaveBeenCalled()
    expect(document.querySelector('[data-react-overlay]')).toBeNull()
  })

  it('aborts config on pagehide and ignores a delayed response', async () => {
    const pending = deferred()
    fetch.mockImplementation(() => pending.promise)
    mount()
    const signal = fetch.mock.calls.at(-1)[1].signal
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(Response.json({ datasets: state.datasets })))
    expect(reads()).toHaveLength(0)
    expect(screen.queryByLabelText('Dataset aktif')).not.toBeInTheDocument()
  })

  it.each([401, 403])('clears invalid sessions after a write returns %s without further requests', async status => {
    sessionStorage.setItem('sinergiSessionToken', 'token')
    await ready(); await openSave()
    state.writeFailure = status
    fireEvent.change(screen.getByLabelText('Nama versi'), { target: { value: 'Expired' } })
    fireEvent.submit(document.querySelector('[data-version-form]'))
    await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledWith('/'))
    expect(sessionStorage.getItem('sinergiSessionToken')).toBeNull()
    const count = state.calls.length
    window.dispatchEvent(new Event('focus'))
    expect(state.calls).toHaveLength(count)
  })

  it('redirects Viewer before loading configuration or checkpoint data', async () => {
    sessionStorage.setItem('sinergiSessionToken', 'viewer-token')
    render(<StrictMode><VersionsRoute /></StrictMode>)
    await waitFor(() => expect(documentNavigation.replace).toHaveBeenCalledWith('/map'))
    expect(state.calls.some(call => call.url === '/api/import-config' || call.url.endsWith('/versions'))).toBe(false)
  })
})
