import test from 'node:test'
import assert from 'node:assert/strict'
import {previewMapPayload,renderAdditions} from '../src/pages/admin/preview-import-page.js'
import {adaptActiveDatasetForMap,adaptActiveDatasetForTopology} from '../src/adapters/active-dataset-map-adapter.js'

const baseline={operationalSchema:2,datasetVersion:{id:'old-import',datasetId:'shared'},assets:[{id:'jb',name:'JB',type:'JB',category:'Infrastructure',objectRole:'device_node',diagramClass:'junction-peer',sourceFolderPath:'/RJBT/Site A/JB'}],
 geometries:[{id:'old-point',assetNodeId:'jb',geometryType:'point',coordinates:[110,-7]}],layers:[],mountingRelations:[],topologyGraph:{nodes:[],edges:[]}}
const fridge={id:'fridge',name:'Kulkas',category:'Kulkas',kind:'device',diagramRole:'endpoint',facility:{key:'site a',name:'Site A'},properties:{assetType:'Kulkas',dynamicCategory:true},source:{folderPath:'/RJBT/Site A/Kulkas',geometry:{type:'Point',coordinates:[110.0002,-7]}}}
const preview={additions:{assets:[fridge],relations:[{id:'edge',sourceAssetId:'jb',targetAssetId:'fridge'}]},items:[{kind:'asset',status:'new',proposal:fridge}]}
test('preview shows additions and optionally baseline connection context',()=>{
 const additions=previewMapPayload(preview,baseline,false)
 assert.deepEqual(additions.assets.map(a=>a.id),['fridge']);assert.equal(additions.topologyGraph.edges.length,0)
 const context=previewMapPayload(preview,baseline,true)
 assert.deepEqual(context.assets.map(a=>a.id),['jb','fridge']);assert.equal(context.topologyGraph.edges.length,1)
 assert.equal(baseline.assets.length,1)
})
test('rerendering preview never appends proposed mounting to the baseline',()=>{
 const mounting={...preview,additions:{assets:[fridge],relations:[{id:'mount',kind:'mounting',sourceAssetId:'fridge',targetAssetId:'jb'}]}}
 const first=previewMapPayload(mounting,baseline,true),second=previewMapPayload(mounting,baseline,true)
 assert.equal(first.mountingRelations.length,1);assert.equal(second.mountingRelations.length,1);assert.equal(baseline.mountingRelations.length,0)
})
test('new category remains an endpoint and shares the same relation in map and diagram',()=>{
 const payload=previewMapPayload(preview,baseline,true),map=adaptActiveDatasetForMap(payload),diagram=adaptActiveDatasetForTopology(payload)
 assert.equal(diagram.assets.find(a=>a.id==='fridge').diagramClass,'endpoint')
 assert.deepEqual(map.topologyGraph.edges,diagram.topologyGraph.edges)
 assert.equal(map.assets.find(a=>a.id==='fridge').category,'Kulkas')
})
test('asset source text is escaped in the additions preview',()=>{
 const html=renderAdditions([{kind:'asset',status:'new',proposal:{...fridge,name:'<script>alert(1)</script>'}}])
 assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/)
})
