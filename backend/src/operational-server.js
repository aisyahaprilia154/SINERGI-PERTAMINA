import path from 'node:path'
import { createConfig } from './config.js'
import { createPostgresPool,closePostgresPool } from './database/postgres-runtime.js'
import { OperationalRepository } from './storage/operational-repository.js'
import { OperationalImportService } from './import/operational-import-service.js'
import { OperationalWorker } from './jobs/operational-worker.js'
import { ImportFileStore } from './storage/file-store.js'
import { TokenAuthenticator } from './security/authorization.js'
import { PostgresAccountStore } from './security/account-store.js'
import { createOperationalApp } from './operational-app.js'

const config=createConfig(process.env,{dataRoot:process.env.SINERGI_DATA_ROOT ?? path.resolve(import.meta.dirname,'../.data')})
if(!config.database.databaseUrl) throw new Error('SINERGI_DATABASE_URL required for the operational database.')
const pool=await createPostgresPool({connectionString:config.database.databaseUrl,max:config.database.poolMax,ssl:config.database.ssl})
const count=(await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='sinergi' AND table_type='BASE TABLE'")).rows[0].n
if(count!==12) {await closePostgresPool(pool);throw new Error('Operational schema is not migrated; run db:operational first.')}
await pool.query('SELECT auth_version,last_seen_at FROM sinergi.app_users LIMIT 0')
const repository=new OperationalRepository(pool),fileStore=new ImportFileStore(config.dataRoot)
await fileStore.initialize()
const importService=new OperationalImportService({repository,fileStore,config})
const worker=new OperationalWorker({repository,importService})
const authenticator=new TokenAuthenticator(process.env.NODE_ENV==='production'?{}:config.authTokens)
const accountStore=new PostgresAccountStore(pool,{operational:true})
const server=createOperationalApp({repository,importService,fileStore,config,authenticator,accountStore})
server.listen(config.port,config.host,()=>console.log(`SINERGI operational service listening on http://${config.host}:${config.port}`))
worker.start()
let closing=false
async function stop(){if(closing)return;closing=true;await new Promise(resolve=>server.close(resolve));await worker.stop();await closePostgresPool(pool)}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop())
