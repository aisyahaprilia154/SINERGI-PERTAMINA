import {escapeHtml} from '../pages/admin/import-view-utils.js'

export function adminDrawerMarkup(id) {
  return `<div class="au-editor-layer" data-drawer="${escapeHtml(id)}" hidden><button class="au-editor-backdrop" data-close-editor type="button" aria-label="Tutup panel" tabindex="-1"></button><aside class="au-editor" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(id)}-title" hidden></aside></div>`
}

export function adminDrawerHeading(title,id) {
  return `<div class="au-editor-heading"><h2 id="${escapeHtml(id)}-title">${escapeHtml(title)}</h2><button type="button" class="au-icon" data-close-editor aria-label="Tutup panel"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>`
}

export function bindAdminOverlay(root,{isOpen,onEscape,isBusy=()=>false}) {
  const handle=event=>{
    if(!isOpen())return
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(el=>!el.closest('[hidden]'))
    if(dialogs.length&&!root.contains(dialogs.at(-1)))return
    if(event.key==='Escape'){event.preventDefault();if(!isBusy())onEscape();return}
    if(event.key!=='Tab')return
    const fields=[...root.querySelectorAll('button,input,select,textarea,a[href]')].filter(el=>!el.disabled&&el.tabIndex!==-1&&!el.closest('[hidden]'))
    if(!fields.length){event.preventDefault();return}
    const first=fields[0],last=fields.at(-1)
    if(!root.contains(document.activeElement)){event.preventDefault();first.focus()}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
  document.addEventListener('keydown',handle)
  return ()=>document.removeEventListener('keydown',handle)
}
