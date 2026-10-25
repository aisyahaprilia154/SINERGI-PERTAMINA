import { execFileSync, spawn } from 'node:child_process'
import { mkdir, writeFile, lstat, readdir } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const options = { project: null, 'env-file': '.env.docker', 'compose-file': [], 'restore-db': 'sinergi_migration_check' }
for (const argument of process.argv.slice(2)) {
  const match = argument.match(/^--(project|env-file|compose-file|restore-db)=(.+)$/)
  if (!match) throw new Error('Argumen backup tidak dikenal.')
  if (match[1] === 'compose-file') options['compose-file'].push(match[2])
  else options[match[1]] = match[2]
}
if (options.project && !/^[a-z0-9][a-z0-9_-]+$/.test(options.project)) throw new Error('Nama proyek Compose tidak valid.')
const restoreDb = options['restore-db']
if (!/^sinergi_[a-z0-9_]+$/.test(restoreDb)) throw new Error('Nama restore harus merupakan nama baru dengan prefix sinergi_.')
const executable = process.env.SINERGI_DOCKER_BIN || 'docker'
const docker = args => execFileSync(executable, args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString().trim()
const compose = ['compose', '--env-file', options['env-file'], ...(options.project ? ['--project-name', options.project] : []), ...options['compose-file'].flatMap(file => ['--file', file])]
const hashFile = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex') }
async function inventory(directory, relative = '') {
  const files = []
  for (const name of (await readdir(path.join(directory, relative))).sort()) {
    const key = path.posix.join(relative, name), target = path.join(directory, key), stat = await lstat(target)
    if (stat.isSymbolicLink()) throw new Error('Symlink tidak diizinkan pada salinan sumber.')
    if (stat.isDirectory()) files.push(...await inventory(directory, key))
    else if (stat.isFile()) files.push({ path: key, size: stat.size, sha256: await hashFile(target) })
  }
  return files
}
async function main() {
  const config = JSON.parse(docker([...compose, 'config', '--format', 'json']))
  const { POSTGRES_DB: database, POSTGRES_USER: owner } = config.services.db.environment
  const container = docker([...compose, 'ps', '--all', '--quiet', 'db'])
  const backend = docker([...compose, 'ps', '--all', '--quiet', 'backend'])
  if (!container || !backend) throw new Error('Container database dan backend wajib tersedia.')
  if (docker(['inspect', backend, '--format', '{{.State.Status}}']) !== 'exited') throw new Error('Hentikan backend terlebih dahulu agar dump dan file sumber konsisten. Skrip tidak menghentikan layanan otomatis.')
  const query = (sql, db = database) => docker(['exec', container, 'psql', '--no-psqlrc', '-U', owner, '-d', db, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql])
  if (query(`SELECT 1 FROM pg_database WHERE datname='${restoreDb}'`)) throw new Error('Database restore sudah ada; tidak akan ditimpa.')
  const directory = path.join(root, '.local-runtime', 'operational-backup', new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(directory, { recursive: true })
  const child = spawn(executable, ['exec', container, 'pg_dump', '-U', owner, '-Fc', database], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.resume()
  const complete = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('pg_dump gagal.'))) })
  await Promise.all([pipeline(child.stdout, createWriteStream(path.join(directory, 'database.dump'), { flags: 'wx' })), complete])
  docker(['cp', `${backend}:/app/.data`, path.join(directory, 'source-storage')])
  const sourceFiles = await inventory(path.join(directory, 'source-storage'))
  query(`CREATE DATABASE ${restoreDb}`)
  const temporaryDump = `/tmp/${restoreDb}.dump`
  try {
    docker(['cp', path.join(directory, 'database.dump'), `${container}:${temporaryDump}`])
    docker(['exec', container, 'pg_restore', '-U', owner, '--exit-on-error', '-d', restoreDb, temporaryDump])
  } finally { docker(['exec', container, 'rm', '-f', temporaryDump]) }
  const legacy = query("SELECT to_regclass('public.dataset_versions') IS NOT NULL") === 't'
  const tables = ['dataset_state','facilities','asset_categories','assets','asset_aliases','source_objects','relations','imports','import_items','jobs','app_users','audit_events']
  if (query("SELECT to_regclass('sinergi.dataset_checkpoints') IS NOT NULL") === 't') tables.push('dataset_checkpoints')
  const proof = db => legacy ? JSON.parse(query("SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) FROM (SELECT id,md5(payload::text) digest FROM public.dataset_versions) t", db)) : tables.map(table => JSON.parse(query(`SELECT json_build_object('table','${table}','n',count(*),'digest',md5(COALESCE(string_agg(t::text,'|' ORDER BY id),''))) FROM sinergi.${table} t`, db)))
  const original = proof(database), restored = proof(restoreDb)
  if (JSON.stringify(original) !== JSON.stringify(restored)) throw new Error('Jumlah/hash tabel hasil restore berbeda.')
  const manifest = { databaseSha256: await hashFile(path.join(directory, 'database.dump')), restoreDatabase: restoreDb, schema: legacy ? 'legacy' : 'operational', proof: original, sourceFiles, consistentBackendStopped: true }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify({ backupDirectory: directory, ...manifest }))
}
main().catch(error => { console.error(JSON.stringify({ event: 'backup.failed', message: error.message.startsWith('Hentikan backend') || error.message.startsWith('Database restore') ? error.message : 'Backup/restore gagal. Periksa konfigurasi dan log lokal; jangan lanjutkan pemulihan.' })); process.exitCode = 1 })
