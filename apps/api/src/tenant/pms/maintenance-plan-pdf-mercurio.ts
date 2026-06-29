// Template Mercurio (documento controlado) para el Plan de mantenimiento.
// Renderer puro: recibe los datos ya cargados y devuelve un Buffer.
//
// Reutiliza el chrome del documento controlado (header con Revisión/Desde/
// Página + footer Elaborado/Revisado/Aprobado) y el canvas con textArea
// autoajustable de ../pdf-form-chrome. La matriz de riesgo (probabilidad ×
// consecuencia) se dibuja con las mismas reglas que la UI y el backend.

import PDFDocument from "pdfkit";
import { sanitizePdfText } from "./pdf-helpers";
import { areaText } from "./work-order-pdf/shared";
import {
  FORM_COLORS, FOOTER_H, PAGE_H,
  drawControlledDocHeader, drawControlledDocFooter, createFormCanvas, renderRiskMatrix,
  type ControlledDocMeta,
} from "./pdf-form-chrome";

const PW       = 595.28;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const PT_PER_MM = 72 / 25.4;          // 1 mm en puntos PDF
const TITLE_GAP = 7 * PT_PER_MM;      // separación fija de 7 mm antes de cada título

const { NAVY, WHITE, BLACK, GRAY, BORDER, LIGHT } = FORM_COLORS;

export interface MercurioMaintenancePlanData {
  meta: ControlledDocMeta;
  logoBuffer: Buffer | null;
  tenantName: string;
  plan: Record<string, unknown>;
  assetName: string | null;
  assetIsSafetyCritical: boolean;
  lastLog: {
    result: string; executedByName: string; completedAt: Date | null;
    runningHoursAtExecution: number | null; notes: string | null;
  } | null;
}

const RISK_LEVEL_LABEL: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
const RISK_LEVEL_COLOR: Record<string, string> = { LOW: "#16a34a", MEDIUM: "#b45309", HIGH: "#b91c1c", CRITICAL: "#7f1d1d" };

function val(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "—";
}
function fmtDate(d: unknown): string {
  if (!d) return "—";
  const dt = new Date(d as string);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("es-AR");
}
function frequencyLabel(p: Record<string, unknown>): string {
  const parts: string[] = [];
  if (p["frequencyMonths"] != null) parts.push(`${p["frequencyMonths"]} meses`);
  if (p["frequencyHours"] != null) parts.push(`${p["frequencyHours"]} h`);
  return parts.join(" / ") || "—";
}

export async function renderMercurioMaintenancePlanPdf(data: MercurioMaintenancePlanData): Promise<Buffer> {
  const { meta, logoBuffer, tenantName, plan: p, assetName, assetIsSafetyCritical, lastLog } = data;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Plan ${val(p["taskCode"])}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const rightInfo = (page: number) =>
      `${val(p["taskCode"])} — ${val(p["vesselCode"])} — Pagina ${page} — ${fmtDate(new Date())}`;

    const canvas = createFormCanvas(doc, {
      ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM,
      drawFooter: (page) => drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(page), x: ML, w: W }),
    });
    const { cell, textArea, ensureSpace } = canvas;

    // ── HEADER (documento controlado) ───────────────────────────────────────
    const hdrH = drawControlledDocHeader(doc, {
      meta, logoBuffer, tenantName, x: ML, y: MARGIN_T, w: W, page: canvas.page,
    });
    canvas.y = MARGIN_T + hdrH;
    canvas.y += 6;

    // ── IDENTIFICACIÓN (grilla) ─────────────────────────────────────────────
    const RH = 20;
    const lbl = { bold: true, fontSize: 8, bg: LIGHT, color: BLACK } as const;
    // Fila A: Embarcacion | vessel | PM No. | taskCode
    ensureSpace(RH);
    const LBL_W = 95, PM_LBL_W = 55, PM_VAL_W = 120;
    const vesselW = W - LBL_W - PM_LBL_W - PM_VAL_W;
    cell(ML, canvas.y, LBL_W, RH, "Embarcacion", lbl);
    cell(ML + LBL_W, canvas.y, vesselW, RH, sanitizePdfText(val(p["vesselCode"])), { bold: true, fontSize: 9, align: "center" });
    cell(ML + LBL_W + vesselW, canvas.y, PM_LBL_W, RH, "PM No.", lbl);
    cell(ML + LBL_W + vesselW + PM_LBL_W, canvas.y, PM_VAL_W, RH, sanitizePdfText(val(p["taskCode"])), { bold: true, fontSize: 9, color: "#1d4ed8", align: "center" });
    canvas.y += RH;

    // Fila B: Equipo | asset | SFI | sfiVal
    ensureSpace(RH);
    const SFI_LBL_W = 40, SFI_VAL_W = 70;
    const assetW = W - LBL_W - SFI_LBL_W - SFI_VAL_W;
    const assetText = assetIsSafetyCritical ? `${assetName ?? val(p["assetId"])}  [ISM 10.3]` : (assetName ?? val(p["assetId"]));
    cell(ML, canvas.y, LBL_W, RH, "Equipo:", lbl);
    cell(ML + LBL_W, canvas.y, assetW, RH, sanitizePdfText(val(assetText)), { fontSize: 9 });
    cell(ML + LBL_W + assetW, canvas.y, SFI_LBL_W, RH, "SFI", lbl);
    cell(ML + LBL_W + assetW + SFI_LBL_W, canvas.y, SFI_VAL_W, RH, p["sfiGroupNumber"] != null ? `G${p["sfiGroupNumber"]}` : "—", { fontSize: 9, align: "center" });
    canvas.y += RH;

    // Fila C: Departamento | área asignada (Cubierta/Máquinas/… o "Proveedor — <nombre>")
    ensureSpace(RH);
    cell(ML, canvas.y, LBL_W, RH, "Departamento:", lbl);
    cell(ML + LBL_W, canvas.y, W - LBL_W, RH, sanitizePdfText(val(areaText(p as any))), { fontSize: 9 });
    canvas.y += RH;

    // Fila D: Frecuencia | freq | Hs.Est. | estimatedHours
    ensureSpace(RH);
    const HS_LBL_W = 55, HS_VAL_W = 120;
    const freqW = W - LBL_W - HS_LBL_W - HS_VAL_W;
    cell(ML, canvas.y, LBL_W, RH, "Frecuencia:", lbl);
    cell(ML + LBL_W, canvas.y, freqW, RH, sanitizePdfText(frequencyLabel(p)), { fontSize: 9, align: "center" });
    cell(ML + LBL_W + freqW, canvas.y, HS_LBL_W, RH, "Hs.Est.:", lbl);
    cell(ML + LBL_W + freqW + HS_LBL_W, canvas.y, HS_VAL_W, RH, p["estimatedHours"] != null ? `${p["estimatedHours"]} h` : "—", { fontSize: 9, align: "center" });
    canvas.y += RH;

    // Fila E: Responsable de la Tarea | value
    ensureSpace(RH);
    const RESP_LBL_W = 140;
    cell(ML, canvas.y, RESP_LBL_W, RH, "Responsable de la Tarea:", lbl);
    cell(ML + RESP_LBL_W, canvas.y, W - RESP_LBL_W, RH, sanitizePdfText(val(p["responsible"])), { fontSize: 9 });
    canvas.y += RH;

    // ── Helpers de sección estilo Mercurio (label negrita subrayada + caja) ──
    function labelLine(label: string, inline?: string) {
      // Separación fija de 7 mm antes de cada título (se descarta si cae salto
      // de página: ensureSpace resetea el cursor a marginT).
      canvas.y += TITLE_GAP;
      ensureSpace(16);
      const y0 = canvas.y;
      doc.fontSize(9.5).font("Helvetica-Bold").fillColor(BLACK)
        .text(label, ML, y0, { lineBreak: false });
      const lblW = doc.font("Helvetica-Bold").fontSize(9.5).widthOfString(label);
      // Subrayado manual (la opción underline de pdfkit con lineBreak:false rompe).
      doc.moveTo(ML, y0 + 12).lineTo(ML + lblW, y0 + 12).strokeColor(BLACK).lineWidth(0.6).stroke();
      if (inline) {
        doc.font("Helvetica-Bold").fillColor(NAVY)
          .text(sanitizePdfText(inline), ML + lblW + 10, y0, { width: W - lblW - 10, lineBreak: false, ellipsis: true });
      }
      canvas.y = y0 + 15;
    }
    function section(label: string, content: string, inline?: string, minH = 36) {
      labelLine(label, inline);
      // keepMarkdown: conserva `**negrita**` y los `|` de tablas; el textArea del
      // chrome interpreta la grilla y la negrita inline.
      canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(content || "", { keepMarkdown: true }), minH);
      // El gap antes del próximo título lo aplica labelLine (7 mm fijos).
    }

    // ── DESCRIPCIÓN DE LA TAREA (título inline + descripción) ────────────────
    section("Descripcion de la tarea:", val(p["description"]), val(p["title"]), 44);

    // ── CRITERIOS DE ACEPTACIÓN ─────────────────────────────────────────────
    section("Criterios de Aceptacion:", val(p["acceptanceCriteria"]));

    // ── LOTO ────────────────────────────────────────────────────────────────
    section("LOTO:", val(p["loto"]));

    // ── NIVEL DE RIESGO + MATRIZ ────────────────────────────────────────────
    const riskProb = p["riskProbability"] ? String(p["riskProbability"]) : null;
    const riskCons = p["riskConsequence"] ? String(p["riskConsequence"]) : null;
    const riskLevelStr = p["riskLevel"] ? String(p["riskLevel"]) : "";
    labelLine("Nivel de riesgo:", riskLevelStr ? (RISK_LEVEL_LABEL[riskLevelStr] ?? riskLevelStr) : undefined);
    // La matriz es parte del formulario controlado: se dibuja siempre. La celda
    // se resalta solo si el plan tiene cargados ambos ejes (probabilidad ×
    // consecuencia); si no, se muestra la grilla de referencia sin resaltado.
    renderRiskMatrix(doc, canvas, ML, W, riskProb, riskCons);

    // ── RESULTADO DEL ANÁLISIS DE RIESGO ────────────────────────────────────
    section("Resultado del Analisis de Riesgo:", val(p["riskAnalysisResult"]));

    // ── ANÁLISIS RCM ────────────────────────────────────────────────────────
    section("Analisis RCM:", val(p["consequenceRationale"]));

    // ── RESULTADO DE LA EJECUCIÓN (si hay work log) ─────────────────────────
    if (lastLog) {
      const isOk = lastLog.result === "COMPLETED";
      labelLine("Resultado de la Ejecucion:");
      const ER = 20;
      ensureSpace(ER * 2);
      const cols = [
        { label: "Resultado", value: isOk ? "Satisfactorio" : "Con Deficiencias", color: isOk ? "#166534" : "#991b1b" },
        { label: "Ejecutado por", value: val(lastLog.executedByName), color: BLACK },
        { label: "Fecha", value: fmtDate(lastLog.completedAt), color: BLACK },
        { label: "Horas motor", value: lastLog.runningHoursAtExecution != null ? `${lastLog.runningHoursAtExecution} h` : "—", color: BLACK },
      ];
      const cw = Math.floor(W / cols.length);
      cols.forEach((c, i) => cell(ML + i * cw, canvas.y, cw, ER, c.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY }));
      canvas.y += ER;
      cols.forEach((c, i) => cell(ML + i * cw, canvas.y, cw, ER, sanitizePdfText(c.value), { bold: true, fontSize: 9, color: c.color }));
      canvas.y += ER;
      if (lastLog.notes) {
        canvas.y += 4;
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(lastLog.notes), 28);
      }
    }

    drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
    doc.end();
  });
}

