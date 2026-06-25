import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { log } from "../../common/logger";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { getDeferral } from "./deferrals-service";

const MODEL = "claude-haiku-4-5-20251001";

// Barrera anti-invención: la IA debe ceñirse a los datos del informe.
const NO_INVENT = `IMPORTANTE: Basate ÚNICAMENTE en los datos del informe provistos abajo. NO inventes ni asumas plazos, fechas, cantidades ni hechos que no estén explícitos; en particular, NO estimes la duración del aplazamiento — usá EXACTAMENTE la duración y las fechas indicadas en el contexto.`;

const PROMPT_COMPENSATORY = `Sos experto en gestión de mantenimiento naval. Proponé directamente medidas compensatorias concretas, verificables y específicas al activo y al tipo de tarea aplazada, para mitigar el riesgo operacional mientras dure el aplazamiento. Las medidas deben ser prácticas, ejecutables por la tripulación, y enfocadas en monitoreo, controles operativos y planes de contingencia.

${NO_INVENT}

NO hagas preguntas: con la información provista alcanza para proponer medidas razonables. Respondé ÚNICAMENTE con las medidas compensatorias en formato de lista numerada, en texto plano, sin introducción ni explicación adicional.`;

interface CompensatoryInput {
  /** Si está, se cargan los datos autoritativos del diferimiento desde la DB. */
  deferralId?: string | null;
  // Campos cliente (fallback cuando aún no existe el diferimiento, ej. al pausar una OT):
  deferralCode?: string | null;
  vesselCode?: string | null;
  assetLabel?: string | null;
  sourceTypeLabel?: string | null;
  sourceDisplayName?: string | null;
  sourceTask?: string | null;
  requestedAt?: string | null;
  targetDate?: string | null;
  justification?: string | null;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  WORK_ORDER: "Orden de trabajo", DEFECT: "Defecto", MAINTENANCE_PLAN: "Plan de mantenimiento",
};

function fmtDateEs(d: string | Date | null | undefined): string {
  if (!d) return "no especificada";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "no especificada" : dt.toLocaleDateString("es-AR");
}

function durationLabel(from: string | Date | null | undefined, to: string | Date | null | undefined): string {
  if (!from || !to) return "no determinada";
  const a = new Date(from).getTime(), b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return "no determinada";
  const days = Math.max(0, Math.round((b - a) / 86_400_000));
  const months = Math.round((days / 30.44) * 10) / 10;
  return `${days} días (~${months} mes${months === 1 ? "" : "es"})`;
}

async function resolveDeferralSource(prismaRaw: any, tenantId: string, sourceType: string, sourceId: string): Promise<{ code: string | null; title: string | null; task: string | null }> {
  try {
    if (sourceType === "WORK_ORDER") {
      const wo = await prismaRaw.workOrder.findFirst({ where: { id: sourceId, tenantId }, select: { workOrderCode: true, title: true, description: true } });
      return { code: wo?.workOrderCode ?? null, title: wo?.title ?? null, task: wo?.description ?? null };
    }
    if (sourceType === "DEFECT") {
      const def = await prismaRaw.defect.findFirst({ where: { id: sourceId, tenantId }, select: { defectCode: true, classification: true, description: true } });
      return { code: def?.defectCode ?? null, title: def?.classification ?? null, task: def?.description ?? null };
    }
    if (sourceType === "MAINTENANCE_PLAN") {
      const mp = await prismaRaw.maintenancePlan.findFirst({ where: { id: sourceId, tenantId }, select: { taskCode: true, title: true, description: true } });
      return { code: mp?.taskCode ?? null, title: mp?.title ?? null, task: mp?.description ?? null };
    }
  } catch { /* non-blocking */ }
  return { code: null, title: null, task: null };
}

// Construye el contexto autoritativo del informe. Si viene deferralId, carga los
// datos reales (fechas, duración, detalle de la tarea) desde la DB; si no, usa
// los campos del cliente (caso "pausar OT" antes de que exista el diferimiento).
async function buildContext(session: TenantAccessSession, input: CompensatoryInput): Promise<{ context: string; vesselCode: string | null }> {
  let deferralCode      = input.deferralCode ?? null;
  let vesselCode        = input.vesselCode ?? null;
  let assetLabel        = input.assetLabel ?? null;
  let sourceTypeLabel   = input.sourceTypeLabel ?? null;
  let sourceDisplayName = input.sourceDisplayName ?? null;
  let sourceTask        = input.sourceTask ?? null;
  let requestedAt: string | Date | null = input.requestedAt ?? null;
  let targetDate:  string | Date | null = input.targetDate ?? null;
  let justification     = input.justification ?? null;
  let vesselName: string | null = null;

  if (input.deferralId) {
    try {
      const d: any = await getDeferral(session, input.deferralId);
      deferralCode = d.deferralCode ?? deferralCode;
      vesselCode   = d.vesselCode ?? vesselCode;
      assetLabel   = d.assetName ?? d.assetId ?? assetLabel;
      requestedAt  = d.requestedAt ?? requestedAt;
      targetDate   = d.targetDate ?? targetDate;
      justification = d.justification ?? justification;
      const prismaRaw = getPrismaClient();
      if (prismaRaw && d.tenantId) {
        try {
          const v = await (prismaRaw as any).vessel.findFirst({ where: { tenantId: d.tenantId, code: d.vesselCode }, select: { name: true } });
          vesselName = v?.name ?? null;
        } catch { /* non-blocking */ }
        const src = await resolveDeferralSource(prismaRaw, d.tenantId, d.sourceType, d.sourceId);
        sourceTypeLabel   = sourceTypeLabel ?? SOURCE_TYPE_LABELS[d.sourceType] ?? d.sourceType;
        const disp = [src.code, src.title].filter(Boolean).join(" — ");
        if (disp) sourceDisplayName = disp;
        sourceTask = src.task ?? sourceTask;
      }
    } catch { /* fall back a campos del cliente */ }
  }

  const lines = ["Datos del informe de diferimiento (CONTEXTO COMPLETO Y AUTORITATIVO — usá EXCLUSIVAMENTE estos datos):"];
  if (deferralCode)         lines.push(`- Código del diferimiento: ${deferralCode}`);
  if (vesselName || vesselCode) lines.push(`- Buque: ${vesselName ?? vesselCode}`);
  if (assetLabel)        lines.push(`- Activo afectado: ${assetLabel}`);
  if (sourceTypeLabel)   lines.push(`- Tipo de origen: ${sourceTypeLabel}`);
  if (sourceDisplayName) lines.push(`- Origen (código y título): ${sourceDisplayName}`);
  if (sourceTask)        lines.push(`- Detalle de la tarea diferida: ${sourceTask}`);
  lines.push(`- Fecha de solicitud: ${fmtDateEs(requestedAt)}`);
  lines.push(`- Fecha objetivo (fin del aplazamiento): ${fmtDateEs(targetDate)}`);
  lines.push(`- Duración del aplazamiento: ${durationLabel(requestedAt, targetDate)}`);
  lines.push(`- Justificación del solicitante: ${justification ?? "No especificada"}`);
  return { context: lines.join("\n"), vesselCode };
}

export async function suggestCompensatoryMeasures(
  session: TenantAccessSession,
  input: CompensatoryInput,
): Promise<{ text: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);
  const { context, vesselCode } = await buildContext(session, input);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: PROMPT_COMPENSATORY, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${context}` }],
    });
  } catch (err) {
    log.error("[suggestCompensatoryMeasures] Anthropic call failed:", err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  // Telemetría no bloqueante
  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode,
      feature: "deferral_compensatory_measures_suggestion",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  return { text };
}

// ── Análisis de riesgo del DIFERIMIENTO ──────────────────────────────────────
// A diferencia del riesgo de ejecución (HSE/JSA) del Plan, acá se evalúa el
// riesgo de SEGUIR OPERANDO con la condición diferida hasta la fecha objetivo.
const PROMPT_DEFERRAL_RISK = `Sos experto en gestión de riesgo operacional naval (SOLAS/ISM). Vas a evaluar el riesgo de POSTERGAR (diferir) la tarea/condición indicada, es decir el riesgo de SEGUIR OPERANDO el buque con esa condición sin resolver hasta la fecha objetivo. NO evalúes el riesgo de ejecutar la tarea: evaluá la consecuencia y probabilidad de que la condición diferida derive en una falla/incidente mientras el aplazamiento esté activo, considerando el activo afectado, el tipo de tarea y el horizonte temporal.

${NO_INVENT}

Usá una matriz de probabilidad × consecuencia:
- PROBABILIDAD: LIKELY (muy probable) | PROBABLE | UNLIKELY (improbable) | RARE (altamente improbable)
- CONSECUENCIA: FATALITY (fatalidad) | MAJOR (lesiones importantes / daño grave) | MINOR (lesiones leves / daño menor) | NEGLIGIBLE (insignificante)

Respondé EXACTAMENTE en este formato (las tres primeras líneas obligatorias, en mayúsculas y en inglés los enums), seguidas del análisis en texto plano (3 a 5 bullets cortos, foco en el riesgo de operar diferido y disparadores a vigilar):
NIVEL: LOW|MEDIUM|HIGH|CRITICAL
PROBABILIDAD: LIKELY|PROBABLE|UNLIKELY|RARE
CONSECUENCIA: FATALITY|MAJOR|MINOR|NEGLIGIBLE

- [riesgo/consecuencia principal de seguir operando → disparador a vigilar]
- [...]

NO hagas preguntas: con la información provista alcanza para una evaluación razonable.`;

export interface DeferralRiskResult {
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  probability: "LIKELY" | "PROBABLE" | "UNLIKELY" | "RARE" | null;
  consequence: "FATALITY" | "MAJOR" | "MINOR" | "NEGLIGIBLE" | null;
  analysis: string;
}

export async function suggestDeferralRisk(
  session: TenantAccessSession,
  input: CompensatoryInput,
): Promise<DeferralRiskResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", "ANTHROPIC_API_KEY no está configurada.");

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(session.tenantSlug);
  const { context, vesselCode } = await buildContext(session, input);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: PROMPT_DEFERRAL_RISK, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${context}` }],
    });
  } catch (err) {
    log.error("[suggestDeferralRisk] Anthropic call failed:", err);
    throw new RouteError(502, "AI_CALL_FAILED", "No se pudo obtener sugerencia de la IA.");
  }

  // Telemetría no bloqueante
  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId: tenant.id,
      tenantSlug: session.tenantSlug,
      userId: session.user.id,
      userEmail: session.user.email,
      vesselCode,
      feature: "deferral_risk_analysis_suggestion",
      model: MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - aiStarted,
    });
  })().catch(() => { /* swallow */ });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  const levelMatch = raw.match(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL)/im);
  const level = (levelMatch?.[1] ?? "").toUpperCase() as DeferralRiskResult["level"];
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level)) {
    throw new RouteError(502, "AI_PARSE_ERROR", "Nivel de riesgo inválido o ausente.");
  }
  const probMatch = raw.match(/^PROBABILIDAD:\s*(LIKELY|PROBABLE|UNLIKELY|RARE)/im);
  const consMatch = raw.match(/^CONSECUENCIA:\s*(FATALITY|MAJOR|MINOR|NEGLIGIBLE)/im);
  const probability = (probMatch?.[1]?.toUpperCase() ?? null) as DeferralRiskResult["probability"];
  const consequence = (consMatch?.[1]?.toUpperCase() ?? null) as DeferralRiskResult["consequence"];
  const analysis = raw
    .replace(/^NIVEL:\s*(LOW|MEDIUM|HIGH|CRITICAL).*$/im, "")
    .replace(/^PROBABILIDAD:\s*(LIKELY|PROBABLE|UNLIKELY|RARE).*$/im, "")
    .replace(/^CONSECUENCIA:\s*(FATALITY|MAJOR|MINOR|NEGLIGIBLE).*$/im, "")
    .trim();

  return { level, probability, consequence, analysis };
}
