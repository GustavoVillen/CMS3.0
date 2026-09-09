// Existencias: la suma agregada en base tiene que dar EXACTAMENTE lo mismo que
// la suma fila por fila que se hacía antes (PERF-001).
//
// Esta es la prueba que respalda el cambio de rendimiento: no mide velocidad,
// verifica que no cambió ningún resultado. La velocidad no se midió — está
// declarado como pendiente en el informe.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  bucketContribution,
  getOnHandMap,
  getOnHandQty,
  getAvailableQty,
  type StockCalcClient,
} from "../src/tenant/pms/stock-calc-service";

type Mov = { spareId: string; movementType: string; quantity: number };

/** El cálculo ANTERIOR, fila por fila, copiado tal cual para comparar. */
function signedQtyViejo(movementType: string, quantity: number): number {
  switch (movementType) {
    case "RECEIPT": case "TRANSFER_IN": case "RETURN_IN": case "ADJUSTMENT_PLUS":
      return Math.abs(quantity);
    case "ISSUE": case "TRANSFER_OUT": case "TRANSFER": case "ADJUSTMENT_MINUS":
      return -Math.abs(quantity);
    case "ADJUSTMENT":
      return quantity;
    default:
      return 0;
  }
}
function onHandViejo(movs: Mov[], spareId: string): number {
  return movs.filter(m => m.spareId === spareId)
             .reduce((s, m) => s + signedQtyViejo(m.movementType, m.quantity), 0);
}

/** Cliente SIN SQL crudo: fuerza el camino de agrupado en memoria. */
function clienteSinSql(movs: Mov[]): StockCalcClient {
  return {
    stockMovement: {
      findMany: async (args: unknown) => {
        const where = (args as { where: { spareId: { in: string[] } } }).where;
        return movs.filter(m => where.spareId.in.includes(m.spareId));
      },
    },
  };
}

/**
 * Cliente CON SQL crudo: emula lo que devuelve Postgres para el GROUP BY,
 * incluyendo que los agregados pueden volver como texto.
 */
function clienteConSql(movs: Mov[]): StockCalcClient {
  return {
    stockMovement: { findMany: async () => { throw new Error("no debería usarse"); } },
    $queryRawUnsafe: async (_q: string, ...params: unknown[]) => {
      const ids = params[0] as string[];
      const groups = new Map<string, { spareId: string; movementType: string; raw: number; abs: number }>();
      for (const m of movs) {
        if (!ids.includes(m.spareId)) continue;
        const k = `${m.spareId}|${m.movementType}`;
        const g = groups.get(k) ?? { spareId: m.spareId, movementType: m.movementType, raw: 0, abs: 0 };
        g.raw += m.quantity;
        g.abs += Math.abs(m.quantity);
        groups.set(k, g);
      }
      return [...groups.values()].map(g => ({
        spareId: g.spareId,
        movementType: g.movementType,
        rawSum: String(g.raw),   // ← como los devuelve el driver en el peor caso
        absSum: String(g.abs),
      }));
    },
  };
}

describe("aporte de cada grupo (repuesto, tipo)", () => {
  test("las entradas suman y las salidas restan", () => {
    assert.equal(bucketContribution("RECEIPT", 10, 10), 10);
    assert.equal(bucketContribution("RETURN_IN", 3, 3), 3);
    assert.equal(bucketContribution("ISSUE", 4, 4), -4);
    assert.equal(bucketContribution("TRANSFER_OUT", 2, 2), -2);
  });

  test("ADJUSTMENT conserva el signo guardado, no el absoluto", () => {
    // Dos ajustes: +5 y -8. Suma cruda -3, suma de absolutos 13.
    assert.equal(bucketContribution("ADJUSTMENT", -3, 13), -3);
  });

  test("una entrada cargada con signo invertido sigue sumando, como antes", () => {
    // Es el caso que rompía si se sumaba primero y se aplicaba el signo después:
    // RECEIPT de -5 y de +10 → antes daba 15 (abs de cada uno), no 5.
    assert.equal(bucketContribution("RECEIPT", 5, 15), 15);
  });

  test("un tipo desconocido no mueve el stock", () => {
    assert.equal(bucketContribution("LO_QUE_SEA", 99, 99), 0);
  });
});

describe("mismo resultado que el cálculo anterior", () => {
  const movimientos: Mov[] = [
    { spareId: "s1", movementType: "RECEIPT",         quantity: 100 },
    { spareId: "s1", movementType: "RECEIPT",         quantity: -20 },  // signo invertido
    { spareId: "s1", movementType: "ISSUE",           quantity: 30 },
    { spareId: "s1", movementType: "ISSUE",           quantity: -5 },
    { spareId: "s1", movementType: "ADJUSTMENT",      quantity: -7 },
    { spareId: "s1", movementType: "ADJUSTMENT",      quantity: 3 },
    { spareId: "s1", movementType: "ADJUSTMENT_PLUS", quantity: 10 },
    { spareId: "s1", movementType: "ADJUSTMENT_MINUS",quantity: 4 },
    { spareId: "s1", movementType: "TRANSFER_IN",     quantity: 8 },
    { spareId: "s1", movementType: "TRANSFER_OUT",    quantity: 6 },
    { spareId: "s1", movementType: "TRANSFER",        quantity: 2 },
    { spareId: "s1", movementType: "RETURN_IN",       quantity: 9 },
    { spareId: "s1", movementType: "FUTURO_TIPO",     quantity: 50 },
    { spareId: "s2", movementType: "RECEIPT",         quantity: 40 },
    { spareId: "s2", movementType: "ISSUE",           quantity: 40 },
    { spareId: "s3", movementType: "ADJUSTMENT",      quantity: -12 },
  ];

  test("por SQL agregado da lo mismo que fila por fila", async () => {
    const map = await getOnHandMap(clienteConSql(movimientos), ["s1", "s2", "s3"]);
    for (const id of ["s1", "s2", "s3"]) {
      assert.equal(map.get(id), onHandViejo(movimientos, id), `repuesto ${id}`);
    }
  });

  test("y agrupando en memoria también (dobles de prueba, motor sin SQL crudo)", async () => {
    const map = await getOnHandMap(clienteSinSql(movimientos), ["s1", "s2", "s3"]);
    for (const id of ["s1", "s2", "s3"]) {
      assert.equal(map.get(id), onHandViejo(movimientos, id), `repuesto ${id}`);
    }
  });

  test("los dos caminos coinciden entre sí sobre datos generados", async () => {
    // Generador determinístico: la prueba no puede fallar distinto cada vez.
    const tipos = ["RECEIPT", "ISSUE", "ADJUSTMENT", "ADJUSTMENT_PLUS", "ADJUSTMENT_MINUS",
                   "TRANSFER_IN", "TRANSFER_OUT", "TRANSFER", "RETURN_IN", "RARO"];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

    const generados: Mov[] = [];
    for (let i = 0; i < 500; i++) {
      generados.push({
        spareId: `s${1 + Math.floor(rnd() * 5)}`,
        movementType: tipos[Math.floor(rnd() * tipos.length)]!,
        quantity: Math.round((rnd() * 200 - 100) * 100) / 100,  // puede ser negativo
      });
    }
    const ids = ["s1", "s2", "s3", "s4", "s5"];

    const porSql   = await getOnHandMap(clienteConSql(generados), ids);
    const enMemoria = await getOnHandMap(clienteSinSql(generados), ids);

    for (const id of ids) {
      const esperado = onHandViejo(generados, id);
      // Tolerancia de coma flotante: sumar en otro orden puede correr el último bit.
      assert.ok(Math.abs((porSql.get(id) ?? 0) - esperado) < 1e-9, `SQL ${id}`);
      assert.ok(Math.abs((enMemoria.get(id) ?? 0) - esperado) < 1e-9, `memoria ${id}`);
    }
  });

  test("un repuesto sin movimientos no aparece en el mapa", async () => {
    const map = await getOnHandMap(clienteConSql(movimientos), ["s1", "sin-nada"]);
    assert.equal(map.get("sin-nada"), undefined);
    assert.equal(map.get("sin-nada") ?? 0, 0, "el llamador lo lee como 0");
  });

  test("lista vacía: no consulta nada", async () => {
    const cliente = { stockMovement: { findMany: async () => { throw new Error("no consultar"); } } };
    assert.equal((await getOnHandMap(cliente as StockCalcClient, [])).size, 0);
  });
});

describe("existencias de un repuesto suelto", () => {
  const movs: Mov[] = [
    { spareId: "s1", movementType: "RECEIPT", quantity: 10 },
    { spareId: "s1", movementType: "ISSUE",   quantity: 4 },
  ];

  test("getOnHandQty coincide con el mapa", async () => {
    assert.equal(await getOnHandQty(clienteConSql(movs), "s1"), 6);
    assert.equal(await getOnHandQty(clienteSinSql(movs), "s1"), 6);
  });

  test("disponible = existencias − reservado", () => {
    assert.equal(getAvailableQty(10, 3), 7);
    assert.equal(getAvailableQty(10), 10);
    assert.equal(getAvailableQty(2, 5), -3, "se puede quedar en negativo y se ve");
  });
});
