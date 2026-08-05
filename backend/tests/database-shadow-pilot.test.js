import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertShadowPilotEqual,
  createPilotScopedShadowRepository,
} from '../scripts/database-shadow-pilot.mjs'

test('shadow pilot list comparison is scoped to the pilot dataset version', async () => {
  const calls = []
  const repository = createPilotScopedShadowRepository({
    async get(id) {
      calls.push(['get', id])
      return { datasetVersion: { id } }
    },
    async list() {
      calls.push(['list'])
      return [
        { datasetVersion: { id: 'dv-pilot-parity' } },
        { datasetVersion: { id: 'live-http-review-evidence' } },
      ]
    },
    async findActive(...args) {
      calls.push(['findActive', ...args])
      return null
    },
    async resolveActiveVersion(...args) {
      calls.push(['resolveActiveVersion', ...args])
      return null
    },
  }, 'dv-pilot-parity')

  assert.deepEqual(await repository.list(), [
    { datasetVersion: { id: 'dv-pilot-parity' } },
  ])
  assert.deepEqual(await repository.get('dv-pilot-parity'), {
    datasetVersion: { id: 'dv-pilot-parity' },
  })
  assert.deepEqual(calls, [
    ['list'],
    ['get', 'dv-pilot-parity'],
  ])
})

test('shadow pilot assertion fails closed when any comparison is unequal', () => {
  assert.deepEqual(assertShadowPilotEqual({ equal: true }), { equal: true })
  assert.throws(
    () => assertShadowPilotEqual({
      comparisonCount: 4,
      equal: false,
      reports: [
        { equal: true, mismatches: [] },
        { equal: false, mismatches: [{ code: 'record_extra_in_shadow' }] },
      ],
    }),
    (error) => error.code === 'shadow_pilot_parity_mismatch'
      && error.details.mismatches.length === 1,
  )
})
