// B-02 — El copiloto no puede decir que no hay tareas vencidas cuando las hay.
//
// El bug real: `query_maintenance_plans` filtraba por la columna `status`, que
// esta congelada en ACTIVE. Medido sobre la base de mercurio: CERO planes de 38
// buques tenian status=OVERDUE mientras 235 estaban vencidos por fecha. La
// consulta devolvia vacio siempre y el modelo afirmaba "no existen tareas
// vencidas para el MAO 01" con la pantalla al lado marcando VENCIDA.
//
// Esta prueba fija la invariante: si un plan vencio, sale como vencido, sin
// importar lo que digan las columnas guardadas.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolvePlanDueStatus, executionStatusLabel } from "../src/tenant/copiloto/plan-due-status";

const ayer  = new Date(Date.now() - 86_400_000);
const enUnAnio = new Date(Date.now() + 365 * 86_400_000);

/** Plan vencido tal cual esta en la base: fecha pasada, columnas viejas. */
const planVencido = {
  taskCode: "M01-INSP-SEM", assetId: "a1", triggerType: "MONTHS",
  nextDueDate: ayer, nextDueHours: null,
  status: "ACTIVE", executionStatus: "FUTURE",   // ← lo que guarda la base
};

const planFuturo = {
  taskCode: "M01-FUT-01", assetId: "a1", triggerType: "MONTHS",
  nextDueDate: enUnAnio, nextDueHours: null,
  status: "ACTIVE", executionStatus: "FUTURE",
};

describe("B-02 — estado de vencimiento del copiloto", () => {
  test("un plan con fecha pasada sale OVERDUE aunque la columna diga FUTURE", () => {
    const [r] = resolvePlanDueStatus([planVencido], new Map());
    assert.equal(r.executionStatus, "OVERDUE");
  });

  test("filtrar por OVERDUE devuelve los vencidos, nunca cero", () => {
    const planes = [planVencido, planFuturo, { ...planVencido, taskCode: "M01-INSP-MEN" }];
    const vencidos = resolvePlanDueStatus(planes, new Map(), { filter: "OVERDUE" });

    // La regresion exacta: antes esto daba 0 y el copiloto respondia "no hay ninguna".
    assert.notEqual(vencidos.length, 0, "un buque con planes vencidos no puede devolver lista vacia");
    assert.equal(vencidos.length, 2);
    assert.deepEqual(vencidos.map(p => p.taskCode), ["M01-INSP-SEM", "M01-INSP-MEN"]);
  });

  test("los planes al dia no se cuelan entre los vencidos", () => {
    const soloFuturo = resolvePlanDueStatus([planFuturo], new Map(), { filter: "OVERDUE" });
    assert.equal(soloFuturo.length, 0);
  });

  test("un plan por horas se mide contra las horas del equipo, no contra cero", () => {
    const porHoras = {
      taskCode: "M01-MP-BR-500H", assetId: "motor-br", triggerType: "HOURS",
      nextDueDate: null, nextDueHours: 12_000, status: "ACTIVE", executionStatus: "FUTURE",
    };
    // Sin el mapa de horas el plan se evaluaria contra 0 y saldria vencido.
    const conHoras = resolvePlanDueStatus([porHoras], new Map([["motor-br", 9_000]]));
    assert.equal(conHoras[0].executionStatus, "FUTURE");

    const pasado = resolvePlanDueStatus([porHoras], new Map([["motor-br", 12_500]]));
    assert.equal(pasado[0].executionStatus, "OVERDUE");
  });

  test("el estado viaja traducido: el modelo no recibe el enum crudo solo", () => {
    const [es] = resolvePlanDueStatus([planVencido], new Map(), { locale: "es" });
    assert.equal(es.executionStatusLabel, "Vencida");

    const [en] = resolvePlanDueStatus([planVencido], new Map(), { locale: "en" });
    assert.equal(en.executionStatusLabel, "Overdue");

    const [pt] = resolvePlanDueStatus([planVencido], new Map(), { locale: "pt-BR" });
    assert.equal(pt.executionStatusLabel, "Vencida");

    // Ningun label puede ser el codigo crudo en SCREAMING_SNAKE_CASE (A-01).
    for (const code of ["OVERDUE", "DUE", "IN_WINDOW", "UPCOMING", "FUTURE", "COMPLETED"]) {
      for (const loc of ["es", "en", "pt"]) {
        assert.doesNotMatch(executionStatusLabel(code, loc), /^[A-Z_]+$/, `${code} sin traducir en ${loc}`);
      }
    }
  });
});
