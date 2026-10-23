import { useCallback, useEffect, useRef, useState } from 'react'
import { loadImportConfig, loadImportHistory, loadImportStatus, uploadDataset, downloadDatasetSource } from '../../services/import-dataset-service.js'
import { currentDatasetId } from '../../services/operational-api.js'
import { clearSession } from '../../services/account-session.js'
import { documentNavigation } from '../../services/document-navigation.js'

function delay(signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { window.clearTimeout(timer); reject(new DOMException('Polling dibatalkan.', 'AbortError')) }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1200)
    signal.addEventListener('abort', abort, { once: true })
  })
}
function expired(owner, error) {
  if (![401, 403].includes(error.status)) return false
  owner.stop(); clearSession(); documentNavigation.replace('/'); return true
}

export function useImports() {
  const [state, setState] = useState({ config: null, history: [], datasetId: '', loading: true, status: '', failed: false })
  const [uploading, setUploading] = useState(false), [uploadStatus, setUploadStatus] = useState('')
  const lifetime = useRef(null)
  const refresh = useCallback(async () => {
    const owner = lifetime.current
    if (!owner?.active || owner.upload) return
    owner.read?.abort()
    const controller = new AbortController()
    owner.read = controller
    setState(previous => ({ ...previous, loading: true, failed: false, status: '' }))
    try {
      const [config, history] = await Promise.all([loadImportConfig({ signal: controller.signal }), loadImportHistory({ signal: controller.signal })])
      if (controller.signal.aborted || !owner.active) return
      if (!config.datasets.length) throw new Error('Belum ada dataset yang tersedia.')
      const requested = new URLSearchParams(window.location.search).get('datasetId') || currentDatasetId()
      setState(previous => {
        const wanted = previous.datasetId || requested
        const datasetId = config.datasets.some(dataset => dataset.id === wanted) ? wanted : config.datasets[0].id
        return { config, history: history.imports, datasetId, loading: false, status: '', failed: false }
      })
    } catch (error) {
      if (controller.signal.aborted || !owner.active || expired(owner, error)) return
      setState(previous => ({ ...previous, loading: false, failed: true, status: error.message }))
      controller.abort()
    } finally { if (owner.read === controller) owner.read = null }
  }, [])

  useEffect(() => {
    const owner = { active: true, read: null, upload: null, downloads: new Set(), urls: new Map() }
    const stop = () => {
      owner.active = false; owner.read?.abort(); owner.upload?.abort()
      for (const controller of owner.downloads) controller.abort()
      for (const [url, timer] of owner.urls) { window.clearTimeout(timer); URL.revokeObjectURL(url) }
      owner.urls.clear()
    }
    owner.stop = stop; lifetime.current = owner
    window.addEventListener('pagehide', stop)
    void refresh()
    return () => { stop(); window.removeEventListener('pagehide', stop) }
  }, [refresh])

  const upload = useCallback(async ({ datasetId, versionName, file }) => {
    const owner = lifetime.current
    if (!owner?.active || owner.upload) return null
    const controller = new AbortController(), signal = controller.signal
    owner.upload = controller; setUploading(true); setUploadStatus('Mengunggah…')
    try {
      const response = await uploadDataset({ fields: { datasetId, versionName }, file, signal, onProgress: progress => {
        if (owner.active && !signal.aborted) setUploadStatus(`Mengunggah${progress === null ? '' : ` ${progress}%`}…`)
      } })
      signal.throwIfAborted()
      setUploadStatus('Membaca aset dan mencari tambahan…')
      while (owner.active && !signal.aborted) {
        const result = await loadImportStatus({ statusUrl: response.statusUrl, signal })
        signal.throwIfAborted()
        if (result.import.status === 'ready') return `/admin/datasets/import/${encodeURIComponent(response.importId)}/preview`
        if (result.import.status === 'failed') throw new Error(result.import.error?.message || 'File gagal diproses.')
        await delay(signal)
      }
      return null
    } catch (error) {
      if (signal.aborted || !owner.active || expired(owner, error)) return null
      setUploadStatus(error.message); return null
    } finally {
      if (owner.upload === controller) owner.upload = null
      if (owner.active) setUploading(false)
    }
  }, [])

  const download = useCallback(async importId => {
    const owner = lifetime.current
    if (!owner?.active) return
    const controller = new AbortController()
    owner.downloads.add(controller)
    try {
      const { blob, filename } = await downloadDatasetSource({ importId, signal: controller.signal })
      if (controller.signal.aborted || !owner.active) return
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      const timer = window.setTimeout(() => { URL.revokeObjectURL(url); owner.urls.delete(url) }, 1000)
      owner.urls.set(url, timer)
      link.href = url; link.download = filename; document.body.append(link)
      try { link.click() } finally { link.remove() }
    } catch (error) {
      if (controller.signal.aborted || !owner.active || expired(owner, error)) return
      setState(previous => ({ ...previous, status: error.message }))
    } finally { owner.downloads.delete(controller) }
  }, [])

  return { ...state, uploading, uploadStatus, resetUploadStatus: () => setUploadStatus(''), upload, download, refresh, selectDataset: datasetId => setState(previous => ({ ...previous, datasetId })) }
}
