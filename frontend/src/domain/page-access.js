export function normalizePagePath(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/'
  return { '/peta': '/map', '/topologi': '/topology' }[path] ?? path
}

export function pageAccess(pathname) {
  const path = normalizePagePath(pathname)
  if (path === '/map' || path === '/topology') return 'authenticated'
  if (['/admin/users', '/admin/datasets/versions', '/admin/datasets/import'].includes(path)
    || /^\/admin\/datasets\/import\/[^/]+\/preview$/.test(path)) return 'administrator'
  return 'login'
}

export function pageRedirect(pathname, user) {
  const access = pageAccess(pathname)
  if (access === 'login') return user ? '/map' : null
  if (!user) return '/'
  return access === 'administrator' && user.role !== 'Administrator' ? '/map' : null
}
