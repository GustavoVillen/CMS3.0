/**
 * Auditoría profunda de UN usuario para la consola SUPERADMIN.
 *
 * Responde: "¿qué está haciendo esta persona en la app?" — juntando en una sola
 * línea de tiempo todo lo que el sistema YA registra de ella, sin grabar nada
 * nuevo ni espiar lo que teclea:
 *
 *   - Ingresos / rechazos de login          → AuditEvent (LOGIN_*)
 *   - Acciones de negocio (crea/edita/cierra) → AuditEvent (actorUserId)
 *   - Pantallas y llamadas que hace           → UsageEvent (kind="http_request")
 *   - Exportaciones y descargas (PDF/Excel)   → UsageEvent, rutas clasificadas
 *   - Uso del copiloto de IA                  → UsageEvent (kind="ai_call")
 *
 * Además calcula un panel de ALERTAS pensado para detectar a alguien que está
 * "levantando" el sistema (robo de información / copia): cuánto exportó, cuántos
 * megabytes se bajó, cuántas pantallas distintas recorrió y cuánta actividad hizo
 * de madrugada, todo sobre una ventana de tiempo.
 *
 * Todo esto es del lado del servidor: el usuario auditado no ve ni nota nada.
 */

import { getPrismaClient } from "../data/prisma-client";

// ── Umbrales de alerta ────────────────────────────────────────────────────────
// Heurísticos, punto de partida para calibrar con datos reales. La severidad es
// una AYUDA visual: el SUPERADMIN igual ve el número crudo y decide.
const THRESHOLDS = {
  exports:       { warn: 10,  alert: 30 },   // exportaciones PDF/Excel en la ventana
  downloadedMb:  { warn: 50,  alert: 200 },  // MB servidos al usuario en la ventana
  distinctViews: { warn: 40,  alert: 80 },   // pantallas distintas recorridas
  offHours:      { warn: 20,  alert: 100 },  // requests de madrugada (hora local aprox.)
};

// Horario "de oficina" en hora de Paraguay. Fuera de esta franja se cuenta como
// actividad de madrugada (el cálculo usa el huso America/Asuncion en SQL).
const OFFICE_START_HOUR = 6;
const OFFICE_END_HOUR = 22;

export type Severity = "ok" | "warn" | "alert";

function severity(value: number, t: { warn: number; alert: number }): Severity {
  if (value >= t.alert) return "alert";
  if (value >= t.warn) return "warn";
  return "ok";
}

// ── Tipos de salida ────────────────────────────────────────────────────────────

export interface UserActivityIdentity {
  userId: string;
  email: string;
  legacyUserId: string | null;
  fullName: string | null;
  status: string;
  memberships: Array<{ tenantSlug: string; role: string; membershipStatus: string }>;
  createdAt: string;
  lastSeenAt: string | null;
  lastIp: string | null;
}

export interface UserActivityAlert {
  key: "exports" | "downloadedMb" | "distinctViews" | "offHours";
  value: number;
  severity: Severity;
}

export interface UserActivityAlerts {
  windowFrom: string;
  windowTo: string;
  totalRequests: number;
  items: UserActivityAlert[];
}

export type ActivityEventType = "login" | "action" | "screen" | "export" | "ai";

export interface ActivityEvent {
  id: string;
  at: string;
  type: ActivityEventType;
  /** Etiqueta corta legible ("Exportó Excel", "Editó OT", "Ingresó"). */
  label: string;
  /** Detalle secundario (ruta, entidad, motivo de rechazo, modelo de IA). */
  detail: string | null;
  tenantSlug: string | null;
  vesselCode: string | null;
  ip: string | null;
  success: boolean | null;
}

export interface UserActivityResult {
  user: UserActivityIdentity;
  alerts: UserActivityAlerts;
  events: ActivityEvent[];
  /** true si la línea de tiempo se recortó por tope (hay más eventos que los devueltos). */
  truncated: boolean;
}

export interface UserSearchRow {
  userId: string;
  email: string;
  legacyUserId: string | null;
  fullName: string | null;
  tenantSlug: string | null;
  role: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const LOGIN_ACTIONS = new Set([
  "TENANT_LOGIN_SUCCESS",
  "TENANT_LOGIN_FAILED",
  "PLATFORM_LOGIN_SUCCESS",
  "PLATFORM_LOGIN_FAILED",
]);

/** Clasifica una ruta HTTP como exportación/descarga, o null si es navegación normal. */
function classifyExport(route: string | null): "excel" | "pdf" | "download" | null {
  if (!route) return null;
  const path = route.split("?")[0].toLowerCase();
  if (path.endsWith(".xlsx") || path.includes("/excel/export/")) return "excel";
  if (path.endsWith(".pdf")) return "pdf";
  if (path.includes("/export")) return "download";
  return null;
}

function fullNameOf(firstName: string | null, lastName: string | null): string | null {
  const n = [firstName, lastName].filter(Boolean).join(" ").trim();
  return n.length > 0 ? n : null;
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

// Traducciones legibles de las acciones de negocio más comunes del AuditEvent.
// Si una acción no está mapeada se muestra la clave cruda: es interno y basta.
const ACTION_VERB: Record<string, string> = {
  CREATE: "Creó", CREATED: "Creó",
  UPDATE: "Editó", UPDATED: "Editó",
  DELETE: "Borró", DELETED: "Borró",
  CLOSE: "Cerró", CLOSED: "Cerró",
  APPROVE: "Aprobó", APPROVED: "Aprobó",
  REJECT: "Rechazó", REJECTED: "Rechazó",
  SUBMIT: "Envió", SUBMITTED: "Envió",
  EXPORT: "Exportó", EXPORTED: "Exportó",
};

function describeAction(action: string, entityType: string): string {
  // Formato típico: "WORK_ORDER_UPDATED", "SPARE_CREATED". Se parte por el verbo final.
  const parts = action.split("_");
  const verbKey = parts[parts.length - 1]?.toUpperCase() ?? "";
  const verb = ACTION_VERB[verbKey];
  if (verb) return `${verb} ${entityType}`;
  return `${action} · ${entityType}`;
}

// ── Búsqueda de usuarios (para el selector del SUPERADMIN) ─────────────────────

export async function searchUsers(query: string): Promise<UserSearchRow[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  const q = query.trim();
  if (q.length < 1) return [];

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { legacyUserId: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      email: true,
      legacyUserId: true,
      firstName: true,
      lastName: true,
      memberships: {
        select: { role: true, tenant: { select: { slug: true } } },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    orderBy: [{ legacyUserId: "asc" }, { email: "asc" }],
    take: 25,
  });

  return users.map((u) => ({
    userId: u.id,
    email: u.email,
    legacyUserId: u.legacyUserId,
    fullName: fullNameOf(u.firstName, u.lastName),
    tenantSlug: u.memberships[0]?.tenant?.slug ?? null,
    role: u.memberships[0]?.role ?? null,
  }));
}

// ── Actividad de un usuario ────────────────────────────────────────────────────

export interface UserActivityFilters {
  userId: string;
  from?: Date | null;
  to?: Date | null;
  /** Tipos a incluir en la línea de tiempo. Por defecto todos. */
  types?: ActivityEventType[] | null;
  /** Tope de eventos en la línea de tiempo (default 400, máx 1000). */
  limit?: number;
}

const EVENT_CAP = 1000;

export async function getUserActivity(filters: UserActivityFilters): Promise<UserActivityResult | null> {
  const prisma = getPrismaClient();
  if (!prisma) return null;

  const to = filters.to ?? new Date();
  const from = filters.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const limit = Math.min(Math.max(filters.limit ?? 400, 1), EVENT_CAP);
  const wanted = new Set<ActivityEventType>(
    filters.types && filters.types.length > 0
      ? filters.types
      : ["login", "action", "screen", "export", "ai"],
  );

  // ── Identidad ──
  const user = await prisma.user.findUnique({
    where: { id: filters.userId },
    select: {
      id: true, email: true, legacyUserId: true, firstName: true, lastName: true,
      status: true, createdAt: true,
      memberships: {
        select: { role: true, status: true, tenant: { select: { slug: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!user) return null;

  // Última señal conocida (de UsageEvent, que se escribe en cada request).
  const lastSeen = await prisma.usageEvent.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, ipAddress: true },
  });

  const identity: UserActivityIdentity = {
    userId: user.id,
    email: user.email,
    legacyUserId: user.legacyUserId,
    fullName: fullNameOf(user.firstName, user.lastName),
    status: user.status,
    memberships: user.memberships.map((m) => ({
      tenantSlug: m.tenant?.slug ?? "—",
      role: m.role,
      membershipStatus: m.status,
    })),
    createdAt: user.createdAt.toISOString(),
    lastSeenAt: lastSeen?.createdAt.toISOString() ?? null,
    lastIp: lastSeen?.ipAddress ?? null,
  };

  // ── Alertas: agregados sobre TODA la ventana ──
  // Se calculan con consultas de conteo/suma en la base (no sobre una muestra):
  // si alguien está "levantando" el sistema, el volumen es justo lo que no se
  // puede subcontar. Las dos métricas que dependen de la ruta o la hora local
  // van por SQL crudo (normaliza ids, usa el huso de Paraguay con su DST).
  const httpWhere = { userId: user.id, kind: "http_request", createdAt: { gte: from, lte: to } };

  const [totalRequests, bytesAgg, exportCount, distinctRaw, offHoursRaw] = await Promise.all([
    prisma.usageEvent.count({ where: httpWhere as never }),
    prisma.usageEvent.aggregate({ where: httpWhere as never, _sum: { bytesOut: true } }),
    prisma.usageEvent.count({
      where: {
        ...httpWhere,
        OR: [
          { route: { endsWith: ".xlsx" } },
          { route: { contains: "/excel/export/" } },
          { route: { endsWith: ".pdf" } },
          { route: { contains: "/export" } },
        ],
      } as never,
    }),
    // Pantallas distintas: colapsa los segmentos que parecen id (8+ alfanum) para
    // no contar como pantalla nueva cada OT/buque abierto.
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT regexp_replace(split_part("route", '?', 1), '/[0-9a-zA-Z]{8,}', '/:id', 'g')) AS n
      FROM "UsageEvent"
      WHERE "userId" = ${user.id} AND "kind" = 'http_request'
        AND "createdAt" >= ${from} AND "createdAt" <= ${to} AND "route" IS NOT NULL
    `,
    // Madrugada: fuera del horario 06–22 en hora de Paraguay (respeta DST).
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n
      FROM "UsageEvent"
      WHERE "userId" = ${user.id} AND "kind" = 'http_request'
        AND "createdAt" >= ${from} AND "createdAt" <= ${to}
        AND (
          EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'America/Asuncion')) < ${OFFICE_START_HOUR}
          OR EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'America/Asuncion')) >= ${OFFICE_END_HOUR}
        )
    `,
  ]);

  const downloadedMb = Math.round(((bytesAgg._sum.bytesOut ?? 0) / (1024 * 1024)) * 10) / 10;
  const distinctViews = Number(distinctRaw[0]?.n ?? 0);
  const offHoursCount = Number(offHoursRaw[0]?.n ?? 0);

  const alerts: UserActivityAlerts = {
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    totalRequests,
    items: [
      { key: "exports",       value: exportCount,    severity: severity(exportCount, THRESHOLDS.exports) },
      { key: "downloadedMb",  value: downloadedMb,    severity: severity(downloadedMb, THRESHOLDS.downloadedMb) },
      { key: "distinctViews", value: distinctViews,   severity: severity(distinctViews, THRESHOLDS.distinctViews) },
      { key: "offHours",      value: offHoursCount,   severity: severity(offHoursCount, THRESHOLDS.offHours) },
    ],
  };

  // ── Línea de tiempo: los eventos más recientes de cada fuente, luego se mezcla ──
  const [auditRows, usageRows] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { actorUserId: user.id, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { tenant: { select: { slug: true } } },
    }),
    prisma.usageEvent.findMany({
      where: { userId: user.id, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, createdAt: true, kind: true, route: true, method: true,
        feature: true, model: true, statusCode: true,
        tenantSlug: true, vesselCode: true, ipAddress: true, errored: true,
      },
    }),
  ]);

  // ── Línea de tiempo unificada ──
  const events: ActivityEvent[] = [];

  for (const a of auditRows) {
    const isLogin = LOGIN_ACTIONS.has(a.action);
    const type: ActivityEventType = isLogin ? "login" : "action";
    if (!wanted.has(type)) continue;
    const meta = (a.metadata ?? {}) as Record<string, unknown>;

    if (isLogin) {
      const success = a.action.endsWith("_SUCCESS");
      events.push({
        id: a.id,
        at: a.createdAt.toISOString(),
        type,
        label: success ? "Ingresó" : "Login rechazado",
        detail: success ? null : (str(meta.reason) ?? "credenciales inválidas"),
        tenantSlug: a.tenant?.slug ?? str(meta.tenantSlug),
        vesselCode: null,
        ip: str(meta.ip),
        success,
      });
    } else {
      events.push({
        id: a.id,
        at: a.createdAt.toISOString(),
        type,
        label: describeAction(a.action, a.entityType),
        detail: a.entityId ? `${a.entityType} · ${a.entityId}` : a.entityType,
        tenantSlug: a.tenant?.slug ?? null,
        vesselCode: str(meta.vesselCode),
        ip: null,
        success: null,
      });
    }
  }

  for (const u of usageRows) {
    if (u.kind === "ai_call") {
      if (!wanted.has("ai")) continue;
      events.push({
        id: u.id,
        at: u.createdAt.toISOString(),
        type: "ai",
        label: u.feature === "copiloto" ? "Preguntó al copiloto" : `IA · ${u.feature ?? "consulta"}`,
        detail: u.model ?? null,
        tenantSlug: u.tenantSlug,
        vesselCode: u.vesselCode,
        ip: u.ipAddress,
        success: !u.errored,
      });
      continue;
    }

    // http_request → exportación o navegación
    const kind = classifyExport(u.route);
    const type: ActivityEventType = kind ? "export" : "screen";
    if (!wanted.has(type)) continue;

    events.push({
      id: u.id,
      at: u.createdAt.toISOString(),
      type,
      label: kind
        ? (kind === "excel" ? "Exportó Excel" : kind === "pdf" ? "Descargó PDF" : "Exportó datos")
        : `${u.method ?? "GET"} pantalla`,
      detail: u.route ? u.route.split("?")[0] : null,
      tenantSlug: u.tenantSlug,
      vesselCode: u.vesselCode,
      ip: u.ipAddress,
      success: u.statusCode == null ? null : u.statusCode < 400,
    });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  const truncated = events.length > limit;

  return {
    user: identity,
    alerts,
    events: events.slice(0, limit),
    truncated,
  };
}
