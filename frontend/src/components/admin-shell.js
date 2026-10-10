import {renderTopNavigation,bindUserAccountMenu} from './app-header.js'

export function adminTabs(active){return `<nav class="admin-tabs" aria-label="Menu admin"><a href="/admin/users" ${active==='users'?'class="active" aria-current="page"':''}>Pengguna</a><a href="/admin/datasets/import" ${active==='imports'?'class="active" aria-current="page"':''}>Impor</a></nav>`}

export function mountAdminShell(container,{active='imports',context=null}={}){
  if(!context&&typeof window!=='undefined'){
    const params=new URLSearchParams(window.location.search)
    context={datasetId:params.get('datasetId')||window.sessionStorage.getItem('sinergiActiveDatasetId')||'dataset-semarang',area:params.get('area')||undefined}
  }
  document.body.className='admin-body'
  container.innerHTML=`<div class="admin-app">${renderTopNavigation('admin',context)}<main class="admin-main">${adminTabs(active)}<div data-admin-content></div></main></div>`
  bindUserAccountMenu()
  return container.querySelector('[data-admin-content]')
}
