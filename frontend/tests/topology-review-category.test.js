import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isRelationCategoryId,
  RELATION_CATEGORIES,
  relationCategoryForCandidate,
} from '../src/domain/topology-review-category.js'

test('review categories cover cable, asset, and unresolved candidate relationships', () => {
  assert.deepEqual(
    RELATION_CATEGORIES.map(({ id }) => id),
    ['all', 'cable_to_asset', 'asset_to_asset', 'cable_to_cable', 'unresolved', 'other'],
  )
  assert.equal(relationCategoryForCandidate({ candidateType: 'endpoint_device' }), 'cable_to_asset')
  assert.equal(relationCategoryForCandidate({ candidateType: 'inline_device' }), 'cable_to_asset')
  assert.equal(
    relationCategoryForCandidate({ candidateType: 'line_label_attachment' }),
    'cable_to_asset',
  )
  assert.equal(
    relationCategoryForCandidate({ candidateType: 'line_label_connection' }),
    'asset_to_asset',
  )
  assert.equal(relationCategoryForCandidate({ candidateType: 'endpoint_endpoint' }), 'cable_to_cable')
  assert.equal(relationCategoryForCandidate({ candidateType: 'unresolved' }), 'unresolved')
  assert.equal(relationCategoryForCandidate({ candidateType: 'new_relation_type' }), 'other')
})

test('review category ids can be validated before restoring URL state', () => {
  assert.equal(isRelationCategoryId('cable_to_asset'), true)
  assert.equal(isRelationCategoryId('unknown'), false)
  assert.equal(isRelationCategoryId(null), false)
})
