// El caso que motivó el helper: la tripulación escribe sin acentos y el dato
// los tiene (o al revés, porque alguien cargó el equipo sin tilde).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normText, textMatches } from "../src/lib/text-search";

test("encuentra con acento escribiendo sin acento", () => {
  assert.equal(textMatches("Línea de eje Babor", "linea"), true);
  assert.equal(textMatches("Motor Auxiliar Estribor", "auxiliar"), true);
});

test("y al revés: el dato sin acento se encuentra escribiendo con acento", () => {
  assert.equal(textMatches("Linea de eje Babor", "línea"), true);
});

test("la ñ se compara como n, igual que unaccent en Postgres", () => {
  assert.equal(textMatches("Cañería de descarga", "caneria"), true);
  assert.equal(textMatches("Piñón de ataque", "pinon"), true);
});

test("ignora mayúsculas", () => {
  assert.equal(textMatches("CAJA REDUCTORA", "caja"), true);
  assert.equal(textMatches("caja reductora", "CAJA"), true);
});

test("sin búsqueda entran todos; sin dato no entra ninguno", () => {
  assert.equal(textMatches("lo que sea", ""), true);
  assert.equal(textMatches("lo que sea", null), true);
  assert.equal(textMatches(null, "linea"), false);
  assert.equal(textMatches(undefined, "linea"), false);
});

test("sigue siendo una búsqueda: lo que no está, no aparece", () => {
  assert.equal(textMatches("Línea de eje Babor", "estribor"), false);
});

test("normText no rompe números ni códigos", () => {
  assert.equal(normText("M02-MA-ER-06"), "m02-ma-er-06");
  assert.equal(textMatches("M02-MA-ER-06", "ma-er"), true);
});
