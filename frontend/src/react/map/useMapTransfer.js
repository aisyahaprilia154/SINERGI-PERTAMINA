import { useEffect, useRef } from 'react'
import { openMapDataTransferDialog } from '../../pages/map/map-data-transfer-dialog.js'
import { branchNameForFacility } from '../../domain/facility-branch.js'

// Temporary compatibility for the existing transfer dialog until stage 12.
// It never owns the React page or its drawer, forms, state or map container.
export function useMapTransfer() {
  const dialog = useRef(null)
  useEffect(() => {
    const dispose = () => { dialog.current?.close(); dialog.current?.dispatchEvent(new Event('close')); dialog.current?.remove(); dialog.current = null }
    window.addEventListener('pagehide', dispose)
    return () => { dispose(); window.removeEventListener('pagehide', dispose) }
  }, [])
  return (model, selection, mode) => {
    if (dialog.current?.open) return
    dialog.current = openMapDataTransferDialog({ activeContext: { ...model.activeContext, branchName: branchNameForFacility(model.selectedArea, model.activeContext.branchName) }, areaScopeLabel: model.selectedArea?.name || null, networks: model.networks, selectedNetworkIds: selection.selectedNetworkIds, initialMode: mode })
  }
}
