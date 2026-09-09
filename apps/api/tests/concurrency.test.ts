// Concurrencia: dos recepciones simultáneas no pueden quedarse con el mismo
// código de remito, y dos instancias no pueden mandar dos veces el parte
// semanal.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { withUniqueRetry, isPrismaUniqueViolation } from "../src/common/unique-retry";
import { hashToInt32, takeAdvisoryXactLock } from "../src/common/advisory-lock";
import { nextReceiptCode } from "../src/tenant/spares/goods-receipts-service";
import {
  claimWeeklyReportRun,
  WEEKLY_CLAIM_PENDING,
  WEEKLY_CLAIM_RETRY,
  WEEKLY_STALE_CLAIM_MS,
} from "../src/tenant/reports/weekly-report-claim";
import { FakeUniqueTable, uniqueViolation } from "./helpers/fakes";

// ─── Códigos de remito ───────────────────────────────────────────────────────

/** `tx` mínimo: sin SQL crudo, `nextReceiptCode` cae al conteo + attempt. */
function fakeTx(existing: string[]) {
  return {
    goodsReceipt: { count: async () => existing.length },
  };
}

describe("nextReceiptCode", () => {
  test("numera a partir de lo que ya hay", async () => {
    assert.equal(await nextReceiptCode(fakeTx([]), "t1", "DCH", 0), `RCP-DCH-${yy()}-0001`);
    assert.equal(await nextReceiptCode(fakeTx(["a", "b"]), "t1", "DCH", 0), `RCP-DCH-${yy()}-0003`);
  });

  test("cada reintento corre el secuencial: dos que compiten no repiten código", async () => {
    const tx = fakeTx(["a"]);
    const first = await nextReceiptCode(tx, "t1", "DCH", 0);
    const second = await nextReceiptCode(tx, "t1", "DCH", 1);
    assert.notEqual(first, second);
    assert.equal(second, `RCP-DCH-${yy()}-0003`);
  });

  test("el código lleva el buque: dos buques no comparten numeración", async () => {
    const a = await nextReceiptCode(fakeTx([]), "t1", "DCH", 0);
    const b = await nextReceiptCode(fakeTx([]), "t1", "LTE", 0);
    assert.notEqual(a, b);
  });

  test("usa el MAX del secuencial cuando hay SQL crudo, no el conteo", async () => {
    // Con remitos anulados o cargados con fecha vieja, COUNT < MAX y el código
    // salía repetido. Ahora se pide el máximo.
    const tx = {
      goodsReceipt: { count: async () => 2 },
      $queryRawUnsafe: async () => [{ max_seq: 47n }],
    };
    assert.equal(await nextReceiptCode(tx, "t1", "DCH", 0), `RCP-DCH-${yy()}-0048`);
  });

  test("si el motor no soporta advisory locks se sigue sin lock, no se rompe", async () => {
    const boom = { $queryRawUnsafe: async () => { throw new Error("no such function"); } };
    await takeAdvisoryXactLock(boom, "k"); // no tira
    await takeAdvisoryXactLock({}, "k");   // sin $queryRawUnsafe tampoco
  });

  test("la clave del advisory lock entra en un int32 con signo", () => {
    for (const key of ["goods-receipt|t1|DCH|2026", "", "x".repeat(500)]) {
      const n = hashToInt32(key);
      assert.ok(Number.isInteger(n));
      assert.ok(n >= -(2 ** 31) && n <= 2 ** 31 - 1, `${key} -> ${n}`);
    }
  });
});

describe("commit del remito bajo concurrencia (withUniqueRetry + transacción)", () => {
  test("dos recepciones a la vez: las dos terminan, con códigos distintos y sin stock duplicado", async () => {
    // Simula el índice único (tenantId, receiptCode) y una transacción que se
    // deshace entera si el create choca.
    const committed: { code: string; movements: number }[] = [];
    const taken = new Set<string>();

    const commit = () =>
      withUniqueRetry(async (attempt) => {
        // "transacción": nada se publica hasta el final.
        const code = await nextReceiptCode(fakeTx(Array(taken.size)), "t1", "DCH", attempt);
        if (taken.has(code)) throw uniqueViolation(); // rollback: no escribe nada
        taken.add(code);
        committed.push({ code, movements: 3 });
        return code;
      });

    // Arrancan con el mismo estado inicial, como dos requests simultáneos.
    const [a, b] = await Promise.all([commit(), commit()]);

    assert.notEqual(a, b, "no pueden compartir código");
    assert.equal(committed.length, 2, "los dos remitos entran");
    assert.equal(
      committed.reduce((n, r) => n + r.movements, 0),
      6,
      "el reintento no duplica movimientos de stock",
    );
  });

  test("un error que NO es de índice único no se reintenta: sube tal cual", async () => {
    let calls = 0;
    const err = await withUniqueRetry(async () => {
      calls += 1;
      throw new Error("la base se cayó");
    }).then(() => null, (e) => e as Error);

    assert.equal(calls, 1);
    assert.equal(err?.message, "la base se cayó");
    assert.equal(isPrismaUniqueViolation(err), false);
  });
});

// ─── Parte semanal ───────────────────────────────────────────────────────────

function reportStore() {
  const table = new FakeUniqueTable<any>(["tenantId", "reportKind", "periodKey"]);
  return { prisma: { scheduledReportRun: table as any }, table };
}

describe("claimWeeklyReportRun — un solo envío por semana", () => {
  const KIND = "WEEKLY_OPENING" as const;

  test("la reserva se crea ANTES de mandar, con la marca de pendiente", async () => {
    const { prisma, table } = reportStore();
    const claim = await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", ["a@b.c"]);

    assert.ok(claim);
    assert.equal(claim.retry, false);
    assert.equal(table.rows.length, 1);
    assert.equal(table.rows[0].error, WEEKLY_CLAIM_PENDING);
    assert.equal(table.rows[0].status, "FAILED", "fail-safe: si se cae el proceso, queda como no enviado");
  });

  test("dos instancias compitiendo: sólo una reserva, la otra no manda", async () => {
    const { prisma } = reportStore();
    const results = await Promise.all([
      claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", []),
      claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", []),
      claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", []),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
  });

  test("un parte ya enviado no se vuelve a mandar", async () => {
    const { prisma, table } = reportStore();
    await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", []);
    table.rows[0].status = "SENT";
    table.rows[0].error = null;

    assert.equal(await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", []), null);
  });

  test("semanas y tipos distintos son reservas distintas", async () => {
    const { prisma } = reportStore();
    assert.ok(await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", []));
    assert.ok(await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W38", []));
    assert.ok(await claimWeeklyReportRun(prisma, "t1", "WEEKLY_CLOSING", "2026-W37", []));
    assert.ok(await claimWeeklyReportRun(prisma, "t2", KIND, "2026-W37", []), "otra empresa, otra reserva");
  });

  test("una reserva recién tomada no se pisa (todavía se está mandando)", async () => {
    const { prisma } = reportStore();
    await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", []);
    assert.equal(await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", []), null);
  });

  test("una reserva colgada por una caída se reintenta UNA vez", async () => {
    const { prisma, table } = reportStore();
    const t0 = new Date("2026-09-07T07:00:00Z");
    await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", [], t0);
    table.rows[0].sentAt = t0;

    const later = new Date(t0.getTime() + WEEKLY_STALE_CLAIM_MS + 60_000);
    const retry = await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", [], later);
    assert.ok(retry, "se toma el reintento");
    assert.equal(retry.retry, true);
    assert.equal(table.rows[0].error, WEEKLY_CLAIM_RETRY);

    // Y no hay un tercer intento: se agotó.
    const evenLater = new Date(later.getTime() + WEEKLY_STALE_CLAIM_MS * 10);
    assert.equal(await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", [], evenLater), null);
  });

  test("con el reintento disponible, dos instancias siguen mandando una sola vez", async () => {
    const { prisma, table } = reportStore();
    const t0 = new Date("2026-09-07T07:00:00Z");
    await claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", [], t0);
    table.rows[0].sentAt = t0;

    const later = new Date(t0.getTime() + WEEKLY_STALE_CLAIM_MS + 60_000);
    const results = await Promise.all([
      claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", [], later),
      claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", [], later),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
  });

  test("un error que no es de índice único sube y no se traga", async () => {
    const prisma = {
      scheduledReportRun: {
        create: async () => { throw new Error("base caída"); },
        updateMany: async () => ({ count: 0 }),
        findUnique: async () => null,
      },
    } as any;
    await assert.rejects(
      () => claimWeeklyReportRun(prisma, "t1", KIND, "2026-W37", []),
      /base caída/,
    );
  });
});

function yy(): string {
  return String(new Date().getFullYear()).slice(-2);
}
