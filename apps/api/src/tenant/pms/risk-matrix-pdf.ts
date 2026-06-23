// Render de la matriz de análisis de riesgo (probabilidad × consecuencia) para
// PDFs "planos" (doc + cursor `y`), estilo IMO. Mismas reglas que la UI
// (lib/risk.ts) y el backend. Resalta la celda seleccionada y muestra el nivel
// derivado. Devuelve el nuevo `y`. Maneja salto de página vía onAddPage.

const PROBS = ["LIKELY", "PROBABLE", "UNLIKELY", "RARE"];
const CONS  = ["FATALITY", "MAJOR", "MINOR", "NEGLIGIBLE"];
const probLabels: Record<string, string> = {
  LIKELY: "Muy probable", PROBABLE: "Probable", UNLIKELY: "Improbable", RARE: "Altamente improbable",
};
const consLabels: Record<string, string> = {
  FATALITY: "Fatalidad", MAJOR: "Lesiones importantes", MINOR: "Lesiones leves", NEGLIGIBLE: "Lesiones insignificantes",
};
const GRID: Record<string, Record<string, "H" | "M" | "B">> = {
  FATALITY:   { LIKELY: "H", PROBABLE: "H", UNLIKELY: "H", RARE: "M" },
  MAJOR:      { LIKELY: "H", PROBABLE: "H", UNLIKELY: "M", RARE: "M" },
  MINOR:      { LIKELY: "H", PROBABLE: "M", UNLIKELY: "M", RARE: "B" },
  NEGLIGIBLE: { LIKELY: "M", PROBABLE: "M", UNLIKELY: "B", RARE: "B" },
};
const levelColor = { H: "#dc2626", M: "#f59e0b", B: "#16a34a" } as const;
const levelText  = { H: "Alto", M: "Medio", B: "Bajo" } as const;

export interface RiskMatrixPdfOpts {
  x: number;
  w: number;
  y: number;
  contentBottom: number;
  marginTop: number;
  probability: string | null;
  consequence: string | null;
  fontRegular: string;
  fontBold: string;
  /** Agrega una página nueva (el caller resetea su propio cursor). */
  onAddPage: () => void;
}

export function renderRiskMatrixPdf(doc: PDFKit.PDFDocument, opts: RiskMatrixPdfOpts): number {
  const { x: ML, w: W, contentBottom, marginTop, fontRegular, fontBold } = opts;
  const prob = String(opts.probability ?? "").toUpperCase();
  const cons = String(opts.consequence ?? "").toUpperCase();
  let y = opts.y;
  const ensure = (need: number) => { if (y + need > contentBottom) { opts.onAddPage(); y = marginTop; } };

  const labelColW = 96;
  const cellW = (W - labelColW) / PROBS.length;
  const headerH = 30;
  const rowH = 30;
  const totalH = headerH + rowH * CONS.length;

  // Título de eje
  doc.fontSize(7).font(fontBold).fillColor("#64748b")
    .text("PROBABILIDAD", ML + labelColW, y, { width: W - labelColW, align: "center", characterSpacing: 0.5 });
  y += 11;

  ensure(totalH + 4);
  const top = y;

  // Esquina + headers de probabilidad
  doc.rect(ML, top, labelColW, headerH).fillColor("#0f2744").fill();
  doc.fontSize(6.5).font(fontBold).fillColor("#ffffff")
    .text("CONSECUENCIA", ML + 4, top + headerH / 2 - 6, { width: labelColW - 8, align: "center" });
  PROBS.forEach((pb, ci) => {
    const cx = ML + labelColW + ci * cellW;
    doc.rect(cx, top, cellW, headerH).fillColor("#1e3a5f").fill();
    doc.rect(cx, top, cellW, headerH).strokeColor("#ffffff").lineWidth(0.5).stroke();
    doc.fontSize(6.5).font(fontBold).fillColor("#ffffff")
      .text(probLabels[pb], cx + 3, top + 5, { width: cellW - 6, align: "center", lineGap: 0.5 });
  });

  // Filas de consecuencia
  CONS.forEach((cs, ri) => {
    const ry = top + headerH + ri * rowH;
    doc.rect(ML, ry, labelColW, rowH).fillColor("#e2e8f0").fill();
    doc.rect(ML, ry, labelColW, rowH).strokeColor("#ffffff").lineWidth(0.5).stroke();
    doc.fontSize(6.5).font(fontBold).fillColor("#0f172a")
      .text(consLabels[cs], ML + 4, ry + rowH / 2 - 7, { width: labelColW - 8, align: "center", lineGap: 0.5 });
    PROBS.forEach((pb, ci) => {
      const cx = ML + labelColW + ci * cellW;
      const lvl = GRID[cs][pb];
      const isSelected = pb === prob && cs === cons;
      doc.rect(cx, ry, cellW, rowH).fillColor(levelColor[lvl]).fill();
      doc.fontSize(9).font(fontBold).fillColor("#ffffff")
        .text(levelText[lvl], cx, ry + rowH / 2 - 6, { width: cellW, align: "center" });
      if (isSelected) {
        doc.rect(cx + 1.5, ry + 1.5, cellW - 3, rowH - 3).strokeColor("#0f172a").lineWidth(2.5).stroke();
      } else {
        doc.rect(cx, ry, cellW, rowH).strokeColor("#ffffff").lineWidth(0.5).stroke();
      }
    });
  });
  y = top + totalH + 8;

  // Resultado derivado (3 cajas: Probabilidad / Consecuencia / Nivel)
  const selLvl = GRID[cons]?.[prob];
  if (selLvl) {
    const boxH = 38;
    ensure(boxH);
    const colW = W / 3;
    const cells = [
      { label: "PROBABILIDAD", value: probLabels[prob] ?? prob, color: "#0f172a" },
      { label: "CONSECUENCIA", value: consLabels[cons] ?? cons, color: "#0f172a" },
      { label: "NIVEL DE RIESGO", value: levelText[selLvl], color: levelColor[selLvl] },
    ];
    cells.forEach((c, i) => {
      const bx = ML + i * colW;
      doc.rect(bx, y, colW, boxH).fillColor("#f8fafc").fill();
      doc.rect(bx, y, colW, boxH).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
      doc.fontSize(7).font(fontBold).fillColor("#64748b")
        .text(c.label, bx + 8, y + 7, { width: colW - 16, characterSpacing: 0.4 });
      doc.fontSize(10.5).font(fontBold).fillColor(c.color)
        .text(c.value, bx + 8, y + 19, { width: colW - 16, lineBreak: false, ellipsis: true });
    });
    y += boxH;
  }
  return y;
}
