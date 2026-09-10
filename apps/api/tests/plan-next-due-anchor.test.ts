// El proximo vencimiento se cuenta desde la ULTIMA EJECUCION, no desde hoy.
//
// El bug real (sep 2026): el plan M02-BBA-HID-ER-30 "Recorrido general" de la
// Bomba Hidraulica Estribor decia ultima ejecucion 20/01/2026, cada 60 meses, y
// mostraba vencimiento 10/09/2031 — exactamente hoy + 60 meses. El plan estaba
// cargado sin vencimiento (las cargas masivas traen la ultima ejecucion pero no
// el proximo), y al guardarlo el calculo de respaldo lo anclaba en `new Date()`.
// Efecto: abrir un plan y guardarlo le regalaba al buque todo el tiempo corrido
// desde el ultimo trabajo — ocho meses en este caso.
//
// Esta prueba fija la invariante: con ultima ejecucion, manda la ultima
// ejecucion; sin ella, recien ahi se cuenta desde hoy.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { autoInitialNextDueDate } from "../src/tenant/maintenance-plans/maintenance-plans-service";

/** Fecha "solo dia" tal como la guarda el modulo: medianoche UTC. */
const soloDia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("autoInitialNextDueDate", () => {
  test("el caso real: 20/01/2026 + 60 meses vence en enero de 2031, no dentro de 5 anios", () => {
    const next = autoInitialNextDueDate("MONTHS", 60, soloDia("2026-01-20"));
    assert.equal(ymd(next), "2031-01-20");
  });

  test("no se corre un dia por la zona horaria del server", () => {
    // Anclado a mediodia UTC: ninguna zona real cruza el limite del dia.
    const next = autoInitialNextDueDate("MONTHS", 12, soloDia("2026-03-31"));
    assert.equal(next!.getUTCHours(), 12);
    assert.equal(ymd(next), "2027-03-31");
  });

  test("CALENDAR se comporta igual que MONTHS", () => {
    assert.equal(ymd(autoInitialNextDueDate("CALENDAR", 6, soloDia("2026-01-20"))), "2026-07-20");
  });

  test("los planes por dias y por semanas tambien anclan en la ultima ejecucion", () => {
    assert.equal(ymd(autoInitialNextDueDate("DAY", 15, soloDia("2026-01-20"))), "2026-02-04");
    assert.equal(ymd(autoInitialNextDueDate("WEEK", 1, soloDia("2026-01-20"))), "2026-01-27");
  });

  test("sin ultima ejecucion se cuenta desde hoy, que es lo unico que se sabe", () => {
    const next = autoInitialNextDueDate("MONTHS", 12, null)!;
    const esperado = new Date();
    esperado.setMonth(esperado.getMonth() + 12);
    assert.equal(ymd(next), ymd(esperado));
  });

  test("sin frecuencia no hay vencimiento que calcular", () => {
    assert.equal(autoInitialNextDueDate("MONTHS", null, soloDia("2026-01-20")), null);
    assert.equal(autoInitialNextDueDate("MONTHS", 0, soloDia("2026-01-20")), null);
  });

  test("los planes por horas no vencen por fecha", () => {
    assert.equal(autoInitialNextDueDate("HOURS", 60, soloDia("2026-01-20")), null);
    assert.equal(autoInitialNextDueDate("RUNNING_HOURS", 60, soloDia("2026-01-20")), null);
  });
});
