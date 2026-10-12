import {execFileSync,spawnSync} from 'node:child_process'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'../..')
const config=JSON.parse(execFileSync('docker',['compose','--env-file','.env.docker','config','--format','json'],{cwd:root,encoding:'utf8'})).services.db.environment
const uri=`postgresql://${encodeURIComponent(config.POSTGRES_USER)}:${encodeURIComponent(config.POSTGRES_PASSWORD)}@127.0.0.1:5433/sinergi_migration_check`
const migrate=spawnSync(process.execPath,['backend/scripts/operational-bootstrap.mjs'],{cwd:root,stdio:'inherit',env:{...process.env,SINERGI_DATABASE_URL:uri}})
if(migrate.status!==0)process.exit(migrate.status ?? 1)
const result=spawnSync(process.execPath,['--test','backend/tests/operational-postgres.test.js'],{cwd:root,stdio:'inherit',env:{...process.env,SINERGI_TEST_DATABASE_URL:uri}})
process.exitCode=result.status ?? 1
