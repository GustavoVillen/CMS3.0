// Asesor técnico del Director de Mantenimiento (CMS3 Technical Manager Advisor).
//
// Quién: SÓLO un TENANT_ADMIN con la marca "Director de Mantenimiento" (Equipo).
// El DPA sin marca no ve nada de esto. Ve, genera, crea y verifica: el Director.
//
// Cómo (Preview V1 aprobada el 19/09/2026):
//   1. advisor-evidence.ts arma el paquete de evidencia con consultas exactas;
//      cada registro citable lleva una etiqueta E-n.
//   2. La IA recibe el prompt del asesor (texto de Gustavo, tal cual) + el
//      paquete, y devuelve hallazgos en JSON citando etiquetas.
//   3. Acá se DESCARTAN las citas que no existen. Un hallazgo sin ninguna cita
//      válida queda marcado `noEvidence` (la UI lo muestra como hipótesis).
//   4. El informe se guarda inmutable con la FOTO de la evidencia.
//
// Los correos sólo se redactan: el Director los copia o los abre en su correo.
import Anthropic from "@anthropic-ai/sdk";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { isMaintenanceDirector } from "../auth/role-permissions";
import { getCachedTenantBySlug } from "../tenant-cache";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import { publishAudit } from "../../platform/audit/audit-publisher";
import { buildAdvisorEvidence, type EvidenceItem } from "./advisor-evidence";
import type { AssetHealthRow } from "./advisor-asset-health";
import { listVesselsInScope } from "../compliance/compliance-service";
import { ADVISOR_PROMPT } from "./advisor-prompt";
import { getVesselAiContext } from "../ai/vessel-ai-context";

export const FINDING_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type FindingPriority = typeof FINDING_PRIORITIES[number];
export const ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "VERIFIED", "CANCELLED"] as const;
export type ActionStatus = typeof ACTION_STATUSES[number];

export interface AdvisorFinding {
  key: string;
  priority: FindingPriority;
  title: string;
  vessels: string[];
  whyItMatters: string;
  evidenceIds: string[];
  facts: string;
  assessment: string;
  recommendedAction: string;
  responsibleRole: string;
  targetDays: number | null;
  target: string;
  verify: string;
  managementAdvice: string;
  systemic: boolean;
  alternatives: Array<{ option: string; pros: string; cons: string; risk: string; cost: string; operational: string }>;
  /** Ninguna cita válida: se muestra como hipótesis, no como hecho. */
  noEvidence: boolean;
}

export interface AdvisorSummary {
  whatCanHurtUs: string;
  whatWeManageBadly: string;
  whatNeedsAttentionNow: string;
  whatToDo: string;
}

// ── Acceso ───────────────────────────────────────────────────────────────────

function ensureDirector(session: TenantAccessSession) {
  if (!isMaintenanceDirector(session)) {
    throw new RouteError(403, "FORBIDDEN", "Esta pantalla es exclusiva del Director de Mantenimiento.");
  }
}

async function resolveTenantId(session: TenantAccessSession): Promise<string> {
  const tenant = await getCachedTenantBySlug(session.tenantSlug);
  if (!tenant) throw new RouteError(404, "TENANT_NOT_FOUND", "Tenant no encontrado.");
  return tenant.id;
}

function db(): any {
  const prisma = getPrismaClient() as any;
  if (!prisma) throw new RouteError(503, "DATABASE_UNAVAILABLE", "Base de datos no disponible.");
  return prisma;
}

async function actorName(prisma: any, session: TenantAccessSession): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { firstName: true, lastName: true, formName: true, email: true } });
  return user?.formName?.trim() || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || session.user.email;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

// ── Grupos de buques ─────────────────────────────────────────────────────────
// Además de un buque, se puede analizar un grupo entero (pedido de Gustavo:
// "todas las barcazas al mismo tiempo"). Barcaza = el tipo de buque la nombra,
// igual criterio que el puntaje de cumplimiento (vesselType es texto libre).
export const ADVISOR_GROUPS = ["BARGES"] as const;
export type AdvisorGroup = typeof ADVISOR_GROUPS[number];

export function parseAdvisorGroup(v: unknown): AdvisorGroup | null {
  return ADVISOR_GROUPS.includes(v as AdvisorGroup) ? v as AdvisorGroup : null;
}

function isBargeType(vesselType: string | null | undefined): boolean {
  return !!vesselType && vesselType.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().includes("BARCAZA");
}

/** Buques del grupo, dentro del alcance del usuario. */
async function groupVesselCodes(prisma: any, session: TenantAccessSession, tenantId: string, group: AdvisorGroup): Promise<string[]> {
  const vessels = await listVesselsInScope(prisma, session, tenantId, null);
  if (group === "BARGES") return vessels.filter(v => isBargeType(v.vesselType)).map(v => v.code);
  return [];
}

/** Alcance de un informe: "group:<G>", el buque analizado, o null si fue toda la flota. */
function reportScope(sources: unknown): string | null {
  const src = sources as { scopeVesselCode?: unknown; scopeGroup?: unknown } | null;
  if (typeof src?.scopeGroup === "string" && src.scopeGroup) return `group:${src.scopeGroup}`;
  const v = src?.scopeVesselCode;
  return typeof v === "string" && v ? v : null;
}

/**
 * Informes del alcance pedido: el buque del encabezado, o los de toda la flota
 * si no hay buque elegido. Los informes viejos (sin alcance guardado) son de flota.
 */
export async function listAdvisorReports(session: TenantAccessSession, vesselCode: string | null = null, group: AdvisorGroup | null = null) {
  ensureDirector(session);
  const prisma = db();
  const tenantId = await resolveTenantId(session);
  const rows = await prisma.maintenanceAdvisorReport.findMany({
    where: { tenantId, ...(vesselCode && !group ? { vesselCodes: { has: vesselCode } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, createdAt: true, createdByName: true, findings: true, vesselCodes: true, sources: true },
  });
  const wanted = group ? `group:${group}` : vesselCode || null;
  const scoped = rows.filter((r: any) => reportScope(r.sources) === wanted).slice(0, 60);
  return {
    items: scoped.map((r: any) => {
      const findings = (Array.isArray(r.findings) ? r.findings : []) as AdvisorFinding[];
      return {
        id: r.id, createdAt: r.createdAt, createdByName: r.createdByName, vessels: r.vesselCodes.length,
        findings: findings.length,
        critical: findings.filter(f => f.priority === "CRITICAL").length,
        high: findings.filter(f => f.priority === "HIGH").length,
      };
    }),
  };
}

export async function getAdvisorReport(session: TenantAccessSession, reportId: string) {
  ensureDirector(session);
  const prisma = db();
  const tenantId = await resolveTenantId(session);
  const report = await prisma.maintenanceAdvisorReport.findFirst({ where: { id: reportId, tenantId } });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Informe no encontrado.");
  return report;
}

// ── Comparación con el análisis anterior ─────────────────────────────────────
// "¿Mejoró o empeoró?" es la pregunta del Director. Se compara contra el último
// informe del MISMO alcance: los números clave y el estado de cada equipo.

const TREND_KEYS = [
  "plansOverdue", "plansOverdueCritical", "correctivePct90d", "deferralsActive", "defectsOpenHigh",
  "labAlarmsWithoutAction", "closedWithoutEvidence60d", "criticalSparesBelowMin", "assetsWithRepeatedDefects",
  "fragileAssets", "watchAssets",
] as const;

export interface AdvisorTrend {
  previousAt: string;
  metrics: Record<string, { before: number | null; now: number | null }>;
  /** Estado anterior de cada equipo de la radiografía, por id. */
  assets: Record<string, { state: string; score: number }>;
}

function buildTrend(previous: any, metrics: Record<string, unknown>, rows: AssetHealthRow[]): AdvisorTrend | null {
  if (!previous) return null;
  const prevMetrics = (previous.metrics ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const changed: AdvisorTrend["metrics"] = {};
  for (const k of TREND_KEYS) {
    const before = num(prevMetrics[k]);
    const now = num(metrics[k]);
    if (before === null && now === null) continue;
    changed[k] = { before, now };
  }
  const prevRows = (Array.isArray(previous.assetHealth?.rows) ? previous.assetHealth.rows : []) as AssetHealthRow[];
  const assets: AdvisorTrend["assets"] = {};
  for (const r of prevRows) assets[r.assetId] = { state: r.state, score: r.score };
  // Los equipos que hoy están en la lista y antes no aparecían: empeoraron.
  for (const r of rows) if (!assets[r.assetId]) assets[r.assetId] = { state: "OK", score: 0 };
  return { previousAt: new Date(previous.createdAt).toISOString(), metrics: changed, assets };
}

// ── Generación ───────────────────────────────────────────────────────────────

const OUTPUT_CONTRACT = `
## CMS3 DATA YOU RECEIVE AND OUTPUT FORMAT (mandatory, overrides any other formatting instruction above)

You receive a JSON "evidence pack" built by CMS3 with exact database queries across the whole fleet in scope.
- Every record you may cite carries an evidence tag "ev": "E-<n>". The numbers in each section are exact: quote them, never recompute them.
- "dataGaps" lists what CMS3 does NOT record. For any topic depending on those data, state that information is insufficient instead of estimating.
- "sobreElBuque" says if a vessel is a manned tug or an unmanned barge: adapt recommendations (no crew duties on unmanned units).
- Name vessels by NAME, never by code.
- You cannot see anything outside this pack. Do not mention records, dates, measurements, costs or causes that are not in it.
- Status/severity codes come in English (OVERDUE, CRITICAL, ACTION_REQUIRED…): write them as words in the output language.
- "saludDeEquipos" is the equipment radiography the system already computed: equipment that keeps failing, is repaired
  unplanned, or that the laboratory flags. Being repaired does NOT clear it. Raise a finding for the worst ones even
  when their maintenance plan is up to date, and say what to do about the equipment itself (root cause, overhaul,
  replacement, interval change, spare strategy) — not just "close the work order".
- "mismoModeloEnVariosBuques" means the same equipment model fails across vessels: treat it as a fleet decision.
- "planesPorHorasEstimados" gives when hours-based tasks will really fall due at the current running-hours pace.
- "comparacionConElAnalisisAnterior" compares with the previous analysis: mention clearly what got worse or better.

Return ONLY this JSON (no markdown fences, no text around it):
{
  "summary": {
    "whatCanHurtUs": string,          // 1–2 sentences
    "whatWeManageBadly": string,      // 1–2 sentences
    "whatNeedsAttentionNow": string,  // ONE short plain sentence (max 25 words) a non-expert understands: the single most important thing today
    "whatToDo": string                // 1–2 sentences, concrete
  },
  "findings": [                       // 3 to 10 material findings, ordered by RISK (not age), most important first
    {
      "key": "F1",
      "priority": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "title": string,                // WHAT REQUIRES YOUR ATTENTION — one short plain sentence a non-expert understands (no jargon, no codes, max 15 words)
      "vessels": string[],            // vessel names involved ([] = whole fleet)
      "whyItMatters": string,         // WHY IT MATTERS
      "evidenceIds": string[],        // tags E-n supporting it (ONLY tags present in the pack)
      "facts": string,                // EVIDENCE — only facts from the pack, citing tags in brackets [E-3]
      "assessment": string,           // MY ASSESSMENT — interpretation, clearly worded as such
      "recommendedAction": string,    // RECOMMENDED ACTION
      "responsibleRole": string,      // RESPONSIBLE — a role written in the OUTPUT LANGUAGE (e.g. in Spanish "Jefe de Máquinas de <buque>", "Capitán", "Superintendente técnico", "Compras"), never a person's name
      "targetDays": number,           // TARGET in days from today
      "target": string,               // TARGET as text (e.g. "answer in 48 h, test within 7 days")
      "verify": string,               // VERIFY — evidence that proves completion
      "managementAdvice": string,     // MANAGEMENT ADVICE — how to handle it with the people involved
      "systemic": boolean,            // true if it reflects a management-system weakness, not a single event
      "alternatives": [               // only when there are real options; otherwise []
        { "option": string, "pros": string, "cons": string, "risk": string, "cost": string, "operational": string }
      ]
    }
  ],
  "insufficientInformation": [        // topics where a reliable conclusion is not possible
    { "topic": string, "missingData": string }
  ]
}
Keep every text field short and operational (1–3 sentences). Do not blame individuals.
Every free-text field — including role names — must be in the output language: no English words mixed in.`;

const MAX_FINDINGS = 10;

export async function generateAdvisorReport(session: TenantAccessSession, vesselCode: string | null = null, group: AdvisorGroup | null = null) {
  ensureDirector(session);
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");
  const prisma = db();
  const tenantId = await resolveTenantId(session);
  await assertAiBudgetAvailableBySlug(session.tenantSlug);

  const scopeGroup = group;
  const scopeVesselCode = !scopeGroup && typeof vesselCode === "string" && vesselCode.trim() ? vesselCode.trim() : null;
  const groupCodes = scopeGroup ? await groupVesselCodes(prisma, session, tenantId, scopeGroup) : null;
  if (groupCodes && groupCodes.length === 0) throw new RouteError(400, "NO_VESSELS", "No hay buques en ese grupo.");
  const pack = await buildAdvisorEvidence(prisma, session, tenantId, scopeVesselCode, groupCodes);
  if (pack.vesselCodes.length === 0) {
    throw new RouteError(400, "NO_VESSELS", "No hay buques para analizar.");
  }

  // Último informe del mismo alcance, para decir si mejoró o empeoró.
  const previousList = await listAdvisorReports(session, scopeVesselCode, scopeGroup);
  const previous = previousList.items[0]
    ? await prisma.maintenanceAdvisorReport.findFirst({ where: { id: previousList.items[0].id, tenantId }, select: { createdAt: true, metrics: true, assetHealth: true } })
    : null;
  const trend = buildTrend(previous, pack.metrics as unknown as Record<string, unknown>, pack.assetHealth.rows);

  const locale = await getTenantAiLocale(session.tenantSlug);
  const model = AI_MODEL.deep;
  const client = createAiClient({ apiKey, timeout: 240_000, maxRetries: 1 });
  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const response = await client.messages.create({
    model,
    max_tokens: 12000,
    // Sonnet 5 trae el razonamiento activo por defecto y puede gastar todo el
    // presupuesto sin emitir texto (ver asset-health-service.ts).
    thinking: { type: "disabled" },
    system: [
      { type: "text", text: localeInstruction(locale) },
      { type: "text", text: ADVISOR_PROMPT + "\n" + OUTPUT_CONTRACT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{
      role: "user",
      content: `${localeUserReminder(locale)}\nToday: ${today}\n${JSON.stringify({
        ...pack.payload,
        dataGaps: pack.dataGaps,
        comparacionConElAnalisisAnterior: trend
          ? { desde: trend.previousAt.slice(0, 10), numeros: trend.metrics, nota: "before = análisis anterior, now = éste. Si algo empeoró, decilo; si mejoró, reconocelo." }
          : null,
      })}`,
    }],
  } as any) as Anthropic.Message;

  recordAiUsage({
    tenantId,
    tenantSlug: session.tenantSlug,
    userId: session.user.id,
    userEmail: session.user.email,
    vesselCode: null,
    feature: "maintenance_advisor_report",
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Date.now() - started,
  });

  const parsed = parseJson(response);
  const validIds = new Set(pack.evidence.map(e => e.id));
  const findings = normalizeFindings(parsed.findings, validIds);
  if (findings.length === 0) {
    throw new RouteError(502, "AI_EMPTY", "La IA no devolvió hallazgos. Probá analizar de nuevo.");
  }
  const s = parsed.summary ?? {};
  const summary: AdvisorSummary = {
    whatCanHurtUs: text(s.whatCanHurtUs),
    whatWeManageBadly: text(s.whatWeManageBadly),
    whatNeedsAttentionNow: text(s.whatNeedsAttentionNow),
    whatToDo: text(s.whatToDo),
  };
  const insufficient = (Array.isArray(parsed.insufficientInformation) ? parsed.insufficientInformation : [])
    .map((x: any) => ({ topic: text(x?.topic), missingData: text(x?.missingData) }))
    .filter((x: { topic: string }) => x.topic)
    .slice(0, 8);

  const createdByName = await actorName(prisma, session);
  const saved = await prisma.maintenanceAdvisorReport.create({
    data: {
      tenantId,
      periodFrom: pack.periodFrom,
      periodTo: pack.periodTo,
      vesselCodes: pack.vesselCodes,
      metrics: pack.metrics as any,
      summary: summary as any,
      findings: findings as any,
      insufficient: insufficient as any,
      // Sólo se guardan las evidencias citadas: son las que "Ver evidencia" muestra.
      evidence: citedEvidence(pack.evidence, findings) as any,
      assetHealth: pack.assetHealth as any,
      trend: trend as any,
      sources: { ...pack.sources, evidenceTotal: pack.evidence.length, dataGaps: pack.dataGaps, scopeVesselCode, scopeGroup } as any,
      locale,
      model,
      createdByUserId: session.user.id,
      createdByName,
    },
  });

  void publishAudit(prisma, {
    tenantId,
    actorUserId: session.user.id,
    action: "MaintenanceAdvisorReport.generated",
    entityType: "MaintenanceAdvisorReport",
    entityId: saved.id,
    metadata: { findings: findings.length, withoutEvidence: findings.filter(f => f.noEvidence).length },
  });

  return saved;
}

function parseJson(response: Anthropic.Message): any {
  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text).join("\n").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    // A veces el modelo agrega texto alrededor: se toma el primer objeto completo.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* cae abajo */ }
    }
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida. Probá analizar de nuevo.");
  }
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Valida lo que devuelve la IA: prioridad dentro del catálogo, citas sólo a
 * etiquetas que existen en el paquete, y las citas inventadas dentro del texto
 * de "facts" se marcan como no verificadas.
 */
export function normalizeFindings(raw: unknown, validIds: Set<string>): AdvisorFinding[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: AdvisorFinding[] = [];
  for (const f of list.slice(0, MAX_FINDINGS)) {
    if (!f || typeof f !== "object") continue;
    const x = f as Record<string, unknown>;
    const title = text(x.title);
    if (!title) continue;
    const cited = (Array.isArray(x.evidenceIds) ? x.evidenceIds : [])
      .map(v => String(v).trim().toUpperCase())
      .filter(id => validIds.has(id));
    const priority = FINDING_PRIORITIES.includes(String(x.priority).toUpperCase() as FindingPriority)
      ? String(x.priority).toUpperCase() as FindingPriority
      : "MEDIUM";
    const facts = text(x.facts).replace(/\[?\b(E-\d+)\b\]?/g, (m, id) => (validIds.has(id) ? m : "[?]"));
    const days = Number(x.targetDays);
    out.push({
      key: `F${out.length + 1}`,
      priority,
      title,
      vessels: (Array.isArray(x.vessels) ? x.vessels : []).map(v => String(v).trim()).filter(Boolean).slice(0, 10),
      whyItMatters: text(x.whyItMatters),
      evidenceIds: Array.from(new Set(cited)),
      facts,
      assessment: text(x.assessment),
      recommendedAction: text(x.recommendedAction),
      responsibleRole: text(x.responsibleRole),
      targetDays: Number.isFinite(days) && days >= 0 && days <= 365 ? Math.round(days) : null,
      target: text(x.target),
      verify: text(x.verify),
      managementAdvice: text(x.managementAdvice),
      systemic: x.systemic === true,
      alternatives: (Array.isArray(x.alternatives) ? x.alternatives : []).slice(0, 4).map((a: any) => ({
        option: text(a?.option), pros: text(a?.pros), cons: text(a?.cons), risk: text(a?.risk), cost: text(a?.cost), operational: text(a?.operational),
      })).filter((a: { option: string }) => a.option),
      noEvidence: cited.length === 0,
    });
  }
  // El orden es por riesgo: la IA lo propone, acá se asegura por prioridad
  // (estable dentro de cada prioridad) y los sin evidencia van al final de la suya.
  const rank = (f: AdvisorFinding) => FINDING_PRIORITIES.indexOf(f.priority) * 2 + (f.noEvidence ? 1 : 0);
  return out
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }, i) => ({ ...f, key: `F${i + 1}` }));
}

function citedEvidence(all: EvidenceItem[], findings: AdvisorFinding[]): EvidenceItem[] {
  const ids = new Set(findings.flatMap(f => f.evidenceIds));
  return all.filter(e => ids.has(e.id));
}

// ── Borradores de correo ─────────────────────────────────────────────────────

export const DRAFT_KINDS = ["INSTRUCTION", "REQUEST_INFO", "FOLLOW_UP"] as const;
export type DraftKind = typeof DRAFT_KINDS[number];

const DRAFT_PROMPT = `You are the communication assistant of a fleet Technical Manager (Director de Mantenimiento).
Draft ONE email about a maintenance-management finding, addressed to the recipient given.
The email must be professional, clear, concise, collaborative, technically precise, non-confrontational and action-oriented.
Where relevant it must state: the issue, the required action, the information required, who is responsible, priority, deadline, and the evidence required for closure.
Use ONLY the facts provided (finding + evidence records). Do not invent dates, values, codes or causes. Refer to vessels by name.
Identify records by their real codes (work order, plan, defect codes) — never write internal tags like "E-8".
Do not use accusatory language. Sign with the sender name and title given.
Return ONLY this JSON: { "subject": string, "body": string }  (body in plain text with line breaks, no markdown).`;

export async function draftAdvisorEmail(
  session: TenantAccessSession,
  reportId: string,
  input: { findingKey?: string; recipient?: string; kind?: string },
) {
  ensureDirector(session);
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");
  const recipient = text(input.recipient).slice(0, 160);
  if (!recipient) throw new RouteError(400, "RECIPIENT_REQUIRED", "Elegí a quién va dirigido el correo.");
  const kind: DraftKind = DRAFT_KINDS.includes(input.kind as DraftKind) ? input.kind as DraftKind : "REQUEST_INFO";

  const prisma = db();
  const tenantId = await resolveTenantId(session);
  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const report = await getAdvisorReport(session, reportId);
  const finding = (report.findings as AdvisorFinding[]).find(f => f.key === input.findingKey);
  if (!finding) throw new RouteError(404, "NOT_FOUND", "Hallazgo no encontrado.");
  const evidence = (report.evidence as EvidenceItem[]).filter(e => finding.evidenceIds.includes(e.id));
  // Si el Director ajustó el plan con el asesor, el correo pide ESE plan.
  const plan = await currentPlan(prisma, tenantId, reportId, finding);

  const locale = await getTenantAiLocale(session.tenantSlug);
  const sender = await actorName(prisma, session);
  const model = AI_MODEL.fast;
  const client = createAiClient({ apiKey, timeout: 60_000, maxRetries: 1 });
  const started = Date.now();
  const kindText = kind === "INSTRUCTION" ? "an instruction to act" : kind === "FOLLOW_UP" ? "a follow-up on a pending action" : "a request for information";
  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    thinking: { type: "disabled" },
    system: [
      { type: "text", text: localeInstruction(locale) },
      { type: "text", text: DRAFT_PROMPT },
    ],
    messages: [{
      role: "user",
      content: `${localeUserReminder(locale)}\n${JSON.stringify({
        tipoDeCorreo: kindText,
        destinatario: recipient,
        remitente: { nombre: sender, cargo: "Director de Mantenimiento" },
        hallazgo: {
          // Las etiquetas E-n son internas del informe: en el correo van los códigos reales.
          prioridad: finding.priority, titulo: finding.title, porQueImporta: finding.whyItMatters,
          hechos: finding.facts.replace(/\s*\[(?:E-\d+|\?)(?:\s*,\s*(?:E-\d+|\?))*\]/g, ""),
          accionRecomendada: plan.action, responsable: plan.who, plazo: plan.when,
          comoVerificar: plan.verify, buques: finding.vessels,
        },
        evidencia: evidence.map(e => ({ codigo: e.code, buque: e.vesselName, equipo: e.assetName, fecha: e.date, titulo: e.title, detalle: e.detail })),
      })}`,
    }],
  } as any) as Anthropic.Message;

  recordAiUsage({
    tenantId,
    tenantSlug: session.tenantSlug,
    userId: session.user.id,
    userEmail: session.user.email,
    vesselCode: null,
    feature: "maintenance_advisor_draft",
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Date.now() - started,
  });

  const parsed = parseJson(response);
  const subject = text(parsed.subject);
  const body = text(parsed.body);
  if (!body) throw new RouteError(502, "AI_EMPTY", "La IA no devolvió el correo. Probá de nuevo.");
  return { subject, body };
}

// ── Conversación con el asesor sobre un tema (Preview V3) ───────────────────

export const MESSAGE_STEPS = ["WHAT", "DO"] as const;
export type MessageStep = typeof MESSAGE_STEPS[number];

export interface AdvisorProposal {
  action: string;
  who: string;
  when: string;
  targetDays: number | null;
  verify: string;
}

/**
 * Plan vigente de un tema: la última propuesta que el Director adoptó, o el
 * plan original del informe (que es inmutable y no se toca).
 */
async function currentPlan(prisma: any, tenantId: string, reportId: string, finding: AdvisorFinding): Promise<AdvisorProposal & { adjusted: boolean }> {
  const applied = await prisma.maintenanceAdvisorMessage.findFirst({
    where: { tenantId, reportId, findingKey: finding.key, appliedAt: { not: null } },
    orderBy: { appliedAt: "desc" },
    select: { proposal: true },
  });
  const p = applied?.proposal as AdvisorProposal | null | undefined;
  if (p) return { ...p, adjusted: true };
  return {
    action: finding.recommendedAction, who: finding.responsibleRole, when: finding.target,
    targetDays: finding.targetDays, verify: finding.verify, adjusted: false,
  };
}

export async function listAdvisorMessages(session: TenantAccessSession, reportId: string) {
  ensureDirector(session);
  const prisma = db();
  const tenantId = await resolveTenantId(session);
  const report = await prisma.maintenanceAdvisorReport.findFirst({ where: { id: reportId, tenantId }, select: { id: true } });
  if (!report) throw new RouteError(404, "NOT_FOUND", "Informe no encontrado.");
  const items = await prisma.maintenanceAdvisorMessage.findMany({
    where: { tenantId, reportId },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return { items };
}

const REPLY_CONTRACT = `
## THIS TURN: A CONVERSATION ABOUT ONE FINDING (mandatory, overrides the report format above)

You already produced a report. The Technical Manager is now answering you about ONE of its findings,
either about the diagnosis ("step": "WHAT" — what is happening) or about the plan ("step": "DO" — what to do).
You receive: the finding, its CMS3 evidence records, the plan currently in force, the vessel context and the conversation so far.

Rules:
- Answer the manager's latest message directly, in plain words a non-expert understands.
  Keep it SHORT: when you include a proposal, "reply" is 1–2 sentences (max 40 words) saying only the idea —
  the plan details (what, who, when, closure) go ONLY in "proposal" and must NOT be described in "reply".
  Without a proposal, max 80 words.
- Use ONLY the data provided. If the manager states a fact that CMS3 does not show (e.g. "it was already done"),
  do not accept it as a fact: say the system does not show it yet and how it should be recorded to close the gap.
- When the manager says the plan cannot be done (time, resources, location), look for a realistic alternative
  (remote review, split in phases, interim/compensating measures, re-prioritisation) and propose it as a full plan.
  Never drop a safety-critical item silently: if part of the plan cannot be done another way, say so in "warning".
- Only propose a plan when the plan should change. Otherwise "proposal" is null.
- Roles, not person names. Vessels by name, never by code. No internal tags like "E-8".

Return ONLY this JSON (no markdown fences):
{
  "reply": string,
  "proposal": null | {
    "action": string,       // what to do, 1–2 sentences
    "who": string,          // responsible role, in the output language
    "when": string,         // deadline as text, e.g. "3 días (remota) · máx. 30 días (a bordo)"
    "targetDays": number,   // first deadline in days from today
    "verify": string        // evidence that closes it
  },
  "warning": null | string  // ONE short sentence: what the proposal does NOT solve / must not be dropped
}`;

export async function askAdvisor(
  session: TenantAccessSession,
  reportId: string,
  input: { findingKey?: string; step?: string; text?: string },
) {
  ensureDirector(session);
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");
  const question = text(input.text).slice(0, 2000);
  if (!question) throw new RouteError(400, "TEXT_REQUIRED", "Escribí qué le querés decir al asesor.");
  const step: MessageStep = MESSAGE_STEPS.includes(input.step as MessageStep) ? input.step as MessageStep : "DO";

  const prisma = db();
  const tenantId = await resolveTenantId(session);
  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const report = await getAdvisorReport(session, reportId);
  const finding = (report.findings as AdvisorFinding[]).find(f => f.key === input.findingKey);
  if (!finding) throw new RouteError(404, "NOT_FOUND", "Tema no encontrado.");
  const evidence = (report.evidence as EvidenceItem[]).filter(e => finding.evidenceIds.includes(e.id));
  const plan = await currentPlan(prisma, tenantId, reportId, finding);
  const history = await prisma.maintenanceAdvisorMessage.findMany({
    where: { tenantId, reportId, findingKey: finding.key },
    orderBy: { createdAt: "asc" },
    take: 40,
    select: { step: true, role: true, text: true, proposal: true, appliedAt: true },
  });
  const vesselCodes = Array.from(new Set(evidence.map(e => e.vesselCode).filter((c): c is string => !!c)));
  const vesselContext = await Promise.all(vesselCodes.slice(0, 3).map(c => getVesselAiContext(session.tenantSlug, c)));

  // Primero se guarda lo que escribió el Director: si la IA falla, su mensaje no se pierde.
  const createdByName = await actorName(prisma, session);
  const mine = await prisma.maintenanceAdvisorMessage.create({
    data: { tenantId, reportId, findingKey: finding.key, step, role: "DIRECTOR", text: question, createdByUserId: session.user.id, createdByName },
  });

  const locale = await getTenantAiLocale(session.tenantSlug);
  const model = AI_MODEL.deep;
  const client = createAiClient({ apiKey, timeout: 120_000, maxRetries: 1 });
  const started = Date.now();
  const clean = (s: string) => s.replace(/\s*\[(?:E-\d+|\?)(?:\s*,\s*(?:E-\d+|\?))*\]/g, "");
  const response = await client.messages.create({
    model,
    max_tokens: 2500,
    thinking: { type: "disabled" },
    system: [
      { type: "text", text: localeInstruction(locale) },
      { type: "text", text: ADVISOR_PROMPT + "\n" + REPLY_CONTRACT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{
      role: "user",
      content: `${localeUserReminder(locale)}\nToday: ${new Date().toISOString().slice(0, 10)}\n${JSON.stringify({
        step,
        finding: {
          title: finding.title, whyItMatters: finding.whyItMatters, facts: clean(finding.facts),
          assessment: finding.assessment, managementAdvice: finding.managementAdvice, systemic: finding.systemic,
        },
        planInForce: { ...plan, adjustedByManager: plan.adjusted },
        originalPlan: { action: finding.recommendedAction, who: finding.responsibleRole, when: finding.target, verify: finding.verify },
        evidence: evidence.map(e => ({ code: e.code, vessel: e.vesselName, asset: e.assetName, date: e.date, title: e.title, detail: e.detail })),
        vesselContext: vesselContext.filter(Boolean),
        conversation: history.map((m: any) => ({ step: m.step, from: m.role === "DIRECTOR" ? "manager" : "advisor", text: m.text, proposal: m.proposal ?? undefined, adopted: !!m.appliedAt })),
        managerMessage: question,
      })}`,
    }],
  } as any) as Anthropic.Message;

  recordAiUsage({
    tenantId,
    tenantSlug: session.tenantSlug,
    userId: session.user.id,
    userEmail: session.user.email,
    vesselCode: vesselCodes.length === 1 ? vesselCodes[0]! : null,
    feature: "maintenance_advisor_reply",
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Date.now() - started,
  });

  const parsed = parseJson(response);
  const p = parsed.proposal && typeof parsed.proposal === "object" ? parsed.proposal : null;
  // El modelo no siempre respeta el largo: se recorta por oraciones completas
  // para que la conversación no alargue la pantalla (Preview V4).
  const reply = shortenToSentences(text(parsed.reply), p ? 45 : 90);
  if (!reply) throw new RouteError(502, "AI_EMPTY", "El asesor no contestó. Probá de nuevo.");
  const days = Number(p?.targetDays);
  const proposal: AdvisorProposal | null = p && text(p.action) ? {
    action: text(p.action), who: text(p.who) || plan.who, when: text(p.when),
    targetDays: Number.isFinite(days) && days >= 0 && days <= 365 ? Math.round(days) : null,
    verify: text(p.verify) || plan.verify,
  } : null;

  const answer = await prisma.maintenanceAdvisorMessage.create({
    data: {
      tenantId, reportId, findingKey: finding.key, step, role: "ADVISOR", text: reply,
      proposal: proposal as any ?? undefined, warning: text(parsed.warning) || null,
      createdByUserId: session.user.id, createdByName: null,
    },
  });
  return { items: [mine, answer] };
}

/**
 * Deja las primeras oraciones completas que entran en `maxWords` (siempre al
 * menos una). Nunca corta una oración a la mitad.
 */
export function shortenToSentences(value: string, maxWords: number): string {
  const sentences = value.match(/[^.!?…]+[.!?…]+["”»)]*\s*|[^.!?…]+$/g) ?? [value];
  let out = "";
  let words = 0;
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const n = sentence.split(/\s+/).length;
    if (out && words + n > maxWords) break;
    out = out ? `${out} ${sentence}` : sentence;
    words += n;
  }
  return out.trim();
}

/** El Director adopta la propuesta del asesor como plan del tema. */
export async function applyAdvisorProposal(session: TenantAccessSession, reportId: string, messageId: string) {
  ensureDirector(session);
  const prisma = db();
  const tenantId = await resolveTenantId(session);
  const msg = await prisma.maintenanceAdvisorMessage.findFirst({ where: { id: messageId, reportId, tenantId, role: "ADVISOR" } });
  if (!msg || !msg.proposal) throw new RouteError(404, "NOT_FOUND", "Propuesta no encontrada.");
  const updated = await prisma.maintenanceAdvisorMessage.update({
    where: { id: msg.id },
    data: { appliedAt: new Date(), appliedByUserId: session.user.id },
  });
  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id, action: "MaintenanceAdvisor.proposalApplied",
    entityType: "MaintenanceAdvisorReport", entityId: reportId, metadata: { findingKey: msg.findingKey, messageId: msg.id },
  });
  return updated;
}

// ── Acciones de seguimiento ──────────────────────────────────────────────────

export async function listAdvisorActions(session: TenantAccessSession, filters: { status?: string | null; vesselCode?: string | null; group?: AdvisorGroup | null } = {}) {
  ensureDirector(session);
  const prisma = db();
  const tenantId = await resolveTenantId(session);
  const where: Record<string, unknown> = { tenantId };
  if (filters.group) where.vesselCode = { in: await groupVesselCodes(prisma, session, tenantId, filters.group) };
  else if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.status === "ACTIVE") where.status = { in: ["OPEN", "IN_PROGRESS"] };
  else if (filters.status && ACTION_STATUSES.includes(filters.status as ActionStatus)) where.status = filters.status;
  const items = await prisma.maintenanceAdvisorAction.findMany({
    where,
    orderBy: [{ targetDate: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  const codes = Array.from(new Set(items.map((a: any) => a.vesselCode).filter(Boolean)));
  const vessels = codes.length ? await prisma.vessel.findMany({ where: { tenantId, code: { in: codes } }, select: { code: true, name: true } }) : [];
  const names = new Map(vessels.map((v: any) => [v.code, v.name]));
  return { items: items.map((a: any) => ({ ...a, vesselName: a.vesselCode ? names.get(a.vesselCode) ?? null : null })) };
}

interface ActionInput {
  reportId?: string | null;
  findingKey?: string | null;
  title?: string;
  vesselCode?: string | null;
  responsibleName?: string;
  targetDate?: string;
  priority?: string;
  verificationCriteria?: string | null;
  evidenceIds?: string[];
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const date = new Date(v.slice(0, 10) + "T12:00:00Z");
  return Number.isNaN(date.getTime()) ? null : date;
}

async function assertVesselInTenant(prisma: any, tenantId: string, vesselCode: string | null) {
  if (!vesselCode) return;
  const vessel = await prisma.vessel.findFirst({ where: { tenantId, code: vesselCode, deletedAt: null }, select: { code: true } });
  if (!vessel) throw new RouteError(400, "INVALID_VESSEL", "Buque inválido.");
}

export async function createAdvisorAction(session: TenantAccessSession, input: ActionInput) {
  ensureDirector(session);
  const prisma = db();
  const tenantId = await resolveTenantId(session);

  const title = text(input.title).slice(0, 300);
  const responsibleName = text(input.responsibleName).slice(0, 160);
  const targetDate = parseDate(input.targetDate);
  const priority = String(input.priority ?? "").toUpperCase();
  const missing: string[] = [];
  if (!title) missing.push("acción");
  if (!responsibleName) missing.push("responsable");
  if (!targetDate) missing.push("fecha objetivo");
  if (!FINDING_PRIORITIES.includes(priority as FindingPriority)) missing.push("prioridad");
  if (missing.length) throw new RouteError(400, "MISSING_FIELDS", `Completá: ${missing.join(", ")}.`);

  const vesselCode = text(input.vesselCode) || null;
  await assertVesselInTenant(prisma, tenantId, vesselCode);

  let reportId: string | null = null;
  let evidenceIds: string[] = [];
  if (input.reportId) {
    const report = await prisma.maintenanceAdvisorReport.findFirst({ where: { id: input.reportId, tenantId }, select: { id: true, evidence: true } });
    if (!report) throw new RouteError(404, "NOT_FOUND", "Informe no encontrado.");
    reportId = report.id;
    const valid = new Set(((report.evidence ?? []) as EvidenceItem[]).map(e => e.id));
    evidenceIds = (Array.isArray(input.evidenceIds) ? input.evidenceIds : []).map(String).filter(id => valid.has(id));
  }

  const created = await prisma.maintenanceAdvisorAction.create({
    data: {
      tenantId, reportId, findingKey: reportId ? text(input.findingKey) || null : null,
      title, vesselCode, responsibleName, targetDate, priority,
      verificationCriteria: text(input.verificationCriteria).slice(0, 1000) || null,
      evidenceIds, createdByUserId: session.user.id,
    },
  });
  void publishAudit(prisma, {
    tenantId, actorUserId: session.user.id, action: "MaintenanceAdvisorAction.created",
    entityType: "MaintenanceAdvisorAction", entityId: created.id, metadata: { reportId, priority },
  });
  return created;
}

export async function updateAdvisorAction(
  session: TenantAccessSession,
  actionId: string,
  input: { status?: string; verificationNote?: string | null; targetDate?: string; responsibleName?: string; title?: string; priority?: string },
) {
  ensureDirector(session);
  const prisma = db();
  const tenantId = await resolveTenantId(session);
  const current = await prisma.maintenanceAdvisorAction.findFirst({ where: { id: actionId, tenantId } });
  if (!current) throw new RouteError(404, "NOT_FOUND", "Acción no encontrada.");

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = text(input.title).slice(0, 300);
    if (!title) throw new RouteError(400, "MISSING_FIELDS", "Completá: acción.");
    data.title = title;
  }
  if (input.responsibleName !== undefined) {
    const name = text(input.responsibleName).slice(0, 160);
    if (!name) throw new RouteError(400, "MISSING_FIELDS", "Completá: responsable.");
    data.responsibleName = name;
  }
  if (input.targetDate !== undefined) {
    const date = parseDate(input.targetDate);
    if (!date) throw new RouteError(400, "MISSING_FIELDS", "Completá: fecha objetivo.");
    data.targetDate = date;
  }
  if (input.priority !== undefined) {
    const p = String(input.priority).toUpperCase();
    if (!FINDING_PRIORITIES.includes(p as FindingPriority)) throw new RouteError(400, "INVALID_PRIORITY", "Prioridad inválida.");
    data.priority = p;
  }
  if (input.verificationNote !== undefined) data.verificationNote = text(input.verificationNote).slice(0, 2000) || null;

  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase() as ActionStatus;
    if (!ACTION_STATUSES.includes(status)) throw new RouteError(400, "INVALID_STATUS", "Estado inválido.");
    data.status = status;
    if (status === "VERIFIED" || status === "CANCELLED") {
      // Cerrar exige dejar escrito qué se verificó (o por qué se cancela).
      const note = (data.verificationNote as string | null | undefined) ?? current.verificationNote;
      if (!note) {
        throw new RouteError(400, "VERIFICATION_REQUIRED", status === "VERIFIED"
          ? "Para dar por verificada la acción, escribí qué evidencia se revisó."
          : "Para cancelar la acción, escribí el motivo.");
      }
      data.closedAt = new Date();
      data.closedByUserId = session.user.id;
      data.closedByName = await actorName(prisma, session);
    } else {
      data.closedAt = null;
      data.closedByUserId = null;
      data.closedByName = null;
    }
  }

  const updated = await prisma.maintenanceAdvisorAction.update({ where: { id: current.id }, data });
  if (data.status && data.status !== current.status) {
    void publishAudit(prisma, {
      tenantId, actorUserId: session.user.id, action: "MaintenanceAdvisorAction.statusChanged",
      entityType: "MaintenanceAdvisorAction", entityId: current.id, metadata: { from: current.status, to: data.status },
    });
  }
  return updated;
}

// ── Copiloto ─────────────────────────────────────────────────────────────────

/**
 * Bloque para el system prompt del copiloto cuando el Director está en su
 * pantalla: el criterio del asesor + el informe abierto, resumido. Devuelve
 * null si no corresponde (otro usuario, informe ajeno o inexistente).
 */
export async function buildAdvisorCopilotBlock(session: TenantAccessSession, reportId: string | null | undefined): Promise<string | null> {
  if (!isMaintenanceDirector(session)) return null;
  const persona = `You are acting as the CMS3 Technical Manager Advisor for the Director de Mantenimiento (Technical Manager): a senior advisor, auditor and coach. Prioritize by risk, separate facts from interpretation, never invent data, say "Insufficient information to reach a reliable conclusion" when evidence is missing, and advise how to manage each issue with the people involved (what, why, who, when, evidence required, escalation). Name vessels by name, never by code.`;
  if (!reportId) return persona;
  try {
    const prisma = db();
    const tenantId = await resolveTenantId(session);
    const report = await prisma.maintenanceAdvisorReport.findFirst({ where: { id: reportId, tenantId } });
    if (!report) return persona;
    // Planes ajustados por el Director con el asesor: mandan sobre el original.
    const applied = await prisma.maintenanceAdvisorMessage.findMany({
      where: { tenantId, reportId, appliedAt: { not: null } },
      orderBy: { appliedAt: "asc" },
      select: { findingKey: true, proposal: true },
    });
    const adjusted = new Map<string, AdvisorProposal>(applied.map((m: any) => [m.findingKey, m.proposal as AdvisorProposal]));
    const findings = (report.findings as AdvisorFinding[]).map(f => {
      const p = adjusted.get(f.key);
      return {
        key: f.key, priority: f.priority, title: f.title, vessels: f.vessels, facts: f.facts, assessment: f.assessment,
        action: p?.action ?? f.recommendedAction, responsible: p?.who ?? f.responsibleRole, target: p?.when ?? f.target,
        planAdjustedByManager: !!p, systemic: f.systemic, noEvidence: f.noEvidence,
      };
    });
    const evidence = (report.evidence as EvidenceItem[]).map(e => ({ id: e.id, code: e.code, vessel: e.vesselName, asset: e.assetName, date: e.date, title: e.title, detail: e.detail }));
    return `${persona}\n\nOPEN ADVISOR REPORT (${new Date(report.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC). Answer follow-up questions about it; you may also query CMS3 with your tools for anything else.\n${JSON.stringify({ metrics: report.metrics, summary: report.summary, findings, insufficient: report.insufficient, evidence }).slice(0, 30_000)}`;
  } catch {
    return persona;
  }
}
