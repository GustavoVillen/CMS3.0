// Locale awareness para servicios IA.
//
// Todos los servicios IA del tenant deben llamar a `getTenantAiLocale(slug)`
// y prefijar el system prompt con `localeInstruction(locale)` para que la
// respuesta de Claude esté en el idioma del tenant — no en el idioma
// hardcodeado del prompt.

import { getCachedTenantBySlug } from "../tenant-cache";

export type AiLocale = "es" | "en" | "pt";

const SUPPORTED: AiLocale[] = ["es", "en", "pt"];

function normalize(value: string | null | undefined): AiLocale | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (SUPPORTED.includes(lower as AiLocale)) return lower as AiLocale;
  return null;
}

/**
 * Resuelve el locale activo del tenant para respuestas IA.
 * Prioridad: defaultLocale del tenant → primer enabledLocale → "es" fallback.
 */
export async function getTenantAiLocale(tenantSlug: string): Promise<AiLocale> {
  const tenant = await getCachedTenantBySlug(tenantSlug);
  const settings = tenant?.settings;
  const fromDefault = normalize(settings?.defaultLocale ?? null);
  if (fromDefault) return fromDefault;
  const enabled = settings?.enabledLocales ?? [];
  for (const code of enabled) {
    const norm = normalize(code);
    if (norm) return norm;
  }
  return "es";
}

const LANGUAGE_LABEL: Record<AiLocale, string> = {
  es: "español (Spanish)",
  en: "English",
  pt: "português do Brasil (Brazilian Portuguese)",
};

/**
 * Frase que SE DEBE prepender a todo system prompt antes de enviarlo a
 * Claude, para que la salida visible al usuario esté en el idioma del
 * tenant.
 *
 * Va como su propio bloque ANTES del prompt original. Las llamadas a IA
 * que devuelven JSON con enums fijos (CRITICAL, HIGH, etc.) no se ven
 * afectadas — los enums siguen siendo identificadores, sólo se traducen
 * los campos de texto libre (descripcion, reasoning, nextQuestion, etc.).
 *
 * IMPORTANTE: muchos prompts originales tienen ejemplos hardcodeados en
 * español ("Criticidad <X> porque..."). Claude tiende a copiar el idioma
 * del ejemplo más fuerte que la instrucción genérica de idioma. Por eso
 * esta instrucción es EXPLÍCITA: ignora idioma de los ejemplos, usa
 * SIEMPRE el idioma indicado abajo.
 */
export function localeInstruction(locale: AiLocale): string {
  const lang = LANGUAGE_LABEL[locale];
  return `LANGUAGE LOCK / IDIOMA OBLIGATORIO: Toda salida en lenguaje natural (todos los campos de texto libre — descripciones, rationale, sugerencias, bullets, explicaciones, preguntas, mensajes al usuario, justificaciones) DEBE estar en ${lang}. Esta regla anula CUALQUIER ejemplo, plantilla o instrucción posterior que use otro idioma — los ejemplos en otro idioma son sólo referencia de FORMATO, no de IDIOMA. Si ves un ejemplo como "Criticidad B porque..." debés traducirlo al idioma indicado. Los enums técnicos en mayúsculas (CRITICAL, HIGH, MEDIUM, LOW, OPERATIONAL, NORMAL, DEGRADED, etc.), códigos (SFI, ISM, STCW), siglas y claves JSON se mantienen en inglés/originales.`;
}

/**
 * Refuerzo corto para incluir al inicio del mensaje del usuario. Va junto
 * al contenido enviado a la IA y refuerza el idioma — Claude pondera más
 * las instrucciones cercanas al contenido a procesar.
 */
export function localeUserReminder(locale: AiLocale): string {
  const lang = LANGUAGE_LABEL[locale];
  return `[Responde en ${lang}.]`;
}
