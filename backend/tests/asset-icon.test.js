import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'
import { DatasetVersionLifecycleService } from '../src/import/dataset-version-lifecycle-service.js'
import { decodeAssetIcon } from '../src/domain/asset-icon.js'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII='

test('asset icons reject SVG, malformed files, and dimensions beyond the normalized size', () => {
  assert.ok(decodeAssetIcon(png).length > 45)
  for (const data of [undefined, 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,YWJj']) {
    assert.throws(() => decodeAssetIcon(data), { code: 'invalid_asset_icon' })
  }
  const large = decodeAssetIcon(png)
  large.writeUInt32BE(100000, 16)
  assert.throws(() => decodeAssetIcon(`data:image/png;base64,${large.toString('base64')}`), { code: 'invalid_asset_icon' })
})

test('upload, authenticated resource, reload, and reset persist without changing network data', async t => {
  const fixture = await createFixture(t)
  const { origin, repository } = fixture
  const original = await repository.get('version-icons')
  const request = async (method, expectedRecordRevision, dataUrl) => fetch(
    `${origin}/api/datasets/dataset-icons/active/assets/CAM-01/icon`, {
      method, headers: { authorization: 'Bearer viewer', 'content-type': 'application/json' },
      body: JSON.stringify({ branchId: 'semarang', datasetVersionId: 'version-icons', expectedRecordRevision, dataUrl }),
    },
  )
  const uploaded = await request('PUT', 0, png)
  assert.equal(uploaded.status, 200)
  const result = await uploaded.json()
  assert.equal(result.iconReset, false)
  assert.equal(result.recordRevision, 1)
  const icon = await fetch(`${origin}${result.customIconUrl}`, { headers: { authorization: 'Bearer viewer' } })
  assert.equal(icon.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await icon.arrayBuffer()), decodeAssetIcon(png))
  const denied = await fetch(`${origin}${result.customIconUrl}`, { headers: { authorization: 'Bearer other' } })
  assert.equal(denied.status, 403)
  assert.equal((await request('PUT', 0, png)).status, 409)
  assert.equal((await request('PUT', 1)).status, 400)
  const reloaded = new DatasetVersionLifecycleService({ repository, auditLog: fixture.auditLog })
  const map = await reloaded.getActiveMapDataset({ datasetId: 'dataset-icons', branchId: 'semarang' })
  assert.equal(map.assets[0].customIconUrl, result.customIconUrl)
  const topology = await reloaded.getActiveTopologyDataset({ datasetId: 'dataset-icons', branchId: 'semarang' })
  assert.equal(topology.assets[0].customIconUrl, result.customIconUrl)
  const detail = await reloaded.getActiveAssetDetail({ datasetId: 'dataset-icons', branchId: 'semarang', assetId: 'CAM-01' })
  assert.equal(detail.asset.customIconUrl, result.customIconUrl)
  const reset = await request('DELETE', 1)
  assert.equal(reset.status, 200)
  assert.deepEqual(await reset.json(), { assetId: 'CAM-01', recordRevision: 2, customIconUrl: null, iconReset: true })
  const freshMap = await fixture.service.getActiveMapDataset({ datasetId: 'dataset-icons', branchId: 'semarang' })
  assert.equal(freshMap.assets[0].iconReset, true)
  assert.equal(freshMap.assets[0].customIconUrl, null)
  assert.equal((await fetch(`${origin}${result.customIconUrl}`, { headers: { authorization: 'Bearer viewer' } })).status, 404)
  const stored = await repository.get('version-icons')
  for (const key of ['assets', 'geometries', 'relations', 'topologyGraph']) assert.deepEqual(stored[key], original[key])
  assert.deepEqual(fixture.auditEntries.map(e => e.event).filter(e => e.startsWith('asset.')), ['asset.icon_updated', 'asset.icon_reset'])
})

test('icon edits reject a different active version and assets outside the dataset', async t => {
  const { service, repository } = await createFixture(t)
  const context = { datasetId: 'dataset-icons', branchId: 'semarang', assetId: 'CAM-01',
    datasetVersionId: 'old-version', expectedRecordRevision: 0, dataUrl: png, actorId: 'viewer' }
  await assert.rejects(service.setActiveAssetIcon(context), { code: 'asset_icon_active_version_changed' })
  await assert.rejects(service.setActiveAssetIcon({ ...context, datasetVersionId: 'version-icons', assetId: 'missing' }), { code: 'asset_not_present_in_active_version' })
  assert.equal((await repository.get('version-icons')).assetIconOverrides, undefined)
})

test('PostgreSQL icon updates patch only icon overrides and retain all source projections', async () => {
  const current = record()
  const commands = []
  const client = { release() {}, async query(sql, values) {
    commands.push({ sql, values })
    if (sql.includes('SELECT payload')) return { rows: [{ payload: current }] }
    return { rows: [] }
  } }
  const repository = new PostgresDatasetVersionRepository({ query: client.query, connect: async () => client })
  const overrides = { 'CAM-01': { dataUrl: png, revision: 'new' } }
  const updated = await repository.update('version-icons', draft => ({ ...draft, assetIconOverrides: overrides }),
    { expectedRevision: 0, projectionMode: 'asset-icons' })
  assert.equal(updated.recordRevision, 1)
  const patch = commands.find(command => command.sql.startsWith('UPDATE dataset_versions'))
  assert.deepEqual(JSON.parse(patch.values[1]), { recordRevision: 1, assetIconOverrides: overrides })
  assert.equal(commands.some(command => /DELETE FROM|INSERT INTO (?!dataset_version_active_reads)/.test(command.sql)), false)
  const readModel = commands.find(command => command.sql.includes('INSERT INTO dataset_version_active_reads'))
  assert.deepEqual(JSON.parse(readModel.values[2]).assetIconOverrides, overrides)
  assert.equal(commands.at(-1).sql, 'COMMIT')
})

function record() {
  return { datasetVersion: { id: 'version-icons', datasetId: 'dataset-icons', branchId: 'semarang',
    status: 'active', publicationStatus: 'published', publicationProfile: 'map_only', validationStatus: 'valid' },
    recordRevision: 0, layers: [{ id: 'layer', name: 'CCTV' }],
    assets: [{ id: 'node-cam', assetId: 'CAM-01', name: 'Kamera Gerbang', type: 'CCTV', category: 'CCTV',
      layerId: 'layer', branchId: 'semarang', properties: { sourceFeatureId: 'source-cam' } }],
    geometries: [{ id: 'point', assetNodeId: 'node-cam', geometryType: 'point', coordinates: [110, -7] }],
    relations: [], topologyGraph: { nodes: [], edges: [] } }
}

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-icons-'))
  const repository = new JsonDatasetVersionRepository(root)
  await repository.create(record())
  const auditEntries = []
  const auditLog = { record: async (event, entry) => { auditEntries.push({ event, ...entry }) } }
  const service = new DatasetVersionLifecycleService({ repository, auditLog })
  const app = createApp({ config: {}, repository, lifecycleService: service, auditLog,
    authenticator: { authenticate: request => ({ id: 'viewer', role: 'Viewer', permissions: [], datasetIds: [],
      branchIds: request.headers.authorization === 'Bearer other' ? ['other'] : ['semarang'] }) } })
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve))
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); await rm(root, { recursive: true, force: true }) })
  return { repository, service, auditLog, auditEntries, origin: `http://127.0.0.1:${app.address().port}` }
}
