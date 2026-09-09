// Cache de useFetch: aislamiento entre sesiones y expulsión de entradas.
//
// Auditoría 2026-09-09 — BUG-005 (una respuesta en vuelo repoblaba el cache
// después del logout) y MEM-001 (el cache no expulsaba nunca).
//
// ALCANCE: prueba el módulo de cache, que es lógica pura sobre un Map. NO
// prueba React ni el hook `useFetch` (este workspace no tiene runner de
// componentes); el uso correcto desde el hook está verificado por lectura.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// localStorage falso: el módulo lo usa para armar la key (usuario + empresa).
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
};

const {
  fetchCache, cacheGet, cacheSet, clearFetchCache, fetchCacheKey,
  getSessionGeneration, FETCH_CACHE_MAX_ENTRIES, FETCH_CACHE_TTL_MS,
} = await import("../src/lib/fetch-cache");

function entrar(userId: string, slug = "mercurio") {
  store.set("gpms_auth", JSON.stringify({ user: { id: userId }, token: `tok-${userId}` }));
  store.set("gpms_tenant_slug", slug);
}
function salir() {
  store.clear();
  clearFetchCache();
}

beforeEach(() => { store.clear(); clearFetchCache(); });

// ─── BUG-005 ─────────────────────────────────────────────────────────────────

describe("aislamiento entre sesiones (BUG-005)", () => {
  test("una respuesta que llega DESPUÉS del logout no se guarda", () => {
    entrar("ana");
    const key = fetchCacheKey("/app/pms/work-orders");

    // La request salió con la sesión de Ana.
    const generation = getSessionGeneration();

    // Ana cierra sesión mientras la respuesta viaja.
    salir();

    // Ahora aterriza la respuesta vieja.
    const guardado = cacheSet(key, { items: ["OT secreta"] }, generation);

    assert.equal(guardado, false, "no se guarda");
    assert.equal(fetchCache.size, 0, "el cache sigue vacío");
  });

  test("entra otra persona de la MISMA empresa y no ve lo de la anterior", () => {
    entrar("ana");
    const keyAna = fetchCacheKey("/app/pms/work-orders");
    cacheSet(keyAna, { items: ["OT de Ana"] }, getSessionGeneration());
    assert.ok(cacheGet(keyAna));

    salir();
    entrar("beto");
    const keyBeto = fetchCacheKey("/app/pms/work-orders");

    assert.notEqual(keyBeto, keyAna, "la key distingue al usuario, no sólo la empresa");
    assert.equal(cacheGet(keyBeto), undefined, "Beto arranca sin datos de Ana");
  });

  test("la respuesta de la sesión vigente sí se guarda", () => {
    entrar("ana");
    const key = fetchCacheKey("/app/pms/spares");
    assert.equal(cacheSet(key, { items: [] }, getSessionGeneration()), true);
    assert.ok(cacheGet(key));
  });

  test("la generación sube en cada corte de sesión", () => {
    const g0 = getSessionGeneration();
    clearFetchCache();
    const g1 = getSessionGeneration();
    clearFetchCache();
    assert.ok(g1 > g0);
    assert.ok(getSessionGeneration() > g1);
  });

  test("renovar el token no invalida el cache (la key mira el id, no el token)", () => {
    entrar("ana");
    const antes = fetchCacheKey("/app/pms/spares");
    cacheSet(antes, { items: ["x"] }, getSessionGeneration());

    // Refresh: cambia `gpms_auth` pero es la misma persona.
    store.set("gpms_auth", JSON.stringify({ user: { id: "ana" }, token: "tok-nuevo" }));

    assert.equal(fetchCacheKey("/app/pms/spares"), antes);
    assert.ok(cacheGet(antes), "lo cacheado sigue sirviendo");
  });

  test("la misma persona en otra empresa tiene otra key", () => {
    entrar("ana", "mercurio");
    const a = fetchCacheKey("/app/pms/spares");
    entrar("ana", "otra-naviera");
    assert.notEqual(fetchCacheKey("/app/pms/spares"), a);
  });
});

// ─── MEM-001 ─────────────────────────────────────────────────────────────────

describe("expulsión de entradas (MEM-001)", () => {
  test("el cache no pasa del tope de entradas", () => {
    entrar("ana");
    const gen = getSessionGeneration();
    for (let i = 0; i < FETCH_CACHE_MAX_ENTRIES + 50; i++) {
      cacheSet(fetchCacheKey(`/app/pms/work-orders/${i}`), { id: i }, gen);
    }
    assert.equal(fetchCache.size, FETCH_CACHE_MAX_ENTRIES);
  });

  test("expulsa lo menos usado, no lo último guardado", () => {
    entrar("ana");
    const gen = getSessionGeneration();
    const primera = fetchCacheKey("/app/pms/work-orders/0");
    cacheSet(primera, { id: 0 }, gen);

    // Se sigue usando la primera: cada lectura la manda al final de la cola.
    for (let i = 1; i < FETCH_CACHE_MAX_ENTRIES; i++) {
      cacheSet(fetchCacheKey(`/app/pms/work-orders/${i}`), { id: i }, gen);
      cacheGet(primera);
    }
    // Una más: tiene que caer la que hace más tiempo que no se toca (la #1).
    cacheSet(fetchCacheKey("/app/pms/work-orders/999"), { id: 999 }, gen);

    assert.ok(cacheGet(primera), "la que se sigue usando sobrevive");
    assert.equal(cacheGet(fetchCacheKey("/app/pms/work-orders/1")), undefined);
    assert.equal(fetchCache.size, FETCH_CACHE_MAX_ENTRIES);
  });

  test("una entrada vencida no se sirve y deja de ocupar lugar", () => {
    entrar("ana");
    const key = fetchCacheKey("/app/pms/spares");
    cacheSet(key, { items: ["viejo"] }, getSessionGeneration());

    // Se la envejece a mano por encima del TTL duro.
    fetchCache.get(key)!.ts = Date.now() - FETCH_CACHE_TTL_MS - 1;

    assert.equal(cacheGet(key), undefined);
    assert.equal(fetchCache.size, 0);
  });

  test("el logout vacía todo", () => {
    entrar("ana");
    const gen = getSessionGeneration();
    for (let i = 0; i < 10; i++) cacheSet(fetchCacheKey(`/x/${i}`), i, gen);
    assert.equal(fetchCache.size, 10);

    salir();
    assert.equal(fetchCache.size, 0);
  });
});

// ─── Casos borde de la key ───────────────────────────────────────────────────

describe("key del cache", () => {
  test("sin sesión la identidad es anónima y no choca con la de nadie", () => {
    const anon = fetchCacheKey("/app/vessels");
    entrar("ana");
    assert.notEqual(fetchCacheKey("/app/vessels"), anon);
  });

  test("un gpms_auth roto no rompe el cache", () => {
    store.set("gpms_auth", "{no es json");
    store.set("gpms_tenant_slug", "mercurio");
    assert.ok(fetchCacheKey("/app/vessels").length > 0);
  });
});
