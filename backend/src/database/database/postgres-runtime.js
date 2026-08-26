const DEFAULT_OPERATIONAL_TABLES = Object.freeze([
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
  'dataset_active_pointers',
  'asset_identity_registry',
  'dataset_version_diffs',
])

export const POSTGRES_RUNTIME_REQUIRED_COLUMNS = Object.freeze([
  Object.freeze({
    table: 'topology_jobs',
    columns: Object.freeze([
      'schema_version',
      'queued_at',
      'last_started_at',
      'failed_at',
      'progress',
      'stage',
      'cancel_requested',
      'revision',
    ]),
  }),
])

/**
 * Creates a node-postgres pool for an explicit database-backed task. Runtime
 * configuration selects JSON only when no database URL is supplied or JSON is
 * explicitly requested; a missing database never causes a silent fallback.
 */
export async function createPostgresPool({
  connectionString,
  max = 10,
  idleTimeoutMilliseconds = 30_000,
  connectionTimeoutMilliseconds = 5_000,
  ssl = false,
  logger = console,
  loadPg = () => import('pg'),
} = {}) {
  const normalizedConnectionString = requireConnectionString(connectionString)
  const pgModule = await loadPg()
  const Pool = pgModule?.Pool ?? pgModule?.default?.Pool
  if (typeof Pool !== 'function') {
    throw databaseError(
      'database_driver_unavailable',
      'Dependency PostgreSQL tidak menyediakan Pool yang valid.',
    )
  }
  const pool = new Pool({
    connectionString: normalizedConnectionString,
    max: positiveInteger(max, 10),
    idleTimeoutMillis: positiveInteger(idleTimeoutMilliseconds, 30_000),
    connectionTimeoutMillis: positiveInteger(connectionTimeoutMilliseconds, 5_000),
    ssl: ssl === true,
  })
  if (typeof pool.on === 'function') {
    pool.on('error', (error) => {
      const code = String(error?.code ?? 'client_error')
      const message = String(error?.message ?? error)
      logger?.error?.(`[postgres-pool] ${code}: ${message}`)
    })
  }
  return pool
}

/**
 * Verifies the concrete database has PostGIS and every operational table.
 * This is intentionally separate from pool creation: node-postgres opens a
 * connection lazily, while migration/verification commands must fail closed.
 */
export async function verifyOperationalSchema(pool, {
  requiredTables = DEFAULT_OPERATIONAL_TABLES,
  requiredColumns = [],
} = {}) {
  if (typeof pool?.query !== 'function') {
    throw new TypeError('Database pool harus menyediakan query().')
  }
  const extensionResult = await pool.query(
    `SELECT extversion
     FROM pg_extension
     WHERE extname = 'postgis'`,
  )
  if (!extensionResult.rows?.[0]?.extversion) {
    throw databaseError(
      'postgis_extension_missing',
      'Extension PostGIS belum terpasang pada database target.',
    )
  }

  const identifiers = [...new Set(requiredTables.map((table) => String(table)))]
  const tableResult = await pool.query(
    `SELECT table_name, to_regclass('public.' || table_name) AS relation_name
     FROM unnest($1::text[]) AS required_table(table_name)`,
    [identifiers],
  )
  const missingTables = (tableResult.rows ?? [])
    .filter((row) => !row.relation_name)
    .map((row) => row.table_name)
  if (missingTables.length) {
    throw databaseError(
      'database_schema_not_ready',
      'Schema operasional PostgreSQL belum lengkap.',
      { missingTables },
    )
  }
  const columnPairs = requiredColumns.flatMap(({ table, columns }) => (
    columns.map((column) => ({ table: String(table), column: String(column) }))
  ))
  if (columnPairs.length) {
    const columnResult = await pool.query(
      `SELECT required.table_name, required.column_name
       FROM unnest($1::text[], $2::text[])
         AS required(table_name, column_name)
       LEFT JOIN information_schema.columns actual
         ON actual.table_schema = 'public'
        AND actual.table_name = required.table_name
        AND actual.column_name = required.column_name
       WHERE actual.column_name IS NULL`,
      [
        columnPairs.map(({ table }) => table),
        columnPairs.map(({ column }) => column),
      ],
    )
    const missingColumns = (columnResult.rows ?? []).map((row) => (
      `${row.table_name}.${row.column_name}`
    ))
    if (missingColumns.length) {
      throw databaseError(
        'database_schema_not_ready',
        'Schema PostgreSQL belum memiliki kolom runtime yang diperlukan.',
        { missingColumns },
      )
    }
  }
  return {
    postgisVersion: String(extensionResult.rows[0].extversion),
    tables: identifiers,
  }
}

export async function closePostgresPool(pool) {
  if (typeof pool?.end === 'function') await pool.end()
}

export function requireConnectionString(value) {
  const connectionString = String(value ?? '').trim()
  if (!connectionString) {
    throw databaseError(
      'database_url_required',
      'SINERGI_DATABASE_URL atau SINERGI_SHADOW_DATABASE_URL wajib diisi.',
    )
  }
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw databaseError(
      'database_url_invalid',
      'Connection string harus menggunakan skema postgres:// atau postgresql://.',
    )
  }
  return connectionString
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function databaseError(code, message, details = undefined) {
  const error = new Error(message)
  error.code = code
  if (details) error.details = details
  return error
}
