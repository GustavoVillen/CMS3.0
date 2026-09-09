// Advisory locks de Postgres para serializar secciones cortas dentro de una
// transacción (generar un código secuencial, evitar un duplicado).
//
// OJO CON LA FORMA DE LLAMARLO (verificado contra la base, 2026-09-09):
// `pg_advisory_xact_lock()` devuelve `void`, y el adaptador de Prisma no sabe
// deserializar esa columna: `$queryRawUnsafe("SELECT pg_advisory_xact_lock(n)")`
// SIEMPRE falla con "Failed to deserialize column of type 'void'". Como el
// patrón original envuelve la llamada en un try/catch para tolerar motores sin
// advisory locks, el error se tragaba y el lock NUNCA se tomaba.
//
// Por eso acá se usa `$executeRawUnsafe`, que no deserializa columnas, con
// `$queryRawUnsafe` + alias booleano como alternativa.
//
// El mismo patrón roto sigue escrito a mano en `tenant/pms/capa-service.ts`
// (createCapaInternal): ahí el anti-duplicado depende sólo del findFirst, sin
// lock. Queda reportado; cambiarlo estaba fuera del alcance de esta auditoría.

/** Cliente Prisma o `tx` capaz de correr SQL crudo. */
export interface RawQueryable {
  $executeRawUnsafe?: (query: string, ...params: unknown[]) => Promise<unknown>;
  $queryRawUnsafe?: (query: string, ...params: unknown[]) => Promise<unknown>;
}

/**
 * Hash determinístico de un string a un int32 (lo que acepta
 * `pg_advisory_xact_lock(int)`). FNV-1a: distribución decente y rápido.
 */
export function hashToInt32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h | 0;
}

/**
 * Toma un advisory lock que dura hasta el fin de la transacción en curso.
 *
 * @returns true si el lock se tomó de verdad; false si el motor no lo soporta
 *          (runner de tests, sqlite) o la llamada falló. En ese caso la
 *          protección que queda es la constraint UNIQUE más el reintento
 *          (`withUniqueRetry`), que es el comportamiento previo.
 */
export async function takeAdvisoryXactLock(client: RawQueryable, key: string): Promise<boolean> {
  const lockKey = hashToInt32(key);

  if (client.$executeRawUnsafe) {
    try {
      await client.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
      return true;
    } catch {
      /* sigue con la alternativa */
    }
  }

  if (client.$queryRawUnsafe) {
    try {
      // `IS NULL` convierte el void en un booleano que Prisma sí deserializa.
      await client.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey}) IS NULL AS locked`);
      return true;
    } catch {
      /* sin lock: queda la constraint + el retry */
    }
  }

  return false;
}
