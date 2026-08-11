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
  HEADER_ROLES, PPE_HEADER, ES_SECTION_1, ES_SECTION_1_TITLE, ES_SECTION_2,
  ES_SECTION_2_TITLE, ES_SIGNERS, ES_SECTION_3_TITLE, ES_SECTION_3_TEXT,
  ES_SECTION_3_SIGN, ES_INVALID_WARNING, ES_NOTES, ES_GAS_BLOCK_TITLE,
  ES_GAS_BLOCK_NOTE, ES_GAS_READINGS, ES_GAS_BLOCK_FOOTNOTE,
} from "./mercurio-permit-forms";
import {
  blank, isAuthorized, PERMIT_ROLE_LABEL, PERMIT_STATUS_LABEL,
  type PermitPdfContext, type PermitGasTest,
} from "./shared";

const PW       = 595.28;
const PAGE_H   = 841.89;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const { NAVY, WHITE, BLACK, GRAY, BORDER, LIGHT } = FORM_COLORS;

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

  // Ventana autorizada: al aprobar, el sistema cae a la ventana planificada.
  const validFrom = permit.validFrom ?? permit.plannedStart;
  const validTo   = permit.validTo   ?? permit.plannedEnd;

  // Quién ejecuta y quién supervisa. Los roles de apoyo (vigía, stand-by,
  // atendente) van con los ejecutantes, aclarando el rol: el papel no tiene
  // recuadro propio para ellos y perderlos sería perder información real.
  const supervisors = permit.participants.filter(p => p.role === "SUPERVISOR");
  const performers  = permit.participants
    .filter(p => p.role !== "SUPERVISOR")
    .map(p => (p.role === "PERFORMER" ? p.name : `${p.name} (${PERMIT_ROLE_LABEL[p.role] ?? p.role})`));

  const lastGas: PermitGasTest | null = permit.gasTests[0] ?? null; // vienen desc por testedAt
  const gasTesters = Array.from(new Set(permit.gasTests.map(g => g.testedByName).filter(Boolean)));
  const gasReading = (key: "o2" | "lel" | "h2s" | "co" | null): string => {
    if (!key || !lastGas) return "";
    const v = key === "o2" ? lastGas.o2Pct : key === "lel" ? lastGas.lelPct : key === "h2s" ? lastGas.h2sPpm : lastGas.coPpm;
    if (v === null || v === undefined) return "";
    return key === "o2" ? v.toFixed(1) : key === "lel" ? v.toFixed(2) : v.toFixed(0);
  };

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
        peopleBlock(label("supervisors", "QUIEN SUPERVISARA EL TRABAJO"), supervisors.map(s => s.name), 2);
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
          { role: "SUPERVISOR", name: supervisors[0]?.name ?? "" },
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

      // ── REGI-SYE-01.4 (formato IMO) ──
      esGeneral: () => {
        secHeader(label("esGeneral", "GENERAL"), 54);
        kvRow([{ label: "LOCALIZACION / NOMBRE DEL ESPACIO CERRADO", value: permit.location, lw: 220 }]);
        kvRow([{ label: "MOTIVO DE LA ENTRADA", value: permit.description, lw: 220 }]);
        kvRow([
          { label: "VALIDO DESDE", value: `${fDate(validFrom)}  ${fTime(validFrom)}`, lw: 80 },
          { label: "HASTA (ver nota 1)", value: `${fDate(validTo)}  ${fTime(validTo)}`, lw: 90 },
        ]);
        canvas.y += 6;
      },

      esSection1: () => {
        secHeader(ES_SECTION_1_TITLE, 34);
        checklistTable(ES_SECTION_1, false);
        // Contraste del multigas + lecturas con sus límites (literal del papel).
        secHeader(ES_GAS_BLOCK_TITLE, 40);
        canvas.y += textArea(ML, canvas.y, W, ES_GAS_BLOCK_NOTE, 22);
        const wLbl = Math.floor(W * 0.45), wLim = Math.floor(W * 0.3);
        blankTable(
          ["LECTURA", "LIMITE", "VALOR"],
          [wLbl, wLim, W - wLbl - wLim],
          ES_GAS_READINGS.map(r => [r.label, r.limit, gasReading(r.reading)]),
          ES_GAS_READINGS.length,
        );
        canvas.y += textArea(ML, canvas.y, W, ES_GAS_BLOCK_FOOTNOTE, 24);
        canvas.y += 6;
      },

      esSection2: () => {
        secHeader(ES_SECTION_2_TITLE, 34);
        checklistTable(ES_SECTION_2, false);
        canvas.y += 6;
      },

      esSignatures: () => {
        secHeader(label("esSignatures", "PARA SER FIRMADO POR"), 34);
        const wRole = Math.floor(W * 0.42);
        const wName = Math.floor(W * 0.33);
        const H = 24;
        const firmantes = [
          ES_SIGNERS[0],
          ES_SIGNERS[1],
          ES_SIGNERS[2],
        ];
        ensureSpace(14 + H * firmantes.length);
        cell(ML, canvas.y, wRole, 14, "", { noStroke: true });
        cell(ML + wRole, canvas.y, wName, 14, "NOMBRE Y FIRMA", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
        cell(ML + wRole + wName, canvas.y, W - wRole - wName, 14, "FECHA Y HORA", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
        canvas.y += 14;
        firmantes.forEach(f => {
          ensureSpace(H);
          cell(ML, canvas.y, wRole, H, S(f), { fontSize: 7.5, bg: LIGHT, color: GRAY, wrap: true });
          cell(ML + wRole, canvas.y, wName, H, "", {});
          cell(ML + wRole + wName, canvas.y, W - wRole - wName, H, "", {});
          canvas.y += H;
        });
        canvas.y += 6;
      },

      esSection3: () => {
        secHeader(ES_SECTION_3_TITLE, 40);
        canvas.y += textArea(ML, canvas.y, W, `${ES_SECTION_3_TEXT}\n${ES_SECTION_3_SIGN}`, 34);
        const third = Math.floor(W / 3);
        blankTable(["FIRMA DEL RESPONSABLE", "ACLARACION", "FECHA Y HORA"], [third, third, W - 2 * third], [], 1, 28);
        canvas.y += 4;
        canvas.y += textArea(ML, canvas.y, W, ES_INVALID_WARNING, 24);
        canvas.y += 6;
      },

      esNotes: () => {
        secHeader(label("esNotes", "NOTAS"), 40);
        canvas.y += textArea(ML, canvas.y, W, ES_NOTES.join("\n"), 40);
        canvas.y += 6;
      },

      esEntryLog: () => {
        secHeader(label("esEntryLog", "REGISTRO DE PERSONAS QUE INGRESARON AL ESPACIO CERRADO"), 34);
        const wN = 30, wName = Math.floor(W * 0.42), wIn = 80, wOut = 80;
        blankTable(
          ["N°", "NOMBRE Y APELLIDO", "HORA / INGRESO", "HORA / SALIDA", "FIRMA"],
          [wN, wName, wIn, wOut, W - wN - wName - wIn - wOut],
          performers.map((n, i) => [String(i + 1), n, "", "", ""]),
          6,
        );
        blankBox(label("esObs", "OBSERVACIONES"), 26);
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
