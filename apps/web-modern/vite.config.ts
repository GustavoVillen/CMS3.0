import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Browser navigations (Accept: text/html) must be served by React (index.html).
// Only fetch/XHR API calls should be proxied to the backend.
function apiOnly(req: any) {
  if (req.headers['accept']?.includes('text/html')) return '/index.html';
  return null;
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/auth': { target: 'http://localhost:3105', changeOrigin: true },
      '/app':     { target: 'http://localhost:3105', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3105', changeOrigin: true },
      '/platform/auth':         { target: 'http://localhost:3105', changeOrigin: true, bypass: apiOnly },
      '/platform/tenants':      { target: 'http://localhost:3105', changeOrigin: true, bypass: apiOnly },
      '/platform/users':        { target: 'http://localhost:3105', changeOrigin: true, bypass: apiOnly },
      '/platform/audit-events': { target: 'http://localhost:3105', changeOrigin: true, bypass: apiOnly },
      '/platform/prompts':      { target: 'http://localhost:3105', changeOrigin: true, bypass: apiOnly },
    },
  },
})
