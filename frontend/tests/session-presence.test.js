import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sendSessionHeartbeat,startSessionPresence} from '../src/services/session-presence.js'
import {saveSession,getSessionToken} from '../src/services/account-session.js'
import {renderUserRows,lastSeenLabel} from '../src/pages/admin/users-page.js'

test('heartbeat sends the actual session and does not report success on network failure',async()=>{
 let request
 assert.deepEqual(await sendSessionHeartbeat({token:'session',fetchImpl:async(...args)=>{request=args;return new Response(JSON.stringify({user:{role:'Viewer'}}))}}),{user:{role:'Viewer'}})
 assert.equal(request[0],'/api/auth/heartbeat');assert.equal(request[1].headers.Authorization,'Bearer session')
 assert.deepEqual(await sendSessionHeartbeat({token:'old',fetchImpl:async()=>new Response('',{status:401})}),{expired:true})
 await assert.rejects(sendSessionHeartbeat({token:'session',fetchImpl:async()=>new Response('',{status:503})}))
})

test('presence resumes after reconnection and bfcache, revokes expired sessions and stops cleanly',async()=>{
 const previousWindow=globalThis.window,previousDocument=globalThis.document,storage=new Map()
 const win=new EventTarget(),doc=new EventTarget();let interval,calls=0,cleared=false,redirected=false,fail=true
 Object.assign(win,{sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setInterval:callback=>{interval=callback;return 1},clearInterval:()=>{cleared=true},location:{replace:()=>{redirected=true},reload:()=>assert.fail('unchanged role must not reload')}})
 doc.visibilityState='visible';globalThis.window=win;globalThis.document=doc
 const settle=()=>new Promise(resolve=>setImmediate(resolve))
 try{
  saveSession({token:'real-token',user:{role:'Viewer'}})
  const stop=startSessionPresence({fetchImpl:async()=>{calls++;if(fail)throw new Error('offline');return new Response(JSON.stringify({user:{role:'Viewer'}}))}})
  await settle();assert.equal(calls,1);assert.equal(getSessionToken(),'real-token')
  fail=false;win.dispatchEvent(new Event('online'));await settle();assert.equal(calls,2)
  const hidden=new Event('pagehide');hidden.persisted=true;win.dispatchEvent(hidden)
  win.dispatchEvent(new Event('pageshow'));await settle();assert.equal(calls,3);assert.equal(cleared,false)
  interval();await settle();assert.equal(calls,4)
  stop();assert.equal(cleared,true);win.dispatchEvent(new Event('online'));await settle();assert.equal(calls,4)
  startSessionPresence({fetchImpl:async()=>new Response('',{status:401})});await settle()
  assert.equal(getSessionToken(),'');assert.equal(redirected,true)
 }finally{globalThis.window=previousWindow;globalThis.document=previousDocument}
})

test('user list renders server presence separately from account access and escapes user fields',()=>{
 const user={id:'safe-id',username:'<img onerror=alert(1)>',email:'a@example.test',role:'Viewer',active:true,online:false,lastSeenAt:null}
 const html=renderUserRows([user]);assert.match(html,/Aktif/);assert.match(html,/Offline/);assert.match(html,/Belum pernah masuk/);assert.equal(html.includes('<img'),false)
 assert.match(renderUserRows([{...user,online:true}]),/is-online/)
 const stale=renderUserRows([{...user,online:true}],{unconfirmed:true});assert.match(stale,/Belum diperbarui/);assert.equal(stale.includes('is-online'),false)
 assert.equal(lastSeenLabel('2026-10-10T09:00:00Z','2026-10-10T09:02:00Z'),'2 menit lalu')
})
