// Lector por IA de informes de ANÁLISIS DE VIBRACIONES.
//
// Por qué no es el mismo extractor que el de fluidos: el reporte de aceite es de
// UN equipo (una muestra, un veredicto). El informe de vibraciones es de una
// campaña de medición sobre varios equipos del buque — p. ej. AB VIB mide en una
// sola visita los 4 motores, las 4 cajas reductoras y los 4 ejes porta hélice, y
// entrega una tabla con una fila por equipo, cada una con su severidad, su
// recomendación y su prioridad. Forzar eso a "un equipo" es lo que fallaba.
//
// Acá la IA sólo LEE: devuelve la severidad con la palabra del analista
// (Ninguna/Normal/Alerta/Alarma). La traducción al veredicto del sistema se hace
// en código (`verdictForVibrationSeverity`) para que no dependa de la lectura del
// modelo y sea la misma siempre.
import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import type { Verdict } from "./fluid-analyses-service";

export type VibrationSeverity = "NONE" | "NORMAL" | "ALERT" | "ALARM";
export type VibrationPriority = "NONE" | "SCHEDULED" | "NORMAL" | "URGENT";

export interface VibrationReportItem {
  /** Cómo nombra el informe al equipo, tal cual ("Reductor 4", "Eje porta hélice 1 (Babor)"). */
  assetReferenceText: string;
  severity: VibrationSeverity;
  priority: VibrationPriority;
  /** Texto de la columna "Falla" (hallazgo), sin los valores que ya van en parameters. */
  finding: string | null;
  /** Texto de la columna "Recomendación". */
  recommendation: string | null;
  parameters: Record<string, { value: number | string; unit?: string }>;
}

export interface VibrationReport {
  vesselReferenceText: string | null;
  labName: string | null;
  reportNumber: string | null;
  sampledAt: string | null;   // YYYY-MM-DD — fecha de la medición
  items: VibrationReportItem[];
  notes: string | null;
}

const SYSTEM_PROMPT = `Sos un analista de vibraciones naval. Leés informes de ANÁLISIS DE VIBRACIONES de maquinaria de a bordo (motores, cajas reductoras, ejes porta hélice, bombas, generadores).

Un informe de vibraciones cubre VARIOS EQUIPOS: tiene una tabla con una fila por equipo (columnas típicas: Equipo, Falla, Severidad, Recomendación, Prioridad). Puede tener varias hojas/tablas (ej. una de "Propulsores" y otra de "Ejes portahélices").

Devolvé EXCLUSIVAMENTE este JSON, sin markdown ni texto alrededor:
{
  "vesselReferenceText": string|null,   // cómo nombra al buque (ej "REMOLCADOR: LA TERE")
  "labName": string|null,               // empresa o analista que firma (ej "AB VIB - Ing. Aníbal Benítez")
  "reportNumber": string|null,          // "INFORME N.º" (ej "1/2026")
  "sampledAt": "YYYY-MM-DD"|null,       // fecha de la medición (la del título de la tabla o la de los espectros)
  "items": [
    {
      "assetReferenceText": string,     // nombre del equipo TAL CUAL + el lado si figura: "Motor Diesel 1 (Babor)", "Reductor 4", "Eje porta hélice (Estribor)"
      "severity": "NONE"|"NORMAL"|"ALERT"|"ALARM",
      "priority": "NONE"|"SCHEDULED"|"NORMAL"|"URGENT",
      "finding": string|null,           // hallazgo/diagnóstico en una o dos frases (ej "Espectro muestra 1XRPM, síntoma de desbalance")
      "recommendation": string|null,    // recomendación del analista, ítems separados por " · "
      "parameters": { "<clave>": { "value": number, "unit": string } }
    }
  ],
  "notes": string|null
}

REGLAS:
- UN item por equipo. Si el mismo equipo aparece en dos tablas (ej. "Eje porta hélice 2" medido en la bocina y además su desplazamiento), juntá todo en un solo item: parámetros de las dos, la severidad y la prioridad MÁS altas, y los textos unidos.
- Si una fila dice "Eje porta hélice (Estribor)" sin número, es el eje del lado estribor: poné "Eje porta hélice (Estribor)" y, si por el orden de la tabla es el último número (ej. 4), agregalo: "Eje porta hélice 4 (Estribor)".
- Severidad — la palabra del analista, sin reinterpretar los valores:
  "Ninguna" / vacío → NONE · "Normal" → NORMAL · "Alerta" → ALERT · "Alarma" → ALARM
- Prioridad: "Ninguna" → NONE · "Programado" → SCHEDULED · "Normal" → NORMAL · "Urgente" → URGENT
- Parámetros: números con punto decimal (4,2 → 4.2). Claves en minúsculas, con el punto de medición:
  anclajes → "anchor_velocity" (mm/s)
  eje entrada radial/axial → "input_shaft_radial_velocity", "input_shaft_axial_velocity" (mm/s)
  aceleración → "acceleration" (m/s²; si el informe pone mm/s2 usá la unidad tal cual)
  bocina → "stern_tube_velocity" (mm/s)
  desplazamiento horizontal/vertical → "displacement_horizontal", "displacement_vertical" (mm)
  otros puntos: armá la clave con el mismo criterio (punto_magnitud).
- No inventes equipos que no estén en las tablas. Ignorá los gráficos de espectro salvo para leer la fecha.
- Si el documento no es un informe de vibraciones, devolvé "items": [] y explicá en "notes".`;

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function extractVibrationReport(
  session: TenantAccessSession,
  input: { buffer: Buffer; mime: string; vesselCode?: string | null },
): Promise<VibrationReport> {
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  const { buffer, mime } = input;
  const isImage = ALLOWED_IMAGE_MIMES.has(mime);
  if (!isImage && mime !== "application/pdf") {
    throw new RouteError(415, "UNSUPPORTED_MEDIA", `Tipo no soportado: ${mime}. Use PDF, JPG, PNG, GIF o WebP.`);
  }

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  const client = createAiClient({ apiKey, timeout: 90_000, maxRetries: 1 });
  const base64 = buffer.toString("base64");
  const fileBlock = (isImage
    ? { type: "image", source: { type: "base64", media_type: mime, data: base64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
  ) as unknown as Anthropic.ContentBlockParam;

  const model = AI_MODEL.fast;
  const started = Date.now();
  const response = await client.messages.create({
    model,
    // Un item por equipo con sus textos: un informe de 12 equipos pasa holgado
    // los 2048 que usa el extractor de fluidos.
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: [fileBlock, { type: "text", text: "Extraé los equipos del informe de vibraciones adjunto y devolvé únicamente el JSON." }],
    }],
  });

  (async () => {
    const tenant = await getCachedTenantBySlug(session.tenantSlug);
    if (!tenant) return;
    recordAiUsage({
      tenantId:            tenant.id,
      tenantSlug:          session.tenantSlug,
      userId:              session.user.id,
      userEmail:           session.user.email,
      vesselCode:          input.vesselCode ?? null,
      feature:             "fluid_analyses",
      model,
      inputTokens:         response.usage.input_tokens,
      outputTokens:        response.usage.output_tokens,
      cacheReadTokens:     response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      latencyMs:           Date.now() - started,
    });
  })().catch(() => { /* swallow */ });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida al leer el informe de vibraciones.");
  }

  const items: VibrationReportItem[] = [];
  for (const raw of Array.isArray(parsed?.items) ? parsed.items : []) {
    const ref = normStr(raw?.assetReferenceText);
    if (!ref) continue;
    items.push({
      assetReferenceText: ref,
      severity: pick(raw?.severity, ["NONE", "NORMAL", "ALERT", "ALARM"], "NONE"),
      priority: pick(raw?.priority, ["NONE", "SCHEDULED", "NORMAL", "URGENT"], "NONE"),
      finding: normStr(raw?.finding),
      recommendation: normStr(raw?.recommendation),
      parameters: shapeParameters(raw?.parameters),
    });
  }

  return {
    vesselReferenceText: normStr(parsed?.vesselReferenceText),
    labName: normStr(parsed?.labName),
    reportNumber: normStr(parsed?.reportNumber),
    sampledAt: normDate(parsed?.sampledAt),
    items,
    notes: normStr(parsed?.notes),
  };
}

/**
 * Escala del analista → veredicto del sistema. En el sistema "Acción requerida"
 * es el escalón más grave (el defecto automático sale con gravedad CRITICAL) y
 * "Crítico" el anterior (defecto HIGH).
 *
 *   Ninguna → NORMAL · Normal ("Vigilar", operable hasta el mantenimiento) → CAUTION
 *   Alerta (operable con bajo desempeño) → CRITICAL · Alarma (no operable) → ACTION_REQUIRED
 */
export function verdictForVibrationSeverity(severity: VibrationSeverity): Verdict {
  switch (severity) {
    case "NONE":   return "NORMAL";
    case "NORMAL": return "CAUTION";
    case "ALERT":  return "CRITICAL";
    case "ALARM":  return "ACTION_REQUIRED";
  }
}

const SEVERITY_RANK: Record<VibrationSeverity, number> = { NONE: 0, NORMAL: 1, ALERT: 2, ALARM: 3 };
const PRIORITY_RANK: Record<VibrationPriority, number> = { NONE: 0, SCHEDULED: 1, NORMAL: 2, URGENT: 3 };

export function worseSeverity(a: VibrationSeverity, b: VibrationSeverity): VibrationSeverity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

export function worsePriority(a: VibrationPriority, b: VibrationPriority): VibrationPriority {
  return PRIORITY_RANK[b] > PRIORITY_RANK[a] ? b : a;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = String(v ?? "").toUpperCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

function shapeParameters(raw: unknown): VibrationReportItem["parameters"] {
  const out: VibrationReportItem["parameters"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    if (!k || !rawVal || typeof rawVal !== "object") continue;
    const r = rawVal as { value?: unknown; unit?: unknown };
    let value: number | string | null = null;
    if (typeof r.value === "number" && Number.isFinite(r.value)) value = r.value;
    else if (typeof r.value === "string" && r.value.trim()) {
      const n = Number(r.value.replace(",", "."));
      value = Number.isFinite(n) ? n : r.value.trim();
    }
    if (value === null) continue;
    out[k] = { value, ...(typeof r.unit === "string" && r.unit.trim() ? { unit: r.unit.trim() } : {}) };
  }
  return out;
}

function normStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function normDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
