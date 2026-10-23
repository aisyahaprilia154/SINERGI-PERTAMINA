import { useEffect, useState } from 'react'
import { loadImportConfig } from '../../services/import-dataset-service.js'
import { currentDatasetId } from '../../services/operational-api.js'
import { clearSession } from '../../services/account-session.js'
import { documentNavigation } from '../../services/document-navigation.js'

export function useDatasetConfig() {
  const [attempt, setAttempt] = useState(0)
  const [config, setConfig] = useState({ datasets: [], datasetId: '', loading: true, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    const stop = () => controller.abort()
    window.addEventListener('pagehide', stop)
    void loadImportConfig({ signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return
      if (!result.datasets.length) throw new Error('Belum ada dataset yang tersedia.')
      const requested = new URLSearchParams(window.location.search).get('datasetId') || currentDatasetId()
      const datasetId = result.datasets.some(dataset => dataset.id === requested) ? requested : result.datasets[0].id
      setConfig({ datasets: result.datasets, datasetId, loading: false, error: '' })
    }).catch(error => {
      if (controller.signal.aborted) return
      if ([401, 403].includes(error.status)) { clearSession(); documentNavigation.replace('/'); return }
      setConfig({ datasets: [], datasetId: '', loading: false, error: error.message })
    })
    return () => { stop(); window.removeEventListener('pagehide', stop) }
  }, [attempt])
  return { ...config, selectDataset: datasetId => setConfig(previous => ({ ...previous, datasetId })), retry: () => { setConfig(previous => ({ ...previous, loading: true, error: '' })); setAttempt(value => value + 1) } }
}
