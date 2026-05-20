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
  es: "español",
  en: "English",
  pt: "português do Brasil",
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
 */
export function localeInstruction(locale: AiLocale): string {
  const lang = LANGUAGE_LABEL[locale];
  return `IDIOMA DE RESPUESTA OBLIGATORIO: Toda salida en lenguaje natural (descripciones, sugerencias, bullets, explicaciones, preguntas, mensajes al usuario) DEBE estar en ${lang}. Los valores de enums técnicos (CRITICAL, HIGH, MEDIUM, LOW, OPERATIONAL, etc.) y claves JSON se mantienen en inglés/originales.`;
}
