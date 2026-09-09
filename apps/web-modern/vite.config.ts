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
    // La carpeta del build NO puede llamarse "assets": colisiona con la ruta
    // SPA /assets y nginx resuelve el directorio antes de llegar al index.html
    // (F5 o URL pegada daban 404). Ver check-route-collisions.ts, que falla el
    // build si alguna ruta de la app vuelve a chocar con un path estatico.
    assetsDir: 'static',
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
      '/platform/user-activity':     { target: 'http://localhost:3106', changeOrigin: true, bypass: apiOnly },
    },
  },
})
