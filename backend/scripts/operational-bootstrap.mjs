import {createConfig} from '../src/config.js'
import {createPostgresPool,closePostgresPool} from '../src/database/postgres-runtime.js'
import {loadMigration,runMigration} from '../src/database/migration-runner.js'
import path from 'node:path'

const config=createConfig(process.env)
const pool=await createPostgresPool({connectionString:config.database.databaseUrl,ssl:config.database.ssl})
try {
  const legacy=(await pool.query("SELECT to_regclass('public.dataset_versions') AS name")).rows[0].name
  const operational=(await pool.query("SELECT to_regclass('sinergi.dataset_state') AS name")).rows[0].name
  if(legacy&&!operational)throw new Error('Existing database requires backup and db:operational baseline migration before starting the new server.')
  if(!operational) {
    const migration=await loadMigration(path.resolve(import.meta.dirname,'../src/database/migrations'),'0009_simplified_operational')
    const client=await pool.connect()
    try{await runMigration(client,migration)}finally{client.release()}
    await pool.query('INSERT INTO sinergi.dataset_state(id) VALUES($1)',[process.env.SINERGI_DATASET_ID || 'dataset-semarang'])
  }
  const count=(await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='sinergi' AND table_type='BASE TABLE'")).rows[0].n
  if(count!==12)throw new Error('Operational schema must have exactly 12 application tables.')
  const presence=await loadMigration(path.resolve(import.meta.dirname,'../src/database/migrations'),'0010_user_presence')
  const presenceClient=await pool.connect()
  try{await runMigration(presenceClient,presence)}finally{presenceClient.release()}
  console.log(JSON.stringify({status:'ready',schema:'sinergi',applicationTables:count}))
}finally{await closePostgresPool(pool)}
