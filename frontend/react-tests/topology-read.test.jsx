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
 vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{state.calls.push({url,...options});if(state.pending)return state.pending.promise;return Response.json(state.failure?{error:{message:'Data topologi gagal'}}:state.payload,{status:state.failure||200})}))
})
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();window.history.replaceState(null,'','/')})
function factory(host,options){
 if(state.rendererFailure)throw new Error('Renderer gagal')
 const adapter=Object.fromEntries(['update','dispose','zoomIn','zoomOut','resetZoom','fit','reset','focusAsset','focusGroup','focusRelations','focusItem'].map(name=>[name,vi.fn()]))
 state.adapters.push({host,options,adapter});return adapter
}
function mount(role='Administrator'){return render(<StrictMode><ThemeProvider><SessionContext value={{user:{...fixtures.user,role},status:'authenticated',signOut:()=>{}}}><TopologyReadPage createAdapter={factory}/></SessionContext></ThemeProvider></StrictMode>)}
async function ready(role){const view=mount(role);await waitFor(()=>expect(screen.getByRole('button',{name:'Perbesar diagram',exact:true})).toBeEnabled());return view}
const current=()=>state.adapters.at(-1)
const search=()=>screen.getByRole('searchbox',{name:'Cari perangkat',exact:true})

describe('prepared React topology read UI',()=>{
 it('keeps production routing legacy while the fixture renders React and performs only reads',async()=>{
  await ready();expect(await usesReactRoute('/topology')).toBe(false);expect(await usesReactRoute('/topologi')).toBe(false);expect(document.querySelector('[data-react-topology-read]')).not.toBeNull();expect(state.calls.every(call=>call.method==='GET')).toBe(true)
  expect(screen.getByRole('button',{name:'Tambah frame',exact:true})).toBeDisabled();expect(screen.getByRole('button',{name:'Ekspor diagram',exact:true})).toBeDisabled();expect(state.calls[0].signal.aborted).toBe(true)
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

function adapterFixture(){
 const mapData=adaptActiveDatasetForTopology(structuredClone(fixtures.active)),viewState=createTopologyWorkspaceState({mapData});viewState.area='ft-semarang';const model=buildTopologyWorkspaceModel({mapData,graph:mapData.topologyGraph,roots:[],state:viewState}),layout=buildTopologyWorkspaceLayout(model,{mapData,state:viewState}),root=document.createElement('div')
 root.innerHTML='<main class="topology-stitch-main"><div data-topology-viewport><div class="topology-stitch-canvas"><div data-topology-frame></div></div></div><div data-topology-overview-labels></div></main>';document.body.append(root);const viewport=root.querySelector('[data-topology-viewport]');Object.defineProperties(viewport,{clientWidth:{value:900},clientHeight:{value:600}});viewport.scrollTo=vi.fn();const onSelect=vi.fn(),onZoom=vi.fn(),adapter=createTopologyReadAdapter(root,{onSelect,onZoom});const snapshot={model,layout,mapData,activeContext:mapData.activeContext,state:viewState};adapter.update(snapshot,{key:'fixture'});return {root,viewport,onSelect,onZoom,adapter,snapshot}
}
describe('real topology SVG read adapter',()=>{
 it('preserves source data, frame ownership and keyboard focus through SVG redraws',()=>{
  const {root,onSelect,adapter,snapshot}=adapterFixture(),before=JSON.stringify(snapshot.mapData),frame=root.querySelector('[data-topology-frame]'),node=frame.querySelector('[data-node-id="C-01"]');node.focus();fireEvent.keyDown(node,{key:'Enter'});expect(onSelect).toHaveBeenCalledWith({kind:'asset',id:'C-01'});adapter.update({...snapshot,state:{...snapshot.state,selectedAssetId:'C-01'}},{key:'fixture'});expect(document.activeElement.dataset.nodeId).toBe('C-01');expect(root.querySelector('[data-topology-frame]')).toBe(frame);expect(JSON.stringify(snapshot.mapData)).toBe(before);adapter.dispose();root.remove()
 })
 it('keeps wheel zoom anchored, never selects after disposal and cancels owned observers',()=>{
  const disconnect=vi.fn();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect=disconnect});const {root,viewport,adapter,onSelect,onZoom}=adapterFixture();viewport.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-100,cancelable:true}));expect(viewport.scrollTo).toHaveBeenCalled();const zooms=onZoom.mock.calls.length;adapter.dispose();adapter.dispose();adapter.zoomIn();fireEvent.click(root.querySelector('[data-node-id="C-01"]'));expect(onZoom).toHaveBeenCalledTimes(zooms);expect(onSelect).not.toHaveBeenCalled();expect(disconnect).toHaveBeenCalledOnce();root.remove()
 })
 it('aborts pending icon requests and blocks redraw callbacks after disposal',async()=>{
  const pending=deferred();state.pending=pending;const {root,adapter}=adapterFixture();await waitFor(()=>expect(state.calls.some(call=>!String(call.url).includes('/api/'))).toBe(true));const iconCall=state.calls.find(call=>!String(call.url).includes('/api/'));adapter.dispose();expect(iconCall.signal.aborted).toBe(true);const markup=root.innerHTML;await act(async()=>pending.resolve(Response.json({})));expect(root.innerHTML).toBe(markup);root.remove()
 })
})
