import { useCallback, useEffect, useRef, useState } from 'react'
import { loadImportPreview, loadImportStatus, decideImportItem, activateDatasetVersion, refreshImportPreview, downloadDatasetSource } from '../../services/import-dataset-service.js'
import { loadActiveDataset } from '../../services/active-dataset-service.js'
import { abortableDelay } from '../../services/abortable-delay.js'
import { clearSession } from '../../services/account-session.js'
import { documentNavigation } from '../../services/document-navigation.js'

export function useImportPreview(importId) {
  const [state, setState] = useState({ preview: null, baseline: null, busy: true, error: '', loading: true })
  const lifetime = useRef(null)
  const run = useCallback(async (action = 'load', itemId, decision) => {
    const owner = lifetime.current
    if (!owner?.active || owner.request) return
    const controller = new AbortController(), signal = controller.signal
    owner.request = controller
    setState(previous => ({ ...previous, busy: true, error: '' }))
    const read = async () => {
      const preview = await loadImportPreview({ importId, signal })
      const baseline = await loadActiveDataset({ datasetId: preview.import.dataset_id, signal })
      signal.throwIfAborted()
      if (owner.active) { owner.preview = preview; setState(previous => ({ ...previous, preview, baseline, loading: false })) }
    }
    try {
      if (action === 'apply') {
        const preview = owner.preview
        if (!preview || preview.summary.conflicts || preview.import.status !== 'ready') return
        await activateDatasetVersion({ importId, expectedRevision: preview.baseRevision, signal })
        signal.throwIfAborted()
        documentNavigation.assign(`/map?datasetId=${encodeURIComponent(preview.import.dataset_id)}`)
      } else if (action === 'source') {
        const { blob, filename } = await downloadDatasetSource({ importId, signal })
        signal.throwIfAborted()
        const url = URL.createObjectURL(blob), link = document.createElement('a')
        const timer = window.setTimeout(() => { URL.revokeObjectURL(url); owner.urls.delete(url) }, 1000)
        owner.urls.set(url, timer); link.href = url; link.download = filename; document.body.append(link)
        try { link.click() } finally { link.remove() }
      } else {
        if (action === 'decision') await decideImportItem({ importId, itemId, decision, signal })
        if (action === 'refresh') {
          await refreshImportPreview({ importId, signal })
          while (!signal.aborted) {
            const result = await loadImportStatus({ statusUrl: `/api/imports/${encodeURIComponent(importId)}`, signal })
            signal.throwIfAborted()
            if (result.import.status === 'ready') break
            if (result.import.status === 'failed') throw new Error(result.import.error?.message || 'Preview gagal diperbarui.')
            await abortableDelay(signal)
          }
        }
        await read()
      }
    } catch (error) {
      if (signal.aborted || !owner.active) return
      if ([401, 403].includes(error.status)) { owner.stop(); clearSession(); documentNavigation.replace('/'); return }
      // A stale revision needs fresh data before the next apply attempt.
      if (error.status === 409) {
        try { await read() } catch (reloadError) {
          if (!signal.aborted && owner.active && [401, 403].includes(reloadError.status)) { owner.stop(); clearSession(); documentNavigation.replace('/'); return }
          if (owner.active && !signal.aborted) { owner.preview = null; setState(previous => ({ ...previous, preview: null, baseline: null })) }
        }
      }
      if (owner.active && !signal.aborted) setState(previous => ({ ...previous, error: error.message, loading: false }))
    } finally {
      if (owner.request === controller) owner.request = null
      if (owner.active) setState(previous => ({ ...previous, busy: false }))
    }
  }, [importId])
  useEffect(() => {
    const owner = { active: true, request: null, preview: null, urls: new Map() }
    const stop = () => { owner.active = false; owner.request?.abort(); for (const [url, timer] of owner.urls) { window.clearTimeout(timer); URL.revokeObjectURL(url) }; owner.urls.clear() }
    owner.stop = stop; lifetime.current = owner
    setState({ preview: null, baseline: null, busy: true, error: '', loading: true })
    window.addEventListener('pagehide', stop); void run()
    return () => { stop(); window.removeEventListener('pagehide', stop) }
  }, [run])
  return { ...state, run }
}
