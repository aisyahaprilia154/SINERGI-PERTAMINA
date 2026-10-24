import { buildTopologyDiagramModel } from './topology-diagram-model.js'
import { calculateTopologyDiagramLayout, updateTopologyDiagramLayoutPositions } from '../pages/topology/topology-diagram-layout.js'

export function buildTopologyWorkspaceModel({mapData,graph,roots,state}) {
  const activeContext=mapData.activeContext
  return buildTopologyDiagramModel({
    assets: mapData.assets,
    graph,
    locationGroups: mapData.locationGroups,
    area: state.area,
    datasetId: activeContext.datasetId,
    datasetVersionId: activeContext.datasetVersionId,
    roots,
    mountingRelations: mapData.mountingRelations,
    poleGroups: mapData.poleGroups,
    selectedFamilies: state.selectedFamilies,
    search: state.search,
    showMountingPhysical: state.showMountingPhysical,
    publicationProfile: activeContext.publicationProfile,
    readiness: mapData.topologyReadiness,
  })

}

export function buildTopologyWorkspaceLayout(model,{mapData,state,compact=false,narrow=false,overrides={}}) {
  return updateTopologyDiagramLayoutPositions(calculateTopologyDiagramLayout(model, {
    minWidth: 1240,
    componentColumns: 3,
    componentMaxColumns: 4,
    componentPackingAspectRatio: 2.25,
    layoutStyle: 'central-backbone',
    mountingBoxMinWidth: 248,
    mountingBoxPadding: 24,
    mountingBoxHeaderHeight: 52,
    mountingBoxNodeGapX: 36,
    mountingBoxLevelGapY: 82,
    mountingBoxGapY: 54,
    mountingBoxGapX: 36,
    mountingRootColumns: narrow ? 3
      : compact ? 5 : null,
    mountingRootFrameGap: state.area === 'ft-tegal-baru' ? 64 : null,
    overview: state.area === null,
    frameAssignments: mapData.topologyFrameAssignments,
    customFrames: mapData.topologyFrames,
    retainEmptyFrameIds: [
      state.pendingFrameId,
      ...state.changes.filter((change) => change.type === 'create-frame')
        .map((change) => change.frame?.id),
    ].filter(Boolean),
    ...overrides,
  }),mapData.nodePositions ?? {})
}
