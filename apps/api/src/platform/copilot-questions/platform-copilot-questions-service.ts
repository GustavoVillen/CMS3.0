import { getPrismaClient } from "../data/prisma-client";
import { getTenantNames, getVesselNames, getUserNamesByEmail, vesselKey } from "../access/platform-name-lookup";
import { getCopilotQuestionsStorage, pruneCopilotQuestions } from "../../tenant/copiloto/copilot-questions-log";

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
  /** Lo que contestó el copiloto; null en las preguntas viejas o si falló. */
  answer: string | null;
  hasAttachment: boolean;
  createdAt: string;
  userName: string | null;
  tenantName: string;
  vesselName: string | null;
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
  answer: string | null;
  hasAttachment: boolean;
  createdAt: Date;
}

export async function listCopilotQuestions(
  filters: CopilotQuestionFilters = {},
): Promise<{ items: CopilotQuestionSummary[]; total: number; storage: Awaited<ReturnType<typeof getCopilotQuestionsStorage>> }> {
  const prisma = getPrismaClient();
  if (!prisma) return { items: [], total: 0, storage: await getCopilotQuestionsStorage() };

  // Al mirar la lista también se poda (si no se hizo en la última hora), por
  // si nadie usó el copiloto en un tiempo y quedaron preguntas vencidas.
  await pruneCopilotQuestions().catch(() => {});

  const where: Record<string, unknown> = {};
  if (filters.tenantSlug) where.tenantSlug = filters.tenantSlug;
  if (filters.userEmail) where.userEmail = { contains: filters.userEmail, mode: "insensitive" };
  if (filters.search) {
    where.OR = [
      { question: { contains: filters.search, mode: "insensitive" } },
      { answer:   { contains: filters.search, mode: "insensitive" } },
    ];
  }
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

  const [rows, total, storage, tenantNames] = await Promise.all([
    delegate.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    delegate.count({ where }),
    getCopilotQuestionsStorage(),
    getTenantNames(prisma),
  ]);
  const [vesselNames, userNames] = await Promise.all([
    getVesselNames(prisma, rows),
    getUserNamesByEmail(prisma, rows.map((r) => r.userEmail)),
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
      answer: r.answer ?? null,
      hasAttachment: r.hasAttachment,
      createdAt: r.createdAt.toISOString(),
      userName: userNames.get(r.userEmail) ?? null,
      tenantName: tenantNames.get(r.tenantSlug) ?? r.tenantSlug,
      vesselName: r.vesselCode ? vesselNames.get(vesselKey(r.tenantSlug, r.vesselCode)) ?? null : null,
    })),
    total,
    storage,
  };
}
