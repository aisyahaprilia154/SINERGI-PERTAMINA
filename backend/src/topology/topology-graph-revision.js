import { createHash } from 'node:crypto'

export const TOPOLOGY_GRAPH_REVISION_VERSION = 'topology-graph-revision/1.0.0'

/**
 * Returns a graph copy with a deterministic revision derived from the graph
 * payload. The revision is intentionally content-addressed so readers of the
 * same dataset version agree on the graph they are tracing.
 */
export function withTopologyGraphRevision(graph = {}) {
  const normalized = structuredClone(graph)
  delete normalized.graphRevision
  normalized.graphRevision = createTopologyGraphRevision(normalized)
  return normalized
}

export function createTopologyGraphRevision(graph = {}) {
  const content = structuredClone(graph)
  delete content.graphRevision
  const digest = createHash('sha256')
    .update(stableStringify({
      revisionVersion: TOPOLOGY_GRAPH_REVISION_VERSION,
      graph: content,
    }))
    .digest('hex')
    .slice(0, 32)
  return `topology-graph:${digest}`
}

function stableStringify(value) {
  if (value === undefined) return '"__undefined__"'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`
}
