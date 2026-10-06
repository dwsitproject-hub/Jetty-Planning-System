import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n'
import App from './App'
import './styles/design-tokens.css'
import './styles/app.css'
import './styles/operator-mobile.css'
import { clearStaleChunkReloadFlag } from './utils/staleChunkReload'

clearStaleChunkReloadFlag()

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
