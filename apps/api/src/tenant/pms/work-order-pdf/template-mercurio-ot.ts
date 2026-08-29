// Orden de trabajo — formulario controlado REGI-OPE-26.3 (rev 0, 29.12.2025).
//
// Renderer puro: recibe un WorkOrderPdfContext ya cargado y devuelve un Buffer.
// Reemplaza a template-mercurio.ts (REGI-MAN-02.4 "Orden Interna de Trabajo"),
// que se conserva para poder volver atrás con un UPDATE de TenantSetting.
//
// Data-driven: el body recorre `ctx.formConfig.sections` (orden e inclusión =
// data del tenant) invocando el catálogo de secciones. Mismo patrón que
// service-request-pdf/template-service-request.ts.
//
// Página 2 del papel (tabla estática de Riesgos/Precauciones) NO se implementa:
// se reemplaza por nuestro bloque de IA (nivel + análisis + LOTO), que es
// específico de la tarea en vez de un listado genérico.

import PDFDocument from "pdfkit";
import {
  makeFormatters, val, statusLabel, riskLabel, woResultLabel, operatingConditionLabel,
  sanitizePdfText, PAGE_H,
  type WorkOrderPdfContext,
} from "./shared";
import {
  FORM_COLORS, FOOTER_H, drawControlledDocHeader, drawControlledDocFooter,
  createFormCanvas, renderRiskMatrix,
} from "../pdf-form-chrome";

const PW       = 595.28;
const ML       = 36;
const MR       = 36;
const W        = PW - ML - MR;
const MARGIN_T = 36;
const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 8;

const { NAVY, WHITE, BLACK, GRAY, BORDER, LIGHT } = FORM_COLORS;

// ── Opciones de los recuadros (literal del papel) ────────────────────────────
const REQUESTED_BY = [
  { v: "CUBIERTA", l: "CUBIERTA" }, { v: "MAQUINAS", l: "MAQUINAS" },
  { v: "TECNICA", l: "TECNICA" },   { v: "OPS_SSMA", l: "OPS / SSMA" },
];
const ASSIGNED_TO = [
  { v: "TRIPULACION", l: "TRIPULACION" }, { v: "TERCERIZADO", l: "TERCERIZADO" },
  { v: "TECNICA", l: "TECNICA" },         { v: "OPS_SSMA", l: "OPS / SSMA" },
];
const SYSTEM_AREAS = [
  { v: "MAQUINAS", l: "MAQUINAS" }, { v: "RE_CUBIERTA", l: "R/E CUBIERTA" }, { v: "BARCAZAS", l: "BARCAZAS" },
];
const MAINT_KINDS = [
  { v: "PREVENTIVO", l: "PREVENTIVO" },
  { v: "CORRECTIVO_PROGRAMADO", l: "CORRECTIVO PROGRAMADO" },
  { v: "CORRECTIVO_NO_PROGRAMADO", l: "CORRECTIVO NO PROGRAMADO" },
  { v: "PREDICTIVO", l: "PREDICTIVO" },
  { v: "EMERGENCIA", l: "EMERGENCIA" },
];
// El papel expresa la prioridad como plazo. Es el mismo eje que WorkOrderPriority
// (no se duplica en el schema): sólo cambia la etiqueta impresa.
const PRIORITIES = [
  { v: "CRITICAL", l: "INMEDIATO" },
  { v: "HIGH",     l: "DENTRO DE LAS 24HS" },
  { v: "MEDIUM",   l: "DENTRO DE LA SEMANA" },
  { v: "LOW",      l: "DENTRO DEL MES" },
];
// Autorizaciones de trabajo: se tildan desde los PermitToWork vinculados a la OT.
const PERMIT_ROWS = [
  { v: "ENCLOSED_SPACE_ENTRY", l: "CONFINADO" },
  { v: "HOT_WORK",             l: "CALIENTE" },
  { v: "ELECTRICAL_ISOLATION", l: "ELECTRICO" },
  { v: "WORKING_ALOFT",        l: "ALTURA" },
  { v: "COLD_WORK",            l: "FRIO" },
];

export async function renderMercurioOtPdf(ctx: WorkOrderPdfContext): Promise<Buffer> {
  const {
    wo, assetLabel, vesselName, assetIsSafetyCritical, assignedName, createdByName,
    tenant, formLogoBuffer, formMeta, formConfig, tenantSlug,
    plannedItems, scheduleRows, permitTypes, serviceRequestCodes, providerNames, planTaskCode,
    spareUsages,
  } = ctx;
  const w = wo as any;
  // Todas las fechas del papel, en la hora de la empresa (ver common/tenant-time).
  const { fmt } = makeFormatters(ctx.tz, ctx.locale);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `OT ${wo.workOrderCode}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const rightInfo = (page: number) =>
      `${formMeta.formCode} — Pagina ${page} — ${wo.workOrderCode} — ${wo.vesselCode} — ${fmt(new Date())}`;

    const canvas = createFormCanvas(doc, {
      ml: ML, w: W, marginT: MARGIN_T, contentBottom: CONTENT_BOTTOM,
      drawFooter: (page) => drawControlledDocFooter(doc, { meta: formMeta, rightInfo: rightInfo(page), x: ML, w: W }),
    });
    const { sectionHeader, cell, textArea, ensureSpace } = canvas;

    // AcroForm: el papel se completa a mano en muchos recuadros; dejamos los
    // checkboxes tildables desde el visor cuando el sistema no tiene el dato.
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

    /**
     * Fila de opciones con casilla. `selected` marca la que corresponde al dato
     * del sistema; el resto queda tildable a mano.
     */
    function optionsRow(opts: { v: string; l: string }[], selected: string[], h = 20) {
      ensureSpace(h);
      doc.rect(ML, canvas.y, W, h).fillColor(WHITE).fill();
      doc.rect(ML, canvas.y, W, h).strokeColor(BORDER).lineWidth(0.4).stroke();
      const cw = Math.floor(W / Math.max(opts.length, 1));
      opts.forEach((o, i) => {
        const cx = ML + i * cw + 6;
        const cy = canvas.y + (h - 9) / 2;
        if (selected.includes(o.v)) drawCheckedBox(cx, cy); else formBox(cx, cy);
        doc.fontSize(7).font("Helvetica-Bold").fillColor(GRAY)
          .text(o.l, cx + 13, cy + 1, { width: cw - 20, lineBreak: false });
      });
      canvas.y += h;
    }

    /**
     * Recuadros de opciones uno al lado del otro, como en el papel: cada uno
     * con su cabecera y las opciones apiladas, con la casilla a la derecha.
     * Así van PRIORIDAD / TIPO DE MANTENIMIENTO / SISTEMA en REGI-OPE-26.3.
     */
    function optionBoxes(
      boxes: Array<{ title: string; opts: { v: string; l: string }[]; selected: string[]; w: number }>,
      rowH = 14,
    ) {
      const headH = 14;
      const maxRows = Math.max(...boxes.map(b => b.opts.length));
      ensureSpace(headH + maxRows * rowH);
      const y0 = canvas.y;
      let cx = ML;
      for (const b of boxes) {
        // Cabecera del recuadro
        cell(cx, y0, b.w, headH, b.title, { bold: true, fontSize: 7, bg: NAVY, color: WHITE, align: "center" });
        // Opciones: etiqueta + casilla al final de la fila
        b.opts.forEach((o, i) => {
          const ry = y0 + headH + i * rowH;
          const boxX = cx + b.w - 16;
          cell(cx, ry, b.w, rowH, "", {});
          doc.fontSize(6.5).font("Helvetica").fillColor(BLACK)
            .text(o.l, cx + 4, ry + (rowH - 6.5) / 2, { width: b.w - 24, lineBreak: false });
          const cy = ry + (rowH - 8) / 2;
          if (b.selected.includes(o.v)) drawCheckedBox(boxX, cy, 8); else formBox(boxX, cy, 8);
        });
        // Relleno para que los tres recuadros cierren a la misma altura
        for (let i = b.opts.length; i < maxRows; i++) {
          cell(cx, y0 + headH + i * rowH, b.w, rowH, "", {});
        }
        cx += b.w;
      }
      canvas.y = y0 + headH + maxRows * rowH;
    }

    /**
     * Tabla de dos columnas etiqueta/valor.
     *
     * La fila crece si algún valor no entra en una línea: una OT de astillero
     * cubre varios ítems del PDM ("LTE-EB-ESPUMA-34 / -51 / -30") y con alto
     * fijo el texto se salía de la celda y se montaba sobre la fila de abajo.
     * Sólo se reparte en varias líneas el valor que lo necesita; los que entran
     * en una siguen centrados verticalmente, alineados con su etiqueta.
     */
    function kvRow(pairs: Array<{ label: string; value: string; lw?: number }>, h = 18) {
      const each = Math.floor(W / pairs.length);
      const geom = pairs.map((p, i) => {
        const lw = p.lw ?? 78;
        return { x: ML + i * each, lw, vw: (i === pairs.length - 1 ? W - i * each : each) - lw };
      });
      const values = pairs.map(p => sanitizePdfText(p.value));
      const needed = values.map((v, i) =>
        canvas.measureCellHeight([v], [geom[i]!.vw], { fontSize: 8, minHeight: h }));
      const rowH = Math.max(h, ...needed);
      ensureSpace(rowH);
      pairs.forEach((p, i) => {
        const g = geom[i]!;
        cell(g.x, canvas.y, g.lw, rowH, p.label, { bold: true, fontSize: 7, bg: NAVY, color: WHITE });
        cell(g.x + g.lw, canvas.y, g.vw, rowH, values[i]!, { fontSize: 8, wrap: needed[i]! > h });
      });
      canvas.y += rowH;
    }

    /** Encabezado de columnas + primera fila de las tablas de items. */
    const ITEMS_TABLE_KEEP = 32;

    /**
     * "DET-YT010-AIRF — Elemento filtro de aire": el código es una referencia
     * de catálogo, no el nombre del repuesto. Va más chico y en gris para que
     * el ojo caiga primero en la descripción, que es lo que se lee a bordo.
     */
    const ITEM_CODE_RE = /^([A-Z0-9][A-Z0-9._/-]{2,})\s+[—–-]\s+(.+)$/;

    /** Celda de DESCRIPCION: separa código y nombre cuando el texto los trae. */
    function itemDescriptionCell(cx: number, cy: number, cw: number, ch: number, text: string) {
      const m = ITEM_CODE_RE.exec(text);
      if (!m) {
        cell(cx, cy, cw, ch, text, { fontSize: 8 });
        return;
      }
      cell(cx, cy, cw, ch, "", {});
      doc.font("Helvetica");
      doc.fontSize(6).fillColor(GRAY)
        .text(`${m[1]} — `, cx + 5, cy + (ch - 8) / 2 + 1.5, { lineBreak: false, continued: true });
      doc.fontSize(8).fillColor(BLACK)
        .text(m[2], { lineBreak: false });
    }

    /**
     * Tabla DESCRIPCION / CANTIDAD del papel. Recibe las filas ya resueltas
     * porque REPUESTOS y MATERIALES salen de fuentes distintas: los repuestos
     * son los realmente consumidos (movimientos de stock de la OT) y los
     * materiales, los previstos en el formulario (no mueven stock).
     */
    function itemsTable(rows: Array<{ description: string; quantity: number; unit: string }>, minRows = 3) {
      const H = 16;
      const qtyW = 90;
      // El encabezado de columnas nunca queda solo al pie: se reserva también
      // el alto de la primera fila.
      ensureSpace(H * 2);
      cell(ML, canvas.y, W - qtyW, H, "DESCRIPCION", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      cell(ML + W - qtyW, canvas.y, qtyW, H, "CANTIDAD", { bold: true, fontSize: 7, bg: LIGHT, color: GRAY, align: "center" });
      canvas.y += H;
      const total = Math.max(rows.length, minRows);
      for (let i = 0; i < total; i++) {
        const r = rows[i];
        ensureSpace(H);
        itemDescriptionCell(ML, canvas.y, W - qtyW, H, r ? sanitizePdfText(r.description) : "");
        cell(ML + W - qtyW, canvas.y, qtyW, H, r ? `${r.quantity} ${r.unit}` : "", { fontSize: 8, align: "center" });
        canvas.y += H;
      }
    }

    // ── HEADER (documento controlado) ───────────────────────────────────────
    const hdrH = drawControlledDocHeader(doc, {
      meta: formMeta,
      logoBuffer: formLogoBuffer,
      tenantName: tenant?.name ?? tenantSlug.toUpperCase(),
      x: ML, y: MARGIN_T, w: W, page: canvas.page,
    });
    canvas.y = MARGIN_T + hdrH + 10;

    const sections: Record<string, () => void> = {
      // UNIDAD / EQUIPO / UBICACION / ITEM DEL PDM / GENERADO POR / CONDICION
      // + NRO DE OT / NRO DE SS-SC / FECHA / ESTADO / NRO DE VIAJE
      header: () => {
        const assetText = assetIsSafetyCritical ? `${assetLabel}  [ISM 10.3]` : assetLabel;
        kvRow([
          { label: label("unidad", "UNIDAD"), value: vesselName ?? wo.vesselCode ?? "" },
          { label: label("nroOt", "NRO DE OT"), value: wo.workOrderCode ?? "" },
        ]);
        kvRow([
          { label: label("equipo", "EQUIPO"), value: assetText },
          // La SC la maneja otra app: se imprimen sólo las SS de esta OT.
          { label: label("nroSsSc", "NRO DE SS/SC"), value: serviceRequestCodes.join(", ") },
        ]);
        kvRow([
          { label: label("ubicacion", "UBICACION"), value: w.location ?? "" },
          { label: label("fecha", "FECHA"), value: fmt(wo.openDate) },
        ]);
        kvRow([
          { label: label("itemPdm", "ITEM DEL PDM"), value: planTaskCode ?? "" },
          { label: label("estadoOt", "ESTADO DE OT"), value: statusLabel(String(wo.status)) },
        ]);
        kvRow([
          { label: label("generadoPor", "GENERADO POR"), value: ctx.createdByFormName ?? createdByName ?? "" },
          { label: label("nroViaje", "NRO DE VIAJE"), value: w.voyageNumber ?? "" },
        ]);
        // CONDICION: en qué situación estaba el buque cuando se hizo el trabajo.
        // Va sola y a lo ancho porque en papel se completa a mano si viene vacía.
        kvRow([
          {
            label: label("condicion", "CONDICION"),
            value: operatingConditionLabel(w.operatingCondition),
          },
        ]);
        canvas.y += 8;
      },

      requestedBy: () => {
        sectionHeader(label("requestedBy", "SOLICITADO POR"), 18, 20);
        optionsRow(REQUESTED_BY, w.requestedByArea ? [String(w.requestedByArea)] : []);
      },

      assignedTo: () => {
        sectionHeader(label("assignedTo", "ASIGNADO A"), 18, 20);
        optionsRow(ASSIGNED_TO, w.assignedToArea ? [String(w.assignedToArea)] : []);
        if (assignedName) {
          kvRow([{ label: label("tecnico", "TECNICO"), value: assignedName, lw: 60 }]);
        }
        // Quién hace el trabajo cuando es tercerizado: el taller de la OT y los
        // de sus SS. Sin esto el papel decía "TERCERIZADO" sin decir a quién.
        if (providerNames.length > 0) {
          kvRow([{ label: label("proveedor", "PROVEEDOR"), value: providerNames.join(", "), lw: 60 }]);
        }
      },

      // PRIORIDAD / TIPO DE MANTENIMIENTO / SISTEMA — los tres uno al lado del
      // otro, como en el papel. El del medio lleva los textos más largos.
      priorityKindSystem: () => {
        canvas.y += 6;
        // Si la OT es anterior al formulario no tiene maintenanceKind; se deriva
        // del type grueso para no dejar el recuadro vacío.
        const kind = w.maintenanceKind
          ?? (wo.type === "PREVENTIVE" ? "PREVENTIVO" : wo.type === "CORRECTIVE" ? "CORRECTIVO_NO_PROGRAMADO" : null);
        const wPrio = Math.floor(W * 0.31);
        const wKind = Math.floor(W * 0.38);
        optionBoxes([
          { title: label("prioridad", "PRIORIDAD"),        opts: PRIORITIES,   selected: wo.priority ? [String(wo.priority)] : [], w: wPrio },
          { title: label("tipoMant", "TIPO DE MANTENIMIENTO"), opts: MAINT_KINDS, selected: kind ? [String(kind)] : [],           w: wKind },
          { title: label("sistema", "SISTEMA"),            opts: SYSTEM_AREAS, selected: w.systemArea ? [String(w.systemArea)] : [], w: W - wPrio - wKind },
        ]);
        canvas.y += 6;
      },

      // "Completo correctamente la autorizacion de trabajo correspondiente a las
      // tareas de:" — se tilda con los permisos de trabajo vinculados a la OT.
      permits: () => {
        sectionHeader(label("permits", "AUTORIZACION DE TRABAJO"), 18, 16);
        ensureSpace(16);
        doc.fontSize(7).font("Helvetica").fillColor(GRAY)
          .text("Completo correctamente la autorizacion de trabajo correspondiente a las tareas de:",
            ML + 4, canvas.y + 3, { width: W - 8, lineBreak: false });
        canvas.y += 14;
        optionsRow(PERMIT_ROWS, permitTypes);
      },

      request: () => {
        sectionHeader(label("request", "SOLICITUD / FALLA"), 18, 44);
        ensureSpace(44);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(w.description ?? ""), 44);
      },

      // TAREA = qué hay que hacer (título) + cómo se sabe que quedó bien
      // (criterios de aceptación). Van juntos porque el papel tiene un solo
      // recuadro, pero el segundo lleva rótulo: sin él se leían como un bloque
      // corrido y no se distinguía la tarea de su detalle.
      task: () => {
        sectionHeader(label("task", "TAREA"), 18, 40);
        ensureSpace(40);
        const tarea = [
          w.title,
          w.acceptanceCriteria ? `${label("taskDetail", "Detalle:")}\n${w.acceptanceCriteria}` : null,
        ].filter(Boolean).join("\n");
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(tarea), 40);
      },

      // ITEMS_TABLE_KEEP = encabezado de columnas (16) + primera fila (16): es
      // lo mínimo que tiene que entrar debajo de la barra para que el título no
      // quede huérfano al pie de la página.
      /**
       * REPUESTOS: manda lo realmente consumido (movimientos de stock de la
       * OT), porque el papel de una OT ejecutada documenta el trabajo hecho.
       *
       * Si todavía no se consumió nada, se imprimen los PREVISTOS del
       * formulario: una OT que sale a ejecutarse tiene que llevar la lista de
       * lo que hay que usar. Sin este respaldo el recuadro salía vacío aunque
       * la sección 8 estuviera cargada, y no se entendía por qué.
       */
      spares: () => {
        sectionHeader(label("spares", "REPUESTOS"), 18, ITEMS_TABLE_KEEP);
        const used = spareUsages.map(s => ({
          description: s.spareName, quantity: s.quantity, unit: s.unit,
        }));
        itemsTable(used.length > 0 ? used : plannedItems.filter(i => i.kind === "SPARE"));
      },

      // MATERIALES no mueven stock (grasa, trapos, sellador…): se imprimen los
      // cargados en el formulario.
      materials: () => {
        sectionHeader(label("materials", "MATERIALES"), 18, ITEMS_TABLE_KEEP);
        itemsTable(plannedItems.filter(i => i.kind === "MATERIAL"));
      },

      // PROGRAMACION DE TRABAJO: fechas + filas fecha/técnico/lugar/empresa/horario
      schedule: () => {
        // Debajo de la barra van: fila de fechas (20) + encabezado de columnas
        // (16) + primera jornada (16). Si no entra todo, la sección arranca en
        // la página siguiente en vez de partirse.
        sectionHeader(label("schedule", "PROGRAMACION DE TRABAJO"), 18, 52);
        // "FECHA FINALIZACION" no entra en el ancho de etiqueta por defecto (78):
        // se encimaba con el borde. Ambas columnas usan el ancho de la más larga.
        // FECHA FINALIZACION es la fecha en que el trabajo TERMINÓ. Antes salía
        // el vencimiento de la OT: con una OT cerrada el papel decía que había
        // terminado en una fecha futura. Mientras siga abierta se muestra el
        // vencimiento, que es la finalización prevista.
        kvRow([
          { label: label("fechaInicio", "FECHA INICIO"), value: w.startDate ? fmt(w.startDate) : "", lw: 104 },
          { label: label("fechaFin", "FECHA FINALIZACION"), value: w.completedDate ? fmt(w.completedDate) : (w.dueDate ? fmt(w.dueDate) : ""), lw: 104 },
        ], 20);
        const H = 16;
        const cols = [
          { l: "FECHA", w: 70 }, { l: "TECNICO ASIGNADO", w: 160 }, { l: "LUGAR", w: 110 },
          { l: "EMPRESA", w: 110 },
        ];
        const usedW = cols.reduce((a, c) => a + c.w, 0);
        cols.push({ l: "HORARIO", w: W - usedW });
        // Igual que en las tablas de items: el encabezado de columnas no se
        // dibuja si no entra también la primera jornada debajo.
        ensureSpace(H * 2);
        let cx = ML;
        cols.forEach(c => { cell(cx, canvas.y, c.w, H, c.l, { bold: true, fontSize: 6.5, bg: LIGHT, color: GRAY, align: "center" }); cx += c.w; });
        canvas.y += H;
        const total = Math.max(scheduleRows.length, 3);
        const widths = cols.map(c => c.w);
        for (let i = 0; i < total; i++) {
          const r = scheduleRows[i];
          const vals = r
            ? [r.date ? fmt(r.date) : "", r.technician, r.place, r.company, r.time]
            : ["", "", "", "", ""];
          const texts = vals.map(v => sanitizePdfText(v ?? ""));
          // Alto variable: un lugar largo ("Asunción KM 1634 Rio Paraguay") no
          // entraba en 16pt y el texto se montaba sobre el borde de la fila.
          // Se mide la celda más alta y la fila crece; las vacías siguen en 16.
          const rowH = canvas.measureCellHeight(texts, widths, { fontSize: 7.5, minHeight: H });
          ensureSpace(rowH);
          cx = ML;
          cols.forEach((c, j) => { cell(cx, canvas.y, c.w, rowH, texts[j] ?? "", { fontSize: 7.5, wrap: true }); cx += c.w; });
          canvas.y += rowH;
        }
      },

      // TAREA CONCLUIDA? SI / NO
      completion: () => {
        const H = 20;
        ensureSpace(H);
        const LBL = 130;
        cell(ML, canvas.y, LBL, H, label("taskCompleted", "TAREA CONCLUIDA?"), { bold: true, fontSize: 8, bg: NAVY, color: WHITE });
        const rest = W - LBL;
        const half = Math.floor(rest / 2);
        // El sistema conoce la respuesta si la OT está cerrada con resultado.
        const done = w.taskCompleted === true || (wo.status === "CLOSED" && !!w.woResult);
        const notDone = w.taskCompleted === false;
        [["SI", done], ["NO", notDone]].forEach(([lab, on], i) => {
          const x = ML + LBL + i * half;
          const cw = i === 0 ? half : rest - half;
          doc.rect(x, canvas.y, cw, H).fillColor(WHITE).fill();
          doc.rect(x, canvas.y, cw, H).strokeColor(BORDER).lineWidth(0.4).stroke();
          const bx = x + 8, by = canvas.y + (H - 9) / 2;
          if (on) drawCheckedBox(bx, by); else formBox(bx, by);
          doc.fontSize(8).font("Helvetica-Bold").fillColor(BLACK)
            .text(String(lab), bx + 14, by + 1, { lineBreak: false });
        });
        canvas.y += H;
        if (w.woResult) {
          kvRow([{ label: label("resultado", "RESULTADO"), value: woResultLabel(w.woResult) }]);
        }
      },

      pending: () => {
        sectionHeader(label("pending", "DETALLE DE PENDIENTES (MATERIALES/TAREAS)"), 18, 44);
        ensureSpace(44);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(w.pendingDetail ?? ""), 44);
      },

      /**
       * NIVEL DE RIESGO — en la OT misma. El resultado del análisis y el LOTO NO
       * van acá: se imprimen en un anexo aparte (ver `riskAnnex`), porque son
       * textos largos que hacían crecer la OT sin control.
       *
       * La matriz va SIEMPRE: la página 2 del papel era justamente una tabla de
       * riesgos, así que sirve como referencia aunque no se resalte nada. Los
       * ejes (probabilidad × consecuencia) salen del PLAN, no de la OT — cuando
       * no hay plan o el plan no los tiene, renderRiskMatrix dibuja la grilla
       * limpia. Hoy sólo ~313 de 1308 OT pueden resaltar su celda.
       */
      risk: () => {
        sectionHeader(label("risk", "NIVEL DE RIESGO"), 18, 20);
        ensureSpace(20);
        kvRow([{ label: "NIVEL", value: riskLabel(w.riskLevel), lw: 60 }]);
        renderRiskMatrix(doc, canvas, ML, W, ctx.riskProbability, ctx.riskConsequence);
        ensureSpace(16);
        doc.fontSize(7.5).font("Helvetica-Bold").fillColor(BLACK)
          .text(label("riskAnnexNote", "Ver adjunto el resultado del Analisis de Riesgo y LOTO."),
            ML, canvas.y + 4, { width: W, align: "center", lineBreak: false });
        canvas.y += 16;
        ensureSpace(14);
        doc.fontSize(6.5).font("Helvetica-Oblique").fillColor(GRAY)
          .text("ANTES DE COMENZAR LA TAREA, REALICE UN ANALISIS PRELIMINAR DE RIESGOS Y TOME LAS MEDIDAS NECESARIAS PARA CADA CASO.",
            ML, canvas.y + 3, { width: W, align: "center", lineBreak: false });
        canvas.y += 14;
      },

      /**
       * ANEXO — ANALISIS DE RIESGO Y LOTO. Hoja aparte, a propósito: se entrega
       * y se archiva suelta de la OT. Por eso lleva su propia identificación —
       * la cabecera del documento controlado sólo se dibuja en la primera página
       * (pageBreak no la repite), y sin esto el anexo suelto no se sabría de qué
       * OT es.
       *
       * Se imprime SIEMPRE, aunque esté vacío: la OT remite a él ("ver adjunto")
       * y el análisis previo es obligatorio — en blanco queda para llenarlo a
       * mano, igual que el resto de los recuadros del papel.
       */
      riskAnnex: () => {
        canvas.pageBreak();

        const H = 18;
        doc.rect(ML, canvas.y, W, 22).fillColor(NAVY).fill();
        doc.fontSize(10).font("Helvetica-Bold").fillColor(WHITE)
          .text(label("riskAnnexTitle", "ANEXO — ANALISIS DE RIESGO Y LOTO"),
            ML + 6, canvas.y + 6, { width: W - 12, align: "center", lineBreak: false });
        canvas.y += 22;

        // Identificación: de qué OT es este anexo.
        const half = Math.floor(W / 2);
        const idRows: Array<[string, string, string, string]> = [
          ["ORDEN DE TRABAJO", String(w.workOrderCode ?? ""), "UNIDAD", ctx.vesselName ?? String(w.vesselCode ?? "")],
          ["EQUIPO", assetLabel, "FECHA", fmt(w.openDate)],
        ];
        for (const [l1, v1, l2, v2] of idRows) {
          ensureSpace(H);
          cell(ML, canvas.y, 96, H, l1, { bold: true, fontSize: 7, bg: NAVY, color: WHITE });
          cell(ML + 96, canvas.y, half - 96, H, sanitizePdfText(v1), { fontSize: 8 });
          cell(ML + half, canvas.y, 60, H, l2, { bold: true, fontSize: 7, bg: NAVY, color: WHITE });
          cell(ML + half + 60, canvas.y, W - half - 60, H, sanitizePdfText(v2), { fontSize: 8 });
          canvas.y += H;
        }
        canvas.y += 6;

        sectionHeader(label("riskResult", "RESULTADO DEL ANALISIS DE RIESGO"), 18, 44);
        ensureSpace(44);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(w.riskAnalysisResult ?? ""), 44);

        sectionHeader(label("loto", "LOTO (LOCKOUT / TAGOUT)"), 18, 32);
        ensureSpace(32);
        canvas.y += textArea(ML, canvas.y, W, sanitizePdfText(w.loto ?? ""), 32);
      },

      // FIRMA Y ACLARACION DEL SOLICITANTE / DEL ASIGNADO
      signatures: () => {
        // Firma al 300%: el recuadro crece para alojar la firma agrandada sin
        // pisar el nombre / la línea / el rótulo (que se posicionan relativos a H).
        const SIG_W = 210, SIG_H = 78; // 3× el tamaño anterior (70×26)
        // La calificación del firmante (TMSA: representante calificado y con
        // experiencia) va sobre el nombre. Sólo si alguno de los dos la tiene
        // cargada se agranda el recuadro: las OT sin el dato quedan igual.
        const qual: Array<string | null | undefined> = [ctx.createdByQualification, ctx.assignedQualification];
        const hasQual = qual.some(q => Boolean(q && q.trim()));
        const H = hasQual ? 128 : 116;
        ensureSpace(H + 10);
        const half = Math.floor(W / 2);
        const boxes: Array<[string, string | null, Buffer | null | undefined]> = [
          ["FIRMA Y ACLARACION DEL SOLICITANTE", ctx.createdByFormName ?? createdByName, ctx.solicitaSignatureBuffer],
          ["FIRMA Y ACLARACION DEL ASIGNADO", ctx.assignedFormName ?? assignedName, ctx.assignedSignatureBuffer],
        ];
        boxes.forEach(([lab, name, sig], i) => {
          const bx = ML + i * half;
          const bw = i === 0 ? half : W - half;
          doc.rect(bx, canvas.y, bw, H).fillColor(WHITE).fill();
          doc.rect(bx, canvas.y, bw, H).strokeColor(BORDER).lineWidth(0.5).stroke();
          if (sig) {
            try { doc.image(sig, bx + bw / 2 - SIG_W / 2, canvas.y + 6, { fit: [SIG_W, SIG_H], align: "center", valign: "center" }); } catch { /* skip */ }
          }
          if (name) {
            doc.fontSize(8).font("Helvetica").fillColor(BLACK)
              .text(sanitizePdfText(name), bx + 8, canvas.y + H - 26, { width: bw - 16, lineBreak: false });
          }
          const q = qual[i];
          if (q && q.trim()) {
            doc.fontSize(6).font("Helvetica").fillColor(GRAY)
              .text(sanitizePdfText(q), bx + 8, canvas.y + H - 36, { width: bw - 16, lineBreak: false });
          }
          doc.moveTo(bx + 10, canvas.y + H - 14).lineTo(bx + bw - 10, canvas.y + H - 14)
            .strokeColor("#aaaaaa").lineWidth(0.8).stroke();
          doc.fontSize(6).font("Helvetica-Bold").fillColor(GRAY)
            .text(lab, bx + 6, canvas.y + H - 10, { width: bw - 12, align: "center", lineBreak: false });
        });
        canvas.y += H;
      },
    };

    // Aire entre secciones: sin esto los recuadros quedan pegados y la barra
    // azul de una sección parece el pie de la anterior. No va antes de la
    // primera. Si el hueco no entra, la sección rompe página por su cuenta
    // (ensureSpace) y el margen superior separa igual.
    const SECTION_GAP = 6;
    const order = formConfig.sections.length ? formConfig.sections : Object.keys(sections);
    let drawn = 0;
    for (const id of order) {
      const fn = sections[id];
      if (!fn) continue;
      if (drawn > 0) canvas.y += SECTION_GAP;
      fn();
      drawn++;
    }

    drawControlledDocFooter(doc, { meta: formMeta, rightInfo: rightInfo(canvas.page), x: ML, w: W });
    doc.end();
  });
}
