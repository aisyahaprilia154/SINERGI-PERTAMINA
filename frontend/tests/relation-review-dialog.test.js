import assert from 'node:assert/strict'
import test from 'node:test'
import { renderRelationReview } from '../src/pages/map/relation-review-dialog.js'

test('Admin relation review distinguishes pending candidates from confirmed graph data', () => {
  const html = renderRelationReview({
    summary: {
      confirmed: 3,
      inferredPending: 1,
      ambiguous: 2,
      unresolved: 4,
      isolatedAssets: 7,
    },
    candidates: [{
      id: 'topology:SW-01:AP-01',
      sourceAssetId: 'SW-01',
      targetAssetId: 'AP-01',
      sourceName: 'Switch <Core>',
      targetName: 'Access Point 01',
      sourceType: 'Switch',
      targetType: 'Access Point',
      relationType: 'line-endpoint',
      relationSource: 'inferred_endpoint',
      networkId: 'network:lan',
      inferenceMethod: 'inferred_point_on_line',
      chainage: {
        sourceMeters: 10,
        targetMeters: 35.5,
      },
      pathGeometry: { id: 'line-lan-01' },
      distanceMeters: 1.25,
      sourceFolderPath: '/RJBT/FT PENGAPON/LAN/',
    }],
  })

  assert.match(html, /Terkonfirmasi/)
  assert.match(html, /Perlu diperiksa/)
  assert.match(html, /Ambiguous/)
  assert.match(html, /Unresolved/)
  assert.match(html, /Aset terisolasi/)
  assert.match(html, /Switch &lt;Core&gt;/)
  assert.match(html, /line-lan-01/)
  assert.match(html, /point on line/)
  assert.match(html, /10\.00 – 35\.50 meter/)
  assert.match(html, /1\.25 meter/)
  assert.match(html, /Preview peta/)
  assert.match(html, /Konfirmasi/)
  assert.match(html, /Tolak/)
  assert.match(html, /Belum dapat ditentukan/)
})
