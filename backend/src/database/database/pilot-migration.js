import { readFile } from 'node:fs/promises'

export const PILOT_PROJECTION_TABLES = Object.freeze([
  'dataset_versions',
  'source_features',
  'source_geometries',
  'classified_objects',
  'topology_jobs',
  'topology_candidates',
  'topology_components',
  'topology_interfaces',
  'confirmed_relations',
  'graph_revisions',
  'graph_nodes',
  'graph_edges',
  'accuracy_evaluations',
  'audit_events',
])

const COUNT_QUERIES = Object.freeze({
  dataset_versions: 'SELECT COUNT(*)::int AS count FROM dataset_versions WHERE id = $1',
  source_features: 'SELECT COUNT(*)::int AS count FROM source_features WHERE dataset_version_id = $1',
  source_geometries: 'SELECT COUNT(*)::int AS count FROM source_geometries WHERE dataset_version_id = $1',
  classified_objects: 'SELECT COUNT(*)::int AS count FROM classified_objects WHERE dataset_version_id = $1',
  topology_jobs: 'SELECT COUNT(*)::int AS count FROM topology_jobs WHERE dataset_version_id = $1',
  topology_candidates: 'SELECT COUNT(*)::int AS count FROM topology_candidates WHERE dataset_version_id = $1',
  topology_components: 'SELECT COUNT(*)::int AS count FROM topology_components WHERE dataset_version_id = $1',
  topology_interfaces: 'SELECT COUNT(*)::int AS count FROM topology_interfaces WHERE dataset_version_id = $1',
  confirmed_relations: 'SELECT COUNT(*)::int AS count FROM confirmed_relations WHERE dataset_version_id = $1',
  graph_revisions: 'SELECT COUNT(*)::int AS count FROM graph_revisions WHERE dataset_version_id = $1',
  graph_nodes: 'SELECT COUNT(*)::int AS count FROM graph_nodes WHERE dataset_version_id = $1',
  graph_edges: 'SELECT COUNT(*)::int AS count FROM graph_edges WHERE dataset_version_id = $1',
  accuracy_evaluations: 'SELECT COUNT(*)::int AS count FROM accuracy_evaluations WHERE dataset_version_id = $1',
  audit_events: 'SELECT COUNT(*)::int AS count FROM audit_events WHERE dataset_version_id = $1',
})

export async function loadPilotDataset(filePath) {
  const record = JSON.parse(await readFile(filePath, 'utf8'))
  assertDatasetRecord(record)
  return record
}

export function countAggregateEntities(record) {
  assertDatasetRecord(record)
  const graph = record.topologyGraph ?? {}
  return {
    dataset_versions: 1,
    source_features: count(record.sourceFeatures),
    source_geometries: count(record.sourceGeometries),
    classified_objects: count(record.classifiedObjects),
    topology_jobs: 0,
    topology_candidates: count(record.topologyCandidates),
    topology_components: count(
      record.topologyComponentRegistry ?? record.topologyGraph?.componentRegistry,
    ),
    topology_interfaces: count(
      record.topologyInterfaceRegistry ?? record.topologyGraph?.interfaceRegistry,
    ),
    confirmed_relations: count(record.confirmedRelations),
    graph_revisions: graph.graphRevision ? 1 : 0,
    graph_nodes: count(graph.nodes),
    graph_edges: count(graph.edges),
    accuracy_evaluations: count(record.accuracyEvaluations),
    audit_events: count(record.auditEvents),
  }
}

export async function countProjectionRows(client, datasetVersionId) {
  if (typeof client?.query !== 'function') {
    throw new TypeError('Projection client harus menyediakan query().')
  }
  const counts = {}
  for (const table of PILOT_PROJECTION_TABLES) {
    const result = await client.query(COUNT_QUERIES[table], [datasetVersionId])
    counts[table] = Number(result.rows?.[0]?.count ?? 0)
  }
  return counts
}

export function assertProjectionParity(expected, actual) {
  const tables = [...new Set([
    ...PILOT_PROJECTION_TABLES,
    ...Object.keys(expected ?? {}),
    ...Object.keys(actual ?? {}),
  ])].sort()
  const mismatches = tables.flatMap((table) => {
    const expectedCount = Number(expected?.[table] ?? 0)
    const actualCount = Number(actual?.[table] ?? 0)
    return expectedCount === actualCount
      ? []
      : [{ table, expected: expectedCount, actual: actualCount }]
  })
  if (mismatches.length) {
    const error = new Error('Pilot migration parity check gagal.')
    error.code = 'pilot_parity_failed'
    error.details = { mismatches, expected, actual }
    throw error
  }
  return {
    equal: true,
    counts: Object.fromEntries(tables.map((table) => [
      table,
      Number(expected?.[table] ?? 0),
    ])),
  }
}

export async function migratePilotDataset({
  repository,
  client,
  filePath,
}) {
  if (typeof repository?.create !== 'function') {
    throw new TypeError('Pilot migrator membutuhkan repository.create().')
  }
  const record = await loadPilotDataset(filePath)
  const expected = countAggregateEntities(record)
  let actual = null
  await repository.create(record, {
    verify: async ({ client: transactionClient, datasetVersionId }) => {
      actual = await countProjectionRows(transactionClient, datasetVersionId)
      assertProjectionParity(expected, actual)
    },
  })
  if (!actual) {
    actual = await countProjectionRows(client, record.datasetVersion.id)
  }
  return {
    datasetVersionId: record.datasetVersion.id,
    expected,
    actual,
    parity: assertProjectionParity(expected, actual),
  }
}

function assertDatasetRecord(record) {
  if (!record || typeof record !== 'object' || !record.datasetVersion?.id) {
    throw new TypeError('Pilot JSON harus memuat datasetVersion.id.')
  }
}

function count(value) {
  return Array.isArray(value) ? value.length : 0
}
