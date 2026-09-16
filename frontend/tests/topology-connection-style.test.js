import assert from 'node:assert/strict'
import test from 'node:test'
import {connectionStyle, CONNECTION_STYLES} from '../src/pages/topology/topology-connection-style.js'
import {buildTopologyDiagramModel} from '../src/domain/topology-diagram-model.js'
import {calculateTopologyDiagramLayout} from '../src/pages/topology/topology-diagram-layout.js'
import {renderTopologyDiagramSvg} from '../src/pages/topology/topology-diagram-svg.js'

test('connection categories are symmetric and do not depend on facility or asset numbers', () => {
  const core = {diagramClass: 'rack-root'}, jb = {diagramClass: 'junction-peer'}
  const extended = {diagramClass: 'junction-extended'}, camera = {diagramClass: 'endpoint', type: 'CCTV'}
  for (const [a, b, key] of [[core, core, 'core-core'], [core, jb, 'core-jb'],
    [core, camera, 'camera-core'], [jb, extended, 'jb-jb'], [extended, camera, 'camera-jb'],
    [camera, camera, 'camera-camera'], [jb, {type: 'Printer'}, 'other'], [core, null, 'other']]) {
    assert.equal(connectionStyle(a, b).key, key)
    assert.deepEqual(connectionStyle(a, b), connectionStyle(b, a))
    assert.deepEqual(connectionStyle({...a, areaKey: 'booster'}, {...b, areaKey: 'booster'}),
      connectionStyle({...a, areaKey: 'other'}, {...b, areaKey: 'other'}))
  }
})

test('connection colors, arrowheads, selection and export legend agree in both layouts', () => {
  const assets = [{id: 's', type: 'Server Rack', topologyRole: 'core'},
    {id: 'j', type: 'Junction Box', topologyRole: 'junction'},
    {id: 'c', type: 'CCTV', topologyRole: 'endpoint'}].map(a => ({...a, name: a.id, locationGroupKey: 'site'}))
  const model = buildTopologyDiagramModel({assets, roots: ['s'], graph: {nodes: assets, edges: [
    {id: 'sj', sourceNodeId: 's', targetNodeId: 'j', relationStatus: 'confirmed', direction: 'source_to_target'},
    {id: 'jc', sourceNodeId: 'j', targetNodeId: 'c', relationStatus: 'confirmed', direction: 'source_to_target'},
  ]}, locationGroups: [{key: 'site', name: 'Site'}]})
  for (const layoutStyle of ['central-backbone', 'facility-schematic']) {
    const layout = calculateTopologyDiagramLayout(model, {layoutStyle})
    const svg = renderTopologyDiagramSvg({model, layout, renderMode: 'export'})
    for (const key of ['core-jb', 'camera-jb']) {
      assert.match(svg, new RegExp(`data-connection-type="${key}"[^>]*style="stroke:${CONNECTION_STYLES[key].color}"`))
      assert.ok(svg.includes(`marker-end="url(#topology-arrow-type-${key})"`))
      assert.ok(svg.includes(CONNECTION_STYLES[key].label))
    }
    const selected = renderTopologyDiagramSvg({model, layout, selectedEdgeId: 'jc'})
    assert.match(selected, /data-connection-type="camera-jb"[^>]*style="stroke:#5b7eff"/)
    assert.match(selected, /data-connection-type="core-jb"[^>]*style="stroke:#c7c5ce"/)
  }
})
