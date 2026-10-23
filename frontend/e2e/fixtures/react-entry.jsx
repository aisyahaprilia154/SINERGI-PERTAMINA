import { mountReactApp } from '../../src/react/bootstrap.jsx'
import { FoundationLab } from './FoundationLab.jsx'

const mode = new URLSearchParams(window.location.search).get('case')
mountReactApp(document.querySelector('#app'), { routes: [{
  path: '/e2e/fixtures/react.html',
  loader: async ({ request }) => {
    if (mode === 'loader-error') throw new Error('Foundation fixture loader failure')
    if (mode === 'loading') await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(request.signal.reason) }
      const timer = setTimeout(() => { request.signal.removeEventListener('abort', abort); resolve() }, 700)
      request.signal.addEventListener('abort', abort, { once: true })
    })
    return null
  },
  element: <FoundationLab />,
}] })
