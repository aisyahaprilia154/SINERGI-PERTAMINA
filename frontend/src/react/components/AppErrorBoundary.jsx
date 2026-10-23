import { Component } from 'react'
import { ErrorScreen } from './ErrorScreen.jsx'

export class AppErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <ErrorScreen /> : this.props.children
  }
}
