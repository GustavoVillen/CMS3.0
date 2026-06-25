/**
 * Usage tracking — unified log for AI token consumption + HTTP bytes traffic.
 *
 * Two kinds of events live in the same table:
 *   - "ai_call":      tokens consumed by Claude calls (copiloto, fluid-analyses, ...)
 *   - "http_request": bytes in/out per authenticated HTTP request (satellite link cost)
 *
 * Writes are non-blocking (`.catch` swallowed) — same pattern as `publishAudit`.
 * SUPERADMIN-visible. Retention: 6 months (purge by external cron).
 */

import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { getCachedTenantBySlug } from "../tenant-cache";

// ── AI pricing (USD per million tokens) — hardcoded, updated when Anthropic changes prices ──
// Source: https://www.anthropic.com/pricing  (last reviewed 2026-06-24)
// cacheRead = 0.1x input ; cacheWrite (5min TTL) = 1.25x input.
export const AI_PRICING: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-4-5-20251001": { in: 1.0,  out: 5.0,  cacheRead: 0.10, cacheWrite: 1.25 },
  "claude-sonnet-4-6":         { in: 3.0,  out: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  // Opus 4.7/4.8: precio oficial vigente $5/$25 (antes estaba mal cargado a $15/$75).
  "claude-opus-4-7":           { in: 5.0,  out: 25.0, cacheRead: 0.50, cacheWrite: 6.25 },
  "claude-opus-4-8":           { in: 5.0,  out: 25.0, cacheRead: 0.50, cacheWrite: 6.25 },
};

export function aiCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
): number {
  const p = AI_PRICING[model];
  if (!p) return 0;
  return (
    (inputTokens / 1_000_000) * p.in +
    (outputTokens / 1_000_000) * p.out +
    (cacheReadTokens / 1_000_000) * p.cacheRead +
    (cacheCreationTokens / 1_000_000) * p.cacheWrite
  );
}

// ── Recording ────────────────────────────────────────────────────────────────

export interface RecordAiUsageInput {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  userEmail: string;
  vesselCode?: string | null;
  feature: "copiloto" | "fluid_analyses" | string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  latencyMs?: number;
  errored?: boolean;
  ipAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  userRole?: string | null;
}

export function recordAiUsage(input: RecordAiUsageInput): void {
  const prisma = getPrismaClient();
  if (!prisma) return;

  prisma.usageEvent
    .create({
      data: {
        tenantId: input.tenantId,
        tenantSlug: input.tenantSlug,
        userId: input.userId,
        userEmail: input.userEmail,
        vesselCode: input.vesselCode ?? null,
        kind: "ai_call",
        feature: input.feature,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheReadTokens: input.cacheReadTokens ?? 0,
        cacheCreationTokens: input.cacheCreationTokens ?? 0,
        latencyMs: input.latencyMs ?? null,
        errored: input.errored ?? false,
        ipAddress: input.ipAddress ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        userRole: input.userRole ?? null,
      },
    })
    .catch(() => { /* never fail the request because of telemetry */ });
}

export interface RecordHttpUsageInput {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  userEmail: string;
  vesselCode?: string | null;
  route: string;
  method: string;
  statusCode: number;
  bytesIn: number;
  bytesOut: number;
  latencyMs: number;
  errored?: boolean;
  ipAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  userRole?: string | null;
}

export function recordHttpUsage(input: RecordHttpUsageInput): void {
  const prisma = getPrismaClient();
  if (!prisma) return;

  prisma.usageEvent
    .create({
      data: {
        tenantId: input.tenantId,
        tenantSlug: input.tenantSlug,
        userId: input.userId,
        userEmail: input.userEmail,
        vesselCode: input.vesselCode ?? null,
        kind: "http_request",
        route: input.route,
        method: input.method,
        statusCode: input.statusCode,
        bytesIn: input.bytesIn,
        bytesOut: input.bytesOut,
        latencyMs: input.latencyMs,
        errored: input.errored ?? input.statusCode >= 500,
        ipAddress: input.ipAddress ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        userRole: input.userRole ?? null,
      },
    })
    .catch(() => { /* swallow */ });
}

// ── Queries ──────────────────────────────────────────────────────────────────

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export interface MyAiUsageSummary {
  monthLabel: string;        // "2026-05"
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function getMonthlyAiUsageForUser(
  tenantId: string,
  userId: string,
): Promise<MyAiUsageSummary> {
  const prisma = getPrismaClient();
  const monthStart = startOfCurrentMonthUtc();
  const monthLabel = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`;

  if (!prisma) {
    return { monthLabel, totalTokens: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const rows = await prisma.usageEvent.findMany({
    where: {
      tenantId,
      userId,
      kind: "ai_call",
      createdAt: { gte: monthStart },
    },
    select: {
      model: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
    },
  });

  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  for (const r of rows) {
    inTok += r.inputTokens;
    outTok += r.outputTokens;
    cost += aiCostUsd(r.model ?? "", r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheCreationTokens);
  }

  return {
    monthLabel,
    totalTokens: inTok + outTok,
    inputTokens: inTok,
    outputTokens: outTok,
    costUsd: cost,
  };
}

// ── Budget / tope mensual de IA (hard cap por tenant) ─────────────────────────
// Objetivo: que la factura de Claude no supere AI_MONTHLY_BUDGET_USD por tenant
// y por mes. El gasto se calcula del mismo UsageEvent (kind="ai_call").
// Configurable por env; default USD 50.

export const AI_MONTHLY_BUDGET_USD: number =
  Number(process.env.AI_MONTHLY_BUDGET_USD) > 0 ? Number(process.env.AI_MONTHLY_BUDGET_USD) : 50;

export interface AiBudgetStatus {
  monthLabel: string;   // "2026-06"
  budgetUsd: number;    // tope mensual
  spentUsd: number;     // gasto del mes
  pct: number;          // % usado (puede pasar 100 por overshoot de la última llamada)
  remainingPct: number; // max(0, 100 - pct)
  blocked: boolean;     // true cuando spent >= budget -> se bloquea la IA
}

// Cache corto del gasto por tenant: evita un aggregate por cada llamada de IA
// (el copiloto puede invocar varias veces seguidas). El registro de uso es
// asíncrono, así que un pequeño desfase es esperable; el overshoot es de centavos.
const spendCache = new Map<string, { value: number; expires: number }>();
const SPEND_CACHE_TTL_MS = 15_000;

async function getMonthlyAiSpendForTenant(tenantId: string): Promise<number> {
  const cached = spendCache.get(tenantId);
  const nowMs = Date.now();
  if (cached && cached.expires > nowMs) return cached.value;

  const prisma = getPrismaClient();
  if (!prisma) return 0;

  const monthStart = startOfCurrentMonthUtc();
  const grouped = await prisma.usageEvent.groupBy({
    by: ["model"],
    where: { tenantId, kind: "ai_call", createdAt: { gte: monthStart } },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
    },
  });

  let cost = 0;
  for (const g of grouped) {
    cost += aiCostUsd(
      g.model ?? "",
      g._sum.inputTokens ?? 0,
      g._sum.outputTokens ?? 0,
      g._sum.cacheReadTokens ?? 0,
      g._sum.cacheCreationTokens ?? 0,
    );
  }

  spendCache.set(tenantId, { value: cost, expires: nowMs + SPEND_CACHE_TTL_MS });
  return cost;
}

export async function getAiBudgetStatus(tenantId: string): Promise<AiBudgetStatus> {
  const monthStart = startOfCurrentMonthUtc();
  const monthLabel = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`;
  const budgetUsd = AI_MONTHLY_BUDGET_USD;
  const spentUsd = await getMonthlyAiSpendForTenant(tenantId);
  const pct = budgetUsd > 0 ? (spentUsd / budgetUsd) * 100 : 0;
  return {
    monthLabel,
    budgetUsd,
    spentUsd,
    pct,
    remainingPct: Math.max(0, 100 - pct),
    blocked: budgetUsd > 0 && spentUsd >= budgetUsd,
  };
}

/**
 * Guard para acciones de IA iniciadas por el usuario (copiloto, sugerencias).
 * Lanza RouteError 429 cuando el tenant alcanzó el tope mensual: la llamada a
 * Claude NO se realiza, evitando facturación por encima del presupuesto.
 */
export async function assertAiBudgetAvailable(tenantId: string): Promise<void> {
  const status = await getAiBudgetStatus(tenantId);
  if (status.blocked) {
    throw new RouteError(
      429,
      "AI_BUDGET_EXCEEDED",
      `Se alcanzó el límite mensual de uso de IA (${status.monthLabel}). El servicio se reactiva el próximo mes.`,
    );
  }
}

/**
 * Variante no-lanzadora para features de fondo/opcionales (OCR de avances,
 * insights automáticos) que deben degradar silenciosamente, no romper el flujo.
 */
export async function isAiBudgetAvailable(tenantId: string): Promise<boolean> {
  const status = await getAiBudgetStatus(tenantId);
  return !status.blocked;
}

/**
 * Igual que assertAiBudgetAvailable pero resolviendo el tenant por slug —
 * los servicios de IA reciben TenantAccessSession, que expone tenantSlug (no id).
 * Si el tenant no se puede resolver, no bloquea (fail-open).
 */
export async function assertAiBudgetAvailableBySlug(tenantSlug: string): Promise<void> {
  const tenant = await getCachedTenantBySlug(tenantSlug);
  if (!tenant) return;
  await assertAiBudgetAvailable(tenant.id);
}

export interface ListUsageFilters {
  kind?: "ai_call" | "http_request" | null;
  tenantSlug?: string | null;
  userEmail?: string | null;
  feature?: string | null;
  vesselCode?: string | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
  offset?: number;
}

export interface UsageEventRow {
  id: string;
  createdAt: Date;
  tenantSlug: string;
  userEmail: string;
  vesselCode: string | null;
  kind: string;
  feature: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  route: string | null;
  method: string | null;
  statusCode: number | null;
  bytesIn: number;
  bytesOut: number;
  latencyMs: number | null;
  errored: boolean;
  ipAddress: string | null;
}

export async function listUsageEvents(filters: ListUsageFilters): Promise<{ items: UsageEventRow[]; total: number }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [], total: 0 };

  const where: Record<string, unknown> = {};
  if (filters.kind) where.kind = filters.kind;
  if (filters.tenantSlug) where.tenantSlug = filters.tenantSlug;
  if (filters.userEmail) where.userEmail = { contains: filters.userEmail, mode: "insensitive" };
  if (filters.feature) where.feature = filters.feature;
  if (filters.vesselCode) where.vesselCode = filters.vesselCode;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 1000);
  const offset = Math.max(filters.offset ?? 0, 0);

  const [items, total] = await Promise.all([
    prisma.usageEvent.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        createdAt: true,
        tenantSlug: true,
        userEmail: true,
        vesselCode: true,
        kind: true,
        feature: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        route: true,
        method: true,
        statusCode: true,
        bytesIn: true,
        bytesOut: true,
        latencyMs: true,
        errored: true,
        ipAddress: true,
      },
    }),
    prisma.usageEvent.count({ where: where as never }),
  ]);

  return { items, total };
}

// ── Vessel positions ─────────────────────────────────────────────────────────
// Returns the latest known position per vessel, only for TECHNICIAN_OPERATOR users.

export interface VesselPositionRow {
  vesselCode: string;
  vesselName: string;
  tenantSlug: string;
  userEmail: string;
  latitude: number;
  longitude: number;
  seenAt: Date;
}

export async function getLatestVesselPositions(): Promise<VesselPositionRow[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  // Latest position per vessel per tenant, sourced from daily reports.
  return prisma.$queryRaw<VesselPositionRow[]>`
    SELECT DISTINCT ON (dr."vesselCode", t."slug")
      dr."vesselCode"                        AS "vesselCode",
      COALESCE(v."name", dr."vesselCode")    AS "vesselName",
      t."slug"                               AS "tenantSlug",
      dr."reportDate"::text                  AS "userEmail",
      dr."positionLat"                       AS "latitude",
      dr."positionLon"                       AS "longitude",
      dr."reportDate"::timestamptz           AS "seenAt"
    FROM "DailyReport" dr
    JOIN "Tenant" t ON t."id" = dr."tenantId"
    LEFT JOIN "Vessel" v ON v."code" = dr."vesselCode" AND v."tenantId" = dr."tenantId"
    WHERE dr."positionLat" IS NOT NULL
      AND dr."positionLon" IS NOT NULL
    ORDER BY dr."vesselCode", t."slug", dr."reportDate" DESC
  `;
}

export async function getLatestVesselPositionsByTenant(tenantId: string): Promise<VesselPositionRow[]> {
  const prisma = getPrismaClient();
  if (!prisma) return [];

  return prisma.$queryRaw<VesselPositionRow[]>`
    SELECT DISTINCT ON (dr."vesselCode")
      dr."vesselCode"                        AS "vesselCode",
      COALESCE(v."name", dr."vesselCode")    AS "vesselName",
      ''                                     AS "tenantSlug",
      dr."reportDate"::text                  AS "userEmail",
      dr."positionLat"                       AS "latitude",
      dr."positionLon"                       AS "longitude",
      dr."reportDate"::timestamptz           AS "seenAt"
    FROM "DailyReport" dr
    LEFT JOIN "Vessel" v ON v."code" = dr."vesselCode" AND v."tenantId" = dr."tenantId"
    WHERE dr."tenantId"    = ${tenantId}
      AND dr."positionLat" IS NOT NULL
      AND dr."positionLon" IS NOT NULL
    ORDER BY dr."vesselCode", dr."reportDate" DESC
  `;
}

// ── Retention ────────────────────────────────────────────────────────────────
// Call from a cron (weekly is fine). Removes events older than 6 months.
export async function purgeOldUsageEvents(): Promise<number> {
  const prisma = getPrismaClient();
  if (!prisma) return 0;
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const r = await prisma.usageEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return r.count;
}
