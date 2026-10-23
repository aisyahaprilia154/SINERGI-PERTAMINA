import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDatasetVersions, saveDatasetVersion, restoreDatasetVersion } from '../../services/dataset-versions-service.js'
import { clearSession } from '../../services/account-session.js'
import { documentNavigation } from '../../services/document-navigation.js'

function endSession(owner) { owner.stop(); clearSession(); documentNavigation.replace('/') }

export function useDatasetVersions(datasetId, onBusy) {
  const [state, setState] = useState({ data: null, valid: false, loading: true, status: 'Memuat versi database…', failed: false })
  const [busy, setBusy] = useState(false)
  const lifetime = useRef(null)
  const refresh = useCallback(async ({ keepMessage = false } = {}) => {
    const owner = lifetime.current
    if (!owner?.active || owner.write) return
    owner.read?.abort()
    const controller = new AbortController()
    owner.read = controller
    setState(previous => ({ ...previous, loading: true }))
    try {
      const data = await loadDatasetVersions(datasetId, { signal: controller.signal })
      if (controller.signal.aborted || !owner.active) return
      setState(previous => ({ data, valid: true, loading: false, status: keepMessage ? previous.status : '', failed: false }))
    } catch (error) {
      if (controller.signal.aborted || !owner.active) return
      if ([401, 403].includes(error.status)) { endSession(owner); return }
      setState(previous => ({ ...previous, valid: false, loading: false, status: error.message, failed: true }))
    } finally { if (owner.read === controller) owner.read = null }
  }, [datasetId])

  useEffect(() => {
    const owner = { active: true, read: null, write: null }
    lifetime.current = owner
    const storage = event => { if (event.key === `sinergi:revision:${datasetId}`) void refresh() }
    const focus = () => { void refresh() }
    const stop = () => {
      owner.active = false; owner.read?.abort(); owner.write?.abort()
      window.removeEventListener('storage', storage)
      window.removeEventListener('focus', focus)
    }
    owner.stop = stop
    window.addEventListener('storage', storage)
    window.addEventListener('focus', focus)
    window.addEventListener('pagehide', stop)
    void refresh()
    return () => { stop(); window.removeEventListener('pagehide', stop) }
  }, [datasetId, refresh])

  const write = useCallback(async (snapshot, name) => {
    const owner = lifetime.current
    if (!owner?.active || owner.write || snapshot.datasetId !== datasetId) return null
    owner.read?.abort(); owner.read = null
    const controller = new AbortController()
    owner.write = controller
    setBusy(true); onBusy(true)
    try {
      const options = { signal: controller.signal }
      const result = snapshot.version
        ? await restoreDatasetVersion({ datasetId, versionId: snapshot.version.id, expectedRevision: snapshot.expectedRevision }, options)
        : await saveDatasetVersion({ datasetId, name, expectedRevision: snapshot.expectedRevision }, options)
      return controller.signal.aborted || !owner.active ? null : result
    } catch (error) {
      if (controller.signal.aborted || !owner.active) return null
      if ([401, 403].includes(error.status)) { endSession(owner); return null }
      throw error
    } finally {
      if (owner.write === controller) owner.write = null
      if (owner.active) { setBusy(false); onBusy(false) }
    }
  }, [datasetId, onBusy])
  const setMessage = message => setState(previous => ({ ...previous, status: message }))
  return { ...state, busy, refresh, write, setMessage }
}
