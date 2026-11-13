import {StrictMode} from 'react'
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import fixtures from '../../docs/react-migration/map-edit-fixtures.cjs'
import {TopologyReadPage} from '../src/react/topology/TopologyReadPage.jsx'
import {SessionContext} from '../src/react/session/session-context.js'
import {ThemeProvider} from '../src/react/theme/ThemeProvider.jsx'
import {documentNavigation} from '../src/services/document-navigation.js'
import {createTopologyReadAdapter} from '../src/adapters/topology-read-adapter.js'
import {adaptActiveDatasetForTopology} from '../src/adapters/active-dataset-map-adapter.js'
import {createTopologyWorkspaceState} from '../src/domain/topology-workspace-state.js'
import {buildTopologyWorkspaceModel,buildTopologyWorkspaceLayout} from '../src/domain/topology-workspace-model.js'
import {usesReactRoute} from '../src/frontend-bootstrap.js'

let state
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();window.history.replaceState(null,'','/e2e/fixtures/topology.html?datasetId=dataset-semarang&area=all')
 state={payload:structuredClone(fixtures.active),failure:0,pending:null,calls:[],adapters:[],mobile:false,rendererFailure:false}
 vi.stubGlobal('matchMedia',query=>({matches:query.includes('max-width')?(state.mobile?390:1440)<=Number(query.match(/\d+/)[0]):query.includes('min-width')?(state.mobile?390:1440)>=Number(query.match(/\d+/)[0]):false,addEventListener(){},removeEventListener(){}}))
 for(const method of ['assign','replace','reload'])vi.spyOn(documentNavigation,method).mockImplementation(()=>{})
 vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{state.calls.push({url,...options});if(String(url).endsWith('/diagram')&&options.method==='POST'){if(state.writePending)await state.writePending.promise;if(state.failSave)return Response.json({error:{message:'Revision berubah'}},{status:409});const body=JSON.parse(options.body);for(const change of body.changes)if(change.type==='remove-edge')state.payload.topologyGraph.edges=state.payload.topologyGraph.edges.filter(edge=>edge.id!==change.edgeId);return Response.json({recordRevision:5,graph:state.payload.topologyGraph,mountingRelations:[],topologyFrames:{},topologyFrameNames:{},topologyFrameAssignments:{},nodePositions:{}})}if(state.pending)return state.pending.promise;return Response.json(state.failure?{error:{message:'Data topologi gagal'}}:state.payload,{status:state.failure||200})}))
})
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();window.history.replaceState(null,'','/')})
function factory(host,options){
 if(state.rendererFailure)throw new Error('Renderer gagal')
 const adapter=Object.fromEntries(['update','dispose','zoomIn','zoomOut','resetZoom','fit','reset','focusAsset','focusGroup','focusRelations','focusItem'].map(name=>[name,vi.fn()]))
 state.adapters.push({host,options,adapter});return adapter
}
function mount(role='Administrator'){return render(<StrictMode><ThemeProvider><SessionContext value={{user:{...fixtures.user,role},status:'authenticated',signOut:()=>{}}}><TopologyReadPage createAdapter={factory}/></SessionContext></ThemeProvider></StrictMode>)}
async function ready(role){const view=mount(role);await waitFor(()=>expect(screen.getByRole('button',{name:'Perbesar diagram',exact:true})).toBeEnabled());await waitFor(()=>expect(state.adapters.length).toBeGreaterThan(0));return view}
const current=()=>state.adapters.at(-1)
const search=()=>screen.getByRole('searchbox',{name:'Cari perangkat',exact:true})

describe('prepared React topology read UI',()=>{
 it('activates both production routes while the fixture renders React and performs only reads',async()=>{
  await ready();expect(await usesReactRoute('/topology')).toBe(true);expect(await usesReactRoute('/topologi')).toBe(true);expect(document.querySelector('[data-react-topology-read]')).not.toBeNull();expect(state.calls.every(call=>call.method==='GET')).toBe(true)
  expect(screen.getByRole('button',{name:'Tambah frame',exact:true})).toBeEnabled();expect(screen.getByRole('button',{name:'Ekspor diagram',exact:true})).toBeEnabled();expect(state.calls[0].signal.aborted).toBe(true)
 })
 it('shows loading, API error and retry without submitting any writes',async()=>{
  state.failure=503;mount();expect(screen.getByRole('heading',{name:'Memuat dataset aktif'})).toBeVisible();expect(await screen.findByText('Data topologi gagal')).toBeVisible();state.failure=0;await userEvent.click(screen.getByRole('button',{name:'Coba lagi',exact:true}));await waitFor(()=>expect(screen.getByRole('button',{name:'Perbesar diagram',exact:true})).toBeEnabled());expect(state.calls.every(call=>call.method==='GET')).toBe(true)
 })
 it('disables viewport controls for an empty dataset',async()=>{
  state.payload={...state.payload,assets:[],relations:[],mountingRelations:[],topologyGraph:{nodes:[],edges:[]},topologyRoots:[]};mount();await screen.findByRole('combobox',{name:'Cabang atau fasilitas'});expect(screen.getByRole('button',{name:'Perbesar diagram',exact:true})).toBeDisabled();expect(screen.getByRole('button',{name:'Fokus ke relasi aset terpilih'})).toBeDisabled()
 })
 it('uses URL before stored area and persists a user-selected facility with unrelated query keys',async()=>{
  localStorage.setItem('sinergi.topology.last-area:dataset-semarang','ft-semarang');window.history.replaceState(null,'','/e2e/fixtures/topology.html?datasetId=dataset-semarang&area=all&custom=keep');await ready();expect(screen.getByRole('combobox',{name:'Cabang atau fasilitas'})).toHaveValue('all');await userEvent.selectOptions(screen.getByRole('combobox',{name:'Cabang atau fasilitas'}),'ft-semarang');expect(localStorage.getItem('sinergi.topology.last-area:dataset-semarang')).toBe('ft-semarang');expect(window.location.search).toContain('custom=keep');expect(window.location.search).toContain('area=ft-semarang')
 })
 it('drills search into a facility and keeps the same adapter through typing and selection',async()=>{
  await ready();const instance=current(),count=state.adapters.length;await userEvent.type(search(),'C-01');await waitFor(()=>expect(screen.getByRole('listbox',{name:'Hasil pencarian diagram'})).toHaveTextContent('C-01'));await userEvent.keyboard('{ArrowDown}{Enter}');expect(screen.getByRole('heading',{name:'C-01',exact:true})).toBeVisible();expect(screen.getByRole('combobox',{name:'Cabang atau fasilitas'})).toHaveValue('ft-semarang');expect(search()).toHaveValue('');expect(state.adapters).toHaveLength(count);expect(current()).toBe(instance);expect(current().adapter.update.mock.calls.at(-1)[1].focus).toMatchObject({kind:'asset',id:'C-01'})
 })
 it('selects assets/edges and navigates to the map with the exact context',async()=>{
  await ready();act(()=>current().options.onSelect({kind:'asset',id:'C-01'}));expect(screen.getByRole('heading',{name:'C-01',exact:true})).toBeVisible();expect(screen.getByRole('link',{name:'Peta Aset',exact:true})).toHaveAttribute('href',expect.stringContaining('selectedAssetId=C-01'));await userEvent.click(screen.getByRole('button',{name:'Buka di Peta Aset',exact:true}));expect(documentNavigation.assign).toHaveBeenCalledWith(expect.stringContaining('selectedAssetId=C-01'))
  const edge=current().adapter.update.mock.calls.at(-1)[0].model.edges[0];act(()=>current().options.onSelect({kind:'edge',id:edge.id}));expect(screen.getByRole('heading',{name:'Detail Relasi'})).toBeVisible();expect(screen.getByText('Endpoint Relasi')).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Tutup detail',exact:true}));expect(screen.getByLabelText('Detail perangkat')).not.toBeVisible();expect(current().adapter.focusItem).toHaveBeenCalledWith({kind:'edge',id:edge.id})
 })
 it('does not resurrect the initial URL focus after search and a facility reset',async()=>{
  window.history.replaceState(null,'','/e2e/fixtures/topology.html?datasetId=dataset-semarang&area=all&selectedAssetId=C-01');await ready();expect(current().adapter.update.mock.calls.at(-1)[1].focus).toMatchObject({kind:'relations',sequence:0});await userEvent.type(search(),'JB-01');await waitFor(()=>expect(screen.getByRole('listbox',{name:'Hasil pencarian diagram'})).toHaveTextContent('JB-01'));await userEvent.keyboard('{Enter}');expect(current().adapter.update.mock.calls.at(-1)[1].focus).toMatchObject({kind:'asset',id:'JB-01'});await userEvent.selectOptions(screen.getByRole('combobox',{name:'Cabang atau fasilitas'}),'all');expect(current().adapter.update.mock.calls.at(-1)[1].focus).toBeNull();expect(screen.getByRole('button',{name:'Fokus ke relasi aset terpilih'})).toBeDisabled()
 })
 it('wires viewport actions once and restores legend focus after Escape',async()=>{
  await ready();for(const [name,method] of [['Perbesar diagram','zoomIn'],['Perkecil diagram','zoomOut'],['Kembalikan zoom ke 100%','resetZoom'],['Tampilkan seluruh diagram','fit']]){await userEvent.click(screen.getByRole('button',{name,exact:true}));expect(current().adapter[method]).toHaveBeenCalledOnce()}
  await userEvent.click(screen.getByRole('button',{name:'Tampilkan legenda diagram'}));expect(screen.getByText('Legenda diagram',{exact:true})).toBeVisible();await userEvent.keyboard('{Escape}');expect(screen.getByRole('button',{name:'Tampilkan legenda diagram'})).toHaveFocus()
 })
 it('keeps mobile search keyboard accessible and Viewer controls read-only',async()=>{
  state.mobile=true;await ready('Viewer');expect(screen.queryByRole('button',{name:'Tambah frame',exact:true})).not.toBeInTheDocument();await userEvent.keyboard('{Control>}k{/Control}');await waitFor(()=>expect(search()).toHaveFocus());expect(document.querySelector('[data-react-topology-read]')).not.toHaveClass('topology-sidebar-collapsed');await userEvent.type(search(),'not-present');expect(await screen.findByText('Perangkat tidak ditemukan.')).toBeVisible();await userEvent.keyboard('{Escape}');expect(document.querySelector('#topology-search-results')).not.toBeVisible()
 })
 it('ignores invalid URL selections and exposes a useful empty inspector',async()=>{
  window.history.replaceState(null,'','/e2e/fixtures/topology.html?area=all&selectedAssetId=unknown');await ready();expect(screen.getByText('Pilih perangkat atau garis')).toBeVisible();expect(window.location.search).not.toContain('selectedAssetId=unknown');act(()=>current().options.onSelect({kind:'asset',id:'unknown'}));expect(screen.getByText('Pilih perangkat atau garis')).toBeVisible()
 })
 it('retries an adapter failure without re-fetching or installing duplicate handlers',async()=>{
  state.rendererFailure=true;mount();expect(await screen.findByText('Renderer gagal')).toBeVisible();const reads=state.calls.length;state.rendererFailure=false;await userEvent.click(screen.getByRole('button',{name:'Coba lagi diagram'}));await waitFor(()=>expect(state.adapters.length).toBeGreaterThan(0));expect(state.calls).toHaveLength(reads)
 })
 it('aborts outstanding reads on unmount/pagehide and does not accept late data',async()=>{
  const pending=deferred();state.pending=pending;const view=mount();const signal=state.calls.at(-1).signal;view.unmount();expect(signal.aborted).toBe(true);await act(async()=>pending.resolve(Response.json(state.payload)));expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  state.pending=deferred();mount();const nextSignal=state.calls.at(-1).signal;act(()=>window.dispatchEvent(new Event('pagehide')));expect(nextSignal.aborted).toBe(true)
 })
 it('cleans mounted adapters/revision listeners and ends an expired session',async()=>{
  const remove=vi.spyOn(window,'removeEventListener'),view=await ready();view.unmount();expect(state.adapters.every(item=>item.adapter.dispose.mock.calls.length>0)).toBe(true);expect(remove.mock.calls.some(([type])=>type==='storage')).toBe(true)
  sessionStorage.setItem('sinergiSessionToken','expired');state.failure=401;mount();await waitFor(()=>expect(documentNavigation.replace).toHaveBeenCalledWith('/'));expect(sessionStorage.getItem('sinergiSessionToken')).toBeNull()
 })
})

describe('React topology editing',()=>{
 const select=()=>act(()=>current().options.onSelect({kind:'asset',id:'C-01'}))
 const writes=()=>state.calls.filter(call=>call.method==='POST')
 it('cancels a removed edge without writing and guards unsaved document navigation',async()=>{
  await ready();select();await userEvent.click(screen.getByRole('button',{name:'Hapus relasi dengan SW-01'}));expect(screen.getByText('1 perubahan belum disimpan')).toBeVisible();expect(writes()).toHaveLength(0)
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)
  await userEvent.click(screen.getByRole('button',{name:'Batal',exact:true}));expect(screen.getByRole('button',{name:'Hapus relasi dengan SW-01'})).toBeVisible();const clean=new Event('beforeunload',{cancelable:true});window.dispatchEvent(clean);expect(clean.defaultPrevented).toBe(false)
 })
 it('preserves a failed draft and revision, serializes retry, then accepts the saved graph',async()=>{
  await ready();select();await userEvent.click(screen.getByRole('button',{name:'Hapus relasi dengan SW-01'}));state.failSave=true;await userEvent.click(screen.getByRole('button',{name:'Simpan perubahan'}));expect(await screen.findByText('Revision berubah',{selector:'small'})).toBeVisible();expect(JSON.parse(writes()[0].body)).toMatchObject({expectedRevision:fixtures.active.recordRevision,changes:[{type:'remove-edge',edgeId:'edge'}]})
  state.failSave=false;state.writePending=deferred();await userEvent.dblClick(screen.getByRole('button',{name:'Simpan perubahan'}));expect(writes()).toHaveLength(2);expect(screen.getByRole('button',{name:'Batal',exact:true})).toBeDisabled();await act(async()=>state.writePending.resolve());await waitFor(()=>expect(document.querySelector('[data-draft-bar]')).not.toBeVisible());expect(screen.queryByRole('button',{name:'Hapus relasi dengan SW-01'})).not.toBeInTheDocument()
 })
 it('keeps relation search controlled, stages a new relation and restores it on cancel',async()=>{
  await ready();select();await userEvent.type(screen.getByPlaceholderText('Cari aset untuk dihubungkan…'),'jb01');await userEvent.click(screen.getByRole('listbox',{name:'Aset yang dapat dihubungkan'}).querySelector('button'));expect(screen.getByRole('button',{name:'Hapus relasi dengan JB-01'})).toBeVisible();expect(screen.getByPlaceholderText('Cari aset untuk dihubungkan…')).toHaveValue('');expect(writes()).toHaveLength(0);await userEvent.click(screen.getByRole('button',{name:'Batal',exact:true}));expect(screen.queryByRole('button',{name:'Hapus relasi dengan JB-01'})).not.toBeInTheDocument()
 })
 it('normalizes pole IDs and separators in frame searches',async()=>{
  await ready();await userEvent.click(screen.getByRole('button',{name:'Tambah frame',exact:true}))
  const search=screen.getByRole('searchbox',{name:'Cari jenis frame atau tiang'})
  await userEvent.type(search,'t1')
  expect(screen.getByRole('option',{name:/T-01/})).toBeVisible()
  await userEvent.clear(search);await userEvent.type(search,'non tiang')
  expect(screen.getByRole('option',{name:/Non-tiang/})).toBeVisible()
  expect(writes()).toHaveLength(0)
 })
 it('creates a provisional frame, discards on Escape, and stages the chosen indoor frame',async()=>{
  await ready();await userEvent.click(screen.getByRole('button',{name:'Tambah frame',exact:true}));expect(screen.getByRole('heading',{name:'Frame baru'})).toBeVisible();expect(screen.getByRole('searchbox',{name:'Cari jenis frame atau tiang'})).toHaveFocus();await userEvent.keyboard('{Escape}');expect(screen.queryByRole('heading',{name:'Frame baru'})).not.toBeInTheDocument();expect(document.querySelector('[data-draft-bar]')).not.toBeVisible()
  await userEvent.click(screen.getByRole('button',{name:'Tambah frame',exact:true}));await userEvent.click(screen.getByRole('option',{name:/Indoor/}));expect(screen.getByText('1 perubahan belum disimpan')).toBeVisible();expect(Object.values(current().adapter.update.mock.calls.at(-1)[0].mapData.topologyFrames)).toEqual([expect.objectContaining({type:'indoor',name:'Indoor'})])
 })
 it('renames the selected custom frame and retains its identity in the draft',async()=>{
  await ready();await userEvent.click(screen.getByRole('button',{name:'Tambah frame',exact:true}));await userEvent.click(screen.getByRole('option',{name:/Indoor/}));const snapshot=current().adapter.update.mock.calls.at(-1)[0],id=Object.keys(snapshot.mapData.topologyFrames)[0]
  act(()=>current().options.onRename({id}));await userEvent.clear(screen.getByLabelText('Nama frame'));await userEvent.type(screen.getByLabelText('Nama frame'),'Ruang kontrol');await userEvent.click(screen.getByRole('button',{name:'Terapkan nama'}));expect(current().adapter.update.mock.calls.at(-1)[0].state.changes).toEqual([expect.objectContaining({type:'create-frame',frame:expect.objectContaining({id,name:'Ruang kontrol'})})]);expect(writes()).toHaveLength(0)
 })
 it('moves assets through the accessible frame picker and cancels assignments',async()=>{
  await ready();await userEvent.click(screen.getByRole('button',{name:'Tambah frame',exact:true}));await userEvent.click(screen.getByRole('option',{name:/Indoor/}));const id=Object.keys(current().adapter.update.mock.calls.at(-1)[0].mapData.topologyFrames)[0];select();await userEvent.selectOptions(screen.getByLabelText('Pindahkan ke frame'),id);expect(current().adapter.update.mock.calls.at(-1)[0].state.changes).toContainEqual({type:'move-frame',assetId:'C-01',frameId:id});await userEvent.click(screen.getByRole('button',{name:'Batal',exact:true}));expect(current().adapter.update.mock.calls.at(-1)[0].mapData.topologyFrameAssignments?.['C-01']).toBeUndefined()
 })
 it('blocks editor commands for Viewer and stops a pending save after unmount',async()=>{
  const view=await ready('Viewer');select();act(()=>current().options.onDrop({assetId:'C-01',drop:{kind:'connect',targetId:'JB-01'}}));expect(writes()).toHaveLength(0);expect(screen.queryByLabelText('Pindahkan ke frame')).not.toBeInTheDocument();view.unmount()
  const next=await ready();select();await userEvent.click(screen.getByRole('button',{name:'Hapus relasi dengan SW-01'}));state.writePending=deferred();await userEvent.click(screen.getByRole('button',{name:'Simpan perubahan'}));const write=writes()[0];next.unmount();expect(write.signal.aborted).toBe(true);await act(async()=>state.writePending.resolve());expect(writes()).toHaveLength(1)
 })
 it('updates zoom feedback without rendering the document or replacing SVG snapshots',async()=>{
  await ready();const instance=current(),updates=instance.adapter.update.mock.calls.length;act(()=>{for(let index=0;index<20;index++)instance.options.onZoom(1+index/100)});expect(screen.getByRole('button',{name:'Kembalikan zoom ke 100%'})).toHaveTextContent('119%');expect(instance.adapter.update).toHaveBeenCalledTimes(updates)
 })
 it('opens export for Viewer, closes with Escape and restores its trigger focus',async()=>{
  await ready('Viewer');await userEvent.click(screen.getByRole('button',{name:'Ekspor diagram',exact:true}));expect(screen.getByRole('button',{name:/SVG resolusi tinggi/})).toBeVisible();await userEvent.keyboard('{Escape}');expect(screen.getByRole('button',{name:'Ekspor diagram',exact:true})).toHaveFocus();expect(writes()).toHaveLength(0)
 })
})

function adapterFixture(){
 const mapData=adaptActiveDatasetForTopology(structuredClone(fixtures.active)),viewState=createTopologyWorkspaceState({mapData});viewState.area='ft-semarang';const model=buildTopologyWorkspaceModel({mapData,graph:mapData.topologyGraph,roots:[],state:viewState}),layout=buildTopologyWorkspaceLayout(model,{mapData,state:viewState}),root=document.createElement('div')
 root.innerHTML='<main class="topology-stitch-main"><div data-topology-viewport><div class="topology-stitch-canvas"><div data-topology-frame></div></div></div><div data-topology-overview-labels></div></main>';document.body.append(root);const viewport=root.querySelector('[data-topology-viewport]');Object.defineProperties(viewport,{clientWidth:{value:900},clientHeight:{value:600}});viewport.scrollTo=vi.fn();const onSelect=vi.fn(),onZoom=vi.fn(),adapter=createTopologyReadAdapter(root,{onSelect,onZoom});const snapshot={model,layout,mapData,activeContext:mapData.activeContext,state:viewState};adapter.update(snapshot,{key:'fixture'});return {root,viewport,onSelect,onZoom,adapter,snapshot}
}
describe('real topology SVG read adapter',()=>{
 it('preserves source data, frame ownership and keyboard focus through SVG redraws',()=>{
  const {root,onSelect,adapter,snapshot}=adapterFixture(),before=JSON.stringify(snapshot.mapData),frame=root.querySelector('[data-topology-frame]'),node=frame.querySelector('[data-node-id="C-01"]');node.focus();fireEvent.keyDown(node,{key:'Enter'});expect(onSelect).toHaveBeenCalledWith({kind:'asset',id:'C-01'});adapter.update({...snapshot,state:{...snapshot.state,selectedAssetId:'C-01'}},{key:'fixture'});expect(document.activeElement.dataset.nodeId).toBe('C-01');expect(root.querySelector('[data-topology-frame]')).toBe(frame);expect(JSON.stringify(snapshot.mapData)).toBe(before);adapter.dispose();root.remove()
 })
 it('keeps the exact SVG and viewport when only inspector, export or draft controls change',()=>{
  const {root,adapter,snapshot}=adapterFixture(),svg=root.querySelector('svg'),frame=root.querySelector('[data-topology-frame]');frame.style.top='24px';const before=frame.style.cssText
  adapter.update({...snapshot,state:{...snapshot.state,inspectorOpen:!snapshot.state.inspectorOpen,exportOpen:true,mutationBusy:true}},{key:'fixture'})
  expect(root.querySelector('svg')).toBe(svg);expect(frame.style.cssText).toBe(before);adapter.dispose();root.remove()
 })
 it('keeps wheel zoom anchored, never selects after disposal and cancels owned observers',()=>{
  const disconnect=vi.fn();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect=disconnect});const {root,viewport,adapter,onSelect,onZoom}=adapterFixture();viewport.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-100,cancelable:true}));expect(viewport.scrollTo).toHaveBeenCalled();const zooms=onZoom.mock.calls.length;adapter.dispose();adapter.dispose();adapter.zoomIn();fireEvent.click(root.querySelector('[data-node-id="C-01"]'));expect(onZoom).toHaveBeenCalledTimes(zooms);expect(onSelect).not.toHaveBeenCalled();expect(disconnect).toHaveBeenCalledOnce();root.remove()
 })
 it('aborts pending icon requests and blocks redraw callbacks after disposal',async()=>{
  const pending=deferred();state.pending=pending;const {root,adapter}=adapterFixture();await waitFor(()=>expect(state.calls.some(call=>!String(call.url).includes('/api/'))).toBe(true));const iconCall=state.calls.find(call=>!String(call.url).includes('/api/'));adapter.dispose();expect(iconCall.signal.aborted).toBe(true);const markup=root.innerHTML;await act(async()=>pending.resolve(Response.json({})));expect(root.innerHTML).toBe(markup);root.remove()
 })
})
