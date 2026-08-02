import assert from 'node:assert/strict'
import test from 'node:test'
import { createLeafletBasemapManager } from '../src/pages/map/leaflet-basemap.js'

const PROVIDERS = [{
  id: 'primary',
  name: 'Primary',
  url: 'https://primary.test/{z}/{x}/{y}.png',
  attribution: 'Primary',
  maxNativeZoom: 20,
}, {
  id: 'fallback-1',
  name: 'Fallback 1',
  url: 'https://fallback-1.test/{z}/{x}/{y}.png',
  attribution: 'Fallback 1',
  maxNativeZoom: 20,
}, {
  id: 'fallback-2',
  name: 'Fallback 2',
  url: 'https://fallback-2.test/{z}/{x}/{y}.png',
  attribution: 'Fallback 2',
  maxNativeZoom: 19,
}]

test('primary basemap remains active after a successful tile batch', () => {
  const harness = createHarness()
  const manager = harness.createManager()

  harness.layers[0].fire('loading')
  harness.layers[0].fire('tileloadstart')
  harness.layers[0].fire('tileload')
  harness.layers[0].fire('load')

  assert.equal(manager.activeProvider.id, 'primary')
  assert.equal(harness.layers.length, 1)
  assert.equal(harness.statuses.at(-1).status, 'ready')
  assert.equal(harness.mapLayers.has(harness.layers[0]), true)
})

test('all failed primary tiles activate the next basemap automatically', () => {
  const harness = createHarness()
  const manager = harness.createManager()

  failCurrentLayer(harness)

  assert.equal(manager.activeProvider.id, 'fallback-1')
  assert.equal(harness.layers.length, 2)
  assert.equal(harness.mapLayers.has(harness.layers[0]), false)
  assert.equal(harness.mapLayers.has(harness.layers[1]), true)
  assert.equal(harness.statuses.at(-1).status, 'fallback-loading')
})

test('fallback chain reaches OpenStreetMap after two provider failures', () => {
  const harness = createHarness()
  const manager = harness.createManager()

  failCurrentLayer(harness)
  failCurrentLayer(harness)
  succeedCurrentLayer(harness)

  assert.equal(manager.activeProvider.id, 'fallback-2')
  assert.equal(harness.layers.length, 3)
  assert.equal(harness.statuses.at(-1).status, 'ready')
})

test('error state appears only after every basemap provider fails', () => {
  const harness = createHarness()
  const manager = harness.createManager()

  failCurrentLayer(harness)
  failCurrentLayer(harness)
  failCurrentLayer(harness)

  assert.equal(manager.activeProvider, null)
  assert.equal(manager.activeLayer, null)
  assert.equal(harness.statuses.at(-1).status, 'error')
  assert.equal(harness.statuses.at(-1).providerCount, 3)
})

test('provider timeout advances to fallback when no tile succeeds', () => {
  const harness = createHarness()
  const manager = harness.createManager()
  harness.layers[0].fire('loading')

  harness.runLatestTimer()

  assert.equal(manager.activeProvider.id, 'fallback-1')
  assert.equal(harness.layers.length, 2)
  assert.equal(harness.statuses.at(-1).status, 'fallback-loading')
})

test('destroy removes tile layer and suppresses later status updates', () => {
  const harness = createHarness()
  const manager = harness.createManager()
  const statusCount = harness.statuses.length

  manager.destroy()
  harness.runLatestTimer()

  assert.equal(manager.activeProvider, null)
  assert.equal(manager.activeLayer, null)
  assert.equal(harness.mapLayers.size, 0)
  assert.equal(harness.statuses.length, statusCount)
})

test('provider group can switch from light to satellite without retaining old tiles', () => {
  const harness = createHarness()
  const manager = harness.createManager()
  const previousLayer = manager.activeLayer

  const switched = manager.setProviders([{
    id: 'satellite',
    name: 'Satellite',
    url: 'https://satellite.test/{z}/{x}/{y}.png',
    attribution: 'Satellite',
    maxNativeZoom: 19,
  }])

  assert.equal(switched, true)
  assert.equal(manager.activeProvider.id, 'satellite')
  assert.equal(harness.mapLayers.has(previousLayer), false)
  assert.equal(harness.mapLayers.has(manager.activeLayer), true)
  assert.equal(harness.statuses.at(-1).providerCount, 1)
})

function createHarness() {
  const layers = []
  const mapLayers = new Set()
  const statuses = []
  const timers = []
  const leaflet = {
    tileLayer(url, options) {
      const listeners = new Map()
      const layer = {
        url,
        options,
        on(name, handler) {
          listeners.set(name, handler)
          return layer
        },
        off() {
          listeners.clear()
          return layer
        },
        addTo() {
          mapLayers.add(layer)
          return layer
        },
        fire(name) {
          listeners.get(name)?.()
        },
      }
      layers.push(layer)
      return layer
    },
  }
  const map = {
    hasLayer(layer) {
      return mapLayers.has(layer)
    },
    removeLayer(layer) {
      mapLayers.delete(layer)
    },
  }

  return {
    layers,
    mapLayers,
    statuses,
    createManager() {
      return createLeafletBasemapManager(leaflet, map, {
        providers: PROVIDERS,
        timeoutMs: 100,
        onStatus: (status) => statuses.push(status),
        setTimer(callback) {
          timers.push(callback)
          return timers.length
        },
        clearTimer(id) {
          timers[id - 1] = null
        },
      })
    },
    runLatestTimer() {
      const callback = timers.findLast((timer) => typeof timer === 'function')
      callback?.()
    },
  }
}

function failCurrentLayer(harness) {
  const layer = harness.layers.at(-1)
  layer.fire('loading')
  layer.fire('tileloadstart')
  layer.fire('tileerror')
  layer.fire('load')
}

function succeedCurrentLayer(harness) {
  const layer = harness.layers.at(-1)
  layer.fire('loading')
  layer.fire('tileloadstart')
  layer.fire('tileload')
  layer.fire('load')
}
