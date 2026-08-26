import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveCanonicalTopologySemantics,
  parseJunctionFamilyIdentity,
} from '../src/domain/parser-contract.js'

test('bare Server remains a root even inside a Junction Box folder', () => {
  const semantics = deriveCanonicalTopologySemantics({
    objectRole: 'device_node',
    canonicalAssetType: 'server_rack',
    assetType: 'server rack',
    sourceName: 'Server',
    sourceFolderPath: '/RJBT/Booster Kutawinangun/Junction Box',
    diagramClass: 'rack-root',
    classificationSource: 'name',
    classificationConfidence: 0.6,
  })

  assert.equal(semantics.topologyRole, 'root')
  assert.equal(semantics.connectivityExpectation, 'required')
  assert.equal(semantics.classificationSource, 'name')
})

test('JB family parser supports decorated parent and child labels', () => {
  assert.deepEqual(parseJunctionFamilyIdentity('JB-CCTV-13.1-WP'), {
    namespace: 'cctv',
    baseNumber: '13',
    childIndex: 1,
    expansion: true,
    qualifier: 'wp',
  })
  assert.deepEqual(parseJunctionFamilyIdentity('JB05.1'), {
    namespace: null,
    baseNumber: '5',
    childIndex: 1,
    expansion: true,
    qualifier: null,
  })
  assert.deepEqual(parseJunctionFamilyIdentity('JB-005+Ek 8U-EXP'), {
    namespace: null,
    baseNumber: '5',
    childIndex: null,
    expansion: true,
    qualifier: 'exp',
  })
})
