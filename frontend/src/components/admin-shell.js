import {renderTopNavigation,bindUserAccountMenu} from './app-header.js'

export function mountAdminShell(container,{active='imports',context=null}={}){
  if(!context&&typeof window!=='undefined'){
    const params=new URLSearchParams(window.location.search)
    context={datasetId:params.get('datasetId')||window.sessionStorage.getItem('sinergiActiveDatasetId')||'dataset-semarang',area:params.get('area')||undefined}
  }
  document.body.className='admin-body'
  container.innerHTML=`<div class="admin-app">${renderTopNavigation(active,context)}<main class="admin-main"><div data-admin-content></div></main></div>`
  bindUserAccountMenu()
  return container.querySelector('[data-admin-content]')
}
