import {registerNavigationGuard} from '../../services/navigation-guards.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildPoleGroups, createAssetReferenceIndex, mergeMountingRelations } from '../../domain/pole-groups.js'
import { saveActiveAssetIcon, saveTopologyDiagram } from '../../services/active-dataset-service.js'
import { clearSession } from '../../services/account-session.js'
import { documentNavigation } from '../../services/document-navigation.js'

// The document owns writes, so switching drawers cannot apply a response to the
// wrong asset. Only server-confirmed projections replace the visible graph.
export function useMapDocument(initial, canEdit) {
  const [model, setModel] = useState(initial), [busy, setBusy] = useState(false), [stale, setStale] = useState('')
  const current = useRef(initial), owner = useRef(null), dirtyRef = useRef(false), blocked = useRef(false), transferGuardRef = useRef({dirty:false,busy:false})
  useEffect(() => {
    const controller = new AbortController(); owner.current = { controller, busy: false }
    const revision = event => {
      if (event.key !== `sinergi:revision:${initial.activeContext.datasetId}` || !event.newValue || Number(event.newValue) <= current.current.recordRevision) return
      blocked.current = true
      if (dirtyRef.current || owner.current.busy || transferGuardRef.current.dirty || transferGuardRef.current.busy) setStale('Data berubah di halaman lain. Muat ulang sebelum menyimpan.')
      else documentNavigation.reload()
    }
    const unload = event => { if (dirtyRef.current || owner.current?.busy || transferGuardRef.current.dirty || transferGuardRef.current.busy) { event.preventDefault(); event.returnValue = '' } }
    const stop = () => controller.abort()
    const removeGuard=registerNavigationGuard(()=>({dirty:dirtyRef.current||transferGuardRef.current.dirty,busy:owner.current?.busy||transferGuardRef.current.busy}))
    window.addEventListener('storage', revision); window.addEventListener('beforeunload', unload); window.addEventListener('pagehide', stop)
    return () => { removeGuard();stop(); window.removeEventListener('storage', revision); window.removeEventListener('beforeunload', unload); window.removeEventListener('pagehide', stop) }
  }, [initial])
  async function write({ assetId, dataUrl, changes }) {
    const transaction = owner.current
    if (!canEdit) throw new Error('Hanya Administrator yang dapat mengubah aset.')
    if (blocked.current) throw new Error('Data berubah. Muat ulang sebelum menyimpan.')
    if (!transaction || transaction.controller.signal.aborted || transaction.busy) return null
    transaction.busy = true; setBusy(true)
    const previous = current.current, signal = transaction.controller.signal
    try {
      const options = { ...previous.activeContext, expectedRecordRevision: previous.recordRevision, signal }
      const response = changes ? await saveTopologyDiagram({ ...options, changes }) : await saveActiveAssetIcon({ ...options, assetId, dataUrl })
      signal.throwIfAborted()
      if (response.recordRevision !== undefined && response.recordRevision < previous.recordRevision) throw new Error('Revision respons lebih lama dari data saat ini. Muat ulang peta.')
      if (changes && (!response.graph || !Array.isArray(response.graph.edges))) throw new Error('Graph relasi terbaru tidak tersedia dari server.')
      const icon = changes ? null : { customIconUrl: response.customIconUrl === undefined ? dataUrl : response.customIconUrl, iconReset: response.iconReset ?? false }
      const mountingRelations = response.mountingRelations ? mergeMountingRelations([response.mountingRelations], createAssetReferenceIndex(previous.all.assets)) : previous.mountingRelations
      const project = asset => ({ ...asset, ...(icon && asset.id === assetId ? icon : {}), ...(response.mountingRelations ? {
        mountedOnAssetId: mountingRelations.find(item => item.sourceAssetId === asset.id)?.targetAssetId ?? null,
        mountedAssetIds: mountingRelations.filter(item => item.targetAssetId === asset.id).map(item => item.sourceAssetId),
        mountingRelations: mountingRelations.filter(item => item.sourceAssetId === asset.id || item.targetAssetId === asset.id),
      } : {}) })
      const assets = previous.assets.map(project), all = { ...previous.all, assets: previous.all.assets.map(project), diagramAssets: previous.all.diagramAssets.map(project) }
      const next = { ...previous, all, assets,
        activeContext: previous.operationalSchema === 2 ? {...previous.activeContext, activePointerRevision:response.recordRevision ?? response.revision ?? previous.recordRevision} : previous.activeContext, diagramAssets: previous.diagramAssets.map(project), assetById: Object.fromEntries(assets.map(asset => [asset.id, asset])),
        recordRevision: response.recordRevision ?? response.revision ?? previous.recordRevision,
        topologyGraph: response.graph ?? previous.topologyGraph, mountingRelations,
        mountingCandidates: response.mountingCandidates ?? previous.mountingCandidates,
        mountingOptions: response.mountingOptions ?? previous.mountingOptions,
        poleGroups: response.mountingRelations ? buildPoleGroups({ assets, mountingRelations }) : previous.poleGroups,
      }
      current.current = next; setModel(next)
      return response
    } catch (error) {
      if (signal.aborted) throw error
      if ([401, 403].includes(error.status)) { clearSession(); documentNavigation.replace('/') }
      if (error.status === 409) { blocked.current = true; setStale('Data sudah berubah. Muat ulang peta sebelum mencoba menyimpan kembali.') }
      throw error
    } finally { transaction.busy = false; if (!signal.aborted) setBusy(false) }
  }
  const permitLeave = useCallback((documentChange = false) => {
    if (owner.current?.busy || transferGuardRef.current.busy) return false
    const permitted = !(dirtyRef.current || transferGuardRef.current.dirty) || window.confirm('Buang perubahan detail aset yang belum disimpan?')
    // A confirmed full-document action must not trigger a second native prompt.
    if (permitted && documentChange) { dirtyRef.current = false; transferGuardRef.current = {dirty:false,busy:false} }
    return permitted
  }, [])
  const setTransferGuard = useCallback(guard => { transferGuardRef.current = guard }, [])
  return { model, busy, stale, dirtyRef, write, permitLeave, setTransferGuard }
}
