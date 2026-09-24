import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../errors.js'
import {
  assetIdentityHash,
  correctionState,
  createCorrectionPackage,
  BOOTSTRAP_FORMAT,
  decryptSyncPackage,
  diagramChangesFromPreview,
  encryptSyncPackage,
  initializeSyncRecord,
  previewCorrectionPackage,
  previewIndependentBaseline,
  sourceIdentity,
  stateHash,
} from './topology-sync.js'

export class TopologySyncService {
  constructor({ repository, topologyService, auditLog, fileStore, lifecycleService,
    config = {} }) {
    this.repository = repository
    this.topologyService = topologyService
    this.auditLog = auditLog
    this.fileStore = fileStore
    this.lifecycleService = lifecycleService
    this.config = config
  }

  async initialize(datasetVersionId, actorId, expectedRecordRevision) {
    const current = await this.repository.get(datasetVersionId)
    if (current.topologySync?.id) return this.status(datasetVersionId)
    const updated = await this.repository.update(datasetVersionId, record => (
      initializeSyncRecord(record, randomUUID())
    ), { expectedRevision: expectedRecordRevision ?? current.recordRevision })
    await this.auditLog?.record('topology.sync_initialized', {
      actorId, datasetVersionId, outcome: 'confirmed',
      details: { syncId: updated.topologySync.id },
    })
    return this.status(datasetVersionId)
  }

  async status(datasetVersionId) {
    const record = await this.repository.get(datasetVersionId)
    return {
      datasetVersionId,
      recordRevision: record.recordRevision ?? 0,
      syncId: record.topologySync?.id ?? null,
      source: record.topologySync?.source ?? null,
      pendingChanges: record.topologySync?.id
        ? createCorrectionPackage(record).totalChanges : null,
    }
  }

  async createDraft(datasetVersionId, actorId) {
    const current = await this.repository.get(datasetVersionId)
    const active = await this.repository.findActive(current.datasetVersion.datasetId, {
      branchId: current.datasetVersion.branchId,
    })
    if (active?.datasetVersion.id !== datasetVersionId) {
      throw new AppError('Draft harus dibuat dari dataset aktif.', {
        code: 'topology_sync_draft_source_not_active', statusCode: 409,
      })
    }
    if (!current.topologySync?.id) throw new AppError('Siapkan titik sinkronisasi dulu.', {
      code: 'topology_sync_not_initialized', statusCode: 409,
    })
    const draft = structuredClone(current)
    draft.datasetVersion = {
      ...draft.datasetVersion,
      id: `dv-${randomUUID()}`,
      versionName: `${current.datasetVersion.versionName} · Draft koreksi`,
      baseDatasetVersionId: datasetVersionId,
      syncRootDatasetVersionId: current.topologySync.source.datasetVersionId,
      status: 'valid', publicationStatus: 'unpublished',
      publicationProfile: current.datasetVersion.publicationProfile ?? 'map_only',
      importedBy: actorId, importedAt: new Date().toISOString(),
    }
    delete draft.datasetVersion.activatedAt
    delete draft.datasetVersion.activatedBy
    delete draft.datasetVersion.publishedAt
    delete draft.datasetVersion.activePointerRevision
    delete draft.datasetVersion.autoActivation
    draft.datasetVersionId = draft.datasetVersion.id
    draft.recordRevision = 0
    await this.repository.create(draft)
    await this.auditLog?.record('topology.sync_draft_created', {
      actorId, datasetVersionId: draft.datasetVersion.id, outcome: 'confirmed',
      details: { baseDatasetVersionId: datasetVersionId },
    })
    return { datasetVersionId: draft.datasetVersion.id, baseDatasetVersionId: datasetVersionId }
  }

  async reviewDraft(datasetVersionId) {
    const draft = await this.repository.get(datasetVersionId)
    const baseVersionId = draft.datasetVersion.baseDatasetVersionId
    if (!baseVersionId || draft.datasetVersion.publicationStatus !== 'unpublished') {
      throw new AppError('Versi ini bukan draft yang dapat diterbitkan.', {
        code: 'topology_sync_draft_invalid', statusCode: 409,
      })
    }
    const resolved = await this.repository.resolveActiveVersion({
      datasetId: draft.datasetVersion.datasetId,
      branchId: draft.datasetVersion.branchId,
    })
    if (resolved?.record?.datasetVersion.id !== baseVersionId) {
      throw new AppError('Dataset aktif berubah. Buat draft baru dan tinjau ulang.', {
        code: 'topology_sync_draft_stale', statusCode: 409,
      })
    }
    const before = correctionState(resolved.record)
    const after = correctionState(draft)
    const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort().flatMap(key => {
        const left = Object.hasOwn(before, key) ? before[key] : null
        const right = Object.hasOwn(after, key) ? after[key] : null
        return stateHash(left) === stateHash(right) ? [] : [{ key, before: left, after: right }]
      })
    if (resolved.record.topologySync?.id !== draft.topologySync?.id) {
      changes.unshift({ key: 'sync-baseline:root',
        before: resolved.record.topologySync?.id ?? null,
        after: draft.topologySync?.id ?? null })
    }
    return {
      datasetVersionId,
      baseDatasetVersionId: baseVersionId,
      expectedRecordRevision: draft.recordRevision ?? 0,
      expectedActivePointerRevision: resolved.pointer.revision,
      changes,
      reviewHash: stateHash([baseVersionId, resolved.pointer.revision,
        draft.recordRevision ?? 0, changes]),
    }
  }

  async publishDraft(datasetVersionId, actorId, reviewHash) {
    const review = await this.reviewDraft(datasetVersionId)
    if (!reviewHash || review.reviewHash !== reviewHash || !review.changes.length) {
      throw new AppError('Pratinjau publikasi berubah atau tidak ada koreksi.', {
        code: 'topology_sync_review_stale', statusCode: 409,
      })
    }
    const draft = await this.repository.get(datasetVersionId)
    const result = await this.lifecycleService.activate(datasetVersionId, actorId, {
      expectedActiveVersionId: review.baseDatasetVersionId,
      expectedRecordRevision: review.expectedRecordRevision,
      expectedActivePointerRevision: review.expectedActivePointerRevision,
      publicationProfile: draft.datasetVersion.publicationProfile ?? 'map_only',
    })
    return { ...result, reviewedChangeCount: review.changes.length }
  }

  async export(datasetVersionId, passphrase, offset = 0) {
    const record = await this.repository.get(datasetVersionId)
    return encryptSyncPackage(createCorrectionPackage(record, { offset }), passphrase)
  }

  async exportBootstrap(datasetVersionId, passphrase) {
    const record = await this.repository.get(datasetVersionId)
    if (record.datasetVersion.syncRootDatasetVersionId) {
      throw new AppError('Paket awal harus dibuat dari dataset sumber, bukan draft.', {
        code: 'topology_sync_bootstrap_from_draft', statusCode: 409,
      })
    }
    if (!record.topologySync?.id) throw new AppError('Inisialisasi sinkronisasi dulu.', {
      code: 'topology_sync_not_initialized', statusCode: 409,
    })
    const source = await this.fileStore.readVerifiedOriginal({
      storageKey: record.datasetVersion.sourceStorageKey,
      expectedSize: record.datasetVersion.sourceSize,
      expectedChecksum: record.datasetVersion.checksum,
    })
    return encryptSyncPackage({
      format: BOOTSTRAP_FORMAT,
      source: sourceIdentity(record),
      record,
      sourceFile: source.bytes.toString('base64'),
    }, passphrase)
  }

  async importBootstrap(actorId, envelope, passphrase) {
    const bundle = decryptSyncPackage(envelope, passphrase)
    const record = bundle.record
    if (bundle.format !== BOOTSTRAP_FORMAT || !record?.topologySync?.id
      || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.datasetVersion?.id ?? '')
      || JSON.stringify(sourceIdentity(record)) !== JSON.stringify(bundle.source)
      || JSON.stringify(record.topologySync.source) !== JSON.stringify(bundle.source)
      || !record.topologySync.baseline
      || stateHash(record.topologySync.baseline) !== record.topologySync.baselineHash) {
      throw new AppError('Paket awal tidak valid.', {
        code: 'topology_sync_invalid_package', statusCode: 400,
      })
    }
    const branchId = record.datasetVersion.branchId
    const datasetId = record.datasetVersion.datasetId
    if ((this.config.allowedBranchIds?.length
      && !this.config.allowedBranchIds.includes(branchId))
      || (this.config.datasetIdsByBranch?.[branchId]
        && this.config.datasetIdsByBranch[branchId] !== datasetId)) {
      throw new AppError('Cabang atau dataset paket awal tidak tersedia di server ini.', {
        code: 'topology_sync_scope_mismatch', statusCode: 409,
      })
    }
    const existing = await this.repository.list()
    if (existing.some(item => item.datasetVersion.id === record.datasetVersion.id
      || (item.datasetVersion.datasetId === datasetId
        && item.datasetVersion.branchId === branchId))) {
      throw new AppError('Dataset awal sudah ada. Gunakan impor koreksi.', {
        code: 'topology_sync_baseline_exists', statusCode: 409,
      })
    }
    const active = await this.repository.findActive(record.datasetVersion.datasetId, {
      branchId: record.datasetVersion.branchId,
    })
    if (active) throw new AppError('Dataset aktif sudah ada. Paket awal hanya untuk instalasi kosong.', {
      code: 'topology_sync_baseline_exists', statusCode: 409,
    })
    const bytes = Buffer.from(bundle.sourceFile ?? '', 'base64')
    if (bytes.length !== record.datasetVersion.sourceSize
      || `sha256:${createHash('sha256').update(bytes).digest('hex')}`
        !== record.datasetVersion.checksum) {
      throw new AppError('File sumber paket awal tidak cocok dengan checksum.', {
        code: 'topology_sync_invalid_package', statusCode: 400,
      })
    }
    const extension = path.extname(record.datasetVersion.sourceFilename ?? '').toLowerCase()
    if (!['.kml', '.kmz'].includes(extension)) throw new AppError('Jenis file sumber tidak valid.', {
      code: 'topology_sync_invalid_package', statusCode: 400,
    })
    const temporaryPath = await this.fileStore.createTemporaryUpload()
    await writeFile(temporaryPath, bytes)
    const stored = await this.fileStore.commitOriginal(
      temporaryPath, record.datasetVersion.id, extension,
    )
    const imported = structuredClone(record)
    imported.datasetVersion.sourceStorageKey = stored.storageKey
    imported.datasetVersion.status = 'valid'
    imported.datasetVersion.publicationStatus = 'unpublished'
    imported.datasetVersion.importedBy = actorId
    imported.recordRevision = 0
    await this.repository.create(imported)
    await this.auditLog?.record('topology.sync_baseline_imported', {
      actorId, datasetVersionId: imported.datasetVersion.id, outcome: 'confirmed',
      details: { syncId: imported.topologySync.id },
    })
    return {
      datasetVersionId: imported.datasetVersion.id,
      status: 'staged',
      message: 'Paket awal diimpor. Tinjau dan aktifkan versi dataset.',
    }
  }

  async previewReconciliation(datasetVersionId, envelope, passphrase) {
    const local = await this.repository.get(datasetVersionId)
    const remote = await this.#validateReconciliationPackage(local, envelope, passphrase)
    return {
      ...previewIndependentBaseline(local, remote),
      mode: 'reconciliation',
      remoteSyncId: remote.topologySync.id,
      sourceChecksum: remote.datasetVersion.checksum,
    }
  }

  async applyReconciliation(datasetVersionId, actorId, envelope, passphrase, {
    expectedRecordRevision, resolutions = {},
  } = {}) {
    const local = await this.repository.get(datasetVersionId)
    if (!Number.isInteger(expectedRecordRevision)
      || expectedRecordRevision !== local.recordRevision) {
      throw new AppError('Data berubah sejak pratinjau. Periksa ulang paket.', {
        code: 'dataset_version_stale_revision', statusCode: 409,
      })
    }
    const remote = await this.#validateReconciliationPackage(local, envelope, passphrase)
    const preview = previewIndependentBaseline(local, remote)
    if (preview.changes.some(item => item.relatedConflict)) {
      throw new AppError('Relasi ini sudah dipakai relasi lokal lain. Perbaiki relasi di diagram sebelum menyelaraskan.', {
        code: 'topology_sync_relation_collision', statusCode: 409,
      })
    }
    const { changes } = diagramChangesFromPreview(preview, resolutions)
    if (changes.length > 200) throw new AppError('Terlalu banyak perubahan untuk satu draft.', {
      code: 'topology_sync_reconciliation_too_large', statusCode: 409,
    })
    const draft = await this.createDraft(datasetVersionId, actorId)
    await this.topologyService.saveDiagram(draft.datasetVersionId, actorId, {
      changes,
      expectedRecordRevision: 0,
      syncAdopt: structuredClone(remote.topologySync),
    })
    await this.auditLog?.record('topology.sync_reconciled', {
      actorId, datasetVersionId: draft.datasetVersionId, outcome: 'confirmed',
      details: { baseDatasetVersionId: datasetVersionId,
        remoteSyncId: remote.topologySync.id, applied: changes.length },
    })
    return { ...draft, applied: changes.length }
  }

  async #validateReconciliationPackage(local, envelope, passphrase) {
    const bundle = decryptSyncPackage(envelope, passphrase)
    const remote = bundle.record
    const localVersion = local.datasetVersion
    if (bundle.format !== BOOTSTRAP_FORMAT || !remote?.topologySync?.id
      || stateHash(remote.topologySync.baseline) !== remote.topologySync.baselineHash
      || JSON.stringify(sourceIdentity(remote)) !== JSON.stringify(bundle.source)
      || JSON.stringify(remote.topologySync.source) !== JSON.stringify(bundle.source)) {
      throw new AppError('Paket awal tidak valid.', {
        code: 'topology_sync_invalid_package', statusCode: 400,
      })
    }
    const active = await this.repository.findActive(localVersion.datasetId, {
      branchId: localVersion.branchId,
    })
    if (active?.datasetVersion.id !== localVersion.id) {
      throw new AppError('Penyelarasan hanya bisa dimulai dari dataset aktif.', {
        code: 'topology_sync_reconciliation_requires_active', statusCode: 409,
      })
    }
    if (local.topologySync?.id === remote.topologySync.id
      && JSON.stringify(sourceIdentity(local)) === JSON.stringify(sourceIdentity(remote))) {
      throw new AppError('Titik awal kedua dataset sudah sama. Minta paket koreksi rekan lalu gunakan “Periksa koreksi”.', {
        code: 'topology_sync_reconciliation_already_shared', statusCode: 409,
      })
    }
    const remoteVersion = remote.datasetVersion
    const localIdentity = assetIdentityHash(local)
    const remoteIdentity = assetIdentityHash(remote)
    if (localVersion.datasetId !== remoteVersion.datasetId
      || localVersion.branchId !== remoteVersion.branchId
      || !localVersion.checksum || localVersion.checksum !== remoteVersion.checksum
      || !localIdentity || localIdentity !== remoteIdentity) {
      throw new AppError('Sumber atau identitas aset berbeda. Paket tidak dapat digabung otomatis.', {
        code: 'topology_sync_reconciliation_source_mismatch', statusCode: 409,
      })
    }
    const bytes = Buffer.from(bundle.sourceFile ?? '', 'base64')
    if (bytes.length !== remoteVersion.sourceSize
      || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== remoteVersion.checksum) {
      throw new AppError('Isi sumber dalam paket awal rusak.', {
        code: 'topology_sync_invalid_package', statusCode: 400,
      })
    }
    await this.fileStore.readVerifiedOriginal({
      storageKey: localVersion.sourceStorageKey,
      expectedSize: localVersion.sourceSize,
      expectedChecksum: localVersion.checksum,
    })
    return remote
  }

  async preview(datasetVersionId, envelope, passphrase) {
    const record = await this.repository.get(datasetVersionId)
    return previewCorrectionPackage(record, decryptSyncPackage(envelope, passphrase))
  }

  async apply(datasetVersionId, actorId, envelope, passphrase, {
    expectedRecordRevision, resolutions = {},
  } = {}) {
    const record = await this.repository.get(datasetVersionId)
    if (!Number.isInteger(expectedRecordRevision)
      || record.recordRevision !== expectedRecordRevision) {
      throw new AppError('Data berubah sejak pratinjau. Muat ulang paket.', {
        code: 'dataset_version_stale_revision', statusCode: 409,
      })
    }
    const preview = previewCorrectionPackage(
      record, decryptSyncPackage(envelope, passphrase),
    )
    const { changes, acceptedIds } = diagramChangesFromPreview(preview, resolutions)
    if (changes.length || acceptedIds.length) {
      await this.topologyService.saveDiagram(datasetVersionId, actorId, {
        changes,
        expectedRecordRevision,
        syncAcceptedIds: acceptedIds,
      })
    }
    await this.auditLog?.record('topology.sync_imported', {
      actorId, datasetVersionId, outcome: 'confirmed',
      details: { applied: changes.length, acknowledged: acceptedIds.length },
    })
    return {
      applied: changes.length,
      acknowledged: acceptedIds.length,
      status: await this.status(datasetVersionId),
    }
  }
}
