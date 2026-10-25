import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../docs/react-migration/map-edit-fixtures.cjs'
import { MapReadPage } from '../src/react/map/MapReadPage.jsx'
import { ThemeProvider } from '../src/react/theme/ThemeProvider.jsx'
import { SessionContext } from '../src/react/session/session-context.js'
import { documentNavigation } from '../src/services/document-navigation.js'
import { prepareAssetIcon } from '../src/services/asset-icon-image.js'
import { createMapReadAdapter } from '../src/adapters/map-read-adapter.js'

vi.mock('../src/services/asset-icon-image.js', async importOriginal => { const original = await importOriginal(); return {...original, prepareAssetIcon:vi.fn(async file => {original.validateAssetIconFile(file);return 'data:image/png;base64,aGVsbG8='})} })
let state
const deferred = () => { let resolve; const promise = new Promise(done => {resolve=done});return {promise,resolve} }
beforeEach(() => {
  localStorage.clear();sessionStorage.clear();window.history.replaceState(null,'','/map?datasetId=dataset-semarang')
  state={payload:structuredClone(fixtures.active),calls:[],adapters:[],readFailure:0,writeFailure:0,pending:null,pendingId:null,writePending:null,wrongRevision:false}
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}))
  for(const name of ['assign','replace','reload'])vi.spyOn(documentNavigation,name).mockImplementation(()=>{})
  vi.spyOn(window,'confirm').mockReturnValue(true)
  vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{
    const call={url,...options,method:options.method || 'GET',body:options.body?JSON.parse(options.body):undefined};state.calls.push(call)
    if(options.method==='GET' && url.endsWith('/active'))return Response.json(state.payload)
    if(options.method==='GET' && url.includes('/active/assets/')){
      const id=decodeURIComponent(url.split('/').at(-1))
      if(state.pending && id===state.pendingId)return state.pending.promise
      if(state.readFailure)return Response.json({error:{message:'Detail gagal'}},{status:state.readFailure})
      const detail=fixtures.detail(id,state.payload);if(state.wrongRevision)detail.recordRevision=0
      return Response.json(detail)
    }
    if(call.method!=='GET'){
      if(state.writePending)await state.writePending.promise
      if(state.writeFailure)return Response.json({error:{message:state.writeFailure===409?'Revision usang':'Simpan gagal'}},{status:state.writeFailure})
      const assetId=decodeURIComponent(url.split('/').at(-2))
      return Response.json(fixtures.mutate(state.payload,{...call.body,assetId}))
    }
    if(url.startsWith('data:'))return new Response('icon')
    throw new Error(`Unmocked ${options.method} ${url}`)
  }))
})
afterEach(()=>{vi.unstubAllGlobals();window.history.replaceState(null,'','/')})
const createAdapter=(host,options)=>{
  const adapter=Object.fromEntries(['update','updateProjection','dispose','focusAsset','highlightAsset','focusNetwork','highlightNetwork','invalidateSize'].map(name=>[name,vi.fn()]))
  state.adapters.push({host,options,adapter});let disposed=false;adapter.dispose.mockImplementation(()=>{disposed=true})
  queueMicrotask(()=>{if(!disposed)options.onReady({mode:'street',street:true,satellite:false})});return adapter
}
async function mount(role='Administrator'){
  const view=render(<StrictMode><ThemeProvider><SessionContext value={{user:{...fixtures.user,role},status:'authenticated',signOut(){}}}><MapReadPage createAdapter={createAdapter}/></SessionContext></ThemeProvider></StrictMode>)
  await waitFor(()=>expect(screen.getByRole('button',{name:'Perbesar peta'})).toBeEnabled());return view
}
const writes=()=>state.calls.filter(call=>['POST','PUT','DELETE'].includes(call.method))
const drawer=()=>within(screen.getByLabelText('Detail aset'))
async function select(id='C-01',admin=true){await userEvent.click(within(screen.getByLabelText('Daftar aset pada peta')).getByRole('button',{name:id}));if(admin)await waitFor(()=>expect(drawer().getByRole('button',{name:'Ubah ikon aset'})).toBeEnabled());else await waitFor(()=>expect(screen.queryByText('Memuat data tambahan aset…')).not.toBeInTheDocument())}
async function addPicker(){await userEvent.click(drawer().getByRole('button',{name:'Tambah atau ganti relasi'}));return drawer().getByRole('searchbox',{name:'Cari aset untuk menambah relasi'})}
async function remove(){await userEvent.click(drawer().getByRole('button',{name:'Hapus relasi dengan SW-01'}))}
describe('React asset detail and editing',()=>{
  it('reads operational revision detail and keeps Viewer read-only, connected navigation and map focus',async()=>{
    await mount('Viewer');await select('C-01',false)
    expect(drawer().getByRole('heading',{name:'Relasi aset'})).toBeVisible()
    expect(drawer().queryByRole('button',{name:'Ubah ikon aset'})).not.toBeInTheDocument()
    expect(drawer().queryByRole('button',{name:/Hapus relasi/})).not.toBeInTheDocument()
    await userEvent.click(drawer().getByRole('button',{name:'Lihat di peta'}));expect(state.adapters.at(-1).adapter.focusAsset).toHaveBeenCalledWith('C-01')
    await userEvent.click(drawer().getByRole('button',{name:/^SW-01/}));await waitFor(()=>expect(drawer().getByRole('heading',{name:'Detail aset SW-01'})).toBeVisible())
    expect(writes()).toEqual([])
  })
  it('retains error/retry and rejects stale detail revision before editing',async()=>{
    state.readFailure=500;await mount();await userEvent.click(within(screen.getByLabelText('Daftar aset pada peta')).getByRole('button',{name:'C-01'}))
    expect(await drawer().findByText('Detail gagal')).toBeVisible();state.readFailure=0;state.wrongRevision=true
    await userEvent.click(drawer().getByRole('button',{name:'Coba lagi'}));expect(await drawer().findByText(/Dataset aktif berubah/)).toBeVisible()
    state.wrongRevision=false;await userEvent.click(drawer().getByRole('button',{name:'Coba lagi'}));await waitFor(()=>expect(drawer().getByRole('button',{name:'Ubah ikon aset'})).toBeEnabled());expect(writes()).toEqual([])
  })
  it('aborts previous detail and ignores a response after choosing another asset',async()=>{
    state.pending=deferred();state.pendingId='C-01';await mount()
    await userEvent.click(within(screen.getByLabelText('Daftar aset pada peta')).getByRole('button',{name:'C-01'}))
    const read=state.calls.find(call=>call.url.endsWith('/assets/C-01'));await select('JB-01')
    expect(read.signal.aborted).toBe(true)
    await act(async()=>state.pending.resolve(Response.json(fixtures.detail('C-01'))))
    expect(drawer().getByRole('heading',{name:'Detail aset JB-01'})).toBeVisible()
  })
  it('keeps relation query and confirmed graph on failure, retries once with exact expected revision',async()=>{
    await mount();await select();const count=state.adapters.length,query=await addPicker();await userEvent.type(query,'JB-01');state.writeFailure=500
    await userEvent.click(drawer().getByRole('option',{name:'Tambah relasi ke JB-01'}));expect(await drawer().findByText('Simpan gagal')).toBeVisible();expect(query).toHaveValue('JB-01')
    expect(state.adapters.at(-1).adapter.updateProjection.mock.calls.at(-1)[0].topologyGraph.edges).toHaveLength(1)
    state.writeFailure=0;state.writePending=deferred();const option=drawer().getByRole('option',{name:'Tambah relasi ke JB-01'});await userEvent.dblClick(option);expect(writes()).toHaveLength(2)
    await act(async()=>state.writePending.resolve());await waitFor(()=>expect(drawer().getByText('Hubungan tersimpan dan sudah ditampilkan pada peta.')).toBeVisible())
    expect(writes()[1].body).toEqual({expectedRevision:4,changes:[{type:'add-relation',sourceAssetId:'C-01',targetAssetId:'JB-01'}]});expect(state.adapters).toHaveLength(count)
  })
  it('replaces in a single atomic changes request and deletes using the new revision',async()=>{
    await mount();await select();await userEvent.click(drawer().getByRole('button',{name:'Ganti relasi dengan SW-01'}))
    await userEvent.type(drawer().getByRole('searchbox',{name:'Cari aset untuk mengganti relasi'}),'JB-01');await userEvent.click(drawer().getByRole('option',{name:'Ganti relasi dengan JB-01'}))
    await waitFor(()=>expect(drawer().getByRole('button',{name:'Hapus relasi dengan JB-01'})).toBeEnabled())
    expect(writes()[0].body).toEqual({expectedRevision:4,changes:[{type:'remove-edge',edgeId:'edge'},{type:'add-relation',sourceAssetId:'C-01',targetAssetId:'JB-01'}]})
    await userEvent.click(drawer().getByRole('button',{name:'Hapus relasi dengan JB-01'}));expect(await drawer().findByText('Relasi berhasil dihapus.')).toBeVisible();expect(writes()[1].body.expectedRevision).toBe(5)
  })
  it('searches poles, assigns and detaches mounting while updating native projection in place',async()=>{
    await mount();await select();const count=state.adapters.length
    await userEvent.click(drawer().getByRole('button',{name:'Tambah tiang'}));await userEvent.type(drawer().getByRole('searchbox',{name:'Cari tiang'}),'missing');expect(drawer().getByText('Tidak ada tiang yang cocok pada fasilitas ini.')).toBeVisible()
    await userEvent.clear(drawer().getByRole('searchbox',{name:'Cari tiang'}));await userEvent.click(drawer().getByRole('button',{name:/T-01.*jarak tidak tersedia/}))
    await waitFor(()=>expect(drawer().getByRole('button',{name:'Hapus relasi dengan tiang T-01'})).toBeEnabled())
    expect(writes()[0].body).toEqual({expectedRevision:4,changes:[{type:'mount',assetId:'C-01',poleAssetId:'T-01',action:'assign'}]})
    expect(state.adapters.at(-1).adapter.updateProjection.mock.calls.at(-1)[0].poleGroups.length).toBeGreaterThan(0)
    await userEvent.click(drawer().getByRole('button',{name:'Hapus relasi dengan tiang T-01'}));await waitFor(()=>expect(drawer().getByRole('button',{name:'Tambah tiang'})).toBeEnabled());expect(writes()[1].body.expectedRevision).toBe(5);expect(state.adapters).toHaveLength(count)
  })
  it('validates icon, handles revision-only server response, refreshes map, then deletes',async()=>{
    await mount();await select();const input=drawer().getByLabelText('File ikon aset'),count=state.adapters.length
    fireEvent.change(input,{target:{files:[new File(['bad'],'bad.svg',{type:'image/svg+xml'})]}});expect(await drawer().findByText('Pilih gambar PNG, JPG, atau WebP.')).toBeVisible();expect(writes()).toEqual([])
    fireEvent.change(input,{target:{files:[new File(['png'],'icon.png',{type:'image/png'})]}});expect(await drawer().findByText('Ikon diperbarui.')).toBeVisible()
    await waitFor(()=>expect(drawer().getByRole('button',{name:'Ubah ikon aset'})).toBeEnabled())
    expect(writes()[0].body).toEqual({expectedRevision:4,dataUrl:'data:image/png;base64,aGVsbG8='});expect(state.adapters.at(-1).adapter.updateProjection.mock.calls.at(-1)[0].assetById['C-01'].customIconUrl).toBe('data:image/png;base64,aGVsbG8=')
    await userEvent.click(drawer().getByRole('button',{name:'Ubah ikon aset'}));await userEvent.click(drawer().getByRole('button',{name:'Hapus ikon'}));expect(await drawer().findByText('Ikon dihapus.')).toBeVisible();expect(writes()[1].method).toBe('DELETE');expect(writes()[1].body.expectedRevision).toBe(5);expect(state.adapters).toHaveLength(count)
  })
  it('leaves an existing icon intact after API error and supports retry',async()=>{
    state.payload.assets.find(asset=>asset.id==='C-01').customIconUrl='data:image/png;base64,b2xk';state.writeFailure=500;await mount();await select()
    fireEvent.change(drawer().getByLabelText('File ikon aset'),{target:{files:[new File(['png'],'icon.png',{type:'image/png'})]}});expect(await drawer().findByText('Simpan gagal')).toBeVisible()
    expect(state.adapters.at(-1).adapter.updateProjection.mock.calls.at(-1)[0].assetById['C-01'].customIconUrl).toBe('data:image/png;base64,b2xk')
    state.writeFailure=0;fireEvent.change(drawer().getByLabelText('File ikon aset'),{target:{files:[new File(['png'],'icon.png',{type:'image/png'})]}});expect(await drawer().findByText('Ikon diperbarui.')).toBeVisible()
  })
  it('preserves draft and confirmed state on 409 and blocks further writes until reload',async()=>{
    state.writeFailure=409;await mount();await select();const query=await addPicker();await userEvent.type(query,'JB-01');await userEvent.click(drawer().getByRole('option',{name:'Tambah relasi ke JB-01'}))
    expect(await screen.findByText('Data sudah berubah. Muat ulang peta sebelum mencoba menyimpan kembali.')).toBeVisible();expect(query).toHaveValue('JB-01');expect(drawer().getByRole('option',{name:'Tambah relasi ke JB-01'})).toBeDisabled()
    expect(state.adapters.at(-1).adapter.updateProjection.mock.calls.at(-1)[0].topologyGraph.edges).toHaveLength(1)
    await userEvent.click(screen.getByRole('button',{name:'Muat ulang peta'}));expect(documentNavigation.reload).toHaveBeenCalledOnce();expect(writes()).toHaveLength(1);const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(false)
  })
  it('guards draft on close and selection, protects beforeunload and handles external revision',async()=>{
    await mount();await select();const query=await addPicker();await userEvent.type(query,'JB-01');window.confirm.mockReturnValue(false)
    await userEvent.click(drawer().getByRole('button',{name:'Tutup detail aset'}));expect(query).toHaveValue('JB-01')
    await userEvent.click(within(screen.getByLabelText('Daftar aset pada peta')).getByRole('button',{name:'C-02'}));expect(drawer().getByRole('heading',{name:'Detail aset C-01'})).toBeVisible()
    const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true)
    act(()=>window.dispatchEvent(new StorageEvent('storage',{key:'sinergi:revision:dataset-semarang',newValue:'5'})));expect(screen.getByText('Data berubah di halaman lain. Muat ulang sebelum menyimpan.')).toBeVisible();expect(documentNavigation.reload).not.toHaveBeenCalled()
    expect(drawer().getByRole('option',{name:'Tambah relasi ke JB-01'})).toBeDisabled()
  })
  it('aborts an in-flight write on unmount and ignores its late response including revision storage',async()=>{
    state.writePending=deferred();const view=await mount();await select();await remove();const write=writes()[0];expect(write.signal.aborted).toBe(false);view.unmount();expect(write.signal.aborted).toBe(true)
    await act(async()=>state.writePending.resolve());expect(localStorage.getItem('sinergi:revision:dataset-semarang')).toBeNull();expect(state.adapters.at(-1).adapter.dispose).toHaveBeenCalled()
  })
  it('does not write after icon preparation resolves on a detached drawer',async()=>{
    const pending=deferred();prepareAssetIcon.mockImplementationOnce(()=>pending.promise);const view=await mount();await select();fireEvent.change(drawer().getByLabelText('File ikon aset'),{target:{files:[new File(['png'],'icon.png',{type:'image/png'})]}});view.unmount()
    await act(async()=>pending.resolve('data:image/png;base64,aGVsbG8='));expect(writes()).toEqual([])
  })
  it('focuses the first icon action, restores the trigger with Escape and closes on leaving the control',async()=>{
    await mount();await select();const trigger=drawer().getByRole('button',{name:'Ubah ikon aset'})
    await userEvent.click(trigger);expect(drawer().getByRole('button',{name:'Ganti ikon'})).toHaveFocus()
    await userEvent.keyboard('{Escape}');expect(trigger).toHaveFocus();expect(trigger).toHaveAttribute('aria-expanded','false')
    await userEvent.click(trigger);await userEvent.tab();expect(trigger).toHaveAttribute('aria-expanded','false');expect(writes()).toEqual([])
  })
})

it('updates an existing native surface with independent asset copies, graph and poles without changing camera',async()=>{
  const host=document.createElement('div');document.body.append(host);const asset={id:'C-01',name:'Camera'}
  let native;const surface={setState:vi.fn(),setTopologyGraph:vi.fn(),setPoleGroups:vi.fn(),refreshAssetIcons:vi.fn(),getBasemapCapabilities:()=>({}),destroy:vi.fn()}
  const create=vi.fn((_host,options)=>{native=options;return surface}),adapter=createMapReadAdapter(host,{assets:[asset]},{loadFactory:async()=>create})
  adapter.updateProjection({assetById:{'C-01':{...asset,name:'Updated'}},topologyGraph:{edges:[]},poleGroups:[]});await adapter.ready
  expect(native.manageAccessibleAssets).toBe(false);expect(native.assets[0].name).toBe('Updated');expect(asset.name).toBe('Camera');expect(surface.setTopologyGraph).toHaveBeenCalled();expect(surface.setPoleGroups).toHaveBeenCalled();expect(create).toHaveBeenCalledOnce();expect(surface.setState).not.toHaveBeenCalled();adapter.dispose();host.remove()
})

it('releases the image object URL immediately when decoding is aborted',async()=>{
  const original = await vi.importActual('../src/services/asset-icon-image.js'), revoke = vi.fn(), create = vi.fn(()=>'blob:owned-icon'), NativeURL = URL
  vi.stubGlobal('URL',class extends NativeURL { static createObjectURL=create; static revokeObjectURL=revoke })
  vi.stubGlobal('Image',class { decode(){return new Promise(()=>{})} })
  const controller=new AbortController(), promise=original.prepareAssetIcon(new File(['png'],'icon.png',{type:'image/png'}),{signal:controller.signal})
  controller.abort();await expect(promise).rejects.toMatchObject({name:'AbortError'});expect(create).toHaveBeenCalledOnce();expect(revoke).toHaveBeenCalledWith('blob:owned-icon')
})
