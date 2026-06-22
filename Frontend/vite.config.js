import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // SPA using VITE_API_BASE_URL=/api/v1 hits same origin → forward to Express on 3000
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      // RTSP helper (rtsp-stream-viewer): same-origin fetches + WS without CORS when VITE_JETTY_LIVE_HTTP_ORIGIN is unset.
      '/jetty-live-stream': {
        target: 'http://127.0.0.1:3080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/jetty-live-stream/, '') || '/',
      },
      '/jetty-live-ws': {
        target: 'ws://127.0.0.1:9999',
        ws: true,
        changeOrigin: true,
        rewrite: (p) => (p === '/jetty-live-ws' || p.startsWith('/jetty-live-ws/') ? '/' : p),
      },
    },
  },
})
