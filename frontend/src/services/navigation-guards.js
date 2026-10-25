const guards=new Set()
export function registerNavigationGuard(read){guards.add(read);return()=>guards.delete(read)}
export function permitAppNavigation(){
  const states=[...guards].map(read=>read()),busy=states.some(state=>state.busy),dirty=states.some(state=>state.dirty)
  if(!busy&&!dirty)return true
  return window.confirm(busy?'Proses masih berjalan. Tinggalkan halaman dan hentikan permintaan di halaman ini?':'Buang perubahan yang belum disimpan dan tinggalkan halaman?')
}
