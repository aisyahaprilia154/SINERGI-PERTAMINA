import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import fixtures from '../../docs/react-migration/map-edit-fixtures.cjs'
import {adaptActiveDatasetForTopology} from '../src/adapters/active-dataset-map-adapter.js'
import {createTopologyDocument} from '../src/domain/topology-document.js'
import {createTopologyWorkspaceState} from '../src/domain/topology-workspace-state.js'
import {buildTopologyWorkspaceModel,buildTopologyWorkspaceLayout} from '../src/domain/topology-workspace-model.js'
import {createTopologySelection} from '../src/domain/topology-selection.js'
import {getDeviceSearchResults,relationTargetsFor,networkPathFor,directRelationsFor} from '../src/domain/topology-search.js'
import {createTopologyWorkspaceScope} from '../src/adapters/topology-workspace-scope.js'
import {createTopologyGraphRenderer} from '../src/adapters/topology-graph-renderer.js'
import {loadTopologyDocument} from '../src/services/topology-document-service.js'
import {saveTopologyDiagram,loadActiveDataset,loadTopologyProjection,loadTopologyRoots} from '../src/services/active-dataset-service.js'

vi.mock('../src/services/active-dataset-service.js',()=>({saveTopologyDiagram:vi.fn(),loadActiveDataset:vi.fn(),loadTopologyProjection:vi.fn(),loadTopologyRoots:vi.fn()}))
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function workspace(canEditTopology=true){
 const payload=structuredClone(fixtures.active),mapData=adaptActiveDatasetForTopology(payload)
 Object.assign(mapData,{recordRevision:payload.recordRevision,topologyFrameAssignments:{},topologyFrames:{},nodePositions:{}})
 const state=createTopologyWorkspaceState({mapData}),controller=new AbortController(),callbacks={rebuild:vi.fn(),updatePanelState:vi.fn(),showToast:vi.fn(),closeFrameNameEditor:vi.fn()}
 let document
 const getModel=()=>buildTopologyWorkspaceModel({mapData,graph:document?.graph||mapData.topologyGraph,roots:[],state})
 document=createTopologyDocument({mapData,graph:mapData.topologyGraph,roots:[],state,canEditTopology,getModel,signal:controller.signal,...callbacks})
 return {payload,mapData,state,controller,callbacks,document,getModel}
}
beforeEach(()=>{vi.resetAllMocks();loadActiveDataset.mockResolvedValue(structuredClone(fixtures.active));loadTopologyRoots.mockResolvedValue({roots:[]})})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})

describe('extracted topology document',()=>{
 it('deduplicates frame/node changes and restores the acknowledged graph and placements on cancel',async()=>{
  const w=workspace(),before=structuredClone(w.document.graph),edge=w.getModel().edges[0]
  // Cancel reapplies the saved mounting projection, including explicit empty metadata.
  before.nodes=before.nodes.map(node=>({...node,mountedOnAssetId:null,mountedAssetIds:[]}))
  await w.document.removeRelation(edge.id);expect(w.document.graph.edges.length).toBe(before.edges.length-1)
  w.mapData.nodePositions={'C-01':{x:50,y:70}};w.document.stageChange({type:'move-node',assetId:'C-01',x:10,y:20});w.document.stageChange({type:'move-node',assetId:'C-01',x:50,y:70})
  expect(w.state.changes.filter(change=>change.type==='move-node')).toHaveLength(1);w.document.cancelDraft();expect(w.document.graph).toEqual(before);expect(w.mapData.nodePositions).toEqual({});expect(w.state.changes).toEqual([]);expect(saveTopologyDiagram).not.toHaveBeenCalled()
 })
 it('restores an original relation instead of staging a duplicate addition',async()=>{
  const w=workspace(),edge=w.getModel().edges[0],before=structuredClone(w.document.graph)
  await w.document.removeRelation(edge.id);await w.document.addRelation(edge.sourceId,edge.targetId);expect(w.state.changes).toEqual([]);expect(w.document.graph).toEqual(before)
 })
 it('keeps a failed save draft and revision for explicit retry and sends no draft-only edge ID',async()=>{
  const w=workspace();w.document.stageChange({type:'add-relation',sourceAssetId:'C-01',targetAssetId:'JB-01',draftEdgeId:'draft-only'})
  saveTopologyDiagram.mockRejectedValueOnce(Object.assign(new Error('Revision berubah'),{status:409}));await w.document.saveDraft()
  expect(w.state.changes).toHaveLength(1);expect(w.state.saveError).toBe('Revision berubah');expect(w.mapData.recordRevision).toBe(w.payload.recordRevision)
  expect(saveTopologyDiagram.mock.calls[0][0]).toEqual({datasetId:w.mapData.activeContext.datasetId,expectedRecordRevision:w.payload.recordRevision,signal:w.controller.signal,changes:[{type:'add-relation',sourceAssetId:'C-01',targetAssetId:'JB-01'}]})
 })
 it('serializes saves and accepts the server snapshot even when the follow-up read fails',async()=>{
  const w=workspace(),pending=deferred();w.document.stageChange({type:'move-node',assetId:'C-01',x:12,y:34});saveTopologyDiagram.mockReturnValue(pending.promise);loadActiveDataset.mockRejectedValue(new Error('Read failed'))
  const first=w.document.saveDraft();await w.document.saveDraft();expect(saveTopologyDiagram).toHaveBeenCalledOnce();pending.resolve({recordRevision:9,nodePositions:{'C-01':{x:12,y:34}}});await first
  expect(w.mapData.recordRevision).toBe(9);expect(w.state.changes).toEqual([]);w.mapData.nodePositions={};w.document.cancelDraft();expect(w.mapData.nodePositions).toEqual({'C-01':{x:12,y:34}});expect(w.callbacks.showToast).toHaveBeenCalledWith(expect.stringContaining('Perubahan tersimpan'))
 })
 it('ignores a write result after disposal and keeps Viewer operations read-only',async()=>{
  const w=workspace(),pending=deferred();w.document.stageChange({type:'move-node',assetId:'C-01',x:1,y:2});saveTopologyDiagram.mockReturnValue(pending.promise);const saving=w.document.saveDraft();w.controller.abort();pending.resolve({recordRevision:999});await saving
  expect(w.mapData.recordRevision).toBe(w.payload.recordRevision);expect(w.state.changes).toHaveLength(1);expect(w.callbacks.rebuild).not.toHaveBeenCalled()
  const viewer=workspace(false);viewer.document.stageChange({type:'move-node',assetId:'C-01'});await viewer.document.removeRelation(viewer.getModel().edges[0].id);await viewer.document.addRelation('C-01','JB-01');await viewer.document.saveDraft();expect(viewer.state.changes).toEqual([]);expect(saveTopologyDiagram).toHaveBeenCalledOnce()
 })
})

describe('state, selection and model boundaries',()=>{
 it('uses valid URL area before storage, preserves aliases, and initializes independent draft state',()=>{
  const {mapData}=workspace(),key=mapData.locationGroups[0].key
  const url=createTopologyWorkspaceState({mapData,search:'?area=all&assetId=C-01',storedArea:key,compact:true});expect(url.area).toBeNull();expect(url.selectedAssetId).toBe('C-01');expect(url.sidebarCollapsed).toBe(true)
  expect(createTopologyWorkspaceState({mapData,search:'?area=invalid',storedArea:key}).area).toBe(key);expect(createTopologyWorkspaceState({mapData,storedArea:'invalid'}).area).toBeNull();url.changes.push({type:'x'});expect(createTopologyWorkspaceState({mapData}).changes).toEqual([])
 })
 it('searches only devices, excludes connected/cross-area relation targets and resolves confirmed paths',()=>{
  const w=workspace(),model=w.getModel();expect(getDeviceSearchResults(model,'C-01').map(result=>result.kind)).toEqual(['asset']);expect(networkPathFor(model,'C-01').at(-1).id).toBe('C-01')
  expect(directRelationsFor(model,'C-01').map(item=>item.other.id)).toContain('SW-01');expect(relationTargetsFor(model,'C-01','SW-01')).toEqual([]);expect(relationTargetsFor(model,'C-01','JB-01').map(node=>node.id)).toContain('JB-01')
 })
 it('keeps selection mutually exclusive and drills search into an overview area',()=>{
  const w=workspace(),model=w.getModel(),layout=buildTopologyWorkspaceLayout(model,{mapData:w.mapData,state:w.state}),persistArea=vi.fn(),focusAssetCard=vi.fn()
  const selection=createTopologySelection({state:w.state,mapData:w.mapData,getModel:()=>model,getLayout:()=>layout,persistArea,focusAssetCard,focusMountingGroup:vi.fn(),rebuild:vi.fn(),renderGraph:vi.fn(),renderInspector:vi.fn(),renderTopologySidebar:vi.fn(),updatePanelState:vi.fn(),syncUrl:vi.fn()})
  selection.selectEdge(model.edges[0].id);expect(w.state.selectedAssetId).toBeNull();selection.selectSearchResult(getDeviceSearchResults(model,'C-01')[0]);expect(w.state.selectedAssetId).toBe('C-01');expect(w.state.selectedEdgeId).toBeNull();expect(focusAssetCard).toHaveBeenCalledWith('C-01');expect(persistArea).toHaveBeenCalled();selection.clearSelection();expect(w.state.inspectorOpen).toBe(false)
 })
})

describe('loading and renderer lifetime',()=>{
 it('passes cancellation through graph fallback using the requested dataset, and ignores late reads',async()=>{
  const payload=structuredClone(fixtures.active);payload.topologyGraph={nodes:[],edges:[]};payload.topologyRoots=[];loadActiveDataset.mockResolvedValue(payload);loadTopologyProjection.mockResolvedValue({graph:fixtures.active.topologyGraph});const controller=new AbortController()
  const loaded=await loadTopologyDocument({datasetId:'dataset-semarang'},{signal:controller.signal});expect(loaded.graph).toEqual(fixtures.active.topologyGraph);expect(loadTopologyProjection.mock.calls[0][0]).toMatchObject({datasetId:'dataset-semarang',signal:controller.signal})
  const pending=deferred();loadActiveDataset.mockReturnValue(pending.promise);const late=loadTopologyDocument({datasetId:'other'},{signal:controller.signal});controller.abort();pending.resolve(payload);await expect(late).rejects.toMatchObject({name:'AbortError'})
 })
 it('disposes listeners, timers, frames, observers, workers and resources exactly once',()=>{
  vi.useFakeTimers();const frames=new Map(),host=new EventTarget();let next=0;Object.assign(host,{setTimeout,clearTimeout,requestAnimationFrame:fn=>{frames.set(++next,fn);return next},cancelAnimationFrame:id=>frames.delete(id)})
  const scope=createTopologyWorkspaceScope(host),listener=vi.fn(),timer=vi.fn(),frame=vi.fn(),disconnect=vi.fn(),terminate=vi.fn(),dispose=vi.fn();scope.listen(host,'custom',listener);scope.timeout(timer,120);scope.frame(frame);scope.observe({observe:vi.fn(),disconnect},{});scope.worker({terminate});scope.own(dispose);host.dispatchEvent(new Event('custom'));host.dispatchEvent(new Event('pagehide'));scope.dispose();host.dispatchEvent(new Event('custom'));vi.runAllTimers()
  expect(listener).toHaveBeenCalledOnce();expect(timer).not.toHaveBeenCalled();expect(frame).not.toHaveBeenCalled();expect(frames.size).toBe(0);expect(disconnect).toHaveBeenCalledOnce();expect(terminate).toHaveBeenCalledOnce();expect(dispose).toHaveBeenCalledOnce();expect(scope.signal.aborted).toBe(true)
 })
 it('stops icon-driven SVG updates after the renderer is disposed',async()=>{
  const w=workspace(),model=w.getModel(),layout=buildTopologyWorkspaceLayout(model,{mapData:w.mapData,state:w.state}),frame=document.createElement('div'),pending=deferred(),scope=createTopologyWorkspaceScope(),onIconsReady=vi.fn();document.body.append(frame)
  const renderer=createTopologyGraphRenderer({frame,getSnapshot:()=>({model,layout,state:w.state,mapData:w.mapData,activeContext:w.mapData.activeContext}),sourceIconLoader:{preload:()=>pending.promise,dataByUrl:new Map()},scope,syncGraphSurface:vi.fn(),renderOverviewLabels:vi.fn(),onIconsReady,isDragging:()=>false});renderer.render();expect(frame.querySelector('svg')).not.toBeNull();const markup=frame.innerHTML;scope.dispose();pending.resolve();await pending.promise;expect(frame.innerHTML).toBe(markup);expect(onIconsReady).not.toHaveBeenCalled();frame.remove()
 })
 it('finishes pending icons against the current selection after an intervening render',async()=>{
  const w=workspace();w.state.area='ft-semarang';const model=w.getModel(),layout=buildTopologyWorkspaceLayout(model,{mapData:w.mapData,state:w.state}),frame=document.createElement('div'),pending=deferred(),scope=createTopologyWorkspaceScope(),onIconsReady=vi.fn();document.body.append(frame)
  const loader={preload:vi.fn().mockReturnValueOnce(pending.promise).mockReturnValue(null),dataByUrl:new Map()},getSnapshot=vi.fn(()=>({model,layout,state:w.state,mapData:w.mapData,activeContext:w.mapData.activeContext}))
  const renderer=createTopologyGraphRenderer({frame,getSnapshot,sourceIconLoader:loader,scope,syncGraphSurface:vi.fn(),renderOverviewLabels:vi.fn(),onIconsReady,isDragging:()=>false});renderer.render();w.state.selectedAssetId='C-01';renderer.render();pending.resolve();await pending.promise
  expect(onIconsReady).toHaveBeenCalledOnce();expect(getSnapshot).toHaveBeenCalledTimes(3);expect(w.state.selectedAssetId).toBe('C-01');expect(frame.querySelector('[data-node-id="C-01"]')).not.toBeNull();scope.dispose();frame.remove()
 })
})
