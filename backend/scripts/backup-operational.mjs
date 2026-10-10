import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

// Docker owns the password; neither command arguments nor output contain it.
const root = path.resolve(import.meta.dirname, '../..');
const docker = args => execFileSync('docker', args, { cwd: root, maxBuffer: 512 * 1024 * 1024 });
const config = JSON.parse(docker(['compose','--env-file','.env.docker','config','--format','json']).toString());
const env = config.services.db.environment;
const database = env.POSTGRES_DB;
const container = docker(['compose','--env-file','.env.docker','ps','-q','db']).toString().trim();
const backend = docker(['compose','--env-file','.env.docker','ps','-a','-q','backend']).toString().trim();
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const dir = path.join(root,'.local-runtime','operational-backup',stamp);
await mkdir(dir,{recursive:true});
const dump = docker(['exec',container,'pg_dump','-U',env.POSTGRES_USER,'-Fc',database]);
await writeFile(path.join(dir,'database.dump'),dump);
if (!backend) throw new Error('Running backend required to back up source storage.');
docker(['cp',`${backend}:/app/.data`,path.join(dir,'source-storage')]);
const restoreDb = process.argv.find(a=>a.startsWith('--restore-db='))?.split('=')[1] ?? 'sinergi_migration_check';
if(!/^sinergi_[a-z0-9_]+$/.test(restoreDb))throw new Error('Restore database name must be a safe sinergi_ name.');
const client = new pg.Client({host:'127.0.0.1',port:5433,user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD,database});
await client.connect();
try {
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[restoreDb]);
  if (exists.rows.length) throw new Error('Restore database already exists; refusing to overwrite it.');
  await client.query(`CREATE DATABASE ${restoreDb}`);
  docker(['cp',path.join(dir,'database.dump'),`${container}:/tmp/sinergi-operational-backup.dump`]);
  docker(['exec',container,'pg_restore','-U',env.POSTGRES_USER,'--exit-on-error','-d',restoreDb,'/tmp/sinergi-operational-backup.dump']);
  const restored = new pg.Client({host:'127.0.0.1',port:5433,user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD,database:restoreDb});
  await restored.connect();
  try {
    const legacy=(await client.query("SELECT to_regclass('public.dataset_versions') name")).rows[0].name;
    const operationalTables=['dataset_state','facilities','asset_categories','assets','asset_aliases','source_objects','relations','imports','import_items','jobs','app_users','audit_events'];
    const proof=async connection=>{
      if(legacy)return (await connection.query('SELECT id,md5(payload::text) digest FROM public.dataset_versions ORDER BY id')).rows;
      const hashes=[];
      for(const table of operationalTables)hashes.push({table,...(await connection.query(`SELECT count(*)::int n,md5(COALESCE(string_agg(t::text,'|' ORDER BY id),'')) digest FROM sinergi.${table} t`)).rows[0]});
      return hashes;
    };
    const a=await proof(client),b=await proof(restored);
    if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error('Restored dataset hashes differ.');
    const hashes = {databaseSha256:createHash('sha256').update(await readFile(path.join(dir,'database.dump'))).digest('hex'),restoreDatabase:restoreDb,schema:legacy?'legacy':'operational',proof:a};
    await writeFile(path.join(dir,'manifest.json'),JSON.stringify(hashes,null,2));
    console.log(JSON.stringify({backupDirectory:dir,...hashes}));
  } finally {await restored.end();}
} finally {await client.end();}
