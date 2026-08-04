import { createHash } from 'node:crypto'
import { AppError } from '../errors.js'

const MAX_IDEMPOTENCY_KEY_LENGTH = 255
const MAX_RECEIPTS_PER_RECORD = 100

export function normalizeTopologyIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') return null
  const normalized = String(value).trim()
  if (!normalized) return null
  if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH
    || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AppError('Idempotency-Key tidak valid.', {
      code: 'invalid_idempotency_key',
      statusCode: 400,
    })
  }
  return normalized
}

export function createTopologyMutationFingerprint({
  action,
  resourceId,
  actorId,
  input,
}) {
  return createHash('sha256')
    .update(stableSerialize({
      action: String(action ?? ''),
      resourceId: String(resourceId ?? ''),
      actorId: String(actorId ?? ''),
      input: input ?? {},
    }))
    .digest('hex')
}

export function findTopologyMutationReceipt(record, key) {
  if (!key) return null
  const receipts = Array.isArray(record?.topologyMutationReceipts)
    ? record.topologyMutationReceipts
    : []
  const receipt = receipts.find((item) => item?.key === key)
  return receipt ? structuredClone(receipt) : null
}

export function assertTopologyMutationFingerprint(receipt, fingerprint) {
  if (receipt?.fingerprint === fingerprint) return
  throw new AppError('Idempotency-Key sudah digunakan untuk mutation berbeda.', {
    code: 'idempotency_key_reused',
    statusCode: 409,
    details: {
      idempotencyKey: receipt?.key ?? null,
    },
  })
}

export function appendTopologyMutationReceipt(record, {
  key,
  fingerprint,
  action,
  resourceId,
  actorId,
  response,
  createdAt,
}) {
  if (!key) return record
  const receipts = Array.isArray(record.topologyMutationReceipts)
    ? record.topologyMutationReceipts
    : []
  const nextReceipt = {
    key,
    fingerprint,
    action,
    resourceId,
    actorId,
    createdAt,
    response: structuredClone(response),
  }
  return {
    ...record,
    topologyMutationReceipts: [
      ...receipts.filter((item) => item?.key !== key),
      nextReceipt,
    ].slice(-MAX_RECEIPTS_PER_RECORD),
  }
}

function stableSerialize(value) {
  return JSON.stringify(stableValue(value))
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  )
}
