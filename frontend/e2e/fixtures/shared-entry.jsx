import { mountReactApp } from '../../src/react/bootstrap.jsx'
import { SharedLab } from './SharedLab.jsx'

mountReactApp(document.querySelector('#app'), { routes: [{ path: '/e2e/fixtures/shared.html', element: <SharedLab /> }] })
