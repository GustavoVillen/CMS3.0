// Dobles de prueba en memoria. NO tocan la base, ni el correo, ni servicios de
// IA: todo lo que hace falta para probar aislamiento entre empresas,
// revocación de accesos, descargas y concurrencia es lógica de decisión.

import type { TenantAccessSession } from "../../src/tenant/auth/session-store";

let tokenSeq = 0;

export function fakeSession(over: {
  tenantSlug?: string;
  userId?: string;
  role?: string;
  vessels?: string[];
} = {}): TenantAccessSession {
  // Token único por sesión: dos sesiones distintas (mismo usuario en dos
  // navegadores, o el mismo id en otra empresa) no pueden pisarse en el Map.
  const stamp = ++tokenSeq;
  return {
    kind: "tenant",
    tenantSlug: over.tenantSlug ?? "mercurio",
    accessToken: `at-${over.userId ?? "u1"}-${stamp}`,
    refreshToken: `rt-${over.userId ?? "u1"}-${stamp}`,
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    user: {
      id: over.userId ?? "u1",
      email: "test@example.local",
      role: (over.role ?? "TECHNICIAN_OPERATOR") as TenantAccessSession["user"]["role"],
      assignedVesselCodes: over.vessels ?? [],
      locale: "es",
    },
  };
}

/** Error con la forma que Prisma le da a una violación de índice único. */
export function uniqueViolation(): Error & { code: string } {
  const err = new Error("Unique constraint failed") as Error & { code: string };
  err.code = "P2002";
  return err;
}

/**
 * Tabla en memoria con un índice único compuesto, para probar carreras entre
 * dos "instancias" sin levantar Postgres.
 */
export class FakeUniqueTable<T extends Record<string, any>> {
  readonly rows: T[] = [];
  private seq = 0;

  constructor(private readonly uniqueKeys: string[]) {}

  private keyOf(row: Record<string, any>): string {
    return this.uniqueKeys.map((k) => String(row[k])).join("|");
  }

  create(args: { data: Record<string, any> }): Promise<{ id: string }> {
    const key = this.keyOf(args.data);
    if (this.rows.some((r) => this.keyOf(r) === key)) return Promise.reject(uniqueViolation());
    const row = { id: `row-${++this.seq}`, sentAt: new Date(), ...args.data } as unknown as T;
    this.rows.push(row);
    return Promise.resolve({ id: row.id as string });
  }

  private matches(row: Record<string, any>, where: Record<string, any>): boolean {
    return Object.entries(where).every(([field, cond]) => {
      const value = row[field];
      if (cond && typeof cond === "object" && !(cond instanceof Date)) {
        if ("lt" in cond) return value != null && value < (cond as any).lt;
        if ("in" in cond) return (cond as any).in.includes(value);
        // where anidado de índice compuesto: { tenantId_x_y: { ... } }
        return Object.entries(cond as Record<string, any>).every(([k, v]) => row[k] === v);
      }
      return value === cond;
    });
  }

  updateMany(args: { where: Record<string, any>; data: Record<string, any> }): Promise<{ count: number }> {
    let count = 0;
    for (const row of this.rows) {
      // Índice compuesto pasado como objeto anidado.
      const where = { ...args.where };
      for (const [k, v] of Object.entries(where)) {
        if (k.includes("_") && v && typeof v === "object" && !(v instanceof Date) && !("lt" in v) && !("in" in v)) {
          delete where[k];
          Object.assign(where, v);
        }
      }
      if (!this.matches(row, where)) continue;
      Object.assign(row, args.data);
      count += 1;
    }
    return Promise.resolve({ count });
  }

  findUnique(args: { where: Record<string, any> }): Promise<T | null> {
    const where: Record<string, any> = {};
    for (const [k, v] of Object.entries(args.where)) {
      if (v && typeof v === "object" && !(v instanceof Date)) Object.assign(where, v);
      else where[k] = v;
    }
    return Promise.resolve(this.rows.find((r) => this.matches(r, where)) ?? null);
  }
}
