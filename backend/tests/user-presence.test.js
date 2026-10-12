import test from 'node:test'
import assert from 'node:assert/strict'
import {TokenAuthenticator,ONLINE_TIMEOUT_MS} from '../src/security/authorization.js'
import {protectLastAdministrator,PostgresAccountStore} from '../src/security/account-store.js'
const request=token=>({headers:{authorization:`Bearer ${token}`}})

test('online expires without a heartbeat and returns on authenticated activity',()=>{
  let now=100_000;const auth=new TokenAuthenticator({}, {now:()=>now}),{token}=auth.issueSession({id:'user',role:'Viewer'})
  assert.equal(auth.isOnline('user'),true);now+=ONLINE_TIMEOUT_MS;assert.equal(auth.isOnline('user'),false)
  auth.touch(request(token));assert.equal(auth.isOnline('user'),true)
  now+=8*60*60*1000;assert.equal(auth.isOnline('user'),false);assert.throws(()=>auth.authenticate(request(token)),{code:'invalid_token'})
})
test('logout clears one session; another live session still keeps the user online',()=>{
  const auth=new TokenAuthenticator(),first=auth.issueSession({id:'user'}),second=auth.issueSession({id:'user'})
  auth.revoke(request(first.token));assert.equal(auth.isOnline('user'),true)
  auth.revokeUser('user');assert.equal(auth.isOnline('user'),false)
  assert.throws(()=>auth.authenticate(request(second.token)),{code:'invalid_token'})
})
test('a backend restart shows no online user until a new valid session exists',()=>{
  const first=new TokenAuthenticator(),session=first.issueSession({id:'user'}),restarted=new TokenAuthenticator()
  assert.equal(restarted.isOnline('user'),false);assert.throws(()=>restarted.authenticate(request(session.token)),{code:'invalid_token'})
})
test('the last administrator cannot be downgraded',()=>{
  const admin={role:'Administrator'}
  assert.throws(()=>protectLastAdministrator(admin,{role:'Viewer'},1),{code:'last_administrator'})
  assert.doesNotThrow(()=>protectLastAdministrator(admin,{role:'Viewer'},2))
  assert.doesNotThrow(()=>protectLastAdministrator(admin,{role:'Administrator'},1))
})

test('removed account status is rejected before writing or opening a transaction',async()=>{
  const store=new PostgresAccountStore({query(){throw new Error('Should not query')}})
  for(const active of [true,false,null])await assert.rejects(store.manage({actorId:'admin',userId:'user',body:{active}}),{code:'unsupported_account_status',statusCode:400})
})
