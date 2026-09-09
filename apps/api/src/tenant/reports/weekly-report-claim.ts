// Reserva del envío del parte semanal de flota.
//
// AUDITORÍA 2026-09-09 — el scheduler (`server.ts`) mandaba el correo y RECIÉN
// DESPUÉS escribía la fila en `ScheduledReportRun`. El índice único
// (tenantId, reportKind, periodKey) sólo frenaba al tick siguiente del mismo
// proceso: dos instancias, o un reinicio en el medio, leían las dos "todavía
// no está" y el parte salía dos veces.
//
// Acá la fila se CREA ANTES de mandar nada y ese mismo índice único es el que
// reparte: quien pierde la carrera recibe P2002 y no manda. Es una reserva
// persistente (sobrevive a reinicios y sirve para cualquier cantidad de
// instancias), a diferencia de un contador en memoria.
//
// Estado intermedio SIN tocar el schema: el enum `ScheduledReportStatus` no
// tiene un valor "en curso", así que la reserva se marca con `status: FAILED`
// + `error: PENDING_SEND` y al terminar se pisa con el resultado real. Es
// fail-safe: si el proceso muere justo ahí, la fila queda como fallida (que es
// la verdad) en vez de como enviada.
//
// LÍMITE CONOCIDO: si el proceso muere DURANTE el diálogo con el servidor de
// correo, nadie puede saber si el mensaje llegó a salir — no hay forma de
// garantizar "exactamente una vez" contra SMTP. Se eligió reintentar UNA sola
// vez (`STALE_CLAIM_MS`) y dejar la traza en la fila: reintentar sin límite
// podría inundar de correos, y no reintentar podría perder el parte de la
// semana para siempre.

/** La reserva está tomada y el correo todavía no salió. */
export const WEEKLY_CLAIM_PENDING = "PENDING_SEND";

/** Se está usando el único reintento permitido sobre una reserva colgada. */
export const WEEKLY_CLAIM_RETRY = "PENDING_SEND_RETRY";

/** Una reserva más vieja que esto quedó colgada por una caída del proceso. */
export const WEEKLY_STALE_CLAIM_MS = 30 * 60 * 1000;

export interface WeeklyReportRunStore {
  create(args: { data: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{ id: string }>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  findUnique(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{ id: string } | null>;
}

export interface WeeklyReportClaim {
  /** Id de la fila reservada: sobre ella se escriben el html y el resultado. */
  id: string;
  /** true si se tomó el reintento de una reserva colgada. */
  retry: boolean;
}

/**
 * Reserva el envío del parte de una semana, o devuelve `null` si ya está
 * tomado (y entonces el llamador NO debe mandar nada).
 *
 * - Sin fila → la crea reservada. Si dos procesos entran juntos, el índice
 *   único deja pasar a uno solo; el otro recibe P2002 y sale con `null`.
 * - Fila ya cerrada (SENT / SKIPPED_* / FAILED con un error real) → `null`.
 * - Fila reservada y vieja → compare-and-swap `PENDING_SEND` →
 *   `PENDING_SEND_RETRY` con un `updateMany` condicionado: gana un solo
 *   proceso, aunque compitan varios.
 * - Fila ya en `PENDING_SEND_RETRY` → se agotó el reintento, `null`.
 *
 * @param now  inyectable para tests; por defecto, el reloj real.
 */
export async function claimWeeklyReportRun(
  prisma: { scheduledReportRun: WeeklyReportRunStore },
  tenantId: string,
  reportKind: "WEEKLY_OPENING" | "WEEKLY_CLOSING",
  periodKey: string,
  recipients: string[],
  now: Date = new Date(),
): Promise<WeeklyReportClaim | null> {
  try {
    const created = await prisma.scheduledReportRun.create({
      data: {
        tenantId,
        reportKind,
        periodKey,
        status: "FAILED",
        error: WEEKLY_CLAIM_PENDING,
        recipients,
      },
      select: { id: true },
    });
    return { id: created.id, retry: false };
  } catch (err: unknown) {
    // Cualquier otro error (base caída, datos inválidos) sí tiene que subir.
    if ((err as { code?: string })?.code !== "P2002") throw err;
  }

  // Ya existe. Sólo se reintenta si quedó colgada en PENDING_SEND hace rato.
  const cutoff = new Date(now.getTime() - WEEKLY_STALE_CLAIM_MS);
  const taken = await prisma.scheduledReportRun.updateMany({
    where: {
      tenantId,
      reportKind,
      periodKey,
      status: "FAILED",
      error: WEEKLY_CLAIM_PENDING,
      sentAt: { lt: cutoff },
    },
    data: { error: WEEKLY_CLAIM_RETRY },
  });
  if (taken.count === 0) return null;

  const row = await prisma.scheduledReportRun.findUnique({
    where: { tenantId_reportKind_periodKey: { tenantId, reportKind, periodKey } },
    select: { id: true },
  });
  return row ? { id: row.id, retry: true } : null;
}
