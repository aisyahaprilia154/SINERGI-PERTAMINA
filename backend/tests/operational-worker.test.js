import {test} from 'node:test'
import assert from 'node:assert/strict'
import {OperationalWorker} from '../src/jobs/operational-worker.js'

test('a lost lease cannot mark the replacement worker import failed',async()=>{
 const statements=[]
 const client={query:async(sql)=>{statements.push(sql);if(sql.startsWith('SELECT *'))return {rows:[{id:'job',import_id:'import',attempts:0,max_attempts:1}]};return {rows:[],rowCount:0}}}
 const repository={pool:client,transaction:operation=>operation(client)}
 const worker=new OperationalWorker({repository,importService:{process:async()=>{throw Object.assign(new Error('Lost lease'),{code:'job_lease_lost',statusCode:409})}}})
 assert.equal(await worker.tick(),true)
 assert.equal(statements.some(sql=>sql.includes("SET status='failed',error")),false)
})
test('a recovered expired job carries its new owner into processing',async()=>{
 let owner
 const client={query:async(sql)=>sql.startsWith('SELECT *')?{rows:[{id:'job',import_id:'import',attempts:1,max_attempts:3}]}:{rows:[],rowCount:1}}
 const worker=new OperationalWorker({repository:{pool:client,transaction:f=>f(client)},importService:{process:async(id,options)=>{assert.equal(id,'import');owner=options.lease}}})
 await worker.tick();assert.equal(owner,worker.id)
})
