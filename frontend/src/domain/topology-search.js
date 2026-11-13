import { getTopologyDiagramSearchResults } from './topology-diagram-model.js'
import { normalizeSearchText, searchMatchScore } from './search-normalization.js'

export function relationTargetsFor(model, nodeId, queryText) {
    const query = normalizeSearchText(queryText)
    if (!query) return []
    const connectedIds = new Set((model.adjacency.get(nodeId) ?? []).map(({ id }) => id))
    const source = model.nodeById.get(nodeId)
    return model.nodes
      .filter((candidate) => candidate.id !== nodeId && !connectedIds.has(candidate.id))
      .filter(candidate => candidate.areaKey === source?.areaKey)
      .map((candidate) => {
        return { candidate, score: searchMatchScore([candidate.name, candidate.id, candidate.type], query) }
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score
        || String(left.candidate.name || left.candidate.id).localeCompare(
          String(right.candidate.name || right.candidate.id), 'id',
        ))
      .slice(0, 8)
      .map(({ candidate }) => candidate)
  }

export function networkPathFor(model, nodeId) {
    const component = model.components.find(({ nodeIds }) => nodeIds.includes(nodeId))
    if (!component) return [model.nodeById.get(nodeId)].filter(Boolean)
    const root = component.rootId
    const previous = new Map([[root, null]])
    const queue = [root]
    while (queue.length) {
      const current = queue.shift()
      if (current === nodeId) break
      for (const next of model.adjacency.get(current) ?? []) {
        if (!previous.has(next.id)) {
          previous.set(next.id, current)
          queue.push(next.id)
        }
      }
    }
    if (!previous.has(nodeId)) return [model.nodeById.get(nodeId)].filter(Boolean)
    const ids = []
    let cursor = nodeId
    while (cursor) {
      ids.unshift(cursor)
      cursor = previous.get(cursor)
    }
    return ids.map((id) => model.nodeById.get(id)).filter(Boolean)
  }

export function directRelationsFor(model, nodeId) {
    const seen = new Set()
    return (model.adjacency.get(nodeId) ?? []).filter(({ id, edge }) => {
      const key = `${id}:${edge.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).map(({ id, edge }) => ({ other: model.nodeById.get(id), edge })).filter(({ other }) => other)
  }

export function getDeviceSearchResults(model, query) {
  return getTopologyDiagramSearchResults(model, query, Number.POSITIVE_INFINITY)
    .filter((result) => result.kind === 'asset')
    .slice(0, 12)
}
