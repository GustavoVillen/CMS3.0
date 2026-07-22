/**
 * Carga los 77 certificados / documentos estatutarios del MAO 01 (vessel M01,
 * tenant mercurio) desde la planilla de papel del buque.
 *
 * Contexto y decisiones (acordadas con el usuario antes de escribir esto):
 *
 *  - Bandera PARAGUAYA → los certificados estatutarios figuran emitidos por la
 *    Prefectura General Naval (Paraguay). Radio/AIS → CONATEL. Clase y planos →
 *    sociedad de clasificación (a confirmar). Calibraciones, LCI, izaje, etc. →
 *    taller externo genérico "(por confirmar)".
 *
 *  - El modelo Certificate exige issueDate y expiryDate NO NULOS. La planilla
 *    de papel trae ~41 filas con "✓", "S/V", "N/A", "—" o en blanco. Para poder
 *    cargarlas igual (decisión del usuario: "cargar todo, marcando lo que falta")
 *    se usan dos fechas centinela, SIEMPRE acompañadas de una nota explícita:
 *       NO_EXPIRY  = 2099-12-31 → sin vencimiento / vencimiento a confirmar
 *       NO_ISSUE   = 2000-01-01 → fecha de emisión no registrada en el papel
 *    La nota (`notes`) es la fuente de verdad de por qué la fecha es centinela.
 *    Ninguna centinela dispara falsas alertas: 2099 computa status = ACTIVE.
 *
 *  - Fechas del papel en formato dd-mm-aa (07-01-26 = 7 de enero de 2026).
 *    Dos filas traen fecha parcial y quedan marcadas para confirmar:
 *       #23 extintores  → vence "02-27"    → se asume 28-02-2027
 *       #28 OSRO PY     → vence "Julio"    → se asume 31-07-2027
 *
 *  - La fila 43 de la planilla no era legible en el original → NO se carga.
 *
 *  - certificateCode = CERT-M01-<Nº de la planilla, 3 dígitos>, para que el
 *    número del papel siga siendo rastreable en el sistema.
 *
 * Idempotente: borra (hard delete) todos los certificados de M01 cuyo código
 * empieza con CERT-M01- y los reinserta.
 *
 * Uso (en el VPS):
 *   export $(grep -E '^DATABASE_URL=' .env | xargs)
 *   DRY=1 npx tsx scripts/load-mao01-certificates.ts   # previsualiza
 *   npx tsx scripts/load-mao01-certificates.ts         # ejecuta
 */
import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
} as any) as any;

const DRY = process.env.DRY === "1";
const TENANT_SLUG = "mercurio";
const VESSEL = "M01";
const CODE_PREFIX = "CERT-M01-";

const NO_EXPIRY = new Date("2099-12-31T00:00:00.000Z");
const NO_ISSUE = new Date("2000-01-01T00:00:00.000Z");

const NOTE_NO_EXPIRY = "Sin vencimiento (la planilla del buque no registra fecha de vencimiento).";
const NOTE_CHECK = "Certificado vigente a bordo, pero la planilla del buque sólo lo marcaba con ✓: fechas a confirmar.";
const NOTE_NA = "La planilla del buque lo marca como NO APLICA a este buque. Verificar si corresponde darlo de baja.";
const NOTE_BLANK = "Fecha no registrada en la planilla del buque. A confirmar.";

// ── Autoridades emisoras ──────────────────────────────────────────────────────
const PGN = "Prefectura General Naval (Paraguay)";
const CONATEL = "CONATEL (Paraguay)";
const CLASE = "Sociedad de clasificación (por confirmar)";
const LCI = "Taller de servicio contra incendio (por confirmar)";
const CALIB = "Laboratorio de calibración (por confirmar)";
const IZAJE = "Ente certificador de izaje (por confirmar)";
const ELEC = "Taller eléctrico (por confirmar)";
const TBD = "Por confirmar";

/**
 * Fila de la planilla de papel.
 *   n:    número de la planilla (define el certificateCode)
 *   iss:  fecha de emisión tal cual el papel — "dd-mm-aa" | "" (no registrada)
 *   exp:  fecha de vencimiento tal cual el papel — "dd-mm-aa" | "SV" (sin
 *         vencimiento) | "NA" (no aplica) | "" (no registrada)
 *   chk:  true si el papel sólo tenía ✓ en ambas columnas
 *   note: nota adicional que se concatena a la nota automática
 */
interface Row {
  n: number;
  name: string;
  auth: string;
  iss: string;
  exp: string;
  chk?: boolean;
  note?: string;
}

const ROWS: Row[] = [
  { n: 1,  name: "Patente de Navegación",                                                            auth: PGN,     iss: "07-01-26", exp: "31-12-26" },
  { n: 2,  name: "Certificado de Matrícula",                                                         auth: PGN,     iss: "25-01-23", exp: "SV" },
  { n: 3,  name: "Certificado de Habilitación",                                                      auth: PGN,     iss: "06-01-23", exp: "15-09-26" },
  { n: 4,  name: "Certificado de Arqueo",                                                            auth: PGN,     iss: "22-02-23", exp: "SV" },
  { n: 5,  name: "Certificado de Seguridad de la Navegación",                                        auth: PGN,     iss: "12-02-24", exp: "12-02-28" },
  { n: 6,  name: "Certificado Nacional de Navegabilidad",                                            auth: PGN,     iss: "06-01-26", exp: "23-01-27" },
  { n: 7,  name: "Certificado de Seguridad de la Construcción para buque de carga",                  auth: PGN,     iss: "06-01-26", exp: "25-01-27" },
  { n: 8,  name: "Inventario del EQ adjunto al Certificado de Seguridad de Equipo para Buque de Carga", auth: PGN,   iss: "06-01-26", exp: "06-01-27" },
  { n: 9,  name: "Certificado de Prevención de la Contaminación por Hidrocarburos",                   auth: PGN,     iss: "10-01-25", exp: "25-01-27" },
  { n: 10, name: "Certificado Nacional de Prevención de la Contaminación por Aguas Sucias",           auth: PGN,     iss: "06-01-26", exp: "25-01-27" },
  { n: 11, name: "Certificado Nacional para la Prevención de la Contaminación por Basuras",           auth: PGN,     iss: "06-01-26", exp: "25-01-27" },
  { n: 12, name: "Certificado Nacional de Seguridad Radioeléctrica para buque de carga",              auth: CONATEL, iss: "", exp: "", chk: true },
  { n: 13, name: "Inventario del EQ adjunto al Certificado de Seguridad Radioeléctrica para Buque de Carga", auth: CONATEL, iss: "", exp: "", chk: true },
  { n: 14, name: "Certificado de Seguridad de las Máquinas",                                          auth: PGN,     iss: "", exp: "", chk: true },
  { n: 15, name: "Certificado de Buque (PBIP)",                                                       auth: PGN,     iss: "24-01-25", exp: "06-08-26" },
  { n: 16, name: "Documento de Cumplimiento (DOC)",                                                   auth: PGN,     iss: "28-07-23", exp: "06-08-28" },
  { n: 17, name: "Registro Sinóptico Continuo (RSC)",                                                 auth: PGN,     iss: "", exp: "SV" },
  { n: 18, name: "Certificado de Cumplimiento de Compañía",                                           auth: PGN,     iss: "08-07-25", exp: "15-07-30" },
  { n: 19, name: "Certificado de Control de Sanidad",                                                 auth: "Ministerio de Salud Pública y Bienestar Social (Paraguay)", iss: "24-04-26", exp: "24-10-26" },
  { n: 20, name: "Certificado de Dotación de Explotación",                                            auth: PGN,     iss: "25-01-23", exp: "SV" },
  { n: 21, name: "Certificado de Dotación Mínima de Seguridad",                                       auth: PGN,     iss: "", exp: "", chk: true },
  { n: 22, name: "Certificado de Fumigación",                                                         auth: "Empresa de fumigación (por confirmar)", iss: "11-07-26", exp: "11-10-27" },
  { n: 23, name: "Certificado de Extintores",                                                         auth: LCI,     iss: "12-02-26", exp: "28-02-27", note: "La planilla sólo indica 02-27 como vencimiento; se asume fin de febrero de 2027. CONFIRMAR el día exacto." },
  { n: 24, name: "Inspección Port State Control",                                                     auth: "Autoridad de Port State Control", iss: "", exp: "" },
  { n: 25, name: "Incorporación a la flota",                                                          auth: PGN,     iss: "17-01-23", exp: "SV" },
  { n: 26, name: "Certificado de Clase",                                                              auth: CLASE,   iss: "11-04-23", exp: "15-03-29" },
  { n: 27, name: "Certificado OSRO Argentina Clean Sea",                                              auth: "Clean Sea S.A. (OSRO Argentina)", iss: "04-01-26", exp: "03-01-27" },
  { n: 28, name: "Certificado OSRO Paraguay",                                                         auth: "OSRO Paraguay (por confirmar)", iss: "01-07-26", exp: "31-07-27", note: "La planilla indica emisión 'Julio-26' y vencimiento 'Julio', sin día. Se asume emisión 01-07-2026 y vencimiento 31-07-2027. CONFIRMAR." },
  { n: 29, name: "Certificado AIS",                                                                   auth: CONATEL, iss: "22-07-26", exp: "21-01-27" },
  { n: 30, name: "Certificado Orca River",                                                            auth: "Orca River (por confirmar)", iss: "20-01-26", exp: "" },
  { n: 31, name: "Certificado Balsa Salvavidas",                                                      auth: "Estación de servicio de balsas salvavidas (por confirmar)", iss: "25-03-26", exp: "25-03-27" },
  { n: 32, name: "Certificado de Espuma",                                                             auth: LCI,     iss: "27-03-26", exp: "27-03-27" },
  { n: 33, name: "Certificado Barómetro",                                                             auth: CALIB,   iss: "25-03-26", exp: "25-03-27" },
  { n: 34, name: "Certificado de EQ de Respiración Autónomo 2",                                       auth: "Taller de equipos de respiración (por confirmar)", iss: "", exp: "", chk: true },
  { n: 35, name: "Certificado Tubos para EQ Autónomos auxiliar",                                      auth: "Taller de equipos de respiración (por confirmar)", iss: "", exp: "", chk: true },
  { n: 36, name: "Certificado de dispositivo de Izado Hombre Atrapado",                               auth: IZAJE,   iss: "27-03-26", exp: "27-03-27" },
  { n: 37, name: "Certificado de Separador de Sentina",                                               auth: TBD,     iss: "", exp: "NA" },
  { n: 38, name: "Certificado Central de Incendio",                                                   auth: LCI,     iss: "27-03-26", exp: "27-03-27" },
  { n: 39, name: "Certificado de Calibración Detector de Gases 1",                                    auth: CALIB,   iss: "25-09-26", exp: "25-09-27" },
  { n: 40, name: "Certificado de Calibración Detector de Gases 2",                                    auth: CALIB,   iss: "", exp: "", chk: true },
  { n: 41, name: "Certificado de Calibración Alcoholímetro",                                          auth: CALIB,   iss: "25-03-26", exp: "25-03-27" },
  { n: 42, name: "Test de Alcohol y Drogas",                                                          auth: "Laboratorio clínico (por confirmar)", iss: "14-02-25", exp: "SV" },
  // 43 — fila no legible en la planilla original: NO se carga.
  { n: 44, name: "Certificado CyM",                                                                   auth: TBD,     iss: "27-05-26", exp: "26-05-27" },
  { n: 45, name: "Certificado de Cabo de acero",                                                      auth: "Proveedor de cabos (por confirmar)", iss: "", exp: "SV" },
  { n: 46, name: "Certificado de Cabo de manila",                                                     auth: "Proveedor de cabos (por confirmar)", iss: "", exp: "SV" },
  { n: 47, name: "Certificado de Válvula de Alivio tanque de Aire comprimido",                        auth: "Taller de recipientes a presión (por confirmar)", iss: "27-03-26", exp: "27-03-27" },
  { n: 48, name: "Certificado de Tuberías de LCI",                                                    auth: LCI,     iss: "", exp: "", chk: true },
  { n: 49, name: "Certificado de Capacidad de Pescante",                                              auth: IZAJE,   iss: "", exp: "", chk: true },
  { n: 50, name: "Certificado de Aparejos",                                                           auth: IZAJE,   iss: "", exp: "", chk: true },
  { n: 51, name: "Certificado de Tanque de Aire Comprimido",                                          auth: "Taller de recipientes a presión (por confirmar)", iss: "", exp: "NA" },
  { n: 52, name: "Certificado de Megado",                                                             auth: ELEC,    iss: "", exp: "SV" },
  { n: 53, name: "Certificado de Manguerotes",                                                        auth: "Proveedor de mangueras (por confirmar)", iss: "03-11-25", exp: "03-11-26" },
  { n: 54, name: "Certificado de Termómetro Digital",                                                 auth: CALIB,   iss: "27-10-25", exp: "27-10-26" },
  { n: 55, name: "Plano de Arreglo General",                                                          auth: CLASE,   iss: "16-02-24", exp: "SV" },
  { n: 56, name: "Plano de LCI y Salvamento",                                                         auth: CLASE,   iss: "", exp: "", chk: true },
  { n: 57, name: "Certificado Cinta UTI",                                                             auth: CALIB,   iss: "29-01-26", exp: "29-01-27" },
  { n: 58, name: "Certificado Cinta Métrica Pilón",                                                   auth: CALIB,   iss: "", exp: "", chk: true },
  { n: 59, name: "Certificado de Brida Aislante",                                                     auth: ELEC,    iss: "", exp: "", chk: true },
  { n: 60, name: "Plan de Estabilidad",                                                               auth: CLASE,   iss: "16-02-24", exp: "SV" },
  { n: 61, name: "Aviso a Navegantes Argentina",                                                      auth: "Servicio de Hidrografía Naval (Argentina)", iss: "05-10-26", exp: "" },
  { n: 62, name: "Aviso a Navegantes Paraguay",                                                       auth: "Administración Nacional de Navegación y Puertos (Paraguay)", iss: "", exp: "" },
  { n: 63, name: "Auditoría Interna",                                                                 auth: "Mercurio Group Naviera", iss: "05-06-26", exp: "" },
  { n: 64, name: "Plan de Protección",                                                                auth: PGN,     iss: "18-01-23", exp: "15-03-29" },
  { n: 65, name: "Ships Status",                                                                      auth: CLASE,   iss: "18-04-23", exp: "15-03-29" },
  { n: 66, name: "Resolución CONATEL",                                                                auth: CONATEL, iss: "24-07-24", exp: "24-07-29" },
  { n: 67, name: "Tabla de Calibración Tanque Slop",                                                  auth: CLASE,   iss: "", exp: "" },
  { n: 68, name: "Certificado Gas Patrón",                                                            auth: CALIB,   iss: "", exp: "SV" },
  { n: 69, name: "Certificado Sistema Fijo de Espuma",                                                auth: LCI,     iss: "27-03-26", exp: "27-03-27" },
  { n: 70, name: "Certificado Cabrestantes",                                                          auth: IZAJE,   iss: "27-03-26", exp: "27-03-27" },
  { n: 71, name: "Certificado Compás Magnético",                                                      auth: CALIB,   iss: "", exp: "", chk: true },
  { n: 72, name: "Certificado de Planchada de Acceso",                                                auth: IZAJE,   iss: "", exp: "", chk: true },
  { n: 73, name: "Certificado de Tuberías de Bunker",                                                 auth: CLASE,   iss: "", exp: "", chk: true },
  { n: 74, name: "Medición de espesores",                                                             auth: CLASE,   iss: "", exp: "" },
  { n: 75, name: "Certificado de Radar",                                                              auth: CONATEL, iss: "30-12-25", exp: "29-06-26" },
  { n: 76, name: "Certificado de Alfombra aislante",                                                  auth: ELEC,    iss: "06-05-26", exp: "06-05-27" },
  { n: 77, name: "Certificado de radio portátil bidireccional 1",                                     auth: CONATEL, iss: "", exp: "SV" },
  { n: 78, name: "Certificado de radio portátil bidireccional 2",                                     auth: CONATEL, iss: "", exp: "SV" },
];

/** "dd-mm-aa" → Date UTC. El año de 2 dígitos se resuelve como 20xx. */
function parsePaperDate(raw: string): Date {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) throw new Error(`Fecha del papel no parseable: "${raw}"`);
  const [, dd, mm, yy] = m;
  const iso = `20${yy}-${mm}-${dd}T00:00:00.000Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: "${raw}" → ${iso}`);
  return d;
}

interface Resolved {
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
  if (row.iss) {
    issueDate = parsePaperDate(row.iss);
  } else {
    issueDate = NO_ISSUE;
    notes.push(row.chk ? NOTE_CHECK : `Emisión: ${NOTE_BLANK}`);
  }

  let expiryDate: Date;
  if (row.exp === "SV") {
    expiryDate = NO_EXPIRY;
    notes.push(NOTE_NO_EXPIRY);
  } else if (row.exp === "NA") {
    expiryDate = NO_EXPIRY;
    notes.push(NOTE_NA);
  } else if (!row.exp) {
    expiryDate = NO_EXPIRY;
    if (!row.chk) notes.push(`Vencimiento: ${NOTE_BLANK}`);
  } else {
    expiryDate = parsePaperDate(row.exp);
  }

  if (row.note) notes.push(row.note);
  if (row.auth.includes("por confirmar") || row.auth === TBD) {
    notes.push("Autoridad emisora deducida por tipo de certificado: CONFIRMAR con el buque.");
  }

  return {
    code: `${CODE_PREFIX}${String(row.n).padStart(3, "0")}`,
    name: row.name,
    issuingAuthority: row.auth,
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

  const vessel = await prisma.vessel.findFirst({ where: { tenantId: tenant.id, code: VESSEL, deletedAt: null } });
  if (!vessel) throw new Error(`Vessel "${VESSEL}" no encontrado en el tenant ${TENANT_SLUG}.`);

  const admins = await prisma.tenantMembership.findMany({
    where: { tenantId: tenant.id, role: "TENANT_ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!admins.length) throw new Error(`No hay TENANT_ADMIN en el tenant ${TENANT_SLUG}.`);
  const actor =
    admins.find((a: any) => a.user?.email === "jbael@mercuriogroup.com.py")?.userId ?? admins[0].userId;

  const resolved = ROWS.map(resolveRow);

  const codes = new Set(resolved.map(r => r.code));
  if (codes.size !== resolved.length) throw new Error("Códigos de certificado duplicados en ROWS.");

  console.log(`Tenant ${TENANT_SLUG} (${tenant.id}) · Vessel ${VESSEL} (${vessel.name}) · actor ${actor}`);
  console.log(`Filas a cargar: ${resolved.length} (la fila 43 de la planilla se omite: ilegible en el original)\n`);

  const withSentinel = resolved.filter(r => r.issueDate.getTime() === NO_ISSUE.getTime() || r.expiryDate.getTime() === NO_EXPIRY.getTime());
  console.log(`Con fecha centinela (revisar en pantalla): ${withSentinel.length}`);
  for (const r of resolved) {
    const iss = r.issueDate.getTime() === NO_ISSUE.getTime() ? "    (s/f)" : r.issueDate.toISOString().slice(0, 10);
    const exp = r.expiryDate.getTime() === NO_EXPIRY.getTime() ? "    (s/v)" : r.expiryDate.toISOString().slice(0, 10);
    console.log(`  ${r.code}  ${iss}  ${exp}  ${computeStatus(r.expiryDate).padEnd(13)} ${r.name}`);
  }

  if (DRY) {
    console.log("\nDRY=1 — no se escribió nada.");
    return;
  }

  const removed = await prisma.certificate.deleteMany({
    where: { tenantId: tenant.id, vesselCode: VESSEL, certificateCode: { startsWith: CODE_PREFIX } },
  });
  console.log(`\nBorrados previos (recarga idempotente): ${removed.count}`);

  let created = 0;
  for (const r of resolved) {
    await prisma.certificate.create({
      data: {
        tenantId: tenant.id,
        vesselCode: VESSEL,
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
    created++;
  }
  console.log(`Certificados creados: ${created}`);
}

main()
  .catch(e => {
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
