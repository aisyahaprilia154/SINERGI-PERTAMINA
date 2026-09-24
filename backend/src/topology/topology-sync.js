import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { AppError } from '../errors.js'

const FORMAT = 'sinergi-topology-sync-v1'
export const BOOTSTRAP_FORMAT = 'sinergi-topology-bootstrap-v1'
const ABSENT = null

export function correctionState(record) {
  const state = {}
  for (const value of Array.isArray(record.mountingOverrides) ? record.mountingOverrides : []) {
    const assetId = value.assetId ?? value.sourceAssetId
    if (assetId) state[`mount:${assetId}`] = value.action === 'detach'
      ? { action: 'detach' }
      : { action: 'assign', targetAssetId: value.targetAssetId ?? null }
  }
  for (const [assetId, frameId] of Object.entries(record.topologyFrameAssignments ?? {})) {
    state[`frame-assignment:${assetId}`] = frameId
  }
  for (const [assetId, name] of Object.entries(record.topologyFrameNames ?? {})) {
    state[`frame-name:${assetId}`] = name
  }
  for (const [frameId, frame] of Object.entries(record.topologyFrames ?? {})) {
    state[`frame:${frameId}`] = frame
  }
  for (const override of record.topologyEdgeOverrides ?? []) {
    if (override.action === 'remove') state[`edge:${stateHash(override.edgeKey ?? override.edgeId)}`] = {
      edgeKey: override.edgeKey ?? null,
      ...(!override.edgeKey ? { edgeId: override.edgeId } : {}),
    }
  }
  for (const relation of record.topologyInputBundle?.explicitRelations ?? []) {
    if (relation.source !== 'manual_admin' || relation.sourceKey !== 'manual_device_connection') continue
    const source = relation.sourceReference
    const target = relation.targetReference
    if (!source || !target) continue
    const pair = [source, target].sort()
    state[`relation:${stateHash(pair)}`] = { source: pair[0], target: pair[1] }
  }
  return state
}

export function stateHash(state) {
  return createHash('sha256').update(stableJson(state)).digest('hex')
}

export function sourceIdentity(record) {
  const version = record.datasetVersion ?? {}
  return {
    datasetVersionId: version.syncRootDatasetVersionId ?? version.id,
    datasetId: version.datasetId,
    branchId: version.branchId,
    sourceChecksum: version.checksum ?? null,
  }
}

export function initializeSyncRecord(record, syncId) {
  if (record.topologySync?.id) return record
  const baseline = correctionState(record)
  return {
    ...record,
    topologySync: {
      id: syncId,
      source: sourceIdentity(record),
      baseline,
      baselineHash: stateHash(baseline),
      appliedChangeIds: [],
    },
  }
}

export function createCorrectionPackage(record, { offset = 0 } = {}) {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AppError('Offset paket tidak valid.', {
      code: 'topology_sync_invalid_offset', statusCode: 400,
    })
  }
  const sync = requireSync(record)
  const current = correctionState(record)
  const keys = new Set([...Object.keys(sync.baseline), ...Object.keys(current)])
  const changes = [...keys].sort().flatMap(key => {
    const before = Object.hasOwn(sync.baseline, key) ? sync.baseline[key] : ABSENT
    const after = Object.hasOwn(current, key) ? current[key] : ABSENT
    if (stableJson(before) === stableJson(after)) return []
    return [{
      id: stateHash([sync.id, key, before, after]),
      key, before, after,
    }]
  })
  return {
    format: FORMAT,
    syncId: sync.id,
    source: sync.source,
    baselineHash: sync.baselineHash,
    offset,
    totalChanges: changes.length,
    nextOffset: offset + 200 < changes.length ? offset + 200 : null,
    changes: changes.slice(offset, offset + 200),
  }
}

export function previewCorrectionPackage(record, bundle) {
  const sync = requireSync(record)
  validateBundle(record, bundle, sync)
  const current = correctionState(record)
  const applied = new Set(sync.appliedChangeIds ?? [])
  const seen = new Set()
  const changes = bundle.changes.map(change => {
    validateChange(change)
    if (seen.has(change.key)) throw invalidPackage('Kunci koreksi ganda.')
    seen.add(change.key)
    const baseline = Object.hasOwn(sync.baseline, change.key) ? sync.baseline[change.key] : ABSENT
    if (!same(baseline, change.before)
      || change.id !== stateHash([sync.id, change.key, change.before, change.after])) {
      throw invalidPackage('Paket tidak sesuai dengan titik awal bersama.')
    }
    const local = Object.hasOwn(current, change.key) ? current[change.key] : ABSENT
    const status = applied.has(change.id) || same(local, change.after) ? 'already-applied'
      : same(local, change.before) ? 'ready' : 'conflict'
    return { ...change, local, status }
  })
  return {
    syncId: sync.id,
    source: sync.source,
    baselineHash: sync.baselineHash,
    recordRevision: record.recordRevision ?? 0,
    changes,
    summary: {
      ready: changes.filter(item => item.status === 'ready').length,
      conflict: changes.filter(item => item.status === 'conflict').length,
      alreadyApplied: changes.filter(item => item.status === 'already-applied').length,
    },
  }
}

export function diagramChangesFromPreview(preview, resolutions = {}) {
  const pending = preview.changes.filter(change => (
    change.status === 'ready' || (change.status === 'conflict' && resolutions[change.id] === 'remote')
  ))
  const unresolved = preview.changes.filter(change => (
    change.status === 'conflict' && !['remote', 'local'].includes(resolutions[change.id])
  ))
  if (unresolved.length) throw new AppError('Selesaikan semua konflik sebelum impor.', {
    code: 'topology_sync_conflicts_unresolved', statusCode: 409,
    details: { changeIds: unresolved.map(item => item.id) },
  })
  const priority = { frame: 0, mount: 1, relation: 2,
    'frame-assignment': 3, 'frame-name': 4, edge: 5 }
  const changes = pending.sort((left, right) => (
    (priority[left.key.split(':', 1)[0]] ?? 99)
      - (priority[right.key.split(':', 1)[0]] ?? 99)
  )).map(change => changeToDiagramAction(change))
  const acceptedIds = preview.changes.filter(change => (
    change.status !== 'conflict' || ['remote', 'local'].includes(resolutions[change.id])
  )).map(change => change.id)
  return { changes, acceptedIds }
}

export function encryptSyncPackage(bundle, passphrase) {
  assertPassphrase(passphrase)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(gzipSync(JSON.stringify(bundle))), cipher.final()])
  return {
    format: `${FORMAT}-encrypted`,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptSyncPackage(envelope, passphrase) {
  assertPassphrase(passphrase)
  if (envelope?.format !== `${FORMAT}-encrypted`) throw invalidPackage('Format paket tidak dikenal.')
  try {
    const salt = strictBase64(envelope.salt, 16)
    const iv = strictBase64(envelope.iv, 12)
    const tag = strictBase64(envelope.tag, 16)
    const ciphertext = strictBase64(envelope.ciphertext)
    const key = scryptSync(passphrase, salt, 32)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const bundle = JSON.parse(gunzipSync(Buffer.concat([
      decipher.update(ciphertext), decipher.final(),
    ]), { maxOutputLength: 512 * 1024 * 1024 }).toString('utf8'))
    if (![FORMAT, BOOTSTRAP_FORMAT].includes(bundle?.format)) {
      throw invalidPackage('Format isi paket tidak dikenal.')
    }
    return bundle
  } catch {
    throw invalidPackage('Paket rusak atau kata sandi salah.')
  }
}

function changeToDiagramAction({ key, after }) {
  const separator = key.indexOf(':')
  const kind = key.slice(0, separator)
  const reference = key.slice(separator + 1)
  if (kind === 'mount') return {
    type: 'mount', assetId: reference, poleAssetId: after?.targetAssetId ?? null,
    action: after?.action === 'assign' ? 'assign' : 'detach',
  }
  if (kind === 'frame-assignment') return {
    type: 'move-frame', assetId: reference, frameId: after ?? null,
  }
  if (kind === 'frame-name') return {
    type: 'rename-frame', assetId: reference, name: after ?? '',
  }
  if (kind === 'frame' && after) return { type: 'create-frame', frame: after }
  if (kind === 'edge' && (after?.edgeId || after?.edgeKey)) return {
    type: 'remove-edge', edgeId: after.edgeId ?? null, edgeKey: after.edgeKey ?? null,
  }
  if (kind === 'relation' && after) return {
    type: 'add-relation', sourceAssetId: after.source, targetAssetId: after.target,
  }
  throw invalidPackage(`Koreksi ${kind} tidak dapat diterapkan.`)
}

function validateBundle(record, bundle, sync) {
  if (bundle?.format !== FORMAT || !Array.isArray(bundle.changes)
    || bundle.changes.length > 200) {
    throw invalidPackage('Struktur paket koreksi tidak valid.')
  }
  if (!same(bundle.source, sync.source)
    || !same(sourceIdentity(record), sync.source)) {
    throw new AppError('Sumber KML/KMZ berbeda. Koreksi ditahan sampai dataset baru ditinjau.', {
      code: 'topology_sync_source_mismatch', statusCode: 409,
      details: { packageSource: bundle.source, localSource: sourceIdentity(record) },
    })
  }
  if (bundle.syncId !== sync.id || bundle.baselineHash !== sync.baselineHash) {
    throw new AppError('Titik awal sinkronisasi berbeda. Samakan paket awal terlebih dahulu.', {
      code: 'topology_sync_baseline_mismatch', statusCode: 409,
    })
  }
}

function validateChange(change) {
  if (!change || typeof change.id !== 'string' || !/^[a-f0-9]{64}$/.test(change.id)
    || typeof change.key !== 'string' || !/^(mount|frame-assignment|frame-name|frame|edge|relation):[^\u0000-\u001f]{1,500}$/.test(change.key)
    || !Object.hasOwn(change, 'before') || !Object.hasOwn(change, 'after')) {
    throw invalidPackage('Isi perubahan tidak valid.')
  }
}

function requireSync(record) {
  if (!record.topologySync?.id) throw new AppError('Buat paket awal bersama sebelum bertukar koreksi.', {
    code: 'topology_sync_not_initialized', statusCode: 409,
  })
  return record.topologySync
}

function assertPassphrase(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) {
    throw new AppError('Kata sandi paket minimal 12 karakter.', {
      code: 'topology_sync_weak_passphrase', statusCode: 400,
    })
  }
}

function strictBase64(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error('Invalid base64')
  const bytes = Buffer.from(value, 'base64')
  if (length !== undefined && bytes.length !== length) throw Error('Invalid length')
  return bytes
}

function same(left, right) { return stableJson(left) === stableJson(right) }

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function invalidPackage(message) {
  return new AppError(message, { code: 'topology_sync_invalid_package', statusCode: 400 })
}
