/**
 * Limpieza de registros duplicados de MAO 01 (M01) + tres correcciones puntuales.
 *
 * ORIGEN DEL PROBLEMA: el plan de M01 se cargó en tandas superpuestas. La del
 * 2026-06-21 es la que tiene el historial de OT; la del 2026-08-01/02 volvió a
 * leer la MISMA planilla de papel encima. La mayor parte de esa superposición YA
 * se resolvió por borrado lógico (hoy quedan 71 equipos y 195 planes vivos, no
 * 85/331 — los que sobran ya están con deletedAt). Sobrevivieron dos pares sobre
 * el Motor de Lancha. Las planillas de papel están limpias: el duplicado es del
 * sistema.
 *
 * OJO CON EL DISEÑO VIGENTE: desde la tanda del 2026-08-01 el buque dejó de tener
 * un plan semanal por equipo y pasó a checklists consolidados —
 * M01-6-001 (semanal de máquinas), M01-6-002 (mensual de máquinas) y
 * M01-8-001 (toma de aislación anual de todos los equipos eléctricos). No es
 * duplicación: es la forma en que hoy se opera. Por eso las correcciones del
 * paso 2 se aplican SOBRE esos checklists y no creando planes sueltos.
 *
 * REGLAS INNEGOCIABLES:
 *   1. Nada que tenga historial (OT directa o vinculada, parte de trabajo o
 *      certificado) se da de baja. El script ABORTA si la clasificación lo propone.
 *   2. El borrado es LOGICO (deletedAt + deletedByUserId), igual que
 *      scripts/soft-delete-vessel-plans.ts. Todo es reversible.
 *   3. Entre dos planes equivalentes sobrevive el que tiene historial; si ninguno
 *      lo tiene, sobrevive el más antiguo y hereda la última ejecución más nueva.
 *
 * QUE HACE, EN ORDEN:
 *   1a. Fusiona los 4 equipos cargados dos veces (repunta el historial y da de baja el sobrante).
 *   1b. Clasifica los planes de la tanda de agosto en Grupo A (duplicado confirmado,
 *       se da de baja) y Grupo B (aporta algo, SOLO se informa).
 *   1c. Resuelve los planes con sufijo -ARCH que hayan quedado ACTIVOS.
 *   2.  Dos correcciones que salen de la planilla de agosto:
 *       - el criterio de "mínimo 6 horas de encendido" de la iluminación de
 *         emergencia, hoy ausente, va al checklist semanal M01-6-001;
 *       - la Bomba de Trasvase de Combustible falta en la tabla de equipos del
 *         checklist anual de aislación M01-8-001; se agrega la fila.
 *
 * Idempotente: re-correrlo no cambia nada.
 *
 * Uso:
 *   export DATABASE_URL="postgresql://..."
 *   DRY=1 npx tsx scripts/cleanup-m01-duplicados.ts     # previsualiza, no toca nada
 *   npx tsx scripts/cleanup-m01-duplicados.ts           # aplica
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const SLUG = process.env.TENANT_SLUG ?? "mercurio";
const VESSEL = process.env.VESSEL ?? "M01";
const DRY = process.env.DRY === "1";

/** Tanda que reintrodujo la planilla ya cargada. Todo plan creado en esta ventana es candidato. */
const RELOAD_FROM = new Date("2026-08-01T00:00:00.000Z");
const RELOAD_TO = new Date("2026-08-03T00:00:00.000Z");

/**
 * Pares que la comparación automática NO agarra porque el título está redactado
 * distinto, pero que son la MISMA tarea sobre el MISMO equipo y con la MISMA
 * frecuencia. Revisados uno por uno contra la planilla de agosto. `baja` es de la
 * tanda del 2026-08-01 y no tiene historial; `queda` es el original de junio.
 */
const PARES_CONFIRMADOS: { baja: string; queda: string }[] = [
  { baja: "M01-3-002", queda: "M01-MOTOR-LANCHA-05" }, // "CAMBIO de Bateria" == "Batería: cambio" (Motor de Lancha, 18 meses)
];

/** Equipos cargados dos veces: se da de baja `from`, sobrevive `to`. */
const ASSET_MERGES: { from: string; to: string; motivo: string }[] = [
  { from: "M01-ECO-BR", to: "M01-4-EB-001", motivo: "sin nada colgando; el que queda tiene el plan anual y está marcado crítico" },
  { from: "M01-ECO-ER", to: "M01-4-EE-001", motivo: "sin nada colgando; el que queda tiene el plan anual" },
  { from: "M01-AJUSTES", to: "M01-8-CD-001", motivo: "su único plan no tiene historial y su fecha es de enero; el que queda tiene los 2 planes al día" },
  { from: "M01-AIS", to: "M01-4-AI-001", motivo: "el que queda tiene el plan y el certificado; se le repunta el historial del otro" },
];

// ── helpers ─────────────────────────────────────────────────────────────────────
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "-");

/** Firma de frecuencia: dos planes sólo son comparables si disparan igual. */
const freqKey = (p: any) => `${p.triggerType}|${p.frequencyMonths ?? ""}|${p.frequencyHours ?? ""}`;

type Uso = { ot: number; otVinculada: number; partes: number; certificados: number; total: number };

async function usoDelPlan(planId: string): Promise<Uso> {
  const [ot, otVinculada, partes, certificados] = await Promise.all([
    prisma.workOrder.count({ where: { maintenancePlanId: planId } }),
    prisma.workOrderMaintenancePlan.count({ where: { maintenancePlanId: planId } }),
    prisma.workLog.count({ where: { maintenancePlanId: planId } }),
    prisma.certificate.count({ where: { maintenancePlanId: planId } }),
  ]);
  return { ot, otVinculada, partes, certificados, total: ot + otVinculada + partes + certificados };
}

const usoTxt = (u: Uso) =>
  u.total === 0 ? "sin historial" : `OT=${u.ot} OT-vinc=${u.otVinculada} partes=${u.partes} cert=${u.certificados}`;

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.");

  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado.`);
  const tid: string = tenant.id;

  const member = await prisma.tenantMembership.findFirst({
    where: { tenantId: tid, role: "TENANT_ADMIN" },
    select: { userId: true },
  });
  const uid: string | undefined = member?.userId;
  if (!uid) throw new Error(`No hay TENANT_ADMIN en '${SLUG}'.`);

  console.log(`${DRY ? "== DRY-RUN (no se toca nada) ==" : "== APLICANDO =="}  tenant=${SLUG} buque=${VESSEL}\n`);

  const assets = await prisma.asset.findMany({
    where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null },
    orderBy: { assetCode: "asc" },
  });
  const plans = await prisma.maintenancePlan.findMany({
    where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null },
    orderBy: { taskCode: "asc" },
  });
  const otTotales = await prisma.workOrder.count({ where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null } });
  console.log(`ANTES: ${assets.length} equipos vivos · ${plans.length} planes vivos · ${otTotales} OT\n`);

  const nombreAsset = new Map<string, string>(assets.map((a: any) => [a.id, a.name]));

  /** Acumuladores de acciones; se ejecutan al final, después de las verificaciones. */
  const bajasPlan: { plan: any; motivo: string }[] = [];
  const bajasAsset: { asset: any; motivo: string }[] = [];
  const renombres: { plan: any; nuevo: string }[] = [];
  const inactivar: { plan: any; motivo: string }[] = [];
  const hereda: { plan: any; lastExecutionDate: Date | null; lastExecutionHours: number | null; nextDueDate: Date | null; nextDueHours: number | null; desde: string }[] = [];
  const grupoB: { plan: any; contra: string }[] = [];

  // ══ 1a. EQUIPOS DUPLICADOS ════════════════════════════════════════════════════
  console.log("──── 1a. Equipos cargados dos veces ────");
  const movimientosOT: { woId: string; woCode: string; aAssetId: string }[] = [];
  const movimientosLog: { logId: string; logCode: string; aAssetId: string }[] = [];

  for (const m of ASSET_MERGES) {
    const from = assets.find((a: any) => a.assetCode === m.from);
    const to = assets.find((a: any) => a.assetCode === m.to);
    if (!from || !to) {
      console.log(`  [ya resuelto] ${m.from} -> ${m.to} (no están los dos vivos)`);
      continue;
    }
    const planesDeFrom = plans.filter((p: any) => p.assetId === from.id);
    const ots = await prisma.workOrder.findMany({
      where: { assetId: from.id, deletedAt: null },
      select: { id: true, workOrderCode: true },
    });
    const logs = await prisma.workLog.findMany({ where: { assetId: from.id }, select: { id: true, logCode: true } });

    console.log(`  ${m.from} → ${m.to}   (${from.name})`);
    console.log(`     motivo: ${m.motivo}`);
    console.log(`     se repuntan al que queda: ${ots.length} OT, ${logs.length} partes de trabajo`);

    for (const o of ots) movimientosOT.push({ woId: o.id, woCode: o.workOrderCode, aAssetId: to.id });
    for (const l of logs) movimientosLog.push({ logId: l.id, logCode: l.logCode, aAssetId: to.id });

    for (const p of planesDeFrom) {
      const u = await usoDelPlan(p.id);
      if (u.total > 0) {
        // Tiene historial: no se da de baja, se repunta al equipo que sobrevive.
        console.log(`     plan ${p.taskCode} "${p.title}" tiene historial (${usoTxt(u)}) → se repunta al equipo que queda`);
        hereda.push({ plan: p, lastExecutionDate: p.lastExecutionDate, lastExecutionHours: p.lastExecutionHours, nextDueDate: p.nextDueDate, nextDueHours: p.nextDueHours, desde: `reasignado a ${m.to}` });
        (p as any).__reasignarA = to.id;
      } else {
        console.log(`     plan ${p.taskCode} "${p.title}" sin historial → baja`);
        bajasPlan.push({ plan: p, motivo: `equipo duplicado ${m.from} dado de baja` });
      }
    }
    bajasAsset.push({ asset: from, motivo: m.motivo });
  }
  if (!ASSET_MERGES.length) console.log("  (nada)");

  // ══ 1b. PLANES DE LA TANDA DE AGOSTO ══════════════════════════════════════════
  console.log("\n──── 1b. Planes de la tanda del 2026-08-01/02 ────");
  const tandaAgosto = plans.filter((p: any) => p.createdAt >= RELOAD_FROM && p.createdAt < RELOAD_TO);
  console.log(`  ${tandaAgosto.length} planes en la tanda.\n`);

  const grupoA: { nuevo: any; viejo: any; uso: Uso }[] = [];

  for (const nuevo of tandaAgosto) {
    // Si el equipo del plan se está dando de baja, ya se resolvió en 1a.
    if (bajasPlan.some((b) => b.plan.id === nuevo.id)) continue;

    const parConfirmado = PARES_CONFIRMADOS.find((x) => x.baja === nuevo.taskCode);

    const candidatos = plans.filter(
      (v: any) =>
        v.id !== nuevo.id &&
        v.assetId === nuevo.assetId &&
        freqKey(v) === freqKey(nuevo) &&
        v.createdAt < RELOAD_FROM &&
        (parConfirmado
          ? v.taskCode === parConfirmado.queda
          : norm(v.title) === norm(nuevo.title) || (norm(v.description) !== "" && norm(v.description) === norm(nuevo.description))),
    );

    if (candidatos.length === 0) {
      // ¿Hay algo del mismo equipo y frecuencia pero con otra redacción? Eso es Grupo B.
      const parecidos = plans.filter(
        (v: any) => v.id !== nuevo.id && v.assetId === nuevo.assetId && freqKey(v) === freqKey(nuevo) && v.createdAt < RELOAD_FROM,
      );
      // Sin nada parecido no hay solapamiento posible: no es un caso a revisar.
      if (parecidos.length) {
        grupoB.push({ plan: nuevo, contra: parecidos.map((x: any) => `${x.taskCode} "${x.title}"`).join(" · ") });
      }
      continue;
    }

    // Sobrevive el más antiguo de los candidatos.
    const viejo = candidatos.sort((a: any, b: any) => a.createdAt - b.createdAt)[0];
    const usoNuevo = await usoDelPlan(nuevo.id);
    if (usoNuevo.total > 0) {
      // El de agosto acumuló historial: no se toca, va a Grupo B para revisión manual.
      grupoB.push({ plan: nuevo, contra: `${viejo.taskCode} "${viejo.title}" — OJO: el de agosto tiene historial (${usoTxt(usoNuevo)})` });
      continue;
    }
    grupoA.push({ nuevo, viejo, uso: usoNuevo });
  }

  console.log(`  GRUPO A — duplicado confirmado, se da de baja el de agosto (${grupoA.length}):`);
  for (const { nuevo, viejo } of grupoA) {
    const usoViejo = await usoDelPlan(viejo.id);
    console.log(`    BAJA  ${nuevo.taskCode.padEnd(20)} "${nuevo.title}"`);
    console.log(`    queda ${viejo.taskCode.padEnd(20)} "${viejo.title}"  [${nombreAsset.get(viejo.assetId)}] ${usoTxt(usoViejo)}`);
    bajasPlan.push({ plan: nuevo, motivo: `duplicado de ${viejo.taskCode}` });

    // Si el de agosto traía una última ejecución más nueva, se la pasa al que sobrevive.
    const dNuevo = nuevo.lastExecutionDate?.getTime() ?? 0;
    const dViejo = viejo.lastExecutionDate?.getTime() ?? 0;
    if (dNuevo > dViejo) {
      hereda.push({
        plan: viejo,
        lastExecutionDate: nuevo.lastExecutionDate,
        lastExecutionHours: nuevo.lastExecutionHours ?? viejo.lastExecutionHours,
        nextDueDate: nuevo.nextDueDate,
        nextDueHours: nuevo.nextDueHours ?? viejo.nextDueHours,
        desde: nuevo.taskCode,
      });
      console.log(`          ↳ hereda última ejecución ${iso(nuevo.lastExecutionDate)} (era ${iso(viejo.lastExecutionDate)})`);
    }
    console.log("");
  }
  if (!grupoA.length) console.log("    (nada)\n");

  console.log(`  GRUPO B — mismo equipo y misma frecuencia que un plan anterior, pero otra tarea. NO se toca, revisalo vos (${grupoB.length}):`);
  for (const { plan, contra } of grupoB) {
    console.log(`    ${plan.taskCode.padEnd(20)} "${plan.title}"  [${nombreAsset.get(plan.assetId)}] ${plan.triggerType} ${plan.frequencyMonths ?? ""}m ${plan.frequencyHours ?? ""}h`);
    console.log(`       contra: ${contra}`);
  }
  if (!grupoB.length) console.log("    (nada)");

  // ══ 1c. PLANES -ARCH ══════════════════════════════════════════════════════════
  console.log("\n──── 1c. Planes con sufijo -ARCH que quedaron ACTIVOS ────");
  const archs = plans.filter((p: any) => p.taskCode.endsWith("-ARCH"));
  for (const arch of archs) {
    if (bajasPlan.some((b) => b.plan.id === arch.id)) continue;
    const base = arch.taskCode.slice(0, -"-ARCH".length);
    const gemelo = plans.find((p: any) => p.taskCode === base);
    const usoArch = await usoDelPlan(arch.id);
    const usoGemelo = gemelo ? await usoDelPlan(gemelo.id) : null;

    console.log(`  ${arch.taskCode} "${arch.title}" [${nombreAsset.get(arch.assetId)}] ${usoTxt(usoArch)}`);
    if (!gemelo) {
      console.log(`     no tiene gemelo vivo → se le saca el sufijo, queda como ${base}`);
      renombres.push({ plan: arch, nuevo: base });
      continue;
    }
    console.log(`     gemelo ${gemelo.taskCode} "${gemelo.title}" ${usoTxt(usoGemelo!)}`);

    if (usoArch.total > 0 && usoGemelo!.total === 0) {
      // El historial está en el -ARCH: sobrevive él, se da de baja el vacío y le toma el código.
      console.log(`     → el historial está en el -ARCH: se da de baja ${gemelo.taskCode} (vacío) y el -ARCH pasa a llamarse ${base}`);
      // Si el gemelo vacío traía una fecha más nueva, el -ARCH la hereda.
      const dG = gemelo.lastExecutionDate?.getTime() ?? 0;
      const dA = arch.lastExecutionDate?.getTime() ?? 0;
      if (dG > dA) {
        hereda.push({ plan: arch, lastExecutionDate: gemelo.lastExecutionDate, lastExecutionHours: gemelo.lastExecutionHours ?? arch.lastExecutionHours, nextDueDate: gemelo.nextDueDate, nextDueHours: gemelo.nextDueHours ?? arch.nextDueHours, desde: gemelo.taskCode });
        console.log(`        ↳ hereda última ejecución ${iso(gemelo.lastExecutionDate)} (era ${iso(arch.lastExecutionDate)})`);
      }
      bajasPlan.push({ plan: gemelo, motivo: `vacío; el historial está en ${arch.taskCode}` });
      renombres.push({ plan: arch, nuevo: base });
    } else if (usoArch.total === 0) {
      console.log(`     → el -ARCH está vacío: se da de baja, queda ${gemelo.taskCode}`);
      bajasPlan.push({ plan: arch, motivo: `-ARCH vacío; queda ${gemelo.taskCode}` });
    } else {
      console.log(`     → los dos tienen historial: el -ARCH pasa a INACTIVE (no se borra) y el gemelo sigue activo`);
      inactivar.push({ plan: arch, motivo: `retirado; su gemelo ${gemelo.taskCode} es el vigente` });
    }
  }
  if (!archs.length) console.log("  (nada)");

  // ══ 2. CORRECCIONES PUNTUALES ═══════════════════════════════════════════
  console.log("\n──── 2. Correcciones puntuales ────");
  const correcciones: { plan: any; data: any; que: string }[] = [];

  // 2.1 Iluminación de emergencia: la planilla exige "Mínimo 6 horas de encendido" y
  //     el checklist semanal no lo dice. Va como criterio de aceptación del plan
  //     vigente (M01-6-001), que es donde hoy vive esa prueba.
  const CRITERIO_6H =
    "Iluminación de emergencia: la prueba se da por satisfactoria sólo si los artefactos se mantienen encendidos un mínimo de 6 horas.";
  const planSemanal = plans.find((p: any) => p.taskCode === "M01-6-001" && !bajasPlan.some((b) => b.plan.id === p.id));
  if (!planSemanal) {
    console.log("  [!] No encontré el checklist semanal M01-6-001; se omite el criterio de 6 horas.");
  } else if (norm(planSemanal.acceptanceCriteria).includes("6 horas") || norm(planSemanal.description).includes("6 horas")) {
    console.log("  [ya está] el checklist semanal ya declara las 6 horas de encendido");
  } else {
    console.log(`  ${planSemanal.taskCode} "${planSemanal.title}": se agrega el criterio de mínimo 6 horas de encendido`);
    correcciones.push({
      plan: planSemanal,
      data: {
        acceptanceCriteria: [planSemanal.acceptanceCriteria?.trim(), CRITERIO_6H].filter(Boolean).join("\n"),
      },
      que: "criterio de 6 horas en la iluminación de emergencia",
    });
  }

  // 2.2 La Bomba de Trasvase de Combustible no figura en la tabla de equipos del
  //     checklist anual de aislación, y tampoco tiene un plan propio de aislación.
  //     Se agrega la fila a la tabla de M01-8-001, que es como se registra hoy.
  const FILA_TRASVASE =
    "| [ ] Bomba de Trasvase de Combustible | Motor / Cable / Conjunto | ____ V | ____ VDC | ____ MΩ | ____ MΩ | ____ °C | | |";
  const planAislacion = plans.find((p: any) => p.taskCode === "M01-8-001" && !bajasPlan.some((b) => b.plan.id === p.id));
  if (!planAislacion) {
    console.log("  [!] No encontré el checklist de aislación M01-8-001; se omite la fila de la Bomba de Trasvase.");
  } else if (norm(planAislacion.description).includes("bomba de trasvase")) {
    console.log("  [ya está] la Bomba de Trasvase ya figura en el checklist de aislación");
  } else {
    const desc: string = planAislacion.description ?? "";
    // Se inserta después de la última fila de la tabla de resultados.
    const filas = desc.split("\n");
    let ultima = -1;
    for (let i = 0; i < filas.length; i++) if (/^\|\s*\[ \]/.test(filas[i])) ultima = i;
    if (ultima < 0) {
      console.log("  [!] No pude ubicar la tabla de equipos en M01-8-001; se omite la fila de la Bomba de Trasvase.");
    } else {
      filas.splice(ultima + 1, 0, FILA_TRASVASE);
      console.log(`  ${planAislacion.taskCode} "${planAislacion.title}": se agrega la fila de la Bomba de Trasvase de Combustible`);
      correcciones.push({
        plan: planAislacion,
        data: { description: filas.join("\n") },
        que: "Bomba de Trasvase en el checklist de aislación",
      });
    }
  }

  // ══ VERIFICACION DURA ═════════════════════════════════════════════════════════
  console.log("\n──── Verificación previa ────");
  let abortar = false;
  for (const b of bajasPlan) {
    const u = await usoDelPlan(b.plan.id);
    if (u.total > 0) {
      console.error(`  ABORTA: ${b.plan.taskCode} tiene historial (${usoTxt(u)}) y estaba propuesto para baja.`);
      abortar = true;
    }
  }
  const codigosBaja = new Set(bajasPlan.map((b) => b.plan.taskCode));
  for (const r of renombres) {
    const chocaVivo = plans.find((p: any) => p.taskCode === r.nuevo && p.id !== r.plan.id && !codigosBaja.has(p.taskCode));
    if (chocaVivo) {
      console.error(`  ABORTA: no puedo renombrar ${r.plan.taskCode} → ${r.nuevo}, ese código ya lo usa un plan vivo.`);
      abortar = true;
    }
  }
  if (abortar) {
    console.error("\nNo se aplicó nada.");
    process.exit(1);
  }
  console.log("  OK: ningún plan con historial queda propuesto para baja; no hay choque de códigos.");

  // ══ RESUMEN ═══════════════════════════════════════════════════════════════════
  console.log("\n──── Resumen ────");
  console.log(`  equipos dados de baja ........ ${bajasAsset.length}`);
  console.log(`  OT repuntadas de equipo ...... ${movimientosOT.length}`);
  console.log(`  partes repuntados de equipo .. ${movimientosLog.length}`);
  console.log(`  planes dados de baja ......... ${bajasPlan.length}`);
  console.log(`  planes pasados a INACTIVE .... ${inactivar.length}`);
  console.log(`  planes renombrados ........... ${renombres.length}`);
  console.log(`  planes que heredan fecha ..... ${hereda.length}`);
  console.log(`  correcciones puntuales ....... ${correcciones.length}`);
  console.log(`  Grupo B (sin tocar) .......... ${grupoB.length}`);

  if (DRY) {
    console.log("\nDRY-RUN: no se escribió nada. Sacá DRY=1 para aplicar.");
    return;
  }

  // ══ APLICAR ═══════════════════════════════════════════════════════════════════
  const now = new Date();
  await prisma.$transaction(async (tx: any) => {
    // 1. Repuntar historial de los equipos que se dan de baja.
    for (const m of movimientosOT) {
      await tx.workOrder.update({ where: { id: m.woId }, data: { assetId: m.aAssetId, updatedByUserId: uid } });
    }
    for (const m of movimientosLog) {
      await tx.workLog.update({ where: { id: m.logId }, data: { assetId: m.aAssetId } });
    }
    // Planes con historial que colgaban del equipo duplicado.
    for (const p of plans) {
      if ((p as any).__reasignarA) {
        await tx.maintenancePlan.update({ where: { id: p.id }, data: { assetId: (p as any).__reasignarA, updatedByUserId: uid } });
      }
    }

    // 2. Herencias de fecha (antes de las bajas, para no perder el dato).
    for (const h of hereda) {
      await tx.maintenancePlan.update({
        where: { id: h.plan.id },
        data: {
          lastExecutionDate: h.lastExecutionDate,
          lastExecutionHours: h.lastExecutionHours,
          nextDueDate: h.nextDueDate,
          nextDueHours: h.nextDueHours,
          updatedByUserId: uid,
        },
      });
    }

    // 3. Bajas lógicas de planes.
    for (const b of bajasPlan) {
      await tx.maintenancePlan.update({
        where: { id: b.plan.id },
        data: { deletedAt: now, deletedByUserId: uid, updatedByUserId: uid, status: "INACTIVE" },
      });
    }

    // 4. Renombres (después de las bajas, que liberan el código).
    for (const r of renombres) {
      await tx.maintenancePlan.update({ where: { id: r.plan.id }, data: { taskCode: r.nuevo, updatedByUserId: uid } });
    }

    // 5. Planes retirados que conservan historial.
    for (const i of inactivar) {
      await tx.maintenancePlan.update({ where: { id: i.plan.id }, data: { status: "INACTIVE", updatedByUserId: uid } });
    }

    // 6. Bajas lógicas de equipos.
    for (const b of bajasAsset) {
      await tx.asset.update({
        where: { id: b.asset.id },
        data: { deletedAt: now, deletedByUserId: uid, updatedByUserId: uid },
      });
    }

    // 7. Correcciones puntuales.
    for (const c of correcciones) {
      await tx.maintenancePlan.update({ where: { id: c.plan.id }, data: { ...c.data, updatedByUserId: uid } });
    }
  });

  const assetsDespues = await prisma.asset.count({ where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null } });
  const plansDespues = await prisma.maintenancePlan.count({ where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null } });
  const otDespues = await prisma.workOrder.count({ where: { tenantId: tid, vesselCode: VESSEL, deletedAt: null } });
  console.log(`\nDESPUES: ${assetsDespues} equipos vivos · ${plansDespues} planes vivos · ${otDespues} OT`);
  console.log(`(las OT tienen que ser las mismas que antes: ${otTotales})`);
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
