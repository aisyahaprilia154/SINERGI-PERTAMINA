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
  status = null,
  site = null,
  networkFamily = null,
  minScore = null,
  cursor = null,
  limit = null,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetVersionId) throw new TypeError('datasetVersionId wajib tersedia.')
  if (!['summary', 'graph', 'candidates'].includes(projection)) {
    throw new TypeError('Projection topology tidak valid.')
  }
  const query = new URLSearchParams()
  if (projection === 'candidates') {
    setTopologyQueryValue(query, 'status', status)
    setTopologyQueryValue(query, 'site', site)
    setTopologyQueryValue(query, 'networkFamily', networkFamily)
    setTopologyQueryValue(query, 'minScore', minScore)
    setTopologyQueryValue(query, 'cursor', cursor)
    setTopologyQueryValue(query, 'limit', limit)
  }
  const queryString = query.toString()
  return topologyRequest(
    `${apiBase}/api/dataset-versions/${encodeURIComponent(datasetVersionId)}`
      + `/topology/${projection}${queryString ? `?${queryString}` : ''}`,
    { token, signal },
  )
}

export async function loadAllTopologyCandidates({
  datasetVersionId,
  status = null,
  site = null,
  networkFamily = null,
  minScore = null,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
  limit = 500,
} = {}) {
  if (!datasetVersionId) throw new TypeError('Dataset version ID wajib tersedia.')
  let cursor = null
  let firstPage = null
  const items = []
  let pageCount = 0
  do {
    const page = await loadTopologyProjection({
      datasetVersionId,
      projection: 'candidates',
      status,
      site,
      networkFamily,
      minScore,
      cursor,
      limit,
      token,
      signal,
      apiBase,
    })
    if (!firstPage) {
      firstPage = page
    } else if (page.graphRevision !== firstPage.graphRevision
      || page.candidateRevision !== firstPage.candidateRevision) {
      throw topologyCandidateSnapshotChanged()
    }
    items.push(...(page.items ?? []))
    cursor = page.nextCursor ?? null
    pageCount += 1
    if (pageCount > 10000) throw new Error('Pagination candidate melebihi batas aman.')
  } while (cursor)

  return {
    ...firstPage,
    items,
    nextCursor: null,
    pageInfo: {
      ...(firstPage?.pageInfo ?? {}),
      limit,
      hasNextPage: false,
      total: items.length,
    },
  }
}

export async function traceTopology({
  datasetVersionId,
  sourceAssetId,
  targetAssetId = null,
  graphRevision,
  direction = 'both',
  scopeAssetIds = null,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetVersionId) throw new TypeError('Dataset version ID wajib tersedia.')
  if (!sourceAssetId) throw new TypeError('Source asset ID wajib tersedia.')
  if (!graphRevision) throw new TypeError('Graph revision wajib tersedia.')
  return topologyRequest(
    `${apiBase}/api/dataset-versions/${encodeURIComponent(datasetVersionId)}`
      + '/topology/trace',
    {
      token,
      signal,
      method: 'POST',
      body: {
        sourceAssetId,
        graphRevision,
        direction,
        ...(Array.isArray(scopeAssetIds) ? { scopeAssetIds } : {}),
        ...(targetAssetId ? { targetAssetId } : {}),
      },
    },
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
  expectedGraphRevision,
  expectedCandidateRevision,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetVersionId) throw new TypeError('Dataset version ID wajib tersedia.')
  if (!['confirm-all', 'confirm-line-labels', 'revoke-all'].includes(action)) {
    throw new TypeError('Action bulk topology tidak valid.')
  }
  return topologyRequest(
    `${apiBase}/api/dataset-versions/${encodeURIComponent(datasetVersionId)}`
      + `/topology/${action}`,
    {
      token,
      signal,
      method: 'POST',
       body: {
         reason: String(reason ?? '').trim() || undefined,
         ...(expectedGraphRevision !== undefined ? { expectedGraphRevision } : {}),
         ...(expectedCandidateRevision !== undefined ? { expectedCandidateRevision } : {}),
       },
    },
  )
}

export async function createTopologyRelation({
  datasetVersionId,
  sourceAssetId,
  targetAssetId,
  relationType = 'connected-to',
  direction = 'undirected',
  reason,
  expectedGraphRevision,
  expectedCandidateRevision,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!datasetVersionId) throw new TypeError('Dataset version ID wajib tersedia.')
  if (!sourceAssetId) throw new TypeError('Source asset ID wajib tersedia.')
  if (!targetAssetId) throw new TypeError('Target asset ID wajib tersedia.')
  return topologyRequest(
    `${apiBase}/api/dataset-versions/${encodeURIComponent(datasetVersionId)}`
      + '/topology/relations',
    {
      token,
      signal,
      method: 'POST',
      body: {
        sourceAssetId,
        targetAssetId,
        relationType,
        direction,
        reason: String(reason ?? '').trim() || undefined,
        ...(expectedGraphRevision !== undefined ? { expectedGraphRevision } : {}),
        ...(expectedCandidateRevision !== undefined ? { expectedCandidateRevision } : {}),
      },
    },
  )
}

export async function revokeTopologyRelation({
  relationId,
  reason,
  expectedGraphRevision,
  expectedCandidateRevision,
  token = getDefaultMapToken(),
  signal,
  apiBase = '',
} = {}) {
  if (!relationId) throw new TypeError('relationId wajib tersedia.')
  return topologyRequest(
    `${apiBase}/api/topology/relations/${encodeURIComponent(relationId)}/revoke`,
    {
      token,
      signal,
      method: 'POST',
      body: {
        reason,
        ...(expectedGraphRevision !== undefined ? { expectedGraphRevision } : {}),
        ...(expectedCandidateRevision !== undefined ? { expectedCandidateRevision } : {}),
      },
    },
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
    error.details = payload?.error?.details ?? null
    error.payload = payload
    throw error
  }
  return payload
}

function setTopologyQueryValue(query, key, value) {
  if (value === undefined || value === null || value === '') return
  query.set(key, String(value))
}

function topologyCandidateSnapshotChanged() {
  const error = new Error(
    'Daftar candidate berubah saat dimuat. Ulangi pemuatan agar halaman konsisten.',
  )
  error.code = 'topology_candidate_snapshot_changed'
  error.status = 409
  return error
}
