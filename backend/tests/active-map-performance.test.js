import assert from 'node:assert/strict'
import test from 'node:test'
import { DatasetVersionLifecycleService, createActiveMapProjection, projectTopologyGraph, projectMapIdentityMap } from '../src/import/dataset-version-lifecycle-service.js'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'
import { adaptActiveDatasetForMap } from '../../frontend/src/adapters/active-dataset-map-adapter.js'
import { projectActiveReadRecord } from '../src/storage/active-read-record.js'

test('map projection omits engine archives while preserving aliases, geometry, and camera decisions', async () => {
  const evidence = 'import audit '.repeat(10_000)
  const assets = [
    { id: 'node-camera', canonicalAssetId: 'CAM-1', assetId: 'CAM-1', name: 'Camera 1', type: 'CCTV', category: 'CCTV', branchId: 'b', layerId: 'l' },
    { id: 'node-jb', canonicalAssetId: 'JB-1', assetId: 'JB-1', name: 'JB-1', type: 'Junction Box', category: 'CCTV Junction Box', branchId: 'b', layerId: 'l' },
  ]
  const graph = {
    datasetVersionId: 'v', graphRevision: 'published-revision',
    nodes: assets.map(a=>({ id:a.assetId, name:a.name, assetType:a.type, category:a.category, properties:{audit:evidence} })),
    edges: [{ id:'edge', sourceAssetId:'CAM-1', targetAssetId:'JB-1', relationType:'connected_to',
      relationSource:'manual_admin', verificationStatus:'confirmed', manualOrder:2,
      manualConfirmation:{reviewedAt:'2026-10-02T00:00:00Z', audit:evidence}, supportingEvidence:[evidence] }],
    components: [], serviceGraph:{audit:evidence}, interfaceRegistry:[evidence],
  }
  const identityMap = {
    datasetVersionId:'v', version:'identity-v1', identityRegistry:[{audit:evidence}],
    items: assets.map(a=>({canonicalAssetId:a.assetId, aliasValues:[a.id,a.assetId], aliases:{legacyNodeId:[a.id]}, sourceMatchEvidence:evidence})),
    aliasToCanonicalAssetId:{'CAM-1':'CAM-1','JB-1':'JB-1','node-camera':'CAM-1','node-jb':'JB-1',ambiguous:null},
  }
  const compactGraph = projectTopologyGraph(graph)
  const compactIdentity = projectMapIdentityMap(identityMap)
  const payload = { datasetVersion:{id:'v',datasetId:'d',branchId:'b',versionName:'test'}, assets,
    layers:[{id:'l',name:'CCTV'}], topologyGraph:graph, assetIdentityMap:identityMap,
    geometries:assets.map((a,i)=>({id:`g${i}`,assetNodeId:a.id,geometryType:'point',coordinates:[110+i/100,-7]})) }
  const before = adaptActiveDatasetForMap(payload)
  const after = adaptActiveDatasetForMap({...payload,topologyGraph:compactGraph,assetIdentityMap:compactIdentity})
  assert.deepEqual(after.assets.map(a=>a.id),before.assets.map(a=>a.id))
  assert.deepEqual(after.geometries.map(g=>g.coordinates),before.geometries.map(g=>g.coordinates))
  assert.deepEqual(after.topologyGraph.edges.map(e=>[e.id,e.sourceAssetId,e.targetAssetId]),before.topologyGraph.edges.map(e=>[e.id,e.sourceAssetId,e.targetAssetId]))
  assert.deepEqual(compactIdentity.aliasToCanonicalAssetId,identityMap.aliasToCanonicalAssetId)
  assert.equal(compactGraph.graphRevision,graph.graphRevision)
  assert.equal(compactGraph.edges[0].manualConfirmation.reviewedAt,graph.edges[0].manualConfirmation.reviewedAt)
  assert.ok(JSON.stringify({compactGraph,compactIdentity}).length < JSON.stringify({graph,identityMap}).length / 20)
  assert.ok(graph.serviceGraph && identityMap.identityRegistry)

  const record = {...payload,recordRevision:1,topologyReadiness:{ready:true}}
  const service = new DatasetVersionLifecycleService({
    repository:{resolveActiveVersion:async()=>({record,pointer:{datasetVersionId:'v',datasetId:'d',branchId:'b',revision:1}})},
    auditLog:{record:async()=>{}},
  })
  const actual = await service.getActiveMapDataset({datasetId:'d',branchId:'b'})
  assert.equal(Object.hasOwn(actual.topologyGraph,'serviceGraph'),false)
  assert.equal(Object.hasOwn(actual.assetIdentityMap,'identityRegistry'),false)
  assert.equal(actual.geometries.length,2)
  const prepared = projectActiveReadRecord(record)
  const materialized = new DatasetVersionLifecycleService({
    repository:{resolveActiveVersion:async()=>({record:prepared,pointer:{datasetVersionId:'v',datasetId:'d',branchId:'b',revision:1}})},
    auditLog:{record:async()=>{}},
  })
  assert.deepEqual(await materialized.getActiveMapDataset({datasetId:'d',branchId:'b'}),actual)
  const projector = createActiveMapProjection()
  const fast = new DatasetVersionLifecycleService({
    repository:{ mapProjection:projector, resolveActiveVersion:async({projection})=>{
      assert.equal(projection,'map-read')
      return { record:{datasetVersion:record.datasetVersion,activeMapDataset:projector.project(prepared)},
        pointer:{datasetVersionId:'v',datasetId:'d',branchId:'b',revision:1} }
    } }, auditLog:{record:async()=>{}},
  })
  assert.deepEqual(await fast.getActiveMapDataset({datasetId:'d',branchId:'b'}),actual)
})

test('cold PostgreSQL map reads select operational data; editing still reads the full aggregate', async () => {
  const queries=[]
  const record={datasetVersion:{id:'v',datasetId:'d',branchId:'b',status:'active'}}
  const pool={connect:async()=>({}),query:async(sql,values)=>{
    queries.push({sql,values})
    if(sql.includes('FROM dataset_active_pointers')) return {rows:[{dataset_id:'d',branch_id:'b',dataset_version_id:'v',revision:1}]}
    if(sql.includes('SELECT r.payload')) return {rows:[]}
    return {rows:[{payload:record,storage_revision:'123'}]}
  }}
  const repo=new PostgresDatasetVersionRepository(pool)
  await repo.resolveActiveVersion({datasetId:'d',branchId:'b',projection:'active-read'})
  const cold = queries.find(q=>q.sql.includes('jsonb_object_agg'))
  assert.match(cold.sql,/topologyShadowArtifacts/)
  assert.match(cold.sql,/sourceSelection/)
  assert.deepEqual(cold.values,['v'])
  assert.equal(queries.at(-1).values[3],'123')
  assert.match(queries.at(-1).sql,/xmin::text = \$4/)
  await repo.get('v')
  assert.match(queries.at(-1).sql,/SELECT payload\s+FROM dataset_versions/)
  assert.doesNotMatch(queries.at(-1).sql,/jsonb_object_agg/)
})

test('materialized operational record preserves detail data and packaged KMZ icons without mutating the archive', async () => {
  const record = {
    datasetVersion:{id:'v',datasetId:'d',branchId:'b',status:'active'},
    recordRevision:3, assets:[{id:'a',name:'New KMZ asset',properties:{description:'source detail'}}],
    sourceFeatures:[{sourceFeatureId:'f',sourceStyleUrl:'#custom'}],
    canonicalParser:{sourceSelection:{selectedKmlPath:'nested/doc.kml'},hugeArchive:'parser'},
    assetIdentityMap:{items:[{canonicalAssetId:'a',aliasValues:['f']}],identityRegistry:['archive']},
    topologyCandidates:[{sourceAssetId:'a',targetAssetId:'b',status:'candidate',evidence:['large audit']}],
    topologyShadowArtifacts:{audit:'archive'},identityRegistry:['archive'],
    sourceResources:[{relativePath:'nested/icons/new.png'}],sourceStyles:[{id:'custom'}],
    topologyGraph:{nodes:[{id:'a',properties:{serviceDomain:'cctv'}}],edges:[]},
  }
  const snapshot=structuredClone(record)
  const projected=projectActiveReadRecord(record)
  assert.deepEqual(projected.assets,record.assets)
  assert.deepEqual(projected.sourceFeatures,record.sourceFeatures)
  assert.deepEqual(projected.sourceResources,record.sourceResources)
  assert.deepEqual(projected.sourceStyles,record.sourceStyles)
  assert.deepEqual(projected.canonicalParser.sourceSelection,record.canonicalParser.sourceSelection)
  assert.equal(projected.recordRevision,3)
  assert.equal(Object.hasOwn(projected,'topologyShadowArtifacts'),false)
  assert.equal(Object.hasOwn(projected.assetIdentityMap,'identityRegistry'),false)
  assert.equal(Object.hasOwn(projected.topologyCandidates[0],'evidence'),false)
  assert.deepEqual(record,snapshot)

  const queries=[]
  const repo=new PostgresDatasetVersionRepository({connect:async()=>({}),query:async(sql,values)=>{
    queries.push({sql,values})
    if(sql.includes('FROM dataset_active_pointers')) return {rows:[{dataset_id:'d',branch_id:'b',dataset_version_id:'v',revision:1}]}
    return {rows:[{payload:projected}]}
  }})
  const read=await repo.resolveActiveVersion({datasetId:'d',branchId:'b',projection:'active-read'})
  assert.deepEqual(read.record,projected)
  assert.equal(queries.some(q=>q.sql.includes('jsonb_object_agg')),false)
  assert.match(queries.at(-1).sql,/r.storage_revision = v.xmin::text/)
})

test('a cold process reads the prepared map without fetching the operational or import aggregate', async () => {
  const projector=createActiveMapProjection()
  const source={datasetVersion:{id:'v',datasetId:'d',branchId:'b',status:'active'},assets:[],geometries:[],layers:[]}
  const model={datasetVersion:source.datasetVersion,activeMapDataset:projector.project(projectActiveReadRecord(source))}
  const queries=[]
  const repository=new PostgresDatasetVersionRepository({connect:async()=>({}),query:async(sql,values)=>{
    queries.push({sql,values})
    if(sql.includes('FROM dataset_active_pointers')) return {rows:[{dataset_id:'d',branch_id:'b',dataset_version_id:'v',revision:9}]}
    return {rows:[{payload:model,storage_revision:'101'}]}
  }},{mapProjection:projector})
  const resolved=await repository.resolveActiveVersion({datasetId:'d',branchId:'b',projection:'map-read'})
  assert.deepEqual(resolved.record,model)
  assert.equal(queries.length,2)
  assert.match(queries[1].sql,/r.read_view = 'map-read'/)
  assert.match(queries[1].sql,/r.storage_revision = v.xmin::text/)
  assert.equal(queries.some(q=>q.sql.includes('jsonb_object_agg')),false)
  assert.equal(queries.some(q=>/SELECT payload\s+FROM dataset_versions/.test(q.sql)),false)
})
