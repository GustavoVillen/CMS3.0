import type { LocaleCode } from "@cms3/shared-types";
import { RouteError } from "../../http/route-error";
import { getPrismaClient } from "../data/prisma-client";
import {
  createDevPrompt,
  getDevPromptById,
  listDevPrompts,
  publishDevPrompt,
  updateDevPrompt,
  type DevPromptCapability,
  type DevPromptStatus,
} from "../data/dev-prompt-store";

export interface PlatformPromptSummary {
  id: string;
  capability: DevPromptCapability;
  locale: LocaleCode;
  version: number;
  status: DevPromptStatus;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
}

export interface PlatformPromptListFilters {
  capability?: string | null;
  locale?: string | null;
  status?: string | null;
}

export interface PlatformPromptCreateRequest {
  capability: DevPromptCapability;
  locale: LocaleCode;
  title: string;
  content: string;
}

export interface PlatformPromptUpdateRequest {
  title?: string;
  content?: string;
}

const CAPABILITIES: DevPromptCapability[] = [
  "knowledge_assistant",
  "defect_assistant",
  "deferral_analysis",
  "barrier_interviewer",
  "maintenance_insights",
  "daily_executive_summary",
  "document_summarizer",
  "evidence_link_assistant",
];

export function ensureCapability(value: string): DevPromptCapability {
  const normalized = String(value || "").trim();
  if (!CAPABILITIES.includes(normalized as DevPromptCapability)) {
    throw new RouteError(400, "PROMPT_INVALID_CAPABILITY", "Prompt capability is invalid.");
  }
  return normalized as DevPromptCapability;
}

function ensureLocale(value: string): LocaleCode {
  const normalized = String(value || "").trim();
  if (!normalized || !["es", "en", "pt"].includes(normalized)) {
    throw new RouteError(400, "PROMPT_INVALID_LOCALE", "Prompt locale is invalid.");
  }
  return normalized as LocaleCode;
}

function ensureRequired(value: string, code: string, message: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new RouteError(400, code, message);
  }
  return normalized;
}

function toSummary(row: {
  id: string;
  capability: string;
  locale: string;
  version: number;
  status: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}): PlatformPromptSummary {
  return {
    id:          row.id,
    capability:  row.capability as DevPromptCapability,
    locale:      row.locale as LocaleCode,
    version:     row.version,
    status:      row.status as DevPromptStatus,
    title:       row.title,
    content:     row.content,
    createdAt:   row.createdAt.toISOString(),
    updatedAt:   row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

export async function listPlatformPrompts(filters: PlatformPromptListFilters = {}): Promise<PlatformPromptSummary[]> {
  const prisma = getPrismaClient();
  if (!prisma) {
    return listDevPrompts(filters).map((prompt) => ({ ...prompt }));
  }

  const where: Record<string, unknown> = {};
  if (filters.capability) where.capability = filters.capability;
  if (filters.locale)     where.locale     = filters.locale;
  if (filters.status)     where.status     = filters.status;

  const rows = await prisma.promptTemplate.findMany({
    where,
    orderBy: [{ capability: "asc" }, { locale: "asc" }, { version: "desc" }],
  });
  return rows.map(toSummary);
}

export async function getPlatformPrompt(id: string): Promise<PlatformPromptSummary> {
  const prisma = getPrismaClient();
  if (!prisma) {
    const prompt = getDevPromptById(id);
    if (!prompt) throw new RouteError(404, "PROMPT_NOT_FOUND", "Prompt not found.");
    return { ...prompt };
  }

  const row = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!row) throw new RouteError(404, "PROMPT_NOT_FOUND", "Prompt not found.");
  return toSummary(row);
}

export async function createPlatformPrompt(request: PlatformPromptCreateRequest): Promise<PlatformPromptSummary> {
  const prisma = getPrismaClient();
  if (!prisma) {
    const capability = ensureCapability(request.capability);
    const locale     = ensureLocale(request.locale);
    const title      = ensureRequired(request.title,   "PROMPT_TITLE_REQUIRED",   "Prompt title is required.");
    const content    = ensureRequired(request.content, "PROMPT_CONTENT_REQUIRED", "Prompt content is required.");
    const record = createDevPrompt({ capability, locale, title, content });
    return { ...record };
  }

  const capability = ensureCapability(request.capability);
  const locale     = ensureLocale(request.locale);
  const title      = ensureRequired(request.title,   "PROMPT_TITLE_REQUIRED",   "Prompt title is required.");
  const content    = ensureRequired(request.content, "PROMPT_CONTENT_REQUIRED", "Prompt content is required.");

  // Next version number for this capability+locale pair
  const last = await prisma.promptTemplate.findFirst({
    where:   { capability, locale },
    orderBy: { version: "desc" },
    select:  { version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  const row = await prisma.promptTemplate.create({
    data: { capability, locale, version: nextVersion, title, content, status: "DRAFT" },
  });
  return toSummary(row);
}

export async function updatePlatformPrompt(id: string, request: PlatformPromptUpdateRequest): Promise<PlatformPromptSummary> {
  const prisma = getPrismaClient();
  if (!prisma) {
    const title   = request.title   ? ensureRequired(request.title,   "PROMPT_TITLE_REQUIRED",   "Prompt title is required.")   : undefined;
    const content = request.content ? ensureRequired(request.content, "PROMPT_CONTENT_REQUIRED", "Prompt content is required.") : undefined;
    const record = updateDevPrompt(id, { title, content });
    if (!record) throw new RouteError(409, "PROMPT_NOT_EDITABLE", "Prompt is not editable.");
    return { ...record };
  }

  const existing = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!existing) throw new RouteError(404, "PROMPT_NOT_FOUND", "Prompt not found.");
  if (existing.status !== "DRAFT") throw new RouteError(409, "PROMPT_NOT_EDITABLE", "Only DRAFT prompts can be edited.");

  const title   = request.title   ? ensureRequired(request.title,   "PROMPT_TITLE_REQUIRED",   "Prompt title is required.")   : undefined;
  const content = request.content ? ensureRequired(request.content, "PROMPT_CONTENT_REQUIRED", "Prompt content is required.") : undefined;

  const row = await prisma.promptTemplate.update({
    where: { id },
    data:  { ...(title ? { title } : {}), ...(content ? { content } : {}) },
  });
  return toSummary(row);
}

export async function publishPlatformPrompt(id: string): Promise<PlatformPromptSummary> {
  const prisma = getPrismaClient();
  if (!prisma) {
    const record = publishDevPrompt(id);
    if (!record) throw new RouteError(404, "PROMPT_NOT_FOUND", "Prompt not found.");
    return { ...record };
  }

  const existing = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!existing) throw new RouteError(404, "PROMPT_NOT_FOUND", "Prompt not found.");
  if (existing.status === "PUBLISHED") throw new RouteError(409, "PROMPT_ALREADY_PUBLISHED", "Prompt is already published.");

  // Archive any currently published version for the same capability+locale
  await prisma.promptTemplate.updateMany({
    where: { capability: existing.capability, locale: existing.locale, status: "PUBLISHED" },
    data:  { status: "ARCHIVED" },
  });

  const row = await prisma.promptTemplate.update({
    where: { id },
    data:  { status: "PUBLISHED", publishedAt: new Date() },
  });
  return toSummary(row);
}

export async function rollbackPlatformPrompt(id: string): Promise<PlatformPromptSummary> {
  const prompt = await getPlatformPrompt(id);
  if (prompt.status !== "ARCHIVED") {
    throw new RouteError(409, "PROMPT_NOT_ROLLBACKABLE", "Only archived prompts can be rolled back.");
  }
  return publishPlatformPrompt(id);
}

export async function getPublishedPrompt(capability: string, locale: string): Promise<string | null> {
  const prisma = getPrismaClient();
  if (!prisma) {
    const devPrompts = listDevPrompts({ capability, status: "PUBLISHED" });
    const p = devPrompts.find(p => p.locale === locale) ?? devPrompts[0];
    return p?.content ?? null;
  }
  const row = await prisma.promptTemplate.findFirst({
    where: { capability: capability as any, locale: locale as any, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  if (row) return row.content;
  // fallback: any published prompt for this capability
  const fallback = await prisma.promptTemplate.findFirst({
    where: { capability: capability as any, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  return fallback?.content ?? null;
}
