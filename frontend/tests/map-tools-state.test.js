import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateMapSafeArea,
  createTracingState,
  getTraceInstruction,
  reduceTracingState,
} from '../src/pages/map/map-tools-state.js'
import { renderNetworkMapSurface } from '../src/pages/map/map-surface.js'

test('tracing state machine follows the approved states and instruction copy', () => {
  let state = reduceTracingState(createTracingState(), { type: 'select-start' })
  assert.equal(state.status, 'selecting_start')
  assert.deepEqual(getTraceInstruction(state), {
    step: '1',
    icon: null,
    title: 'Pilih titik awal',
    description: 'Klik aset pada peta untuk memulai tracing.',
  })

  state = reduceTracingState(state, {
    type: 'start-selected',
    assetId: 'SW-01',
    candidates: [{ assetId: 'NVR-01', distance: 1 }],
  })
  assert.equal(state.status, 'selecting_end')
  assert.equal(getTraceInstruction(state).description, 'Klik aset tujuan pada jaringan yang sama.')

  state = reduceTracingState(state, { type: 'calculate', assetId: 'NVR-01' })
  assert.equal(state.status, 'calculating')
  assert.equal(getTraceInstruction(state).title, 'Mencari jalur')

  state = reduceTracingState(state, {
    type: 'result',
    path: ['SW-01', 'NVR-01'],
    relations: [{ id: 'edge-1' }],
  })
  assert.equal(state.status, 'result')
  assert.match(getTraceInstruction(state).description, /2 aset/)
  assert.equal(reduceTracingState(state, { type: 'reset' }).status, 'idle')
})

test('asset without confirmed adjacency uses the unavailable tracing state', () => {
  const emptyStart = reduceTracingState(createTracingState(), {
    type: 'start-selected',
    assetId: 'ISOLATED-01',
    candidates: [],
  })
  assert.equal(emptyStart.status, 'unavailable')
  assert.equal(getTraceInstruction(emptyStart).title, 'Tracing belum tersedia')

  const unreachable = reduceTracingState(emptyStart, {
    type: 'no-path',
    message: 'Tidak tersambung.',
  })
  assert.equal(unreachable.status, 'no_path')
  assert.equal(unreachable.error, 'Tidak tersambung.')
})

test('safe area stays inside map stage with desktop drawer and floating tools', () => {
  const stageRect = {
    top: 64,
    bottom: 768,
    width: 1000,
    height: 704,
  }
  const safeArea = calculateMapSafeArea({
    stageRect,
    contextRect: { bottom: 132 },
    toolbarRect: { bottom: 120 },
    bottomToolsRect: { top: 690 },
    drawerRect: { width: 400, height: 650 },
    drawerOpen: true,
  })

  assert.deepEqual(safeArea, {
    left: 16,
    right: 416,
    top: 84,
    bottom: 94,
  })
  assert.ok(safeArea.left + safeArea.right < stageRect.width)
})

test('compact drawer contributes to bottom safe area and mobile sidebar to left inset', () => {
  const safeArea = calculateMapSafeArea({
    stageRect: { top: 64, bottom: 700, width: 600, height: 636 },
    contextRect: { bottom: 170 },
    toolbarRect: { bottom: 116 },
    bottomToolsRect: { top: 620 },
    sidebarRect: { width: 320 },
    drawerRect: { height: 280 },
    sidebarOpen: true,
    drawerOpen: true,
    compactPanels: true,
  })

  assert.equal(safeArea.left, 336)
  assert.equal(safeArea.right, 16)
  assert.equal(safeArea.top, 122)
  assert.equal(safeArea.bottom, 296)
})

test('map surface exposes a single accessible tracing instruction overlay', () => {
  const html = renderNetworkMapSurface({
    version: 'v12',
    branchName: 'Pengapon',
    siteScopeName: 'Pengapon',
  })

  assert.equal((html.match(/class="trace-banner"/g) || []).length, 1)
  assert.match(html, /class="trace-description"/)
  assert.match(html, /aria-label="Mulai tracing jaringan"/)
})
