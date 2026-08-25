// Checklist ejecutado → PDF (registro firmado del SGS).
//
// Es el papel que pide la auditoría: qué se verificó, con qué resultado, quién
// lo completó y quién lo firmó. Usa el chrome de documento controlado (header
// con número de formulario / revisión / página + pie Elaborado-Revisado-
// Aprobado) igual que la OT, la SS y los permisos, para que el registro salga
// del sistema con el mismo formato que el resto de los formularios del SGS.
//
// El número de formulario (ej. REGI-OPE-3.3) sale del nombre de la plantilla
// cuando arranca con él; si no, el header muestra sólo el título.

import PDFDocument from "pdfkit";
import type { TenantAccessSession } from "../auth/session-store";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { RouteError } from "../../http/route-error";
import { getExecution } from "./checklists-service";
import { sanitizePdfText } from "../pms/pdf-helpers";
import { resolveControlledDocChrome, splitFormCodeFromTitle } from "../pms/tenant-forms-service";
import { resolveTenantTime, fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";
import {
  FORM_COLORS, FOOTER_H, PAGE_H,
  drawControlledDocHeader, drawControlledDocFooter, createFormCanvas,
} from "../pms/pdf-form-chrome";

const PW = 595.28;
const ML = 36;
const W  = PW - ML * 2;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const { NAVY, BLACK, GRAY, BORDER, LIGHT } = FORM_COLORS;

const TYPE_LABEL: Record<string, string> = {
  PRE_ARRIVAL:          "Previo al arribo",
  PRE_DEPARTURE:        "Previo al zarpe",
  PRE_BUNKERING:        "Previo al bunkering",
  PRE_CARGO_TRANSFER:   "Previo a transferencia de carga",
  ENCLOSED_SPACE_ENTRY: "Ingreso a espacio confinado",
  HOT_WORK:             "Trabajo en caliente",
  PILOT_BOARDING:       "Embarque de practico",
  ANCHOR:               "Fondeo",
  MOORING:              "Amarre",
  OTHER:                "Otro",
};
const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "En curso",
  COMPLETED:   "Completado",
  CANCELLED:   "Cancelado",
};
const RESPONSE_LABEL: Record<string, string> = {
  CONFORMING:     "Conforme",
  NOT_CONFORMING: "No conforme",
  NOT_APPLICABLE: "N/A",
  PENDING:        "Pendiente",
};
const RESPONSE_COLOR: Record<string, string> = {
  CONFORMING:     "#15803d",
  NOT_CONFORMING: "#b91c1c",
  NOT_APPLICABLE: "#6B7280",
  PENDING:        "#b45309",
};

interface TemplateItem { code: string; text: string; isMandatory?: boolean; category?: string }
interface ResponseRow  { itemCode: string; itemText: string; status: string; notes: string | null; reportedByName: string | null }

function val(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

export async function buildChecklistExecutionPdf(session: TenantAccessSession, id: string): Promise<Buffer> {
  // getExecution aplica tenant + vessel scope y tira 404 si no es visible.
  const exec = await getExecution(session, id) as unknown as Record<string, any>;
  const { tz, locale } = await resolveTenantTime(session.tenantSlug);

  // Nombre del buque: en el papel va el nombre, nunca el código solo.
  let vesselName: string | null = null;
  const prisma = getPrismaClient();
  if (prisma) {
    try {
      const v = await prisma.vessel.findFirst({
        where: { tenantId: exec.tenantId, code: exec.vesselCode },
        select: { name: true },
      });
      vesselName = v?.name ?? null;
    } catch { /* non-blocking */ }
  }

  const templateName = String(exec.template?.name ?? TYPE_LABEL[String(exec.type)] ?? "Checklist");
  const parsed = splitFormCodeFromTitle(templateName);
  const chrome = await resolveControlledDocChrome(session.tenantSlug, {
    formCode: parsed.formCode,
    title: parsed.title || templateName,
    effectiveFrom: exec.template?.approvedAt ? fmtDateTz(exec.template.approvedAt, tz, locale, "") : "",
  });

  try {
    return await render({ exec, vesselName, chrome, tz, locale });
  } catch (err) {
    throw new RouteError(500, "PDF_RENDER_FAILED", err instanceof Error ? err.message : "No se pudo generar el PDF.");
  }
}

function render(ctx: {
  exec: Record<string, any>;
  vesselName: string | null;
  chrome: Awaited<ReturnType<typeof resolveControlledDocChrome>>;
  tz: string;
  locale: string;
}): Promise<Buffer> {
  const { exec, vesselName, chrome, tz, locale } = ctx;
  const { meta, logoBuffer, tenantName } = chrome;
  const fmtD  = (d: unknown) => fmtDateTz(d as string | null, tz, locale);
  const fmtDT = (d: unknown) => fmtDateTimeTz(d as string | null, tz, locale);

  const items: TemplateItem[] = Array.isArray(exec.template?.itemsJson) ? exec.template.itemsJson : [];
  const responses: ResponseRow[] = Array.isArray(exec.responses) ? exec.responses : [];
  const byCode = new Map(responses.map(r => [r.itemCode, r]));
  // Orden del papel = orden de la plantilla. Lo que quedó huérfano (ítem borrado
  // de la plantilla después de ejecutar) igual se imprime: es evidencia cargada.
  const rows: Array<{ item: TemplateItem; resp: ResponseRow | null }> =
    items.map(it => ({ item: it, resp: byCode.get(it.code) ?? null }));
  for (const r of responses) {
    if (!items.some(it => it.code === r.itemCode)) {
      rows.push({ item: { code: r.itemCode, text: r.itemText }, resp: r });
    }
  }

  const counts = {
    total:         rows.length,
    conforming:    rows.filter(r => r.resp?.status === "CONFORMING").length,
    notConforming: rows.filter(r => r.resp?.status === "NOT_CONFORMING").length,
    notApplicable: rows.filter(r => r.resp?.status === "NOT_APPLICABLE").length,
    pending:       rows.filter(r => !r.resp || r.resp.status === "PENDING").length,
  };

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: sanitizePdfText(`Checklist ${val(exec.executionCode)}`) } });
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

    rowPair("Tipo", TYPE_LABEL[String(exec.type)] ?? String(exec.type), "Estado", STATUS_LABEL[String(exec.status)] ?? String(exec.status));
    rowPair("Fecha / hora", fmtDT(exec.eventDateTime), "Puerto / zona", val(exec.port));
    rowPair("Viaje / ref.", val(exec.voyageRef), "Completado por", val(exec.performedByName));

    // ── Ítems verificados ───────────────────────────────────────────────────
    const C_N = 26, C_RES = 78, C_OBS = 140;
    const C_ITEM = W - C_N - C_RES - C_OBS;
    const HEAD_H = 18;
    const headRow = () => {
      cell(ML, canvas.y, C_N, HEAD_H, "N°", { bold: true, fontSize: 7.5, bg: LIGHT, align: "center" });
      cell(ML + C_N, canvas.y, C_ITEM, HEAD_H, "ITEM VERIFICADO", { bold: true, fontSize: 7.5, bg: LIGHT });
      cell(ML + C_N + C_ITEM, canvas.y, C_RES, HEAD_H, "RESULTADO", { bold: true, fontSize: 7.5, bg: LIGHT, align: "center" });
      cell(ML + C_N + C_ITEM + C_RES, canvas.y, C_OBS, HEAD_H, "OBSERVACIONES", { bold: true, fontSize: 7.5, bg: LIGHT });
      canvas.y += HEAD_H;
    };

    sectionHeader("Items verificados", 18, HEAD_H + 22);
    headRow();

    let lastCategory: string | null = null;
    rows.forEach((r, i) => {
      const category = r.item.category?.trim() || null;
      if (category && category !== lastCategory) {
        ensureSpace(16 + 22);
        if (canvas.y === MARGIN_T) headRow();
        cell(ML, canvas.y, W, 16, sanitizePdfText(category.toUpperCase()), { bold: true, fontSize: 7.5, bg: LIGHT, color: NAVY });
        canvas.y += 16;
        lastCategory = category;
      }
      const status = r.resp?.status ?? "PENDING";
      const itemText = `${r.item.isMandatory ? "* " : ""}${r.item.text}`;
      const notes = r.resp?.notes ?? "";
      const rowH = measureCellHeight([itemText, notes], [C_ITEM, C_OBS], { fontSize: 8, minHeight: 20 });
      ensureSpace(rowH);
      // Si la fila rompió página, la tabla arranca de nuevo con su encabezado.
      if (canvas.y === MARGIN_T) headRow();
      cell(ML, canvas.y, C_N, rowH, String(i + 1), { fontSize: 8, align: "center", wrap: true });
      cell(ML + C_N, canvas.y, C_ITEM, rowH, sanitizePdfText(itemText), { fontSize: 8, wrap: true });
      cell(ML + C_N + C_ITEM, canvas.y, C_RES, rowH, RESPONSE_LABEL[status] ?? status, {
        fontSize: 8, align: "center", bold: true, color: RESPONSE_COLOR[status] ?? BLACK, wrap: true,
      });
      cell(ML + C_N + C_ITEM + C_RES, canvas.y, C_OBS, rowH, sanitizePdfText(notes), { fontSize: 8, wrap: true });
      canvas.y += rowH;
    });

    if (rows.some(r => r.item.isMandatory)) {
      ensureSpace(12);
      doc.fontSize(6.5).font("Helvetica").fillColor(GRAY)
        .text("(*) Item obligatorio.", ML, canvas.y + 2, { width: W });
      canvas.y += 12;
    }

    // ── Resumen ─────────────────────────────────────────────────────────────
    ensureSpace(RH + 6);
    canvas.y += 6;
    const cw = Math.floor(W / 5);
    const summary: Array<[string, string]> = [
      ["Total", String(counts.total)],
      ["Conformes", String(counts.conforming)],
      ["No conformes", String(counts.notConforming)],
      ["N/A", String(counts.notApplicable)],
      ["Pendientes", String(counts.pending)],
    ];
    summary.forEach(([l, v], i) => {
      const x = ML + i * cw;
      const bw = i === summary.length - 1 ? W - cw * (summary.length - 1) : cw;
      cell(x, canvas.y, bw, RH, `${l}: ${v}`, {
        fontSize: 8, bold: true, align: "center", bg: LIGHT,
        color: l === "No conformes" && counts.notConforming > 0 ? "#b91c1c" : BLACK,
      });
    });
    canvas.y += RH;

    // ── Notas ───────────────────────────────────────────────────────────────
    sectionHeader("Notas", 18, 30);
    canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(String(exec.notes ?? "")), 40);

    // ── Firmas ──────────────────────────────────────────────────────────────
    const SIG_H = 74;
    ensureSpace(SIG_H + 8);
    canvas.y += 8;
    const half = Math.floor(W / 2);
    const boxes: Array<[string, string, string]> = [
      ["COMPLETADO POR", val(exec.performedByName), ""],
      ["FIRMA Y ACLARACION DEL RESPONSABLE", val(exec.signedByName), exec.signedAt ? `Firmado: ${fmtDT(exec.signedAt)}` : ""],
    ];
    boxes.forEach(([label, name, extra], i) => {
      const bx = ML + i * half;
      const bw = i === 0 ? half : W - half;
      doc.rect(bx, canvas.y, bw, SIG_H).strokeColor(BORDER).lineWidth(0.5).stroke();
      if (extra) {
        doc.fontSize(7).font("Helvetica").fillColor(GRAY)
          .text(sanitizePdfText(extra), bx + 8, canvas.y + 8, { width: bw - 16, lineBreak: false });
      }
      doc.fontSize(8).font("Helvetica").fillColor(BLACK)
        .text(sanitizePdfText(name), bx + 8, canvas.y + SIG_H - 26, { width: bw - 16, lineBreak: false });
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
