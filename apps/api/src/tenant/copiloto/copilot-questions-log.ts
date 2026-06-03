// Registro fire-and-forget de cada pregunta al copiloto. Sólo guarda la pregunta
// (no la respuesta). Lo lee únicamente el SUPERADMIN de plataforma para detectar
// qué necesitan los usuarios. No debe bloquear ni romper el stream del chat.

import { getPrismaClient } from "../../platform/data/prisma-client";
import { log } from "../../common/logger";

export interface CopilotQuestionInput {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  userEmail: string;
  userRole: string;
  capability: string;
  vesselCode?: string | null;
  screen?: string | null;
  question: string;
  hasAttachment?: boolean;
}

const MAX_QUESTION_LEN = 4000;

export function recordCopilotQuestion(input: CopilotQuestionInput): void {
  const text = input.question.trim();
  if (!text) return;

  (async () => {
    const prisma = getPrismaClient();
    if (!prisma) return;
    await (prisma as unknown as {
      copilotQuestion: { create(a: { data: Record<string, unknown> }): Promise<unknown> };
    }).copilotQuestion.create({
      data: {
        tenantId:      input.tenantId,
        tenantSlug:    input.tenantSlug,
        userId:        input.userId,
        userEmail:     input.userEmail,
        userRole:      input.userRole,
        capability:    input.capability,
        vesselCode:    input.vesselCode ?? null,
        screen:        input.screen ?? null,
        question:      text.slice(0, MAX_QUESTION_LEN),
        hasAttachment: input.hasAttachment ?? false,
      },
    });
  })().catch((err) => { log.error("[copilot-question-log] failed:", err); });
}
