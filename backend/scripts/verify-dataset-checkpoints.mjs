import {execFileSync} from 'node:child_process'
import {writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {performance} from 'node:perf_hooks'
import assert from 'node:assert/strict'
import pg from 'pg'
import {OperationalRepository} from '../src/storage/operational-repository.js'
import {DatasetCheckpoints,canonicalJson} from '../src/storage/dataset-checkpoints.js'
import {ImportFileStore} from '../src/storage/file-store.js'

const root=path.resolve(import.meta.dirname,'../..')
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)
const database=arg('database'),dataRoot=arg('source-root')
if(!/^sinergi_[a-z0-9_]+$/.test(database??'')||!dataRoot)throw new Error('Supply a separate --database=sinergi_... and --source-root=... backup directory.')
const e=JSON.parse(execFileSync('docker',['compose','--env-file','.env.docker','config','--format','json'],{cwd:root,encoding:'utf8'})).services.db.environment
if(database===e.POSTGRES_DB)throw new Error('Refusing to run roundtrip mutations on the live database.')
const pool=new pg.Pool({host:'127.0.0.1',port:5433,user:e.POSTGRES_USER,password:e.POSTGRES_PASSWORD,database})
const repository=new OperationalRepository(pool),versions=new DatasetCheckpoints({repository,fileStore:new ImportFileStore(path.resolve(dataRoot))}),datasetId='dataset-semarang'
try {
 const revision=async()=>Number((await repository.state(pool,datasetId)).revision)
 const capture=()=>repository.transaction(c=>versions.capture(c,datasetId),{readOnly:true})
 const rawHashes=async()=>{
  const result={}
  for(const table of ['assets','relations','facilities'])result[table]=(await pool.query(`SELECT md5(COALESCE(string_agg(t::text,'|' ORDER BY id),'')) digest FROM sinergi.${table} t WHERE dataset_id=$1`,[datasetId])).rows[0].digest
  return result
 }
 const before=await capture();assert.equal(before.assets.length,1376);assert.equal(before.facilities.length,9)
 const beforeHashes=await rawHashes()
 const started=performance.now(),a=await versions.manual({datasetId,name:'Baseline roundtrip',expectedRevision:await revision(),actorId:'checkpoint-validation'}),saveMs=performance.now()-started
 const asset=before.assets.find(a=>a.kind==='device'&&!a.deleted),connection=before.relations.find(r=>r.kind==='connection'&&!r.deleted)
 await repository.saveIcon({datasetId,assetId:asset.id,dataUrl:'data:image/png;base64,YQ==',expectedRevision:await revision(),actorId:'checkpoint-validation'})
 await repository.saveDiagram({datasetId,expectedRevision:await revision(),actorId:'checkpoint-validation',changes:[{type:'move-node',assetId:asset.id,x:50,y:80},{type:'remove-edge',edgeId:connection.id}]})
 const c=await versions.manual({datasetId,name:'Corrected roundtrip',expectedRevision:await revision(),actorId:'checkpoint-validation'}),corrected=await capture()
 const restore=async versionId=>versions.restore({datasetId,versionId,expectedRevision:await revision(),actorId:'checkpoint-validation'})
 const restoreStarted=performance.now();await restore(a.version.id);const restoreMs=performance.now()-restoreStarted
 assert.equal(canonicalJson(await capture()),canonicalJson(before))
 assert.deepEqual(await rawHashes(),beforeHashes)
 await restore(c.version.id);assert.equal(canonicalJson(await capture()),canonicalJson(corrected))
 await restore(a.version.id);assert.equal(canonicalJson(await capture()),canonicalJson(before));assert.deepEqual(await rawHashes(),beforeHashes)
 const report={database,assets:before.assets.length,facilities:before.facilities.length,compressedBytes:Number(a.version.compressed_size),saveMs:Math.round(saveMs),restoreMs:Math.round(restoreMs),exactRoundtrip:true,revision:await revision()}
 await mkdir(path.join(root,'.local-runtime'),{recursive:true})
 await writeFile(path.join(root,'.local-runtime/checkpoint-baseline-roundtrip.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify(report))
}finally{await pool.end()}
