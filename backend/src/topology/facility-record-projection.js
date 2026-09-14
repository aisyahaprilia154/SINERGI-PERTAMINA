import {
  FACILITY_CORRECTION_VERSION,
  correctFacilityEdges,
  correctedMountingExpectation,
  facilityRelations,
} from '../../../shared/facility-corrections.mjs'
import { buildAssetIdentityMapFromRecord, createAssetIdentityResolver } from '../domain/canonical-asset-identity.js'
import { withTopologyGraphRevision } from './topology-graph-revision.js'

// Apply published facility facts to older stored datasets as well as freshly
// regenerated ones. This is a read projection: the source aggregate is immutable.
export function projectFacilityRecord(record) {
  if (!record || record.facilityCorrectionVersion === FACILITY_CORRECTION_VERSION) return record
  const resolver = createAssetIdentityResolver(buildAssetIdentityMapFromRecord(record))
  const layers = new Map((record.layers ?? []).map(layer => [layer.id, layer]))
  const metadata = new Map()
  for (const asset of [...(record.assets ?? []), ...(record.topologyInputBundle?.classifiedNodes ?? [])]) {
    const id = resolver.resolve(asset.canonicalAssetId ?? asset.assetId ?? asset.id)
    if (!id) continue
    metadata.set(id, { ...metadata.get(id), ...asset, id, assetId: id, canonicalAssetId: id,
      sourceFolderPath: asset.sourceFolderPath ?? layers.get(asset.layerId)?.sourceFolderPath,
      name: asset.sourceName ?? asset.name,
    })
  }
  const assets = [...metadata.values()]
  const facts = facilityRelations(assets)
  const exclusions = new Map(assets.flatMap(asset => {
    const expectation = correctedMountingExpectation(asset)
    return expectation ? [[asset.id, expectation]] : []
  }))
  if (!facts.length && !exclusions.size) return record
  const sourceId = relation => resolver.resolve(relation.sourceAssetId ?? relation.assetId)
  const expectations = new Map((record.mountingExpectations ?? []).map(item => [
    resolver.resolve(item.assetId), { ...item, assetId: resolver.resolve(item.assetId) },
  ]))
  for (const [assetId, expectation] of exclusions) {
    expectations.set(assetId, {assetId, expectation, provenance: 'facility_topology_correction',
      reason: 'Koreksi pemasangan FT Tegal Baru dari pengguna.', updatedAt: '2026-09-14T00:00:00.000Z'})
  }
  const mountingRelations = (record.mountingRelations ?? []).filter(r => !exclusions.has(sourceId(r)))
  const graph = record.topologyGraph ?? {nodes: [], edges: []}
  const nodeById = new Map((graph.nodes ?? []).map(node => {
    const id = resolver.resolve(node.canonicalAssetId ?? node.assetId ?? node.id)
    return [id, {...metadata.get(id), ...node, id, assetId: id, canonicalAssetId: id}]
  }))
  for (const fact of facts) {
    for (const id of [fact.sourceAssetId, fact.targetAssetId]) {
      if (!nodeById.has(id)) nodeById.set(id, metadata.get(id))
    }
  }
  const normalizeEdge = edge => ({...edge,
    sourceAssetId: resolver.resolve(edge.sourceAssetId ?? edge.sourceNodeId) ?? edge.sourceAssetId,
    targetAssetId: resolver.resolve(edge.targetAssetId ?? edge.targetNodeId) ?? edge.targetAssetId,
  })
  const edges = correctFacilityEdges((graph.edges ?? []).map(normalizeEdge), assets)
  const degreeByNode = Object.fromEntries([...nodeById.keys()].map(id => [id, 0]))
  for (const edge of edges) {
    degreeByNode[edge.sourceAssetId] = (degreeByNode[edge.sourceAssetId] ?? 0) + 1
    degreeByNode[edge.targetAssetId] = (degreeByNode[edge.targetAssetId] ?? 0) + 1
  }
  return {...record, facilityCorrectionVersion: FACILITY_CORRECTION_VERSION,
    confirmedRelations: correctFacilityEdges((record.confirmedRelations ?? []).map(normalizeEdge), assets),
    relations: (record.relations ?? []).filter(r => r.relationType !== 'mounted_on' || !exclusions.has(sourceId(r))),
    mountingRelations,
    mountingExpectations: [...expectations.values()],
    mountingCandidates: (record.mountingCandidates ?? []).filter(r => !exclusions.has(sourceId(r))),
    mountingOptions: (record.mountingOptions ?? []).filter(r => !exclusions.has(sourceId(r))),
    mountingOverrides: (record.mountingOverrides ?? []).filter(r => !exclusions.has(sourceId(r))),
    mountingReviewItems: (record.mountingReviewItems ?? []).map(item => {
      const assetId = resolver.resolve(item.assetId), expectation = exclusions.get(assetId)
      return expectation ? {...item, assetId, mountingExpectation: expectation,
        expectationProvenance: 'facility_topology_correction', reviewStatus: expectation,
        workflowStatus: `excluded_${expectation}`, targetAssetId: null, relationId: null,
        candidateCount: 0, optionCount: 0, options: [], warnings: []} : item
    }),
    topologyGraph: withTopologyGraphRevision({...graph, nodes: [...nodeById.values()].filter(Boolean),
      edges, components: [], degreeByNode,
      isolatedNodeIds: Object.keys(degreeByNode).filter(id => degreeByNode[id] === 0).sort(),
      facilityCorrectionVersion: FACILITY_CORRECTION_VERSION}),
  }
}
