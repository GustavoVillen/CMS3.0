// Helper para reintentar operaciones que pueden chocar con una constraint
// UNIQUE bajo concurrencia. Caso típico: generar un código secuencial
// (defectCode, capaCode, etc.) con count() + create(). Dos requests
// simultáneos leen el mismo count y el segundo crash con P2002.
//
// Uso:
//   const created = await withUniqueRetry(async (attempt) => {
//     const count = await defect.count({ where: { tenantId, vesselCode, ... } });
//     const next = count + 1 + attempt;
//     const defectCode = `DEF-${vesselCode}-${yy}-${String(next).padStart(4, "0")}`;
//     return defect.create({ data: { ..., defectCode } });
//   });

const PRISMA_UNIQUE_VIOLATION = "P2002";

export function isPrismaUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown };
  return e.code === PRISMA_UNIQUE_VIOLATION;
}

export async function withUniqueRetry<T>(
  fn: (attempt: number) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isPrismaUniqueViolation(err)) throw err;
    }
  }
  throw lastErr;
}
