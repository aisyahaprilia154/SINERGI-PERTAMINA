import assert from 'node:assert/strict'
import test from 'node:test'
import { assetCode, facilityRelations, correctedMountingExpectation, correctFacilityEdges, facilityConflictPredicate } from '../../shared/facility-corrections.mjs'
import { generateRelationArtifacts, rebuildConfirmedRelationArtifacts, TOPOLOGY_RULE_SET_VERSION } from '../src/topology/semantic-relation-engine.js'
import { adaptActiveDatasetForTopology } from '../../frontend/src/adapters/active-dataset-map-adapter.js'
import { buildTopologyDiagramModel } from '../../frontend/src/domain/topology-diagram-model.js'
import { calculateTopologyDiagramLayout } from '../../frontend/src/pages/topology/topology-diagram-layout.js'
import { projectFacilityRecord } from '../src/topology/facility-record-projection.js'
import { TopologyService } from '../src/topology/topology-service.js'
import { renderTopologyDiagramSvg } from '../../frontend/src/pages/topology/topology-diagram-svg.js'
import { generateMountingArtifacts } from '../src/topology/mounting-relations.js'

test('actual Booster coordinates cannot mount Cam-13 23m away or split it from Cam-12', () => {
  // Coordinates from the imported Booster Kutawinangun source, not a synthetic distance.
  const points = [
    ['Cam-12', 'CCTV', [109.7624862679504, -7.714834989498747]],
    ['Cam-13', 'CCTV', [109.7624530474359, -7.714844104916319]],
    ['JB-02', 'Junction Box', [109.7624869986333, -7.714819640543506]],
    ['JB-06', 'Junction Box', [109.7622803418273, -7.714963374886281]],
    ['T-08', 'Tiang', [109.7622819601516, -7.714964853732579]],
  ]
  for (const area of ['booster-kutawinangun', 'another-facility']) {
    const input = bundle()
    input.classifiedNodes = points.map(([name, type]) => ({...input.classifiedNodes[0],
      id: name, assetId: name, canonicalAssetId: name, sourceName: name, name, type, assetType: type,
      locationGroupKey: area, sourceFolderPath: `/RJBT/${area}/Devices`,
      topologyRole: type === 'CCTV' ? 'endpoint' : type === 'Tiang' ? 'physical_mount' : 'junction',
      geometryIds: [`point:${name}`],
    }))
    input.geometries = points.map(([name, , coordinates]) => ({geometryId: `point:${name}`,
      valid: true, geometryType: 'Point', coordinates}))
    const mounting = generateMountingArtifacts(input, {config: {mountingSearchRadiusMeters: 25}})
    assert.equal(mounting.relations.some(r => r.sourceAssetId === 'Cam-13'), false)
    assert.ok(mounting.options.some(r => r.assetId === 'Cam-13' && r.targetAssetId === 'T-08'))
    const oldMount = {sourceAssetId: 'Cam-13', targetAssetId: 'T-08', relationType: 'mounted_on',
      provenance: 'spatial_inference', verificationStatus: 'confirmed', distanceMeters: 23.145}
    const edges = ['Cam-12', 'Cam-13'].map(id => ({id, sourceAssetId: id,
      targetAssetId: 'JB-02', verificationStatus: 'confirmed', relationKind: 'device_edge'}))
    const record = {datasetVersion: {id: 'dv'}, assets: input.classifiedNodes,
      topologyInputBundle: input, mountingRelations: [oldMount],
      topologyGraph: {nodes: input.classifiedNodes, edges}}
    const projected = projectFacilityRecord(record)
    assert.equal(projected.mountingRelations.some(r => r.sourceAssetId === 'Cam-13'), false)
    const view = adaptActiveDatasetForTopology(record)
    const model = buildTopologyDiagramModel({assets: view.assets, graph: view.topologyGraph,
      mountingRelations: view.mountingRelations, poleGroups: view.poleGroups, area})
    const layout = calculateTopologyDiagramLayout(model)
    const frame = id => layout.mountingBoxes.find(box => box.nodeIds.includes(id))
    assert.equal(frame('Cam-13').id, frame('Cam-12').id)
    assert.equal(frame('Cam-13').id, frame('JB-02').id)
    assert.notEqual(frame('Cam-13').hostId, 'T-08')
  }
})

const names = ['Server', 'JB-01', 'JB-014', 'JB-02', 'JB-02.2', 'JB-04', 'JB-09', 'JB-10-EXP', 'C-32',
  'C-08', 'C-09', 'C-10', 'C-11', 'C-12', 'C-013', 'C-15', 'C-27', 'C-031',
  'JB-08', 'JB-08.3', 'JB-09.1', 'C-033-EXP', 'JB-10.1', 'C-034-EXP', 'JB-13-EXP',
  'C-37-EXP', 'C-38-EXP', 'C-39-EXP', 'C-40-EXP', 'C-44', 'C-45', 'C-46', 'T-01']

test('Booster C-13 belongs only to JB-02 through projection, generation, and regeneration', () => {
  for (const cameraName of ['C-13', 'C-013', 'Cam-13', 'CAM-013']) {
    const input = bundle()
    input.classifiedNodes = input.classifiedNodes.slice(0, 3).map((node, i) => ({...node,
      id: ['camera', 'owner', 'wrong-jb'][i], assetId: ['camera', 'owner', 'wrong-jb'][i],
      canonicalAssetId: ['camera', 'owner', 'wrong-jb'][i],
      name: [cameraName, 'JB-02', 'JB-06'][i], sourceName: [cameraName, 'JB-02', 'JB-06'][i],
      locationGroupKey: 'booster-kutawinangun', sourceFolderPath: '/RJBT/Booster Kutawinangun/Devices',
      topologyRole: i === 0 ? 'endpoint' : 'junction', assetType: i === 0 ? 'CCTV' : 'Junction Box',
    }))
    const oldEdge = {id: 'wrong', sourceAssetId: 'wrong-jb', targetAssetId: 'camera',
      relationKind: 'device_edge', relationType: 'connected-to', verificationStatus: 'confirmed'}
    const assertOwnership = edges => {
      const neighbors = edges.flatMap(edge => {
        const s = edge.sourceAssetId ?? edge.sourceNodeId, t = edge.targetAssetId ?? edge.targetNodeId
        return s === 'camera' ? [t] : t === 'camera' ? [s] : []
      })
      assert.deepEqual(neighbors, ['owner'], cameraName)
    }
    const record = {datasetVersion: {id: 'dv'}, assets: input.classifiedNodes,
      facilityCorrectionVersion: 'facilities/2026-09-15',
      topologyGraph: {nodes: input.classifiedNodes, edges: [oldEdge]}}
    const projected = projectFacilityRecord(record)
    assertOwnership(projected.topologyGraph.edges)
    assertOwnership(projected.confirmedRelations)
    const view = adaptActiveDatasetForTopology(record)
    assertOwnership(view.topologyGraph.edges)
    const first = generateRelationArtifacts(input, {previousRelations: [oldEdge]})
    assertOwnership(first.confirmedRelations)
    const next = rebuildConfirmedRelationArtifacts(input, {candidates: first.candidates,
      previousRelations: [...first.confirmedRelations, oldEdge]})
    assertOwnership(next.confirmedRelations)
    assert.equal(facilityConflictPredicate(input.classifiedNodes)(oldEdge), true)
    const missingOwner = input.classifiedNodes.filter(node => node.id !== 'owner')
    assert.deepEqual(correctFacilityEdges([oldEdge], missingOwner), [])
    assert.deepEqual(projectFacilityRecord({...record, assets: missingOwner,
      topologyGraph: {nodes: missingOwner, edges: [oldEdge]}}).topologyGraph.edges, [])
    assert.equal(facilityConflictPredicate(missingOwner)({sourcePathAssetId: 'camera', targetAssetId: 'wrong-jb'}), true)
    const ambiguous = [...input.classifiedNodes, {...input.classifiedNodes[1], id: 'duplicate',
      assetId: 'duplicate', canonicalAssetId: 'duplicate'}]
    assert.deepEqual(correctFacilityEdges([oldEdge], ambiguous), [])
    const otherSite = input.classifiedNodes.map(node => ({...node,
      locationGroupKey: 'other', sourceFolderPath: '/Other'}))
    assert.deepEqual(correctFacilityEdges([oldEdge], otherSite), [oldEdge])
  }
})
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
