import { getPrismaClient } from "../../platform/data/prisma-client";
import { publishAudit } from "../../platform/audit/audit-publisher";

/**
 * Ciclo de clase de los certificados (Preview certificados-ciclo V1, sep 2026).
 *
 * El módulo de Certificados guarda sólo certificados de clase. El esquema lo
 * define el tipo de buque:
 *   - remolcador: ciclo de 6 años, intermedia a los 3.
 *   - barcaza:    ciclo de 8 años, periódicas a los 2 y 6, intermedia a los 4.
 * Las ventanas (± 6 meses, renovación 12 meses antes) las arma la UI.
 *
 * Las fechas de cada inspección viven en el propio certificado, que es la
 * fuente válida (se corrigen con el Ship Status real). Mantenimiento las
 * actualiza al registrar la inspección: applyClassSurveyToCertificate.
 */
export interface ClassCycleInfo {
  vesselKind: "TUG" | "BARGE";
  cycleYears: number;
}

type Prisma = NonNullable<ReturnType<typeof getPrismaClient>>;
/** Sirve el cliente o una transacción: sólo se usa `certificate`. */
type CertificateDb = { certificate: Prisma["certificate"] };

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Mismo criterio que vessel-ai-context: el tipo es texto libre. null = no se sabe. */
function vesselKind(type: string | null | undefined): ClassCycleInfo["vesselKind"] | null {
  const t = norm(type ?? "");
  if (t.includes("barcaza") || t.includes("barge")) return "BARGE";
  if (t.includes("remolcador") || t.includes("empuje") || t.includes("tug")) return "TUG";
  return null;
}

/** Esquema de clase por buque, para los buques de la lista. */
export async function loadClassCycles(prisma: Prisma, tenantId: string, vesselCodes: string[]): Promise<Map<string, ClassCycleInfo>> {
  const codes = [...new Set(vesselCodes)];
  if (!codes.length) return new Map();
  const vessels = await prisma.vessel.findMany({ where: { tenantId, code: { in: codes } }, select: { code: true, vesselType: true } });
  const out = new Map<string, ClassCycleInfo>();
  for (const v of vessels) {
    const kind = vesselKind(v.vesselType);
    if (kind) out.set(v.code, { vesselKind: kind, cycleYears: kind === "TUG" ? 6 : 8 });
  }
  return out;
}

/** ¿Es el certificado de clase? El módulo no tiene campo de tipo: se lee el nombre. */
export function isClassCertificateName(name: string): boolean {
  return /clasific|\bclase\b/.test(norm(name));
}

/**
 * Situación del ciclo de clase de un certificado, con la misma regla que dibuja
 * la barra de la pantalla Certificados (web: components/ClassCycleBar.tsx ·
 * computeClassCycle). Si se cambia una, se cambia la otra: el panel de vetting
 * y la barra no pueden contradecirse sobre el mismo buque.
 *
 *   4 vencido · 3 inspección sin registrar · 2 ventana abierta
 *   1 ventana abre en ≤ 6 meses · 0 al día
 */
export type ClassCycleLevel = 0 | 1 | 2 | 3 | 4;

export function classCycleLevel(
  cert: {
    expiryDate: Date;
    intermediateSurveyDate: Date | null;
    intermediateSurveyDueDate: Date | null;
    periodicSurveyDate: Date | null;
    periodicSurveyDueDate: Date | null;
  },
  info: ClassCycleInfo,
  today = new Date(),
): ClassCycleLevel {
  const WINDOW_MONTHS = 6;
  const RENEWAL_WINDOW_MONTHS = 12;
  // Las fechas llegan a medianoche UTC: se toma el día calendario, igual que la
  // barra hace con el ISO que le manda la API.
  const day = (d: Date | null) => (d ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : null);
  const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  const monthsBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / (86_400_000 * 30.44)));

  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = day(cert.expiryDate)!;
  const start = addMonths(end, -12 * info.cycleYears);
  const marks: { kind: "int" | "per"; at: number }[] = info.vesselKind === "TUG"
    ? [{ kind: "int", at: 36 }]
    : [{ kind: "per", at: 24 }, { kind: "int", at: 48 }, { kind: "per", at: 72 }];
  const done = { int: day(cert.intermediateSurveyDate), per: day(cert.periodicSurveyDate) };
  const due = { int: day(cert.intermediateSurveyDueDate), per: day(cert.periodicSurveyDueDate) };
  const margin = info.cycleYears * 3;
  const near = (d: Date | null, target: Date) => !!d && d >= addMonths(target, -margin) && d <= addMonths(target, margin);
  type CycleWindow = { kind: "int" | "per" | "ren"; from: Date; to: Date; doneAt: Date | null };
  const windows: CycleWindow[] = marks.map(m => {
    const rule = addMonths(start, m.at);
    const target = near(due[m.kind], rule) ? due[m.kind]! : rule;
    const doneAt = near(done[m.kind], rule) ? done[m.kind] : null;
    return { kind: m.kind, from: addMonths(target, -WINDOW_MONTHS), to: addMonths(target, WINDOW_MONTHS), doneAt };
  });
  windows.push({ kind: "ren", from: addMonths(end, -RENEWAL_WINDOW_MONTHS), to: end, doneAt: null });

  if (now > end) return 4;
  const open = windows.find(w => now >= w.from && now <= w.to && !w.doneAt) ?? null;
  const closed = windows.filter(w => w.kind !== "ren" && w.to < now);
  const lastClosed = closed[closed.length - 1];
  const reported = lastClosed && (lastClosed.kind === "per"
    ? !!(done.per || due.per)
    : !!(done.int || due.int || done.per || due.per));
  if (lastClosed && !lastClosed.doneAt && reported && !(open && open.kind === lastClosed.kind)) return 3;
  if (open) return 2;
  const next = windows.find(w => w.from > now && !w.doneAt) ?? null;
  return next && monthsBetween(now, next.from) <= 6 ? 1 : 0;
}

export type ClassSurveyKind = "RENEWAL" | "INTERMEDIATE" | "PERIODIC" | "DRYDOCK" | "TAILSHAFT";

/**
 * Tipo de inspección de clase según el título del plan. Verificado contra los
 * títulos de producción: "Inspeccion INTERMEDIA de Clase", "Inspeccion de Clase
 * en SECO (RINA)", "Inspeccion del EJE PORTAHELICE", "Inspeccion de Eje
 * Portahelice (Babor) (RINA)"… Deja afuera el mantenimiento de la línea de ejes
 * ("LINEA DE EJE BR: Eje portahelice - …"), que no empieza con "inspeccion".
 */
export function classSurveyKindFromTitle(title: string): ClassSurveyKind | null {
  const t = norm(title).trim();
  if (!t.startsWith("inspeccion")) return null;
  if (t.includes("eje portahelice")) return "TAILSHAFT";
  if (!/\bclase\b/.test(t)) return null;
  if (t.includes("renovacion")) return "RENEWAL";
  if (t.includes("intermedia")) return "INTERMEDIATE";
  if (t.includes("periodica")) return "PERIODIC";
  if (t.includes("seco") || t.includes("dique")) return "DRYDOCK";
  return null;
}

const FIELDS: Record<ClassSurveyKind, { last: string; due: string | null }> = {
  // La renovación vence en expiryDate, que sólo cambia al renovar el certificado
  // (sale del papel nuevo de la clase, con historial).
  RENEWAL:      { last: "classRenewalDate",       due: null },
  INTERMEDIATE: { last: "intermediateSurveyDate", due: "intermediateSurveyDueDate" },
  PERIODIC:     { last: "periodicSurveyDate",     due: "periodicSurveyDueDate" },
  DRYDOCK:      { last: "drydockSurveyDate",      due: "drydockSurveyDueDate" },
  TAILSHAFT:    { last: "tailshaftSurveyDate",    due: "tailshaftSurveyDueDate" },
};

/**
 * Mantenimiento registró la ejecución de un plan: si es una inspección de clase,
 * lleva la fecha al certificado de clase del buque. Una corrección manual
 * posterior en el certificado manda hasta la próxima ejecución.
 *
 * Se llama dentro de la misma transacción que actualiza el plan.
 */
export async function applyClassSurveyToCertificate(
  // Cliente o transacción. Los servicios de OT y planes tipan su `tx` con un
  // subconjunto propio que no declara `certificate`, aunque en ejecución lo tiene.
  client: object,
  args: { tenantId: string; vesselCode: string; planTitle: string; executedAt: Date; nextDueDate: Date | null; actorUserId: string | null },
): Promise<void> {
  const kind = classSurveyKindFromTitle(args.planTitle);
  if (!kind) return;
  const db = client as CertificateDb;
  const certs = await db.certificate.findMany({
    where: { tenantId: args.tenantId, vesselCode: args.vesselCode, deletedAt: null },
    select: { id: true, name: true, certificateCode: true },
    orderBy: { expiryDate: "desc" },
  });
  const cert = certs.find(c => isClassCertificateName(c.name));
  if (!cert) return;

  const f = FIELDS[kind];
  const data: Record<string, unknown> = { [f.last]: args.executedAt };
  if (f.due) data[f.due] = args.nextDueDate;
  if (args.actorUserId) data.updatedByUserId = args.actorUserId;
  await db.certificate.update({ where: { id: cert.id }, data });

  const prisma = getPrismaClient();
  if (prisma) {
    void publishAudit(prisma, {
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      action: "Certificate.updatedFromMaintenance",
      entityType: "Certificate",
      entityId: cert.id,
      metadata: { certificateCode: cert.certificateCode, vesselCode: args.vesselCode, planTitle: args.planTitle, kind, executedAt: args.executedAt, nextDueDate: args.nextDueDate },
    });
  }
}
