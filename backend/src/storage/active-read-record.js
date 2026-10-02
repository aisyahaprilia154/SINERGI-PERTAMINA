import { ACTIVE_TOPOLOGY_PROJECTION_VERSION, prepareActiveTopologyRecord } from '../domain/active-topology-projection.js'

export const ACTIVE_READ_RECORD_VERSION = 'active-read-record/2:' + ACTIVE_TOPOLOGY_PROJECTION_VERSION

// The archive remains intact in dataset_versions. Build this smaller read
// model while writing, so opening a map never has to unpack the import archive.
export function projectActiveReadRecord(record) {
  const { topologyShadowArtifacts, identityRegistry, assetIdentityRegistry,
    canonicalParser, assetIdentityMap, topologyCandidates, ...operational } = record
  return prepareActiveTopologyRecord({
    ...operational,
    ...(canonicalParser ? { canonicalParser: { sourceSelection: canonicalParser.sourceSelection } } : {}),
    ...(assetIdentityMap ? { assetIdentityMap: withoutIdentityRegistry(assetIdentityMap) } : {}),
    ...(Array.isArray(topologyCandidates) ? { topologyCandidates: topologyCandidates.map(item => ({
      sourceAssetId: item.sourceAssetId, sourceNodeId: item.sourceNodeId,
      sourceFeatureId: item.sourceFeatureId, targetAssetId: item.targetAssetId,
      targetNodeId: item.targetNodeId, targetSourceFeatureId: item.targetSourceFeatureId,
      status: item.status,
    })) } : topologyCandidates === undefined ? {} : { topologyCandidates }),
  })
}

function withoutIdentityRegistry(map) {
  const { identityRegistry, ...operational } = map
  return operational
}
