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
  // No emitir source maps en producción: no aportan a usuarios y triplican el
  // tamaño del artefacto de deploy (además de exponer el código fuente).
  build: {
    sourcemap: false,
  },
  server: {
    port: 5174,
    proxy: {
      '/auth': { target: 'http://localhost:3106', changeOrigin: true },
      '/app':     { target: 'http://localhost:3106', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3106', changeOrigin: true },
      '/platform/auth':         { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
      '/platform/tenants':      { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
      '/platform/users':        { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
      '/platform/audit-events': { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
      '/platform/usage':        { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
      '/platform/prompts':      { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
      '/platform/access':       { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
      // Estas dos faltaban: sin la entrada acá, Vite devuelve el index.html en
      // lugar de la respuesta de la API y las pantallas quedan vacías en local.
      '/platform/copilot-questions': { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
      '/platform/vessel-positions':  { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
    },
  },
})
