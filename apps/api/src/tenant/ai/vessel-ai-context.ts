// Contexto del buque para los prompts de IA.
//
// Sin esto, todo servicio de IA asume un buque autopropulsado y tripulado, y
// escribe barbaridades en una flota fluvial: llamó "propulsión principal" al
// motor de la bomba de descarga en las 30 barcazas de mercurio (ago 2026), y el
// análisis de riesgo de una tarea en barcaza vacía razonaba sobre tripulantes
// que no están a bordo.
//
// Regla de uso: el SERVICIO de IA resuelve el contexto por su cuenta a partir
// del vesselCode que ya recibe. No se delega en el caller — así el botón de la
// pantalla, el endpoint y los scripts de carga masiva se comportan igual. Si el
// servicio no sabe de qué buque habla, devuelve null y el prompt sigue como
// antes (sin contexto, nunca con uno inventado).
//
// Cachea 5 minutos como tenant-cache: los datos del buque no cambian y esto se
// llama una vez por sugerencia de IA.

import { getPrismaClient } from "../../platform/data/prisma-client";
import { getCachedTenantBySlug } from "../tenant-cache";

interface VesselFacts {
  name: string;
  vesselType: string | null;
  isCrewed: boolean | null;
}

interface Entry {
  value: string | null;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, Entry>();

/** ¿Lleva gente a bordo? El campo declarado manda; si no está, se deduce del
 *  tipo (texto libre). Una barcaza no lleva dotación permanente. */
function crewed(v: VesselFacts): boolean | null {
  if (v.isCrewed !== null) return v.isCrewed;
  const t = (v.vesselType ?? "").toLowerCase();
  if (t.includes("barcaza") || t.includes("barge")) return false;
  if (t.includes("remolcador") || t.includes("empuje") || t.includes("tug")) return true;
  return null;
}

function describe(v: VesselFacts): string {
  const tipo = (v.vesselType ?? "").trim();
  const t = tipo.toLowerCase();
  const partes: string[] = [];

  if (t.includes("barcaza") || t.includes("barge")) {
    partes.push(
      `${v.name} es una barcaza${tipo ? ` (${tipo})` : ""} de navegación fluvial:` +
      ` NO tiene propulsión ni gobierno propios, la empuja o remolca un remolcador en convoy.`,
    );
  } else if (t.includes("remolcador") || t.includes("empuje") || t.includes("tug")) {
    partes.push(`${v.name} es un remolcador${tipo ? ` (${tipo})` : ""} de río: autopropulsado, empuja convoyes de barcazas.`);
  } else {
    partes.push(`${v.name}${tipo ? ` — tipo: ${tipo}` : ""}.`);
  }

  const c = crewed(v);
  if (c === false) {
    partes.push(
      `NO es tripulada: no hay dotación permanente a bordo, el trabajo se hace en visitas programadas.` +
      ` Una falla a bordo no expone a nadie en el momento, pero tampoco hay quien la detecte hasta la próxima visita.`,
    );
  } else if (c === true) {
    partes.push(`Es tripulada: hay dotación permanente a bordo.`);
  }

  return partes.join(" ");
}

/**
 * Frase corta que describe el buque, lista para meter en un prompt.
 * Devuelve null si no hay buque, no hay base, o el buque no existe.
 */
export async function getVesselAiContext(
  tenantSlug: string,
  vesselCode: string | null | undefined,
): Promise<string | null> {
  const code = String(vesselCode ?? "").trim();
  if (!code || !tenantSlug) return null;

  const key = `${tenantSlug}::${code}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  let value: string | null = null;
  try {
    const prisma = getPrismaClient();
    const tenant = await getCachedTenantBySlug(tenantSlug);
    if (prisma && tenant) {
      const row = await (prisma as unknown as {
        vessel: { findFirst(args: unknown): Promise<VesselFacts | null> };
      }).vessel.findFirst({
        where: { tenantId: tenant.id, code },
        select: { name: true, vesselType: true, isCrewed: true },
      });
      if (row) value = describe(row);
    }
  } catch {
    // El contexto es un extra: si falla, la sugerencia se genera igual.
    value = null;
  }

  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/** Invalidar cuando se edita el buque (tipo o tripulación). */
export function invalidateVesselAiContext(tenantSlug: string, vesselCode?: string): void {
  if (vesselCode) cache.delete(`${tenantSlug}::${vesselCode}`);
  else for (const k of [...cache.keys()]) if (k.startsWith(`${tenantSlug}::`)) cache.delete(k);
}
