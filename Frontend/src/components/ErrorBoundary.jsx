import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback" style={{ padding: 'var(--spacing-4)', maxWidth: '560px' }}>
          <h2 style={{ color: 'var(--color-primary)', marginBottom: 'var(--spacing-2)' }}>Something went wrong</h2>
          <p style={{ color: 'var(--color-text-steel)', marginBottom: 'var(--spacing-2)' }}>
            This page could not be loaded. Check the browser console (F12) for details.
          </p>
          {this.state.error && (
            <pre style={{ fontSize: 'var(--font-size-xs)', overflow: 'auto', padding: 'var(--spacing-2)', background: 'var(--color-bg-lighter)', borderRadius: 'var(--radius-sm)' }}>
              {this.state.error.message}
            </pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
