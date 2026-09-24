import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import { ImportFileStore } from '../src/storage/file-store.js'
import { TopologySyncService } from '../src/topology/topology-sync-service.js'
import { DatasetVersionLifecycleService } from '../src/import/dataset-version-lifecycle-service.js'
import {
  correctionState,
  createCorrectionPackage,
  decryptSyncPackage,
  diagramChangesFromPreview,
  encryptSyncPackage,
  initializeSyncRecord,
  previewCorrectionPackage,
} from '../src/topology/topology-sync.js'

function baseline() {
  return initializeSyncRecord({
    datasetVersion: {
      id: 'dv-shared', datasetId: 'dataset-a', branchId: 'branch-a',
      checksum: 'sha256:source',
    },
    recordRevision: 1,
    mountingOverrides: [],
    topologyFrameAssignments: {},
    topologyFrameNames: {},
    topologyFrames: {},
    topologyEdgeOverrides: [],
    topologyInputBundle: { explicitRelations: [] },
  }, 'shared-sync-id')
}

test('koreksi berbeda dari kedua laptop bergabung dan ekspor ulang tidak menggandakan', () => {
  const shared = baseline()
  const alice = structuredClone(shared)
  alice.mountingOverrides = [{ assetId: 'JB-001', targetAssetId: 'T-002', action: 'assign' }]
  const bob = structuredClone(shared)
  bob.topologyFrameNames = { 'T-004': 'Tiang halaman' }

  const alicePackage = createCorrectionPackage(alice)
  const previewOnBob = previewCorrectionPackage(bob, alicePackage)
  assert.equal(previewOnBob.summary.ready, 1)
  assert.deepEqual(diagramChangesFromPreview(previewOnBob).changes, [
    { type: 'mount', assetId: 'JB-001', poleAssetId: 'T-002', action: 'assign' },
  ])
  bob.mountingOverrides = structuredClone(alice.mountingOverrides)
  assert.equal(previewCorrectionPackage(bob, alicePackage).summary.alreadyApplied, 1)
  assert.equal(createCorrectionPackage(bob).changes.length, 2)
})

test('edit aset sama menghasilkan konflik dan butuh pilihan manusia', () => {
  const shared = baseline()
  const alice = structuredClone(shared)
  alice.mountingOverrides = [{ assetId: 'JB-001', targetAssetId: 'T-002', action: 'assign' }]
  const bob = structuredClone(shared)
  bob.mountingOverrides = [{ assetId: 'JB-001', targetAssetId: 'T-004', action: 'assign' }]
  const preview = previewCorrectionPackage(bob, createCorrectionPackage(alice))
  assert.equal(preview.summary.conflict, 1)
  assert.throws(() => diagramChangesFromPreview(preview), /Selesaikan semua konflik/)
  const choice = { [preview.changes[0].id]: 'remote' }
  assert.equal(diagramChangesFromPreview(preview, choice).changes[0].poleAssetId, 'T-002')
})

test('paket terenkripsi mendeteksi sandi salah dan sumber berbeda', () => {
  const shared = baseline()
  const sender = structuredClone(shared)
  sender.topologyFrameAssignments = { 'JB-001': 'pole-group:T-002' }
  const sealed = encryptSyncPackage(createCorrectionPackage(sender), 'sandi-rahasia-panjang')
  assert.equal(decryptSyncPackage(sealed, 'sandi-rahasia-panjang').changes.length, 1)
  assert.throws(() => decryptSyncPackage(sealed, 'sandi-yang-salah-panjang'), /sandi salah/)
  const other = baseline()
  other.topologySync.source.sourceChecksum = 'sha256:other'
  assert.throws(() => previewCorrectionPackage(other,
    decryptSyncPackage(sealed, 'sandi-rahasia-panjang')), /berbeda/)
  assert.deepEqual(correctionState(shared), {})
})

test('impor membuat frame sebelum memindahkan aset ke dalamnya', () => {
  const shared = baseline()
  const sender = structuredClone(shared)
  sender.topologyFrames = { 'frame-baru': {
    id: 'frame-baru', type: 'indoor', areaKey: 'site-1', name: 'Ruang kontrol',
  } }
  sender.topologyFrameAssignments = { 'JB-001': 'frame-baru' }
  const preview = previewCorrectionPackage(shared, createCorrectionPackage(sender))
  assert.deepEqual(diagramChangesFromPreview(preview).changes.map(change => change.type),
    ['create-frame', 'move-frame'])
})

test('banyak koreksi terbagi menjadi paket atomik tanpa kehilangan perubahan', () => {
  const shared = baseline()
  const sender = structuredClone(shared)
  sender.topologyFrameNames = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [
    `POLE-${i}`, `Tiang ${i}`,
  ]))
  const first = createCorrectionPackage(sender)
  const second = createCorrectionPackage(sender, { offset: first.nextOffset })
  assert.equal(first.totalChanges, 205)
  assert.equal(first.changes.length, 200)
  assert.equal(second.changes.length, 5)
  assert.equal(second.nextOffset, null)
  assert.equal(previewCorrectionPackage(shared, second).summary.ready, 5)
})

test('paket awal membawa record dan sumber asli ke instalasi kosong', async t => {
  const fromRoot = await mkdtemp(path.join(tmpdir(), 'sinergi-sync-from-'))
  const toRoot = await mkdtemp(path.join(tmpdir(), 'sinergi-sync-to-'))
  t.after(() => Promise.all([fromRoot, toRoot].map(root => rm(root, {
    recursive: true, force: true,
  }))))
  const fromStore = new ImportFileStore(fromRoot)
  const toStore = new ImportFileStore(toRoot)
  const fromRepo = new JsonDatasetVersionRepository(path.join(fromRoot, 'dataset-versions'))
  const toRepo = new JsonDatasetVersionRepository(path.join(toRoot, 'dataset-versions'))
  const source = Buffer.from('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>')
  const temp = await fromStore.createTemporaryUpload()
  await writeFile(temp, source)
  const stored = await fromStore.commitOriginal(temp, 'dv-shared', '.kml')
  const record = baseline()
  record.datasetVersion.sourceFilename = 'shared.kml'
  record.datasetVersion.sourceSize = source.length
  record.datasetVersion.checksum = `sha256:${createHash('sha256').update(source).digest('hex')}`
  record.datasetVersion.sourceStorageKey = stored.storageKey
  record.topologySync.source = {
    datasetVersionId: 'dv-shared', datasetId: 'dataset-a', branchId: 'branch-a',
    sourceChecksum: record.datasetVersion.checksum,
  }
  await fromRepo.create(record)
  const from = new TopologySyncService({ repository: fromRepo, fileStore: fromStore })
  const to = new TopologySyncService({ repository: toRepo, fileStore: toStore })
  const passphrase = 'sandi-paket-awal-tim'
  const envelope = await from.exportBootstrap('dv-shared', passphrase)
  const invalid = decryptSyncPackage(envelope, passphrase)
  invalid.record.topologySync.baselineHash = '0'.repeat(64)
  await assert.rejects(to.importBootstrap('bob',
    encryptSyncPackage(invalid, passphrase), passphrase), {
    code: 'topology_sync_invalid_package',
  })
  const occupiedRepo = new JsonDatasetVersionRepository(path.join(toRoot, 'occupied'))
  await occupiedRepo.create({ datasetVersion: {
    id: 'dv-other', datasetId: 'dataset-a', branchId: 'branch-a',
    publicationStatus: 'unpublished', status: 'valid',
  } })
  await assert.rejects(new TopologySyncService({ repository: occupiedRepo,
    fileStore: toStore }).importBootstrap('bob', envelope, passphrase), {
    code: 'topology_sync_baseline_exists',
  })
  const imported = await to.importBootstrap('bob', envelope, passphrase)
  assert.equal(imported.status, 'staged')
  const saved = await toRepo.get('dv-shared')
  assert.equal(saved.topologySync.id, record.topologySync.id)
  assert.equal(saved.datasetVersion.status, 'valid')
  assert.equal((await toStore.readVerifiedOriginal({
    storageKey: saved.datasetVersion.sourceStorageKey,
    expectedSize: source.length,
    expectedChecksum: record.datasetVersion.checksum,
  })).bytes.toString(), source.toString())
  await assert.rejects(to.importBootstrap('bob', envelope, passphrase), {
    code: 'topology_sync_baseline_exists',
  })
})

test('paket awal hasil import dapat diaktifkan sebagai dataset lokal', async t => {
  const fromRoot = await mkdtemp(path.join(tmpdir(), 'sinergi-bootstrap-activation-from-'))
  const toRoot = await mkdtemp(path.join(tmpdir(), 'sinergi-bootstrap-activation-to-'))
  t.after(() => Promise.all([fromRoot, toRoot].map(root => rm(root, {
    recursive: true, force: true,
  }))))
  const fixture = JSON.parse(await readFile(new URL('./fixtures/dataset-version-pilot.json', import.meta.url)))
  const bytes = Buffer.from('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>')
  const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  fixture.datasetVersion.sourceSize = bytes.length
  fixture.datasetVersion.checksum = checksum
  fixture.sourceChecksum = checksum
  const fromStore = new ImportFileStore(fromRoot)
  const temp = await fromStore.createTemporaryUpload()
  await writeFile(temp, bytes)
  fixture.datasetVersion.sourceStorageKey = (await fromStore.commitOriginal(
    temp, fixture.datasetVersion.id, '.kml',
  )).storageKey
  const sourceRecord = initializeSyncRecord(fixture, 'pilot-sync-id')
  const fromRepo = new JsonDatasetVersionRepository(path.join(fromRoot, 'dataset-versions'))
  await fromRepo.create(sourceRecord)
  const toRepo = new JsonDatasetVersionRepository(path.join(toRoot, 'dataset-versions'))
  const from = new TopologySyncService({ repository: fromRepo, fileStore: fromStore })
  const to = new TopologySyncService({ repository: toRepo,
    fileStore: new ImportFileStore(toRoot) })
  const envelope = await from.exportBootstrap(fixture.datasetVersion.id, 'sandi-awal-untuk-tim')
  await to.importBootstrap('bob', envelope, 'sandi-awal-untuk-tim')
  const lifecycleService = new DatasetVersionLifecycleService({ repository: toRepo,
    auditLog: { record: async () => ({ id: 'audit' }) } })
  await lifecycleService.activate(fixture.datasetVersion.id, 'bob', {
    expectedActiveVersionId: null, publicationProfile: 'map_only',
  })
  assert.equal((await toRepo.findActive('dataset-pilot', { branchId: 'pilot' }))
    .topologySync.id, 'pilot-sync-id')
})

test('draft tidak terlihat umum sebelum ditinjau dan publikasi dapat dibalik', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'sinergi-sync-draft-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repository = new JsonDatasetVersionRepository(path.join(root, 'dataset-versions'))
  const fixture = JSON.parse(await readFile(new URL('./fixtures/dataset-version-pilot.json', import.meta.url)))
  await repository.create(fixture)
  const auditLog = { record: async () => ({ id: 'audit-test' }) }
  const lifecycleService = new DatasetVersionLifecycleService({ repository, auditLog })
  await lifecycleService.activate('dv-pilot-parity', 'admin', {
    publicationProfile: 'map_only', expectedActiveVersionId: null,
  })
  const activeBefore = await repository.findActive('dataset-pilot', { branchId: 'pilot' })
  const sync = new TopologySyncService({ repository, auditLog, lifecycleService })
  await sync.initialize('dv-pilot-parity', 'admin', activeBefore.recordRevision)
  const draft = await sync.createDraft('dv-pilot-parity', 'editor')
  const draftView = await lifecycleService.getDraftTopologyDataset(draft.datasetVersionId)
  assert.equal(draftView.draft, true)
  assert.equal(draftView.context.datasetVersionId, draft.datasetVersionId)
  await repository.update(draft.datasetVersionId, record => ({
    ...record, topologyFrameNames: { 'SW-PILOT-A': 'Frame hasil koreksi' },
  }))
  assert.equal((await repository.findActive('dataset-pilot', { branchId: 'pilot' }))
    .datasetVersion.id, 'dv-pilot-parity')
  const review = await sync.reviewDraft(draft.datasetVersionId)
  assert.equal(review.changes.length, 1)
  await sync.publishDraft(draft.datasetVersionId, 'reviewer', review.reviewHash)
  assert.equal((await repository.findActive('dataset-pilot', { branchId: 'pilot' }))
    .datasetVersion.id, draft.datasetVersionId)
  await lifecycleService.rollbackToPrevious('dataset-pilot', 'pilot', 'reviewer', {
    expectedActiveVersionId: draft.datasetVersionId,
  })
  assert.equal((await repository.findActive('dataset-pilot', { branchId: 'pilot' }))
    .datasetVersion.id, 'dv-pilot-parity')
})
