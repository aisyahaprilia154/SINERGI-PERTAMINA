import {createConfig} from '../src/config.js'
import {createPostgresPool,closePostgresPool} from '../src/database/postgres-runtime.js'
import {loadMigration,runMigration} from '../src/database/migration-runner.js'
import path from 'node:path'
import {OperationalRepository} from '../src/storage/operational-repository.js'
import {DatasetCheckpoints} from '../src/storage/dataset-checkpoints.js'
import {ImportFileStore} from '../src/storage/file-store.js'

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
  const presence=await loadMigration(path.resolve(import.meta.dirname,'../src/database/migrations'),'0010_user_presence')
  const presenceClient=await pool.connect()
  try{await runMigration(presenceClient,presence)}finally{presenceClient.release()}
  const checkpoints=await loadMigration(path.resolve(import.meta.dirname,'../src/database/migrations'),'0011_dataset_checkpoints')
  const checkpointClient=await pool.connect()
  try{await runMigration(checkpointClient,checkpoints)}finally{checkpointClient.release()}
  const accounts=await loadMigration(path.resolve(import.meta.dirname,'../src/database/migrations'),'0012_remove_account_status')
  const accountClient=await pool.connect()
  try{await runMigration(accountClient,accounts)}finally{accountClient.release()}
  const count=(await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='sinergi' AND table_type='BASE TABLE'")).rows[0].n
  if(count!==13)throw new Error('Operational schema must have exactly 13 application tables.')
  const repository=new OperationalRepository(pool),versions=new DatasetCheckpoints({repository,fileStore:new ImportFileStore(config.dataRoot)})
  for(const {id} of (await pool.query('SELECT id FROM sinergi.dataset_state ORDER BY id')).rows) {
    await repository.transaction(async client=>{
      const state=await repository.state(client,id,{lock:true})
      if(!(await client.query('SELECT 1 FROM sinergi.dataset_checkpoints WHERE dataset_id=$1 LIMIT 1',[id])).rowCount) {
        const result=await versions.save(client,{datasetId:id,name:'Baseline saat fitur versi diaktifkan',reason:'baseline'})
        await repository.audit(client,'dataset.version_saved',{datasetId:id,details:{versionId:result.version.id,baseline:true,revision:Number(state.revision)}})
      }
    })
  }
  console.log(JSON.stringify({status:'ready',schema:'sinergi',applicationTables:count}))
}finally{await closePostgresPool(pool)}
