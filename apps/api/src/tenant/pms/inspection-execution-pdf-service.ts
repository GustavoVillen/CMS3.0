// Inspección ejecutada → PDF (registro del SGS).
//
// El papel de la visita: qué plantilla se aplicó, ítem por ítem con su criterio
// de aceptación, el valor medido, si es conforme y la severidad de lo que no lo
// es. Sirve como evidencia objetiva del chequeo a bordo (TMSA 4.2.3 / 4.A.1.4),
// por eso lleva el chrome de documento controlado y el pie de firmas.
//
// El número de formulario es el `code` de la plantilla de inspección (ej.
// REGI-OPE-19.2) y el título su `title`.

import PDFDocument from "pdfkit";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { getInspectionExecution } from "./inspection-executions-service";
import { sanitizePdfText } from "./pdf-helpers";
import { resolveControlledDocChrome } from "./tenant-forms-service";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";
import {
  FORM_COLORS, FOOTER_H, PAGE_H,
  drawControlledDocHeader, drawControlledDocFooter, createFormCanvas,
} from "./pdf-form-chrome";

const PW = 595.28;
const ML = 36;
const W  = PW - ML * 2;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const { BLACK, GRAY, BORDER, LIGHT } = FORM_COLORS;

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED:   "Programada",
  IN_PROGRESS: "En curso",
  COMPLETED:   "Completada",
  CANCELLED:   "Cancelada",
};
const RESULT_LABEL: Record<string, string> = {
  SATISFACTORY:                         "Satisfactorio",
  SATISFACTORY_WITH_OBSERVATIONS:       "Satisfactorio con observaciones",
  UNSATISFACTORY_FOLLOW_UP_REQUIRED:    "No satisfactorio - requiere seguimiento",
  CRITICAL_DEFICIENCY_IMMEDIATE_ACTION: "Deficiencia critica - accion inmediata",
};
const RESULT_COLOR: Record<string, string> = {
  SATISFACTORY:                         "#15803d",
  SATISFACTORY_WITH_OBSERVATIONS:       "#b45309",
  UNSATISFACTORY_FOLLOW_UP_REQUIRED:    "#b91c1c",
  CRITICAL_DEFICIENCY_IMMEDIATE_ACTION: "#7f1d1d",
};
const SEVERITY_LABEL: Record<string, string> = {
  OBSERVATION: "Observacion",
  DEFICIENCY:  "Deficiencia",
  CRITICAL:    "Critica",
};

interface ChecklistItem {
  id: string;
  sortOrder: number;
  description: string;
  itemType: string;
  acceptanceCriteria: string | null;
  nominalValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  isOptional: boolean;
}
interface ItemResult {
  checklistItemId: string;
  resultValue: string | null;
  numericValue: number | null;
  isConforming: boolean | null;
  deficiencySeverity: string | null;
  notes: string | null;
  checklistItem: ChecklistItem | null;
}

function val(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

/** Criterio de aceptación legible: el texto libre, o el rango numérico cargado. */
function criteriaText(item: ChecklistItem | null): string {
  if (!item) return "";
  if (item.acceptanceCriteria?.trim()) return item.acceptanceCriteria.trim();
  const u = item.unit ? ` ${item.unit}` : "";
  if (item.minValue != null && item.maxValue != null) return `${item.minValue} - ${item.maxValue}${u}`;
  if (item.minValue != null) return `min. ${item.minValue}${u}`;
  if (item.maxValue != null) return `max. ${item.maxValue}${u}`;
  if (item.nominalValue != null) return `nominal ${item.nominalValue}${u}`;
  return "";
}

function measuredText(r: ItemResult): string {
  if (r.numericValue != null) {
    const u = r.checklistItem?.unit ? ` ${r.checklistItem.unit}` : "";
    return `${r.numericValue}${u}`;
  }
  return String(r.resultValue ?? "").trim();
}

export async function buildInspectionExecutionPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  // getInspectionExecution aplica tenant + vessel scope y tira 404 si no es visible.
  const exec = await getInspectionExecution(session, id) as unknown as Record<string, any>;
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);
  const prisma = getPrismaClient();

  let vesselName: string | null = null;
  let assetLabel: string | null = null;
  let inspectorSignature: Buffer | null = null;

  if (prisma) {
    try {
      const v = await prisma.vessel.findFirst({
        where: { tenantId: exec.tenantId, code: exec.vesselCode },
        select: { name: true },
      });
      vesselName = v?.name ?? null;
    } catch { /* non-blocking */ }

    if (exec.assetId) {
      try {
        const a = await (prisma as any).asset.findFirst({
          where: { id: exec.assetId, tenantId: exec.tenantId },
          select: { name: true, assetCode: true, isSafetyCritical: true },
        });
        if (a) {
          assetLabel = `${a.name ?? ""}${a.assetCode ? ` (${a.assetCode})` : ""}`.trim();
          if (a.isSafetyCritical) assetLabel += "  [ISM 10.3]";
        }
      } catch { /* non-blocking */ }
    }

    // Firma del inspector, y SÓLO si el nombre impreso es el suyo: estampar la
    // firma de alguien debajo del nombre de otro le atribuye una conformidad que
    // no dio. Sin coincidencia, la línea sale en blanco para firmar a mano.
    if (exec.status === "COMPLETED" && exec.inspectorUserId) {
      try {
        const u = await (prisma as any).user.findUnique({
          where: { id: exec.inspectorUserId },
          select: { signatureUrl: true, firstName: true, lastName: true, formName: true },
        });
        const norm = (s: unknown) =>
          typeof s === "string" ? s.trim().replace(/\s+/g, " ").toLocaleLowerCase() : "";
        const printed = norm(exec.inspectorName);
        const matches = !printed || [u?.formName, `${u?.firstName ?? ""} ${u?.lastName ?? ""}`].map(norm).includes(printed);
        const m = typeof u?.signatureUrl === "string" ? u.signatureUrl.match(/^data:image\/[a-z+]+;base64,(.+)$/i) : null;
        if (matches && m) inspectorSignature = Buffer.from(m[1], "base64");
      } catch { /* non-blocking */ }
    }
  }

  const chrome = await resolveControlledDocChrome(session.tenantSlug, {
    formCode: exec.template?.code ?? "",
    title: exec.template?.title ?? "Registro de inspeccion",
  });

  try {
    return await render({ exec, vesselName, assetLabel, inspectorSignature, chrome, tz, locale });
  } catch (err) {
    throw new RouteError(500, "PDF_RENDER_FAILED", err instanceof Error ? err.message : "No se pudo generar el PDF.");
  }
}

function render(ctx: {
  exec: Record<string, any>;
  vesselName: string | null;
  assetLabel: string | null;
  inspectorSignature: Buffer | null;
  chrome: Awaited<ReturnType<typeof resolveControlledDocChrome>>;
  tz: string;
  locale: string;
}): Promise<Buffer> {
  const { exec, vesselName, assetLabel, inspectorSignature, chrome, tz, locale } = ctx;
  const { meta, logoBuffer, tenantName } = chrome;
  const fmtD  = (d: unknown) => fmtDateTz(d as string | null, tz, locale);
  const fmtDT = (d: unknown) => fmtDateTimeTz(d as string | null, tz, locale);

  const results: ItemResult[] = Array.isArray(exec.itemResults) ? [...exec.itemResults] : [];
  results.sort((a, b) => (a.checklistItem?.sortOrder ?? 0) - (b.checklistItem?.sortOrder ?? 0));

  const counts = {
    total:         results.length,
    conforming:    results.filter(r => r.isConforming === true).length,
    notConforming: results.filter(r => r.isConforming === false).length,
    critical:      results.filter(r => r.deficiencySeverity === "CRITICAL").length,
  };

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: sanitizePdfText(`Inspeccion ${val(exec.executionCode)}`) } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const rightInfo = (page: number) =>
      sanitizePdfText(`${val(exec.executionCode)} — ${vesselName ?? val(exec.vesselCode)} — Pagina ${page} — ${fmtD(new Date())}`);

    const canvas = createFormCanvas(doc, {
      ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM,
      drawFooter: (page) => drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(page), x: ML, w: W }),
    });
    const { cell, textArea, ensureSpace, sectionHeader, measureCellHeight } = canvas;

    // ── Header documento controlado ─────────────────────────────────────────
    const hdrH = drawControlledDocHeader(doc, {
      meta, logoBuffer, tenantName, x: ML, y: MARGIN_T, w: W, page: canvas.page,
    });
    canvas.y = MARGIN_T + hdrH + 6;

    // ── Identificación ──────────────────────────────────────────────────────
    const RH = 20;
    const lbl = { bold: true, fontSize: 8, bg: LIGHT, color: BLACK } as const;
    const LBL_W = 95;

    const rowPair = (l1: string, v1: string, l2: string, v2: string) => {
      ensureSpace(RH);
      const half = Math.floor(W / 2);
      cell(ML, canvas.y, LBL_W, RH, l1, lbl);
      cell(ML + LBL_W, canvas.y, half - LBL_W, RH, sanitizePdfText(v1), { fontSize: 9 });
      cell(ML + half, canvas.y, LBL_W, RH, l2, lbl);
      cell(ML + half + LBL_W, canvas.y, W - half - LBL_W, RH, sanitizePdfText(v2), { fontSize: 9 });
      canvas.y += RH;
    };

    ensureSpace(RH);
    const REG_LBL_W = 70, REG_VAL_W = 150;
    cell(ML, canvas.y, LBL_W, RH, "Embarcacion", lbl);
    cell(ML + LBL_W, canvas.y, W - LBL_W - REG_LBL_W - REG_VAL_W, RH,
      sanitizePdfText(vesselName ? `${vesselName} (${val(exec.vesselCode)})` : val(exec.vesselCode)),
      { bold: true, fontSize: 9 });
    cell(ML + W - REG_LBL_W - REG_VAL_W, canvas.y, REG_LBL_W, RH, "Registro N°", lbl);
    cell(ML + W - REG_VAL_W, canvas.y, REG_VAL_W, RH, sanitizePdfText(val(exec.executionCode)),
      { bold: true, fontSize: 9, color: "#1d4ed8", align: "center" });
    canvas.y += RH;

    ensureSpace(RH);
    cell(ML, canvas.y, LBL_W, RH, "Equipo", lbl);
    cell(ML + LBL_W, canvas.y, W - LBL_W, RH, sanitizePdfText(val(assetLabel)), { fontSize: 9 });
    canvas.y += RH;

    rowPair("Estado", STATUS_LABEL[String(exec.status)] ?? String(exec.status), "Inspector", val(exec.inspectorName));
    rowPair("Programada", fmtD(exec.scheduledAt), "Iniciada", fmtDT(exec.startedAt));
    rowPair("Completada", fmtDT(exec.completedAt), "Proxima fecha", fmtD(exec.nextScheduledDate));

    ensureSpace(RH);
    const resultKey = String(exec.result ?? "");
    cell(ML, canvas.y, LBL_W, RH, "Resultado", lbl);
    cell(ML + LBL_W, canvas.y, W - LBL_W, RH, sanitizePdfText(RESULT_LABEL[resultKey] ?? val(exec.result)), {
      fontSize: 9, bold: true, color: RESULT_COLOR[resultKey] ?? BLACK,
    });
    canvas.y += RH;

    // ── Ítems inspeccionados ────────────────────────────────────────────────
    const C_N = 24, C_CRIT = 105, C_VAL = 62, C_CONF = 42;
    const C_ITEM = 168;
    const C_OBS = W - C_N - C_ITEM - C_CRIT - C_VAL - C_CONF;
    const HEAD_H = 18;
    const headRow = () => {
      let x = ML;
      const h = (w: number, text: string, align: "left" | "center" = "left") => {
        cell(x, canvas.y, w, HEAD_H, text, { bold: true, fontSize: 7, bg: LIGHT, align });
        x += w;
      };
      h(C_N, "N°", "center");
      h(C_ITEM, "ITEM INSPECCIONADO");
      h(C_CRIT, "CRITERIO");
      h(C_VAL, "VALOR", "center");
      h(C_CONF, "CONF.", "center");
      h(C_OBS, "OBSERVACIONES");
      canvas.y += HEAD_H;
    };

    sectionHeader("Items inspeccionados", 18, HEAD_H + 22);
    headRow();

    if (results.length === 0) {
      ensureSpace(20);
      cell(ML, canvas.y, W, 20, "Sin resultados cargados.", { fontSize: 8, color: GRAY, align: "center" });
      canvas.y += 20;
    }

    results.forEach((r, i) => {
      const item = r.checklistItem;
      const itemText = `${item?.isOptional ? "" : "* "}${item?.description ?? "—"}`;
      const crit = criteriaText(item);
      const measured = measuredText(r);
      const sev = r.deficiencySeverity ? `[${SEVERITY_LABEL[r.deficiencySeverity] ?? r.deficiencySeverity}] ` : "";
      const obs = `${sev}${r.notes ?? ""}`.trim();
      const conf = r.isConforming === true ? "SI" : r.isConforming === false ? "NO" : "—";
      const confColor = r.isConforming === true ? "#15803d" : r.isConforming === false ? "#b91c1c" : GRAY;

      const rowH = measureCellHeight(
        [itemText, crit, measured, obs],
        [C_ITEM, C_CRIT, C_VAL, C_OBS],
        { fontSize: 8, minHeight: 20 },
      );
      ensureSpace(rowH);
      // Si la fila rompió página, la tabla arranca de nuevo con su encabezado.
      if (canvas.y === MARGIN_T) headRow();

      let x = ML;
      const c = (w: number, text: string, o: Record<string, unknown> = {}) => {
        cell(x, canvas.y, w, rowH, sanitizePdfText(text), { fontSize: 8, wrap: true, ...o });
        x += w;
      };
      c(C_N, String(i + 1), { align: "center" });
      c(C_ITEM, itemText);
      c(C_CRIT, crit);
      c(C_VAL, measured, { align: "center" });
      c(C_CONF, conf, { align: "center", bold: true, color: confColor });
      c(C_OBS, obs);
      canvas.y += rowH;
    });

    if (results.some(r => r.checklistItem && !r.checklistItem.isOptional)) {
      ensureSpace(12);
      doc.fontSize(6.5).font("Helvetica").fillColor(GRAY)
        .text("(*) Item obligatorio.", ML, canvas.y + 2, { width: W });
      canvas.y += 12;
    }

    // ── Resumen ─────────────────────────────────────────────────────────────
    ensureSpace(RH + 6);
    canvas.y += 6;
    const summary: Array<[string, string, boolean]> = [
      ["Total", String(counts.total), false],
      ["Conformes", String(counts.conforming), false],
      ["No conformes", String(counts.notConforming), counts.notConforming > 0],
      ["Criticas", String(counts.critical), counts.critical > 0],
    ];
    const cw = Math.floor(W / summary.length);
    summary.forEach(([l, v, alert], i) => {
      const x = ML + i * cw;
      const bw = i === summary.length - 1 ? W - cw * (summary.length - 1) : cw;
      cell(x, canvas.y, bw, RH, `${l}: ${v}`, {
        fontSize: 8, bold: true, align: "center", bg: LIGHT, color: alert ? "#b91c1c" : BLACK,
      });
    });
    canvas.y += RH;

    // ── Observaciones generales ─────────────────────────────────────────────
    sectionHeader("Observaciones generales", 18, 30);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(String(exec.generalObservations ?? "")), 48);

    // ── Firmas ──────────────────────────────────────────────────────────────
    const SIG_H = 92;
    const SIG_IMG_W = 180, SIG_IMG_H = 52;
    ensureSpace(SIG_H + 8);
    canvas.y += 8;
    const half = Math.floor(W / 2);
    const boxes: Array<[string, string, Buffer | null]> = [
      ["FIRMA Y ACLARACION DEL INSPECTOR", val(exec.inspectorName), inspectorSignature],
      ["FIRMA Y ACLARACION DEL RESPONSABLE A BORDO", "", null],
    ];
    boxes.forEach(([label, name, sig], i) => {
      const bx = ML + i * half;
      const bw = i === 0 ? half : W - half;
      doc.rect(bx, canvas.y, bw, SIG_H).strokeColor(BORDER).lineWidth(0.5).stroke();
      if (sig) {
        try {
          doc.image(sig, bx + bw / 2 - SIG_IMG_W / 2, canvas.y + 6, { fit: [SIG_IMG_W, SIG_IMG_H], align: "center", valign: "center" });
        } catch { /* firma ilegible: la línea queda en blanco */ }
      }
      if (name && name !== "—") {
        doc.fontSize(8).font("Helvetica").fillColor(BLACK)
          .text(sanitizePdfText(name), bx + 8, canvas.y + SIG_H - 26, { width: bw - 16, lineBreak: false });
      }
      doc.moveTo(bx + 10, canvas.y + SIG_H - 14).lineTo(bx + bw - 10, canvas.y + SIG_H - 14)
        .strokeColor("#aaaaaa").lineWidth(0.8).stroke();
      doc.fontSize(6).font("Helvetica-Bold").fillColor(GRAY)
        .text(label, bx + 6, canvas.y + SIG_H - 10, { width: bw - 12, align: "center", lineBreak: false });
    });
    canvas.y += SIG_H;

    drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
    doc.end();
  });
}
