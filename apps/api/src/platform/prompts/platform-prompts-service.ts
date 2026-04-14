import type { LocaleCode } from "@pms-saas/shared-types";
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
  "rca_assistant",
  "defect_assistant",
  "deferral_analysis",
  "barrier_interviewer",
  "maintenance_insights",
  "daily_executive_summary",
  "document_summarizer",
  "evidence_link_assistant",
];

function ensureCapability(value: string): DevPromptCapability {
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

export async function listPlatformPrompts(filters: PlatformPromptListFilters = {}): Promise<PlatformPromptSummary[]> {
  const prisma = getPrismaClient();
  if (prisma) {
    throw new RouteError(503, "PROMPTS_NOT_READY", "Prompt storage is not configured yet.");
  }

  return listDevPrompts(filters).map((prompt) => ({ ...prompt }));
}

export async function getPlatformPrompt(id: string): Promise<PlatformPromptSummary> {
  const prisma = getPrismaClient();
  if (prisma) {
    throw new RouteError(503, "PROMPTS_NOT_READY", "Prompt storage is not configured yet.");
  }

  const prompt = getDevPromptById(id);
  if (!prompt) {
    throw new RouteError(404, "PROMPT_NOT_FOUND", "Prompt not found.");
  }
  return { ...prompt };
}

export async function createPlatformPrompt(request: PlatformPromptCreateRequest): Promise<PlatformPromptSummary> {
  const prisma = getPrismaClient();
  if (prisma) {
    throw new RouteError(503, "PROMPTS_NOT_READY", "Prompt storage is not configured yet.");
  }

  const capability = ensureCapability(request.capability);
  const locale = ensureLocale(request.locale);
  const title = ensureRequired(request.title, "PROMPT_TITLE_REQUIRED", "Prompt title is required.");
  const content = ensureRequired(request.content, "PROMPT_CONTENT_REQUIRED", "Prompt content is required.");

  const record = createDevPrompt({ capability, locale, title, content });
  return { ...record };
}

export async function updatePlatformPrompt(
  id: string,
  request: PlatformPromptUpdateRequest,
): Promise<PlatformPromptSummary> {
  const prisma = getPrismaClient();
  if (prisma) {
    throw new RouteError(503, "PROMPTS_NOT_READY", "Prompt storage is not configured yet.");
  }

  const title = request.title ? ensureRequired(request.title, "PROMPT_TITLE_REQUIRED", "Prompt title is required.") : undefined;
  const content = request.content
    ? ensureRequired(request.content, "PROMPT_CONTENT_REQUIRED", "Prompt content is required.")
    : undefined;

  const record = updateDevPrompt(id, { title, content });
  if (!record) {
    throw new RouteError(409, "PROMPT_NOT_EDITABLE", "Prompt is not editable.");
  }
  return { ...record };
}

export async function publishPlatformPrompt(id: string): Promise<PlatformPromptSummary> {
  const prisma = getPrismaClient();
  if (prisma) {
    throw new RouteError(503, "PROMPTS_NOT_READY", "Prompt storage is not configured yet.");
  }

  const record = publishDevPrompt(id);
  if (!record) {
    throw new RouteError(404, "PROMPT_NOT_FOUND", "Prompt not found.");
  }
  return { ...record };
}

export async function rollbackPlatformPrompt(id: string): Promise<PlatformPromptSummary> {
  const prompt = await getPlatformPrompt(id);
  if (prompt.status !== "ARCHIVED") {
    throw new RouteError(409, "PROMPT_NOT_ROLLBACKABLE", "Only archived prompts can be rolled back.");
  }
  return publishPlatformPrompt(id);
}
