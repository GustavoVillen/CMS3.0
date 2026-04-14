import type { LocaleCode } from "@pms-saas/shared-types";

export type DevPromptStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type DevPromptCapability =
  | "knowledge_assistant"
  | "rca_assistant"
  | "defect_assistant"
  | "deferral_analysis"
  | "barrier_interviewer"
  | "maintenance_insights"
  | "daily_executive_summary"
  | "document_summarizer"
  | "evidence_link_assistant";

export interface DevPromptRecord {
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

const DEV_PROMPTS: DevPromptRecord[] = [
  {
    id: "prompt-knowledge_assistant-es-v1",
    capability: "knowledge_assistant",
    locale: "es",
    version: 1,
    status: "PUBLISHED",
    title: "Asistente de conocimiento - base",
    content: "Eres un asistente tecnico para operaciones maritimas. Responde con claridad y concision.",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    publishedAt: "2026-04-10T00:00:00.000Z",
  },
  {
    id: "prompt-knowledge_assistant-es-v2",
    capability: "knowledge_assistant",
    locale: "es",
    version: 2,
    status: "DRAFT",
    title: "Asistente de conocimiento - revision",
    content: "Prioriza procedimientos de seguridad y mantenimiento preventivo en la respuesta.",
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    publishedAt: null,
  },
  {
    id: "prompt-maintenance_insights-en-v1",
    capability: "maintenance_insights",
    locale: "en",
    version: 1,
    status: "PUBLISHED",
    title: "Maintenance insights - base",
    content: "Summarize maintenance trends with actionable next steps.",
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z",
    publishedAt: "2026-04-05T00:00:00.000Z",
  },
  {
    id: "prompt-rca_assistant-es-v1",
    capability: "rca_assistant",
    locale: "es",
    version: 1,
    status: "ARCHIVED",
    title: "RCA asistente - version previa",
    content: "Guia el analisis RCA con enfoque en hechos verificables.",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    publishedAt: "2026-03-20T00:00:00.000Z",
  },
];

export interface DevPromptCreateInput {
  capability: DevPromptCapability;
  locale: LocaleCode;
  title: string;
  content: string;
}

export interface DevPromptUpdateInput {
  title?: string;
  content?: string;
}

export function listDevPrompts(filters: {
  capability?: string | null;
  locale?: string | null;
  status?: string | null;
} = {}): DevPromptRecord[] {
  return DEV_PROMPTS.filter((prompt) => {
    if (filters.capability && prompt.capability !== filters.capability) return false;
    if (filters.locale && prompt.locale !== filters.locale) return false;
    if (filters.status && prompt.status !== filters.status) return false;
    return true;
  }).sort((a, b) => {
    if (a.capability !== b.capability) return a.capability.localeCompare(b.capability);
    if (a.locale !== b.locale) return a.locale.localeCompare(b.locale);
    return a.version - b.version;
  });
}

export function getDevPromptById(id: string): DevPromptRecord | null {
  return DEV_PROMPTS.find((prompt) => prompt.id === id) || null;
}

export function createDevPrompt(input: DevPromptCreateInput): DevPromptRecord {
  const existingVersions = DEV_PROMPTS.filter(
    (prompt) => prompt.capability === input.capability && prompt.locale === input.locale,
  );
  const nextVersion = existingVersions.length
    ? Math.max(...existingVersions.map((prompt) => prompt.version)) + 1
    : 1;
  const now = new Date().toISOString();
  const record: DevPromptRecord = {
    id: `prompt-${input.capability}-${input.locale}-v${nextVersion}`,
    capability: input.capability,
    locale: input.locale,
    version: nextVersion,
    status: "DRAFT",
    title: input.title,
    content: input.content,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
  DEV_PROMPTS.push(record);
  return record;
}

export function updateDevPrompt(id: string, input: DevPromptUpdateInput): DevPromptRecord | null {
  const record = DEV_PROMPTS.find((prompt) => prompt.id === id);
  if (!record) return null;
  if (record.status !== "DRAFT") return null;

  if (input.title !== undefined) record.title = input.title;
  if (input.content !== undefined) record.content = input.content;
  record.updatedAt = new Date().toISOString();
  return record;
}

export function publishDevPrompt(id: string): DevPromptRecord | null {
  const record = DEV_PROMPTS.find((prompt) => prompt.id === id);
  if (!record) return null;

  const now = new Date().toISOString();
  DEV_PROMPTS.forEach((prompt) => {
    if (prompt.capability === record.capability && prompt.locale === record.locale) {
      if (prompt.id !== record.id && prompt.status === "PUBLISHED") {
        prompt.status = "ARCHIVED";
        prompt.updatedAt = now;
      }
    }
  });

  record.status = "PUBLISHED";
  record.publishedAt = now;
  record.updatedAt = now;
  return record;
}
