/**
 * Helpers compartidos por las herramientas de consulta del copiloto.
 *
 * El catálogo de tools está partido en dos archivos por tamaño:
 *   - `copiloto-service.ts`  → tools núcleo (planes, OT, defectos, repuestos, …)
 *   - `copilot-tools.ts`     → resto de los módulos (certificados, inspecciones, SS, …)
 * Ambos usan estos helpers; viven acá para no duplicarlos ni crear un import circular.
 */

// ---------------------------------------------------------------------------
// Untrusted-data wrapper — usado para vallar contenido controlado por el usuario.
// Sanitiza cualquier intento interno de cerrar el tag y después envuelve.
// ---------------------------------------------------------------------------

export function wrapUntrusted(text: string): string {
  // Neutraliza intentos de forjar tags insertando zero-width chars.
  // El modelo sigue leyendo el dato; un atacante no puede cerrar el tag antes de tiempo.
  const sanitized = text
    .replace(/<\/untrusted_data>/gi, "<​/untrusted_data>")
    .replace(/<untrusted_data>/gi, "<​untrusted_data>");
  return `<untrusted_data>${sanitized}</untrusted_data>`;
}

// ---------------------------------------------------------------------------
// Scope de buques
// ---------------------------------------------------------------------------

/**
 * Scope de buques accesibles por el usuario actual. Si `unrestricted` es true
 * (TENANT_ADMIN), el copiloto puede consultar toda la flota. En cualquier otro
 * caso, las queries se acotan a `codes` y los pedidos a un vessel fuera de la
 * lista devuelven un mensaje de "acceso denegado" que la IA debe respetar.
 */
export interface VesselScope {
  unrestricted: boolean;
  codes: string[];
}

export function deniedVesselResponse(vesselCode: string, scope: VesselScope): string {
  return JSON.stringify({
    error: "ACCESS_DENIED",
    message: `User does not have access to vessel ${vesselCode}. Accessible vessels: ${scope.codes.length > 0 ? scope.codes.join(", ") : "(none)"}.`,
  });
}

/**
 * Aplica el scope de buques sobre un `where` que tiene columna `vesselCode`.
 * Fail-closed: sin buques asignados no se devuelve nada.
 */
export function applyVesselWhereScope(
  where: Record<string, unknown>,
  rawVessel: unknown,
  scope: VesselScope,
): { ok: true } | { ok: false; reason: string } {
  if (scope.unrestricted) {
    if (typeof rawVessel === "string" && rawVessel) where.vesselCode = rawVessel;
    return { ok: true };
  }
  if (scope.codes.length === 0) {
    return { ok: false, reason: deniedVesselResponse(typeof rawVessel === "string" ? rawVessel : "(any)", scope) };
  }
  if (typeof rawVessel === "string" && rawVessel) {
    if (!scope.codes.includes(rawVessel)) {
      return { ok: false, reason: deniedVesselResponse(rawVessel, scope) };
    }
    where.vesselCode = rawVessel;
    return { ok: true };
  }
  where.vesselCode = { in: scope.codes };
  return { ok: true };
}

/**
 * Igual que `applyVesselWhereScope` pero para modelos cuya columna de buque NO
 * se llama `vesselCode` (p. ej. `Vessel.code`, `SpareRequest.requestedForVesselCode`).
 */
export function applyVesselWhereScopeOn(
  where: Record<string, unknown>,
  field: string,
  rawVessel: unknown,
  scope: VesselScope,
): { ok: true } | { ok: false; reason: string } {
  if (scope.unrestricted) {
    if (typeof rawVessel === "string" && rawVessel) where[field] = rawVessel;
    return { ok: true };
  }
  if (scope.codes.length === 0) {
    return { ok: false, reason: deniedVesselResponse(typeof rawVessel === "string" ? rawVessel : "(any)", scope) };
  }
  if (typeof rawVessel === "string" && rawVessel) {
    if (!scope.codes.includes(rawVessel)) {
      return { ok: false, reason: deniedVesselResponse(rawVessel, scope) };
    }
    where[field] = rawVessel;
    return { ok: true };
  }
  where[field] = { in: scope.codes };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Búsqueda por palabras clave
// ---------------------------------------------------------------------------

/**
 * Arma el fragmento de `where` para una búsqueda por texto: cada palabra de >=3
 * caracteres debe aparecer como substring en alguno de los campos (AND de OR).
 * Así el orden de las palabras y los términos de relleno no impiden el match.
 * Devuelve `null` si no hay texto que buscar.
 */
export function textSearchWhere(raw: unknown, fields: string[]): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const tokens = raw.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 3);
  if (tokens.length > 0) {
    return {
      AND: tokens.map(tok => ({
        OR: fields.map(f => ({ [f]: { contains: tok, mode: "insensitive" } })),
      })),
    };
  }
  return { OR: fields.map(f => ({ [f]: { contains: raw, mode: "insensitive" } })) };
}

// ---------------------------------------------------------------------------
// Enriquecimiento de resultados
// ---------------------------------------------------------------------------

/**
 * Enriquece filas que traen un assetId crudo (cuid) con el nombre legible del
 * activo. Sin esto la IA solo ve "cmqo9d2y601clo6l4s403ej0i" y termina
 * mostrándole al usuario el ID interno de la base — que no significa nada para
 * él. Varios modelos guardan assetId como String suelto (sin @relation), así
 * que se resuelve con un findMany + map.
 */
export async function attachAssetNames<T extends { assetId?: string | null }>(
  prisma: any,
  tenantId: string,
  rows: T[],
): Promise<(T & { assetName: string | null; assetCode: string | null })[]> {
  const ids = [...new Set(rows.map(r => r.assetId).filter(Boolean))] as string[];
  const assets = ids.length > 0
    ? await prisma.asset.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, name: true, assetCode: true },
      })
    : [];
  const byId = new Map(assets.map((a: any) => [a.id, a]));
  return rows.map(r => {
    const a: any = r.assetId ? byId.get(r.assetId) : null;
    return { ...r, assetName: a?.name ?? null, assetCode: a?.assetCode ?? null };
  });
}

/**
 * Igual que `attachAssetNames` pero para `providerId` (tampoco tiene @relation
 * forzada en WorkOrder / ServiceRequest).
 */
export async function attachProviderNames<T extends { providerId?: string | null }>(
  prisma: any,
  tenantId: string,
  rows: T[],
): Promise<(T & { providerName: string | null })[]> {
  const ids = [...new Set(rows.map(r => r.providerId).filter(Boolean))] as string[];
  const providers = ids.length > 0
    ? await prisma.provider.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, name: true },
      })
    : [];
  const byId = new Map(providers.map((p: any) => [p.id, p]));
  return rows.map(r => ({ ...r, providerName: r.providerId ? ((byId.get(r.providerId) as any)?.name ?? null) : null }));
}

/**
 * Estado de vigencia calculado a partir de una fecha de vencimiento.
 * EXPIRING_SOON = vence dentro de los próximos `soonDays` días (default 30).
 */
export function expiryStatus(
  expiry: Date | string | null | undefined,
  soonDays = 30,
): "EXPIRED" | "EXPIRING_SOON" | "VALID" {
  if (!expiry) return "VALID";
  const diffDays = Math.floor((new Date(expiry).getTime() - Date.now()) / 86_400_000);
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= soonDays) return "EXPIRING_SOON";
  return "VALID";
}

export function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  return Math.floor((new Date(date).getTime() - Date.now()) / 86_400_000);
}

/** Serializa el resultado de una tool: vallado como dato no confiable. */
export function toolResult(rows: unknown[], emptyMessage: string): string {
  return wrapUntrusted(JSON.stringify(rows.length > 0 ? rows : { message: emptyMessage }));
}
