import assert from 'node:assert/strict'
import test from 'node:test'
import { assetCode, facilityRelations, correctedMountingExpectation, correctFacilityEdges } from '../../shared/facility-corrections.mjs'
import { generateRelationArtifacts, rebuildConfirmedRelationArtifacts, TOPOLOGY_RULE_SET_VERSION } from '../src/topology/semantic-relation-engine.js'
import { adaptActiveDatasetForTopology } from '../../frontend/src/adapters/active-dataset-map-adapter.js'
import { buildTopologyDiagramModel } from '../../frontend/src/domain/topology-diagram-model.js'
import { calculateTopologyDiagramLayout } from '../../frontend/src/pages/topology/topology-diagram-layout.js'
import { projectFacilityRecord } from '../src/topology/facility-record-projection.js'
import { TopologyService } from '../src/topology/topology-service.js'
import { renderTopologyDiagramSvg } from '../../frontend/src/pages/topology/topology-diagram-svg.js'

const names = ['Server', 'JB-01', 'JB-014', 'JB-02', 'JB-02.2', 'JB-04', 'JB-09', 'JB-10-EXP', 'C-32',
  'C-08', 'C-09', 'C-10', 'C-11', 'C-12', 'C-013', 'C-15', 'C-27', 'C-031',
  'JB-08', 'JB-08.3', 'JB-09.1', 'C-033-EXP', 'JB-10.1', 'C-034-EXP', 'JB-13-EXP',
  'C-37-EXP', 'C-38-EXP', 'C-39-EXP', 'C-40-EXP', 'C-44', 'C-45', 'C-46', 'T-01']
function assets() {
  return names.map(name => ({id: name, assetId: name, canonicalAssetId: name, name,
    sourceName: name, sourceFolderPath: '/RJBT/FT Tegal Baru/Devices',
    locationGroupKey: 'ft-tegal-baru',
    type: name.startsWith('C-') ? 'CCTV' : name.startsWith('JB-') ? 'Junction Box' : name === 'Server' ? 'Server' : 'Tiang',
    topologyRole: name.startsWith('C-') ? 'endpoint' : name === 'Server' ? 'root' : 'junction',
  }))
}
function bundle() {
  return { datasetVersion: {id: 'dv'}, site: 'site', semanticRuleSetVersion: 'test/1',
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION, classifiedPaths: [], explicitRelations: [],
    classifiedNodes: assets().map(a => ({...a, siteId: 'site', objectRole: 'device_node',
      assetType: a.type, networkFamily: 'cctv', classificationStatus: 'classified',
      sourceFeatureId: `f:${a.id}`, geometryIds: [`g:${a.id}`]})),
    geometries: assets().map(a => ({geometryId: `g:${a.id}`, datasetVersionId: 'dv',
      sourceFeatureId: `f:${a.id}`, geometryType: 'Point', valid: true, coordinates: [109, -6]})) }
}
test('Tegal facts resolve padded numbers, camera EXP aliases, and remain facility scoped', () => {
  assert.equal(assetCode({name: 'C-033-EXP'}), 'C-33')
  assert.equal(facilityRelations(assets()).length, 7)
  assert.equal(facilityRelations([...assets(), {id: 'cable', name: 'Jalur Server - JB-01',
    sourceFolderPath: '/RJBT/FT Tegal Baru/Cable'}]).length, 7)
  assert.equal(assets().filter(correctedMountingExpectation).length, 23)
  assert.equal(facilityRelations(assets().map(a => ({...a, locationGroupKey: 'other', sourceFolderPath: '/RJBT/Other'}))).length, 0)
  assert.equal(facilityRelations([...assets(), {...assets()[0], id: 'duplicate', assetId: 'duplicate', canonicalAssetId: 'duplicate'}]).length, 5)
})

test('backend graph and tracing project facility facts before regeneration without changing storage', async () => {
  const input = bundle()
  const record = {datasetVersion: {id: 'dv', branchId: 'semarang', datasetId: 'dataset-semarang'},
    assets: assets(), topologyInputBundle: input,
    topologyGraph: {nodes: input.classifiedNodes, edges: [{id: 'wrong',
      sourceAssetId: 'C-013', targetAssetId: 'JB-02.2', verificationStatus: 'confirmed'}]},
    mountingRelations: [{sourceAssetId: 'C-08', targetAssetId: 'T-01', relationType: 'mounted_on'}],
    mountingExpectations: [{assetId: 'C-08', expectation: 'pole'}]}
  const snapshot = structuredClone(record)
  const projection = projectFacilityRecord(record)
  assert.equal(projection.topologyGraph.edges.length, 7)
  assert.equal(projection.mountingRelations.length, 0)
  assert.equal(projection.mountingExpectations.filter(e => ['indoor', 'standalone'].includes(e.expectation)).length, 23)
  const service = new TopologyService({repository: {get: async () => record}})
  const response = await service.getGraph('dv')
  assert.equal(response.graph.edges.length, 7)
  assert.equal(response.confirmedRelations.length, 7)
  assert.ok(response.graph.components.length > 0)
  assert.deepEqual(service.normalizedTraceGraph(record).edges, response.graph.edges)
  assert.deepEqual(record, snapshot)
})
test('regeneration confirms requested links and preserves exclusions despite old pole attachments', () => {
  const input = bundle(), snapshot = structuredClone(input)
  const oldMounts = assets().filter(correctedMountingExpectation).map(a => ({
    sourceAssetId: a.id, targetAssetId: 'T-01', relationType: 'mounted_on', verificationStatus: 'confirmed'}))
  const first = generateRelationArtifacts(input, {previousMountingRelations: oldMounts})
  assert.equal(first.confirmedRelations.filter(r => r.relationKind === 'device_edge').length, 7)
  for (const a of assets().filter(correctedMountingExpectation)) {
    assert.equal(first.mountingRelations.some(r => r.sourceAssetId === a.id), false)
    assert.equal(first.mountingExpectations.find(e => e.assetId === a.id).expectation, correctedMountingExpectation(a))
  }
  const next = rebuildConfirmedRelationArtifacts(input, {candidates: first.candidates, previousRelations: first.confirmedRelations})
  assert.equal(next.confirmedRelations.filter(r => r.relationKind === 'device_edge').length, 7)
  assert.deepEqual(input, snapshot)
})
test('existing topology projections separate indoor frames and keep each camera network edge', () => {
  const sourceAssets = assets()
  const edges = [{id: 'wrong', sourceAssetId: 'C-013', targetAssetId: 'JB-02.2', verificationStatus: 'confirmed'},
    ...['C-09', 'C-10', 'C-11', 'C-12'].map(id => ({id, sourceAssetId: id, targetAssetId: 'JB-01', verificationStatus: 'confirmed'}))]
  const corrected = correctFacilityEdges(edges, sourceAssets)
  assert.ok(!corrected.some(e => e.id === 'wrong'))
  assert.deepEqual(correctFacilityEdges(corrected, sourceAssets), corrected)
  const view = adaptActiveDatasetForTopology({datasetVersion: {id: 'dv'}, assets: sourceAssets,
    topologyGraph: {nodes: sourceAssets, edges},
    mountingRelations: sourceAssets.filter(a => a.id !== 'T-01').map(a => ({sourceAssetId: a.id, targetAssetId: 'T-01', relationType: 'mounted_on'}))})
  const model = buildTopologyDiagramModel({assets: view.assets, graph: view.topologyGraph, mountingRelations: view.mountingRelations,
    poleGroups: view.poleGroups, area: 'ft-tegal-baru', roots: ['Server']})
  const layout = calculateTopologyDiagramLayout(model, {layoutStyle: 'facility-schematic'})
  for (const asset of sourceAssets.filter(correctedMountingExpectation)) {
    assert.ok(!model.mountingGroups.some(g => g.childIds.includes(asset.id)), asset.id)
    const box = layout.mountingBoxes.find(b => b.nodeIds.includes(asset.id))
    assert.ok(box, asset.id)
    assert.equal(box.kind, 'excluded', asset.id)
  }
  assert.notEqual(layout.mountingBoxes.find(b => b.nodeIds.includes('C-08')).id,
    layout.mountingBoxes.find(b => b.nodeIds.includes('C-27')).id)
  const byNodeId = new Map(layout.nodes.map(node => [node.id, node]))
  assert.ok(byNodeId.get('Server').diagram.y < byNodeId.get('JB-01').diagram.y)
  const indoor = layout.mountingBoxes.find(box => box.nodeIds.includes('C-08'))
  const upstream = layout.mountingBoxes.find(box => box.nodeIds.includes('JB-01'))
  assert.equal(indoor.layoutParentBoxId, upstream.id)
  assert.ok(indoor.y > upstream.y)
  assert.ok(indoor.x + indoor.width >= upstream.x)
  const svg = renderTopologyDiagramSvg({model, layout, zoom: .35})
  assert.match(svg, /class="topology-schematic-name"[^>]*>C-08<\/text>/)
  assert.match(svg, /class="topology-schematic-type"/)
  assert.doesNotMatch(svg, /class="topology-presentation-backbone"/)
  assert.equal(layout.edges.length, model.edges.length)
})

test('DPPU YIA and Booster facts are projected into explicit edges and mounting expectations', () => {
  const names = [
    ['dppu-yia', 'SERVER'], ['dppu-yia', 'JB-CCTV-10-WP'], ['dppu-yia', 'JB-CCTV-04-WP'],
    ['dppu-yia', 'JB-CCTV-09-WP'], ['dppu-yia', 'JB-CCTV-09.1-WP'], ['dppu-yia', 'BC-021'],
    ['dppu-yia', 'JB-CCTV-15-WP'], ['dppu-yia', 'JB-CCTV-15.1-WP'], ['dppu-yia', 'JB-CCTV-15.2-WP'],
    ['dppu-yia', 'BC-037'], ['dppu-yia', 'BC-038'], ['dppu-yia', 'BC-041'], ['dppu-yia', 'DC-039'],
    ['dppu-yia', 'JB-CCTV-13-WP'], ['dppu-yia', 'JB-CCTV-13.1-WP'], ['dppu-yia', 'JB-CCTV-13.2-WP'],
    ['dppu-yia', 'JB-CCTV-13.3-WP'], ['dppu-yia', 'DC-032'], ['dppu-yia', 'JB-CCTV-12-WP'],
    ['dppu-yia', 'BC-028'], ['dppu-yia', 'BC-029'],
    ['booster-kutawinangun', 'Server'], ['booster-kutawinangun', 'JB-01'],
    ['booster-kutawinangun', 'JB-02'], ['booster-kutawinangun', 'JB-04'],
    ['booster-kutawinangun', 'JB-05'],
    ['booster-kutawinangun', 'JB-06'], ['booster-kutawinangun', 'Cam-06'],
    ['booster-kutawinangun', 'Cam-16'], ['booster-kutawinangun', 'Cam-17'],
    ['booster-kutawinangun', 'Cam-18'],
  ].map(([locationGroupKey, name]) => ({id: `${locationGroupKey}:${name}`, name, sourceName: name,
    locationGroupKey, sourceFolderPath: `/RJBT/${locationGroupKey}`, objectRole: 'device_node'}))
  const edges = facilityRelations(names)
  const edgeNames = edges.map(edge => [names.find(a => a.id === edge.sourceAssetId)?.name,
    names.find(a => a.id === edge.targetAssetId)?.name].sort().join(' ↔ '))
  assert.ok(edgeNames.includes('JB-CCTV-10-WP ↔ SERVER'))
  assert.ok(edgeNames.includes('BC-021 ↔ JB-CCTV-09.1-WP'))
  assert.ok(edgeNames.includes('JB-CCTV-15-WP ↔ JB-CCTV-15.1-WP'))
  assert.ok(edgeNames.includes('JB-01 ↔ JB-04'))
  assert.equal(correctedMountingExpectation(names.find(a => a.name === 'JB-CCTV-15-WP')), 'standalone')
  assert.equal(correctedMountingExpectation(names.find(a => a.name === 'Cam-16')), null)
  assert.equal(correctedMountingExpectation(names.find(a => a.name === 'Cam-17')), 'indoor')
  assert.equal(correctedMountingExpectation(names.find(a => a.name === 'Cam-18')), 'indoor')
  const corrected = correctFacilityEdges([
    {sourceAssetId: 'booster-kutawinangun:JB-02', targetAssetId: 'booster-kutawinangun:JB-01'},
    {sourceAssetId: 'booster-kutawinangun:JB-02', targetAssetId: 'booster-kutawinangun:JB-06'},
    {sourceAssetId: 'dppu-yia:SERVER', targetAssetId: 'dppu-yia:JB-CCTV-04-WP'},
  ], names)
  assert.equal(corrected.some(edge => (
    edge.sourceAssetId?.startsWith('booster-kutawinangun:JB-02')
      && ['booster-kutawinangun:JB-01', 'booster-kutawinangun:JB-06'].includes(edge.targetAssetId)
  )), false)
})
