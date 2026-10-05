// Registro fire-and-forget de cada pregunta al copiloto y de lo que respondió.
// Lo lee únicamente el SUPERADMIN de plataforma para detectar qué necesitan los
// usuarios y si las respuestas sirven. No debe bloquear ni romper el stream.
//
// Retención: se guardan los últimos RETENTION_DAYS días y, como tope, MAX_BYTES
// de texto entre preguntas y respuestas; lo que llegue primero. Al pasarse se
// borran las más viejas. La poda corre como mucho una vez por PRUNE_EVERY_MS.

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

export interface CopilotQuestionHandle {
  /** Guarda la respuesta final (texto ya sin el bloque de acciones). */
  saveAnswer(answer: string): void;
}

const MAX_QUESTION_LEN = 4000;
const MAX_ANSWER_LEN = 8000;
export const COPILOT_QUESTIONS_RETENTION_DAYS = 90;
export const COPILOT_QUESTIONS_MAX_BYTES = 3 * 1024 * 1024;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

type Delegate = {
  create(a: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
  update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  deleteMany(a: { where: Record<string, unknown> }): Promise<{ count: number }>;
};

const NOOP: CopilotQuestionHandle = { saveAnswer() {} };

export function recordCopilotQuestion(input: CopilotQuestionInput): CopilotQuestionHandle {
  const text = input.question.trim();
  if (!text) return NOOP;
  const prisma = getPrismaClient();
  if (!prisma) return NOOP;
  const delegate = (prisma as unknown as { copilotQuestion: Delegate }).copilotQuestion;

  const created = delegate.create({
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
    select: { id: true },
  });
  created.catch((err) => { log.error("[copilot-question-log] failed:", err); });

  return {
    saveAnswer(answer: string) {
      const clean = answer.trim();
      if (!clean) return;
      created
        .then(({ id }) => delegate.update({ where: { id }, data: { answer: clean.slice(0, MAX_ANSWER_LEN) } }))
        .then(() => pruneCopilotQuestions())
        .catch((err) => { log.error("[copilot-question-log] answer failed:", err); });
    },
  };
}

let lastPruneAt = 0;

/** Borra lo de más de 90 días y, si el texto guardado pasa de 3 MB, las más viejas. */
export async function pruneCopilotQuestions(force = false): Promise<void> {
  if (!force && Date.now() - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = Date.now();
  const prisma = getPrismaClient();
  if (!prisma) return;
  const delegate = (prisma as unknown as { copilotQuestion: Delegate }).copilotQuestion;

  const cutoff = new Date(Date.now() - COPILOT_QUESTIONS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const old = await delegate.deleteMany({ where: { createdAt: { lt: cutoff } } });

  // Acumulado de tamaño de la más nueva a la más vieja: todo lo que queda por
  // encima del tope se borra.
  const bySize = await prisma.$executeRaw`
    DELETE FROM "CopilotQuestion" WHERE id IN (
      SELECT id FROM (
        SELECT id, SUM(octet_length(question) + COALESCE(octet_length(answer), 0))
                 OVER (ORDER BY "createdAt" DESC, id DESC) AS acc
        FROM "CopilotQuestion"
      ) t WHERE t.acc > ${COPILOT_QUESTIONS_MAX_BYTES}
    )`;
  if (old.count || bySize) log.info(`[copilot-question-log] poda: ${old.count} por antigüedad, ${bySize} por tamaño`);
}

/** Uso actual del registro, para mostrarlo en la consola. */
export async function getCopilotQuestionsStorage(): Promise<{ count: number; bytes: number; oldest: string | null; maxBytes: number; retentionDays: number }> {
  const base = { maxBytes: COPILOT_QUESTIONS_MAX_BYTES, retentionDays: COPILOT_QUESTIONS_RETENTION_DAYS };
  const prisma = getPrismaClient();
  if (!prisma) return { count: 0, bytes: 0, oldest: null, ...base };
  const rows = await prisma.$queryRaw<Array<{ count: bigint; bytes: bigint | null; oldest: Date | null }>>`
    SELECT COUNT(*) AS count,
           SUM(octet_length(question) + COALESCE(octet_length(answer), 0)) AS bytes,
           MIN("createdAt") AS oldest
    FROM "CopilotQuestion"`;
  const r = rows[0];
  return { count: Number(r?.count ?? 0), bytes: Number(r?.bytes ?? 0), oldest: r?.oldest ? r.oldest.toISOString() : null, ...base };
}
