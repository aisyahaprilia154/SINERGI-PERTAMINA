import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createConfig } from '../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'

const DEFAULT_DATASET_VERSION_ID = 'dv-pilot-parity'

/**
 * Proves the live schema rejects one foreign-key violation and one duplicate
 * candidate key. Every probe is inside a savepoint and the outer transaction
 * is rolled back; no persistent row is created or modified.
 */
export async function runDatabaseConstraintNegativeCheck({
  connectionString = createConfig(process.env).database.databaseUrl,
  poolFactory = createPostgresPool,
  datasetVersionId = DEFAULT_DATASET_VERSION_ID,
} = {}) {
  const pool = await poolFactory({ connectionString })
  try {
    const schema = await verifyOperationalSchema(pool)
    const client = await pool.connect()
    const candidateId = `constraint-negative-${randomUUID().replaceAll('-', '')}`
    let transactionRolledBack = false
    try {
      await client.query('BEGIN')
      const foreignKey = await runForeignKeyProbe(client)
      const uniqueCandidate = await runUniqueCandidateProbe(
        client,
        datasetVersionId,
        candidateId,
      )
      await client.query('ROLLBACK')
      transactionRolledBack = true

      const residue = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM topology_candidates
         WHERE candidate_id = $1`,
        [candidateId],
      )
      const residueCount = Number(residue.rows?.[0]?.count ?? 0)
      if (residueCount !== 0) {
        throw constraintProbeError(
          'database_constraint_probe_residue',
          'Constraint probe meninggalkan row setelah rollback.',
          { candidateId, residueCount },
        )
      }

      return {
        result: 'passed',
        schema,
        datasetVersionId,
        transactionRolledBack,
        persistentRowsCreated: 0,
        probes: {
          foreignKey,
          uniqueCandidate,
        },
      }
    } catch (error) {
      if (!transactionRolledBack) {
        await client.query('ROLLBACK').catch(() => {})
      }
      throw error
    } finally {
      client.release?.()
    }
  } finally {
    await closePostgresPool(pool)
  }
}

export async function runForeignKeyProbe(client) {
  await client.query('SAVEPOINT constraint_fk_probe')
  try {
    let violation = null
    try {
      await client.query(
        `INSERT INTO topology_candidates (
           dataset_version_id, candidate_id, candidate_type,
           candidate_status, proposal_status
         ) VALUES ($1, $2, 'constraint_probe', 'candidate', 'recommended')`,
        [
          `missing-dataset-${randomUUID().replaceAll('-', '')}`,
          `fk-negative-${randomUUID().replaceAll('-', '')}`,
        ],
      )
    } catch (error) {
      violation = error
    }
    return expectedConstraintViolation(violation, {
      operation: 'foreign_key_dataset_version',
      sqlState: '23503',
      constraintPattern: /topology_candidates.*dataset_version/i,
    })
  } finally {
    await rollbackSavepoint(client, 'constraint_fk_probe')
  }
}

export async function runUniqueCandidateProbe(client, datasetVersionId, candidateId) {
  await client.query('SAVEPOINT constraint_unique_probe')
  try {
    const values = [datasetVersionId, candidateId]
    const insert = `INSERT INTO topology_candidates (
      dataset_version_id, candidate_id, candidate_type,
      candidate_status, proposal_status
    ) VALUES ($1, $2, 'constraint_probe', 'candidate', 'recommended')`
    await client.query(insert, values)
    let violation = null
    try {
      await client.query(insert, values)
    } catch (error) {
      violation = error
    }
    return expectedConstraintViolation(violation, {
      operation: 'unique_dataset_candidate',
      sqlState: '23505',
      constraintPattern: /topology_candidates.*candidate_id/i,
    })
  } finally {
    await rollbackSavepoint(client, 'constraint_unique_probe')
  }
}

export function expectedConstraintViolation(error, {
  operation,
  sqlState,
  constraintPattern,
} = {}) {
  if (!error || error.code !== sqlState || !constraintPattern.test(String(error.constraint ?? ''))) {
    throw constraintProbeError(
      'database_constraint_probe_unexpected_error',
      `Probe constraint ${operation} tidak menghasilkan violation yang diharapkan.`,
      {
        operation,
        expectedSqlState: sqlState,
        actualSqlState: error?.code ?? null,
        actualConstraint: error?.constraint ?? null,
      },
    )
  }
  return {
    passed: true,
    operation,
    sqlState: error.code,
    constraint: error.constraint ?? null,
  }
}

async function rollbackSavepoint(client, name) {
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`)
  await client.query(`RELEASE SAVEPOINT ${name}`)
}

function constraintProbeError(code, message, details) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

async function main() {
  const config = createConfig(process.env)
  const result = await runDatabaseConstraintNegativeCheck({
    connectionString: config.database.databaseUrl,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `[database-constraint-negative] ${error.code ?? 'failed'}: ${error.message}\n`,
    )
    if (error.details) process.stderr.write(`${JSON.stringify(error.details)}\n`)
    process.exitCode = 1
  })
}
