// Permisos de trabajo — formularios controlados REGI-SYE-01.4 .. 01.9 (rev 3).
//
// Renderer puro: recibe un PermitPdfContext ya cargado y devuelve un Buffer.
// Un solo renderer para los seis formularios: el body recorre
// `ctx.formConfig.sections` (orden e inclusión = data del tenant) invocando el
// catálogo de secciones de abajo. Los textos literales del papel viven en
// mercurio-permit-forms.ts.
//
// Lo que el sistema sabe sale impreso; lo que no, sale como casilla tildable o
// renglón en blanco para completar y firmar a bordo, igual que el papel.
//
// Las firmas NO se estampan: el papel pide INSPECTOR y SUPERVISOR, que no son
// necesariamente el usuario que aprobó en el sistema. Se imprime el nombre de
// quien aprobó donde corresponde y la firma queda en blanco.

import PDFDocument from "pdfkit";
import {
  FORM_COLORS, FOOTER_H, drawControlledDocHeader, drawControlledDocFooter,
  createFormCanvas,
} from "../../pms/pdf-form-chrome";
import { sanitizePdfText } from "../../pms/pdf-helpers";
import { fmtDate, fmtDateTime, fmtTime } from "../../../common/tenant-time";
import {
  mercurioPermitForm, SPECIAL_COMMENTS, SHIP_STATUS_OPTIONS, DEPARTMENT_OPTIONS,
  HEADER_ROLES, PPE_HEADER, ES_SECTION_1, ES_SECTION_1_TITLE, ES_GAS_CHECK_TITLE,
  ES_GAS_CHECK, ES_CONTRAST_TITLE, ES_GASES, ES_GAS_READINGS_TITLE, ES_GAS_LOCATIONS,
  ES_SECTION_2, ES_SECTION_2_TITLE, ES_INVALID_WARNING, ES_SECTION_3_TITLE,
  ES_SECTION_3, ES_EXIT_SIGNERS, ES_SIGNERS, ES_ENTRY_LOG_ROWS,
} from "./mercurio-permit-forms";
import {
  blank, isAuthorized, derivePermitFields, enclosedSpaceGasRows, PERMIT_STATUS_LABEL,
  type PermitPdfContext,
} from "./shared";

const PW       = 595.28;
const PAGE_H   = 841.89;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const { NAVY, WHITE, BLACK, GRAY, BORDER, LIGHT } = FORM_COLORS;
/** Rojo de la advertencia de invalidez del 01.4 (así viene en el papel). */
const RED = "#E11D1D";

const S = (v: unknown): string => sanitizePdfText(String(v ?? ""));

export async function renderMercurioPermitPdf(ctx: PermitPdfContext): Promise<Buffer> {
  const { permit, vesselName, tenantName, formMeta, formConfig, formLogoBuffer, tz, locale } = ctx;
  const form = mercurioPermitForm(permit.type);

  // Todas las fechas del papel, en la hora de la empresa (ver common/tenant-time).
  const fDate = (d: Date | string | null | undefined) => fmtDate(d, tz, locale, "");
  const fDateTime = (d: Date | string | null | undefined) => fmtDateTime(d, tz, locale, "");
  /**
   * Hora en 24 h. El papel tiene un casillero "HORA" de una guardia: "05:00"
   * es lo que escribe la tripulación, no "05:00 a. m." (que además no entra).
   */
  const fTime = (d: Date | string | null | undefined): string => {
    if (!d) return "";
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz });
    } catch {
      return fmtTime(d, tz, locale, "");
    }
  };

  // Datos del formulario compartidos con el Word (ver derivePermitFields).
  const { validFrom, validTo, supervisors, performers, entrants, lastGas, gasTesters, gasReading } =
    derivePermitFields(permit);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `${formMeta.formCode} ${permit.permitCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const rightInfo = (page: number) =>
      `${formMeta.formCode} — Pagina ${page} — ${permit.permitCode} — ${vesselName} — ${fDateTime(new Date())}`;

    const canvas = createFormCanvas(doc, {
      ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM,
      drawFooter: (page) => drawControlledDocFooter(doc, { meta: formMeta, rightInfo: rightInfo(page), x: ML, w: W }),
    });
    const { sectionHeader, cell, textArea, ensureSpace, measureCellHeight } = canvas;

    // AcroForm: el papel se completa a mano en la mayoría de los recuadros;
    // dejamos las casillas tildables desde el visor cuando el sistema no tiene
    // el dato.
    (doc as any).initForm();
    let _fid = 0;
    const label = (id: string, fallback: string) => formConfig.labels[id] ?? fallback;

    /** Casilla tildada por el sistema (dato real, no editable). */
    const drawCheckedBox = (cx: number, cy: number, box = 9) => {
      doc.rect(cx, cy, box, box).fillColor(WHITE).fill();
      doc.rect(cx, cy, box, box).strokeColor(BORDER).lineWidth(0.8).stroke();
      doc.moveTo(cx + 1.8, cy + box * 0.55)
        .lineTo(cx + box * 0.42, cy + box - 1.8)
        .lineTo(cx + box - 1.3, cy + 1.6)
        .strokeColor(BLACK).lineWidth(1.1).stroke();
    };
    /** Casilla vacía tildable desde el visor. */
    const formBox = (cx: number, cy: number, box = 9) => {
      (doc as any).formCheckbox(`chk_${_fid++}`, cx, cy, box, box, { borderColor: BORDER, borderWidth: 0.8 });
    };
    const box = (cx: number, cy: number, checked = false, size = 9) => {
      if (checked) drawCheckedBox(cx, cy, size); else formBox(cx, cy, size);
    };

    /**
     * Barra de sección de alto automático: los títulos del papel son largos
     * ("CONSIDERACIONES PREVIAS (Debe ser completado por...)") y con alto fijo
     * la segunda línea se salía de la barra y pisaba la fila de abajo.
     */
    function secHeader(title: string, keepWith = 0) {
      doc.fontSize(8).font("Helvetica-Bold");
      const th = doc.heightOfString(S(title).toUpperCase(), { width: W - 16, characterSpacing: 0.8 });
      sectionHeader(title, Math.max(18, Math.ceil(th) + 10), keepWith);
    }

    /**
     * Fila etiqueta/valor: N pares repartidos a lo ancho. El alto se mide sobre
     * los valores — una ubicación larga tiene que agrandar la fila, no
     * derramarse sobre la siguiente.
     */
    function kvRow(pairs: Array<{ label: string; value: string; lw?: number }>, h?: number) {
      const each = Math.floor(W / pairs.length);
      const geom = pairs.map((p, i) => {
        const lw = p.lw ?? 78;
        return { x: ML + i * each, lw, vw: (i === pairs.length - 1 ? W - i * each : each) - lw };
      });
      const rowH = h ?? measureCellHeight(
        pairs.map(p => S(p.value)), geom.map(g => g.vw), { fontSize: 8, minHeight: 18 },
      );
      const wrap = rowH > 18;
      ensureSpace(rowH);
      pairs.forEach((p, i) => {
        const g = geom[i];
        cell(g.x, canvas.y, g.lw, rowH, p.label, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center", wrap });
        cell(g.x + g.lw, canvas.y, g.vw, rowH, S(p.value), { fontSize: 8, align: "center", wrap });
      });
      canvas.y += rowH;
    }

    /** Recuadro de opciones: cabeceras arriba, casillas abajo (como el papel). */
    function optionsBlock(options: string[], selected: string[] = [], h = 16) {
      if (options.length === 0) return;
      ensureSpace(h * 2);
      const cw = Math.floor(W / options.length);
      options.forEach((o, i) => {
        const x = ML + i * cw;
        const wCol = i === options.length - 1 ? W - i * cw : cw;
        cell(x, canvas.y, wCol, h, o, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      });
      const rowY = canvas.y + h;
      options.forEach((o, i) => {
        const x = ML + i * cw;
        const wCol = i === options.length - 1 ? W - i * cw : cw;
        cell(x, rowY, wCol, h, "", {});
        box(x + wCol / 2 - 4.5, rowY + (h - 9) / 2, selected.includes(o));
      });
      canvas.y = rowY + h;
    }

    /** Fila de opciones etiqueta+casilla en línea (ESTADO DEL BUQUE). */
    function inlineOptionsRow(options: string[], h = 18) {
      ensureSpace(h);
      const cw = Math.floor(W / options.length);
      options.forEach((o, i) => {
        const x = ML + i * cw;
        const wCol = i === options.length - 1 ? W - i * cw : cw;
        cell(x, canvas.y, wCol, h, "", {});
        doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
          .text(o, x + 6, canvas.y + (h - 7) / 2, { width: wCol - 26, lineBreak: false });
        box(x + wCol - 16, canvas.y + (h - 9) / 2);
      });
      canvas.y += h;
    }

    /** Tabla de columnas con filas en blanco para completar a mano. */
    function blankTable(headers: string[], widths: number[], rows: string[][], minRows: number, h = 16) {
      ensureSpace(h * 2);
      headers.forEach((hd, i) => {
        const x = ML + widths.slice(0, i).reduce((a, b) => a + b, 0);
        cell(x, canvas.y, widths[i], h, hd, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      });
      canvas.y += h;
      const total = Math.max(rows.length, minRows);
      for (let r = 0; r < total; r++) {
        const row = rows[r] ?? [];
        const rh = measureCellHeight(row, widths, { fontSize: 8, minHeight: h });
        ensureSpace(rh);
        headers.forEach((_, i) => {
          const x = ML + widths.slice(0, i).reduce((a, b) => a + b, 0);
          cell(x, canvas.y, widths[i], rh, S(row[i] ?? ""), { fontSize: 8, wrap: true });
        });
        canvas.y += rh;
      }
    }

    /** Recuadro NOMBRE Y APELLIDO | DOCUMENTO | FIRMA. */
    function peopleBlock(title: string, names: string[], minRows = 2) {
      secHeader(title, 32);
      const wName = Math.floor(W * 0.5);
      const wDoc  = Math.floor(W * 0.22);
      const wSign = W - wName - wDoc;
      blankTable(
        ["NOMBRE Y APELLIDO", "DOCUMENTO", "FIRMA"],
        [wName, wDoc, wSign],
        names.map(n => [n, "", ""]),
        minRows,
      );
    }

    /** Tabla PREGUNTA | SI | NO | NA | NOTA con casillas tildables. */
    function checklistTable(items: string[], noteCol = true) {
      const wChk  = 26;
      const wNote = noteCol ? 90 : 0;
      const wQ    = W - wChk * 3 - wNote;
      const H     = 16;
      ensureSpace(H * 2);
      cell(ML, canvas.y, wQ, H, "PREGUNTA", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY });
      ["SI", "NO", "NA"].forEach((t, i) => {
        cell(ML + wQ + i * wChk, canvas.y, wChk, H, t, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      });
      if (noteCol) cell(ML + wQ + 3 * wChk, canvas.y, wNote, H, "NOTA", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      canvas.y += H;

      for (const item of items) {
        const rh = measureCellHeight([item], [wQ], { fontSize: 7.5, minHeight: 15 });
        ensureSpace(rh);
        cell(ML, canvas.y, wQ, rh, S(item), { fontSize: 7.5, wrap: true });
        for (let i = 0; i < 3; i++) {
          const x = ML + wQ + i * wChk;
          cell(x, canvas.y, wChk, rh, "", {});
          formBox(x + wChk / 2 - 4.5, canvas.y + (rh - 9) / 2);
        }
        if (noteCol) cell(ML + wQ + 3 * wChk, canvas.y, wNote, rh, "", {});
        canvas.y += rh;
      }
    }

    /** Tabla SI/NO | ITEM del 01.4: la respuesta se escribe a mano en la primera columna. */
    function siNoTable(items: readonly string[]) {
      const wAns = 40;
      const wItem = W - wAns;
      const H = 16;
      ensureSpace(H * 2);
      cell(ML, canvas.y, wAns, H, "SI/NO", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      cell(ML + wAns, canvas.y, wItem, H, "ITEM", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      canvas.y += H;
      for (const item of items) {
        const rh = measureCellHeight([item], [wItem], { fontSize: 7.5, minHeight: 15 });
        ensureSpace(rh);
        cell(ML, canvas.y, wAns, rh, "", {});
        cell(ML + wAns, canvas.y, wItem, rh, S(item), { fontSize: 7.5, wrap: true });
        canvas.y += rh;
      }
    }

    /** Caja libre para completar a mano (croquis, comentarios). */
    function blankBox(title: string, h: number) {
      secHeader(title, h);
      ensureSpace(h);
      cell(ML, canvas.y, W, h, "", {});
      canvas.y += h;
    }

    /** Bloque de texto del sistema; si viene vacío deja el recuadro para escribir. */
    function textBlock(title: string, text: string, minH = 30) {
      secHeader(title, minH);
      canvas.y += textArea(ML, canvas.y, W, S(text), minH);
    }

    /** Renglón "NOMBRE APELLIDO FIRMA" para INSPECTOR / SUPERVISOR. */
    function signerRows(rows: Array<{ role: string; name: string }>) {
      const H = 22;
      const wRole = 90;
      const wName = Math.floor((W - wRole) * 0.5);
      const wSign = W - wRole - wName;
      ensureSpace(H * (rows.length + 1));
      cell(ML, canvas.y, wRole, 14, "", { noStroke: true });
      cell(ML + wRole, canvas.y, wName, 14, "NOMBRE Y APELLIDO", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      cell(ML + wRole + wName, canvas.y, wSign, 14, "FIRMA", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      canvas.y += 14;
      for (const r of rows) {
        ensureSpace(H);
        cell(ML, canvas.y, wRole, H, r.role, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
        cell(ML + wRole, canvas.y, wName, H, S(r.name), { fontSize: 8, align: "center" });
        cell(ML + wRole + wName, canvas.y, wSign, H, "", {});
        canvas.y += H;
      }
    }

    // ── HEADER (documento controlado) ───────────────────────────────────────
    const hdrH = drawControlledDocHeader(doc, {
      meta: formMeta,
      logoBuffer: formLogoBuffer,
      tenantName,
      x: ML, y: MARGIN_T, w: W, page: canvas.page,
    });
    canvas.y = MARGIN_T + hdrH + 8;

    // Número del permiso: no está en el papel (se completa a mano), pero sin él
    // el documento impreso no se puede rastrear contra el sistema.
    kvRow([
      { label: label("permitCode", "N° PERMISO"), value: permit.permitCode, lw: 70 },
      { label: label("estado", "ESTADO"), value: PERMIT_STATUS_LABEL[permit.status] ?? permit.status, lw: 55 },
    ], 16);
    canvas.y += 6;

    const departments = formConfig.departments.length ? formConfig.departments : DEPARTMENT_OPTIONS;

    const sections: Record<string, () => void> = {
      // ── Encabezado del buque (01.4 / 01.5 / 01.6) ──
      vesselHeader: () => {
        kvRow([
          { label: label("remolcador", "REMOLCADOR"), value: vesselName, lw: 78 },
          { label: label("fecha", "FECHA"), value: fDate(permit.requestedAt ?? permit.createdAt), lw: 50 },
        ]);
        kvRow([
          { label: label("zona", "ZONA"), value: permit.location, lw: 45 },
          { label: label("rio", "RIO"), value: "", lw: 40 },
          { label: label("km", "KM"), value: "", lw: 40 },
          { label: label("margen", "MARGEN"), value: "", lw: 50 },
        ]);
        // Firmas del encabezado: en el papel se completan a mano.
        const cw = Math.floor(W / HEADER_ROLES.length);
        ensureSpace(34);
        HEADER_ROLES.forEach((r, i) => {
          const x = ML + i * cw;
          const wCol = i === HEADER_ROLES.length - 1 ? W - i * cw : cw;
          cell(x, canvas.y, wCol, 14, r, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
          cell(x, canvas.y + 14, wCol, 20, "", {});
        });
        canvas.y += 34;
        secHeader(label("departamento", "DEPARTAMENTO"), 32);
        optionsBlock(departments);
        canvas.y += 6;
      },

      // ── Encabezado reducido (01.7 / 01.8 / 01.9) ──
      vesselHeaderShort: () => {
        kvRow([
          { label: label("remolcador", "REMOLCADOR"), value: vesselName, lw: 78 },
          { label: label("fecha", "FECHA"), value: fDate(permit.requestedAt ?? permit.createdAt), lw: 50 },
        ]);
        kvRow([
          { label: label("zona", "ZONA"), value: permit.location, lw: 45 },
          { label: label("rio", "RIO"), value: "", lw: 40 },
          { label: label("km", "KM"), value: "", lw: 40 },
          { label: label("margen", "MARGEN"), value: "", lw: 50 },
        ]);
        canvas.y += 6;
      },

      shipStatus: () => {
        secHeader(label("shipStatus", "ESTADO DEL BUQUE"), 36);
        inlineOptionsRow(SHIP_STATUS_OPTIONS);
        kvRow([
          { label: "RIO", value: "", lw: 40 },
          { label: "KM", value: "", lw: 40 },
          { label: "CIUDAD", value: "", lw: 55 },
        ]);
        canvas.y += 6;
      },

      // ── Naturaleza del trabajo ──
      workKindHotCold: () => {
        secHeader(label("workKind", "TRABAJO PARA REALIZAR"), 32);
        // El tipo del permiso tilda su casilla; el resto queda para marcar a mano.
        const selected = permit.type === "HOT_WORK" ? ["TRABAJO EN CALIENTE"]
          : permit.type === "COLD_WORK" ? ["TRABAJO EN FRIO"]
          : permit.type === "ENCLOSED_SPACE_ENTRY" ? ["INGRESO A ESPACIO CONFINADO"] : [];
        optionsBlock(form.workKinds, selected);
        canvas.y += 6;
      },

      workKindMaint: () => {
        secHeader(label("workKind", "TIPO DE TRABAJO A REALIZARSE"), 32);
        optionsBlock(form.workKinds);
        canvas.y += 6;
      },

      affectedEquipment: () => {
        kvRow([{ label: label("equipo", "EQUIPO AFECTADO"), value: "", lw: 110 }]);
        textBlock(label("workDesc", "DESCRIPCION DEL TRABAJO A SER REALIZADO"), permit.description, 34);
        canvas.y += 6;
      },

      motiveZone: () => {
        secHeader(label("motive", "MOTIVO Y ZONA DEL TRABAJO"), 32);
        const wN = 32, wZona = 110, wMotivo = 140;
        blankTable(
          ["N°", "ZONA", "MOTIVO", "DETALLE DEL TRABAJO"],
          [wN, wZona, wMotivo, W - wN - wZona - wMotivo],
          [["1", blank(permit.location), blank(permit.hazardsIdentified ? "" : ""), blank(permit.description)]],
          3,
        );
        canvas.y += 6;
      },

      motiveHeight: () => {
        secHeader(label("motive", "MOTIVO Y ALTURA DEL TRABAJO"), 32);
        const wN = 32, wZona = 120, wMotivo = W - 32 - 120 - 90;
        blankTable(
          ["N°", "ZONA", "MOTIVO", "ALTURA"],
          [wN, wZona, wMotivo, 90],
          [["1", blank(permit.location), blank(permit.description), ""]],
          3,
        );
        canvas.y += 6;
      },

      adjacentAreas: () => {
        blankBox(label("adjacent", "EN CORRESPONDENCIA CON (Describir las áreas linderas)"), 34);
        canvas.y += 6;
      },

      tools: () => {
        blankBox(label("tools", "HERRAMIENTAS PARA UTILIZAR"), 34);
        canvas.y += 6;
      },

      sketch: () => {
        blankBox(label("sketch", "CROQUIS DE LA ZONA A TRABAJARSE"), 110);
        canvas.y += 6;
      },

      // ── Personas ──
      performers: () => {
        peopleBlock(label("performers", "QUIEN REALIZARA EL TRABAJO"), performers, 3);
        canvas.y += 6;
      },
      supervisors: () => {
        peopleBlock(label("supervisors", "QUIEN SUPERVISARA EL TRABAJO"), supervisors, 2);
        canvas.y += 6;
      },
      gasTesters: () => {
        peopleBlock(label("gasTesters", "QUIEN HARA MEDICION DE GASES"), gasTesters, 2);
        canvas.y += 6;
      },

      gasEquipment: () => {
        secHeader(label("gasEquipment", "EQUIPO DE MEDICION DE GASES"), 32);
        const q = Math.floor(W / 4);
        blankTable(["MARCA", "MODELO", "CERTIFICADO", "VENCE"], [q, q, q, W - 3 * q], [], 1);
        canvas.y += 6;
      },

      // ── Medición de gases (01.5) ──
      gasResults: () => {
        secHeader(label("gasResults", "RESULTADO DE LA MEDICION DE GASES"), 34);
        const wItem = 30, wGas = 130, wRef = 110, wRes = 90;
        const wSafe = Math.floor((W - wItem - wGas - wRef - wRes) / 2);
        const H = 16;
        ensureSpace(H * 2);
        const heads: Array<[string, number]> = [
          ["ITEM", wItem], ["GAS", wGas], ["REFERENCIA", wRef], ["RESULTADO", wRes],
          ["HOMBRE SEGURO", wSafe], ["HOMBRE NO SEGURO", W - wItem - wGas - wRef - wRes - wSafe],
        ];
        let hx = ML;
        heads.forEach(([t, cw]) => {
          cell(hx, canvas.y, cw, H, t, { bold: true, fontSize: 6.5, bg: LIGHT, color: GRAY, align: "center" });
          hx += cw;
        });
        canvas.y += H;
        form.gasRows.forEach((g, i) => {
          ensureSpace(H);
          let x = ML;
          const values = [String(i + 1), g.gas, g.reference, gasReading(g.reading)];
          values.forEach((v, j) => {
            cell(x, canvas.y, heads[j][1], H, S(v), { fontSize: 7, align: j === 1 ? "left" : "center" });
            x += heads[j][1];
          });
          // Las dos casillas quedan vacías: el veredicto del sistema es global,
          // no por gas — quien mide decide y firma cada renglón.
          for (let k = 4; k < 6; k++) {
            cell(x, canvas.y, heads[k][1], H, "", {});
            formBox(x + heads[k][1] / 2 - 4.5, canvas.y + (H - 9) / 2);
            x += heads[k][1];
          }
          canvas.y += H;
        });
        if (lastGas) {
          const verdict = lastGas.verdict === "PASS" ? "SEGURO" : "NO SEGURO";
          kvRow([{
            label: "REGISTRADO",
            value: `${verdict} — ${fDate(lastGas.testedAt)} ${fTime(lastGas.testedAt)} — ${lastGas.testedByName}`,
            lw: 70,
          }], 14);
        }
        canvas.y += 6;
      },

      // ── Checklists ──
      considerations: () => {
        if (form.considerations.length === 0) return;
        if (form.considerationsTitle) secHeader(form.considerationsTitle, 34);
        for (const group of form.considerations) {
          if (group.title) secHeader(group.title, 34);
          checklistTable(group.items);
        }
        textBlock(label("otherComments", "OTROS COMENTARIOS"),
          [permit.hazardsIdentified, permit.controlMeasures].filter(Boolean).join("\n"), 28);
        canvas.y += 6;
      },

      ppe: () => {
        if (form.ppe.length === 0) return;
        secHeader(PPE_HEADER, 34);
        const wChk = 26, wNote = 90;
        const wEq = W - wChk * 3 - wNote;
        const H = 15;
        ensureSpace(H * 2);
        cell(ML, canvas.y, wEq, H, "EQUIPO", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY });
        ["SI", "NO", "NA"].forEach((t, i) => {
          cell(ML + wEq + i * wChk, canvas.y, wChk, H, t, { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
        });
        cell(ML + wEq + 3 * wChk, canvas.y, wNote, H, "NOTA", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
        canvas.y += H;
        for (const item of form.ppe) {
          ensureSpace(H);
          cell(ML, canvas.y, wEq, H, S(item), { fontSize: 7.5 });
          for (let i = 0; i < 3; i++) {
            const x = ML + wEq + i * wChk;
            cell(x, canvas.y, wChk, H, "", {});
            formBox(x + wChk / 2 - 4.5, canvas.y + (H - 9) / 2);
          }
          cell(ML + wEq + 3 * wChk, canvas.y, wNote, H, "", {});
          canvas.y += H;
        }
        // El EPP que cargó el permiso: el papel no lo tiene como texto, va acá.
        textBlock(label("ppeComments", "OTROS COMENTARIOS"), permit.ppeRequired ?? "", 24);
        canvas.y += 6;
      },

      // ── Resolución + validez ──
      resolution: () => {
        secHeader(label("resolution", "RESOLUCION DEL INSPECTOR O SUPERVISOR"), 34);
        const authorized = isAuthorized(permit.status);
        const rejected   = permit.status === "REJECTED";
        const H = 16;
        const wLbl = form.resolutionRows.length > 0 ? Math.floor(W * 0.5) : Math.floor(W * 0.2);
        const wOpt = Math.floor((W - wLbl) / 2);
        ensureSpace(H * 2);
        cell(ML, canvas.y, wLbl, H, form.resolutionRows.length > 0 ? "TRABAJO" : "", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
        cell(ML + wLbl, canvas.y, wOpt, H, "AUTORIZADO", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
        cell(ML + wLbl + wOpt, canvas.y, W - wLbl - wOpt, H, "NO AUTORIZADO", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
        canvas.y += H;
        const rows = form.resolutionRows.length > 0 ? form.resolutionRows : [""];
        // Sólo se tilda la fila del trabajo que este permiso autoriza; las otras
        // opciones del papel quedan a mano.
        const ownRow = permit.type === "HOT_WORK" ? "Trabajo en Caliente"
          : permit.type === "COLD_WORK" ? "Trabajo en Frío" : "";
        rows.forEach(r => {
          ensureSpace(H);
          cell(ML, canvas.y, wLbl, H, S(r), { fontSize: 7.5 });
          const isOwn = form.resolutionRows.length === 0 || r === ownRow;
          cell(ML + wLbl, canvas.y, wOpt, H, "", {});
          box(ML + wLbl + wOpt / 2 - 4.5, canvas.y + (H - 9) / 2, isOwn && authorized);
          cell(ML + wLbl + wOpt, canvas.y, W - wLbl - wOpt, H, "", {});
          box(ML + wLbl + wOpt + (W - wLbl - wOpt) / 2 - 4.5, canvas.y + (H - 9) / 2, isOwn && rejected);
          canvas.y += H;
        });
        textBlock(label("rejectCauses", "EN CASO DE NO AUTORIZADO DETALLAR CAUSAS"),
          permit.rejectionReason ?? permit.cancelReason ?? "", 26);
        textBlock(label("specialMeasures", "EN CASO DE AUTORIZADO SI CORRESPONDEN MEDIDAS ESPECIALES"),
          permit.controlMeasures ?? "", 26);
        canvas.y += 6;
      },

      validity: () => {
        secHeader(label("validity", "VALIDEZ"), 40);
        kvRow([
          { label: "FECHA EXPEDICION", value: fDate(validFrom), lw: 92 },
          { label: "HORA", value: fTime(validFrom), lw: 42 },
        ], 16);
        kvRow([
          { label: "FECHA VENCIMIENTO", value: fDate(validTo), lw: 92 },
          { label: "HORA", value: fTime(validTo), lw: 42 },
        ], 16);
        // El aprobador del sistema es quien autorizó; INSPECTOR y SUPERVISOR del
        // papel se firman a bordo, por eso la firma va en blanco.
        signerRows([
          { role: "INSPECTOR", name: isAuthorized(permit.status) ? (ctx.approvedByName ?? "") : "" },
          { role: "SUPERVISOR", name: supervisors[0] ?? "" },
        ]);
        canvas.y += 6;
      },

      specialComments: () => {
        secHeader(label("specialComments", "COMENTARIOS ESPECIALES"), 40);
        // Sin viñeta "•": el renderer la dibuja como casilla de verificación y
        // esto no es un checklist, son las condiciones de validez del permiso.
        canvas.y += textArea(ML, canvas.y, W, SPECIAL_COMMENTS.map((l, i) => `${i + 1}. ${l}`).join("\n"), 40);
        canvas.y += 6;
      },

      completion: () => {
        secHeader(label("completion", "FINALIZACION DE LOS TRABAJOS"), 34);
        const wN = 32, wZona = 110, wDet = W - 32 - 110 - 110;
        blankTable(
          ["N°", "ZONA", "DETALLE", "FECHA DE REALIZADO"],
          [wN, wZona, wDet, 110],
          permit.closedAt
            ? [["1", blank(permit.location), blank(permit.closeNotes ?? permit.description), fDate(permit.closedAt)]]
            : [],
          2,
        );
        signerRows([
          { role: "INSPECTOR", name: permit.closedAt ? (ctx.closedByName ?? "") : "" },
          { role: "SUPERVISOR", name: "" },
        ]);
        canvas.y += 6;
      },

      additionalComments: () => {
        textBlock(label("additionalComments", "COMENTARIOS ADICIONALES"), permit.closeNotes ?? "", 40);
        canvas.y += 6;
      },

      generatedBy: () => {
        kvRow([{
          label: label("generatedBy", "EL PRESENTE FUE GENERADO POR"),
          value: `${ctx.createdByName ?? ""}  —  ${permit.permitCode}`,
          lw: 160,
        }], 18);
      },

      // Recuadro EL MISMO FUE COMUNICADO POR (01.4): se tilda a mano.
      communicatedBy: () => {
        if (formConfig.communicationMethods.length === 0) return;
        canvas.y += 6;
        secHeader(label("communicatedBy", "EL MISMO FUE COMUNICADO POR"), 32);
        optionsBlock(formConfig.communicationMethods);
        canvas.y += 6;
      },

      // ── REGI-SYE-01.4 ──
      esGeneral: () => {
        secHeader(label("esGeneral", "GENERAL"), 36);
        kvRow([{ label: "LOCALIZACION / NOMBRE DEL ESPACIO CERRADO", value: permit.location, lw: 220 }]);
        kvRow([{ label: "MOTIVO DE LA ENTRADA", value: permit.description, lw: 220 }]);
        canvas.y += 6;
      },

      esValidity: () => {
        secHeader(label("esValidity", "VALIDEZ"), 36);
        const H = 18, wRow = 70, wLbl = 50;
        const wVal = Math.floor((W - wRow - 2 * wLbl) / 2);
        const head = { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" as const };
        ensureSpace(H * 2);
        for (const { row, at } of [{ row: "DESDE", at: validFrom }, { row: "HASTA", at: validTo }]) {
          let x = ML;
          cell(x, canvas.y, wRow, H, row, head);               x += wRow;
          cell(x, canvas.y, wLbl, H, "FECHA", head);            x += wLbl;
          cell(x, canvas.y, wVal, H, S(fDate(at)), { fontSize: 8, align: "center" }); x += wVal;
          cell(x, canvas.y, wLbl, H, "HORA", head);             x += wLbl;
          cell(x, canvas.y, ML + W - x, H, S(fTime(at)), { fontSize: 8, align: "center" });
          canvas.y += H;
        }
        canvas.y += 6;
      },

      esSection1: () => {
        secHeader(ES_SECTION_1_TITLE, 34);
        siNoTable(ES_SECTION_1);
        canvas.y += 6;
      },

      esGasCheck: () => {
        secHeader(label("esGasCheck", ES_GAS_CHECK_TITLE), 34);
        const head = { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" as const };
        const wChk = 30, wQ = W - 2 * wChk, H = 16;
        ensureSpace(H * 2);
        cell(ML, canvas.y, wQ, H, "ITEM", head);
        cell(ML + wQ, canvas.y, wChk, H, "SI", head);
        cell(ML + wQ + wChk, canvas.y, wChk, H, "NO", head);
        canvas.y += H;
        for (const item of ES_GAS_CHECK) {
          const rh = measureCellHeight([item], [wQ], { fontSize: 7.5, minHeight: 15 });
          ensureSpace(rh);
          cell(ML, canvas.y, wQ, rh, S(item), { fontSize: 7.5, wrap: true });
          for (let i = 0; i < 2; i++) {
            const x = ML + wQ + i * wChk;
            cell(x, canvas.y, wChk, rh, "", {});
            formBox(x + wChk / 2 - 4.5, canvas.y + (rh - 9) / 2);
          }
          canvas.y += rh;
        }
        // Contraste: lo que marca el medidor con el gas patrón. Se completa a
        // bordo; no es la medición del espacio (esa va en MEDICIONES DE GAS).
        ensureSpace(H * 3);
        cell(ML, canvas.y, W, H, ES_CONTRAST_TITLE, { bold: true, fontSize: 8, bg: LIGHT, color: BLACK, align: "center" });
        canvas.y += H;
        const wLbl = Math.floor(W * 0.3);
        const wGas = Math.floor((W - wLbl) / ES_GASES.length);
        for (const [first, values, isHead] of [
          ["TIPO DE GAS DETECTADO", ES_GASES.map(g => g.gas), true],
          ["LECTURA DE EQUIPO", ES_GASES.map(() => ""), false],
        ] as const) {
          cell(ML, canvas.y, wLbl, H, first, head);
          values.forEach((v, i) => {
            const x = ML + wLbl + i * wGas;
            const wCol = i === values.length - 1 ? ML + W - x : wGas;
            cell(x, canvas.y, wCol, H, v, isHead ? head : {});
          });
          canvas.y += H;
        }
        canvas.y += 6;
      },

      esGasReadings: () => {
        secHeader(label("esGasReadings", ES_GAS_READINGS_TITLE), 54);
        const head = { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" as const };
        const wItem = 30, wLoc = 110, wHora = 64;
        const wRead = W - wItem - wLoc - wHora;
        const wGas = Math.floor(wRead / ES_GASES.length);
        const gasX = (i: number) => ML + wItem + wLoc + wHora + i * wGas;
        const gasW = (i: number) => (i === ES_GASES.length - 1 ? wRead - i * wGas : wGas);
        const H1 = 14, H2 = 14, H3 = 10;
        ensureSpace(H1 + H2 + H3 + 15);
        const y0 = canvas.y;
        cell(ML, y0, wItem, H1 + H2 + H3, "ITEM", head);
        cell(ML + wItem, y0, wLoc, H1 + H2 + H3, "UBICACION", head);
        cell(ML + wItem + wLoc, y0, wHora, H1 + H2 + H3, "HORA", head);
        cell(gasX(0), y0, wRead, H1, "LECTURA", head);
        ES_GASES.forEach((g, i) => {
          cell(gasX(i), y0 + H1, gasW(i), H2, g.gas, head);
          cell(gasX(i), y0 + H1 + H2, gasW(i), H3, g.limit, { fontSize: 5.5, bg: LIGHT, color: GRAY, align: "center" });
        });
        canvas.y = y0 + H1 + H2 + H3;
        // Las mediciones registradas en el sistema caen en el renglón de su
        // ubicación; el resto de los renglones queda para completar a mano.
        enclosedSpaceGasRows(ES_GAS_LOCATIONS, permit.gasTests).forEach((r, i) => {
          const rh = measureCellHeight([r.location], [wLoc], { fontSize: 7.5, minHeight: 15 });
          ensureSpace(rh);
          const wrap = rh > 15;
          cell(ML, canvas.y, wItem, rh, String(i + 1), { fontSize: 7.5, align: "center" });
          cell(ML + wItem, canvas.y, wLoc, rh, S(r.location), { fontSize: 7.5, wrap });
          cell(ML + wItem + wLoc, canvas.y, wHora, rh, r.test ? fTime(r.test.testedAt) : "", { fontSize: 7.5, align: "center" });
          ES_GASES.forEach((g, j) => {
            cell(gasX(j), canvas.y, gasW(j), rh, gasReading(g.reading, r.test), { fontSize: 7.5, align: "center" });
          });
          canvas.y += rh;
        });
        canvas.y += 6;
      },

      esSection2: () => {
        secHeader(ES_SECTION_2_TITLE, 34);
        siNoTable(ES_SECTION_2);
        // Advertencia en rojo, centrada y sin recuadro, como en el papel.
        doc.fontSize(10).font("Helvetica-Bold");
        const text = S(ES_INVALID_WARNING);
        const th = doc.heightOfString(text, { width: W - 60, align: "center" });
        ensureSpace(th + 14);
        doc.fontSize(10).font("Helvetica-Bold").fillColor(RED)
          .text(text, ML + 30, canvas.y + 7, { width: W - 60, align: "center" });
        canvas.y += th + 14;
      },

      esSection3: () => {
        secHeader(ES_SECTION_3_TITLE, 34);
        siNoTable(ES_SECTION_3);
        // Firmas de la comprobación a la salida. El sistema sólo conoce al
        // supervisor del trabajo; la firma va siempre en blanco.
        secHeader(label("esExitSignatures", "NOMBRE Y FIRMA"), 32);
        const q = Math.floor(W / 4);
        blankTable(
          ["PUESTO", "NOMBRE", "FECHA/HORA", "FIRMA"], [q, q, q, W - 3 * q],
          ES_EXIT_SIGNERS.map((role, i) => [role, i === 0 ? (supervisors[0] ?? "") : "", "", ""]),
          ES_EXIT_SIGNERS.length, 18,
        );
        canvas.y += 6;
      },

      esSignatures: () => {
        // Nombres que el sistema conoce: quien midió los gases y los dos
        // primeros ejecutantes. Capitán, oficial y supervisor de entrada se
        // completan a bordo.
        const names: Record<string, string> = { "Supervisor que midió gases": gasTesters.join(", ") };
        let op = 0;
        secHeader(label("esSignatures", "NOMBRE Y FIRMA"), 32);
        const q = Math.floor(W / 4);
        blankTable(
          ["PUESTO", "NOMBRE", "FECHA/HORA", "FIRMA"], [q, q, q, W - 3 * q],
          ES_SIGNERS.map(role => [role, role === "Operador que entra" ? (entrants[op++] ?? "") : (names[role] ?? ""), "", ""]),
          ES_SIGNERS.length, 18,
        );
        canvas.y += 6;
      },

      esEntryLog: () => {
        secHeader(label("esEntryLog", "NOMBRE Y FIRMA DE QUIENES ENTRARON EN EL ESPACIO CONFINADO"), 32);
        const wName = Math.floor(W * 0.4), wDate = Math.floor(W * 0.13), wIn = Math.floor(W * 0.14), wOut = Math.floor(W * 0.14);
        blankTable(
          ["NOMBRE Y APELLIDO", "FECHA", "HORA INGRESO", "HORA SALIDA", "FIRMA"],
          [wName, wDate, wIn, wOut, W - wName - wDate - wIn - wOut],
          entrants.map(n => [n, "", "", "", ""]),
          ES_ENTRY_LOG_ROWS,
        );
        canvas.y += 6;
      },
    };

    const order = formConfig.sections.length > 0 ? formConfig.sections : ["vesselHeader", "generatedBy"];
    for (const id of order) {
      const render = sections[id];
      if (render) render();
    }

    // Footer de la última página.
    drawControlledDocFooter(doc, { meta: formMeta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
    doc.end();
  });
}
