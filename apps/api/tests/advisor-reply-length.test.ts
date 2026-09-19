// Asesor técnico (Preview V4): la respuesta del asesor se recorta por oraciones
// completas para que la conversación no alargue la pantalla.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { shortenToSentences } from "../src/tenant/maintenance-advisor/maintenance-advisor-service";

describe("shortenToSentences", () => {
  test("texto corto: queda igual", () => {
    assert.equal(shortenToSentences("Sí, se puede en remoto.", 40), "Sí, se puede en remoto.");
  });

  test("corta en la última oración completa que entra", () => {
    const text = "Primera oración con cinco palabras. Segunda oración también con seis palabras. Tercera que ya no entra.";
    assert.equal(shortenToSentences(text, 11), "Primera oración con cinco palabras. Segunda oración también con seis palabras.");
  });

  test("siempre deja al menos la primera oración aunque sea larga", () => {
    const text = "Una oración muy larga que supera el límite de palabras pedido. Otra.";
    assert.equal(shortenToSentences(text, 3), "Una oración muy larga que supera el límite de palabras pedido.");
  });

  test("texto sin punto final no se pierde", () => {
    assert.equal(shortenToSentences("Sin punto final", 40), "Sin punto final");
  });
});
