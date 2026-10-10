import {test} from 'node:test'
import assert from 'node:assert/strict'
import {matchAdditions,detectConnections,detectMountings,proposalsFromCanonical} from '../src/import/operational-import.js'

const device=(id,name,coordinate,category='Kulkas')=>({id,name,kind:'device',category,diagramRole:'endpoint',facility:{key:'site a',name:'Site A'},explicitId:null,
 source:{featureId:`feature-${id}`,key:`/rjbt/site a/${category}|${name}`,folderPath:`/RJBT/Site A/${category}`,geometry:{type:'Point',coordinates:coordinate},parts:[]},properties:{assetType:category}})
const fridge=device('new-fridge','Kulkas',[110.0001,-7])
const jb={id:'old-jb',name:'JB',kind:'device',facility_id:'site',geometry:{type:'Point',coordinates:[110,-7]},properties:{diagramRole:'junction-peer'}}
const baseline={assets:[jb],facilities:[{id:'site',name:'Site A'}],aliases:[],relations:[]}
const line={...device('line','Kabel',null),kind:'path',source:{featureId:'line-feature',key:'line-key',folderPath:'/RJBT/Site A/LAN',geometry:{type:'LineString',coordinates:[[110,-7],[110.0001,-7]]},parts:[]}}
test('new generic device connects to a JB existing only in the baseline',()=>{
 const items=matchAdditions([fridge,line],baseline)
 const relations=detectConnections(items,baseline)
 assert.equal(relations.length,1);assert.equal(relations[0].status,'new')
 assert.equal(relations[0].proposal.sourceAssetId,'old-jb');assert.equal(relations[0].proposal.targetAssetId,'new-fridge')
})
test('source aliases preserve corrected and deleted existing assets',()=>{
 const b={...baseline,assets:[{...jb,id:fridge.id,deleted:true}],aliases:[{asset_id:fridge.id,match_type:'source_key',match_value:fridge.source.key}]}
 assert.equal(matchAdditions([fridge],b)[0].status,'existing')
})
test('facility folder aliases match the same inventory without changing the source folder',()=>{
 const incoming=structuredClone(fridge);incoming.facility={key:'alternative site',name:'Alternative Site'}
 incoming.source.folderPath='/RJBT/Alternative Site/Kulkas';incoming.source.key='alternative-source'
 const b={...baseline,assets:[{...jb,id:fridge.id}],facilities:[{id:'site',name:'Site A',aliases:['alternative site']}],
  aliases:[{asset_id:fridge.id,match_type:'folder_name_type',match_value:'/rjbt/site a/kulkas|kulkas|kulkas'}]}
 const item=matchAdditions([incoming],b)[0]
 assert.equal(item.status,'existing');assert.equal(item.matched_asset_id,fridge.id)
 assert.equal(item.proposal.facility.id,'site');assert.equal(item.proposal.source.folderPath,'/RJBT/Alternative Site/Kulkas')
})
test('duplicates and multiple identity matches require explicit resolution',()=>{
 assert.deepEqual(matchAdditions([fridge,fridge],baseline).map(i=>i.status),['conflict','conflict'])
})
test('an unchanged source fingerprint distinguishes existing repeated names',()=>{
 const proposal={...fridge,source:{...fridge.source,fingerprint:'exact-source'}}
 const b={...baseline,assets:[{...jb,id:'first',fingerprint:'exact-source'},{...jb,id:'second',fingerprint:'different-source'}],
  aliases:['first','second'].map(id=>({asset_id:id,match_type:'source_key',match_value:fridge.source.key}))}
 const items=matchAdditions([proposal,{...proposal,source:{...proposal.source,fingerprint:'different-source'}}],b)
 assert.deepEqual(items.map(i=>i.status),['existing','existing']);assert.deepEqual(items.map(i=>i.matched_asset_id),['first','second'])
})
test('ambiguous line endpoints are never selected by nearest distance',()=>{
 const b={...baseline,assets:[jb,{...jb,id:'other-jb',geometry:{type:'Point',coordinates:[110.00001,-7]}}]}
 const items=matchAdditions([fridge,line],b)
 assert.equal(detectConnections(items,b)[0].status,'conflict')
})
test('admin deleted connections are not resurrected by another import',()=>{
 const b={...baseline,relations:[{kind:'connection',source_asset_id:'old-jb',target_asset_id:'new-fridge',deleted:true}]}
 assert.equal(detectConnections(matchAdditions([fridge,line],b),b).length,0)
})
test('explicit endpoint metadata resolves colocated devices without guessing',()=>{
 const other={...jb,id:'other-jb'}
 const explicitLine={...line,source:{...line.source,properties:{metadata:{source_asset_id:'old-jb',target_asset_id:'new-fridge'}}}}
 const b={...baseline,assets:[jb,other]}
 const result=detectConnections(matchAdditions([fridge,explicitLine],b),b)
 assert.equal(result[0].status,'new');assert.equal(result[0].proposal.sourceAssetId,'old-jb')
})
test('intermediate JB vertex splits a path into operational connections',()=>{
 const middle={...jb,id:'middle-jb',geometry:{type:'Point',coordinates:[110.001,-7]}}
 const end=device('end','Printer',[110.002,-7],'Printer')
 const path={...line,source:{...line.source,geometry:{type:'LineString',coordinates:[[110,-7],[110.001,-7],[110.002,-7]]}}}
 const b={...baseline,assets:[jb,middle]}
 const result=detectConnections(matchAdditions([end,path],b),b)
 assert.equal(result.length,2);assert.ok(result.every(r=>r.status==='new'))
 assert.equal(result[0].proposal.targetAssetId,'middle-jb');assert.equal(result[1].proposal.targetAssetId,'end')
})
test('a new generic endpoint is mounted only when the source explicitly says so',()=>{
 const pole={...jb,id:'pole',properties:{diagramRole:'physical-mount'}}
 const b={...baseline,assets:[pole]}
 const nearby={...fridge,source:{...fridge.source,geometry:pole.geometry}}
 assert.deepEqual(detectMountings(matchAdditions([nearby],b),b),[])
 const explicit={...nearby,source:{...nearby.source,properties:{metadata:{mounted_on:'pole'}}}}
 const result=detectMountings(matchAdditions([explicit],b),b)
 assert.equal(result[0].status,'new');assert.equal(result[0].proposal.kind,'mounting');assert.equal(result[0].proposal.targetAssetId,'pole')
})
test('an unknown category under a Server folder remains an endpoint',()=>{
 const canonical={sourceFeatures:[{sourceFeatureId:'f',sourceFolderPath:'/RJBT/Site A/Server/Sensor',sourceIdentityKey:'source'}],
  classifiedObjects:[{sourceFeatureId:'f',category:'Infrastructure',diagramClass:'rack-root',assetType:'server'}],
  sourceGeometries:[{sourceFeatureId:'f',geometryId:'g',geometryType:'Point',coordinates:[110,-7]}]}
 const result=proposalsFromCanonical(canonical,{assets:[{sourceFeatureId:'f',name:'Sensor 1'}]},'dataset')[0]
 assert.equal(result.category,'Sensor');assert.equal(result.diagramRole,'endpoint');assert.equal(result.properties.dynamicCategory,true)
})
test('a new endpoint can complete a line already present in the baseline',()=>{
 const stored={id:'old-path',kind:'path',facility_id:'site',geometry:line.source.geometry,properties:{},parts:[],source_feature_id:'old-line-feature'}
 const b={...baseline,assets:[jb,stored],aliases:[{asset_id:'old-path',match_type:'source_key',match_value:line.source.key}]}
 const changedLine={...line,source:{...line.source,geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}}}
 const result=detectConnections(matchAdditions([fridge,changedLine],b),b)
 assert.equal(result[0].proposal.pathAssetId,'old-path');assert.equal(result[0].proposal.targetAssetId,'new-fridge')
})
