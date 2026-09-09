// Cliente Prisma del proceso, con recuperación automática de la conexión.
//
// BUG-004 (auditoría 2026-09-09). Cómo estaba: el `pool.on("error")` ponía
// `dbReachable = false` y a partir de ahí `getPrismaClient()` devolvía `null`
// para siempre. Volver a conectar dependía de que alguien llamara a
// `resetPrismaClient()`, y el único que lo hace es el catch de `server.ts`
// cuando el mensaje del error contiene ECONNREFUSED / P1001. El problema es que
// una vez marcada la base como caída ya no salen esos errores: los servicios
// reciben `null` y responden 503 (o listas vacías) sin llegar nunca a Prisma.
// Resultado: Postgres se recuperaba y la API seguía caída hasta reiniciarla.
//
// Ahora la recuperación es del propio módulo: pasado un tiempo de espera, el
// siguiente `getPrismaClient()` reconstruye el cliente. Con tres cuidados:
//
//   · UN intento por ventana. `getPrismaClient()` es síncrono, así que el
//     cambio de estado ocurre dentro del mismo tick: no hay dos reconexiones
//     simultáneas ni tormenta de reintentos.
//   · Espera creciente, de 1s a 30s. Si la base sigue caída no se insiste cada
//     request; si el cliente nuevo aguantó un rato antes de fallar, la espera
//     vuelve al mínimo (fue un corte puntual, no una base ausente).
//   · El pool viejo se cierra. Antes se descartaba la referencia y sus sockets
//     quedaban a cargo del recolector; ahora se le pide `end()` explícito.
//
// La disponibilidad la expone `getDatabaseStatus()` para que el healthcheck
// pueda distinguir "el proceso vive" de "el proceso puede operar".

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../../../generated/prisma";

type PrismaClientLike = PrismaClient;

/** Espera mínima y máxima entre intentos de reconexión. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Si el cliente nuevo aguantó al menos esto antes de volver a fallar, el corte
 * se considera puntual y la espera vuelve al mínimo.
 */
const HEALTHY_RUN_MS = 30_000;

let prismaClient: PrismaClientLike | null = null;
let activePool: Pool | null = null;

let dbReachable = true;      // optimista; pasa a false al primer error de conexión
let retryDelayMs = RETRY_MIN_MS;
let nextRetryAt = 0;         // epoch ms a partir del cual se puede reintentar
let clientStartedAt = 0;     // cuándo se construyó el cliente en uso

/** Cierra un pool descartado sin dejar que su error tumbe nada. */
function disposePool(pool: Pool | null, client: PrismaClientLike | null): void {
  if (client) {
    try { void (client as unknown as { $disconnect?: () => Promise<void> }).$disconnect?.().catch(() => {}); }
    catch { /* el cliente ya estaba roto */ }
  }
  if (pool) {
    // `end()` puede tirar si ya se cerró: es exactamente el caso que queremos
    // tolerar, porque acá sólo estamos liberando lo que quedó colgado.
    try { void pool.end().catch(() => {}); } catch { /* noop */ }
  }
}

/** Marca la base como no disponible y programa el próximo intento. */
function markUnreachable(): void {
  const aguantó = clientStartedAt > 0 && Date.now() - clientStartedAt >= HEALTHY_RUN_MS;
  retryDelayMs = aguantó ? RETRY_MIN_MS : Math.min(retryDelayMs * 2, RETRY_MAX_MS);

  dbReachable = false;
  nextRetryAt = Date.now() + retryDelayMs;

  disposePool(activePool, prismaClient);
  activePool = null;
  prismaClient = null;
  clientStartedAt = 0;
}

export function getPrismaClient(): PrismaClientLike | null {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) return null;

  // Caída: sólo se reintenta cuando venció la espera. Un único intento por
  // ventana, porque el flag se levanta antes de construir nada.
  if (!dbReachable) {
    if (Date.now() < nextRetryAt) return null;
    dbReachable = true;
  }

  try {
    if (!prismaClient) {
      const pool = new Pool({ connectionString: databaseUrl });

      // El pool avisa de los errores de conexión de forma asíncrona: puede
      // llegar mucho después de la consulta que los provocó.
      pool.on("error", () => {
        if (activePool === pool) markUnreachable();
      });

      const adapter = new PrismaPg(pool);
      prismaClient = new PrismaClient({ adapter } as any);
      activePool = pool;
      clientStartedAt = Date.now();
    }
    return prismaClient;
  } catch {
    // Ni siquiera se pudo construir el cliente: vuelve a esperar.
    markUnreachable();
    return null;
  }
}

/**
 * Fuerza un intento de reconexión inmediato (sin esperar el backoff).
 *
 * La usa `server.ts` cuando un error de conexión llega hasta el handler. Ya no
 * es la única vía de recuperación, pero acelera el primer reintento.
 */
export function resetPrismaClient(): void {
  disposePool(activePool, prismaClient);
  activePool = null;
  prismaClient = null;
  clientStartedAt = 0;
  dbReachable = true;
  retryDelayMs = RETRY_MIN_MS;
  nextRetryAt = 0;
}

export type DatabaseStatus = "up" | "down" | "not_configured";

/**
 * Disponibilidad de la base para atender operaciones.
 *
 * "up" no garantiza que la próxima consulta funcione: dice que el proceso no
 * tiene la conexión marcada como caída. Es lo que se puede afirmar sin hacer
 * una consulta de sondeo en cada healthcheck.
 */
export function getDatabaseStatus(): DatabaseStatus {
  if (!String(process.env.DATABASE_URL || "").trim()) return "not_configured";
  return dbReachable ? "up" : "down";
}

/** Segundos que faltan para el próximo intento de reconexión (0 si no aplica). */
export function getDatabaseRetryInSeconds(): number {
  if (dbReachable) return 0;
  return Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000));
}
