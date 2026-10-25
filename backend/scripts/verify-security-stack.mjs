import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes, createHash, scryptSync } from 'node:crypto'
import { mkdir, writeFile, readFile, cp, open } from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import tls from 'node:tls'
import pg from 'pg'
import { PostgresAccountStore } from '../src/security/account-store.js'

const root = path.resolve(import.meta.dirname, '../..')
const project = `sinergi-security-test-${randomBytes(4).toString('hex')}`
const work = path.join(root, '.local-runtime', project), evidence = path.join(root, 'docs/security/evidence')
const docker = process.env.SINERGI_DOCKER_BIN || 'docker'
const openssl = process.env.SINERGI_OPENSSL_BIN || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl')
const ownerPassword = randomBytes(32).toString('hex'), runtimePassword = randomBytes(32).toString('hex'), accountPassword = randomBytes(24).toString('hex'), legacyPassword = randomBytes(6).toString('hex')
const environment = path.join(work, 'test.env'), override = path.join(work, 'override.json')
const compose = ['compose', '--project-name', project, '--env-file', environment, '--file', 'docker-compose.production.yml', '--file', override]
const run = args => execFileSync(docker, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
const port = (service, target) => Number(run([...compose, 'port', service, String(target)]).split(':').at(-1))
const summary = { date: new Date().toISOString(), project, checks: [], operationalDatabaseTouched: false }
const check = name => { summary.checks.push(name); console.log(`PASS ${name}`) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let owner, runtime, started = false

async function commandToLog(executable, args, file, env = process.env, cwd = root) {
  const output = await open(file, 'w')
  try {
    const result = spawnSync(executable, args, { cwd, env, stdio: ['ignore', output.fd, output.fd], timeout: 600_000 })
    if (result.error || result.status !== 0) throw new Error(`Command failed; inspect ${path.relative(root, file)} locally.`)
  } finally { await output.close() }
}

async function main() {
  await mkdir(work, { recursive: true }); await mkdir(evidence, { recursive: true })
  assert.ok(path.resolve(work).startsWith(path.join(root, '.local-runtime') + path.sep))
  execFileSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(work,'privkey.pem'),'-out',path.join(work,'fullchain.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
  await writeFile(environment, `POSTGRES_DB=sinergi_security\nPOSTGRES_USER=security_owner\nPOSTGRES_PASSWORD=${ownerPassword}\nSINERGI_RUNTIME_DB_PASSWORD=${runtimePassword}\nSINERGI_TLS_DIR=${work.replaceAll('\\','/')}\nSINERGI_HTTP_PORT=0\nSINERGI_HTTPS_PORT=0\nSINERGI_PROXY_SUBNET=172.30.222.0/24\nSINERGI_BACKEND_IMAGE=sinergi-security-backend:local\nSINERGI_FRONTEND_IMAGE=sinergi-security-frontend:local\n`, { mode: 0o600 })
  // A test-only bridge permits the host test runner to reach its disposable DB.
  // It is absent from the production file and is never joined by the frontend.
  const overrides = { services: { db: { ports: ['127.0.0.1:0:5432'], networks: ['database','verification'] } }, networks: { verification: {} } }
  await writeFile(override, JSON.stringify(overrides))
  const production = JSON.parse(run(['compose','--project-name',project,'--env-file',environment,'--file','docker-compose.production.yml','config','--format','json']))
  assert.ok(!production.services.db.ports?.length && !production.services.backend.ports?.length)
  assert.equal(production.networks.database.internal, true)
  assert.equal(production.services.frontend.networks.database, undefined)
  check('Production exposes only the frontend and isolates the database network')
  console.log('Building isolated security images...')
  await commandToLog(docker, [...compose,'build','backend','frontend'], path.join(evidence,'stage-3-docker-build.txt'))
  started = true
  await commandToLog(docker, [...compose,'up','--detach','--no-build','--wait','--wait-timeout','180'], path.join(work,'startup.txt'))
  const ca = await readFile(path.join(work,'fullchain.pem')), httpPort = port('frontend',8080), httpsPort = port('frontend',8443), dbPort = port('db',5432)
  const secure = (route, { method = 'GET', body, token, headers: extraHeaders = {} } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const request = https.request({ hostname:'127.0.0.1', port:httpsPort, path:route, ca, method, headers:{ ...extraHeaders, ...(token?{authorization:`Bearer ${token}`} : {}), ...(bytes?{'content-type':'application/json','content-length':bytes.length}:{}) } }, response => {
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,bytes:Buffer.concat(chunks)}))
    });request.on('error',reject);if(bytes)request.write(bytes);request.end()
  })
  const json = async (route, options) => { const result=await secure(route,options);return {...result,body:JSON.parse(result.bytes.toString())} }
  assert.equal((await fetch(`http://127.0.0.1:${httpPort}/map`,{redirect:'manual'})).status,308)
  for (const version of ['TLSv1.2','TLSv1.3']) await new Promise((resolve,reject)=>{const socket=tls.connect({host:'127.0.0.1',port:httpsPort,ca,servername:'localhost',minVersion:version,maxVersion:version},()=>{assert.equal(socket.getProtocol(),version);socket.end();resolve()});socket.on('error',reject)})
  const html=await secure('/topologi?datasetId=security-dataset')
  assert.equal(html.status,200);assert.match(html.headers['strict-transport-security'],/max-age=31536000/)
  assert.match(html.headers['content-security-policy'],/worker-src 'self' blob:/)
  assert.doesNotMatch(html.headers['content-security-policy'],/unsafe-eval|\*/)
  check('Trusted test certificate, TLS 1.2/1.3, HTTP redirect, HSTS, CSP and direct SPA URL')
  owner=new pg.Pool({host:'127.0.0.1',port:dbPort,user:'security_owner',password:ownerPassword,database:'sinergi_security'})
  runtime=new pg.Pool({host:'127.0.0.1',port:dbPort,user:'sinergi_runtime',password:runtimePassword,database:'sinergi_security'})
  assert.ok(dbPort>0,'Disposable test database must have an assigned loopback port')
  const role=(await runtime.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]
  assert.ok(Object.values(role).every(value=>value===false))
  for (const statement of ['CREATE TABLE sinergi.forbidden(id int)','CREATE TABLE public.forbidden(id int)','CREATE TEMP TABLE forbidden(id int)','ALTER TABLE sinergi.assets ADD COLUMN forbidden int','TRUNCATE sinergi.audit_events',"UPDATE sinergi.audit_events SET event='changed'","DELETE FROM sinergi.audit_events"]) await assert.rejects(runtime.query(statement),{code:'42501'})
  await runtime.query("INSERT INTO sinergi.audit_events(id,event) VALUES('security-proof','security.permission_probe')")
  assert.equal((await runtime.query("SELECT event FROM sinergi.audit_events WHERE id='security-proof'")).rows[0].event,'security.permission_probe')
  check('Runtime is non-superuser, cannot perform DDL or mutate audit, and can append/read audit')
  const testLog=path.join(work,'backend-integration.txt')
  console.log('Running PostgreSQL integration tests on the isolated database...')
  await commandToLog(process.execPath,['--test','--test-concurrency=1'],testLog,{...process.env,SINERGI_TEST_DATABASE_URL:`postgresql://security_owner:${ownerPassword}@127.0.0.1:${dbPort}/sinergi_security`},path.join(root,'backend'))
  const log=await readFile(testLog,'utf8');assert.match(log,/skipped 0/)
  await writeFile(path.join(evidence,'stage-3-backend-integration.txt'),log)
  check('Entire backend suite including real PostgreSQL workflow passes without skipped integration')
  const accounts=new PostgresAccountStore(owner)
  await accounts.save({username:'security-admin',password:accountPassword,role:'Administrator'})
  await accounts.save({username:'security-viewer',password:accountPassword,role:'Viewer'})
  await owner.query("INSERT INTO sinergi.dataset_state(id) VALUES('security-dataset')")
  const login=await json('/api/auth/login',{method:'POST',body:{identifier:'security-admin',password:accountPassword}})
  assert.equal(login.status,200);const token=login.body.token
  const viewer=await json('/api/auth/login',{method:'POST',body:{identifier:'security-viewer',password:accountPassword}})
  assert.equal((await json('/api/admin/users',{token:viewer.body.token})).status,403)
  assert.equal((await json('/api/admin/users',{method:'POST',token,body:{username:'short-password',role:'Viewer',password:'12345678901234'}})).status,400)
  const created=await json('/api/admin/users',{method:'POST',token,body:{username:'runtime-created',role:'Viewer',password:accountPassword}})
  assert.equal(created.status,201)
  const createdLogin=await json('/api/auth/login',{method:'POST',body:{identifier:'runtime-created',password:accountPassword}})
  assert.equal(createdLogin.status,200)
  const reset=await json(`/api/admin/users/${created.body.user.id}/password`,{method:'POST',token,body:{password:accountPassword+'-reset',expectedUpdatedAt:created.body.user.updatedAt}})
  assert.equal(reset.status,200)
  assert.equal((await json('/api/auth/me',{token:createdLogin.body.token})).status,401)
  const afterReset=await json('/api/auth/login',{method:'POST',body:{identifier:'runtime-created',password:accountPassword+'-reset'}})
  assert.equal(afterReset.status,200)
  assert.equal((await json(`/api/admin/users/${created.body.user.id}`,{method:'PATCH',token,body:{role:'Administrator',expectedUpdatedAt:reset.body.user.updatedAt}})).status,200)
  assert.equal((await json('/api/auth/me',{token:afterReset.body.token})).status,401)
  const salt=randomBytes(16).toString('hex'),hash=`scrypt$${salt}$${scryptSync(legacyPassword,salt,64).toString('hex')}`
  await owner.query("INSERT INTO sinergi.app_users(id,username,password_hash,role) VALUES('legacy-security-user','legacy-security-user',$1,'Viewer')",[hash])
  assert.equal((await json('/api/auth/login',{method:'POST',body:{identifier:'legacy-security-user',password:legacyPassword}})).status,200)
  for(let n=0;n<6;n++){const attempt=await json('/api/auth/login',{method:'POST',headers:{'x-forwarded-for':`192.0.2.${n+1}`},body:{identifier:'proxy-probe',password:'wrong'}});assert.equal(attempt.status,n<5?401:429);if(n===5)assert.ok(Number(attempt.headers['retry-after'])>0)}
  check('Production role supports account create/reset/role revocation, legacy passwords and rejects forwarded-IP throttle bypass')
  // Synthetic import writes only into this unique test project and its own volume.
  const kml='<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Security Facility</name><Folder><name>CCTV</name><Placemark><name>SECURITY-CAMERA</name><Point><coordinates>110,-7,0</coordinates></Point></Placemark></Folder></Folder></Document></kml>'
  const boundary='sinergi-security-boundary',multipart=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="datasetId"\r\n\r\nsecurity-dataset\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="security.kml"\r\nContent-Type: application/vnd.google-earth.kml+xml\r\n\r\n${kml}\r\n--${boundary}--\r\n`)
  const upload=await new Promise((resolve,reject)=>{const req=https.request({hostname:'127.0.0.1',port:httpsPort,path:'/api/imports',method:'POST',ca,headers:{authorization:`Bearer ${token}`,'content-type':`multipart/form-data; boundary=${boundary}`,'content-length':multipart.length}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}))});req.on('error',reject);req.end(multipart)})
  assert.equal(upload.status,202);const importId=upload.body.importId
  let ready=false
  for(let n=0;n<60;n++){const result=await json(`/api/imports/${importId}`,{token});if(result.body.import.status==='ready'&&result.body.job.status==='succeeded'){ready=true;break}assert.notEqual(result.body.import.status,'failed');await delay(500)}
  assert.ok(ready,'Import worker must finish before backup')
  assert.equal((await json(`/api/imports/${importId}/apply`,{method:'POST',token,body:{expectedRevision:0}})).status,200)
  const revision=Number((await owner.query("SELECT revision FROM sinergi.dataset_state WHERE id='security-dataset'")).rows[0].revision)
  assert.ok([200,201].includes((await json('/api/datasets/security-dataset/versions',{method:'POST',token,body:{name:'Security checkpoint',expectedRevision:revision}})).status))
  assert.equal((await secure(`/api/imports/${importId}/source-file`,{token})).bytes.toString(),kml)
  check('Synthetic import, worker, apply, source download and checkpoint work with production DB privileges')
  await owner.end();owner=null;await runtime.end();runtime=null
  const backupArgs=['backend/scripts/backup-operational.mjs',`--project=${project}`,`--env-file=${environment}`,'--compose-file=docker-compose.production.yml',`--compose-file=${override}`,'--restore-db=sinergi_security_restore']
  const refuseRunning=spawnSync(process.execPath,backupArgs,{cwd:root,encoding:'utf8',env:{...process.env,SINERGI_DOCKER_BIN:docker}})
  assert.equal(refuseRunning.status,1);assert.match(refuseRunning.stderr,/Hentikan backend/)
  const securityLogs=run([...compose,'logs','--no-color','backend'])
  for(const secret of [ownerPassword,runtimePassword,accountPassword,legacyPassword,token,viewer.body.token,createdLogin.body.token,afterReset.body.token])assert.equal(securityLogs.includes(secret),false)
  check('Production logs exclude credentials/tokens and backup refuses a running writer')
  run([...compose,'stop','backend'])
  const backupOutput=execFileSync(process.execPath,['backend/scripts/backup-operational.mjs',`--project=${project}`,`--env-file=${environment}`,'--compose-file=docker-compose.production.yml',`--compose-file=${override}`,'--restore-db=sinergi_security_restore'],{cwd:root,encoding:'utf8',env:{...process.env,SINERGI_DOCKER_BIN:docker}})
  const backup=JSON.parse(backupOutput)
  const refuseExisting=spawnSync(process.execPath,backupArgs,{cwd:root,encoding:'utf8',env:{...process.env,SINERGI_DOCKER_BIN:docker}})
  assert.equal(refuseExisting.status,1);assert.match(refuseExisting.stderr,/Database restore sudah ada/)
  check('Backup refuses to overwrite an existing restore database')
  assert.equal(backup.proof.length,13);assert.ok(backup.sourceFiles.length>0);assert.equal(backup.consistentBackendStopped,true)
  const restoredData=path.join(work,'restored-source');await cp(path.join(backup.backupDirectory,'source-storage'),restoredData,{recursive:true})
  for(const file of backup.sourceFiles){assert.ok(!file.path.includes('..'));const bytes=await readFile(path.join(restoredData,file.path));assert.equal(bytes.length,file.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256)}
  overrides.services.restored={image:'sinergi-security-backend:local',environment:{NODE_ENV:'production',SINERGI_HOST:'0.0.0.0',SINERGI_PORT:'5000',SINERGI_DATA_ROOT:'/app/.data',SINERGI_DATABASE_URL:`postgresql://sinergi_runtime:${runtimePassword}@db:5432/sinergi_security_restore`},volumes:[`${restoredData.replaceAll('\\','/')}:/app/.data`],networks:['edge','database'],ports:['127.0.0.1:0:5000']}
  await writeFile(override,JSON.stringify(overrides))
  run([...compose,'up','--detach','--no-build','--no-deps','--wait','--wait-timeout','60','restored'])
  const restoredUrl=`http://127.0.0.1:${port('restored',5000)}`
  const restoredLogin=await fetch(restoredUrl+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:'security-admin',password:accountPassword})})
  assert.equal(restoredLogin.status,200);const restoredToken=(await restoredLogin.json()).token
  const source=await fetch(restoredUrl+`/api/imports/${importId}/source-file`,{headers:{authorization:`Bearer ${restoredToken}`}})
  assert.equal(source.status,200);assert.equal(await source.text(),kml)
  assert.equal((await fetch(restoredUrl+'/api/datasets/security-dataset/active',{headers:{authorization:`Bearer ${restoredToken}`}})).status,200)
  summary.restore={tables:13,sourceFiles:backup.sourceFiles.length,checksumsVerified:true,loginAndSourceDownload:true}
  check('Restore reproduces all 13 table digests, every file hash, working login, active dataset and original KML')
}

try { await main() } catch(error) { console.error(`Security verification failed: ${error.message.replaceAll(ownerPassword,'[redacted]').replaceAll(runtimePassword,'[redacted]').replaceAll(accountPassword,'[redacted]').replaceAll(legacyPassword,'[redacted]')}`);process.exitCode=1 }
finally {
  await owner?.end().catch(()=>{});await runtime?.end().catch(()=>{})
  if(started){if(process.exitCode){try{await writeFile(path.join(work,'failure-services.txt'),run([...compose,'logs','--no-color']))}catch{/* Preserve cleanup even if diagnostics are unavailable. */}}assert.match(project,/^sinergi-security-test-[a-f0-9]{8}$/);run([...compose,'down','--volumes','--remove-orphans']);summary.testResourcesRemoved=true}
  summary.result=process.exitCode?'failed':'passed'
  await writeFile(path.join(evidence,'stage-3-stack-results.json'),JSON.stringify(summary,null,2)+'\n')
}
