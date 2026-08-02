import assert from 'node:assert/strict'
import test from 'node:test'
import { diagramDialogInternals } from '../src/pages/map/diagram-dialog.js'

test('large confirmed scope directs the user to a smaller relation scope', () => {
  const html = diagramDialogInternals.renderDiagramState({
    status: 'scope-required',
    nodeCount: 1376,
    message: '1376 aset ditemukan. Pilih cara penyederhanaan diagram.',
  }, [{
    key: 'network:cctv',
    label: 'CCTV',
    group: 'Jaringan',
  }])

  assert.match(html, /1376 aset ditemukan\. Pilih cara penyederhanaan diagram\./)
  assert.match(html, /Pilih satu jaringan/)
  assert.match(html, /Gunakan jalur tracing/)
  assert.match(html, /Pilih aset fokus/)
  assert.doesNotMatch(html, /Export beberapa halaman|area peta saat ini/i)
})

test('scope selector only renders relation-valid choices provided by the page', () => {
  const html = diagramDialogInternals.renderScopeOptions([
    { key: 'active-trace', label: 'Jalur tracing aktif' },
    { key: 'network:cctv', label: 'CCTV · 12 aset', group: 'Jaringan' },
    { key: 'focused-asset-depth-1', label: 'Aset fokus · depth 1' },
  ])

  assert.match(html, /value="active-trace"[\s\S]*Jalur tracing aktif/)
  assert.match(html, /network:cctv/)
  assert.match(html, /focused-asset-depth-1/)
  assert.doesNotMatch(html, /overview-pengapon|current-viewport|multi-page/)
})

test('zero-edge scope shows the approved empty state and Admin review action', () => {
  const html = diagramDialogInternals.renderDiagramState({
    status: 'relation-unavailable',
    nodeCount: 22,
    message: '22 aset ditemukan, tetapi belum ada relasi yang telah dikonfirmasi.',
  }, [], { isAdministrator: true })

  assert.match(html, /Diagram koneksi belum tersedia/)
  assert.match(html, /22 aset ditemukan, tetapi belum ada relasi yang telah dikonfirmasi/)
  assert.match(html, /Lihat aset di peta/)
  assert.match(html, /Pilih aset lain/)
  assert.match(html, /Periksa relasi/)
  assert.equal(
    diagramDialogInternals.isDiagramExportEnabled(
      { status: 'relation-unavailable', edges: [] },
      { status: 'empty' },
    ),
    false,
  )
})

test('selected diagram scope survives rerender state and diagram zoom changes', () => {
  const selected = diagramDialogInternals.reduceDiagramViewState({
    selectedDiagramScope: 'focused-asset-depth-1',
    zoom: 1,
  }, {
    type: 'select-scope',
    scope: 'network:network:fiber-optic',
  })
  const zoomed = diagramDialogInternals.reduceDiagramViewState(selected, {
    type: 'set-zoom',
    zoom: 1.4,
  })
  const rerendered = diagramDialogInternals.reduceDiagramViewState(zoomed, {
    type: 'rerender',
  })

  assert.equal(zoomed.selectedDiagramScope, 'network:network:fiber-optic')
  assert.equal(rerendered.selectedDiagramScope, 'network:network:fiber-optic')
  assert.equal(rerendered.zoom, 1.4)
})

test('pending topology preview is renderable but cannot be exported', () => {
  const graph = {
    status: 'ready',
    edges: [{ relationStatus: 'inferred_pending' }],
    isDiagnosticPreview: true,
    pendingEdgeCount: 1,
  }
  const layout = { status: 'ready' }

  assert.equal(
    diagramDialogInternals.isDiagramRenderable(graph, layout),
    true,
  )
  assert.equal(
    diagramDialogInternals.isDiagramExportEnabled(graph, layout),
    false,
  )
})

test('inventory-only CCTV scope is visible but never exportable as a connection diagram', () => {
  const graph = {
    status: 'ready',
    nodes: [{ id: 'camera-1' }, { id: 'camera-2' }],
    edges: [],
    isDiagnosticPreview: true,
    isInventoryPreview: true,
    pendingEdgeCount: 0,
  }
  const layout = { status: 'ready' }

  assert.equal(diagramDialogInternals.isDiagramRenderable(graph, layout), true)
  assert.equal(diagramDialogInternals.isDiagramExportEnabled(graph, layout), false)
})
