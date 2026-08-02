/**
 * Consola de accesos del SUPERADMIN — responde dos preguntas:
 *   1) ¿quién está usando la app ahora mismo, y desde dónde?
 *   2) ¿quién intentó entrar, cuándo, desde dónde, y le salió bien o mal?
 *
 * No graba nada nuevo: se apoya en lo que el sistema ya venía registrando.
 *   - "Conectados ahora" sale de `UsageEvent`, que el middleware de tracking
 *     escribe en cada request autenticado (ver http/usage-tracking-middleware).
 *   - "Historial de ingresos" sale de `AuditEvent`, donde los servicios de auth
 *     publican los LOGIN_SUCCESS / LOGIN_FAILED.
 *
 * Lo único que se agrega acá es la traducción de la IP a un lugar legible
 * (ip-geo-service) y del User-Agent a un dispositivo legible (http/user-agent).
 */

import { getPrismaClient } from "../data/prisma-client";
import { resolveIpGeoMany, type IpGeoInfo } from "./ip-geo-service";
import { describeUserAgent } from "../../http/user-agent";

// ── Tipos de salida ──────────────────────────────────────────────────────────

export interface AccessLocation {
  ipAddress: string | null;
  /** "Asunción, Paraguay" | "Red local" | "—" */
  label: string;
  countryCode: string | null;
  country: string | null;
  city: string | null;
  isp: string | null;
  latitude: number | null;
  longitude: number | null;
  /** "device" = coordenadas del navegador (precisas); "ip" = estimadas por IP. */
  source: "device" | "ip" | null;
}

export interface ActiveUserRow {
  userId: string;
  userEmail: string;
  tenantSlug: string;
  userRole: string | null;
  vesselCode: string | null;
  lastRoute: string | null;
  lastSeenAt: string;
  requestCount: number;
  device: string | null;
  location: AccessLocation;
}

export interface LoginHistoryRow {
  id: string;
  createdAt: string;
  scope: "tenant" | "platform";
  success: boolean;
  tenantSlug: string | null;
  userEmail: string | null;
  userName: string | null;
  userRole: string | null;
  /**
   * True cuando `userEmail` no es un email sino el identificador ofuscado que
   * guarda el audit de los intentos fallidos ("dominio:hash", ver common/pii).
   * La UI lo muestra distinto para que no se lea como un email real.
   */
  userEmailRedacted: boolean;
  /** Motivo del rechazo, cuando lo hay ("wrong_password", "user_not_found"). */
  failureReason: string | null;
  device: string | null;
  location: AccessLocation;
}

export interface LoginHistoryFilters {
  tenantSlug?: string | null;
  userEmail?: string | null;
  /** "success" | "failed" | null (todos) */
  result?: string | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
  offset?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const LOGIN_ACTIONS = [
  "TENANT_LOGIN_SUCCESS",
  "TENANT_LOGIN_FAILED",
  "PLATFORM_LOGIN_SUCCESS",
  "PLATFORM_LOGIN_FAILED",
];

function emptyLocation(ip: string | null): AccessLocation {
  return {
    ipAddress: ip,
    label: ip ? "—" : "Desconocida",
    countryCode: null, country: null, city: null, isp: null,
    latitude: null, longitude: null, source: null,
  };
}

/**
 * Arma la ubicación combinando las dos fuentes disponibles.
 *
 * Se prioriza el GPS del navegador cuando el usuario dio permiso: en un buque
 * esa es la posición REAL, mientras que la IP satelital suele geolocalizar en
 * el país de la teleporta y no donde está la nave. Cuando no hay GPS se cae a
 * la estimación por IP, y `source` deja claro cuál de las dos se está viendo.
 */
function buildLocation(
  ip: string | null,
  geo: IpGeoInfo | undefined,
  deviceLat: number | null,
  deviceLon: number | null,
): AccessLocation {
  if (!geo) {
    const base = emptyLocation(ip);
    if (deviceLat !== null && deviceLon !== null) {
      return { ...base, latitude: deviceLat, longitude: deviceLon, source: "device" };
    }
    return base;
  }

  const hasDevice = deviceLat !== null && deviceLon !== null;
  return {
    ipAddress: ip,
    label: geo.label,
    countryCode: geo.countryCode,
    country: geo.country,
    city: geo.city,
    isp: geo.isp,
    latitude:  hasDevice ? deviceLat : geo.latitude,
    longitude: hasDevice ? deviceLon : geo.longitude,
    source: hasDevice ? "device" : (geo.latitude !== null ? "ip" : null),
  };
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

// ── Conectados ahora ─────────────────────────────────────────────────────────

interface ActiveUserRaw {
  userId: string;
  userEmail: string;
  tenantSlug: string;
  userRole: string | null;
  vesselCode: string | null;
  lastRoute: string | null;
  lastSeenAt: Date;
  ipAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  requestCount: bigint | number;
}

/**
 * Un renglón por usuario con actividad en los últimos `windowMinutes`, con su
 * última señal. El DISTINCT ON sobre una subconsulta ordenada es el mismo
 * patrón que usa getLatestVesselPositions en tenant/usage/usage-service.
 */
export async function getActiveUsers(windowMinutes = 15): Promise<ActiveUserRow[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const minutes = Math.min(Math.max(Math.trunc(windowMinutes), 1), 60 * 24 * 7);
  const since = new Date(Date.now() - minutes * 60_000);

  const rows = await prisma.$queryRaw<ActiveUserRaw[]>`
    SELECT DISTINCT ON (u."userId")
      u."userId"                     AS "userId",
      u."userEmail"                  AS "userEmail",
      u."tenantSlug"                 AS "tenantSlug",
      u."userRole"                   AS "userRole",
      u."vesselCode"                 AS "vesselCode",
      u."route"                      AS "lastRoute",
      u."createdAt"                  AS "lastSeenAt",
      u."ipAddress"                  AS "ipAddress",
      u."latitude"                   AS "latitude",
      u."longitude"                  AS "longitude",
      c."requestCount"               AS "requestCount"
    FROM "UsageEvent" u
    JOIN (
      SELECT "userId", COUNT(*) AS "requestCount"
      FROM "UsageEvent"
      WHERE "createdAt" >= ${since}
      GROUP BY "userId"
    ) c ON c."userId" = u."userId"
    WHERE u."createdAt" >= ${since}
    ORDER BY u."userId", u."createdAt" DESC
  `;

  const geoByIp = await resolveIpGeoMany(rows.map((r) => r.ipAddress));

  // El User-Agent no viaja en UsageEvent (sería redundante en cada request):
  // se toma el del último login guardado en RefreshToken, que es el equipo con
  // el que esa persona abrió la sesión que sigue usando.
  const deviceByUserId = await getLastKnownDevices(prisma, rows.map((r) => r.userId));

  return rows
    .map((r) => ({
      userId: r.userId,
      userEmail: r.userEmail,
      tenantSlug: r.tenantSlug,
      userRole: r.userRole,
      vesselCode: r.vesselCode,
      lastRoute: r.lastRoute,
      lastSeenAt: r.lastSeenAt.toISOString(),
      requestCount: Number(r.requestCount ?? 0),
      device: deviceByUserId.get(r.userId) ?? null,
      location: buildLocation(
        r.ipAddress,
        r.ipAddress ? geoByIp.get(r.ipAddress.replace(/^::ffff:/i, "")) : undefined,
        r.latitude,
        r.longitude,
      ),
    }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

async function getLastKnownDevices(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;

  try {
    const tokens = await prisma.refreshToken.findMany({
      where: { userId: { in: userIds }, userAgent: { not: null } },
      select: { userId: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    for (const t of tokens) {
      if (out.has(t.userId)) continue; // el primero ya es el más reciente
      const device = describeUserAgent(t.userAgent);
      if (device) out.set(t.userId, device);
    }
  } catch {
    /* el dispositivo es información de apoyo — su ausencia no rompe la vista */
  }
  return out;
}

// ── Historial de ingresos ────────────────────────────────────────────────────

export async function getLoginHistory(
  filters: LoginHistoryFilters = {},
): Promise<{ items: LoginHistoryRow[]; total: number }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [], total: 0 };

  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  const offset = Math.max(filters.offset ?? 0, 0);

  let actions = LOGIN_ACTIONS;
  if (filters.result === "success") actions = actions.filter((a) => a.endsWith("_SUCCESS"));
  if (filters.result === "failed")  actions = actions.filter((a) => a.endsWith("_FAILED"));

  const where: Record<string, unknown> = { action: { in: actions } };
  if (filters.tenantSlug) where.tenant = { slug: filters.tenantSlug };
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const [records, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        tenant: { select: { slug: true } },
        actorUser: { select: { email: true, firstName: true, lastName: true } },
        actorPlatformUser: { select: { email: true, firstName: true, lastName: true, role: true } },
      },
    }),
    prisma.auditEvent.count({ where: where as never }),
  ]);

  const rows = records.map((event) => {
    const meta = (event.metadata ?? {}) as Record<string, unknown>;
    const isPlatform = event.action.startsWith("PLATFORM_");
    const person = isPlatform ? event.actorPlatformUser : event.actorUser;

    const fullName = person
      ? [person.firstName, person.lastName].filter(Boolean).join(" ").trim()
      : "";

    // En los rechazos no hay usuario resuelto y el audit solo guarda el
    // identificador ofuscado — nunca el email tecleado ni la contraseña.
    const realEmail = person?.email ?? str(meta.email);
    const redacted = str(meta.emailHash) ?? str(meta.identifierHash);

    return {
      id: event.id,
      createdAt: event.createdAt.toISOString(),
      scope: (isPlatform ? "platform" : "tenant") as "platform" | "tenant",
      success: event.action.endsWith("_SUCCESS"),
      tenantSlug: event.tenant?.slug ?? str(meta.tenantSlug),
      userEmail: realEmail ?? redacted,
      userEmailRedacted: !realEmail && redacted !== null,
      userName: fullName.length > 0 ? fullName : null,
      userRole: str(meta.role) ?? (isPlatform ? (event.actorPlatformUser?.role ?? null) : null),
      failureReason: event.action.endsWith("_FAILED") ? (str(meta.reason) ?? "invalid_credentials") : null,
      device: describeUserAgent(str(meta.userAgent)),
      ip: str(meta.ip),
    };
  });

  const geoByIp = await resolveIpGeoMany(rows.map((r) => r.ip));

  const items: LoginHistoryRow[] = rows.map(({ ip, ...rest }) => ({
    ...rest,
    location: buildLocation(ip, ip ? geoByIp.get(ip.replace(/^::ffff:/i, "")) : undefined, null, null),
  }));

  // El filtro por usuario se aplica acá y no en SQL porque el email vive en el
  // metadata JSON de los intentos fallidos, no en una columna indexable.
  const needle = String(filters.userEmail ?? "").trim().toLowerCase();
  if (!needle) return { items, total };

  const filtered = items.filter((r) => (r.userEmail ?? "").toLowerCase().includes(needle));
  return { items: filtered, total: filtered.length };
}
