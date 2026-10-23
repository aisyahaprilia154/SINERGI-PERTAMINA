import { useLayoutEffect } from 'react'
import { AppHeader } from './AppHeader.jsx'

export function AdminLayout({ active = 'imports', context, title, children }) {
  useLayoutEffect(() => {
    const className = document.body.className, previousTitle = document.title
    document.body.className = 'admin-body'
    if (title) document.title = title
    return () => { document.body.className = className; document.title = previousTitle }
  }, [title])
  const params = new URLSearchParams(window.location.search)
  const resolvedContext = context ?? { datasetId: params.get('datasetId') || window.sessionStorage.getItem('sinergiActiveDatasetId') || 'dataset-semarang', area: params.get('area') || undefined }
  return <div className="admin-app"><AppHeader active={active} context={resolvedContext} /><main className="admin-main"><div data-admin-content>{children}</div></main></div>
}
