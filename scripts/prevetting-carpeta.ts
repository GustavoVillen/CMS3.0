/**
 * Carpeta de evidencias para el pre-vetting de Shell (oct 2026), con los formularios oficiales del CMS3.
 *
 *   Índice (documento controlado) que responde punto por punto el listado de pre-vetting, y detrás,
 *   por cada tarea citada: formulario PLAN DE MANTENIMIENTO + su última Orden de Trabajo cerrada
 *   (REGI-MAN-02.4). Más una carpeta completa en un solo PDF para imprimir.
 *
 * Correr DESDE apps/api, igual que la API: los PDF buscan el logo relativo a esa carpeta
 * (pdf-helpers PUBLIC_DIR). Desde otra carpeta el formulario sale sin logo; por eso el script frena.
 *
 *   cd /app-cms3/apps/api && VESSEL=M01 OUT=/tmp/pvo-M01 npx tsx --env-file=/app-cms3/.env ../../scripts/prevetting-carpeta.ts
 *
 * Buques configurados: ver VC. Para sumar uno, cargar sus códigos de equipo.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "../apps/api/node_modules/pdfkit";
import { PDFDocument as PdfLib } from "../apps/api/node_modules/pdf-lib";
import type { TenantAccessSession } from "../apps/api/src/tenant/auth/session-store";
import { getPrismaClient } from "../apps/api/src/platform/data/prisma-client";
import { listTenantMaintenancePlans } from "../apps/api/src/tenant/maintenance-plans/maintenance-plans-service";
import { buildMaintenancePlanPdf } from "../apps/api/src/tenant/pms/maintenance-plan-pdf-service";
import { buildWorkOrderPdf } from "../apps/api/src/tenant/pms/work-order-pdf-service";
import { resolveControlledDocChrome } from "../apps/api/src/tenant/pms/tenant-forms-service";
import { createFormCanvas, drawControlledDocHeader, drawControlledDocFooter, FORM_COLORS, PAGE_W, PAGE_H, FOOTER_H } from "../apps/api/src/tenant/pms/pdf-form-chrome";
import { sanitizePdfText, LOGO_PATH } from "../apps/api/src/tenant/pms/pdf-helpers";

const V = (process.env.VESSEL ?? "").toUpperCase();
const OUT = process.env.OUT ?? `/tmp/prevetting-oficial-${V}`;
const TENANT_SLUG = "mercurio";
const AUTHOR = "Gustavo Villen";
const TODAY = new Date();

const session = {
  kind: "tenant", tenantSlug: TENANT_SLUG, accessToken: "x", refreshToken: "x",
  accessTokenExpiresAt: new Date(Date.now() + 3600e3).toISOString(),
  user: { id: "cmqhapq700000xul4qy0s83h5", email: "admin@mercurio.com", role: "TENANT_ADMIN", assignedVesselCodes: [], locale: "es" },
} as unknown as TenantAccessSession;

type Kind = "SIS" | "NA" | "FUERA";
type Item = { n: string; text: string; kind: Kind; assets?: string[]; only?: RegExp; except?: RegExp; plans?: string[]; note?: string };
type Section = { title: string; items: Item[] };

type VCfg = { name: string; clase: string; casco: string; guinches: string[]; guinchePlans?: string[]; plumas: string[]; tuberia: string; amarre: string;
  incendio: string[]; mbba: string; radares: string[]; deteccion: string; co2: string; extintores: string[]; espuma?: string;
  navLights: { plans?: string[]; assets?: string[] }; mensualMaq?: string; semanalCub?: string };
const VC: Record<string, VCfg> = {
  M01: { name: "MAO 01", clase: "M01-0-IP-001", casco: "M01-1-CC-001", guinches: ["M01-CABR-BR", "M01-CABR-ER", "M01-CENT-HID"], guinchePlans: ["M01-HID-GOB-08"],
    plumas: ["M01-ELEV", "M01-3-PD-001", "M01-3-PD-002"], tuberia: "M01-TUB-COMB", amarre: "M01-7-SD-001", incendio: ["M01-EB-INC-P", "M01-BBA-INC-EM"],
    mbba: "M01-MBBA-PORT", radares: ["M01-RADAR-BR", "M01-RADAR-ER"], deteccion: "M01-DET-HUMO", co2: "M01-CO2",
    extintores: ["M01-3-EP-001", "M01-3-BS-001", "M01-3-BS-002"], navLights: { plans: ["M01-1-003"] }, mensualMaq: "M01-6-002", semanalCub: "M01-1-002" },
};
const C = VC[V];
if (!C) throw new Error(`VESSEL sin configurar: ${V}`);
const VESSEL_NAME = C.name;
const opt = (c?: string) => (c ? [c] : []);
const NA_NOTE = "Corresponde a las barcazas; no aplica al remolcador.";
const FUERA_NOTE = "Documentación que no forma parte del mantenimiento planificado; se presenta a bordo.";

const SECTIONS: Section[] = [
  { title: "1. DOCUMENTACIÓN A DISPOSICIÓN DEL INSPECTOR", items: [
    { n: "1.1", text: "Certificados estatutarios (matrícula, arqueo, francobordo, navegabilidad, seguridad, prevención de la contaminación, DOC, habilitación)", kind: "FUERA" },
    { n: "1.2", text: "Certificado de Clase y último status survey de la Clase", kind: "SIS", assets: [C.clase], except: /espesor/i },
    { n: "1.3", text: "P&I", kind: "FUERA" },
    { n: "1.4", text: "CLC for oil pollution damage", kind: "FUERA" },
    { n: "1.5", text: "Seguro de casco y máquina", kind: "FUERA" },
    { n: "1.6", text: "Último Port State Control / inspección extraordinaria", kind: "FUERA" },
    { n: "1.7", text: "Plan de estabilidad en caso de avería", kind: "FUERA" },
    { n: "1.8", text: "Planos aprobados (lucha contra incendio, arreglo general)", kind: "FUERA" },
    { n: "1.9", text: "Calificación y documentación de oficiales y personal de carga/descarga", kind: "FUERA" },
    { n: "1.10", text: "Registros de alcohol y drogas del remolcador", kind: "FUERA" },
    { n: "1.11", text: "Certificados de elementos de lucha contra incendio y salvamento", kind: "SIS",
      assets: [...C.extintores, C.co2, C.deteccion], except: /mensual|totalidad|alarmas de disparo/i },
    { n: "1.12", text: "Plan de contingencia en caso de derrame del remolcador", kind: "FUERA" },
    { n: "1.13", text: "Libro registro de hidrocarburos", kind: "FUERA" },
    { n: "1.14", text: "Tabla de calibración aprobada de los tanques de carga", kind: "NA" },
    { n: "1.15", text: "Registros de inspección de tanques y espacios adyacentes (coating, estructura, cofferdams, piques)", kind: "SIS", assets: [C.casco], only: /integridad|espacios internos/i },
    { n: "1.16", text: "Plan de mantenimiento y registros de mantenimiento", kind: "SIS",
      note: "Plan completo del buque en el Anexo A, con la última ejecución y el próximo vencimiento de cada tarea. Cada tarea citada en este índice se adjunta con su formulario Plan de Mantenimiento y su última Orden de Trabajo cerrada." },
    { n: "1.17", text: "Procedimiento de limpieza y lavado de tanques de carga; disposición de residuos", kind: "NA" },
    { n: "1.18", text: "Última medición de espesores del casco refrendada por la Clase", kind: "SIS", plans: [`${V}-0-ESPES`] },
  ]},
  { title: "2. PLAN DE MANTENIMIENTO: REGISTROS SEGÚN APLIQUEN", items: [
    { n: "2.1", text: "Horas de motor de bombas de carga desde el último service o recorrido general", kind: "NA" },
    { n: "2.2", text: "Horas de motor de bombas de carga desde el último cambio de aceite y filtro", kind: "NA" },
    { n: "2.3", text: "Bombas de carga: última inspección y cambio de aceite de la transmisión cardánica", kind: "NA" },
    { n: "2.4", text: "Motor de arranque de la motobomba de carga", kind: "NA" },
    { n: "2.5", text: "Guinches (malacates de amarre y plumas)", kind: "SIS", assets: C.guinches, plans: [...(C.guinchePlans ?? []), ...opt(C.mensualMaq)] },
    { n: "2.6", text: "Testeo de plumas y pescantes", kind: "SIS", assets: C.plumas, plans: opt(C.semanalCub) },
    { n: "2.7", text: "Prueba de válvulas de seguridad/alivio de la bomba o línea de carga", kind: "NA" },
    { n: "2.8", text: "Calibración de válvulas P/V de tanques de carga", kind: "NA" },
    { n: "2.9", text: "Sistema HLA y Overfill: mantenimiento de baterías", kind: "NA" },
    { n: "2.10", text: "Calibración de manómetros de manifold", kind: "NA" },
    { n: "2.11", text: "Prueba hidráulica de tuberías (en el remolcador: tubería de embarque de combustible)", kind: "SIS", assets: [C.tuberia] },
    C.espuma ? { n: "2.12", text: "Último análisis de líquido espumígeno", kind: "SIS", assets: [C.espuma] }
             : { n: "2.12", text: "Último análisis de líquido espumígeno", kind: "NA" },
    { n: "2.13", text: "Certificado de calibración de elementos de medición", kind: "SIS", assets: [`${V}-DET-GAS`] },
    { n: "2.14", text: "Procedimientos operativos y de emergencia", kind: "FUERA" },
    { n: "2.15", text: "Registro de toma de gases de cofferdams, piques y doble casco", kind: "NA" },
    { n: "2.16", text: "Cabos y alambres de amarre: certificados e inspecciones regulares", kind: "SIS", assets: [C.amarre],
      note: "La identificación de cada cabo con precinto y la planilla de control de cabos se llevan a bordo, fuera del plan de mantenimiento." },
  ]},
  { title: "3. PRUEBAS DURANTE LA INSPECCIÓN", items: [
    { n: "3.1", text: "Arranque de motores de bombas de carga", kind: "NA" },
    { n: "3.2", text: "Paradas de emergencia del motor de la bomba de carga", kind: "NA" },
    { n: "3.3", text: "Línea de incendio asistida por el remolcador y mangueras de incendio", kind: "SIS", assets: C.incendio },
    { n: "3.4", text: "Sistema sprinkler", kind: "NA" },
    { n: "3.5", text: "Luces de navegación portátiles del convoy", kind: "SIS", assets: [`${V}-LUC-CONV`] },
    { n: "3.6", text: "Alarmas HLA (95 %) y Overfill (98 %)", kind: "NA" },
    { n: "3.7", text: "Cofferdams, doble casco y piques con tapas abiertas", kind: "NA" },
    { n: "3.8", text: "Bomba neumática portátil para derrames provista por el remolcador", kind: "SIS", assets: [`${V}-BBA-DERR`] },
    { n: "3.9", text: "Bomba de lucha contra incendio de emergencia portátil", kind: "SIS", assets: [C.mbba] },
  ]},
  { title: "4. COMUNICACIÓN AL CAPITÁN: PUNTOS DE MANTENIMIENTO", items: [
    { n: "4.1", text: "Puente: alarma de luz de navegación quemada operativa y demostrable", kind: "SIS", assets: C.navLights.assets, plans: C.navLights.plans,
      note: C.navLights.plans ? "La prueba de luces de navegación desde el tablero, con alarma sonora y visual, forma parte de la inspección mensual de cubierta." : undefined },
    { n: "4.2", text: "Radar: identificación de ambos radares; certificado anual con fecha de cambio de magnetrón y horas de funcionamiento", kind: "SIS", assets: C.radares,
      note: "Las horas de funcionamiento del magnetrón no se registran en el plan. Tomar la lectura del contador de cada radar y asentarla en la OT de service." },
    { n: "4.3", text: "Tablero central de incendios con zonas identificadas; prueba de alarmas con aerosol de humo y pistola de calor sobre la totalidad", kind: "SIS",
      assets: [C.deteccion], only: /mensual|totalidad/i, plans: C.navLights.plans },
    { n: "4.4", text: "Cabos: identificación con precintos y planilla de control al día; cabos de descarte señalizados", kind: "FUERA" },
    { n: "4.5", text: "Formularios SGS rev-2, orden y limpieza, pallets, hojas de seguridad, pañol de pinturas, libro diario de navegación, plan de viaje REGI-OPE-03.1", kind: "FUERA" },
  ]},
];

const fmt = (d: Date | string | null | undefined) => {
  if (!d) return "-";
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`;
};
// Fechas centinela de cargas viejas (año 2000) = sin registro.
const realDate = (d: Date | string | null | undefined) => (d && new Date(d).getUTCFullYear() > 2001 ? new Date(d) : null);
const freq = (p: any) => p.frequencyMonths ? `${p.frequencyMonths} m` : p.frequencyHours ? `${p.frequencyHours} h` : p.triggerType === "EVENT" ? "evento" : "-";
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 90);
const lastOf = (p: any) => realDate(p.lastExecutionDate) ?? realDate(p.lastWo?.completedDate);
const nextOf = (p: any) => p.nextDueHours != null ? `${Math.round(p.nextDueHours)} h` : fmt(realDate(p.nextDueDate));
// La OT adjunta es "anterior" cuando la última ejecución del plan es posterior (registrada sin OT).
const woIsPrevious = (p: any) => {
  const last = lastOf(p); const wo = realDate(p.lastWo?.completedDate);
  return !!(last && wo && last.getTime() - wo.getTime() > 36 * 3600e3);
};
type PlanState = "Al día" | "Próximo" | "Vencido" | "Sin registro";
// El estado sale de la misma fecha de vencimiento que se imprime al lado, para que
// la fila no se contradiga (una OT abierta no vuelve "Próximo" un plan que vence en 2030).
// Los planes por horas usan el estado del sistema, que conoce las horas actuales.
function planState(p: any): PlanState {
  const last = lastOf(p) ?? (p.lastExecutionHours != null ? new Date() : null);
  if (!last) return "Sin registro";
  const next = p.nextDueHours == null ? realDate(p.nextDueDate) : null;
  if (next) {
    const days = (next.getTime() - TODAY.getTime()) / 86400e3;
    return days < 0 ? "Vencido" : days <= 30 ? "Próximo" : "Al día";
  }
  if (p.executionStatus === "OVERDUE") return "Vencido";
  if (["DUE", "UPCOMING"].includes(p.executionStatus)) return "Próximo";
  return "Al día";
}
async function setMeta(buf: Uint8Array, title: string) {
  const d = await PdfLib.load(buf, { updateMetadata: false });
  d.setTitle(title); d.setAuthor(AUTHOR); d.setCreator("CMS3.0"); d.setProducer("CMS3.0");
  d.setSubject(`Pre-vetting ${VESSEL_NAME}`); d.setCreationDate(TODAY); d.setModificationDate(TODAY);
  return d.save();
}

async function main() {
  if (!existsSync(LOGO_PATH)) throw new Error(`No se encuentra el logo (${LOGO_PATH}). Correr desde apps/api.`);
  const prisma = getPrismaClient() as any;
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  const TENANT_ID = tenant.id as string;
  mkdirSync(join(OUT, "Evidencias"), { recursive: true });
  const plans = (await listTenantMaintenancePlans(session, { vesselCode: V, status: "ACTIVE" } as never)) as any[];
  const byCode = new Map(plans.map((p) => [p.taskCode, p]));
  const assets = await prisma.asset.findMany({ where: { tenantId: TENANT_ID, vesselCode: V, deletedAt: null }, select: { id: true, name: true, assetCode: true } });
  const assetByCode = new Map<string, any>(assets.map((a: any) => [a.assetCode, a]));

  // Última OT cerrada por plan: tabla de planes de la OT, plan principal de la OT y registro de ejecución con OT.
  const ids = plans.map((p) => p.id);
  const woSel = { id: true, workOrderCode: true, title: true, completedDate: true };
  const links = await prisma.workOrderMaintenancePlan.findMany({ where: { tenantId: TENANT_ID, maintenancePlanId: { in: ids }, workOrder: { status: "CLOSED", deletedAt: null } }, select: { maintenancePlanId: true, workOrder: { select: woSel } } });
  const direct = await prisma.workOrder.findMany({ where: { tenantId: TENANT_ID, maintenancePlanId: { in: ids }, status: "CLOSED", deletedAt: null }, select: { ...woSel, maintenancePlanId: true } });
  const logs = await prisma.workLog.findMany({ where: { tenantId: TENANT_ID, maintenancePlanId: { in: ids }, workOrderId: { not: null } }, select: { maintenancePlanId: true, workOrderId: true } });
  const logWos = await prisma.workOrder.findMany({ where: { tenantId: TENANT_ID, id: { in: logs.map((l: any) => l.workOrderId) }, status: "CLOSED", deletedAt: null }, select: woSel });
  const logWoById = new Map(logWos.map((w: any) => [w.id, w]));
  const planById = new Map(plans.map((p) => [p.id, p]));
  for (const c of [
    ...links.map((l: any) => ({ planId: l.maintenancePlanId, wo: l.workOrder })),
    ...direct.map((w: any) => ({ planId: w.maintenancePlanId, wo: w })),
    ...logs.filter((l: any) => logWoById.has(l.workOrderId)).map((l: any) => ({ planId: l.maintenancePlanId, wo: logWoById.get(l.workOrderId) })),
  ]) {
    const p = planById.get(c.planId);
    if (p && (!p.lastWo || new Date(c.wo.completedDate ?? 0) > new Date(p.lastWo.completedDate ?? 0))) p.lastWo = c.wo;
  }
  const cert = await prisma.certificate.findFirst({ where: { tenantId: TENANT_ID, vesselCode: V, deletedAt: null, name: { contains: "Clase", mode: "insensitive" } }, orderBy: { expiryDate: "desc" } });

  const itemPlans = (it: Item) => {
    const out: any[] = [];
    for (const code of it.assets ?? []) {
      const a = assetByCode.get(code);
      if (!a) { console.log(`  ! equipo ${code} no encontrado`); continue; }
      for (const p of plans.filter((x) => x.assetId === a.id).sort((x, y) => x.title.localeCompare(y.title))) {
        if (it.only && !it.only.test(p.title)) continue;
        if (it.except && it.except.test(p.title)) continue;
        out.push(p);
      }
    }
    for (const code of it.plans ?? []) {
      const p = byCode.get(code);
      if (!p) { console.log(`  ! plan ${code} no encontrado`); continue; }
      if (!out.includes(p)) out.push(p);
    }
    return out;
  };

  // ── Evidencias: formulario Plan de Mantenimiento + última OT de cada tarea ──
  const evid: { id: string; label: string; buf: Uint8Array }[] = [];
  const evidByKey = new Map<string, string>();
  let seq = 0;
  const addEvid = async (key: string, label: string, make: () => Promise<Buffer>) => {
    if (evidByKey.has(key)) return evidByKey.get(key)!;
    const id = `E-${String(++seq).padStart(3, "0")}`;
    try {
      const buf = await setMeta(await make(), `${id} ${label}`);
      writeFileSync(join(OUT, "Evidencias", `${id} ${safeName(label)}.pdf`), buf);
      evid.push({ id, label, buf }); evidByKey.set(key, id);
      return id;
    } catch (e) { seq--; console.log(`  ! ${label}: ${(e as Error).message}`); return ""; }
  };
  for (const s of SECTIONS) for (const it of s.items) {
    if (it.kind !== "SIS") continue;
    for (const p of itemPlans(it)) {
      p.evPlan = await addEvid(`P:${p.id}`, `Plan de Mantenimiento ${p.taskCode} ${p.assetName ?? ""} - ${p.title}`, () => buildMaintenancePlanPdf(session, p.id));
      if (p.lastWo) p.evWo = await addEvid(`W:${p.lastWo.id}`, `Orden de Trabajo ${p.lastWo.workOrderCode} ${p.lastWo.title ?? p.title}`, () => buildWorkOrderPdf(session, p.lastWo.id));
    }
  }

  // ── Índice en documento controlado ─────────────────────────────────────────
  const chrome = await resolveControlledDocChrome(TENANT_SLUG, {
    formCode: "", title: "PRE-VETTING SHELL - MANTENIMIENTO", revision: 1, effectiveFrom: fmt(TODAY).replace(/\//g, "."),
  });
  const { meta, logoBuffer, tenantName } = chrome;
  if (!logoBuffer) throw new Error("No se resolvió el logo de la empresa para el índice.");
  const ML = 28, MARGIN_T = 28, W = PAGE_W - 2 * ML, CONTENT_BOTTOM = PAGE_H - FOOTER_H - 14;
  const { NAVY, LIGHT, BLACK, GRAY } = FORM_COLORS;
  const t = (s: string) => sanitizePdfText(s);

  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Pre-vetting ${VESSEL_NAME} - Mantenimiento`, Author: AUTHOR, Creator: "CMS3.0", Producer: "CMS3.0" } });
  const chunks: Buffer[] = []; doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  const rightInfo = (page: number) => t(`Pre-vetting — ${VESSEL_NAME} — Pagina ${page} — ${fmt(TODAY)}`);
  const canvas = createFormCanvas(doc, { ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM,
    drawFooter: (page) => drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(page), x: ML, w: W }) });
  const { cell, ensureSpace, sectionHeader, measureCellHeight } = canvas;
  canvas.y = MARGIN_T + drawControlledDocHeader(doc, { meta, logoBuffer, tenantName, x: ML, y: MARGIN_T, w: W, page: 1 }) + 6;

  const RH = 20, LBL_W = 110;
  const lbl = { bold: true, fontSize: 8, bg: LIGHT, color: BLACK } as const;
  const rowPair = (l1: string, v1: string, l2: string, v2: string) => {
    ensureSpace(RH); const half = Math.floor(W / 2);
    cell(ML, canvas.y, LBL_W, RH, l1, lbl); cell(ML + LBL_W, canvas.y, half - LBL_W, RH, t(v1), { fontSize: 9, bold: true });
    cell(ML + half, canvas.y, LBL_W, RH, l2, lbl); cell(ML + half + LBL_W, canvas.y, W - half - LBL_W, RH, t(v2), { fontSize: 9 });
    canvas.y += RH;
  };
  rowPair("Embarcación", VESSEL_NAME, "Fecha", fmt(TODAY));
  rowPair("Inspección", "Vetting anual - Shell", "Área", "Mantenimiento");
  ensureSpace(RH * 3);
  const intro = "Respuesta punto por punto del listado de pre-vetting en lo que corresponde al mantenimiento del remolcador. Cada tarea citada se adjunta con su formulario Plan de Mantenimiento y su última Orden de Trabajo cerrada (REGI-MAN-02.4), identificados como anexos E-xxx. Cuando la última ejecución se registró sin Orden de Trabajo, el formulario del plan la muestra y la OT adjunta figura como anterior. Los puntos propios de las barcazas figuran como no aplicables; la documentación estatutaria, los seguros, la tripulación y los procedimientos se presentan a bordo.";
  const ih = measureCellHeight([intro], [W], { fontSize: 8.5, minHeight: 30 });
  cell(ML, canvas.y, W, ih, t(intro), { fontSize: 8.5, wrap: true });
  canvas.y += ih + 8;

  const all = SECTIONS.flatMap((s) => s.items);
  const itemState = (it: Item) => {
    const ps = itemPlans(it).map(planState);
    if (!ps.length) return it.n === "1.16" ? "Con registro vigente" : "Pendiente";
    const bad = ps.filter((s) => s === "Vencido" || s === "Sin registro").length;
    return bad === 0 ? "Con registro vigente" : bad === ps.length ? "Pendiente" : "Con observaciones";
  };
  const sis = all.filter((i) => i.kind === "SIS");
  const summary: [string, number][] = [
    ["Con registro vigente", sis.filter((i) => itemState(i) === "Con registro vigente").length],
    ["Con observaciones", sis.filter((i) => itemState(i) === "Con observaciones").length],
    ["Pendientes de registro", sis.filter((i) => itemState(i) === "Pendiente").length],
    ["No aplican al remolcador", all.filter((i) => i.kind === "NA").length],
    ["Se presentan a bordo", all.filter((i) => i.kind === "FUERA").length],
  ];
  sectionHeader("RESUMEN", 18, 40);
  const bw = W / summary.length;
  ensureSpace(40);
  summary.forEach(([l], i) => cell(ML + i * bw, canvas.y, bw, 18, l, { ...lbl, align: "center", fontSize: 7.5 }));
  canvas.y += 18;
  summary.forEach(([, n], i) => cell(ML + i * bw, canvas.y, bw, 22, String(n), { bold: true, fontSize: 12, align: "center", color: NAVY }));
  canvas.y += 30;

  const COLS = [{ h: "Tarea", w: 200 }, { h: "Frec.", w: 38 }, { h: "Última", w: 56 }, { h: "Próxima", w: 56 }, { h: "Estado", w: 58 }];
  COLS.push({ h: "Evidencia", w: W - COLS.reduce((a, c) => a + c.w, 0) });
  const head = () => { ensureSpace(16); let x = ML; for (const c of COLS) { cell(x, canvas.y, c.w, 16, c.h, { ...lbl, fontSize: 7.5 }); x += c.w; } canvas.y += 16; };
  const row = (cells: string[]) => {
    const h = measureCellHeight(cells.map(t), COLS.map((c) => c.w), { fontSize: 7.5, minHeight: 16 });
    if (canvas.y + h > CONTENT_BOTTOM) { canvas.pageBreak(); head(); }
    let x = ML;
    cells.forEach((c, i) => {
      const bad = i === 4 && (c === "Vencido" || c === "Sin registro");
      cell(x, canvas.y, COLS[i]!.w, h, t(c), { fontSize: 7.5, wrap: true, color: bad ? "#B91C1C" : BLACK, bold: bad });
      x += COLS[i]!.w;
    });
    canvas.y += h;
  };
  const woLabel = (p: any, withEvid: boolean) => p.lastWo
    ? `${woIsPrevious(p) ? "OT anterior " : ""}${p.lastWo.workOrderCode}${withEvid && p.evWo ? ` ${p.evWo}` : ""}${woIsPrevious(p) ? ` (${fmt(p.lastWo.completedDate)})` : ""}`
    : "";
  const stateColor = (s: string) => s === "Con registro vigente" ? "#166534" : s === "No aplica" || s === "Se presenta a bordo" ? GRAY : "#B45309";

  const actions: string[] = [];
  for (const s of SECTIONS) {
    sectionHeader(s.title, 18, 60);
    for (const it of s.items) {
      const st = it.kind === "NA" ? "No aplica" : it.kind === "FUERA" ? "Se presenta a bordo" : itemState(it);
      const txt = `${it.n}  ${it.text}`;
      const h = measureCellHeight([t(txt), st], [W - 120, 120], { fontSize: 8, bold: true, minHeight: 18 });
      ensureSpace(h + (it.kind === "SIS" ? 34 : 14));
      cell(ML, canvas.y, W - 120, h, t(txt), { bold: true, fontSize: 8, wrap: true, bg: LIGHT });
      cell(ML + W - 120, canvas.y, 120, h, st, { bold: true, fontSize: 8, align: "center", color: stateColor(st), bg: LIGHT });
      canvas.y += h;
      if (it.kind !== "SIS") {
        const nh = measureCellHeight([it.kind === "NA" ? NA_NOTE : FUERA_NOTE], [W], { fontSize: 7.5, minHeight: 14 });
        cell(ML, canvas.y, W, nh, it.kind === "NA" ? NA_NOTE : FUERA_NOTE, { fontSize: 7.5, color: GRAY, wrap: true });
        canvas.y += nh + 4; continue;
      }
      const ps = itemPlans(it);
      if (ps.length) {
        head();
        for (const p of ps) {
          const st2 = planState(p); const last = lastOf(p);
          const ev = [p.evPlan ? `Plan ${p.evPlan}` : "", woLabel(p, true)].filter(Boolean).join(" / ");
          row([`${p.taskCode}  ${p.assetName ?? ""}: ${p.title}`, freq(p), last ? fmt(last) : "-", nextOf(p), st2, ev || "-"]);
          if (st2 === "Vencido" || st2 === "Sin registro") actions.push(`${it.n} ${p.taskCode} ${p.assetName ?? ""}: ${p.title} (${st2.toLowerCase()})`);
        }
      }
      const extra: string[] = [];
      if (it.n === "1.2" && cert) extra.push(`${cert.name} emitido por ${cert.issuingAuthority ?? "-"} el ${fmt(cert.issueDate)}, vence el ${fmt(cert.expiryDate)}. Se presenta en original junto con el último status survey.`);
      if (it.note) extra.push(it.note);
      if (extra.length) {
        const nh = measureCellHeight([t(extra.join(" "))], [W], { fontSize: 7.5, minHeight: 14 });
        ensureSpace(nh); cell(ML, canvas.y, W, nh, t(extra.join(" ")), { fontSize: 7.5, wrap: true }); canvas.y += nh;
      }
      canvas.y += 6;
    }
  }

  canvas.pageBreak();
  sectionHeader("REGISTROS A COMPLETAR ANTES DE LA INSPECCIÓN", 18, 40);
  const ah = "Tareas de los puntos anteriores que figuran vencidas o sin registro en el plan. Si el trabajo ya se realizó, cargar la OT con su fecha y adjuntar el certificado o informe correspondiente.";
  const ahh = measureCellHeight([ah], [W], { fontSize: 8, minHeight: 16 });
  cell(ML, canvas.y, W, ahh, ah, { fontSize: 8, wrap: true }); canvas.y += ahh;
  for (const a of [...new Set(actions)]) {
    const h = measureCellHeight([t(a)], [W], { fontSize: 8, minHeight: 16 });
    ensureSpace(h); cell(ML, canvas.y, W, h, t(a), { fontSize: 8, wrap: true }); canvas.y += h;
  }

  canvas.pageBreak();
  sectionHeader(`ANEXO A - PLAN DE MANTENIMIENTO VIGENTE (${plans.length} TAREAS)`, 18, 40);
  head();
  for (const p of [...plans].sort((a, b) => `${a.assetName}${a.title}`.localeCompare(`${b.assetName}${b.title}`))) {
    const last = lastOf(p);
    row([`${p.taskCode}  ${p.assetName ?? ""}: ${p.title}`, freq(p), last ? fmt(last) : "-", nextOf(p), planState(p), woLabel(p, false) || "-"]);
  }

  canvas.pageBreak();
  sectionHeader("ANEXO B - EVIDENCIAS ADJUNTAS", 18, 40);
  for (const e of evid) {
    const h = measureCellHeight([t(e.label)], [W - 50], { fontSize: 8, minHeight: 15 });
    ensureSpace(h); cell(ML, canvas.y, 50, h, e.id, { ...lbl, align: "center" }); cell(ML + 50, canvas.y, W - 50, h, t(e.label), { fontSize: 8, wrap: true }); canvas.y += h;
  }
  drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
  doc.end();
  const indexBuf = await setMeta(await done, `Pre-vetting ${VESSEL_NAME} - Mantenimiento`);
  writeFileSync(join(OUT, `00 Indice pre-vetting ${VESSEL_NAME}.pdf`), indexBuf);

  const merged = await PdfLib.create();
  for (const buf of [indexBuf, ...evid.map((e) => e.buf)]) {
    const src = await PdfLib.load(buf);
    for (const pg of await merged.copyPages(src, src.getPageIndices())) merged.addPage(pg);
  }
  writeFileSync(join(OUT, `Carpeta completa pre-vetting ${VESSEL_NAME}.pdf`), await setMeta(await merged.save(), `Carpeta pre-vetting ${VESSEL_NAME}`));
  console.log(`Listo ${VESSEL_NAME}: ${evid.length} evidencias, ${merged.getPageCount()} páginas, ${new Set(actions).size} registros a completar.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
