// Archivos estáticos: contención dentro del directorio público (IO-001).
//
// El cambio de readFileSync a stream tocó la resolución de rutas, así que se
// verifica que ninguna ruta pueda salirse de la carpeta que se sirve.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sep } from "node:path";

import { __test } from "../src/http/static-files";

const { safeJoin, WEB_MODERN_DIST } = __test;

describe("contención dentro del directorio público", () => {
  test("un archivo normal resuelve adentro", () => {
    const p = safeJoin(WEB_MODERN_DIST, "assets/index-abc123.js");
    assert.ok(p);
    assert.ok(p!.startsWith(WEB_MODERN_DIST + sep));
  });

  test("subir de directorio no sale de la carpeta", () => {
    for (const intento of [
      "../../../etc/passwd",
      "assets/../../../../.env",
      "..\\..\\..\\windows\\win.ini",
      "assets/../../package.json",
    ]) {
      assert.equal(safeJoin(WEB_MODERN_DIST, intento), null, intento);
    }
  });

  test("una ruta absoluta no reemplaza la raíz: se busca ADENTRO", () => {
    // La barra inicial se saca antes de resolver, así que "/etc/passwd" se
    // busca como "<dist>/etc/passwd" (que no existe) y nunca como el
    // "/etc/passwd" del sistema. Es lo mismo que hace el llamador real, que
    // pasa `url.pathname.slice(1)`.
    for (const intento of ["/etc/passwd", "//etc/passwd", "\\\\servidor\\share"]) {
      const p = safeJoin(WEB_MODERN_DIST, intento);
      assert.ok(p, intento);
      assert.ok(p!.startsWith(WEB_MODERN_DIST + sep), `${intento} -> ${p}`);
    }
  });

  test("una ruta vacía no sirve el directorio", () => {
    assert.equal(safeJoin(WEB_MODERN_DIST, ""), null);
    assert.equal(safeJoin(WEB_MODERN_DIST, "/"), null);
  });

  test("un byte nulo se rechaza", () => {
    assert.equal(safeJoin(WEB_MODERN_DIST, "assets/x.js\0.png"), null);
  });

  test("un nombre que sólo EMPIEZA igual que la raíz no cuenta como adentro", () => {
    // dist-secreto no está dentro de dist: la comprobación usa el separador.
    const p = safeJoin(WEB_MODERN_DIST, "../dist-secreto/x.js");
    assert.equal(p, null);
  });

  test("los .. que ya normalizó el parser de URL llegan resueltos", () => {
    // Node normaliza el pathname antes de que lleguemos acá; esto documenta
    // que la defensa no depende de eso.
    const url = new URL("/assets/../../../etc/passwd", "http://x");
    assert.equal(url.pathname, "/etc/passwd", "el parser ya lo resolvió");
    // Y aun así, ese pathname no existe dentro de dist:
    const p = safeJoin(WEB_MODERN_DIST, url.pathname.slice(1));
    assert.ok(p === null || p.startsWith(WEB_MODERN_DIST + sep));
  });
});
