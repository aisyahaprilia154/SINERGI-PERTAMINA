import assert from 'node:assert/strict'
import test from 'node:test'
import { branchNameForFacility } from '../src/domain/facility-branch.js'

test('facility labels resolve to their configured Kantor Cabang city', () => {
  const expected = {
    'Booster Kutawinangun': 'Kebumen',
    'FT Tegal Baru': 'Tegal',
    'DPPU YIA': 'Yogyakarta',
    'FT Pengapon - Semarang': 'Semarang',
    'FT Rewulu': 'Yogyakarta',
    'FT Maos': 'Cilacap',
    'FT Lomanis': 'Cilacap',
    'FT Cilacap': 'Cilacap',
    'ITC LPG Cilacap': 'Cilacap',
    'ITC LPG Cilacapap': 'Cilacap',
  }

  Object.entries(expected).forEach(([facility, branch]) => {
    assert.equal(branchNameForFacility({ name: facility }), branch)
  })
})

test('unknown facility keeps the active branch fallback', () => {
  assert.equal(
    branchNameForFacility({ name: 'Facility Baru' }, 'Kantor Cabang Semarang'),
    'Semarang',
  )
})
