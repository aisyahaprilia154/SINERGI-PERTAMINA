export function getDefaultAdminToken() {
  if (typeof window === 'undefined') return ''
  const isLocalhost = ['localhost', '127.0.0.1'].includes(
    window.location.hostname,
  )
  const configured = String(
    import.meta.env?.VITE_SINERGI_ADMIN_TOKEN ?? '',
  ).trim()
  if (configured) return configured
  if (import.meta.env?.DEV && isLocalhost) return 'local-admin'
  const stored = window.sessionStorage.getItem('sinergiAdminToken')
    || window.localStorage.getItem('sinergiAdminToken')
  if (stored) return stored
  return isLocalhost ? 'local-admin' : ''
}

export async function loadImportConfig({
  token,
  signal,
  apiBase = '',
} = {}) {
  return requestJson(`${apiBase}/api/admin/import-config`, {
    token,
    signal,
  })
}

export function uploadDataset({
  token,
  fields,
  file,
  signal,
  onProgress,
  apiBase = '',
}) {
  if (typeof XMLHttpRequest === 'undefined') {
    return Promise.reject(new Error('Browser tidak mendukung upload file.'))
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const formData = new FormData()
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value))
      }
    })
    formData.append('file', file)

    request.open('POST', `${apiBase}/api/admin/imports`)
    request.setRequestHeader('Authorization', `Bearer ${token}`)
    request.responseType = 'json'

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) {
        onProgress?.(null)
        return
      }
      onProgress?.(Math.round((event.loaded / event.total) * 100))
    })
    request.addEventListener('load', () => {
      const body = request.response ?? parseJson(request.responseText)
      if (request.status >= 200 && request.status < 300) {
        resolve(body)
      } else {
        reject(createApiError(body, request.status))
      }
    })
    request.addEventListener('error', () => reject(
      new Error('Tidak dapat terhubung ke service import.'),
    ))
    request.addEventListener('abort', () => {
      const error = new Error('Upload dibatalkan.')
      error.name = 'AbortError'
      reject(error)
    })
    signal?.addEventListener('abort', () => request.abort(), { once: true })
    request.send(formData)
  })
}

export async function loadImportStatus({
  token,
  statusUrl,
  signal,
  apiBase = '',
}) {
  return requestJson(`${apiBase}${statusUrl}`, {
    token,
    signal,
  })
}

export async function loadImportPreview({
  token,
  datasetVersionId,
  signal,
  apiBase = '',
}) {
  return requestJson(
    `${apiBase}/api/admin/imports/${encodeURIComponent(datasetVersionId)}/preview`,
    { token, signal },
  )
}

export async function activateDatasetVersion({
  token,
  datasetVersionId,
  expectedActiveVersionId,
  expectedRecordRevision,
  expectedActivePointerRevision,
  publicationProfile = 'map_only',
  confirmBreakingChanges = false,
  signal,
  apiBase = '',
}) {
  return requestJson(
    `${apiBase}/api/admin/imports/${encodeURIComponent(datasetVersionId)}/activate`,
    {
      token,
      signal,
      method: 'POST',
      body: {
        confirmArchiveCurrent: true,
        expectedActiveVersionId: expectedActiveVersionId ?? null,
        expectedRecordRevision,
        expectedActivePointerRevision,
        publicationProfile,
        confirmBreakingChanges,
      },
    },
  )
}

export async function rejectDatasetVersion({
  token,
  datasetVersionId,
  signal,
  apiBase = '',
}) {
  return requestJson(
    `${apiBase}/api/admin/imports/${encodeURIComponent(datasetVersionId)}/reject`,
    {
      token,
      signal,
      method: 'POST',
    },
  )
}

export async function downloadDatasetSource({
  token,
  datasetVersionId,
  signal,
  apiBase = '',
}) {
  const response = await fetch(
    `${apiBase}/api/dataset-versions/${encodeURIComponent(datasetVersionId)}/source-file`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  )
  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({}))
    throw createApiError(responseBody, response.status)
  }
  return {
    blob: await response.blob(),
    filename: parseAttachmentFilename(
      response.headers.get('content-disposition'),
      `source-${datasetVersionId}`,
    ),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  }
}

export function parseAttachmentFilename(contentDisposition, fallback) {
  const extended = String(contentDisposition ?? '')
    .match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (extended) {
    try {
      return decodeURIComponent(extended)
    } catch {
      // Continue with the safe ASCII filename.
    }
  }
  const ascii = String(contentDisposition ?? '').match(/filename="([^"]+)"/i)?.[1]
  return ascii || fallback
}

async function requestJson(url, {
  token,
  signal,
  method = 'GET',
  body,
}) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  })
  const responseBody = await response.json().catch(() => ({}))
  if (!response.ok) throw createApiError(responseBody, response.status)
  return responseBody
}

function createApiError(body, status) {
  const error = new Error(
    body?.error?.message
      || `Request import gagal dengan status ${status}.`,
  )
  error.name = 'ImportApiError'
  error.status = status
  error.code = body?.error?.code
  error.details = body?.error?.details
  return error
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}
