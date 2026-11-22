import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' lets the build work under any GitHub Pages path (e.g. /esorart/)
// `npm run dev:remote` serves the local frontend against the live backend: /api/* is proxied there,
// so the browser sees one origin and the server's CORS list doesn't need localhost.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.REMOTE_API || 'https://esorart.duckdns.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
    },
  },
})
