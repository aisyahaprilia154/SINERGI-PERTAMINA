import { StrictMode, useState } from 'react'
import { act, fireEvent, render as renderRoot, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'
import { MapTransferDialog } from '../src/react/map/MapTransferDialog.jsx'
import { SchematicDialog } from '../src/react/map/SchematicDialog.jsx'
import { SessionContext } from '../src/react/session/session-context.js'
import { ThemeProvider } from '../src/react/theme/ThemeProvider.jsx'
import { createMapReadModel } from '../src/domain/map-read-model.js'
import { createMapDiagrams } from '../src/domain/map-diagrams.js'
import { createSchematicBoardAdapter } from '../src/adapters/schematic-board-adapter.js'
import { createDownloadScope } from '../src/services/download-scope.js'
import { loadImportConfig, uploadDataset, loadImportStatus, downloadDatasetSource } from '../src/services/import-dataset-service.js'
import { exportActiveKml } from '../src/services/active-dataset-service.js'
import { downloadSchematicPng, downloadSchematicSvg } from '../src/pages/map/schematic-export.js'
import { documentNavigation } from '../src/services/document-navigation.js'

vi.mock('../src/services/import-dataset-service.js',async original=>({...await original(),loadImportConfig:vi.fn(),uploadDataset:vi.fn(),loadImportStatus:vi.fn(),downloadDatasetSource:vi.fn()}))
vi.mock('../src/services/active-dataset-service.js',async original=>({...await original(),exportActiveKml:vi.fn()}))
vi.mock('../src/pages/map/schematic-export.js',async original=>({...await original(),downloadSchematicPng:vi.fn(),downloadSchematicSvg:vi.fn()}))
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const render=element=>renderRoot(<StrictMode>{element}</StrictMode>)
let snapshot,createUrl,revokeUrl
beforeEach(()=>{
  sessionStorage.clear();localStorage.clear()
  const model=createMapReadModel(fixtures.active,'?area=ft-semarang')
  snapshot={model,context:model.activeContext,networks:model.networks,selectedNetworkIds:new Set(model.networks.map(network=>network.id)),selectedAssetId:'C-01',mode:'import',areaScopeLabel:model.selectedArea.name}
  HTMLDialogElement.prototype.showModal ||= function(){}
  HTMLDialogElement.prototype.close ||= function(){}
  Element.prototype.scrollTo ||= function(){}
  vi.stubGlobal('requestAnimationFrame',callback=>setTimeout(callback,0));vi.stubGlobal('cancelAnimationFrame',timer=>clearTimeout(timer))
  vi.spyOn(HTMLDialogElement.prototype,'showModal').mockImplementation(function(){this.setAttribute('open','');this.querySelector('button')?.focus()})
  vi.spyOn(HTMLDialogElement.prototype,'close').mockImplementation(function(){this.removeAttribute('open')})
  vi.spyOn(Element.prototype,'scrollTo').mockImplementation(function({top,left}){this.scrollTop=top||0;this.scrollLeft=left||0})
  vi.spyOn(window,'confirm').mockReturnValue(true)
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}))
  for(const name of ['assign','replace','reload'])vi.spyOn(documentNavigation,name).mockImplementation(()=>{})
  const OriginalURL=URL;createUrl=vi.fn(()=>`blob:dialog-${createUrl.mock.calls.length}`);revokeUrl=vi.fn()
  vi.stubGlobal('URL',class extends OriginalURL{static createObjectURL=createUrl;static revokeObjectURL=revokeUrl})
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob(['icon'],{type:'image/png'})})))
  for(const mock of [loadImportConfig,uploadDataset,loadImportStatus,downloadDatasetSource,exportActiveKml,downloadSchematicPng,downloadSchematicSvg])mock.mockReset()
  loadImportConfig.mockResolvedValue({maxFileSize:1000,datasets:[{id:'dataset-semarang'}]})
  uploadDataset.mockResolvedValue({importId:'new import/01',statusUrl:'/api/jobs/status'})
  loadImportStatus.mockResolvedValue({import:{id:'new import/01',status:'ready'}})
  downloadDatasetSource.mockResolvedValue({blob:new Blob(['source']),filename:'Sumber é.kmz'})
  exportActiveKml.mockResolvedValue({blob:new Blob(['<kml/>']),filename:'sinergi-active.kml'})
  downloadSchematicPng.mockImplementation(async(_svg,name,_scale,options)=>{options.signal.throwIfAborted();options.saveBlob(new Blob(['PNG']),name)})
  downloadSchematicSvg.mockImplementation((_svg,name,options)=>options.saveBlob(new Blob(['SVG']),name))
})
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
function Wrapper({children,role='Administrator'}){return <StrictMode><ThemeProvider><SessionContext value={{user:{...fixtures.user,role},status:'authenticated',signOut(){}}}>{children}</SessionContext></ThemeProvider></StrictMode>}
function TransferHarness({role='Administrator',guard}){const [open,setOpen]=useState(true);return <Wrapper role={role}>{open&&<MapTransferDialog snapshot={snapshot} onClose={()=>setOpen(false)} onGuardChange={guard}/>}</Wrapper>}
async function transfer(role,guard){const view=render(<TransferHarness role={role} guard={guard}/>);if(role!=='Viewer')await waitFor(()=>expect(screen.getByRole('button',{name:'Unggah dan lihat preview'})).toBeEnabled());return view}
async function form(name='Draft',filename='tambahan.kmz',contents='KMZ'){
  await userEvent.clear(screen.getByLabelText('Nama impor'));await userEvent.type(screen.getByLabelText('Nama impor'),name)
  const file=new File([contents],filename,{type:'application/octet-stream'});await userEvent.setup({applyAccept:false}).upload(screen.getByLabelText('File KML/KMZ'),file);return file
}
const submit=async()=>{fireEvent.submit(document.querySelector('[data-upload]'));await act(async()=>{})}
describe('React transfer dialog',()=>{
  it('aborts StrictMode configuration reads and validates file extension, size and required input before upload',async()=>{
    await transfer();expect(loadImportConfig.mock.calls[0][0].signal.aborted).toBe(true)
    await userEvent.click(screen.getByRole('button',{name:'Unggah dan lihat preview'}));expect(uploadDataset).not.toHaveBeenCalled();await form('Draft','file.txt');await submit();expect(await screen.findByRole('alert')).toHaveTextContent('Pilih file KML/KMZ');expect(uploadDataset).not.toHaveBeenCalled()
    await form('Draft','file.kml','x'.repeat(1001));await submit();expect(uploadDataset).not.toHaveBeenCalled();expect(screen.getByLabelText('Nama impor')).toHaveValue('Draft')
  })
  it('keeps draft and file on upload failure, blocks duplicate submits, then redirects with the returned import ID',async()=>{
    const pending=deferred();uploadDataset.mockImplementationOnce(()=>pending.promise);await transfer();const file=await form('  Tambahan  ')
    fireEvent.submit(document.querySelector('[data-upload]'));fireEvent.submit(document.querySelector('[data-upload]'));expect(uploadDataset).toHaveBeenCalledOnce();expect(screen.getByLabelText('Nama impor')).toBeDisabled()
    await act(async()=>pending.reject(new Error('Koneksi terputus')));expect(await screen.findByText('Koneksi terputus')).toBeVisible();expect(screen.getByLabelText('Nama impor')).toHaveValue('  Tambahan  ')
    await submit();expect(uploadDataset.mock.calls[1][0]).toMatchObject({fields:{datasetId:'dataset-semarang',versionName:'Tambahan'},file});expect(documentNavigation.assign).toHaveBeenCalledWith('/admin/datasets/import/new%20import%2F01/preview')
  })
  it('resumes a failed status read without reuploading the file',async()=>{
    loadImportStatus.mockRejectedValueOnce(new Error('Status sementara gagal'));await transfer();await form();await submit();await userEvent.click(await screen.findByRole('button',{name:'Coba lagi status impor'}));await waitFor(()=>expect(documentNavigation.assign).toHaveBeenCalled());expect(uploadDataset).toHaveBeenCalledOnce();expect(loadImportStatus).toHaveBeenCalledTimes(2)
  })
  it('polls processing status and cancels its timer/request when closed',async()=>{
    loadImportStatus.mockResolvedValue({import:{status:'processing'}});await transfer();await form();await submit();const options=uploadDataset.mock.calls[0][0];expect(screen.getAllByRole('status').some(node=>node.textContent.includes('Membaca file'))).toBe(true)
    await userEvent.click(screen.getByRole('button',{name:'Tutup'}));expect(options.signal.aborted).toBe(true);expect(window.confirm).toHaveBeenCalledWith('Batalkan proses dan tutup dialog?');const reads=loadImportStatus.mock.calls.length;await new Promise(done=>setTimeout(done,1250));expect(loadImportStatus).toHaveBeenCalledTimes(reads)
  })
  it('handles failed jobs and rejects a status response for another import',async()=>{
    loadImportStatus.mockResolvedValueOnce({import:{status:'failed',error:{message:'KMZ rusak'}}});await transfer();await form();await submit();expect(await screen.findByText('KMZ rusak')).toBeVisible();expect(screen.queryByText('Coba lagi status impor')).not.toBeInTheDocument()
    loadImportStatus.mockResolvedValueOnce({import:{id:'wrong',status:'ready'}});await submit();expect(await screen.findByText('Status impor tidak sesuai dengan unggahan ini.')).toBeVisible();expect(documentNavigation.assign).not.toHaveBeenCalled()
  })
  it('retries unavailable config and never uploads while its size limit is unknown',async()=>{
    loadImportConfig.mockRejectedValue(new Error('Config gagal'));render(<TransferHarness/>);expect(await screen.findByRole('alert')).toHaveTextContent('Config gagal');expect(screen.getByRole('button',{name:'Unggah dan lihat preview'})).toBeDisabled()
    loadImportConfig.mockResolvedValue({maxFileSize:1000});await userEvent.click(screen.getByRole('button',{name:'Coba lagi konfigurasi'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Unggah dan lihat preview'})).toBeEnabled())
  })
  it('Viewer can export only, sends selected canonical asset IDs and cleans every URL when closed',async()=>{
    await transfer('Viewer');expect(loadImportConfig).not.toHaveBeenCalled();expect(screen.queryByText('Impor tambahan')).not.toBeInTheDocument();expect(screen.queryByLabelText('File KML/KMZ')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{name:'Ekspor KML operasional'}));expect(exportActiveKml.mock.calls[0][0]).toMatchObject({datasetId:'dataset-semarang',assetIds:['SW-01','C-01']})
    await userEvent.click(screen.getByRole('button',{name:'Unduh sumber terakhir'}));expect(downloadDatasetSource.mock.calls[0][0].importId).toBe('baseline');expect(createUrl).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button',{name:'Tutup'}));expect(revokeUrl).toHaveBeenCalledTimes(2);expect(uploadDataset).not.toHaveBeenCalled()
  })
  it('does not interpret an empty network filter as exporting all assets',async()=>{
    snapshot.selectedNetworkIds=new Set();await transfer('Viewer');await userEvent.click(screen.getByRole('button',{name:'Ekspor KML operasional'}));expect(await screen.findByText('Pilih jaringan berisi aset sebelum mengekspor KML.')).toBeVisible();expect(exportActiveKml).not.toHaveBeenCalled()
  })
  it('retains draft across tabs, guards Escape/unload and releases its external guard on discard',async()=>{
    const guard=vi.fn();await transfer('Administrator',guard);await form();await userEvent.click(screen.getByRole('button',{name:'Ekspor data'}));await userEvent.click(screen.getByRole('button',{name:'Impor tambahan'}));expect(screen.getByLabelText('Nama impor')).toHaveValue('Draft')
    const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);window.confirm.mockReturnValueOnce(false);await userEvent.keyboard('{Escape}');expect(screen.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Escape}');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(guard.mock.calls.at(-1)[0]).toEqual({dirty:false,busy:false})
  })
  it('clears the upload guard before successful full-document navigation',async()=>{
    await transfer();await form();documentNavigation.assign.mockImplementation(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(false)});await submit();await waitFor(()=>expect(documentNavigation.assign).toHaveBeenCalledOnce())
  })
  it('aborts a pending download on pagehide and ignores a late blob',async()=>{
    const pending=deferred();exportActiveKml.mockImplementation(()=>pending.promise);const view=await transfer('Viewer');await userEvent.click(screen.getByRole('button',{name:'Ekspor KML operasional'}));const signal=exportActiveKml.mock.calls[0][0].signal
    act(()=>window.dispatchEvent(new Event('pagehide')));expect(signal.aborted).toBe(true);await act(async()=>pending.resolve({blob:new Blob(['late']),filename:'late.kml'}));expect(createUrl).not.toHaveBeenCalled();view.unmount()
  })
  it('handles expired export sessions and exposes source errors for retry',async()=>{
    downloadDatasetSource.mockRejectedValueOnce(new Error('Sumber gagal'));await transfer('Viewer');await userEvent.click(screen.getByRole('button',{name:'Unduh sumber terakhir'}));expect(await screen.findByText('Sumber gagal')).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Unduh sumber terakhir'}));expect(createUrl).toHaveBeenCalledOnce()
    exportActiveKml.mockRejectedValue(Object.assign(new Error('Sesi berakhir'),{status:401}));await userEvent.click(screen.getByRole('button',{name:'Ekspor KML operasional'}));await waitFor(()=>expect(documentNavigation.replace).toHaveBeenCalledWith('/'));expect(exportActiveKml.mock.calls[0][0].signal.aborted).toBe(true)
  })
})

function DiagramHarness({prepareDiagrams}){const [open,setOpen]=useState(true);return <Wrapper>{open&&<SchematicDialog snapshot={snapshot} onClose={()=>setOpen(false)} onSelectAsset={snapshot.onSelect} prepareDiagrams={prepareDiagrams}/>}</Wrapper>}
async function diagram(){const view=render(<DiagramHarness/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Export SVG'})).toBeEnabled());return view}
describe('React schematic dialog and retained SVG engine',()=>{
  it('uses all graph modes, summary and selection search while preserving source coordinates',async()=>{
    const before=JSON.stringify(snapshot.model);snapshot.onSelect=vi.fn();await diagram();expect(screen.getByRole('heading',{name:'Ringkasan aset'})).toBeVisible();await userEvent.type(screen.getByRole('searchbox',{name:'Cari aset dalam diagram'}),'C-01');await userEvent.keyboard('{Enter}');expect(snapshot.onSelect).toHaveBeenCalledWith('C-01');expect(screen.getByRole('heading',{name:'Relasi aset terpilih'})).toBeVisible()
    await userEvent.click(screen.getByRole('tab',{name:/Topologi jaringan/}));expect(screen.getByRole('tab',{name:/Topologi jaringan/})).toHaveAttribute('aria-selected','true');await userEvent.click(screen.getByRole('tab',{name:/Jalur terpilih/}));expect(document.querySelector('svg')).toBeInTheDocument();expect(JSON.stringify(snapshot.model)).toBe(before)
  })
  it('disables selected scope without an anchor and handles empty graphs',async()=>{
    snapshot.selectedAssetId=null;snapshot.model={...snapshot.model,assets:[],diagramAssets:[],networks:[],topologyGraph:{nodes:[],edges:[]},poleGroups:[]};render(<DiagramHarness/>);expect(await screen.findByText('Data diagram belum tersedia')).toBeVisible();expect(screen.getByRole('tab',{name:/Jalur terpilih/})).toBeDisabled();expect(screen.getByRole('button',{name:'Export PNG'})).toBeDisabled()
  })
  it('keeps keyboard search usable, controls zoom/fit/reset, and does not write any API',async()=>{
    await diagram();await userEvent.click(screen.getByRole('button',{name:'Perbesar diagram'}));expect(document.querySelector('.diagram-zoom-level')).toHaveTextContent('%');await userEvent.click(screen.getByRole('button',{name:'Perkecil diagram'}));await userEvent.click(screen.getByRole('button',{name:'Reset tampilan'}));await userEvent.type(screen.getByRole('searchbox'), 'absent');expect(screen.getByText('Tidak ada aset yang cocok.')).toBeVisible();await userEvent.clear(screen.getByRole('searchbox'));await userEvent.type(screen.getByRole('searchbox'),'C-01');await userEvent.keyboard('{ArrowDown}{Enter}');expect(screen.getByRole('searchbox')).toHaveValue('C-01');expect(uploadDataset).not.toHaveBeenCalled();expect(exportActiveKml).not.toHaveBeenCalled()
  })
  it('exports SVG/PNG through the original engine with owned URLs and blocks duplicate PNG clicks',async()=>{
    await diagram();await userEvent.click(screen.getByRole('button',{name:'Export SVG'}));expect(downloadSchematicSvg).toHaveBeenCalledOnce();expect(downloadSchematicSvg.mock.calls[0][1]).toMatch(/\.svg$/)
    const pending=deferred();downloadSchematicPng.mockImplementationOnce(()=>pending.promise);await userEvent.dblClick(screen.getByRole('button',{name:'Export PNG'}));expect(downloadSchematicPng).toHaveBeenCalledOnce();const signal=downloadSchematicPng.mock.calls[0][3].signal
    await userEvent.click(screen.getByRole('button',{name:'Tutup diagram'}));expect(signal.aborted).toBe(true);expect(revokeUrl).toHaveBeenCalledOnce();await act(async()=>pending.resolve());expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('shows an export failure and permits retry without rebuilding the source graph',async()=>{
    downloadSchematicPng.mockRejectedValueOnce(new Error('PNG gagal'));await diagram();const nodes=document.querySelectorAll('.diagram-node').length;await userEvent.click(screen.getByRole('button',{name:'Export PNG'}));expect(await screen.findByText('PNG gagal')).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Export PNG'}));expect(await screen.findByText('File PNG berhasil disiapkan.')).toBeVisible();expect(document.querySelectorAll('.diagram-node')).toHaveLength(nodes)
  })
  it('retries failed preparation and ignores a preparation result after unmount',async()=>{
    const pending=deferred(),prepare=vi.fn().mockRejectedValue(new Error('Diagram gagal'));const view=render(<DiagramHarness prepareDiagrams={prepare}/>);expect(await screen.findByText('Diagram gagal')).toBeVisible();prepare.mockResolvedValue(createMapDiagrams(snapshot.model,snapshot.selectedAssetId));await userEvent.click(screen.getByRole('button',{name:'Coba lagi diagram'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Export SVG'})).toBeEnabled());view.unmount()
    prepare.mockImplementation(()=>pending.promise);const late=render(<DiagramHarness prepareDiagrams={prepare}/>);const signal=prepare.mock.calls.at(-1)[2];late.unmount();expect(signal.aborted).toBe(true);await act(async()=>pending.resolve(createMapDiagrams(snapshot.model,snapshot.selectedAssetId)));expect(document.querySelector('svg')).not.toBeInTheDocument()
  })
  it('uses fallback fullscreen and exits it before closing with Escape',async()=>{
    await diagram();await userEvent.click(screen.getByRole('button',{name:'Buka ruang kerja diagram layar penuh'}));expect(document.querySelector('.schematic-shell')).toHaveClass('schematic-shell-fullscreen');await userEvent.keyboard('{Escape}');expect(screen.getByRole('dialog')).toBeVisible();expect(document.querySelector('.schematic-shell')).not.toHaveClass('schematic-shell-fullscreen');await userEvent.keyboard('{Escape}');expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

it('disposes board observers, pointer/wheel listeners and frames without late callbacks',()=>{
  const disconnect=vi.fn();vi.stubGlobal('ResizeObserver',class {observe(){}disconnect=disconnect});const board=document.createElement('div');document.body.append(board);const onZoom=vi.fn(),adapter=createSchematicBoardAdapter(board,{onZoom});const current=createMapDiagrams(snapshot.model,'C-01')['all-assets'];adapter.render(current,{context:snapshot.context});adapter.zoomIn();const count=onZoom.mock.calls.length;adapter.dispose();adapter.dispose();board.dispatchEvent(new WheelEvent('wheel',{deltaY:-1}));expect(onZoom).toHaveBeenCalledTimes(count);expect(disconnect).toHaveBeenCalledOnce();expect(board).toBeEmptyDOMElement();board.remove()
})
it('releases pending PNG source URLs on abort before image decoding completes',async()=>{
  const original=await vi.importActual('../src/pages/map/schematic-export.js');vi.stubGlobal('Image',class {})
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');Object.defineProperty(svg,'viewBox',{value:{baseVal:{width:100,height:80}}});const clone=svg.cloneNode(true);Object.defineProperty(clone,'viewBox',{value:{baseVal:{width:100,height:80}}});vi.spyOn(svg,'cloneNode').mockReturnValue(clone)
  const controller=new AbortController(),promise=original.downloadSchematicPng(svg,'test.png',2,{signal:controller.signal});controller.abort();await expect(promise).rejects.toMatchObject({name:'AbortError'});expect(revokeUrl).toHaveBeenCalledOnce()
})
it('does not create a download after its URL owner is disposed',()=>{
  const controller=new AbortController(),scope=createDownloadScope(controller.signal);scope.saveBlob(new Blob(['one']),'one.kml');controller.abort();expect(revokeUrl).toHaveBeenCalledOnce();expect(()=>scope.saveBlob(new Blob(['late']),'late.kml')).toThrow();scope.dispose();expect(revokeUrl).toHaveBeenCalledOnce()
})
