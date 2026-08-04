import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const SCHEMA_MIGRATIONS_BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL
)
`

/**
 * Runs one migration in a transaction and records its checksum.
 *
 * The client only needs to implement the node-postgres query(text, values)
 * contract. Keeping the runner client-agnostic lets the migration contract be
 * tested without silently replacing PostGIS with an in-memory approximation.
 */
export async function runMigration(client, {
  id,
  upSql,
  downSql,
  direction = 'up',
  checksum = createMigrationChecksum(upSql, downSql),
  appliedAt = new Date().toISOString(),
}) {
  assertMigrationId(id)
  if (!['up', 'down'].includes(direction)) {
    throw new TypeError('Migration direction harus berupa up atau down.')
  }
  if (typeof client?.query !== 'function') {
    throw new TypeError('Migration client harus menyediakan query().')
  }
  const migrationSql = direction === 'up' ? upSql : downSql
  if (typeof migrationSql !== 'string' || !migrationSql.trim()) {
    throw new TypeError(`SQL migration ${direction} wajib tersedia.`)
  }

  await client.query('BEGIN')
  try {
    await client.query(SCHEMA_MIGRATIONS_BOOTSTRAP)
    const current = await client.query(
      'SELECT migration_id, checksum FROM schema_migrations WHERE migration_id = $1',
      [id],
    )
    const existing = current.rows?.[0] ?? null

    if (direction === 'up' && existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Checksum migration ${id} berubah setelah diterapkan.`)
      }
      await client.query('COMMIT')
      return { id, direction, status: 'already_applied', checksum }
    }
    if (direction === 'down' && !existing) {
      await client.query('COMMIT')
      return { id, direction, status: 'not_applied', checksum }
    }

    await client.query(migrationSql)
    if (direction === 'up') {
      await client.query(
        `INSERT INTO schema_migrations (migration_id, checksum, applied_at)
         VALUES ($1, $2, $3)`,
        [id, checksum, appliedAt],
      )
    } else {
      await client.query(
        'DELETE FROM schema_migrations WHERE migration_id = $1',
        [id],
      )
    }
    await client.query('COMMIT')
    return { id, direction, status: 'applied', checksum }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

export async function loadMigration(directory, id) {
  assertMigrationId(id)
  const root = path.resolve(directory)
  const [upSql, downSql] = await Promise.all([
    readFile(path.join(root, `${id}.up.sql`), 'utf8'),
    readFile(path.join(root, `${id}.down.sql`), 'utf8'),
  ])
  return { id, upSql, downSql }
}

export function createMigrationChecksum(upSql, downSql) {
  if (typeof upSql !== 'string' || typeof downSql !== 'string') {
    throw new TypeError('SQL up dan down wajib berupa string.')
  }
  return createHash('sha256')
    .update(upSql)
    .update('\n-- DOWN --\n')
    .update(downSql)
    .digest('hex')
}

function assertMigrationId(id) {
  if (!/^\d{4}_[a-z0-9_]+$/.test(String(id))) {
    throw new TypeError('Migration ID tidak valid.')
  }
}
