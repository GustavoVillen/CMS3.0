// Formulario de Orden de Trabajo dibujado como el papel (REGI-OPE-26.3).
//
// La pantalla de la OT ES el formulario: mismas secciones, en el mismo orden,
// con las mismas etiquetas que imprime el PDF. El orden y los rótulos NO se
// hardcodean acá: vienen de `GET /app/pms/work-orders/form`, que resuelve la
// definición del tenant — la misma que usa `work-order-pdf/template-mercurio-ot.ts`.
//
// Los ids de sección son los del catálogo del PDF. No renombrarlos sin migrar
// TenantForm.config.
//
// Los editores que ya existían (programación de trabajo, repuestos previstos,
// matriz de riesgo, resultado…) entran por slot: la hoja pone el marco y el
// rótulo, ellos ponen el contenido. Así el papel no duplica lógica que ya vive
// en su propio componente.

import React from "react";
import {
  PaperSheet, PaperBar, PaperRow, PaperLabelCell, PaperValueCell, PaperTextArea,
  PaperCheckRow, PaperOptionBox, PaperSignColumn, PaperDocHeader, PaperDocFooter,
  PaperBox, paperFieldCls, type PaperDocMeta,
} from "../paper/PaperKit";
import {
  WO_REQUESTED_BY, WO_ASSIGNED_TO, WO_SYSTEM_AREAS,
  WO_MAINTENANCE_KINDS_OR_INSPECTION, WO_PRIORITY_OPTIONS, WO_OPERATING_CONDITIONS,
} from "../../lib/wo-form-catalog";
import { useT, type TranslationKey } from "../../lib/i18n";

// ---------------------------------------------------------------------------
// Definición del formulario (espejo de FormConfig/ControlledDocMeta del backend)
// ---------------------------------------------------------------------------

export interface WoFormConfig {
  sections: string[];
  labels: Record<string, string>;
}

export interface WoFormDoc {
  meta: PaperDocMeta;
  config: WoFormConfig;
  /** Logo propio del formulario (el mismo que estampa el PDF), si el tenant lo cargó. */
  logoUrl?: string | null;
}

/** Si el endpoint no responde, la hoja se dibuja igual con el default Mercurio. */
export const WO_FORM_FALLBACK: WoFormDoc = {
  meta: {
    formCode: "REGI-OPE-26.3", title: "Orden de trabajo", revision: 0,
    effectiveFrom: "29.12.2025",
    preparedBy: "Mercurio Group", reviewedBy: "Persona Designada en Tierra", approvedBy: "Gerente General",
  },
  config: {
    sections: [
      "header", "requestedBy", "assignedTo", "priorityKindSystem", "permits",
      "request", "task", "spares", "materials", "schedule", "completion",
      "pending", "risk", "signatures", "riskAnnex",
    ],
    labels: {},
  },
};

/** Rótulos por defecto — los mismos textos del papel. */
const DEFAULT_LABELS: Record<string, string> = {
  unidad: "UNIDAD",
  nroOt: "NRO DE OT",
  equipo: "EQUIPO",
  nroSsSc: "NRO DE SS/SC",
  ubicacion: "UBICACION",
  fecha: "FECHA",
  itemPdm: "ITEM DEL PDM",
  estadoOt: "ESTADO DE OT",
  generadoPor: "GENERADO POR",
  nroViaje: "NRO DE VIAJE",
  // No está en el papel: evidencia TMSA de si el trabajo se hizo navegando.
  condicion: "CONDICION",
  requestedBy: "SOLICITADO POR",
  assignedTo: "ASIGNADO A",
  tecnico: "TECNICO",
  proveedor: "PROVEEDOR",
  prioridad: "PRIORIDAD",
  tipoMant: "TIPO DE MANTENIMIENTO",
  sistema: "SISTEMA",
  permits: "AUTORIZACION DE TRABAJO",
  request: "TRABAJO SOLICITADO",
  task: "TAREA",
  taskDetail: "Detalle:",
  spares: "REPUESTOS",
  materials: "MATERIALES",
  schedule: "PROGRAMACION DE TRABAJO",
  fechaInicio: "FECHA INICIO",
  fechaFin: "FECHA FINALIZACION",
  taskCompleted: "TAREA CONCLUIDA?",
  resultado: "RESULTADO",
  pending: "DETALLE DE PENDIENTES (MATERIALES/TAREAS)",
  risk: "NIVEL DE RIESGO",
  riskAnnexTitle: "ANEXO — ANALISIS DE RIESGO Y LOTO",
  riskResult: "RESULTADO DEL ANALISIS DE RIESGO",
  loto: "LOTO (LOCKOUT / TAGOUT)",
};

/** Lo que se completa en la hoja. El resto entra por slot. */
export interface WoPaperValues {
  voyageNumber: string;
  /** CONDICION del buque al hacer el trabajo (evidencia TMSA de navegación). */
  operatingCondition: string;
  location: string;
  requestedByArea: string;
  assignedToArea: string;
  priority: string;
  /** Recuadro TIPO DE MANTENIMIENTO: los 5 finos + "Inspección" (que es `type`). */
  maintenanceKind: string;
  type: string;
  systemArea: string;
  /** TRABAJO SOLICITADO */
  description: string;
  /** TAREA + su detalle (criterios de aceptación). */
  title: string;
  acceptanceCriteria: string;
  taskCompleted: "" | "YES" | "NO";
  woResult: string;
  pendingDetail: string;
  riskLevel: string;
  riskAnalysisResult: string;
  loto: string;
}

export interface WoPaperHeader {
  /** Nombre del buque, nunca el código (ver CLAUDE.md "Nombres, no códigos"). */
  vesselName: string;
  workOrderCode: string;
  assetLabel: string;
  /** Códigos de las SS abiertas desde esta OT. */
  serviceRequestCodes: string[];
  openDate: string;
  planItemCode: string;
  statusLabel: string;
  createdByName: string;
}

export function WoPaperForm({
  meta, config, logoUrl, tenantName,
  header, values, onChange, editable, resultEditable, autosave,
  fecha, tecnico, proveedor, permits, spares, materials, schedule, resultExtras, riskMatrix,
  signatures,
}: {
  meta: PaperDocMeta;
  config: WoFormConfig;
  logoUrl: string | null;
  tenantName: string;
  header: WoPaperHeader;
  values: WoPaperValues;
  onChange: (patch: Partial<WoPaperValues>) => void;
  editable: boolean;
  /** Lo que sólo se completa con la OT ya aprobada (ejecución y cierre). */
  resultEditable: boolean;
  /** Estado del auto-guardado de la hoja: es la única señal de que se guardó. */
  autosave?: { saving?: boolean; saved?: boolean; error?: string | null };
  /** FECHA del encabezado: editable (es la fecha de apertura de la OT). */
  fecha?: React.ReactNode;
  /** TECNICO del recuadro ASIGNADO A (el selector de tripulación que ya existía). */
  tecnico: React.ReactNode;
  /** PROVEEDOR: sólo cuando el trabajo se terceriza. */
  proveedor?: React.ReactNode;
  /** Permisos de trabajo vinculados. */
  permits?: React.ReactNode;
  spares?: React.ReactNode;
  materials?: React.ReactNode;
  schedule?: React.ReactNode;
  /** Deficiencias, ejecutado por, fecha, horas, repuestos usados, observaciones. */
  resultExtras?: React.ReactNode;
  /** Matriz probabilidad × consecuencia (misma que imprime el papel). */
  riskMatrix?: React.ReactNode;
  signatures: {
    solicitante: { name: string | null; signatureUrl?: string | null };
    asignado: { name: string | null; signatureUrl?: string | null };
  };
}) {
  const label = (id: string) => config.labels[id] ?? DEFAULT_LABELS[id] ?? id;
  const dis = !editable;
  // Los rótulos del papel van literales (documento controlado); las opciones de
  // CONDICION, que no están en el papel, sí pasan por i18n.
  const t = useT();

  /** Fila de dos pares etiqueta/valor, como el encabezado del papel. */
  const kvRow = (
    l1: string, v1: React.ReactNode,
    l2: string, v2: React.ReactNode,
  ) => (
    <PaperRow>
      <PaperLabelCell className="w-32 shrink-0">{l1}</PaperLabelCell>
      <PaperValueCell className="flex-1">{v1}</PaperValueCell>
      <PaperLabelCell className="w-32 shrink-0">{l2}</PaperLabelCell>
      <PaperValueCell className="w-56 shrink-0">{v2}</PaperValueCell>
    </PaperRow>
  );

  const sections: Record<string, () => React.ReactNode> = {
    header: () => (
      <>
        {kvRow(
          label("unidad"), <span className="font-semibold">{header.vesselName}</span>,
          label("nroOt"), <span className="font-mono font-bold text-accent">{header.workOrderCode}</span>,
        )}
        {kvRow(
          label("equipo"), header.assetLabel || "—",
          label("nroSsSc"), header.serviceRequestCodes.length
            ? <span className="font-mono text-[12px]">{header.serviceRequestCodes.join(", ")}</span>
            : "",
        )}
        {kvRow(
          label("ubicacion"),
          <input
            className={paperFieldCls}
            value={values.location}
            disabled={dis}
            onChange={e => onChange({ location: e.target.value })}
            placeholder="Ciudad / Km…"
          />,
          label("fecha"), fecha ?? header.openDate,
        )}
        {kvRow(
          label("itemPdm"), header.planItemCode || "",
          label("estadoOt"), header.statusLabel,
        )}
        {kvRow(
          label("generadoPor"), header.createdByName || "",
          label("nroViaje"),
          <input
            className={paperFieldCls}
            value={values.voyageNumber}
            disabled={dis}
            onChange={e => onChange({ voyageNumber: e.target.value })}
            placeholder="Ej. V-2026-014"
          />,
        )}
        {/* CONDICION — en qué situación estaba el buque cuando se hizo el
            trabajo. Va a lo ancho porque no tiene par en el papel. */}
        <PaperRow>
          <PaperLabelCell className="w-32 shrink-0">{label("condicion")}</PaperLabelCell>
          <PaperValueCell className="flex-1">
            <select
              className={paperFieldCls}
              value={values.operatingCondition}
              disabled={dis}
              onChange={e => onChange({ operatingCondition: e.target.value })}
            >
              <option value="">—</option>
              {WO_OPERATING_CONDITIONS.map(c => (
                <option key={c} value={c}>{t(`wo.condition.${c}` as TranslationKey)}</option>
              ))}
            </select>
          </PaperValueCell>
        </PaperRow>
      </>
    ),

    requestedBy: () => (
      <>
        <PaperBar title={label("requestedBy")} />
        <PaperCheckRow
          options={WO_REQUESTED_BY}
          selected={values.requestedByArea ? [values.requestedByArea] : []}
          disabled={dis}
          onToggle={v => onChange({ requestedByArea: values.requestedByArea === v ? "" : v })}
        />
      </>
    ),

    assignedTo: () => (
      <>
        <PaperBar title={label("assignedTo")} />
        <PaperCheckRow
          options={WO_ASSIGNED_TO}
          selected={values.assignedToArea ? [values.assignedToArea] : []}
          disabled={dis}
          onToggle={v => onChange({ assignedToArea: values.assignedToArea === v ? "" : v })}
        />
        <PaperRow>
          <PaperLabelCell className="w-32 shrink-0">{label("tecnico")}</PaperLabelCell>
          <PaperValueCell className="flex-1">{tecnico}</PaperValueCell>
        </PaperRow>
        {/* El taller sólo se pide cuando el trabajo se terceriza. */}
        {proveedor && (
          <PaperRow>
            <PaperLabelCell className="w-32 shrink-0">{label("proveedor")}</PaperLabelCell>
            <PaperValueCell className="flex-1">{proveedor}</PaperValueCell>
          </PaperRow>
        )}
      </>
    ),

    // Los tres recuadros van uno al lado del otro, como en el papel.
    priorityKindSystem: () => (
      <div className="flex border-b border-fg/25">
        <PaperOptionBox
          title={label("prioridad")}
          options={WO_PRIORITY_OPTIONS}
          value={values.priority}
          disabled={dis}
          // La prioridad es un dato de la OT: vaciar el recuadro la dejaría sin
          // plazo, así que sólo se cambia por otra.
          onChange={v => { if (v) onChange({ priority: v }); }}
        />
        <PaperOptionBox
          title={label("tipoMant")}
          options={WO_MAINTENANCE_KINDS_OR_INSPECTION}
          value={values.type === "INSPECTION" ? "INSPECTION" : values.maintenanceKind}
          disabled={dis}
          onChange={v => {
            if (v === "INSPECTION") { onChange({ type: "INSPECTION", maintenanceKind: "" }); return; }
            // Mismo criterio que deriveTypeFromMaintenanceKind en el backend.
            onChange({
              type: v === "PREVENTIVO" || v === "PREDICTIVO" ? "PREVENTIVE" : "CORRECTIVE",
              maintenanceKind: v,
            });
          }}
        />
        <PaperOptionBox
          title={label("sistema")}
          options={WO_SYSTEM_AREAS}
          value={values.systemArea}
          disabled={dis}
          onChange={v => onChange({ systemArea: v })}
        />
      </div>
    ),

    permits: () => (
      <>
        <PaperBar title={label("permits")} />
        <p className="px-2 py-1 text-[10px] text-text-industrial/60 border-b border-fg/25">
          Completo correctamente la autorización de trabajo correspondiente a las tareas de:
        </p>
        {permits && <div className="px-2 py-1.5 border-b border-fg/25">{permits}</div>}
      </>
    ),

    request: () => (
      <>
        <PaperBar title={label("request")} />
        <PaperTextArea
          value={values.description}
          disabled={dis}
          onChange={v => onChange({ description: v })}
          placeholder="Qué se pide o qué falló"
        />
      </>
    ),

    task: () => (
      <>
        <PaperBar title={label("task")} />
        <PaperTextArea
          value={values.title}
          disabled={dis}
          onChange={v => onChange({ title: v })}
          placeholder="Qué hay que hacer"
          rows={2}
        />
        <div className="px-2 pt-1 text-[9px] font-bold uppercase tracking-wide text-text-industrial/50">
          {label("taskDetail")}
        </div>
        <PaperTextArea
          value={values.acceptanceCriteria}
          disabled={dis}
          onChange={v => onChange({ acceptanceCriteria: v })}
          placeholder="Cómo se sabe que quedó bien"
          rows={2}
        />
      </>
    ),

    spares: () => (
      <>
        <PaperBar title={label("spares")} />
        {spares && <div className="border-b border-fg/25 p-2">{spares}</div>}
      </>
    ),

    materials: () => (
      <>
        <PaperBar title={label("materials")} />
        {materials && <div className="border-b border-fg/25 p-2">{materials}</div>}
      </>
    ),

    schedule: () => (
      <>
        <PaperBar title={label("schedule")} />
        {schedule && <div className="border-b border-fg/25">{schedule}</div>}
      </>
    ),

    // TAREA CONCLUIDA? SI / NO + RESULTADO. Debajo, lo que el sistema pide para
    // cerrar (quién ejecutó, cuándo, horas, repuestos usados, observaciones).
    completion: () => (
      <>
        <PaperRow>
          <PaperLabelCell className="w-40 shrink-0">{label("taskCompleted")}</PaperLabelCell>
          {([["YES", "SI"], ["NO", "NO"]] as const).map(([v, lab]) => (
            <button
              key={v}
              type="button"
              disabled={!resultEditable}
              onClick={() => onChange({ taskCompleted: values.taskCompleted === v ? "" : v })}
              className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-fg/5 disabled:opacity-70 disabled:hover:bg-transparent"
            >
              <PaperBox on={values.taskCompleted === v} />
              <span className="text-[11px] font-bold text-fg">{lab}</span>
            </button>
          ))}
        </PaperRow>
        <PaperRow>
          <PaperLabelCell className="w-40 shrink-0">{label("resultado")}</PaperLabelCell>
          <PaperValueCell className="flex-1 gap-3">
            {([
              ["SATISFACTORY", "Satisfactorio"],
              ["WITH_DEFICIENCIES", "Con deficiencias"],
            ] as const).map(([v, lab]) => (
              <button
                key={v}
                type="button"
                disabled={!resultEditable}
                onClick={() => onChange({ woResult: values.woResult === v ? "" : v })}
                className="flex items-center gap-2 disabled:opacity-70"
              >
                <PaperBox on={values.woResult === v} />
                <span className={`text-[11px] ${values.woResult === v ? "font-bold text-fg" : "text-text-industrial/70"}`}>{lab}</span>
              </button>
            ))}
          </PaperValueCell>
        </PaperRow>
        {resultExtras && <div className="border-b border-fg/25 p-2">{resultExtras}</div>}
      </>
    ),

    pending: () => (
      <>
        <PaperBar title={label("pending")} />
        <PaperTextArea
          value={values.pendingDetail}
          disabled={!resultEditable}
          onChange={v => onChange({ pendingDetail: v })}
          placeholder="Qué quedó pendiente y por qué"
          rows={2}
        />
      </>
    ),

    risk: () => (
      <>
        <PaperBar title={label("risk")} />
        {riskMatrix && <div className="border-b border-fg/25 p-2">{riskMatrix}</div>}
        <p className="px-2 py-1 text-[10px] font-bold text-fg text-center border-b border-fg/25">
          Ver adjunto el resultado del Análisis de Riesgo y LOTO.
        </p>
        <p className="px-2 py-1 text-[9px] italic text-text-industrial/50 text-center border-b border-fg/25">
          ANTES DE COMENZAR LA TAREA, REALICE UN ANÁLISIS PRELIMINAR DE RIESGOS Y TOME LAS MEDIDAS
          NECESARIAS PARA CADA CASO.
        </p>
      </>
    ),

    signatures: () => (
      <div className="flex divide-x divide-fg/25 border-b border-fg/25">
        <PaperSignColumn
          rol="FIRMA Y ACLARACION DEL SOLICITANTE"
          signatureUrl={signatures.solicitante.signatureUrl}
        >
          <p className="text-[11px] text-fg text-center truncate">{signatures.solicitante.name || ""}</p>
        </PaperSignColumn>
        <PaperSignColumn
          rol="FIRMA Y ACLARACION DEL ASIGNADO"
          signatureUrl={signatures.asignado.signatureUrl}
        >
          <p className="text-[11px] text-fg text-center truncate">{signatures.asignado.name || ""}</p>
        </PaperSignColumn>
      </div>
    ),

    // El anexo es una HOJA APARTE en el papel: se entrega y se archiva suelto de
    // la OT. Por eso lleva su propia identificación, igual que el impreso.
    riskAnnex: () => null,
  };

  const order = config.sections.length ? config.sections : WO_FORM_FALLBACK.config.sections;
  const anexo = order.includes("riskAnnex");

  return (
    // Ancho de hoja A4 (210 mm) y centrada: en pantalla ancha (o con el modal
    // maximizado) el formulario se estiraba hasta el borde de la ventana y no
    // se parecía al papel que firma la tripulación.
    <div className="space-y-4 w-full max-w-[210mm] mx-auto">
      {/* La hoja se guarda sola mientras se completa: sin este aviso, nadie
          sabría que lo cargado ya quedó. */}
      <div className="flex justify-end h-4" aria-live="polite">
        <span className="text-[10px] font-bold">
          {autosave?.error
            ? <span className="text-red-600 dark:text-red-400">{autosave.error}</span>
            : autosave?.saving
              ? <span className="text-text-industrial/40">Guardando…</span>
              : autosave?.saved
                ? <span className="text-green-600 dark:text-green-500">✓ Guardado</span>
                : null}
        </span>
      </div>

      <PaperSheet>
        <PaperDocHeader meta={meta} logoUrl={logoUrl} tenantName={tenantName} />
        {order.map(id => <React.Fragment key={id}>{sections[id]?.()}</React.Fragment>)}
        <PaperDocFooter meta={meta} />
      </PaperSheet>

      {anexo && (
        <PaperSheet>
          <div
            className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white text-center"
            style={{ backgroundColor: "#0f172a" }}
          >
            {label("riskAnnexTitle")}
          </div>
          <PaperRow>
            <PaperLabelCell className="w-32 shrink-0">ORDEN DE TRABAJO</PaperLabelCell>
            <PaperValueCell className="flex-1 font-mono font-bold text-accent">{header.workOrderCode}</PaperValueCell>
            <PaperLabelCell className="w-24 shrink-0">UNIDAD</PaperLabelCell>
            <PaperValueCell className="w-56 shrink-0">{header.vesselName}</PaperValueCell>
          </PaperRow>
          <PaperRow>
            <PaperLabelCell className="w-32 shrink-0">EQUIPO</PaperLabelCell>
            <PaperValueCell className="flex-1">{header.assetLabel || "—"}</PaperValueCell>
            <PaperLabelCell className="w-24 shrink-0">FECHA</PaperLabelCell>
            <PaperValueCell className="w-56 shrink-0">{header.openDate}</PaperValueCell>
          </PaperRow>

          <PaperBar title={label("riskResult")} />
          <PaperTextArea
            value={values.riskAnalysisResult}
            disabled={dis}
            onChange={v => onChange({ riskAnalysisResult: v })}
            placeholder="Resultado del análisis previo de riesgos"
          />

          <PaperBar title={label("loto")} />
          <PaperTextArea
            value={values.loto}
            disabled={dis}
            onChange={v => onChange({ loto: v })}
            placeholder="Bloqueo y etiquetado: qué se aísla y cómo"
            rows={2}
          />
          <PaperDocFooter meta={meta} />
        </PaperSheet>
      )}
    </div>
  );
}
