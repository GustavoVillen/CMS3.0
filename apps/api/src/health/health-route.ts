// Dos preguntas distintas, dos respuestas distintas (BUG-004):
//
//   /health  — ¿el proceso está vivo? Es el que mira el despliegue para decidir
//              si reinicia el contenedor. Sigue contestando 200 y
//              `status: "ok"` aunque la base esté caída: reiniciar la API no
//              arregla un Postgres caído, y con reinicios en loop se pierde
//              hasta la posibilidad de recuperarse solo.
//
//   /readyz  — ¿puede atender operaciones? Contesta 503 cuando la conexión a la
//              base está marcada como caída. Es la señal para el balanceador,
//              el monitoreo y quien está diagnosticando: antes /health decía
//              "ok" con la base inalcanzable y no había forma de verlo.

import { getDatabaseStatus, getDatabaseRetryInSeconds, type DatabaseStatus } from "../platform/data/prisma-client";

export interface HealthcheckPayload {
  status: "ok";
  service: "api";
  timestamp: string;
  /** Informativo: NO cambia el `status` ni el código HTTP del liveness. */
  database: DatabaseStatus;
}

export function buildHealthcheckPayload(): HealthcheckPayload {
  return {
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
    database: getDatabaseStatus(),
  };
}

export interface ReadinessResult {
  statusCode: 200 | 503;
  payload: {
    status: "ready" | "degraded";
    service: "api";
    timestamp: string;
    database: DatabaseStatus;
    /** Segundos hasta el próximo intento de reconexión, si está caída. */
    retryInSeconds?: number;
  };
}

export function buildReadinessResult(): ReadinessResult {
  const database = getDatabaseStatus();
  // `not_configured` es un despliegue sin DATABASE_URL (dev con fixtures): no
  // es una caída, así que no se reporta como degradado.
  const ready = database !== "down";

  return {
    statusCode: ready ? 200 : 503,
    payload: {
      status: ready ? "ready" : "degraded",
      service: "api",
      timestamp: new Date().toISOString(),
      database,
      ...(ready ? {} : { retryInSeconds: getDatabaseRetryInSeconds() }),
    },
  };
}
