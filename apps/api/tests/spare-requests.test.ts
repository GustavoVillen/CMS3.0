// Solicitudes de repuestos: alcance (empresa/buque), vínculo con el repuesto,
// reparto del stock disponible y transiciones de estado bajo concurrencia.
//
// Auditoría 2026-09-09: BUG-001, BUG-002, BUG-003 y CONC-001.
//
// ALCANCE DE ESTAS PRUEBAS — leer antes de sacar conclusiones:
// no tocan Postgres. Prueban las DECISIONES (a quién se le deja, cuánto se
// reserva, quién gana la carrera) con dobles en memoria. Que el patrón de
// reclamo funcione acá NO demuestra que el advisory lock ni el aislamiento
// transaccional de Postgres funcionen: eso pide una base y está anotado como
// pendiente en el informe.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  hasVesselAccess,
  checkSpareLink,
} from "../src/tenant/spare-requests/spare-request-scope";
import { planReservations } from "../src/tenant/spare-requests/stock-reservations-service";
import { fakeSession } from "./helpers/fakes";

// ─── BUG-003 · alcance por buque ─────────────────────────────────────────────

describe("alcance por buque de una solicitud (BUG-003)", () => {
  const admin   = fakeSession({ role: "TENANT_ADMIN", vessels: [] });
  const tecDCH  = fakeSession({ role: "TECHNICIAN_OPERATOR", vessels: ["DCH"] });
  const sinNada = fakeSession({ role: "TECHNICIAN_OPERATOR", vessels: [] });

  test("el admin de la empresa alcanza cualquier buque", () => {
    assert.equal(hasVesselAccess(admin, "DCH"), true);
    assert.equal(hasVesselAccess(admin, "LTE"), true);
  });

  test("cada uno alcanza su buque y NO el de al lado", () => {
    assert.equal(hasVesselAccess(tecDCH, "DCH"), true);
    assert.equal(hasVesselAccess(tecDCH, "LTE"), false, "otro buque de la misma empresa");
  });

  test("una solicitud general (sin buque) la ve toda la empresa", () => {
    // Regla que ya aplicaba listSpareRequests: requestedForVesselCode null es
    // una compra sin destino asignado todavía.
    assert.equal(hasVesselAccess(tecDCH, null), true);
    assert.equal(hasVesselAccess(sinNada, null), true);
  });

  test("sin buques asignados no alcanza ningún buque (fail-closed)", () => {
    assert.equal(hasVesselAccess(sinNada, "DCH"), false);
  });
});

// ─── BUG-001 · vínculo con el repuesto ───────────────────────────────────────

describe("vínculo ítem → repuesto (BUG-001)", () => {
  const tecDCH = fakeSession({ role: "TECHNICIAN_OPERATOR", vessels: ["DCH"] });
  const admin  = fakeSession({ role: "TENANT_ADMIN", vessels: [] });

  const solicitudDCH = { requestedForVesselCode: "DCH" };
  const solicitudGen = { requestedForVesselCode: null };

  test("el repuesto del mismo buque se enlaza", () => {
    assert.equal(checkSpareLink(tecDCH, solicitudDCH, { vesselCode: "DCH" }), null);
  });

  test("un repuesto de OTRA EMPRESA no existe para el que pregunta", () => {
    // La query lo busca filtrando por tenantId: si es de otra empresa vuelve
    // null y se contesta 404, sin revelar que el id existe.
    assert.equal(checkSpareLink(tecDCH, solicitudDCH, null), "NOT_FOUND");
  });

  test("un repuesto de otro buque que el usuario NO tiene se rechaza", () => {
    assert.equal(checkSpareLink(tecDCH, solicitudDCH, { vesselCode: "LTE" }), "OUT_OF_SCOPE");
  });

  test("aun teniendo los dos buques, no se mezcla el repuesto con la solicitud", () => {
    const tecDosBuques = fakeSession({ role: "TECHNICIAN_OPERATOR", vessels: ["DCH", "LTE"] });
    assert.equal(
      checkSpareLink(tecDosBuques, solicitudDCH, { vesselCode: "LTE" }),
      "OTHER_VESSEL",
      "la solicitud es del DCH: su repuesto tiene que ser del DCH",
    );
  });

  test("ni el admin de la empresa puede cruzar buques en una solicitud con buque", () => {
    assert.equal(checkSpareLink(admin, solicitudDCH, { vesselCode: "LTE" }), "OTHER_VESSEL");
  });

  test("una solicitud general acepta repuestos de los buques del usuario", () => {
    assert.equal(checkSpareLink(tecDCH, solicitudGen, { vesselCode: "DCH" }), null);
    assert.equal(checkSpareLink(tecDCH, solicitudGen, { vesselCode: "LTE" }), "OUT_OF_SCOPE");
  });
});

// ─── BUG-002 · sobre-reserva dentro de una misma solicitud ───────────────────

describe("reparto del stock disponible (BUG-002)", () => {
  /** El algoritmo ANTERIOR: la disponibilidad no bajaba al reservar. */
  function repartoViejo(items: { id: string; spareId: string; quantity: number }[], disp: Map<string, number>) {
    let total = 0;
    for (const it of items) {
      const libre = disp.get(it.spareId) ?? 0; // ← siempre la foto inicial
      if (libre <= 0) continue;
      total += Math.min(it.quantity, libre);
    }
    return total;
  }

  const dosLineas = [
    { id: "i1", spareId: "s1", quantity: 8 },
    { id: "i2", spareId: "s1", quantity: 8 },
  ];

  test("el caso de la auditoría: 10 en stock, dos líneas de 8", () => {
    const disp = new Map([["s1", 10]]);

    // Así estaba: las dos líneas veían 10 disponible y reservaban 8 cada una.
    assert.equal(repartoViejo(dosLineas, disp), 16, "el bug reproducido");

    const { allocations } = planReservations(dosLineas, disp);
    const reservado = allocations.reduce((n, a) => n + a.quantity, 0);
    assert.equal(reservado, 10, "no se puede reservar más de lo que hay");
    assert.deepEqual(allocations.map(a => a.quantity), [8, 2], "la primera línea completa, la segunda lo que quedó");
  });

  test("la línea que se queda sin saldo se saltea y se informa", () => {
    const { allocations, skipped } = planReservations(
      [
        { id: "i1", spareId: "s1", quantity: 10 },
        { id: "i2", spareId: "s1", quantity: 5 },
      ],
      new Map([["s1", 10]]),
    );
    assert.equal(allocations.length, 1);
    assert.equal(skipped, 1);
  });

  test("repuestos distintos no se pisan el saldo entre sí", () => {
    const { allocations } = planReservations(
      [
        { id: "i1", spareId: "s1", quantity: 4 },
        { id: "i2", spareId: "s2", quantity: 4 },
      ],
      new Map([["s1", 5], ["s2", 5]]),
    );
    assert.deepEqual(allocations.map(a => a.quantity), [4, 4]);
  });

  test("sin stock no se reserva nada", () => {
    const r = planReservations([{ id: "i1", spareId: "s1", quantity: 3 }], new Map([["s1", 0]]));
    assert.equal(r.allocations.length, 0);
    assert.equal(r.skipped, 1);
  });

  test("un repuesto ya sobre-reservado (disponible negativo) no reserva más", () => {
    // Puede existir por datos previos al arreglo: no se agrava.
    const r = planReservations([{ id: "i1", spareId: "s1", quantity: 3 }], new Map([["s1", -4]]));
    assert.equal(r.allocations.length, 0);
  });

  test("no modifica el mapa que recibe", () => {
    const disp = new Map([["s1", 10]]);
    planReservations(dosLineas, disp);
    assert.equal(disp.get("s1"), 10, "el llamador puede seguir usándolo");
  });

  test("tres líneas del mismo repuesto tampoco superan el saldo", () => {
    const r = planReservations(
      [
        { id: "i1", spareId: "s1", quantity: 5 },
        { id: "i2", spareId: "s1", quantity: 5 },
        { id: "i3", spareId: "s1", quantity: 5 },
      ],
      new Map([["s1", 7]]),
    );
    assert.equal(r.allocations.reduce((n, a) => n + a.quantity, 0), 7);
    assert.equal(r.skipped, 1);
  });
});

// ─── CONC-001 · el patrón de reclamo de estado ───────────────────────────────

/**
 * Fila con un estado que sólo puede transicionar una vez, con la misma
 * semántica que `updateMany({ where: { id, status: "ACTIVE" }, ... })` de
 * Prisma: devuelve cuántas filas cambió.
 *
 * OJO: esto prueba la FORMA del arreglo (quien pierde la carrera cuenta 0 y no
 * escribe), no el aislamiento de Postgres.
 */
class FilaConEstado {
  constructor(public status: string) {}

  /** Equivale al updateMany condicionado del servicio. */
  reclamar(desde: string, hasta: string): number {
    if (this.status !== desde) return 0;
    this.status = hasta;
    return 1;
  }
}

describe("reclamo atómico de la reserva (CONC-001)", () => {
  test("dos consumos simultáneos: uno solo registra el movimiento", async () => {
    const reserva = new FilaConEstado("ACTIVE");
    const movimientos: string[] = [];

    const consumir = async () => {
      const claimed = reserva.reclamar("ACTIVE", "CONSUMED");
      if (claimed === 0) return "rechazado";
      movimientos.push("ISSUE");
      return "ok";
    };

    const [a, b] = await Promise.all([consumir(), consumir()]);

    assert.equal(movimientos.length, 1, "un solo descuento de stock");
    assert.deepEqual([a, b].sort(), ["ok", "rechazado"]);
  });

  test("así estaba antes: los dos leían ACTIVE y los dos descontaban", () => {
    const reserva = { status: "ACTIVE" };
    const movimientos: string[] = [];

    // Lectura previa a la transacción, como en el código original.
    const leidaPorA = reserva.status === "ACTIVE";
    const leidaPorB = reserva.status === "ACTIVE";
    if (leidaPorA) { movimientos.push("ISSUE"); reserva.status = "CONSUMED"; }
    if (leidaPorB) { movimientos.push("ISSUE"); reserva.status = "CONSUMED"; }

    assert.equal(movimientos.length, 2, "el bug reproducido: doble descuento");
  });

  test("consumir y liberar a la vez: sólo una de las dos prospera", () => {
    const reserva = new FilaConEstado("ACTIVE");
    assert.equal(reserva.reclamar("ACTIVE", "CONSUMED"), 1);
    assert.equal(reserva.reclamar("ACTIVE", "RELEASED"), 0, "ya no está activa");
    assert.equal(reserva.status, "CONSUMED");
  });

  test("una reserva ya liberada no se puede consumir", () => {
    const reserva = new FilaConEstado("RELEASED");
    assert.equal(reserva.reclamar("ACTIVE", "CONSUMED"), 0);
  });
});

describe("reclamo atómico de la entrega del ítem (fulfillItem)", () => {
  test("dos entregas simultáneas: un solo movimiento de recepción", async () => {
    const item = new FilaConEstado("PENDING");
    const movimientos: string[] = [];

    const entregar = async () => {
      // where: { status: { not: "FULFILLED" } }
      if (item.status === "FULFILLED") return "rechazado";
      item.status = "FULFILLED";
      movimientos.push("RECEIPT");
      return "ok";
    };

    const [a, b] = await Promise.all([entregar(), entregar()]);
    assert.equal(movimientos.length, 1);
    assert.deepEqual([a, b].sort(), ["ok", "rechazado"]);
  });
});

describe("reclamo del ítem al reservar", () => {
  test("dos llamadas a crear reservas no reservan el mismo ítem dos veces", () => {
    const item = new FilaConEstado("PENDING");
    const reservas: number[] = [];

    for (const _ of [1, 2]) {
      const claimed = item.reclamar("PENDING", "RESERVED");
      if (claimed === 0) continue;
      reservas.push(5);
    }

    assert.equal(reservas.length, 1, "una sola reserva por ítem");
  });
});
