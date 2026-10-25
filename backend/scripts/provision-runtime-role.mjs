import { createConfig } from '../src/config.js'
import { createPostgresPool } from '../src/database/postgres-runtime.js'

// Run only with the migration owner, after db:migrate, on a dedicated SINERGI database.
// A hex secret is required so it is also safe in the Compose connection URI.
const password = process.env.SINERGI_RUNTIME_DB_PASSWORD
if (!/^[a-f0-9]{64}$/.test(password ?? '')) throw new Error('SINERGI_RUNTIME_DB_PASSWORD harus berupa 64 karakter hex acak.')
const config = createConfig()
const pool = await createPostgresPool({ connectionString: config.database.databaseUrl, ssl: config.database.ssl })
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query("SELECT pg_advisory_xact_lock(hashtext('sinergi.runtime-role'))")
  const exists = (await client.query("SELECT 1 FROM pg_roles WHERE rolname='sinergi_runtime'")).rowCount
  if (!exists) await client.query('CREATE ROLE sinergi_runtime LOGIN')
  await client.query(`ALTER ROLE sinergi_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`)
  if ((await client.query("SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='sinergi_runtime')")).rowCount) throw new Error('Role runtime mempunyai membership tak terduga; review sebelum provisioning.')
  const owned=(await client.query("SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=(SELECT oid FROM pg_roles WHERE rolname='sinergi_runtime') UNION ALL SELECT 1 FROM pg_namespace WHERE nspname IN ('public','sinergi') AND nspowner=(SELECT oid FROM pg_roles WHERE rolname='sinergi_runtime') UNION ALL SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','sinergi') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='sinergi_runtime') LIMIT 1")).rowCount
  if(owned)throw new Error('Runtime role must not own database/schema/application objects.')
  const { database, owner } = (await client.query('SELECT current_database() AS database, current_user AS owner')).rows[0]
  if (owner === 'sinergi_runtime') throw new Error('Provisioning memerlukan migration owner.')
  const identifier = value => `"${value.replaceAll('"', '""')}"`
  await client.query(`REVOKE CREATE,TEMPORARY ON DATABASE ${identifier(database)} FROM PUBLIC`)
  await client.query(`REVOKE ALL ON DATABASE ${identifier(database)} FROM sinergi_runtime`)
  await client.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO sinergi_runtime`)
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
  await client.query('REVOKE ALL ON SCHEMA sinergi FROM sinergi_runtime')
  await client.query('GRANT USAGE ON SCHEMA sinergi TO sinergi_runtime')
  await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA sinergi FROM sinergi_runtime')
  await client.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA sinergi TO sinergi_runtime')
  await client.query('REVOKE UPDATE,DELETE ON sinergi.audit_events FROM sinergi_runtime')
  await client.query('REVOKE ALL ON ALL SEQUENCES IN SCHEMA sinergi FROM sinergi_runtime')
  await client.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA sinergi TO sinergi_runtime')
  await client.query('COMMIT')
  console.log(JSON.stringify({ status: 'ready', role: 'sinergi_runtime', superuser: false, schemaDdl: false, audit: 'select,insert' }))
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  // PostgreSQL error objects can include SQL containing a credential. Never print them.
  console.error(JSON.stringify({ event: 'runtime_role.provision_failed', code: /^[A-Z0-9]{5}$/.test(error.code ?? '') ? error.code : 'configuration_error' }))
  process.exitCode = 1
} finally { client.release(); await pool.end() }
