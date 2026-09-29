import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTopologyDropTarget } from '../src/pages/topology/topology-drop-target.js'

const model = {
  nodeById: new Map([['a', { id: 'a', name: 'Kamera' }], ['b', { id: 'b', name: 'JB' }]]),
  adjacency: new Map([['a', []], ['b', []]]),
}
const box = { id: 'frame', kind: 'confirmed', hostId: 'pole', nodeIds: ['b'] }
const resolve = (overrides = {}) => resolveTopologyDropTarget({ sourceId: 'a', model, box, ...overrides })

test('dropping on a device creates a connection instead of moving to its frame', () => {
  assert.equal(resolve({ targetId: 'b' }).kind, 'connect')
  assert.equal(resolve({ targetId: 'b' }).targetId, 'b')
})
test('self and duplicate targets in the same frame never become a frame move', () => {
  assert.equal(resolve({ targetId: 'a' }).kind, 'invalid')
  const connected = { ...model, adjacency: new Map([['a', [{ id: 'b' }]]]) }
  assert.equal(resolve({ targetId: 'b', model: connected, sourceFrameId: 'frame' }).kind, 'invalid')
})
test('dropping on an already connected device in another frame moves to that frame', () => {
  const connected = { ...model, adjacency: new Map([['a', [{ id: 'b' }]]]) }
  assert.equal(resolve({ targetId: 'b', model: connected, sourceFrameId: 'other-frame' }).kind,
    'move')
})
test('empty frame space keeps the placement behavior', () => {
  assert.equal(resolve().kind, 'move')
  assert.equal(resolve({ box: { ...box, kind: 'excluded', hostId: null } }).kind, 'move')
  assert.equal(resolve({ box: null }).kind, 'invalid')
})
test('unavailable device cannot cause an accidental frame move', () => {
  assert.equal(resolve({ targetId: 'missing' }).kind, 'invalid')
})
test('frame drops retain existing placement handling and reject unsupported frames', () => {
  assert.equal(resolve({ box: { ...box, nodeIds: ['a'] } }).kind, 'move')
  assert.equal(resolve({ box: { ...box, kind: 'unresolved' } }).kind, 'invalid')
})
