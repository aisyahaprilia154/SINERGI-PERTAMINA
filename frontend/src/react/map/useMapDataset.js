import { useEffect, useState } from 'react'
import { loadActiveDataset, loadActiveOverlays } from '../../services/active-dataset-service.js'
import { createMapReadModel, readRequestedDatasetContext } from '../../domain/map-read-model.js'
import { clearSession } from '../../services/account-session.js'
import { documentNavigation } from '../../services/document-navigation.js'

async function readMapDataset(signal) {
  const context = readRequestedDatasetContext(window.location.search, sessionStorage.getItem('sinergiActiveDatasetId'))
  let payload = await loadActiveDataset({ ...context, signal })
  if (!Array.isArray(payload.overlays)) {
    try { const result = await loadActiveOverlays({ ...context, signal }); payload = { ...payload, overlays: result.overlays || result.items || [] } }
    catch (error) { if (signal.aborted || [401, 403].includes(error.status)) throw error; payload = { ...payload, overlays: [] } }
  }
  signal.throwIfAborted()
  const model = createMapReadModel(payload, window.location.search)
  return {...model, operationalSchema:payload.operationalSchema, recordRevision:payload.recordRevision ?? payload.revision ?? 0}
}

export function useMapDataset() {
  const [state, setState] = useState({ model: null, loading: true, error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController(), signal = controller.signal
    const owner = { active: true }
    const stop = () => { owner.active = false; controller.abort() }
    window.addEventListener('pagehide', stop)
    void readMapDataset(signal).then(model => {
      if (!owner.active || signal.aborted) return
      sessionStorage.setItem('sinergiActiveDatasetId', model.activeContext.datasetId)
      setState({ model, loading: false, error: '' })
    }).catch(error => {
      if (signal.aborted || !owner.active) return
      if ([401, 403].includes(error.status)) { stop(); clearSession(); documentNavigation.replace('/'); return }
      setState({ model: null, loading: false, error: error.message })
    })
    return () => { stop(); window.removeEventListener('pagehide', stop) }
  }, [attempt])
  const retry = () => { setState({ model: null, loading: true, error: '' }); setAttempt(previous => previous + 1) }
  return { ...state, retry }
}
