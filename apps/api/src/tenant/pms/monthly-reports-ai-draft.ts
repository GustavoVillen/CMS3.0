// Monthly Report — generador de borrador con IA.
//
// Junta los datos operativos del vessel para un mes específico, los pasa a
// Claude Haiku con un prompt que pide un resumen ejecutivo + KPIs + notas
// operativas, y devuelve el texto listo para que el master/superintendente
// revise y edite.
//
// La IA NO firma ni cierra el reporte — solo genera el borrador.

import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";

const MODEL = AI_MODEL.fast;

export interface MonthlyDraftInput {
  vesselCode: string;
  year: number;
  month: number;
  /** Si true, ignora el cache y regenera el draft llamando a la IA. */
  force?: boolean;
}

// Cache in-memory por (tenant, vessel, year, month). TTL 24h. Evita
// regenerar 10 veces el mismo mes cuando el usuario abre la pantalla.
// Para meses ya pasados los datos no cambian; para el mes actual el TTL
// hace que se refresque al día siguiente. Usar `force: true` para
// regenerar a demanda.
const draftCache = new Map<string, { result: MonthlyDraftOutput; expiresAt: number }>();
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function makeCacheKey(tenantId: string, vesselCode: string, year: number, month: number): string {
  return `${tenantId}|${vesselCode}|${year}|${month}`;
}

export interface MonthlyDraftOutput {
  summary: string;
  notes: string;
  kpis: {
    defectsCreated: number;
    defectsClosed: number;
    workOrdersClosed: number;
    workOrdersOverdue: number;
    drillsCompleted: number;
    nearMissReported: number;
    certsExpired: number;
    fuelTotalLiters: number | null;
    runningHoursTotal: number | null;
  };
}

const PROMPT = `Sos superintendente de flota redactando el resumen ejecutivo de un Monthly Report para un buque. Te paso los datos crudos del mes y tenes que generar un borrador limpio y profesional.

Devolveme UN UNICO JSON valido sin texto adicional, sin code fence:

{
  "summary": "<resumen ejecutivo, 4-6 lineas, en parrafos cortos. Lenguaje tecnico de superintendencia naval. Mencionar: hechos relevantes del mes, problemas detectados, acciones tomadas, status general del buque>",
  "notes": "<notas operativas adicionales, 2-4 bullets cortos con dato concreto. Ej: tendencias, alertas, items pendientes para el proximo mes>"
}

REGLAS:
- summary y notes en ESPAÑOL.
- summary debe ser narrativo (parrafos), notes debe ser bullets con "- ".
- Citar datos concretos cuando sean relevantes (cantidades, codigos, fechas).
- Si un dato es 0 o no hay info, NO inventes — omitilo o decir "sin novedades".
- NO inventar codigos ni eventos. Solo usar los que estan en el contexto.
- Tono profesional. Sin disclaimers tipo "Aqui tenes...".
- NO incluir recomendaciones a la compañia ni opiniones — solo hechos.

Respondé SOLO con el JSON, sin nada antes ni despues.`;

interface PrismaLikeCount { count(a: { where: Record<string, unknown> }): Promise<number> }
interface PrismaLikeFindMany<T> { findMany(a: unknown): Promise<T[]> }

function stripCodeFence(t: string): string {
  return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function generateMonthlyDraft(
  session: TenantAccessSession,
  input: MonthlyDraftInput,
): Promise<MonthlyDraftOutput> {
  const prisma = getPrismaClient();
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "DB no disponible.");
  const tenant = await prisma.tenant.findUnique({ where: { slug: session.tenantSlug } });
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");

  const vesselCode = String(input.vesselCode ?? "").trim().toUpperCase();
  if (!vesselCode) throw new RouteError(400, "VALIDATION_ERROR", "vesselCode requerido.");
  if (session.user.role !== "TENANT_ADMIN" && !session.user.assignedVesselCodes.includes(vesselCode)) {
    throw new RouteError(403, "FORBIDDEN", "Sin acceso al vessel.");
  }

  const year  = Number(input.year);
  const month = Number(input.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new RouteError(400, "VALIDATION_ERROR", "year inválido.");
  if (!Number.isInteger(month) || month < 1 || month > 12)   throw new RouteError(400, "VALIDATION_ERROR", "month inválido.");

  // Cache check: misma combinación generada en las últimas 24h → no llamamos
  // a Claude de nuevo. Saving Claude tokens. Use force: true para regenerar.
  const cacheKey = makeCacheKey(tenant.id, vesselCode, year, month);
  if (!input.force) {
    const cached = draftCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      log.info(`[monthly-draft] cache hit ${cacheKey}`);
      return cached.result;
    }
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd   = new Date(Date.UTC(year, month, 1));

  const p = prisma as unknown as {
    defect: PrismaLikeCount & PrismaLikeFindMany<{ defectCode: string; description: string; severity: string; reportedAt: Date }>;
    workOrder: PrismaLikeCount & PrismaLikeFindMany<{ workOrderCode: string; title?: string | null; assetName?: string | null; completedDate?: Date | null; dueDate?: Date | null }>;
    drill: PrismaLikeCount & PrismaLikeFindMany<{ drillCode: string; type: string; completedDate?: Date | null }>;
    nearMissReport: PrismaLikeCount & PrismaLikeFindMany<{ nearMissCode: string; category: string; severity: string; description: string; occurredAt: Date }>;
    certificate: PrismaLikeCount;
    dailyReport: { aggregate(a: unknown): Promise<{ _sum: { fuelConsumedLiters?: number | null; runningHoursMain?: number | null } }> };
  };

  // ── KPIs ──
  const baseWhere = { tenantId: tenant.id, vesselCode, deletedAt: null };

  const [
    defectsCreated, defectsClosedRaw, woCompleted, woOverdue, drillsCompleted,
    nearMissList, certsExpiredCount, fuelAgg,
  ] = await Promise.all([
    p.defect.count({ where: { ...baseWhere, reportedAt: { gte: monthStart, lt: monthEnd } } }),
    // "Cerrados en el mes" = updatedAt en el mes y status terminal.
    p.defect.findMany({
      where: { ...baseWhere, status: { in: ["RESOLVED", "CLOSED"] } },
      orderBy: { reportedAt: "desc" },
      select: { defectCode: true, description: true, severity: true, reportedAt: true } as never,
      take: 20,
    }),
    p.workOrder.count({ where: { ...baseWhere, status: "CLOSED", completedDate: { gte: monthStart, lt: monthEnd } } }),
    p.workOrder.count({ where: { ...baseWhere, status: { in: ["PLANNED", "IN_PROGRESS"] }, dueDate: { lt: monthEnd } } }),
    p.drill.count({ where: { tenantId: tenant.id, vesselCode, deletedAt: null, status: "COMPLETED", completedDate: { gte: monthStart, lt: monthEnd } } }),
    p.nearMissReport.findMany({
      where: { ...baseWhere, occurredAt: { gte: monthStart, lt: monthEnd } },
      select: { nearMissCode: true, category: true, severity: true, description: true, occurredAt: true } as never,
      orderBy: { occurredAt: "desc" },
      take: 10,
    }),
    p.certificate.count({ where: { tenantId: tenant.id, vesselCode, deletedAt: null, status: "EXPIRED" } }),
    safeAgg(() => p.dailyReport.aggregate({
      where: { tenantId: tenant.id, vesselCode, deletedAt: null, reportDate: { gte: monthStart, lt: monthEnd } },
      _sum: { fuelConsumedLiters: true, runningHoursMain: true },
    })),
  ]);

  const defectsClosed = defectsClosedRaw.length;

  // ── Top defectos / OTs / drills para citar en el narrative ──
  const topDefects = defectsClosedRaw.slice(0, 5);
  // WorkOrder no tiene assetName; tiene assetId. Fetch nombres de asset en
  // un segundo query para enriquecer el label.
  const topWosOverdueRaw = await p.workOrder.findMany({
    where: { ...baseWhere, status: { in: ["PLANNED", "IN_PROGRESS"] }, dueDate: { lt: monthEnd } },
    orderBy: { dueDate: "asc" },
    select: { workOrderCode: true, title: true, assetId: true, dueDate: true } as never,
    take: 5,
  }) as Array<{ workOrderCode: string; title: string | null; assetId: string; dueDate: Date | null }>;
  const wosAssetIds = [...new Set(topWosOverdueRaw.map(w => w.assetId).filter(Boolean))];
  const wosAssets = wosAssetIds.length > 0
    ? await (p as unknown as { asset: { findMany(a: { where: { id: { in: string[] }; tenantId: string }; select: { id: true; name: true } }): Promise<Array<{ id: string; name: string }>> } })
        .asset.findMany({ where: { id: { in: wosAssetIds }, tenantId: tenant.id }, select: { id: true, name: true } })
    : [];
  const wosAssetNameById = new Map(wosAssets.map(a => [a.id, a.name]));
  const topWosOverdue = topWosOverdueRaw.map(w => ({
    workOrderCode: w.workOrderCode,
    title:         w.title,
    assetName:     wosAssetNameById.get(w.assetId) ?? null,
    dueDate:       w.dueDate,
  }));
  const drillsDone = await p.drill.findMany({
    where: { tenantId: tenant.id, vesselCode, deletedAt: null, status: "COMPLETED", completedDate: { gte: monthStart, lt: monthEnd } },
    orderBy: { completedDate: "desc" },
    select: { drillCode: true, type: true, completedDate: true } as never,
    take: 10,
  });

  const monthLabel = `${String(month).padStart(2, "0")}/${year}`;

  // ── Armado del contexto que vuela a la IA ──
  const contextLines: string[] = [
    `Buque: ${vesselCode}`,
    `Período: ${monthLabel}`,
    "",
    "KPIs:",
    `- Defectos reportados en el mes: ${defectsCreated}`,
    `- Defectos cerrados/resueltos: ${defectsClosed}`,
    `- OTs completadas en el mes: ${woCompleted}`,
    `- OTs vencidas al cierre del mes: ${woOverdue}`,
    `- Drills realizados: ${drillsCompleted}`,
    `- Near miss reportados: ${nearMissList.length}`,
    `- Certificados vencidos al cierre: ${certsExpiredCount}`,
    fuelAgg._sum.fuelConsumedLiters != null ? `- Combustible consumido (litros): ${fuelAgg._sum.fuelConsumedLiters}` : null,
    fuelAgg._sum.runningHoursMain != null ? `- Horas de máquina principal: ${fuelAgg._sum.runningHoursMain}` : null,
  ].filter(Boolean) as string[];

  if (topDefects.length > 0) {
    contextLines.push("", "Defectos cerrados (recientes):");
    for (const d of topDefects) {
      contextLines.push(`- ${d.defectCode} (${d.severity}): ${d.description.slice(0, 120)}`);
    }
  }
  if (topWosOverdue.length > 0) {
    contextLines.push("", "OTs vencidas al cierre:");
    for (const w of topWosOverdue) {
      const due = w.dueDate ? new Date(w.dueDate).toISOString().slice(0, 10) : "—";
      contextLines.push(`- ${w.workOrderCode} (vencía ${due}): ${w.assetName ?? w.title ?? "—"}`);
    }
  }
  if (drillsDone.length > 0) {
    contextLines.push("", "Drills realizados:");
    for (const d of drillsDone) {
      const dt = d.completedDate ? new Date(d.completedDate).toISOString().slice(0, 10) : "—";
      contextLines.push(`- ${d.drillCode} ${d.type} (${dt})`);
    }
  }
  if (nearMissList.length > 0) {
    contextLines.push("", "Near miss del mes:");
    for (const n of nearMissList.slice(0, 5)) {
      const dt = new Date(n.occurredAt).toISOString().slice(0, 10);
      contextLines.push(`- ${n.nearMissCode} ${n.category} (${n.severity}, ${dt}): ${n.description.slice(0, 120)}`);
    }
  }

  // ── Llamada a Claude ──
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", `${aiApiKeyName()} no esta configurada.`);
  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = createAiClient({ apiKey, timeout: 60_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const feature = "monthly_report_draft";
  const locale = await getTenantAiLocale(session.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${contextLines.join("\n")}` }],
    });
    log.info(`[${feature}] Claude responded in ${Date.now() - aiStarted}ms`);
  } catch (err) {
    log.error(`[${feature}] Anthropic call failed:`, err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo generar el borrador.");
  }

  // Telemetría no bloqueante
  (async () => {
    try {
      recordAiUsage({
        tenantId: tenant.id, tenantSlug: session.tenantSlug,
        userId: session.user.id, userEmail: session.user.email,
        vesselCode, feature, model: MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        latencyMs: Date.now() - aiStarted,
      });
    } catch { /* swallow */ }
  })();

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  let parsed: { summary?: string; notes?: string };
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    log.warn(`[${feature}] JSON parse failed, raw:`, raw.slice(0, 300));
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió un formato inválido.");
  }

  const result: MonthlyDraftOutput = {
    summary: String(parsed.summary ?? "").trim(),
    notes:   String(parsed.notes ?? "").trim(),
    kpis: {
      defectsCreated,
      defectsClosed,
      workOrdersClosed: woCompleted,
      workOrdersOverdue: woOverdue,
      drillsCompleted,
      nearMissReported: nearMissList.length,
      certsExpired: certsExpiredCount,
      fuelTotalLiters: fuelAgg._sum.fuelConsumedLiters ?? null,
      runningHoursTotal: fuelAgg._sum.runningHoursMain ?? null,
    },
  };
  draftCache.set(cacheKey, { result, expiresAt: Date.now() + DRAFT_TTL_MS });
  return result;
}

async function safeAgg<T>(fn: () => Promise<T>): Promise<{ _sum: { fuelConsumedLiters?: number | null; runningHoursMain?: number | null } }> {
  try {
    return (await fn()) as unknown as { _sum: { fuelConsumedLiters?: number | null; runningHoursMain?: number | null } };
  } catch {
    return { _sum: { fuelConsumedLiters: null, runningHoursMain: null } };
  }
}
