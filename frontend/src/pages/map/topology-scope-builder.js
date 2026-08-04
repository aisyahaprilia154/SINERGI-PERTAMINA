export function edgeMatchesAssetScope(edge, assetById) {
  const source = assetById.get(edge.sourceId)
  const target = assetById.get(edge.targetId)
  if (!source || !target) return false
  const datasetVersions = compact([
    source.datasetVersionId,
    target.datasetVersionId,
    edge.datasetVersionId,
  ])
  if (new Set(datasetVersions).size > 1) return false
  const sites = compact([
    source.siteScopeId || source.siteId,
    target.siteScopeId || target.siteId,
    edge.siteScopeId || edge.siteId,
  ])
  return new Set(sites).size <= 1
}

export function selectConfirmedComponent(edges, focusedAssetId = null) {
  const components = connectedComponents(edges)
  const selected = focusedAssetId
    ? components.find((ids) => ids.includes(focusedAssetId))
    : null
  return selected || components[0] || []
}

export function connectedComponents(edges = []) {
  const adjacency = new Map()
  edges.forEach(({ sourceId, targetId }) => {
    if (!adjacency.has(sourceId)) adjacency.set(sourceId, new Set())
    if (!adjacency.has(targetId)) adjacency.set(targetId, new Set())
    adjacency.get(sourceId).add(targetId)
    adjacency.get(targetId).add(sourceId)
  })
  const visited = new Set()
  const result = []
  ;[...adjacency.keys()].sort().forEach((startId) => {
    if (visited.has(startId)) return
    const queue = [startId]
    const component = []
    visited.add(startId)
    while (queue.length) {
      const id = queue.shift()
      component.push(id)
      ;[...adjacency.get(id)].sort().forEach((nextId) => {
        if (visited.has(nextId)) return
        visited.add(nextId)
        queue.push(nextId)
      })
    }
    result.push(component)
  })
  return result.sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]))
}

function compact(values) {
  return values.map((value) => String(value || '').trim()).filter(Boolean)
}
