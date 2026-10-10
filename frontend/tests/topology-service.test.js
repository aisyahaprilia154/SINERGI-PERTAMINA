import test from 'node:test'
import assert from 'node:assert/strict'
import {saveTopologyDiagram,loadActiveDataset,createTopologyRelation} from '../src/services/active-dataset-service.js'
import {activateDatasetVersion} from '../src/services/import-dataset-service.js'
test('shared dataset API sends a single revision-guarded diagram mutation',async()=>{
 const original=globalThis.fetch,requests=[]
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({revision:8}),{status:200})}
 try {
  await saveTopologyDiagram({datasetId:'shared',expectedRecordRevision:7,token:'admin',changes:[{type:'remove-edge',edgeId:'old'},{type:'add-relation',sourceAssetId:'jb',targetAssetId:'printer'}]})
  assert.equal(requests[0].url,'/api/datasets/shared/diagram')
  assert.deepEqual(JSON.parse(requests[0].options.body),{expectedRevision:7,changes:[{type:'remove-edge',edgeId:'old'},{type:'add-relation',sourceAssetId:'jb',targetAssetId:'printer'}]})
 }finally{globalThis.fetch=original}
})
test('active data reads no longer require a branch',async()=>{
 const original=globalThis.fetch
 globalThis.fetch=async url=>{assert.equal(url,'/api/datasets/shared/active');return new Response('{}')}
 try{await loadActiveDataset({datasetId:'shared',token:'viewer'})}finally{globalThis.fetch=original}
})
test('applying an import sends only the guarded revision',async()=>{
 const original=globalThis.fetch
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/imports/new-import/apply');assert.deepEqual(JSON.parse(options.body),{expectedRevision:12});return new Response('{}')}
 try{await activateDatasetVersion({importId:'new-import',expectedRevision:12,token:'admin'})}finally{globalThis.fetch=original}
})
test('creating a generic connection uses the diagram transaction',async()=>{
 const original=globalThis.fetch
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/datasets/shared/diagram');assert.equal(JSON.parse(options.body).changes[0].targetAssetId,'fridge');return new Response('{}')}
 try{await createTopologyRelation({datasetId:'shared',expectedRecordRevision:2,sourceAssetId:'jb',targetAssetId:'fridge',token:'admin'})}finally{globalThis.fetch=original}
})
