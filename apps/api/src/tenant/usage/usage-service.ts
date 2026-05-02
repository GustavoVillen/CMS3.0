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

// ── AI pricing (USD per million tokens) — hardcoded, updated when Anthropic changes prices ──
// Source: https://www.anthropic.com/pricing  (last reviewed 2026-05-02)
export const AI_PRICING: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-4-5-20251001": { in: 1.0,  out: 5.0,  cacheRead: 0.10, cacheWrite: 1.25 },
  "claude-sonnet-4-6":         { in: 3.0,  out: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-opus-4-7":           { in: 15.0, out: 75.0, cacheRead: 1.50, cacheWrite: 18.75 },
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
      },
    }),
    prisma.usageEvent.count({ where: where as never }),
  ]);

  return { items, total };
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
