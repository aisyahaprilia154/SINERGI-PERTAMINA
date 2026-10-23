import { Suspense } from 'react'
import { Outlet, createBrowserRouter } from 'react-router'
import { AppErrorBoundary } from './components/AppErrorBoundary.jsx'
import { ErrorScreen } from './components/ErrorScreen.jsx'
import { LoadingScreen } from './components/LoadingScreen.jsx'

function AppShell() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        <Outlet />
      </Suspense>
    </AppErrorBoundary>
  )
}

export function createAppRouter(routes, routerFactory = createBrowserRouter) {
  return routerFactory([{
    element: <AppShell />,
    errorElement: <ErrorScreen />,
    hydrateFallbackElement: <LoadingScreen />,
    children: routes,
  }])
}
