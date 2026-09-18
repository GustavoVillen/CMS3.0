import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Vista previa de los links del celular (WhatsApp y otros): el que arma la
 * tarjeta no corre JavaScript, lee el nombre y el icono del HTML tal cual llega.
 * Por cada pantalla se escribe dist/_og/<ruta>.html = el mismo index.html con su
 * propio nombre e icono (los iconos viven en public/_og/). nginx lo sirve con
 * `try_files $uri /_og$uri.html $uri/ /index.html` (vhosts cms3-wildcard y cms3-demo);
 * sin esa regla la ruta sigue andando, sólo que con la vista previa de siempre.
 */
const SHARE_PAGES: Record<string, string> = {
  'm':               'CMS3 - Mob',
  'abordo':          'CMS3 - Mob: A bordo',
  'm-approvals':     'CMS3 - Mob: Approvals',
  'm-daily-reports': 'CMS3 - Mob: Daily Reports',
}

function sharePreviews(): Plugin {
  let outDir = 'dist'
  return {
    name: 'share-previews',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir },
    closeBundle() {
      const html = readFileSync(join(outDir, 'index.html'), 'utf8')
      const swap = (src: string, re: RegExp, to: string) => {
        if (!re.test(src)) throw new Error(`share-previews: no se encontró ${re} en index.html`)
        return src.replace(re, to)
      }
      for (const [page, title] of Object.entries(SHARE_PAGES)) {
        const icon = `/_og/${page}.png`
        let out = html
        out = swap(out, /<title>[^<]*<\/title>/, `<title>${title}</title>\n    <meta property="og:title" content="${title}" />`)
        out = swap(out, /(<link rel="icon"[^>]*href=")[^"]*"/, `$1${icon}"`)
        out = swap(out, /(<link rel="apple-touch-icon" href=")[^"]*"/, `$1${icon}"`)
        out = swap(out, /(<meta name="apple-mobile-web-app-title" content=")[^"]*"/, `$1${title}"`)
        writeFileSync(join(outDir, '_og', `${page}.html`), out)
      }
    },
  }
}

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
    sharePreviews(),
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
