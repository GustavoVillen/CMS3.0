import { getPrismaClient } from "../data/prisma-client";

export interface CopilotQuestionSummary {
  id: string;
  tenantId: string;
  tenantSlug: string;
  userEmail: string;
  userRole: string;
  capability: string;
  vesselCode: string | null;
  screen: string | null;
  question: string;
  hasAttachment: boolean;
  createdAt: string;
}

export interface CopilotQuestionFilters {
  tenantSlug?: string | null;
  userEmail?: string | null;
  search?: string | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
  offset?: number;
}

interface CopilotQuestionRow {
  id: string;
  tenantId: string;
  tenantSlug: string;
  userEmail: string;
  userRole: string;
  capability: string;
  vesselCode: string | null;
  screen: string | null;
  question: string;
  hasAttachment: boolean;
  createdAt: Date;
}

export async function listCopilotQuestions(
  filters: CopilotQuestionFilters = {},
): Promise<{ items: CopilotQuestionSummary[]; total: number }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [], total: 0 };

  const where: Record<string, unknown> = {};
  if (filters.tenantSlug) where.tenantSlug = filters.tenantSlug;
  if (filters.userEmail) where.userEmail = { contains: filters.userEmail, mode: "insensitive" };
  if (filters.search) where.question = { contains: filters.search, mode: "insensitive" };
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 1000);
  const offset = Math.max(filters.offset ?? 0, 0);

  const delegate = (prisma as unknown as {
    copilotQuestion: {
      findMany(a: unknown): Promise<CopilotQuestionRow[]>;
      count(a: unknown): Promise<number>;
    };
  }).copilotQuestion;

  const [rows, total] = await Promise.all([
    delegate.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    delegate.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      tenantSlug: r.tenantSlug,
      userEmail: r.userEmail,
      userRole: r.userRole,
      capability: r.capability,
      vesselCode: r.vesselCode ?? null,
      screen: r.screen ?? null,
      question: r.question,
      hasAttachment: r.hasAttachment,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
  };
}
