import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectSyncPackageType } from '../src/services/topology-sync-service.js'

test('pemilih paket membedakan koreksi, paket awal baru, dan paket awal lama', () => {
  assert.equal(detectSyncPackageType(null), null)
  assert.equal(detectSyncPackageType({ format: 'sinergi-topology-sync-v1-encrypted' },
    'sinergi-koreksi-dv-1.sinergi-sync.json'), 'correction')
  assert.equal(detectSyncPackageType({ format: 'sinergi-topology-bootstrap-v1-encrypted' },
    'paket-dari-rekan.json'), 'bootstrap')
  assert.equal(detectSyncPackageType({ format: 'sinergi-topology-sync-v1-encrypted' },
    'sinergi-awal-dv-1.sinergi-sync.json'), 'bootstrap')
  assert.equal(detectSyncPackageType({ format: 'unknown' }, 'sinergi-awal.json'), 'unknown')
})
