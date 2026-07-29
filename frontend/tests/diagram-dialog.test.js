import assert from 'node:assert/strict'
import test from 'node:test'
import { diagramDialogInternals } from '../src/pages/map/diagram-dialog.js'

test('large diagram state exposes every actionable simplification choice', () => {
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
  assert.match(html, /Buat overview Pengapon/)
  assert.match(html, /Gunakan area peta saat ini/)
  assert.match(html, /Pilih satu jaringan/)
  assert.match(html, /Gunakan jalur tracing/)
  assert.match(html, /Export beberapa halaman/)
})

test('scope selector keeps Pengapon overview and trace while adding network and layer scopes', () => {
  const html = diagramDialogInternals.renderScopeOptions([
    { key: 'network:cctv', label: 'CCTV · 12 aset', group: 'Jaringan' },
    { key: 'layer:floor-1', label: 'Layer · Floor 1', group: 'Area / layer' },
    { key: 'focused-asset-depth-1', label: 'Aset fokus · depth 1' },
  ])

  assert.match(html, /value="overview-pengapon"/)
  assert.match(html, /Peta penuh · Overview Pengapon/)
  assert.match(html, /value="active-trace">Jalur tracing aktif/)
  assert.match(html, /network:cctv/)
  assert.match(html, /layer:floor-1/)
  assert.match(html, /focused-asset-depth-1/)
})

test('selected diagram scope survives rerender state and diagram zoom changes', () => {
  const selected = diagramDialogInternals.reduceDiagramViewState({
    selectedDiagramScope: 'overview-pengapon',
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
