import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeSearchText,
  searchMatchScore,
} from '../src/domain/search-normalization.js'

test('normalizes asset search separators, case, and diacritics', () => {
  assert.equal(normalizeSearchText('  JB—015 / Kamera Á  '), 'jb 015 kamera a')
  assert.ok(searchMatchScore(['JB-015'], 'jb 15') > 0)
  assert.ok(searchMatchScore(['C-015'], 'c015') > 0)
})

test('allows a small typo while keeping unrelated values out', () => {
  assert.ok(searchMatchScore(['JB-015'], 'JB-016') > 0)
  assert.equal(searchMatchScore(['JB-015'], 'router-99'), 0)
})
