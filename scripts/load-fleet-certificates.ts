/**
 * Carga los certificados de toda la flota Mercurio (menos MAO 01, que ya tiene
 * su propio load curado a mano — ver load-mao01-certificates.ts) desde el
 * "Tablero de vencimientos de documentos" (planilla de la naviera, corte al
 * 01-01-2026, hoja BaseCertificados de
 * MisDocs/Barcazas/1 Tablero de vencimientos documentos 01-01-2026.xlsx).
 *
 * Datos ya extraídos y normalizados en scripts/data/fleet-certificates-2026-01-01.json
 * (1298 filas, 36 buques). No se leen archivos externos en runtime: el JSON viaja
 * con el repo para que el script sea portable al VPS.
 *
 * Buques excluidos de esta carga:
 *   - MAO 01 (M01): ya tiene 77 certificados cargados a mano en producción.
 *   - YERUTI III, YT 001, YT 004: la planilla los incluye pero todavía no
 *     existen como Vessel en CMS3.0.
 *
 * Reglas de fecha (decisión del usuario, 2026-08-28, consistente con
 * load-mao01-certificates.ts):
 *   - "Sin Vencimiento" / "No aplica" → NO_EXPIRY (2099-12-31), nota explicando
 *     el origen. 2099 computa status ACTIVE: no dispara alertas falsas.
 *   - "Pendiente" (certificado vencido sin fecha de renovación registrada,
 *     Estado=Vencido en la planilla, sólo 8 filas) → EXPIRED_UNKNOWN
 *     (2020-01-01), para que el sistema SIGA mostrándolo como vencido en vez
 *     de esconder el problema. Nota explícita pidiendo confirmar con el buque.
 *   - Sin fecha de emisión registrada → NO_ISSUE (2000-01-01) + nota.
 *   - Sin "Expedido" (emisor) en la planilla → issuingAuthority "Por confirmar".
 *
 * certificateCode = CERT-<VESSEL>-<nº de fila dentro del buque, 3 dígitos>,
 * en el orden en que aparecen en la planilla (no hay número de planilla propio
 * como en la carga de MAO 01 en papel).
 *
 * Idempotente: por cada buque en ROWS, borra sus certificados CERT-<VESSEL>-*
 * y los reinserta.
 *
 * Uso (en el VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/load-fleet-certificates.ts   # previsualiza
 *   npx tsx scripts/load-fleet-certificates.ts         # ejecuta
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fleetData from "./data/fleet-certificates-2026-01-01.json";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const TENANT_SLUG = "mercurio";

const NO_EXPIRY = new Date("2099-12-31T00:00:00.000Z");
const NO_ISSUE = new Date("2000-01-01T00:00:00.000Z");
const EXPIRED_UNKNOWN = new Date("2020-01-01T00:00:00.000Z");

const SOURCE_TAG = "Tablero de vencimientos de documentos de la flota, corte 01-01-2026.";
const NOTE_SIN_VENCIMIENTO = `Sin vencimiento según el tablero de la naviera (${SOURCE_TAG})`;
const NOTE_NO_APLICA = `El tablero de la naviera lo marca como NO APLICA a este buque (${SOURCE_TAG}) Verificar si corresponde darlo de baja.`;
const NOTE_PENDIENTE = `Vencido según el tablero de la naviera, sin fecha de renovación registrada (${SOURCE_TAG}) Confirmar con el agente marítimo / el buque.`;
const NOTE_SIN_EMISION = "Fecha de emisión no registrada en el tablero de la naviera.";

interface Row {
  vessel: string;
  seq: number;
  name: string;
  gestiona: string | null;
  vto: string; // "YYYY-MM-DD" | "SIN_VENCIMIENTO" | "PENDIENTE" | "NO_APLICA"
  issued: string | null; // "YYYY-MM-DD" | null
  expedido: string | null;
  observ: string | null;
  validez: string | null;
}

const ROWS = fleetData as Row[];

interface Resolved {
  vessel: string;
  code: string;
  name: string;
  issuingAuthority: string;
  issueDate: Date;
  expiryDate: Date;
  notes: string | null;
}

function resolveRow(row: Row): Resolved {
  const notes: string[] = [];

  let issueDate: Date;
  if (row.issued) {
    issueDate = new Date(`${row.issued}T00:00:00.000Z`);
  } else {
    issueDate = NO_ISSUE;
    notes.push(NOTE_SIN_EMISION);
  }

  let expiryDate: Date;
  if (row.vto === "SIN_VENCIMIENTO") {
    expiryDate = NO_EXPIRY;
    notes.push(NOTE_SIN_VENCIMIENTO);
  } else if (row.vto === "NO_APLICA") {
    expiryDate = NO_EXPIRY;
    notes.push(NOTE_NO_APLICA);
  } else if (row.vto === "PENDIENTE") {
    expiryDate = EXPIRED_UNKNOWN;
    notes.push(NOTE_PENDIENTE);
  } else {
    expiryDate = new Date(`${row.vto}T00:00:00.000Z`);
  }

  if (row.gestiona) notes.push(`Gestiona: ${row.gestiona}.`);
  if (row.observ) notes.push(`Observación de origen: ${row.observ}.`);

  return {
    vessel: row.vessel,
    code: `CERT-${row.vessel}-${String(row.seq).padStart(3, "0")}`,
    name: row.name,
    issuingAuthority: row.expedido ?? "Por confirmar",
    issueDate,
    expiryDate,
    notes: notes.length ? notes.join(" ") : null,
  };
}

function computeStatus(expiryDate: Date): "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" {
  const diffDays = Math.floor((expiryDate.getTime() - Date.now()) / 86_400_000);
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= 30) return "EXPIRING_SOON";
  return "ACTIVE";
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" no encontrado.`);

  const vessels = await prisma.vessel.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    select: { code: true, name: true },
  });
  const vesselByCode = new Map(vessels.map((v: any) => [v.code, v.name]));

  const admins = await prisma.tenantMembership.findMany({
    where: { tenantId: tenant.id, role: "TENANT_ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!admins.length) throw new Error(`No hay TENANT_ADMIN en el tenant ${TENANT_SLUG}.`);
  const actor =
    admins.find((a: any) => a.user?.email === "jbael@mercuriogroup.com.py")?.userId ?? admins[0].userId;

  const resolved = ROWS.map(resolveRow);

  const missingVessel = resolved.filter(r => !vesselByCode.has(r.vessel));
  if (missingVessel.length) {
    const codes = [...new Set(missingVessel.map(r => r.vessel))];
    throw new Error(`Buques en los datos que no existen en CMS3.0: ${codes.join(", ")}`);
  }

  const codes = new Set(resolved.map(r => r.code));
  if (codes.size !== resolved.length) throw new Error("Códigos de certificado duplicados en ROWS.");

  const byVessel = new Map<string, Resolved[]>();
  for (const r of resolved) {
    if (!byVessel.has(r.vessel)) byVessel.set(r.vessel, []);
    byVessel.get(r.vessel)!.push(r);
  }

  console.log(`Tenant ${TENANT_SLUG} (${tenant.id}) · actor ${actor}`);
  console.log(`Buques: ${byVessel.size} · Filas totales: ${resolved.length}\n`);

  let totalSentinel = 0;
  for (const [vessel, rows] of [...byVessel.entries()].sort()) {
    const withSentinel = rows.filter(
      r => r.issueDate.getTime() === NO_ISSUE.getTime() ||
           r.expiryDate.getTime() === NO_EXPIRY.getTime() ||
           r.expiryDate.getTime() === EXPIRED_UNKNOWN.getTime()
    );
    totalSentinel += withSentinel.length;
    console.log(`${vessel} (${vesselByCode.get(vessel)}): ${rows.length} filas, ${withSentinel.length} con fecha centinela`);
  }
  console.log(`\nTotal con fecha centinela (revisar en pantalla): ${totalSentinel}`);

  if (DRY) {
    console.log("\nDRY=1 — no se escribió nada.");
    return;
  }

  let totalRemoved = 0;
  let totalCreated = 0;
  for (const [vessel, rows] of byVessel) {
    const prefix = `CERT-${vessel}-`;
    const removed = await prisma.certificate.deleteMany({
      where: { tenantId: tenant.id, vesselCode: vessel, certificateCode: { startsWith: prefix } },
    });
    totalRemoved += removed.count;

    for (const r of rows) {
      await prisma.certificate.create({
        data: {
          tenantId: tenant.id,
          vesselCode: r.vessel,
          certificateCode: r.code,
          name: r.name,
          issuingAuthority: r.issuingAuthority,
          status: computeStatus(r.expiryDate),
          issueDate: r.issueDate,
          expiryDate: r.expiryDate,
          notes: r.notes,
          createdByUserId: actor,
          updatedByUserId: actor,
        },
      });
      totalCreated++;
    }
  }
  console.log(`\nBorrados previos (recarga idempotente): ${totalRemoved}`);
  console.log(`Certificados creados: ${totalCreated}`);
}

main()
  .catch(e => {
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
