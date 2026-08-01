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

export async function loadTopologyProjection({
  datasetVersionId,
  projection,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetVersionId) throw new TypeError('datasetVersionId wajib tersedia.')
  if (!['summary', 'graph', 'candidates'].includes(projection)) {
    throw new TypeError('Projection topology tidak valid.')
  }
  return topologyRequest(
    `${apiBase}/api/dataset-versions/${encodeURIComponent(datasetVersionId)}`
      + `/topology/${projection}`,
    { token, signal },
  )
}

export async function loadDatasetProjection({
  datasetVersionId,
  projection,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetVersionId) throw new TypeError('datasetVersionId wajib tersedia.')
  if (!['readiness', 'source-features', 'geometries', 'overlays', 'classification-issues']
    .includes(projection)) {
    throw new TypeError('Projection dataset tidak valid.')
  }
  return topologyRequest(
    `${apiBase}/api/dataset-versions/${encodeURIComponent(datasetVersionId)}/${projection}`,
    { token, signal },
  )
}

export async function reviewTopologyCandidate({
  candidateId,
  action,
  body = {},
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!candidateId) throw new TypeError('candidateId wajib tersedia.')
  if (!['confirm', 'reject', 'skip', 'select-target'].includes(action)) {
    throw new TypeError('Action candidate tidak valid.')
  }
  return topologyRequest(
    `${apiBase}/api/topology/candidates/${encodeURIComponent(candidateId)}/${action}`,
    { token, signal, method: 'POST', body },
  )
}

export async function reviewTopologyBulk({
  datasetVersionId,
  action,
  reason,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetVersionId) throw new TypeError('Dataset version ID wajib tersedia.')
  if (!['confirm-all', 'revoke-all'].includes(action)) {
    throw new TypeError('Action bulk topology tidak valid.')
  }
  return topologyRequest(
    `${apiBase}/api/dataset-versions/${encodeURIComponent(datasetVersionId)}`
      + `/topology/${action}`,
    {
      token,
      signal,
      method: 'POST',
      body: { reason: String(reason ?? '').trim() || undefined },
    },
  )
}

export async function revokeTopologyRelation({
  relationId,
  reason,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!relationId) throw new TypeError('relationId wajib tersedia.')
  return topologyRequest(
    `${apiBase}/api/topology/relations/${encodeURIComponent(relationId)}/revoke`,
    { token, signal, method: 'POST', body: { reason } },
  )
}

async function topologyRequest(url, {
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
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message || `Layanan topology gagal (${response.status}).`,
    )
    error.code = payload?.error?.code
    error.status = response.status
    throw error
  }
  return payload
}
