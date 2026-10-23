import { pageAccess } from '../domain/page-access.js'

const loginRoute = async () => {
  const { LoginRoute } = await import('./login/LoginRoute.jsx')
  return { Component: LoginRoute }
}

// Preserve the old unknown-URL login fallback, without claiming protected pages.
export const reactRoutes = [
  { path: '/', lazy: loginRoute },
  { path: '*', lazy: loginRoute, handle: { acceptsPath: pathname => pageAccess(pathname) === 'login' } },
]
