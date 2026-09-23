import assert from 'node:assert/strict'
import test from 'node:test'
import { createDragAutoPan, dragAutoPanVelocity } from '../src/pages/topology/topology-drag-auto-pan.js'

const rect = { left: 100, top: 100, right: 900, bottom: 700 }
const space = { rect, scrollWidth: 4000, scrollHeight: 3000,
  clientWidth: 800, clientHeight: 600 }

test('dragging near the right edge pans right faster as the pointer approaches it', () => {
  const middle = dragAutoPanVelocity({ ...space, clientX: 820, clientY: 400 })
  const edge = dragAutoPanVelocity({ ...space, clientX: 895, clientY: 400 })
  assert.ok(middle.x > 0)
  assert.ok(edge.x > middle.x)
  assert.equal(edge.y, 0)
  assert.equal(dragAutoPanVelocity({ ...space, clientX: 500, clientY: 400 }).x, 0)
  assert.equal(dragAutoPanVelocity({ ...space, clientX: 895, clientY: 400,
    scrollLeft: 3200 }).x, 0)
})

test('auto pan also supports left and vertical edges but never scrolls outside the canvas', () => {
  const left = dragAutoPanVelocity({ ...space, clientX: 105, clientY: 400, scrollLeft: 500 })
  const up = dragAutoPanVelocity({ ...space, clientX: 500, clientY: 105, scrollTop: 500 })
  assert.ok(left.x < 0)
  assert.ok(up.y < 0)
  assert.deepEqual(dragAutoPanVelocity({ ...space, clientX: 901, clientY: 400 }), { x: 0, y: 0 })
  assert.equal(dragAutoPanVelocity({ ...space, clientX: 105, clientY: 400 }).x, 0)
})

test('stationary drag keeps panning until released and updates the target under the pointer', () => {
  const callbacks = new Map()
  let nextId = 1
  let targetUpdates = 0
  const viewport = { ...space, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => rect }
  const controller = createDragAutoPan(viewport, () => { targetUpdates += 1 }, {
    requestFrame: callback => { const id = nextId++; callbacks.set(id, callback); return id },
    cancelFrame: id => callbacks.delete(id),
  })
  const frame = time => {
    const [id, callback] = callbacks.entries().next().value
    callbacks.delete(id)
    callback(time)
  }
  controller.move({ clientX: 895, clientY: 400 })
  frame(16)
  const first = viewport.scrollLeft
  frame(32)
  assert.ok(viewport.scrollLeft > first)
  assert.equal(targetUpdates, 2)
  controller.stop()
  assert.equal(callbacks.size, 0)
  controller.move({ clientX: 895, clientY: 400 })
  assert.equal(callbacks.size, 0)
})

test('moving away from the edge cancels the pending pan frame', () => {
  const callbacks = new Map()
  const viewport = { ...space, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => rect }
  const controller = createDragAutoPan(viewport, () => {}, {
    requestFrame: callback => { callbacks.set(1, callback); return 1 },
    cancelFrame: id => callbacks.delete(id),
  })
  controller.move({ clientX: 895, clientY: 400 })
  assert.equal(callbacks.size, 1)
  controller.move({ clientX: 500, clientY: 400 })
  assert.equal(callbacks.size, 0)
  controller.stop()
})
