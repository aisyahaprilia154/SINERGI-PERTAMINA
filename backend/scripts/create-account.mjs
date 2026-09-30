import { createConfig } from '../src/config.js'
import { closePostgresPool, createPostgresPool } from '../src/database/postgres-runtime.js'
import { PostgresAccountStore } from '../src/security/account-store.js'

const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const match = argument.match(/^--([a-z-]+)=(.+)$/)
  if (!match) throw new TypeError(`Argumen tidak dikenal: ${argument}`)
  return [match[1], match[2]]
}))
const config = createConfig(process.env)
if (config.storageMode !== 'postgres') throw new TypeError('Akun memerlukan mode PostgreSQL.')
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
const pool = await createPostgresPool({
  connectionString: config.database.databaseUrl,
  max: 1,
  ssl: config.database.ssl,
})
try {
  const account = await new PostgresAccountStore(pool).save({
    username: options.username,
    password,
    role: options.role,
    branchIds: options.branches?.split(',').filter(Boolean) ?? [],
    datasetIds: options.datasets?.split(',').filter(Boolean) ?? [],
  })
  process.stdout.write(`Akun ${account.username} (${account.role}) tersimpan.\n`)
} finally {
  await closePostgresPool(pool)
}
