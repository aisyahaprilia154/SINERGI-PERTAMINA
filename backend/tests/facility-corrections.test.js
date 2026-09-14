import assert from 'node:assert/strict'
import test from 'node:test'
import { assetCode, facilityRelations, correctedMountingExpectation, correctFacilityEdges } from '../../shared/facility-corrections.mjs'
import { generateRelationArtifacts, rebuildConfirmedRelationArtifacts, TOPOLOGY_RULE_SET_VERSION } from '../src/topology/semantic-relation-engine.js'
import { adaptActiveDatasetForTopology } from '../../frontend/src/adapters/active-dataset-map-adapter.js'
import { buildTopologyDiagramModel } from '../../frontend/src/domain/topology-diagram-model.js'
import { calculateTopologyDiagramLayout } from '../../frontend/src/pages/topology/topology-diagram-layout.js'

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
  assert.equal(assets().filter(correctedMountingExpectation).length, 23)
  assert.equal(facilityRelations(assets().map(a => ({...a, locationGroupKey: 'other', sourceFolderPath: '/RJBT/Other'}))).length, 0)
  assert.equal(facilityRelations([...assets(), {...assets()[0], id: 'duplicate', assetId: 'duplicate', canonicalAssetId: 'duplicate'}]).length, 5)
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
  const layout = calculateTopologyDiagramLayout(model)
  for (const asset of sourceAssets.filter(correctedMountingExpectation)) {
    assert.ok(!model.mountingGroups.some(g => g.childIds.includes(asset.id)), asset.id)
    const box = layout.mountingBoxes.find(b => b.nodeIds.includes(asset.id))
    assert.ok(box, asset.id)
    assert.equal(box.kind, 'excluded', asset.id)
  }
  assert.notEqual(layout.mountingBoxes.find(b => b.nodeIds.includes('C-08')).id,
    layout.mountingBoxes.find(b => b.nodeIds.includes('C-27')).id)
})
