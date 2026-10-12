import {test} from 'node:test'
import assert from 'node:assert/strict'
import {encodeCheckpoint,decodeCheckpoint} from '../src/storage/dataset-checkpoints.js'

test('checkpoint serialization is deterministic and compression validates content and scope',async()=>{
 const a={format:1,datasetId:'d',state:{active_import_ids:[],diagram_layout:{x:4}},facilities:[],categories:[],sources:[],assets:[],aliases:[],relations:[],imports:[]}
 const b=Object.fromEntries(Object.entries(a).reverse())
 const first=await encodeCheckpoint(a),second=await encodeCheckpoint(b)
 assert.equal(first.checksum,second.checksum);assert.ok(first.bytes.length<first.rawSize)
 const row={format_version:1,payload:first.bytes,raw_size:first.rawSize,checksum:first.checksum}
 assert.deepEqual(await decodeCheckpoint(row,'d'),a)
 for(const altered of [{...row,checksum:'bad'},{...row,format_version:2},{...row,raw_size:first.rawSize+1},{...row,payload:Buffer.from('broken')}])await assert.rejects(decodeCheckpoint(altered,'d'),{code:'checkpoint_invalid'})
 await assert.rejects(decodeCheckpoint(row,'other'),{code:'checkpoint_invalid'})
 const wrong=await encodeCheckpoint({...a,assets:[{id:'a',dataset_id:'other'}]})
 await assert.rejects(decodeCheckpoint({...row,payload:wrong.bytes,raw_size:wrong.rawSize,checksum:wrong.checksum},'d'),{code:'checkpoint_invalid'})
})
