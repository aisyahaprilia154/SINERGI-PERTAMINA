import { pageAccess } from '../domain/page-access.js'

const loginRoute = async () => {
  const { LoginRoute } = await import('./login/LoginRoute.jsx')
  return { Component: LoginRoute }
}

// Preserve the old unknown-URL login fallback, without claiming protected pages.
export const reactRoutes = [
  { path: '/', lazy: loginRoute },
  { path: '/admin/users', lazy: async () => {
    const { UsersRoute } = await import('./users/UsersRoute.jsx')
    return { Component: UsersRoute }
  } },
  { path: '*', lazy: loginRoute, handle: { acceptsPath: pathname => pageAccess(pathname) === 'login' } },
]
