import { calculateTopologyDiagramLayout } from './topology-diagram-layout.js'

self.addEventListener('message', (event) => {
  const { requestId, model, options = {} } = event.data
  try {
    const layout = calculateTopologyDiagramLayout(model, options)
    self.postMessage({ requestId, status: 'ready', layout })
  } catch (error) {
    self.postMessage({
      requestId,
      status: 'error',
      message: error instanceof Error ? error.message : 'Layout topology gagal.',
    })
  }
})
