/**
 * B-01 — Guarda contra rutas de la app que chocan con paths ya servidos.
 *
 * El bug original: la ruta SPA /assets y la carpeta dist/assets del build de
 * Vite se llamaban igual. nginx resolvia el directorio y devolvia 404 antes de
 * llegar al index.html, asi que /assets solo funcionaba navegando desde el menu
 * (con F5, URL pegada o link compartido se rompia).
 *
 * Corre como parte de `pnpm build`: si falla, no hay artefacto que desplegar.
 * Es el unico freno real, porque el deploy compila en el VPS y no pasa por CI.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Rutas /platform/* que comparten nombre con un prefijo proxeado a la API.
 * Solo cargan bien porque nginx y el proxy de Vite miran `Accept: text/html`
 * y devuelven el index.html en las navegaciones del navegador. Estan aca para
 * que una ruta NUEVA en la misma situacion falle el build en vez de repetir
 * el 404 en silencio.
 */
const OVERLAPS_CUBIERTOS_POR_ACCEPT_HTML = new Set([
  "/platform/tenants",
  "/platform/users",
  "/platform/access",
  "/platform/usage",
  "/platform/prompts",
  "/platform/user-activity",
  "/platform/copilot-questions",
]);

function rutasDeLaApp() {
  const src = readFileSync(join(WEB, "src/App.tsx"), "utf8");
  const rutas = new Set();
  for (const m of src.matchAll(/path="([^"]+)"/g)) {
    const p = m[1];
    if (p.startsWith("/")) rutas.add(p);
  }
  return [...rutas];
}

function pathsEstaticos() {
  // Todo lo de public/ se copia a la raiz de dist/ tal cual.
  const publicos = readdirSync(join(WEB, "public"));
  // La carpeta del build sale de vite.config.ts (default 'assets' si no se declara).
  const vite = readFileSync(join(WEB, "vite.config.ts"), "utf8");
  const assetsDir = vite.match(/assetsDir:\s*['"]([^'"]+)['"]/)?.[1] ?? "assets";
  return new Set([...publicos, assetsDir, "index.html"]);
}

function prefijosDeApi() {
  const vite = readFileSync(join(WEB, "vite.config.ts"), "utf8");
  const bloque = vite.slice(vite.indexOf("proxy:"));
  return [...bloque.matchAll(/'(\/[^']+)':\s*\{/g)].map(m => m[1]);
}

const rutas = rutasDeLaApp();
const estaticos = pathsEstaticos();
const apis = prefijosDeApi();
const errores = [];

for (const ruta of rutas) {
  const primerSegmento = ruta.split("/")[1];
  if (primerSegmento && estaticos.has(primerSegmento)) {
    errores.push(
      `  ${ruta}  choca con el archivo/carpeta estatico "${primerSegmento}" que dist/ publica en la raiz.\n` +
      `     nginx resuelve el path antes de llegar al index.html: la ruta va a dar 404 con F5 o URL pegada.`,
    );
  }
  const api = apis.find(p => ruta === p || ruta.startsWith(p + "/"));
  if (api && !OVERLAPS_CUBIERTOS_POR_ACCEPT_HTML.has(ruta)) {
    errores.push(
      `  ${ruta}  cae bajo el prefijo "${api}" que se proxea a la API.\n` +
      `     Una navegacion del navegador va a recibir JSON de la API en vez de la app.`,
    );
  }
}

if (errores.length > 0) {
  console.error(`\nB-01 — ${errores.length} colision(es) de ruta:\n`);
  console.error(errores.join("\n\n"));
  console.error(`\nArreglos posibles: renombrar la ruta de la app, renombrar el`);
  console.error(`path estatico (build.assetsDir), o cubrirla en nginx y el proxy`);
  console.error(`de Vite con la regla de Accept: text/html y anotarla arriba.\n`);
  process.exit(1);
}

console.log(`check-route-collisions: ${rutas.length} rutas verificadas, sin colisiones.`);
