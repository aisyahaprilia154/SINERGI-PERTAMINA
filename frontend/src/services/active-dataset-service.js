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
