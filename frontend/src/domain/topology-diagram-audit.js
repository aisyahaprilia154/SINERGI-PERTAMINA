function pairKey(left, right) {
  return [left, right].sort().join('\u0000')
}

export function auditTopologyDiagram({ model, layout, mountingRelations = [] }) {
  const confirmedPairs = new Set((model.edges ?? [])
    .map(edge => pairKey(edge.sourceId, edge.targetId)))
  const visiblePairs = new Set((layout.edges ?? [])
    .map(edge => pairKey(edge.sourceId, edge.targetId)))
  const poleByAssetId = new Map(mountingRelations
    .filter(item => !['rejected', 'revoked'].includes(item.verificationStatus))
    .map(item => [item.sourceAssetId, item.targetAssetId]))
  const visibleNodeIds = new Set((layout.nodes ?? []).map(node => node.id))
  const framePoleByAssetId = new Map((layout.mountingBoxes ?? []).flatMap(box =>
    box.hostId ? (box.nodeIds ?? []).map(assetId => [assetId, box.hostId]) : []))
  const issues = []
  for (const edge of layout.edges ?? []) {
    if (!confirmedPairs.has(pairKey(edge.sourceId, edge.targetId))) {
      issues.push({ code: 'visual_edge_without_relation', edgeId: edge.id ?? null,
        sourceAssetId: edge.sourceId, targetAssetId: edge.targetId })
    }
  }
  for (const edge of model.edges ?? []) {
    if (!visiblePairs.has(pairKey(edge.sourceId, edge.targetId))) {
      issues.push({ code: 'relation_not_drawn', edgeId: edge.id ?? null,
        sourceAssetId: edge.sourceId, targetAssetId: edge.targetId })
    }
  }
  for (const box of layout.mountingBoxes ?? []) {
    if (!box.hostId) continue
    for (const assetId of box.nodeIds ?? []) {
      if (poleByAssetId.get(assetId) !== box.hostId) {
        issues.push({ code: 'pole_frame_without_mounting', assetId,
          frameId: box.id, poleAssetId: box.hostId,
          storedPoleAssetId: poleByAssetId.get(assetId) ?? null })
      }
    }
  }
  for (const [assetId, poleAssetId] of poleByAssetId) {
    if (visibleNodeIds.has(assetId) && framePoleByAssetId.get(assetId) !== poleAssetId) {
      issues.push({ code: 'mounting_not_in_pole_frame', assetId, poleAssetId,
        displayedPoleAssetId: framePoleByAssetId.get(assetId) ?? null })
    }
  }
  return { issues, counts: {
    visibleEdges: (layout.edges ?? []).length,
    confirmedEdges: (model.edges ?? []).length,
    poleFrames: (layout.mountingBoxes ?? []).filter(box => box.hostId).length,
    mismatches: issues.length,
  } }
}
