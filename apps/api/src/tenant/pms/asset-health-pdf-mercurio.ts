// Template Mercurio (documento controlado) para el Informe de salud del equipo.
// Renderer puro: recibe los datos ya cargados y devuelve un Buffer.
//
// Mismo chrome que el plan de mantenimiento y el diferimiento (header con
// Revisión/Desde/Página + pie Elaborado/Revisado/Aprobado) y el mismo canvas con
// textArea autoajustable, que es el que evita el bug histórico del texto que se
// sale del recuadro al cambiar de página (skill pms-pdf-generation).

import PDFDocument from "pdfkit";
import { sanitizePdfText } from "./pdf-helpers";
import type { HealthMetrics, HealthReportText, HealthSources } from "../assets/asset-health-service";
import { drawHealthBody } from "./asset-health-pdf-visuals";
import { fmtDate as fmtDateTz, fmtDateTime as fmtDateTimeTz } from "../../common/tenant-time";
import {
  FORM_COLORS, FOOTER_H, PAGE_H,
  drawControlledDocHeader, drawControlledDocFooter, createFormCanvas,
  type ControlledDocMeta,
} from "./pdf-form-chrome";

const PW       = 595.28;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const KEEP_MIN  = 26;

const { BLACK } = FORM_COLORS;

export interface MercurioAssetHealthData {
  meta: ControlledDocMeta;
  logoBuffer: Buffer | null;
  tenantName: string;
  report: {
    healthState: string;
    createdAt: Date | string;
    createdByName: string | null;
    periodFrom: Date | string;
    periodTo: Date | string;
  };
  asset: { assetCode: string; name: string | null; vesselCode: string; vesselName: string | null };
  /** Números del sistema (no de la IA): de acá salen las tarjetas y los colores. */
  metrics: HealthMetrics;
  /** Lectura redactada por la IA. */
  text: HealthReportText;
  /** Qué evidencia se leyó. */
  sources: HealthSources;
  tz: string;
  locale: string;
}

function val(v: unknown): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

export async function renderMercurioAssetHealthPdf(data: MercurioAssetHealthData): Promise<Buffer> {
  const { meta, logoBuffer, tenantName, report, asset, metrics, text, sources, tz, locale } = data;
  const fmtDate = (d: unknown) => fmtDateTz(d as string | null | undefined, tz, locale);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4", margin: 0,
      info: { Title: `Informe de salud — ${val(asset.name ?? asset.assetCode)}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // El buque va por NOMBRE, no por código (regla del proyecto).
    const vesselText = val(asset.vesselName ?? asset.vesselCode);
    const rightInfo = (page: number) =>
      `${val(asset.assetCode)} — ${vesselText} — Pagina ${page} — ${fmtDate(report.createdAt)}`;

    const canvas = createFormCanvas(doc, {
      ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM,
      drawFooter: (page) => drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(page), x: ML, w: W }),
    });
    const { textArea, ensureSpace } = canvas;

    // ── HEADER (documento controlado) ───────────────────────────────────────
    const hdrH = drawControlledDocHeader(doc, {
      meta, logoBuffer, tenantName, x: ML, y: MARGIN_T, w: W, page: canvas.page,
    });
    canvas.y = MARGIN_T + hdrH + 6;

    // Texto libre en caja con salto de página (el textArea del canvas dibuja el
    // pie de Mercurio en cada salto y evita el bug del texto fuera del recuadro).
    const textBox = (label: string, body: string) => {
      ensureSpace((label ? 15 : 0) + KEEP_MIN);
      if (label) {
        doc.fontSize(9.5).font("Helvetica-Bold").fillColor(BLACK).text(label, ML, canvas.y, { lineBreak: false });
        canvas.y += 15;
      }
      canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(body || "—", { keepMarkdown: true }), 36);
    };

    // ── CUERPO GRÁFICO (compartido con el PDF estándar) ──────────────────────
    drawHealthBody(doc, canvas, {
      x: ML, w: W, locale,
      fmtDate: (d) => fmtDate(d),
      healthState: report.healthState, metrics, text, sources,
      ficha: {
        vessel: vesselText,
        equipment: val(asset.name ?? asset.assetCode),
        code: val(asset.assetCode),
        period: `${fmtDate(report.periodFrom)} a ${fmtDate(report.periodTo)}`,
        generated: `Generado por ${val(report.createdByName)} el ${fmtDateTimeTz(report.createdAt as string | Date, tz, locale)}`,
      },
    }, textBox);

    drawControlledDocFooter(doc, { meta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
    doc.end();
  });
}
