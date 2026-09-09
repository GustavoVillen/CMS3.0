// Un header `Host` malformado no puede voltear la API.
//
// AUDITORÍA 2026-09-09: `getRequestUrl` corría en `server.ts` ANTES del
// try/catch, dentro de un callback async. `new URL(path, "http://" + host)`
// tira ERR_INVALID_URL con cualquier Host raro, y ese rejection sin manejar
// baja el proceso de Node.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";

import { parseRequestUrl, getRequestUrl } from "../src/http/request-url";

function req(host: unknown, url = "/app/work-orders?x=1"): IncomingMessage {
  return { headers: { host }, url } as unknown as IncomingMessage;
}

// Todos estos hacen tirar a `new URL`. El parser HTTP de Node los deja pasar
// porque un valor de header puede tener espacios y casi cualquier byte.
const HOSTS_ROTOS = ["a b", "foo:bar:baz", "[oops", "%%", "a_b:99999999", "ho\u0001st"];

describe("parseRequestUrl", () => {
  test("devuelve null en vez de tirar con un Host inválido", () => {
    for (const host of HOSTS_ROTOS) {
      assert.equal(parseRequestUrl(req(host)), null, `Host ${JSON.stringify(host)}`);
    }
  });

  test("un Host normal parsea bien y conserva path y query", () => {
    const url = parseRequestUrl(req("localhost:3106"));
    assert.ok(url);
    assert.equal(url.pathname, "/app/work-orders");
    assert.equal(url.searchParams.get("x"), "1");
  });

  test("sin header Host (ausente o vacio) cae a localhost y sigue andando", () => {
    for (const host of [undefined, "", null]) {
      const url = parseRequestUrl(req(host));
      assert.ok(url, `Host ${JSON.stringify(host)}`);
      assert.equal(url.pathname, "/app/work-orders");
    }
  });
});

describe("getRequestUrl", () => {
  test("nunca tira: con Host roto cae a localhost y conserva el path", () => {
    for (const host of HOSTS_ROTOS) {
      const url = getRequestUrl(req(host, "/public/bootstrap"));
      assert.equal(url.pathname, "/public/bootstrap", `Host ${JSON.stringify(host)}`);
    }
  });

  test("tampoco tira con una request sin url", () => {
    const url = getRequestUrl({ headers: { host: "a b" }, url: undefined } as unknown as IncomingMessage);
    assert.equal(url.pathname, "/");
  });
});
