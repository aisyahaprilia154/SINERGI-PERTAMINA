import assert from 'node:assert/strict'
import test from 'node:test'
import { isJunctionBoxAsset, JUNCTION_BOX_ICON_URL } from '../src/domain/junction-box-icon.js'

test('the shared Junction Box icon applies to JB assets in both map and diagram models', () => {
  assert.equal(JUNCTION_BOX_ICON_URL, '/icons/junction-box.png')
  assert.equal(isJunctionBoxAsset({ type: 'Junction box', name: 'JB-012' }), true)
  assert.equal(isJunctionBoxAsset({ diagramClass: 'junction-peer' }), true)
  assert.equal(isJunctionBoxAsset({ iconType: 'junction-box' }), true)
  assert.equal(isJunctionBoxAsset({ name: 'JB-12.1' }), true)
  assert.equal(isJunctionBoxAsset({ type: 'Server rack', name: 'JB-Rack Server' }), false)
  assert.equal(isJunctionBoxAsset({ type: 'CCTV', name: 'C-012' }), false)
})
