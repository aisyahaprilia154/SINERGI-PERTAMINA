import {loadImportConfig} from '../../services/import-dataset-service.js'
import {currentDatasetId} from '../../services/operational-api.js'
import {mountAdminShell} from '../../components/admin-shell.js'
import {mountDatasetVersions} from './dataset-versions-panel.js'
import {escapeHtml as e} from './import-view-utils.js'

export async function renderDatasetVersionsPage(container) {
  document.title='Versi database — SINERGI'
  const content=mountAdminShell(container,{active:'versions'})
  content.innerHTML=`<section class="operational-import"><div class="au-heading"><div><h1>Versi database</h1><p>Simpan keadaan database atau pulihkan ke versi sebelumnya.</p></div></div><div data-versions-content></div><p class="operational-status" data-page-status role="status">Memuat data…</p></section>`
  const status=content.querySelector('[data-page-status]')
  try {
    const config=await loadImportConfig()
    if(!container.isConnected)return
    if(!config.datasets.length)throw new Error('Belum ada dataset yang tersedia.')
    const requested=new URLSearchParams(window.location.search).get('datasetId')||currentDatasetId()
    const datasetId=config.datasets.some(d=>d.id===requested)?requested:config.datasets[0].id
    const name=d=>d.name||(d.id==='dataset-semarang'?'SINERGI':d.id)
    content.querySelector('[data-versions-content]').innerHTML=`<div class="au-toolbar admin-dataset-context">${config.datasets.length===1?`<span>Dataset <strong>${e(name(config.datasets[0]))}</strong></span>`:`<label>Dataset <select data-dataset-context aria-label="Dataset aktif">${config.datasets.map(d=>`<option value="${e(d.id)}" ${d.id===datasetId?'selected':''}>${e(name(d))}</option>`).join('')}</select></label>`}</div><section class="admin-section" data-dataset-versions></section>`
    const selector=content.querySelector('[data-dataset-context]')
    const versions=mountDatasetVersions(content.querySelector('[data-dataset-versions]'),{datasetId,onBusy:busy=>{if(selector)selector.disabled=busy}})
    selector?.addEventListener('change',()=>versions.setDatasetId(selector.value))
    status.textContent=''
  }catch(error){status.textContent=error.message}
}
