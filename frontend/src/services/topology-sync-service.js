import { getDefaultAdminToken } from './import-dataset-service.js'

async function request(path, body, { method = 'POST' } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${getDefaultAdminToken()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error?.message ?? `Gagal (${response.status}).`)
  return result
}

export const syncStatus = datasetVersionId => request(
  `/api/dataset-versions/${encodeURIComponent(datasetVersionId)}/topology/sync`, null,
  { method: 'GET' },
)
export const createTopologyDraft = datasetVersionId => request(
  '/api/admin/topology-sync/drafts', { datasetVersionId },
)
export const loadTopologyDraft = datasetVersionId => request(
  `/api/admin/topology-sync/drafts/${encodeURIComponent(datasetVersionId)}/view`,
  null, { method: 'GET' },
)
export const loadDraftReview = datasetVersionId => request(
  `/api/admin/topology-sync/drafts/${encodeURIComponent(datasetVersionId)}/review`,
  null, { method: 'GET' },
)
export const publishTopologyDraft = (datasetVersionId, reviewHash) => request(
  `/api/admin/topology-sync/drafts/${encodeURIComponent(datasetVersionId)}/publish`,
  { reviewHash },
)
export const initializeSync = (datasetVersionId, expectedRecordRevision) => request(
  `/api/dataset-versions/${encodeURIComponent(datasetVersionId)}/topology/sync/initialize`,
  { expectedRecordRevision },
)
export const exportCorrections = (datasetVersionId, passphrase, offset = 0) => request(
  `/api/dataset-versions/${encodeURIComponent(datasetVersionId)}/topology/sync/export`,
  { passphrase, offset },
)
export const previewCorrections = (datasetVersionId, envelope, passphrase) => request(
  `/api/dataset-versions/${encodeURIComponent(datasetVersionId)}/topology/sync/preview`,
  { envelope, passphrase },
)
export const applyCorrections = (datasetVersionId, envelope, passphrase,
  expectedRecordRevision, resolutions) => request(
  `/api/dataset-versions/${encodeURIComponent(datasetVersionId)}/topology/sync/apply`,
  { envelope, passphrase, expectedRecordRevision, resolutions },
)
export const exportBootstrap = (datasetVersionId, passphrase) => request(
  '/api/admin/topology-sync/bootstrap/export', { datasetVersionId, passphrase },
)
export const importBootstrap = (envelope, passphrase) => request(
  '/api/admin/topology-sync/bootstrap/import', { envelope, passphrase },
)

export function downloadSyncFile(envelope, filename) {
  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
