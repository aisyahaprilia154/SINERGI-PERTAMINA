import { stageCameraRelationReplacement } from './camera-relation-draft.js'
import { buildPoleGroups } from './pole-groups.js'
import { adaptActiveDatasetForTopology } from '../adapters/active-dataset-map-adapter.js'
import { saveTopologyDiagram, loadActiveDataset, loadTopologyRoots } from '../services/active-dataset-service.js'

// Owns mutable working data and the last acknowledged snapshot; no DOM dependency.
export function createTopologyDocument({mapData,graph,roots,state,canEditTopology,getModel,rebuild,updatePanelState,showToast,closeFrameNameEditor,signal}) {
  const activeContext=mapData.activeContext
  const captureSavedSnapshot = () => structuredClone({ graph, assets: mapData.assets,
    mountingRelations: mapData.mountingRelations,
    topologyFrameAssignments: mapData.topologyFrameAssignments,
    topologyFrames: mapData.topologyFrames,
    frameNames: state.frameNames,nodePositions:mapData.nodePositions })
  let savedSnapshot=captureSavedSnapshot()
  async function removeRelation(edgeId) {
    if (!canEditTopology) return
    const model = getModel()
    const edge = model.edgeById.get(edgeId)
    if (!edge || state.mutationBusy) return
    const added = state.changes.find(change => change.type === 'add-relation' && change.draftEdgeId === edgeId)
    if (added) state.changes = state.changes.filter(change => change !== added)
    else stageChange({ type: 'remove-edge', edgeId })
    graph = { ...graph, edges: graph.edges.filter(item => (item.id ?? item.relationId) !== edgeId) }
    state.selectedEdgeId = null
    rebuild()
    showToast('Relasi dihapus. Gunakan Batal untuk memulihkannya sebelum disimpan.')
  }

  async function addRelation(sourceAssetId, targetAssetId) {
    if (!canEditTopology) return
    if (!sourceAssetId || !targetAssetId || sourceAssetId === targetAssetId || state.mutationBusy) return
    const model = getModel()
    const target = model.nodeById.get(targetAssetId)
    if (!target) return
    if ((model.adjacency.get(sourceAssetId) ?? []).some(item => item.id === targetAssetId)) return
    const replacement = stageCameraRelationReplacement({
      graph, changes: state.changes, nodes: [...model.nodeById.values()],
      sourceAssetId, targetAssetId,
    })
    graph = replacement.graph
    state.changes = replacement.changes
    const savedEdge = savedSnapshot.graph.edges.find(edge => {
      const a = edge.sourceAssetId ?? edge.sourceNodeId
      const b = edge.targetAssetId ?? edge.targetNodeId
      return (a === sourceAssetId && b === targetAssetId)
        || (a === targetAssetId && b === sourceAssetId)
    })
    const savedEdgeId = savedEdge?.id ?? savedEdge?.relationId
    if (savedEdgeId && state.changes.some(change =>
      change.type === 'remove-edge' && change.edgeId === savedEdgeId)) {
      state.changes = state.changes.filter(change =>
        change.type !== 'remove-edge' || change.edgeId !== savedEdgeId)
      graph = { ...graph, edges: [...graph.edges, savedEdge] }
      state.relationSearch = ''
      state.selectedAssetId = sourceAssetId
      rebuild()
      showToast('Relasi awal dipulihkan.')
      return
    }
    const id = `draft-edge:${crypto.randomUUID()}`
    graph = { ...graph, edges: [...graph.edges, { id, relationId: id, sourceAssetId, targetAssetId,
      sourceNodeId: sourceAssetId, targetNodeId: targetAssetId, relationType: 'connected-to',
      direction: 'undirected', verificationStatus: 'confirmed', provenance: 'manual_admin' }] }
    stageChange({ type: 'add-relation', sourceAssetId, targetAssetId, draftEdgeId: id })
    state.relationSearch = ''
    state.selectedAssetId = sourceAssetId
    rebuild()
    if (replacement.replaced.length) showToast('Relasi JB utama sebelumnya diganti. Batal akan memulihkannya.')
  }

  function stageChange(change) {
    if (!canEditTopology) return
    if (['mount', 'move-frame', 'rename-frame','move-node'].includes(change.type)) {
      state.changes = state.changes.filter(item => item.type !== change.type || item.assetId !== change.assetId)
    }
    if (change.type === 'create-frame') {
      state.changes = state.changes.filter(item => item.type !== 'create-frame' || item.frame?.id !== change.frame?.id)
    }
    state.changes.push(change)
    state.saveError = ''
    updatePanelState()
  }

  function cancelDraft() {
    if (state.mutationBusy) return
    const snapshot = structuredClone(savedSnapshot)
    graph = snapshot.graph
    mapData.topologyGraph = graph
    mapData.assets = snapshot.assets
    applyMutationResponse({ mountingRelations: snapshot.mountingRelations })
    mapData.topologyFrameAssignments = snapshot.topologyFrameAssignments ?? {}
    mapData.topologyFrames = snapshot.topologyFrames ?? {}
    mapData.nodePositions = snapshot.nodePositions ?? {}
    state.frameNames = snapshot.frameNames
    state.changes = []
    state.saveError = ''
    closeFrameNameEditor()
    rebuild()
  }

  async function saveDraft() {
    if (!canEditTopology) return
    if (!state.changes.length || state.mutationBusy) return
    await runMutation(async () => {
      const response = await saveTopologyDiagram({ datasetId: activeContext.datasetId,
        expectedRecordRevision: mapData.recordRevision, signal,
        changes: state.changes.map(({ draftEdgeId, ...change }) => change) })
      signal?.throwIfAborted()
      applyMutationResponse(response)
      mapData.recordRevision = response.recordRevision
      mapData.topologyFrameAssignments = response.topologyFrameAssignments ?? {}
      mapData.topologyFrames = response.topologyFrames ?? {}
      mapData.nodePositions = response.nodePositions ?? {}
      state.frameNames = Object.fromEntries(Object.entries(response.topologyFrameNames ?? {}).map(([id, name]) => [id.startsWith('pole-group:')||id.startsWith('excluded-mounting:')?id:`pole-group:${id}`, name]))
      state.changes = []
      state.saveError = ''
      savedSnapshot = captureSavedSnapshot()
      rebuild()
      try {
        const persisted = await loadActiveDataset({ datasetId: activeContext.datasetId,
          branchId: activeContext.branchId, view: 'topology', signal })
        signal?.throwIfAborted()
        if (persisted.datasetVersion?.id !== activeContext.datasetVersionId) {
          throw new Error('Versi dataset berubah sesudah penyimpanan.')
        }
        const refreshed = adaptActiveDatasetForTopology(persisted)
        mapData.assets = refreshed.assets
        mapData.locationGroups = refreshed.locationGroups
        applyMutationResponse({
          graph: refreshed.topologyGraph,
          mountingRelations: refreshed.mountingRelations,
          topologyFrameAssignments: persisted.topologyFrameAssignments,
          topologyFrames: persisted.topologyFrames,
        })
        mapData.recordRevision = persisted.recordRevision
        const refreshedRoots = Array.isArray(persisted.topologyRoots)
          ? { roots: persisted.topologyRoots }
          : refreshed.topologyGraph.graphRevision
            ? await loadTopologyRoots({ datasetId:activeContext.datasetId,datasetVersionId: activeContext.datasetVersionId,
              graphRevision: refreshed.topologyGraph.graphRevision, signal }).catch(() => null)
            : null
        signal?.throwIfAborted()
        roots = refreshedRoots?.roots ?? refreshedRoots?.items ?? []
        state.frameNames = Object.fromEntries(Object.entries(persisted.topologyFrameNames ?? {})
          .map(([id, name]) => [id.startsWith('pole-group:')||id.startsWith('excluded-mounting:')?id:`pole-group:${id}`, name]))
        savedSnapshot = captureSavedSnapshot()
        rebuild()
      } catch {
        if (signal?.aborted) return
        showToast('Perubahan tersimpan. Muat ulang halaman untuk menyegarkan diagram.')
      }
    })
  }

  async function runMutation(operation) {
    if (state.mutationBusy || signal?.aborted) return
    state.mutationBusy = true
    updatePanelState()
    try {
      await operation()
    } catch (error) {
      if (signal?.aborted) return
      state.saveError = error?.message || 'Perubahan belum dapat disimpan.'
      showToast(error?.message || 'Perubahan belum dapat disimpan. Coba lagi.')
    } finally {
      state.mutationBusy = false
      if (!signal?.aborted) updatePanelState()
    }
  }

  function applyMutationResponse(response) {
    if (response?.graph) {
      graph = response.graph
      mapData.topologyGraph = response.graph
    }
    if (response && Object.prototype.hasOwnProperty.call(response, 'topologyFrameAssignments')) {
      mapData.topologyFrameAssignments = structuredClone(response.topologyFrameAssignments ?? {})
    }
    if (response && Object.prototype.hasOwnProperty.call(response, 'topologyFrames')) {
      mapData.topologyFrames = structuredClone(response.topologyFrames ?? {})
    }
    if (Array.isArray(response?.mountingRelations)) {
      mapData.mountingRelations = response.mountingRelations
      mapData.poleGroups = buildPoleGroups({
        assets: mapData.assets,
        mountingRelations: mapData.mountingRelations,
      })
      const mountedOnByAsset = new Map(response.mountingRelations.map((relation) => [
        relation.sourceAssetId,
        relation.targetAssetId,
      ]))
      const manualMounts = new Set(response.mountingRelations.filter(relation => relation.provenance === 'manual_admin').map(relation => relation.sourceAssetId))
      const childrenByPole = new Map()
      response.mountingRelations.forEach(relation => {
        const children = childrenByPole.get(relation.targetAssetId) ?? []
        children.push(relation.sourceAssetId)
        childrenByPole.set(relation.targetAssetId, children)
      })
      mapData.assets.forEach((asset) => {
        asset.mountedOnAssetId = mountedOnByAsset.get(asset.id) ?? null
        asset.mountedAssetIds = childrenByPole.get(asset.id) ?? []
        if (manualMounts.has(asset.id)) asset.mountingExpectation = 'pole'
      })
      graph.nodes?.forEach(node => {
        node.mountedOnAssetId = mountedOnByAsset.get(node.id) ?? null
        node.mountedAssetIds = childrenByPole.get(node.id) ?? []
        if (manualMounts.has(node.id)) node.mountingExpectation = 'pole'
      })
    }
  }

  return {get graph(){return graph},get roots(){return roots},stageChange,cancelDraft,saveDraft,applyMutationResponse,addRelation,removeRelation}
}
