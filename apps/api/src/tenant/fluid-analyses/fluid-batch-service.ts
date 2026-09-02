// Carga masiva de reportes de laboratorio (PDF) — "subir todos los análisis de
// una vez" desde el Dashboard.
//
// Flujo en dos tiempos, a propósito:
//   1. SCAN  (un archivo por llamada): guarda el PDF, lo lee con IA, resuelve
//      buque y equipo, y decide si ese número de muestra YA está cargado.
//      No escribe nada en la base. Devuelve una propuesta por archivo.
//   2. COMMIT (todas las filas juntas): el usuario ya revisó y corrigió lo que
//      hacía falta. Recién acá se crean las muestras y sus resultados.
//
// Por qué en dos tiempos: el nombre del equipo que usa el laboratorio no es el
// del maestro de equipos ("MOTOR PROPULSOR N1" vs "Motor Principal #1"), así
// que la identificación es una inferencia. Guardar un análisis contra el equipo
// equivocado ensucia la tendencia del equipo y la evidencia de auditoría; la
// pantalla de revisión es la que evita eso.
//
// Duplicados: la clave es el NÚMERO DE MUESTRA del laboratorio, que se guarda
// en `FluidSample.labReference` (así están cargadas las muestras históricas de
// CONDOR). Se chequea contra la base y también dentro del mismo lote.
import { RouteError } from "../../http/route-error";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getCachedTenantBySlug } from "../tenant-cache";
import type { TenantAccessSession } from "../auth/session-store";
import { saveFluidReportFile } from "./fluid-uploads-service";
import { extractFluidReport } from "./fluid-analyses-ai-extractor";
import { matchAssetByAi, loadVesselAssets, type AssetCandidate } from "../ai/asset-ai-match";
import {
  ensureCanManageFluidAnalyses, createFluidSample, updateFluidSample, upsertFluidResult,
  linkFluidSampleToWorkOrder,
  FLUID_TYPES, VERDICTS, type FluidType, type Verdict,
} from "./fluid-analyses-service";
import { openFormalWorkOrder } from "../maintenance-plans/maintenance-plans-service";

// ── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Códigos de aviso. Se devuelven como código y no como texto: el idioma lo pone
 * el frontend (el tenant puede estar en es / en / pt).
 */
export type BatchWarning =
  | "VESSEL_NOT_RESOLVED"      // no se pudo saber de qué buque es
  | "ASSET_NOT_RESOLVED"       // no se pudo identificar el equipo
  | "ASSET_LOW_CONFIDENCE"     // se identificó un equipo, pero es una conjetura
  | "SAMPLE_NUMBER_MISSING"    // el reporte no dice número de muestra → no hay clave anti-duplicado
  | "SAMPLE_NUMBER_MISMATCH"   // el número del nombre del archivo no es el del PDF
  | "SAMPLED_AT_MISSING"
  | "VERDICT_MISSING"
  | "VERDICT_MISMATCH"        // el veredicto del nombre del archivo no es el que leyó la IA
  | "FLUID_TYPE_ASSUMED"
  | "NO_PARAMETERS";           // la IA no pudo leer ningún parámetro del reporte

export interface BatchScanRow {
  fileName: string;
  file: { url: string; name: string; mime: string };

  sampleNumber: string | null;
  vesselCode: string | null;
  vesselReferenceText: string | null;

  assetId: string | null;
  assetName: string | null;
  assetReferenceText: string | null;
  assetConfidence: "high" | "medium" | "low" | null;
  assetReason: string | null;

  fluidType: FluidType;
  fluidProduct: string | null;
  sampledAt: string | null;   // YYYY-MM-DD
  receivedAt: string | null;
  runningHours: number | null;
  labName: string | null;
  verdict: Verdict | null;
  summary: string | null;
  parameters: Record<string, { value: number | string; unit?: string }>;

  /** Muestra ya cargada con el mismo número de laboratorio. Si viene, no se guarda nada. */
  duplicateOf: { id: string; sampleCode: string; vesselCode: string } | null;
  /** Muestra pendiente (creada al autorizar una OT) a la que le corresponde este resultado. */
  attachTo: { id: string; sampleCode: string; sampledAt: string } | null;

  aiNotes: string | null;
  warnings: BatchWarning[];
}

/** Fila confirmada por el usuario. El backend revalida todo, no confía en esto. */
export interface BatchCommitRow {
  fileName: string;
  file: { url: string; name: string; mime: string };
  sampleNumber: string | null;
  vesselCode: string;
  assetId: string;
  fluidType: FluidType;
  fluidProduct: string | null;
  sampledAt: string;
  receivedAt: string | null;
  runningHours: number | null;
  labName: string | null;
  verdict: Verdict;
  summary: string | null;
  parameters: Record<string, { value: number | string; unit?: string }>;
  attachToSampleId: string | null;
}

export interface BatchCommitResult {
  fileName: string;
  status: "created" | "attached" | "skipped" | "failed";
  sampleId: string | null;
  sampleCode: string | null;
  verdict: Verdict | null;
  /** OT de la que salió la muestra, cuando el resultado completó una pendiente. */
  workOrderCode: string | null;
  /** SS de esa OT (el pedido al laboratorio). */
  serviceRequestCodes: string[];
  /** Motivo cuando status es "skipped" o "failed". Código, no texto. */
  reason: "DUPLICATE" | "MISSING_FIELDS" | "VESSEL_OUT_OF_SCOPE" | "ERROR" | null;
  /** Mensaje del error real cuando status es "failed". */
  message: string | null;
}

// ── Paso 1: escanear un reporte ──────────────────────────────────────────────

export async function scanFluidReportForBatch(
  session: TenantAccessSession,
  input: { buffer: Buffer; originalName: string; vesselCodeHint?: string | null },
): Promise<BatchScanRow> {
  ensureCanManageFluidAnalyses(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const fileName = input.originalName;
  const hints = parseFileNameHints(fileName);

  const saved = await saveFluidReportFile(session.tenantSlug, fileName, input.buffer);

  // El buque se resuelve ANTES de extraer cuando se puede: le da contexto al
  // extractor y evita una segunda pasada.
  const vessels = await listScopedVessels(session, tenantId);
  const preVessel = pickVessel(vessels, input.vesselCodeHint ?? null, [fileName]);

  const extracted = await extractFluidReport(session, {
    buffer: input.buffer,
    mime: saved.mime,
    vesselCode: preVessel,
    referenceDate: hints.date,
    sampleNumber: hints.sampleNumber,
  });

  const vesselCode = preVessel ?? pickVessel(vessels, null, [
    extracted.vesselReferenceText.value ?? "",
  ]);

  // ── Número de muestra ──
  // El del nombre del archivo manda: es el que se le pasó a la IA para que
  // eligiera la fila correcta del historial del reporte.
  // El lab imprime el número con un sufijo de secuencia ("2610090842-00") y lo
  // pone sin sufijo en el nombre del archivo. Se guarda la forma base, que es
  // como están cargadas las muestras históricas, y se compara por base.
  const extractedNumber = baseSampleNumber(extracted.labReference.value);
  const sampleNumber = hints.sampleNumber ?? extractedNumber;

  const warnings: BatchWarning[] = [];
  if (hints.sampleNumber && extractedNumber && hints.sampleNumber !== extractedNumber) {
    warnings.push("SAMPLE_NUMBER_MISMATCH");
  }
  if (!sampleNumber) warnings.push("SAMPLE_NUMBER_MISSING");
  if (!vesselCode) warnings.push("VESSEL_NOT_RESOLVED");

  // ── Equipo ──
  let assetId: string | null = null;
  let assetName: string | null = null;
  let assetConfidence: BatchScanRow["assetConfidence"] = null;
  let assetReason: string | null = null;
  const assetText = extracted.assetReferenceText.value ?? stripExtension(fileName);

  if (vesselCode) {
    const candidates: AssetCandidate[] = await loadVesselAssets(session, vesselCode);
    const match = await matchAssetByAi(session, vesselCode, assetText, {
      candidates,
      feature: "fluid_analyses",
    });
    if (match) {
      assetId = match.id;
      assetName = match.name;
      assetConfidence = match.confidence;
      assetReason = match.reason;
    } else {
      // Último recurso: la sugerencia por parecido de texto del propio extractor,
      // sólo si el equipo pertenece al buque resuelto.
      const fuzzy = extracted.assetIdSuggestion;
      if (fuzzy && candidates.some(c => c.id === fuzzy.id)) {
        assetId = fuzzy.id;
        assetName = fuzzy.name;
        assetConfidence = "low";
      }
    }
  }
  if (!assetId) warnings.push("ASSET_NOT_RESOLVED");
  else if (assetConfidence === "low") warnings.push("ASSET_LOW_CONFIDENCE");

  // ── Resto de los campos ──
  const sampledAt = extracted.sampledAt.value ?? hints.date;
  if (!sampledAt) warnings.push("SAMPLED_AT_MISSING");

  // Veredicto: manda la palabra que el laboratorio puso en el nombre del archivo
  // ("...__ANORMAL__..."). Es su etiqueta literal; lo que devuelve la IA es una
  // lectura del texto y puede subir o bajar un escalón. Si difieren se avisa,
  // porque el veredicto es lo que dispara el defecto automático.
  const verdict = hints.verdict ?? extracted.verdict.value;
  if (!verdict) warnings.push("VERDICT_MISSING");
  else if (hints.verdict && extracted.verdict.value && hints.verdict !== extracted.verdict.value) {
    warnings.push("VERDICT_MISMATCH");
  }

  const fluidType = extracted.fluidType.value ?? "ENGINE_OIL";
  if (!extracted.fluidType.value) warnings.push("FLUID_TYPE_ASSUMED");

  const parameters = flattenParameters(extracted.parameters);
  if (Object.keys(parameters).length === 0) warnings.push("NO_PARAMETERS");

  // ── ¿Ya estaba cargado? ──
  const duplicateOf = sampleNumber
    ? await findByLabReference(prisma, tenantId, sampleNumber)
    : null;

  // ── ¿Hay una muestra pendiente esperando este resultado? ──
  const attachTo = (!duplicateOf && vesselCode && assetId && sampledAt)
    ? await findPendingSample(prisma, tenantId, vesselCode, assetId, sampledAt)
    : null;

  return {
    fileName,
    file: { url: saved.url, name: saved.name, mime: saved.mime },
    sampleNumber,
    vesselCode,
    vesselReferenceText: extracted.vesselReferenceText.value,
    assetId,
    assetName,
    assetReferenceText: extracted.assetReferenceText.value,
    assetConfidence,
    assetReason,
    fluidType,
    fluidProduct: extracted.fluidProduct.value,
    sampledAt,
    receivedAt: extracted.receivedAt.value ?? hints.date,
    runningHours: extracted.runningHours.value,
    labName: extracted.labName.value,
    verdict,
    summary: extracted.summary.value,
    parameters,
    duplicateOf,
    attachTo,
    aiNotes: extracted.notes ?? null,
    warnings,
  };
}

// ── Paso 2: guardar las filas confirmadas ────────────────────────────────────

export async function commitFluidBatch(
  session: TenantAccessSession,
  rows: BatchCommitRow[],
): Promise<{ items: BatchCommitResult[] }> {
  ensureCanManageFluidAnalyses(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RouteError(400, "EMPTY_BATCH", "No hay reportes para guardar.");
  }
  if (rows.length > 60) {
    throw new RouteError(413, "BATCH_TOO_LARGE", "Máximo 60 reportes por carga.");
  }
  const tenantId = await resolveTenantId(session);
  const scoped = await listScopedVessels(session, tenantId);
  const scopedCodes = new Set(scoped.map(v => v.code));

  const items: BatchCommitResult[] = [];
  // Números ya usados en ESTE lote: dos PDF del mismo número no se guardan dos veces.
  const seenNumbers = new Set<string>();

  for (const row of rows) {
    const base: BatchCommitResult = {
      fileName: row?.fileName ?? "",
      status: "failed", sampleId: null, sampleCode: null, verdict: null,
      workOrderCode: null, serviceRequestCodes: [],
      reason: "ERROR", message: null,
    };

    try {
      const vesselCode = String(row?.vesselCode ?? "").trim();
      const assetId    = String(row?.assetId ?? "").trim();
      const sampledAt  = normDate(row?.sampledAt);
      const verdict    = VERDICTS.includes(row?.verdict as Verdict) ? row.verdict : null;

      if (!vesselCode || !assetId || !sampledAt || !verdict) {
        items.push({ ...base, status: "skipped", reason: "MISSING_FIELDS" });
        continue;
      }
      // Aislamiento por buque: el rol con buques asignados no carga análisis de
      // un buque ajeno, aunque el PDF diga que es de ese buque.
      if (!scopedCodes.has(vesselCode)) {
        items.push({ ...base, status: "skipped", reason: "VESSEL_OUT_OF_SCOPE" });
        continue;
      }

      const sampleNumber = baseSampleNumber(row?.sampleNumber);
      if (sampleNumber) {
        if (seenNumbers.has(sampleNumber)) {
          items.push({ ...base, status: "skipped", reason: "DUPLICATE" });
          continue;
        }
        // Revalidación contra la base: entre el escaneo y la confirmación pudo
        // haberse cargado la misma muestra desde otra pantalla.
        const existing = await findByLabReference(prisma, tenantId, sampleNumber);
        if (existing) {
          items.push({
            ...base, status: "skipped", reason: "DUPLICATE",
            sampleId: existing.id, sampleCode: existing.sampleCode,
          });
          continue;
        }
        seenNumbers.add(sampleNumber);
      }

      const fluidType = FLUID_TYPES.includes(row?.fluidType as FluidType) ? row.fluidType : "ENGINE_OIL";
      const runningHours = Number.isFinite(Number(row?.runningHours)) && row?.runningHours != null
        ? Number(row.runningHours)
        : null;
      const labName = normText(row?.labName);
      const fluidProduct = normText(row?.fluidProduct);

      // Muestra: la pendiente que dejó la OT, o una nueva.
      let sampleId: string;
      let sampleCode: string;
      let attached = false;

      const attachId = String(row?.attachToSampleId ?? "").trim();
      const pending = attachId
        ? await (prisma as any).fluidSample.findFirst({
            where: { id: attachId, tenantId, vesselCode, deletedAt: null, result: { is: null } },
            select: { id: true, sampleCode: true },
          })
        : null;

      if (pending) {
        await updateFluidSample(session, pending.id, {
          assetId, fluidType, fluidProduct, sampledAt,
          labName, labReference: sampleNumber,
        });
        sampleId = pending.id;
        sampleCode = pending.sampleCode;
        attached = true;
      } else {
        const created = await createFluidSample(session, {
          vesselCode, assetId, fluidType, fluidProduct, sampledAt,
          labName, labReference: sampleNumber, runningHours,
        });
        sampleId = created.id;
        sampleCode = created.sampleCode;
      }

      // El resultado. Acá se dispara lo de siempre: veredicto, y el defecto
      // automático cuando es CRITICAL o ACTION_REQUIRED.
      await upsertFluidResult(session, sampleId, {
        receivedAt: normDate(row?.receivedAt) ?? sampledAt,
        verdict,
        summary: normText(row?.summary),
        parameters: sanitizeParameters(row?.parameters),
        reportUrl: row?.file?.url ?? null,
        reportMime: row?.file?.mime ?? null,
        runningHours,
      });

      // De dónde salió la muestra: si la dejó una OT, el usuario quiere ver ese
      // número y el de su pedido al laboratorio.
      const origin = await resolveSampleOrigin(prisma, tenantId, sampleId);

      items.push({
        ...base,
        status: attached ? "attached" : "created",
        sampleId, sampleCode, verdict, reason: null,
        workOrderCode: origin.workOrderCode,
        serviceRequestCodes: origin.serviceRequestCodes,
      });
    } catch (e) {
      items.push({
        ...base,
        message: e instanceof RouteError ? e.message : (e instanceof Error ? e.message : "Error desconocido"),
      });
    }
  }

  return { items };
}

// ── Paso 3 (opcional): una OT y una SS para todo el lote ─────────────────────

export interface BatchWorkOrderResult {
  workOrderId: string;
  workOrderCode: string;
  status: string;
  /** true si la OT quedó autorizada sola (inspección propia, sin subcontratado). */
  autoAuthorized: boolean;
  serviceRequests: Array<{ code: string; provider: string | null; status: string }>;
  /** Rutinas del PDM que la OT ejecuta. */
  plans: Array<{ taskCode: string; title: string }>;
  linkedSamples: number;
  /** Análisis que quedaron afuera, con el motivo. */
  skipped: Array<{ sampleCode: string; reason: "NO_PLAN" | "ALREADY_LINKED" | "OTHER_VESSEL" }>;
}

/**
 * Abre UNA orden de trabajo que ejecuta las rutinas de muestreo de los análisis
 * recién cargados, y le cuelga la SS al laboratorio.
 *
 * Por qué una sola y no una por análisis: al laboratorio se le manda un envío
 * con todas las muestras del buque, no nueve pedidos sueltos. `openFormalWorkOrder`
 * ya sabe agrupar (una SS por taller, no por ítem del PDM) y al cerrar la OT
 * cada rutina recalcula su vencimiento con su propia frecuencia.
 *
 * Las muestras quedan vinculadas a la OT: eso las saca del "sin OT" y, además,
 * evita que el gancho que crea muestras al autorizar la orden genere un duplicado
 * (deduplica por OT + plan).
 */
export async function openWorkOrderForFluidBatch(
  session: TenantAccessSession,
  input: { sampleIds: string[] },
): Promise<BatchWorkOrderResult> {
  ensureCanManageFluidAnalyses(session);
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  const tenantId = await resolveTenantId(session);

  const ids = [...new Set((input?.sampleIds ?? []).map(v => String(v || "").trim()).filter(Boolean))];
  if (ids.length === 0) throw new RouteError(400, "EMPTY_BATCH", "No hay análisis para vincular.");

  const samples: Array<{
    id: string; sampleCode: string; vesselCode: string; assetId: string;
    fluidType: string | null; sourceWorkOrderId: string | null;
  }> = await (prisma as any).fluidSample.findMany({
    where: { id: { in: ids }, tenantId, deletedAt: null },
    select: { id: true, sampleCode: true, vesselCode: true, assetId: true, fluidType: true, sourceWorkOrderId: true },
    orderBy: { sampleCode: "asc" },
  });
  if (samples.length === 0) throw new RouteError(404, "FLUID_SAMPLE_NOT_FOUND", "No se encontraron los análisis.");

  const scoped = await listScopedVessels(session, tenantId);
  const scopedCodes = new Set(scoped.map(v => v.code));

  const skipped: BatchWorkOrderResult["skipped"] = [];
  // Una OT es de UN buque: manda el del primer análisis con rutina.
  const vesselCode = samples.find(s => !s.sourceWorkOrderId)?.vesselCode ?? samples[0]!.vesselCode;
  if (!scopedCodes.has(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "El buque de estos análisis está fuera de tu alcance.");
  }

  // Rutinas de muestreo activas del buque, para cruzar por equipo.
  const plans: Array<{ id: string; taskCode: string; title: string; assetId: string; samplingFluidType: string | null }> =
    await (prisma as any).maintenancePlan.findMany({
      where: {
        tenantId, vesselCode, deletedAt: null, status: "ACTIVE",
        samplingKind: "FLUID",
      },
      select: { id: true, taskCode: true, title: true, assetId: true, samplingFluidType: true },
      orderBy: { taskCode: "asc" },
    });

  const pairs: Array<{ sampleId: string; planId: string }> = [];
  const planOrder: string[] = [];
  const planById = new Map(plans.map(p => [p.id, p]));

  for (const sample of samples) {
    if (sample.sourceWorkOrderId) { skipped.push({ sampleCode: sample.sampleCode, reason: "ALREADY_LINKED" }); continue; }
    if (sample.vesselCode !== vesselCode) { skipped.push({ sampleCode: sample.sampleCode, reason: "OTHER_VESSEL" }); continue; }

    const ofAsset = plans.filter(p => p.assetId === sample.assetId);
    // Preferencia: la rutina del mismo fluido. Si el plan no lo declara, sirve
    // igual (es "la rutina de muestreo de ese equipo"). Nunca una de otro fluido:
    // el análisis de aceite no ejecuta la rutina de refrigerante.
    const plan = ofAsset.find(p => p.samplingFluidType === sample.fluidType)
      ?? ofAsset.find(p => !p.samplingFluidType)
      ?? null;
    if (!plan) { skipped.push({ sampleCode: sample.sampleCode, reason: "NO_PLAN" }); continue; }

    pairs.push({ sampleId: sample.id, planId: plan.id });
    if (!planOrder.includes(plan.id)) planOrder.push(plan.id);
  }

  if (planOrder.length === 0) {
    throw new RouteError(409, "NO_SAMPLING_PLAN", "Ninguno de los análisis corresponde a una rutina de muestreo del plan de mantenimiento.");
  }

  const wo = await openFormalWorkOrder(session, planOrder[0]!, {
    additionalPlanIds: planOrder.slice(1),
  } as never) as { id: string; workOrderCode: string };

  let linkedSamples = 0;
  for (const pair of pairs) {
    try {
      await linkFluidSampleToWorkOrder(session, pair.sampleId, { workOrderId: wo.id, planId: pair.planId });
      linkedSamples++;
    } catch {
      // La OT ya existe y es lo que el usuario pidió: un vínculo que falla se
      // reporta como análisis no incluido, no tira abajo la orden.
      const s = samples.find(x => x.id === pair.sampleId);
      if (s) skipped.push({ sampleCode: s.sampleCode, reason: "NO_PLAN" });
    }
  }

  const full = await (prisma as any).workOrder.findFirst({
    where: { id: wo.id, tenantId },
    select: { workOrderCode: true, status: true, autorizadoAt: true, autorizadoByName: true },
  });
  const srRows: Array<{ serviceRequestCode: string; status: string; providerId: string | null }> =
    await (prisma as any).serviceRequest.findMany({
      where: { workOrderId: wo.id, tenantId },
      select: { serviceRequestCode: true, status: true, providerId: true },
      orderBy: { serviceRequestCode: "asc" },
    });
  const providerNames = await loadProviderNames(prisma, tenantId, srRows.map(r => r.providerId));

  return {
    workOrderId: wo.id,
    workOrderCode: full?.workOrderCode ?? wo.workOrderCode,
    status: full?.status ?? "PLANNED",
    autoAuthorized: !!full?.autorizadoAt,
    serviceRequests: srRows.map(r => ({
      code: r.serviceRequestCode,
      provider: r.providerId ? (providerNames.get(r.providerId) ?? null) : null,
      status: r.status,
    })),
    plans: planOrder.map(id => {
      const p = planById.get(id);
      return { taskCode: p?.taskCode ?? "", title: p?.title ?? "" };
    }),
    linkedSamples,
    skipped,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** OT que originó la muestra, y las SS colgadas de esa OT. */
async function resolveSampleOrigin(
  prisma: unknown,
  tenantId: string,
  sampleId: string,
): Promise<{ workOrderCode: string | null; serviceRequestCodes: string[] }> {
  try {
    const sample = await (prisma as any).fluidSample.findFirst({
      where: { id: sampleId, tenantId },
      select: { sourceWorkOrderId: true },
    });
    if (!sample?.sourceWorkOrderId) return { workOrderCode: null, serviceRequestCodes: [] };
    const wo = await (prisma as any).workOrder.findFirst({
      where: { id: sample.sourceWorkOrderId, tenantId, deletedAt: null },
      select: { workOrderCode: true },
    });
    if (!wo) return { workOrderCode: null, serviceRequestCodes: [] };
    const srs: Array<{ serviceRequestCode: string }> = await (prisma as any).serviceRequest.findMany({
      where: { workOrderId: sample.sourceWorkOrderId, tenantId, deletedAt: null },
      select: { serviceRequestCode: true },
      orderBy: { serviceRequestCode: "asc" },
    });
    return { workOrderCode: wo.workOrderCode, serviceRequestCodes: srs.map(r => r.serviceRequestCode) };
  } catch {
    // El número de la OT es informativo: si no se pudo resolver, el análisis
    // igual quedó guardado.
    return { workOrderCode: null, serviceRequestCodes: [] };
  }
}

async function loadProviderNames(
  prisma: unknown,
  tenantId: string,
  ids: Array<string | null>,
): Promise<Map<string, string | null>> {
  const clean = [...new Set(ids.filter((v): v is string => !!v))];
  if (clean.length === 0) return new Map();
  const rows: Array<{ id: string; name: string | null }> = await (prisma as any).provider.findMany({
    where: { id: { in: clean }, tenantId },
    select: { id: true, name: true },
  });
  return new Map(rows.map(r => [r.id, r.name]));
}


async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const tenant = await getCachedTenantBySlug(session.tenantSlug);
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

/** Buques del tenant que el usuario puede tocar (TENANT_ADMIN ve todos). */
async function listScopedVessels(
  session: TenantAccessSession,
  tenantId: string,
): Promise<Array<{ code: string; name: string | null }>> {
  const prisma = getPrismaClient();
  if (!prisma) return [];
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (session.user.role !== "TENANT_ADMIN") {
    const assigned = session.user.assignedVesselCodes ?? [];
    if (assigned.length === 0) return [];
    where.code = { in: assigned };
  }
  return (prisma as any).vessel.findMany({ where, select: { code: true, name: true } });
}

/**
 * De qué buque habla el texto. Compara contra el nombre compactado (sin espacios
 * ni acentos) y, por token exacto, contra el código. Devuelve el match más largo
 * — así "MGT 23" no matchea con "MGT 2".
 */
export function pickVessel(
  vessels: Array<{ code: string; name: string | null }>,
  hint: string | null,
  texts: string[],
): string | null {
  if (hint) {
    const h = hint.trim();
    if (vessels.some(v => v.code === h)) return h;
  }
  let best: { code: string; len: number } | null = null;
  for (const raw of texts) {
    if (!raw?.trim()) continue;
    const compact = compactText(raw);
    const tokens = new Set(compactTokens(raw));
    for (const v of vessels) {
      const name = v.name ? compactText(v.name) : "";
      if (name.length >= 4 && compact.includes(name)) {
        if (!best || name.length > best.len) best = { code: v.code, len: name.length };
      }
      const code = compactText(v.code);
      if (code.length >= 3 && tokens.has(code)) {
        if (!best || code.length > best.len) best = { code: v.code, len: code.length };
      }
    }
  }
  return best?.code ?? null;
}

async function findByLabReference(
  prisma: unknown,
  tenantId: string,
  labReference: string,
): Promise<{ id: string; sampleCode: string; vesselCode: string } | null> {
  // Se busca la forma base y también la que trae el sufijo de secuencia del lab
  // ("2610090842" y "2610090842-00" son la MISMA muestra).
  return (prisma as any).fluidSample.findFirst({
    where: {
      tenantId, deletedAt: null,
      OR: [
        { labReference },
        { labReference: { startsWith: `${labReference}-` } },
      ],
    },
    select: { id: true, sampleCode: true, vesselCode: true },
  });
}

/**
 * Muestra sin resultado del mismo equipo, la más cercana en fecha dentro de 45
 * días. Es la que dejó abierta la OT de toma de muestra: pegarle el resultado
 * cierra ese ciclo en vez de dejar dos registros del mismo muestreo.
 */
async function findPendingSample(
  prisma: unknown,
  tenantId: string,
  vesselCode: string,
  assetId: string,
  sampledAt: string,
): Promise<{ id: string; sampleCode: string; sampledAt: string } | null> {
  const target = new Date(sampledAt);
  if (isNaN(target.getTime())) return null;
  const windowMs = 45 * 24 * 60 * 60 * 1000;

  const rows: Array<{ id: string; sampleCode: string; sampledAt: Date }> =
    await (prisma as any).fluidSample.findMany({
      where: {
        tenantId, vesselCode, assetId, deletedAt: null,
        result: { is: null },
        sampledAt: { gte: new Date(target.getTime() - windowMs), lte: new Date(target.getTime() + windowMs) },
      },
      select: { id: true, sampleCode: true, sampledAt: true },
    });
  if (rows.length === 0) return null;

  rows.sort((a, b) =>
    Math.abs(a.sampledAt.getTime() - target.getTime()) - Math.abs(b.sampledAt.getTime() - target.getTime()));
  const best = rows[0]!;
  return { id: best.id, sampleCode: best.sampleCode, sampledAt: best.sampledAt.toISOString().slice(0, 10) };
}

/**
 * Datos que el propio nombre del archivo ya trae. El laboratorio los nombra
 * "<BUQUE>__<EQUIPO>_<Nº MUESTRA>_<VEREDICTO>__<IDIOMA>_<FECHA>.pdf", pero acá
 * no se asume ese formato: se buscan las tres piezas donde aparezcan, y si no
 * están, la IA resuelve igual. Son pistas, no la fuente de verdad.
 */
export function parseFileNameHints(fileName: string): {
  sampleNumber: string | null;
  date: string | null;
  verdict: Verdict | null;
} {
  const base = stripExtension(fileName);

  const dateMatch = base.match(/(20\d{2})-(\d{2})-(\d{2})/);
  const date = dateMatch ? dateMatch[0] : null;

  // Número de muestra: la corrida de dígitos más larga (≥7) que no sea la fecha.
  let sampleNumber: string | null = null;
  const withoutDate = date ? base.replace(date, " ") : base;
  for (const m of withoutDate.matchAll(/\d{7,}/g)) {
    if (!sampleNumber || m[0].length > sampleNumber.length) sampleNumber = m[0];
  }
  sampleNumber = baseSampleNumber(sampleNumber);

  // Veredicto tal como lo escribe el laboratorio, en la escala de la app.
  // Los límites de palabra van con lookaround y NO con \b: el separador de estos
  // nombres es "_", que para \b cuenta como letra ("..._ANORMAL_..." no matchea).
  // El orden importa: "ANORMAL" contiene "NORMAL".
  const VERDICT_WORDS: Array<[RegExp, Verdict]> = [
    [/(?<![a-záéíóúñ])(severo|severa|severe|critico|crítico|critical)(?![a-záéíóúñ])/i, "CRITICAL"],
    [/(?<![a-záéíóúñ])(anormal|abnormal|accion requerida|action required)(?![a-záéíóúñ])/i, "ACTION_REQUIRED"],
    [/(?<![a-záéíóúñ])(precaucion|precaución|caution)(?![a-záéíóúñ])/i, "CAUTION"],
    [/(?<![a-záéíóúñ])(normal)(?![a-záéíóúñ])/i, "NORMAL"],
  ];
  let verdict: Verdict | null = null;
  for (const [re, v] of VERDICT_WORDS) {
    if (re.test(base)) { verdict = v; break; }
  }

  return { sampleNumber, date, verdict };
}

function flattenParameters(
  raw: Record<string, { value: number | string; unit?: string; confidence?: string }>,
): Record<string, { value: number | string; unit?: string }> {
  const out: Record<string, { value: number | string; unit?: string }> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!v || v.value === null || v.value === undefined) continue;
    out[k] = { value: v.value, ...(v.unit ? { unit: v.unit } : {}) };
  }
  return out;
}

function sanitizeParameters(raw: unknown): Record<string, { value: number | string; unit?: string }> {
  const out: Record<string, { value: number | string; unit?: string }> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") {
      const o = v as { value?: unknown; unit?: unknown };
      if (o.value === null || o.value === undefined || o.value === "") continue;
      const value = typeof o.value === "number" ? o.value : String(o.value);
      out[key] = { value, ...(typeof o.unit === "string" && o.unit ? { unit: o.unit } : {}) };
    } else {
      out[key] = { value: typeof v === "number" ? v : String(v) };
    }
  }
  return out;
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "");
}

function compactText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
}

function compactTokens(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
}

function normText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Número de muestra en su forma comparable. El laboratorio lo imprime dentro del
 * PDF con un sufijo de secuencia ("2610090842-00") y lo escribe sin sufijo en el
 * nombre del archivo; las 106 muestras ya cargadas usan la forma sin sufijo. Sin
 * esta normalización, el mismo análisis subido dos veces pasaría el control de
 * duplicados por escribirse distinto.
 */
function baseSampleNumber(v: unknown): string | null {
  const t = normText(v);
  if (!t) return null;
  const compact = t.replace(/\s+/g, "");
  const m = compact.match(/^(\d{6,})-\d{1,3}$/);
  return m ? m[1]! : compact;
}

function normDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
