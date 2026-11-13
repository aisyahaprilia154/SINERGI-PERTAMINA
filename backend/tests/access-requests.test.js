import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import {AccessRequests,RequestLimiter,accessRequestInput,REQUEST_RECEIVED} from '../src/security/access-requests.js'
import {GoogleIdentity} from '../src/security/google-identity.js'
import {PostgresAccountStore} from '../src/security/account-store.js'
import {TokenAuthenticator} from '../src/security/authorization.js'
import {createOperationalApp} from '../src/operational-app.js'
import {createConfig} from '../src/config.js'
import os from 'node:os'

test('public application validates required fields and ignores caller roles and unverified Google claims',()=>{
  assert.throws(()=>accessRequestInput({kind:'access',fullName:'Name',email:'invalid',unit:'IT'}))
  assert.throws(()=>accessRequestInput({kind:'access',fullName:'Name',email:'a@example.test',unit:''}))
  const result=accessRequestInput({kind:'access',fullName:' Name ',email:'A@Example.test',unit:' IT ',role:'Administrator',google_subject:'forged'})
  assert.equal(result.email,'a@example.test');assert.equal(result.subject,null);assert.equal(result.role,undefined)
  const verified=accessRequestInput({kind:'access',fullName:'forged',email:'forged@example.test',unit:'IT'},{sub:'real',email:'owner@gmail.com',name:'Owner'})
  assert.equal(verified.fullName,'Owner');assert.equal(verified.email,'owner@gmail.com')
})
test('request limiter bounds submissions and recovers after expiry',()=>{
  let now=0;const limiter=new RequestLimiter({now:()=>now,max:2,window:100})
  limiter.check('ip');limiter.check('ip');assert.throws(()=>limiter.check('ip'),e=>e.statusCode===429);now=101;limiter.check('ip')
})
test('Google requires an allowed origin, a browser-bound single-use nonce and a verified email',async()=>{
  let nonce,payload;const google=new GoogleIdentity({pool:{},clientId:'test',origins:['http://localhost:5173'],verify:async()=>payload})
  const headers={},response={setHeader:(k,v)=>headers[k]=v},request={headers:{origin:'http://localhost:5173'}}
  ;({nonce}=google.challenge(request,response));request.headers.cookie=headers['set-cookie'].split(';')[0]
  payload={sub:'subject',email:'test@gmail.com',email_verified:true,nonce}
  await assert.rejects(google.identity({headers:{...request.headers,cookie:''}},{nonce,credential:'test'}),e=>e.statusCode===401)
  assert.equal((await google.identity(request,{nonce,credential:'test'})).sub,'subject')
  await assert.rejects(google.identity(request,{nonce,credential:'test'}),e=>e.statusCode===401)
  ;({nonce}=google.challenge(request,response));payload={...payload,nonce,email_verified:false}
  await assert.rejects(google.identity(request,{nonce,credential:'test'}),e=>e.statusCode===401)
  assert.throws(()=>google.assertOrigin({headers:{origin:'https://attacker.example'}}),e=>e.statusCode===403)
})

test('access approval, reset, Google linking and HTTP authorization on isolated PostgreSQL',{skip:!process.env.SINERGI_AUTH_TEST_DATABASE_URL},async t=>{
  const pool=new pg.Pool({connectionString:process.env.SINERGI_AUTH_TEST_DATABASE_URL,max:4}),requests=new AccessRequests(pool),accounts=new PostgresAccountStore(pool)
  const prefix=randomUUID().slice(0,8),password='a-test-password-with-20-characters',actor=`admin-${prefix}`
  const authenticator=new TokenAuthenticator({admin:{id:actor,role:'Administrator'},viewer:{id:'viewer',role:'Viewer'}})
  const config=createConfig({}, {dataRoot:os.tmpdir()})
  const server=createOperationalApp({repository:{pool},fileStore:{},importService:{},config,authenticator,accountStore:accounts,securityLogger:()=>{}})
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
  const http=async(path,{token='admin',body,origin='http://127.0.0.1:5173'}={})=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}}
  try{
    let requestId,user
    await t.test('public submission is generic, duplicate-safe and creates no user before approval',async()=>{
      const body={kind:'access',fullName:'Test User',email:`${prefix}@example.test`,unit:'IT',role:'Administrator'}
      assert.equal((await http('/api/auth/requests',{token:'',body})).body.message,REQUEST_RECEIVED)
      await http('/api/auth/requests',{token:'',body})
      assert.equal((await pool.query('SELECT 1 FROM sinergi.app_users WHERE email=$1',[body.email])).rowCount,0)
      const matches=(await requests.list()).requests.filter(r=>r.email===body.email);assert.equal(matches.length,1);requestId=matches[0].id
      assert.equal((await http('/api/admin/access-requests',{token:'viewer'})).status,403)
      assert.equal((await http('/api/auth/requests',{token:'',origin:'https://attacker.test',body})).status,403)
      assert.equal((await http('/api/auth/options',{token:''})).body.googleEnabled,false)
      assert.equal((await http('/api/auth/google/challenge',{token:''})).status,503)
    })
    await t.test('approval requires verification and is atomic, Viewer-only and single-use',async()=>{
      const payload={action:'approve',username:`user-${prefix}`,password,identityVerified:true,deliveryConfirmed:true,role:'Administrator'}
      await assert.rejects(requests.review(requestId,{...payload,identityVerified:false},actor))
      const result=await requests.review(requestId,payload,actor);user=await accounts.verify(payload.username,password)
      assert.equal(user.role,'Viewer');assert.equal(result.userId,user.id);assert.equal(user.username,payload.username)
      await assert.rejects(requests.review(requestId,payload,actor),e=>e.statusCode===409)
      assert.equal((await pool.query('SELECT status FROM sinergi.access_requests WHERE id=$1',[requestId])).rows[0].status,'approved')
      assert.equal((await pool.query("SELECT 1 FROM sinergi.audit_events WHERE event='access_request.approved' AND details->>'requestId'=$1",[requestId])).rowCount,1)
    })
    await t.test('failed account creation rolls back request, and rejection requires a reason',async()=>{
      const email=`duplicate-${prefix}@example.test`;await requests.submit({kind:'access',fullName:'Duplicate',email,unit:'IT'})
      const r=(await requests.list()).requests.find(r=>r.email===email)
      await assert.rejects(requests.review(r.id,{action:'approve',identityVerified:true,deliveryConfirmed:true,username:user.username,password},actor),e=>e.statusCode===409)
      assert.equal((await pool.query('SELECT status FROM sinergi.access_requests WHERE id=$1',[r.id])).rows[0].status,'pending')
      await assert.rejects(requests.review(r.id,{action:'reject',note:''},actor))
      await requests.review(r.id,{action:'reject',note:'Tidak sesuai hasil verifikasi.'},actor)
    })
    await t.test('reset does not enumerate accounts, duplicate approvals race safely and old sessions expire',async()=>{
      for(const identifier of [user.username,'no-such-account'])assert.equal((await requests.submit({kind:'password_reset',identifier})).message,REQUEST_RECEIVED)
      const r=(await requests.list()).requests.find(r=>r.kind==='password_reset'&&r.identifier===user.username)
      const body={action:'approve',identityVerified:true,deliveryConfirmed:true,password:password+'new'}
      const results=await Promise.allSettled([requests.review(r.id,body,actor),requests.review(r.id,body,actor)])
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
      assert.equal(await accounts.verify(user.username,password),null)
      await assert.rejects(accounts.resolveSession(user),e=>e.code==='session_revoked')
      user=await accounts.verify(user.username,body.password);assert.ok(user)
    })
    let googleProfile
    const google=new GoogleIdentity({pool,clientId:'test-client',origins:['http://localhost:5173'],verify:async()=>googleProfile})
    const request={headers:{origin:'http://localhost:5173'}}
    const credential=()=>{let cookie;const c=google.challenge(request,{setHeader:(_k,v)=>{cookie=v}});request.headers.cookie=cookie.split(';')[0];googleProfile={...googleProfile,nonce:c.nonce};return {nonce:c.nonce,credential:'verified-by-test-verifier'}}
    await t.test('Google first login requires application and approval before becoming a session user',async()=>{
      googleProfile={sub:`google-${prefix}`,name:'Google Owner',email:`${prefix}@gmail.com`,email_verified:true}
      const login=await google.login(request,credential());assert.equal(login.state,'application_required');assert.equal(login.user,undefined)
      const profile=google.application(request,login.applicationToken);await requests.submit({kind:'access',unit:'IT'},profile)
      assert.equal((await google.login(request,credential())).state,'pending')
      const r=(await requests.list()).requests.find(r=>r.google_subject===profile.sub)
      await requests.review(r.id,{action:'approve',identityVerified:true,username:`google-${prefix}`},actor)
      const accepted=await google.login(request,credential());assert.equal(accepted.user.role,'Viewer');assert.equal(accepted.user.hasPassword,false)
      assert.equal(await accounts.verify(`google-${prefix}`,password),null)
    })
    await t.test('matching email never auto-links; linking requires existing password and preserves role',async()=>{
      googleProfile={sub:`link-${prefix}`,name:'Local Owner',email:`${prefix}@example.test`,email_verified:true}
      assert.equal((await google.login(request,credential())).state,'link_required')
      await assert.rejects(google.link(request,{...credential(),password:'wrong'},user,accounts),e=>e.statusCode===401)
      await google.link(request,{...credential(),password:password+'new'},user,accounts)
      const login=await google.login(request,credential());assert.equal(login.user.id,user.id);assert.equal(login.user.role,'Viewer')
      assert.equal((await accounts.resolveSession(user)).hasGoogle,true)
      const body=credential();await assert.rejects(google.link(request,{...body,password:password+'new'},user,accounts),e=>e.statusCode===409)
    })
  }finally{await new Promise(r=>server.close(r));await pool.end()}
})
