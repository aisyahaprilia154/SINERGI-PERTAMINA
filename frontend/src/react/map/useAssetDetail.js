import { useEffect, useState } from 'react'
import { loadActiveAssetDetail } from '../../services/active-dataset-service.js'
import { adaptActiveAssetDetail } from '../../adapters/active-dataset-map-adapter.js'
import { clearSession } from '../../services/account-session.js'
import { documentNavigation } from '../../services/document-navigation.js'

export function useAssetDetail(asset, context) {
  const [result, setResult] = useState(null), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController(), signal = controller.signal
    const stop = () => controller.abort()
    window.addEventListener('pagehide', stop)
    void loadActiveAssetDetail({ datasetId: context.datasetId, assetId: asset.id, signal }).then(payload => {
      signal.throwIfAborted()
      if ((payload.operationalSchema === 2 ? payload.recordRevision ?? payload.revision : payload.activePointer?.revision) !== context.activePointerRevision) throw new Error('Dataset aktif berubah saat detail dimuat. Muat ulang peta untuk menggunakan versi terbaru.')
      setResult({ base: asset, attempt, asset: adaptActiveAssetDetail(payload, asset), error: '' })
    }).catch(error => {
      if (signal.aborted) return
      if ([401, 403].includes(error.status)) { clearSession(); documentNavigation.replace('/'); return }
      setResult({ base: asset, attempt, error: error.message })
    })
    return () => { stop(); window.removeEventListener('pagehide', stop) }
  }, [asset, context, attempt])
  const resolved = result?.base === asset && result.attempt === attempt
  return { asset: resolved && result.asset ? result.asset : asset, loading: !resolved, error: resolved ? result.error : '', retry: () => setAttempt(value => value + 1) }
}
