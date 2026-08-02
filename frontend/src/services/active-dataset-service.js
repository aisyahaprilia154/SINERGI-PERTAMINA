import { getDefaultAdminToken } from './import-dataset-service.js'

export function getDefaultMapToken() {
  if (typeof window === 'undefined') return ''
  return window.sessionStorage.getItem('sinergiViewerToken')
    || window.localStorage.getItem('sinergiViewerToken')
    || getDefaultAdminToken()
}

export async function loadActiveDataset({
  datasetId,
  branchId,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetId) throw new TypeError('datasetId wajib tersedia.')
  const query = new URLSearchParams({ view: 'map' })
  if (branchId) query.set('branchId', branchId)
  const response = await fetch(
    `${apiBase}/api/datasets/${encodeURIComponent(datasetId)}/active?${query}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  )
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(
      body?.error?.message || `Dataset aktif gagal dimuat (${response.status}).`,
    )
    error.code = body?.error?.code
    error.status = response.status
    throw error
  }
  return body
}

export async function loadActiveAssetDetail({
  datasetId,
  branchId,
  assetId,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetId) throw new TypeError('datasetId wajib tersedia.')
  if (!assetId) throw new TypeError('assetId wajib tersedia.')
  const query = new URLSearchParams()
  if (branchId) query.set('branchId', branchId)
  const response = await fetch(
    `${apiBase}/api/datasets/${encodeURIComponent(datasetId)}/active/assets/`
      + `${encodeURIComponent(assetId)}?${query}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  )
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(
      body?.error?.message || `Detail aset gagal dimuat (${response.status}).`,
    )
    error.code = body?.error?.code
    error.status = response.status
    throw error
  }
  return body
}

export async function loadRelationReview({
  datasetVersionId,
  siteScopeId = 'pengapon',
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetVersionId) throw new TypeError('datasetVersionId wajib tersedia.')
  const query = new URLSearchParams({ siteScopeId })
  return requestActiveJson(
    `${apiBase}/api/admin/dataset-versions/${
      encodeURIComponent(datasetVersionId)
    }/relation-review?${query}`,
    { token, signal },
  )
}

export async function reviewRelationCandidate({
  datasetVersionId,
  relationId,
  decision,
  siteScopeId = 'pengapon',
  note = null,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetVersionId) throw new TypeError('datasetVersionId wajib tersedia.')
  if (!relationId) throw new TypeError('relationId wajib tersedia.')
  return requestActiveJson(
    `${apiBase}/api/admin/dataset-versions/${
      encodeURIComponent(datasetVersionId)
    }/relations/${encodeURIComponent(relationId)}/review`,
    {
      token,
      signal,
      method: 'POST',
      body: {
        decision,
        siteScopeId,
        ...(note ? { note } : {}),
      },
    },
  )
}

async function requestActiveJson(url, {
  token,
  signal,
  method = 'GET',
  body,
}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  })
  const responseBody = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(
      responseBody?.error?.message
        || `Review relasi gagal dimuat (${response.status}).`,
    )
    error.code = responseBody?.error?.code
    error.status = response.status
    throw error
  }
  return responseBody
}
