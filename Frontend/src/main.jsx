import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import './i18n'
import App from './App'
import { isNative } from './platform'
import './styles/design-tokens.css'
import './styles/app.css'

// Native (Capacitor) runs from a file/WebView origin with no history server, so use
// HashRouter there. The web build keeps BrowserRouter (clean URLs) unchanged.
const Router = isNative() ? HashRouter : BrowserRouter

// Tag the root so mobile-app-only CSS (safe areas, tap highlight) can be scoped
// without ever affecting the web build.
if (isNative()) {
  document.documentElement.classList.add('jps-native')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
)
