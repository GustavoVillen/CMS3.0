// Lector por IA de informes de ENSAYOS ELÉCTRICOS de un contratista:
// RESISTENCIA DE AISLACIÓN (megado) y TERMOGRAFÍA.
//
// Igual que el de vibraciones, cada informe es una campaña sobre varios equipos
// del buque (p. ej. ELECTROPATCO megó en una visita 23 motores y fotografió 13
// guardamotores del tablero principal), con una tabla o una sección por punto.
//
// Qué se mide define a qué equipo va cada punto:
//   - EQUIPMENT: cada punto a su equipo. El megado es siempre así, sea de
//     motores o de los conductores medidos desde el tablero.
//   - PANEL: termografía de guardamotores de un tablero → todo al tablero.
//
// La IA sólo LEE la palabra del analista para cada punto. La traducción al
// veredicto del sistema se hace en código (`verdictForElectricalLevel`).
import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { RouteError } from "../../http/route-error";
import type { TenantAccessSession } from "../auth/session-store";
import { getCachedTenantBySlug } from "../tenant-cache";
import { recordAiUsage, assertAiBudgetAvailableBySlug } from "../usage/usage-service";
import type { Verdict } from "./fluid-analyses-service";

export type ElectricalTestKind = "INSULATION" | "THERMAL";

/**
 * Resultado de un punto, en la escala del analista.
 *   Megado:      OK · OBSERVED (observado / marginal) · FAIL (no apto, bajo el mínimo)
 *   Termografía (ANSI/NETA): OK (satisfactorio) · POSSIBLE (nivel 1) · PROBABLE (nivel 2)
 *                · DEFICIENCY (nivel 3) · MAJOR (nivel 4)
 *   Los dos:     NOT_MEASURED (no conectado, sin acceso) · NONE (el informe no escribió resultado)
 */
export type ElectricalTestLevel =
  | "OK" | "OBSERVED" | "FAIL"
  | "POSSIBLE" | "PROBABLE" | "DEFICIENCY" | "MAJOR"
  | "NOT_MEASURED" | "NONE";

const LEVELS: readonly ElectricalTestLevel[] = [
  "OK", "OBSERVED", "FAIL", "POSSIBLE", "PROBABLE", "DEFICIENCY", "MAJOR", "NOT_MEASURED", "NONE",
];

export interface ElectricalTestItem {
  /** El equipo o circuito medido, tal cual ("Bomba trasvase de combustible", "Extractor Ebr"). */
  equipmentText: string;
  /** Tablero donde se midió, si el informe lo dice ("Tablero Principal (Sala de Máquinas)"). */
  panelText: string | null;
  level: ElectricalTestLevel;
  /** La palabra literal del analista ("OK*", "NC", "Probable Deficiencia"). */
  resultText: string | null;
  /** Observación del analista para ese punto, en una frase. */
  finding: string | null;
  parameters: Record<string, { value: number | string; unit?: string }>;
}

export interface ElectricalTestReport {
  scope: "EQUIPMENT" | "PANEL";
  vesselReferenceText: string | null;
  labName: string | null;
  reportNumber: string | null;
  testedAt: string | null;   // YYYY-MM-DD — fecha de la inspección, no la de emisión
  /** Conclusión o recomendación general del informe. */
  conclusion: string | null;
  items: ElectricalTestItem[];
  notes: string | null;
}

const COMMON_HEAD = `Devolvé EXCLUSIVAMENTE este JSON, sin markdown ni texto alrededor:
{
  "scope": "EQUIPMENT"|"PANEL",         // sólo termografía (ver abajo); en megado poné "EQUIPMENT"
  "vesselReferenceText": string|null,   // cómo nombra al buque (ej "REMOLCADOR DE EMPUJE MAO 01")
  "labName": string|null,               // empresa que firma (ej "ELECTROPATCO S.R.L.")
  "reportNumber": string|null,          // "DOCUMENTO No" (ej "0082-002-IT-01-R0")
  "testedAt": "YYYY-MM-DD"|null,        // fecha de INSPECCIÓN (no la de emisión del documento). Las fechas del informe son día/mes/año.
  "conclusion": string|null,            // conclusión o recomendación general, en 1 a 3 frases
  "items": [
    {
      "equipmentText": string,          // el equipo o circuito medido TAL CUAL, con el lado si figura ("Extractor de chimenea babor")
      "panelText": string|null,         // tablero donde se midió, con su ubicación si figura ("Tablero Principal (Sala de Máquinas)")
      "level": <ver escala>,
      "resultText": string|null,        // la palabra literal del analista para ese punto ("OK", "OK*", "NC", "Probable Deficiencia")
      "finding": string|null,           // observación del analista para ese punto, en una frase de hasta 200 caracteres; null si sólo dice que está bien
      "parameters": { "<clave>": { "value": number|string, "unit": string } }
    }
  ],
  "notes": string|null
}

REGLAS COMUNES:
- UN item por fila de la tabla o por sección del informe. No juntes ni inventes equipos.
- Números con punto decimal (24,1 → 24.1). Valores con signo ("> 2000") van como string tal cual (">2000").
- Ignorá el anexo fotográfico, los datos del instrumento y las tablas de especificación del equipo de medición.
- Si el documento no es de este tipo de ensayo, devolvé "items": [] y explicá en "notes".`;

const PROMPTS: Record<ElectricalTestKind, string> = {
  INSULATION: `Sos un electricista naval. Leés informes de RESISTENCIA DE AISLACIÓN (megado) de motores, conductores y tableros de a bordo.

${COMMON_HEAD}

ESCALA "level" — la columna de resultado ("RES.") del analista, sin reinterpretar los valores:
  "OK" / "OK*" / "Satisfactorio" → OK
  "Observado" / "Marginal" / "Revisar" → OBSERVED
  "No OK" / "Falla" / "Rechazado" / "Bajo" / "No apto" → FAIL
  "NC" / "No conectado" / "Sin acceso", o todos los valores con "-" → NOT_MEASURED
  Celda de resultado vacía → NONE, aunque los valores sean buenos: mirá la celda de CADA fila, no copies la de la fila de al lado.

PARÁMETROS de cada item: cada par medido con la clave TAL CUAL la columna ("R-S", "S-T", "T-R", "RST-M", "R-M", "S-M", "T-M", "L-M", "N-M"), unidad "MΩ". Omití las celdas con "-". No incluyas temperatura ni potencia.`,

  THERMAL: `Sos un termografista naval. Leés informes de INSPECCIÓN TERMOGRÁFICA de tableros y equipos eléctricos de a bordo.

${COMMON_HEAD}

Cada sección de medición (ej "4.3 EXTRACTOR BABOR") es un item: el equipo cuyo guardamotor o conexión se midió.

"scope" — qué se fotografió, según el informe (título, descripción, "Ubicación"):
  "PANEL" si se midió en los tableros: guardamotores, contactores, interruptores, borneras (ej "inspección termográfica de los tableros eléctricos", "Ubicación: Tablero Principal").
  "EQUIPMENT" si se midieron los equipos en sí (carcasa del motor, rodamientos, acoples).
  En "PANEL", "panelText" es obligatorio en cada item: si la sección no lo dice, usá el tablero general del informe.

ESCALA "level" — la clasificación del analista (criterio ANSI/NETA). Si la sección clasifica varias fases, usá la PEOR:
  "Satisfactorio" → OK
  "Posible Deficiencia" (nivel 1) → POSSIBLE
  "Probable Deficiencia" (nivel 2) → PROBABLE
  "Deficiencia" (nivel 3) → DEFICIENCY
  "Deficiencia Mayor" (nivel 4) → MAJOR
  Sin clasificación escrita → NONE
  En "resultText" poné la palabra de esa peor fase y la fase ("Probable Deficiencia (L3)").

PARÁMETROS de cada item, en °C (las tres claves son obligatorias si la sección trae el dato):
  "delta_t_max" → la MAYOR de las diferencias entre puntos similares (Ds1, Ds2, … de la sección)
  "t_max"       → la mayor temperatura medida (Sp1, Sp2, …) de la sección
  "t_ambient"   → la temperatura ambiente de la sección`,
};

/**
 * Claves de termografía → nombre legible. Se le piden a la IA en ASCII porque
 * con "ΔT" en la clave el modelo la omitía; se guardan con el nombre que usa el
 * informe, que es lo que se muestra en la ficha y en el PDF.
 */
const THERMAL_KEYS: Record<string, string> = {
  delta_t_max: "ΔT máx",
  t_max: "T máx",
  t_ambient: "T ambiente",
};

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function extractElectricalTestReport(
  session: TenantAccessSession,
  input: { buffer: Buffer; mime: string; kind: ElectricalTestKind; vesselCode?: string | null },
): Promise<ElectricalTestReport> {
  const apiKey = aiApiKey();
  if (!apiKey) throw new RouteError(503, "AI_NOT_CONFIGURED", aiApiKeyName() + " no esta configurada.");

  const { buffer, mime } = input;
  const isImage = ALLOWED_IMAGE_MIMES.has(mime);
  if (!isImage && mime !== "application/pdf") {
    throw new RouteError(415, "UNSUPPORTED_MEDIA", `Tipo no soportado: ${mime}. Use PDF, JPG, PNG, GIF o WebP.`);
  }

  await assertAiBudgetAvailableBySlug(session.tenantSlug);
  // Lo normal son 5–20 s. Si el proveedor se cuelga, se corta a los 60 s y se
  // reintenta una vez: más espera no entra en los 120 s del proxy de producción.
  const client = createAiClient({ apiKey, timeout: 60_000, maxRetries: 1 });
  const base64 = buffer.toString("base64");
  const fileBlock = (isImage
    ? { type: "image", source: { type: "base64", media_type: mime, data: base64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
  ) as unknown as Anthropic.ContentBlockParam;

  const model = AI_MODEL.fast;
  const started = Date.now();
  const response = await client.messages.create({
    model,
    // Un item por fila con sus mediciones: un megado de 25 motores pasa holgado.
    max_tokens: 8000,
    system: [{ type: "text", text: PROMPTS[input.kind], cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: [fileBlock, { type: "text", text: "Extraé los puntos medidos del informe adjunto y devolvé únicamente el JSON." }],
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
    throw new RouteError(502, "AI_PARSE_ERROR", "La IA devolvió una respuesta inválida al leer el informe.");
  }

  const items: ElectricalTestItem[] = [];
  for (const raw of Array.isArray(parsed?.items) ? parsed.items : []) {
    const equipmentText = normStr(raw?.equipmentText);
    if (!equipmentText) continue;
    items.push({
      equipmentText,
      panelText: normStr(raw?.panelText),
      level: pickLevel(raw?.level),
      resultText: normStr(raw?.resultText),
      finding: normStr(raw?.finding),
      parameters: shapeParameters(raw?.parameters, input.kind === "THERMAL" ? THERMAL_KEYS : {}),
    });
  }

  return {
    // El megado es siempre de un equipo: aunque se mida desde el tablero, lo que
    // se mide es el bobinado o el cable de ese consumidor, y va a su historia.
    // La termografía de guardamotores va al tablero (decisión de Gustavo, sep 2026).
    scope: input.kind === "THERMAL" && parsed?.scope === "PANEL" ? "PANEL" : "EQUIPMENT",
    vesselReferenceText: normStr(parsed?.vesselReferenceText),
    labName: normStr(parsed?.labName),
    reportNumber: normStr(parsed?.reportNumber),
    testedAt: normDate(parsed?.testedAt),
    conclusion: normStr(parsed?.conclusion),
    items,
    notes: normStr(parsed?.notes),
  };
}

/**
 * Escala del analista → veredicto del sistema (acordada con Gustavo, sep 2026).
 * En el sistema "Acción requerida" es el escalón más grave (defecto CRITICAL) y
 * "Crítico" el anterior (defecto HIGH); los dos abren el defecto solos.
 *
 *   Termografía: Satisfactorio → NORMAL · Posible → CAUTION · Probable → CRITICAL
 *                · Deficiencia y Deficiencia mayor → ACTION_REQUIRED
 *   Megado:      OK → NORMAL · Observado → CAUTION · No apto → CRITICAL
 *
 * Lo no medido y lo que no tiene resultado escrito no cuenta: devuelve null.
 */
export function verdictForElectricalLevel(level: ElectricalTestLevel): Verdict | null {
  switch (level) {
    case "OK":           return "NORMAL";
    case "OBSERVED":
    case "POSSIBLE":     return "CAUTION";
    case "FAIL":
    case "PROBABLE":     return "CRITICAL";
    case "DEFICIENCY":
    case "MAJOR":        return "ACTION_REQUIRED";
    case "NOT_MEASURED":
    case "NONE":         return null;
  }
}

/** Un punto que el analista marcó (no está bien, pero sí se midió). */
export function isFlaggedLevel(level: ElectricalTestLevel): boolean {
  const v = verdictForElectricalLevel(level);
  return v !== null && v !== "NORMAL";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pickLevel(v: unknown): ElectricalTestLevel {
  const s = String(v ?? "").toUpperCase();
  return (LEVELS as readonly string[]).includes(s) ? (s as ElectricalTestLevel) : "NONE";
}

function shapeParameters(raw: unknown, rename: Record<string, string>): ElectricalTestItem["parameters"] {
  const out: ElectricalTestItem["parameters"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    const k = rename[key.trim()] ?? key.trim();
    if (!k || !rawVal || typeof rawVal !== "object") continue;
    const r = rawVal as { value?: unknown; unit?: unknown };
    let value: number | string | null = null;
    if (typeof r.value === "number" && Number.isFinite(r.value)) value = r.value;
    else if (typeof r.value === "string" && r.value.trim() && r.value.trim() !== "-") {
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
