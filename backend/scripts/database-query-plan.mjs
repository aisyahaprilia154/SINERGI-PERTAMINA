import { createConfig } from '../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'
import { pathToFileURL } from 'node:url'

const REQUIRED_INDEXES = Object.freeze([
  'source_geometries_geometry_gist_idx',
  'graph_nodes_location_gist_idx',
  'topology_candidates_review_idx',
  'topology_candidates_source_endpoint_idx',
  'confirmed_relations_dataset_status_idx',
  'topology_jobs_status_available_idx',
  'audit_events_dataset_occurred_idx',
])

const PLAN_QUERIES = Object.freeze({
  geometry_bbox: {
    text: `EXPLAIN (FORMAT JSON, COSTS false)
      SELECT source_geometry_id
      FROM source_geometries
      WHERE dataset_version_id = $1
        AND geometry IS NOT NULL
        AND geometry && ST_MakeEnvelope(105, -7, 107, -5, 4326)`,
    values: ['dv-pilot-parity'],
  },
  candidate_review: {
    text: `EXPLAIN (FORMAT JSON, COSTS false)
      SELECT candidate_id
      FROM topology_candidates
      WHERE dataset_version_id = $1
        AND candidate_status = $2
        AND site_id = $3
        AND network_family = $4
      ORDER BY score DESC NULLS LAST, candidate_id ASC
      LIMIT 100`,
    values: ['dv-pilot-parity', 'confirmed', 'site-pilot', 'infrastructure'],
  },
  graph_location_bbox: {
    text: `EXPLAIN (FORMAT JSON, COSTS false)
      SELECT node_id
      FROM graph_nodes
      WHERE dataset_version_id = $1
        AND location IS NOT NULL
        AND location && ST_MakeEnvelope(105, -7, 107, -5, 4326)`,
    values: ['dv-pilot-parity'],
  },
})

export async function runDatabaseQueryPlanCheck({
  connectionString,
  poolFactory = createPostgresPool,
} = {}) {
  const pool = await poolFactory({ connectionString })
  try {
    const schema = await verifyOperationalSchema(pool)
    const indexResult = await pool.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [REQUIRED_INDEXES],
    )
    const indexesPresent = indexResult.rows.map((row) => row.indexname)
    const indexesMissing = REQUIRED_INDEXES.filter((name) => (
      !indexesPresent.includes(name)
    ))

    const plans = {}
    for (const [name, query] of Object.entries(PLAN_QUERIES)) {
      const result = await pool.query(query.text, query.values)
      const plan = result.rows?.[0]?.['QUERY PLAN']?.[0] ?? null
      plans[name] = {
        plan,
        indexNodes: collectIndexNodes(plan),
      }
    }
    return {
      schema,
      requiredIndexes: REQUIRED_INDEXES,
      indexesPresent,
      indexesMissing,
      plans,
      note: 'Small pilot tables may legitimately use sequential scans; production-sized EXPLAIN evidence remains required for SLO claims.',
    }
  } finally {
    await closePostgresPool(pool)
  }
}

function collectIndexNodes(plan) {
  const nodes = []
  visitPlan(plan, nodes)
  return nodes
}

function visitPlan(node, nodes) {
  if (!node || typeof node !== 'object') return
  if (typeof node['Node Type'] === 'string'
    && node['Node Type'].toLowerCase().includes('index')) {
    nodes.push({
      nodeType: node['Node Type'],
      indexName: node['Index Name'] ?? null,
    })
  }
  if (node.Plan) visitPlan(node.Plan, nodes)
  for (const child of node.Plans ?? []) visitPlan(child, nodes)
}

async function main() {
  const config = createConfig(process.env)
  const result = await runDatabaseQueryPlanCheck({
    connectionString: config.database.databaseUrl,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[database-query-plan] ${error.code ?? 'failed'}: ${error.message}\n`)
    process.exitCode = 1
  })
}
