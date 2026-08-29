// Formulario de Solicitud de Servicios dibujado como el papel (REGI-LOG-01.3).
//
// La pantalla de la SS ES el formulario: mismas secciones, en el mismo orden,
// con las mismas listas y etiquetas que imprime el PDF. El orden y las opciones
// NO se hardcodean acá: vienen de `GET /app/pms/service-requests/form`, que
// resuelve la definicion del tenant — la misma que usa
// `service-request-pdf/template-service-request.ts`. Si un tenant cambia su
// formulario, cambian el papel y la pantalla juntos.
//
// Los ids de seccion son los del catalogo del PDF. No renombrarlos sin migrar
// TenantForm.config.

import React from "react";
import { Check } from "lucide-react";
import { fmtDate } from "../../lib/utils";
import { AutoTextArea } from "../AutoTextArea";

// Azul marino del documento controlado — el mismo que ya usan las barras de
// seccion del formulario de OT (WoRegiSections) y MaintenancePlans.
const NAVY = "#0f172a";

// ---------------------------------------------------------------------------
// Definicion del formulario (espejo de FormConfig/ControlledDocMeta del backend)
// ---------------------------------------------------------------------------

export interface SsFormMeta {
  formCode: string;
  title: string;
  revision: number;
  effectiveFrom: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
}

export interface SsFormConfig {
  sections: string[];
  departments: string[];
  distribution: string[];
  communicationMethods: string[];
  purchaseRequest: string[];
  labels: Record<string, string>;
}

export interface SsFormDoc {
  meta: SsFormMeta;
  config: SsFormConfig;
  /** Logo propio del formulario (el mismo que estampa el PDF), si el tenant lo cargó. */
  logoUrl?: string | null;
}

/** Si el endpoint no responde, el papel se dibuja igual con el default Mercurio. */
export const SS_FORM_FALLBACK: SsFormDoc = {
  meta: {
    formCode: "REGI-LOG-01.3", title: "Solicitud de servicios", revision: 2,
    effectiveFrom: "01.05.2025",
    preparedBy: "Mercurio Group", reviewedBy: "Asesoria Juridica", approvedBy: "Gerente General",
  },
  config: {
    sections: [
      "header", "deptDate", "assignedTo", "equipment", "workOrderRef",
      "description", "causes", "purchaseRequest", "tramitacion", "hojaRuta",
      "taller", "entregaRecepcion", "comments", "signatures",
      "communication", "distribution",
    ],
    departments: ["CUBIERTA", "MAQUINAS", "BARCAZA", "OTROS"],
    distribution: ["JMA", "CAP"],
    communicationMethods: ["IMPRESO", "EMAIL", "WHAPP", "OTRO"],
    purchaseRequest: ["NORMAL", "AFECTA SEGURIDAD", "AFECTA SERVICIO"],
    labels: {},
  },
};

/** Titulos por defecto de cada seccion — los mismos textos del papel. */
const DEFAULT_LABELS: Record<string, string> = {
  remolcador: "REMOLCADOR",
  solicitudN: "SOLICITUD N°",
  departamento: "DEPARTAMENTO",
  fecha: "FECHA",
  assignedTo: "ASIGNADO A",
  equipment: "EQUIPO O SISTEMA AFECTADO",
  workOrderRef: "ORDEN DE TRABAJO",
  description: "DESCRIPCION DEL SERVICIO",
  causes: "DETALLE DEL SERVICIO",
  purchaseRequest: "SOLICITUD DE COMPRAS",
  tramitacion: "TRAMITACION DE LA SOLICITUD",
  hojaRuta: "HOJA DE RUTA DEL PEDIDO",
  taller: "TALLER QUE CONCURRE A REALIZAR EL SERVICIO",
  entregaRecepcion: "ENTREGA / RECEPCION",
  comments: "COMENTARIOS ADICIONALES",
  communication: "MEDIO DE COMUNICACION UTILIZADO",
  distribution: "DISTRIBUCION",
};

const DEPT_LABELS: Record<string, string> = {
  CUBIERTA: "Cubierta", MAQUINAS: "Máquinas", BARCAZA: "Barcaza",
  PROVEEDOR: "Proveedor", OTROS: "Otros",
};
export const ssDepartmentLabel = (d: string | null | undefined) => (d ? DEPT_LABELS[d] ?? d : "");

// ---------------------------------------------------------------------------
// Piezas del papel — se exportan porque la pantalla arma con ellas los bloques
// que necesitan datos propios (tramitacion, hoja de ruta).
// ---------------------------------------------------------------------------

/** Casillero cuadrado del formulario. */
export function PaperBox({ on }: { on: boolean }) {
  return (
    <span className={`shrink-0 w-3.5 h-3.5 border flex items-center justify-center ${
      on ? "bg-fg border-fg" : "border-fg/50 bg-transparent"
    }`}>
      {on && <Check className="w-2.5 h-2.5 text-surface" strokeWidth={3.5} />}
    </span>
  );
}

/** Franja azul de seccion, texto blanco a la izquierda (igual que el impreso). */
export function SsBar({ title }: { title: string }) {
  return (
    <div
      className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
      style={{ backgroundColor: NAVY }}
    >
      {title}
    </div>
  );
}

/** Celda-etiqueta azul (REMOLCADOR, FECHA, ORDEN DE TRABAJO…). */
function LabelCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`px-2 py-1.5 flex items-center text-[9px] font-bold uppercase tracking-wide text-white leading-tight ${className}`}
      style={{ backgroundColor: NAVY }}
    >
      {children}
    </div>
  );
}

/** Celda de dato: fondo del papel, texto normal. */
function ValueCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-2 py-1.5 flex items-center text-[13px] text-fg min-w-0 ${className}`}>{children}</div>;
}

/** Fila de celdas con las lineas verticales del formulario. */
function PaperRow({ children }: { children: React.ReactNode }) {
  return <div className="flex divide-x divide-fg/25 border-b border-fg/25">{children}</div>;
}

/** Campo escrito dentro de una celda: sin caja propia, como sobre el papel. */
const fieldCls =
  "w-full bg-transparent text-[13px] text-fg placeholder-text-industrial/30 outline-none disabled:opacity-70";

/** Renglones de texto libre (DESCRIPCION / DETALLE / COMENTARIOS). */
function PaperTextArea({ value, onChange, disabled, placeholder, rows = 3 }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <AutoTextArea
      className={`${fieldCls} block px-2 py-1.5 resize-y border-b border-fg/25`}
      style={{ minHeight: `${rows * 20 + 12}px` }}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
    />
  );
}

/**
 * Fila de casilleros del papel: el rotulo arriba y el cuadradito abajo, cada
 * opcion en su columna. `multi` = se pueden marcar varias (SOLICITUD DE COMPRAS,
 * MEDIO DE COMUNICACION); si no, volver a tocar la marcada la limpia.
 */
export function SsCheckRow({ options, selected, onToggle, disabled }: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex divide-x divide-fg/25 border-b border-fg/25">
      {options.map(o => (
        <button
          key={o}
          type="button"
          disabled={disabled}
          onClick={() => onToggle(o)}
          className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1.5 transition-colors hover:bg-fg/5 disabled:opacity-70 disabled:hover:bg-transparent"
        >
          <span className="text-[9px] font-bold uppercase tracking-wide text-text-industrial/60 text-center leading-tight">
            {o}
          </span>
          <PaperBox on={selected.includes(o)} />
        </button>
      ))}
    </div>
  );
}

/** Encabezado de tabla del papel (HOJA DE RUTA, ENTREGA / RECEPCION). */
export function SsTableHead({ cols }: { cols: Array<{ label: string; className: string }> }) {
  return (
    <div className="flex divide-x divide-fg/25 border-b border-fg/25 bg-fg/5">
      {cols.map(c => (
        <div key={c.label} className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-text-industrial/60 text-center ${c.className}`}>
          {c.label}
        </div>
      ))}
    </div>
  );
}

/**
 * Columna de firma de la TRAMITACION (SOLICITA / APRUEBA / AUTORIZA): rotulo,
 * espacio de firma, linea, nombre y fecha — igual que el bloque impreso.
 * El nombre lo pone quien la usa: texto, o el desplegable de correccion del
 * admin.
 */
export function SsSignColumn({ rol, rejected, at, signatureUrl, children }: {
  rol: string;
  rejected?: boolean;
  at?: string | null;
  /** Firma digital de quien ejecutó el paso, si la tiene cargada. */
  signatureUrl?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-w-0 bg-fg/[0.03] px-2 pt-1.5 pb-2 flex flex-col">
      <p className={`text-[9px] font-bold uppercase tracking-wide text-center leading-tight ${
        rejected ? "text-red-600 dark:text-red-400" : "text-text-industrial/60"
      }`}>
        {rejected ? `${rol} — NO APROBADA` : rol}
      </p>
      {/* Espacio de firma: si el paso lo hizo alguien con firma cargada, va su
          imagen; si no, queda en blanco para firmar a mano. En modo oscuro el
          trazo es oscuro sobre fondo oscuro, por eso se invierte. */}
      <div className="h-14 flex items-end justify-center overflow-hidden">
        {signatureUrl && (
          <img
            src={signatureUrl}
            alt={`Firma de ${rol.toLowerCase()}`}
            className="max-h-14 max-w-full object-contain dark:invert dark:brightness-95"
          />
        )}
      </div>
      <div className="border-t border-fg/30 pt-1">{children}</div>
      <p className="text-[9px] text-text-industrial/40 text-center mt-0.5 h-3">{at ? fmtDate(at) : ""}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// La hoja
// ---------------------------------------------------------------------------

export interface SsPaperValues {
  department: string;
  description: string;
  causes: string;
  compras: string[];
  providerId: string;
  tallerNotes: string;
  observations: string;
  comunicacion: string[];
  distribucion: string[];
  capitan: string;
  jefeMaq: string;
  // ENTREGA / RECEPCION
  recepcionItem: string;
  recibe: string;
  /** Conformidad: sí / no / todavía sin definir (recuadro vacío del papel). */
  conforme: boolean | null;
}

/** Valor centinela del selector de taller: "no esta en el catalogo". */
export const OTRO_TALLER = "__OTRO__";

export function SsPaperForm({
  meta, config, logoUrl, tenantName,
  code, vesselName, openDate, assetName, workOrder, workOrderLink,
  values, onChange, editable,
  providers, otroTaller, onOtroTaller,
  tramitacion, hojaRuta,
}: {
  meta: SsFormMeta;
  config: SsFormConfig;
  logoUrl: string | null;
  tenantName: string;
  code: string;
  /** Nombre del buque, nunca el codigo (ver CLAUDE.md "Nombres, no codigos"). */
  vesselName: string;
  openDate: string;
  assetName: string | null;
  workOrder: { workOrderCode: string; title: string | null } | null;
  /** La OT de origen se abre desde el propio recuadro del papel. */
  workOrderLink?: React.ReactNode;
  values: SsPaperValues;
  onChange: (patch: Partial<SsPaperValues>) => void;
  editable: boolean;
  providers: Array<{ id: string; name: string; providerCode: string }>;
  otroTaller: boolean;
  onOtroTaller: (v: boolean) => void;
  tramitacion: React.ReactNode;
  hojaRuta: React.ReactNode;
}) {
  const label = (id: string) => config.labels[id] ?? DEFAULT_LABELS[id] ?? id;
  const dis = !editable;

  const toggleMulti = (key: "compras" | "comunicacion" | "distribucion", v: string) => {
    const list = values[key];
    onChange({ [key]: list.includes(v) ? list.filter(x => x !== v) : [...list, v] } as Partial<SsPaperValues>);
  };

  // El departamento vive en un solo campo: el recuadro ASIGNADO A y la celda
  // DEPARTAMENTO son la misma dato mostrado dos veces, igual que en el papel.
  const deptOptions = config.departments.includes(values.department) || !values.department
    ? config.departments
    : [...config.departments, values.department];

  const sections: Record<string, () => React.ReactNode> = {
    header: () => (
      <PaperRow>
        <LabelCell className="w-28 shrink-0">{label("remolcador")}</LabelCell>
        <ValueCell className="flex-1 font-semibold">{vesselName}</ValueCell>
        <LabelCell className="w-28 shrink-0">{label("solicitudN")}</LabelCell>
        <ValueCell className="w-44 shrink-0 font-mono font-bold text-accent">{code}</ValueCell>
      </PaperRow>
    ),

    deptDate: () => (
      <PaperRow>
        <LabelCell className="w-28 shrink-0">{label("departamento")}</LabelCell>
        <ValueCell className="flex-1">
          <select
            className={fieldCls}
            value={values.department}
            disabled={dis}
            onChange={e => onChange({ department: e.target.value })}
          >
            <option value="">—</option>
            {deptOptions.map(d => <option key={d} value={d}>{ssDepartmentLabel(d)}</option>)}
          </select>
        </ValueCell>
        <LabelCell className="w-24 shrink-0 justify-center">{label("fecha")}</LabelCell>
        <ValueCell className="w-36 shrink-0 justify-center">{fmtDate(openDate)}</ValueCell>
      </PaperRow>
    ),

    assignedTo: () => (
      <>
        <SsBar title={label("assignedTo")} />
        <SsCheckRow
          options={config.departments}
          selected={values.department ? [values.department] : []}
          disabled={dis}
          onToggle={v => onChange({ department: values.department === v ? "" : v })}
        />
      </>
    ),

    equipment: () => (
      <PaperRow>
        <LabelCell className="w-44 shrink-0">{label("equipment")}</LabelCell>
        <ValueCell className="flex-1">{assetName || "—"}</ValueCell>
      </PaperRow>
    ),

    workOrderRef: () => (
      <PaperRow>
        <LabelCell className="w-36 shrink-0">{label("workOrderRef")}</LabelCell>
        <ValueCell className="flex-1">
          {workOrder
            ? (workOrderLink ?? <span>{workOrder.workOrderCode}{workOrder.title ? ` — ${workOrder.title}` : ""}</span>)
            : "—"}
        </ValueCell>
      </PaperRow>
    ),

    description: () => (
      <>
        <SsBar title={label("description")} />
        <PaperTextArea
          value={values.description}
          disabled={dis}
          onChange={v => onChange({ description: v })}
          placeholder="Qué se le pide al taller"
        />
      </>
    ),

    causes: () => (
      <>
        <SsBar title={label("causes")} />
        <PaperTextArea
          value={values.causes}
          disabled={dis}
          onChange={v => onChange({ causes: v })}
          placeholder="Detalle del trabajo a realizar"
        />
      </>
    ),

    purchaseRequest: () => (
      <>
        <SsBar title={label("purchaseRequest")} />
        <SsCheckRow
          options={config.purchaseRequest}
          selected={values.compras}
          disabled={dis}
          onToggle={v => toggleMulti("compras", v)}
        />
      </>
    ),

    tramitacion: () => (
      <>
        <SsBar title={label("tramitacion")} />
        <div className="flex divide-x divide-fg/25 border-b border-fg/25">{tramitacion}</div>
      </>
    ),

    hojaRuta: () => (
      <>
        <SsBar title={label("hojaRuta")} />
        {hojaRuta}
      </>
    ),

    taller: () => (
      <>
        <SsBar title={label("taller")} />
        <div className="px-2 py-1.5 border-b border-fg/25 space-y-1.5">
          {/* Del catalogo de proveedores; el texto libre queda para el taller
              que todavia no esta cargado. */}
          <select
            className={fieldCls}
            value={otroTaller ? OTRO_TALLER : values.providerId}
            disabled={dis}
            onChange={e => {
              if (e.target.value === OTRO_TALLER) { onOtroTaller(true); onChange({ providerId: "" }); return; }
              onOtroTaller(false);
              onChange({ providerId: e.target.value, tallerNotes: "" });
            }}
          >
            <option value="">Seleccionar taller / proveedor…</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}{p.providerCode ? ` (${p.providerCode})` : ""}</option>
            ))}
            <option value={OTRO_TALLER}>Otro taller (no está en la lista)…</option>
          </select>
          {otroTaller && (
            <input
              className={fieldCls}
              value={values.tallerNotes}
              disabled={dis}
              onChange={e => onChange({ tallerNotes: e.target.value })}
              placeholder="Ej. Hidraulica Brasil"
              autoFocus
            />
          )}
        </div>
      </>
    ),

    // La primera fila se completa acá mismo, como en el papel. El paso
    // "Servicio recibido" toma estos datos y además cierra la SS: escribirlos
    // deja asentado qué se recibió, no completa la solicitud.
    entregaRecepcion: () => (
      <>
        <SsBar title={label("entregaRecepcion")} />
        <p className="px-2 py-1 text-[9px] italic text-text-industrial/50 text-center border-b border-fg/25">
          Se debe indicar si por parte de quien solicitó el servicio, hay conformidad con el trabajo realizado
        </p>
        <SsTableHead cols={[
          { label: "ITEM", className: "w-[45%]" },
          { label: "RECIBE", className: "flex-1" },
          { label: "CONFORM. SÍ", className: "w-24 shrink-0" },
          { label: "CONFORM. NO", className: "w-24 shrink-0" },
        ]} />
        <div className="flex divide-x divide-fg/25 border-b border-fg/25">
          <div className="w-[45%] px-2 py-1.5">
            <input
              className={fieldCls}
              value={values.recepcionItem}
              disabled={dis}
              onChange={e => onChange({ recepcionItem: e.target.value })}
              placeholder="Qué se recibió"
            />
          </div>
          <div className="flex-1 min-w-0 px-2 py-1.5">
            <input
              className={`${fieldCls} text-center`}
              value={values.recibe}
              disabled={dis}
              onChange={e => onChange({ recibe: e.target.value })}
              placeholder="Quién recibe"
            />
          </div>
          {/* Sí y No son excluyentes; volver a tocar el marcado lo limpia. */}
          {[true, false].map(v => (
            <button
              key={String(v)}
              type="button"
              disabled={dis}
              onClick={() => onChange({ conforme: values.conforme === v ? null : v })}
              className="w-24 shrink-0 py-1.5 flex justify-center transition-colors hover:bg-fg/5 disabled:opacity-70 disabled:hover:bg-transparent"
            >
              <PaperBox on={values.conforme === v} />
            </button>
          ))}
        </div>
        {/* El papel nunca sale sin renglones libres para anotar a mano. */}
        {[1, 2].map(i => (
          <div key={i} className="flex divide-x divide-fg/25 border-b border-fg/25">
            <div className="w-[45%] px-2 py-1.5 text-[12px]">&nbsp;</div>
            <div className="flex-1 min-w-0 px-2 py-1.5" />
            <div className="w-24 shrink-0 py-1.5 flex justify-center"><PaperBox on={false} /></div>
            <div className="w-24 shrink-0 py-1.5 flex justify-center"><PaperBox on={false} /></div>
          </div>
        ))}
      </>
    ),

    comments: () => (
      <>
        <SsBar title={label("comments")} />
        <PaperTextArea
          value={values.observations}
          disabled={dis}
          onChange={v => onChange({ observations: v })}
          placeholder="Lo que haga falta aclarar del pedido"
          rows={2}
        />
      </>
    ),

    signatures: () => (
      <>
        <p className="px-2 py-1 text-[9px] italic text-text-industrial/50 text-center border-b border-fg/25">
          (Indicar nombre, posición y si es impreso sello) — Deben firmar y registrarse el Jefe de Máquinas y Capitán
        </p>
        <div className="flex divide-x divide-fg/25 border-b border-fg/25">
          {([
            ["CAPITAN", values.capitan, (v: string) => onChange({ capitan: v }), "Ej. CAP. WILLIAM RIQUELME"],
            ["JEFE DE MAQUINAS", values.jefeMaq, (v: string) => onChange({ jefeMaq: v }), "Ej. J.M. CRISTHIAN VERON"],
          ] as const).map(([rol, value, set, ph]) => (
            <div key={rol} className="flex-1 min-w-0 px-2 pt-2 pb-1.5">
              <input
                className={`${fieldCls} font-semibold`}
                value={value}
                disabled={dis}
                onChange={e => set(e.target.value)}
                placeholder={ph}
              />
              <div className="border-t border-fg/30 mt-6" />
              <p className="text-[9px] font-bold uppercase tracking-wide text-text-industrial/50 text-center mt-0.5">{rol}</p>
            </div>
          ))}
        </div>
      </>
    ),

    communication: () => (
      <>
        <SsBar title={label("communication")} />
        <SsCheckRow
          options={config.communicationMethods}
          selected={values.comunicacion}
          disabled={dis}
          onToggle={v => toggleMulti("comunicacion", v)}
        />
      </>
    ),

    distribution: () => (
      <>
        <SsBar title={label("distribution")} />
        <PaperRow>
          <LabelCell className="w-24 shrink-0">Original</LabelCell>
          <ValueCell className="w-44 shrink-0 text-[11px] font-bold text-text-industrial/60">Recursos Humanos</ValueCell>
          <ValueCell className="flex-1" >{""}</ValueCell>
        </PaperRow>
        <div className="flex divide-x divide-fg/25 border-b border-fg/25">
          <LabelCell className="w-24 shrink-0">Copia</LabelCell>
          <ValueCell className="w-44 shrink-0 text-[11px] font-bold text-text-industrial/60">Destinatarios</ValueCell>
          <div className="flex-1 min-w-0 px-2 py-1.5 flex flex-wrap gap-1">
            {config.distribution.map(d => {
              const on = values.distribucion.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={dis}
                  onClick={() => toggleMulti("distribucion", d)}
                  className={`px-2 py-0.5 border text-[11px] font-bold transition-colors disabled:opacity-70 ${
                    on ? "bg-fg text-surface border-fg" : "border-fg/30 text-text-industrial/60 hover:bg-fg/5"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </>
    ),
  };

  const order = config.sections.length ? config.sections : SS_FORM_FALLBACK.config.sections;

  return (
    <div className="border border-fg/25 bg-surface">
      {/* Cabecera del documento controlado: logo, codigo + titulo, revision. */}
      <div className="flex divide-x divide-fg/25 border-b border-fg/25">
        <div className="w-40 shrink-0 flex items-center justify-center p-2">
          {logoUrl
            ? <img src={logoUrl} alt={tenantName} className="max-h-10 max-w-full object-contain" />
            : <span className="text-[11px] font-bold text-text-industrial/60 text-center">{tenantName}</span>}
        </div>
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center py-2">
          <p className="text-[13px] font-bold text-accent">{meta.formCode}</p>
          <p className="text-[13px] font-bold text-fg">{meta.title}</p>
        </div>
        <div className="w-52 shrink-0 text-[9px] divide-y divide-fg/25">
          <div className="flex divide-x divide-fg/25">
            <span className="flex-1 px-1.5 py-1 text-text-industrial/60">Revisión N°</span>
            <span className="w-16 px-1.5 py-1 font-bold text-fg text-center">{meta.revision}</span>
          </div>
          <div className="flex divide-x divide-fg/25">
            <span className="flex-1 px-1.5 py-1 text-text-industrial/60">Desde:</span>
            <span className="w-16 px-1.5 py-1 font-bold text-fg text-center">{meta.effectiveFrom}</span>
          </div>
          <div className="px-1.5 py-1 text-right font-bold text-accent">Documento Controlado</div>
        </div>
      </div>

      {order.map(id => <React.Fragment key={id}>{sections[id]?.()}</React.Fragment>)}

      {/* Pie del documento controlado (Elaborado / Revisado / Aprobado). */}
      <div className="flex divide-x divide-fg/25 bg-fg/5 text-[9px] text-text-industrial/60">
        <span className="flex-1 px-2 py-1 text-center">Elaborado: {meta.preparedBy}</span>
        <span className="flex-1 px-2 py-1 text-center">Revisado: {meta.reviewedBy}</span>
        <span className="flex-1 px-2 py-1 text-center">Aprobado: {meta.approvedBy}</span>
      </div>
    </div>
  );
}
