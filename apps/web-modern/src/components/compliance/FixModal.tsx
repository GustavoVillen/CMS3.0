// Ventana "qué está mal / cómo se arregla" de los paneles de cumplimiento.
//
// La usan los dos marcos —TMSA (Elemento 4) e ISM (Capítulo 10)—: el semáforo
// dice que hay algo; esta ventana dice QUÉ, CÓMO se corrige y deja los botones
// de los formularios donde se corrige. Vive acá y no dentro de una pantalla
// porque los dos paneles tienen que verse y comportarse igual.
//
// Los hallazgos los calcula el backend junto al semáforo (tmsa-service ·
// findings / ism-service · findings). Acá sólo se les pone texto: la pantalla
// no recalcula ningún umbral.

import React from "react";
import { ChevronRight } from "lucide-react";
import { useT } from "../../lib/i18n";
import { ModalCloseButton } from "../ModalCloseButton";

/** Espejo de TmsaFinding / IsmFinding del backend. */
export interface ComplianceFinding {
  key: string;
  value: number;
  kind: "count" | "pct";
  status: "GAP" | "ATTENTION" | "INFO";
}

/** Un acceso al módulo donde se corrige. */
export interface FixChip {
  label: string;
  onClick: () => void;
}

/** Los pasos vienen en un solo texto separado por saltos: acá se numeran. */
export const fixSteps = (text: string): string[] =>
  text.split("\n").map(line => line.trim()).filter(Boolean);

/** El número del hallazgo. Un cero no aporta nada: en ese caso no se muestra. */
export const findingValue = (f: ComplianceFinding): string | undefined => {
  if (f.kind === "pct") return `${Math.round(f.value * 100)}%`;
  return f.value > 0 ? f.value.toLocaleString("es-AR") : undefined;
};

/** Un hallazgo: la franja con el número, qué está mal y los pasos numerados. */
export const FixBlock: React.FC<{
  /** Clases del semáforo (STATUS_META[...].pill de cada panel). */
  pill: string;
  title: string;
  value?: string;
  what: string;
  steps?: string[];
  /** Párrafo extra debajo del diagnóstico (se usa en el badge de capacidad). */
  extra?: string;
}> = ({ pill, title, value, what, steps, extra }) => {
  const t = useT();
  return (
    <div className="space-y-2.5">
      <div className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${pill}`}>
        <span className="text-xs font-bold leading-snug">{title}</span>
        {value && <span className="text-sm font-bold tabular-nums shrink-0">{value}</span>}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 font-semibold mb-1">{t("fix.whatsWrong")}</p>
        <p className="text-xs text-fg/80 leading-relaxed">{what}</p>
        {extra && <p className="text-xs text-fg/80 leading-relaxed mt-1.5">{extra}</p>}
      </div>
      {steps && steps.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-industrial/40 font-semibold mb-1">{t("fix.howToFix")}</p>
          <ol className="space-y-1.5">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-xs text-fg/80 leading-relaxed">
                <span className="shrink-0 w-4 h-4 mt-0.5 rounded-full bg-accent/10 text-accent text-[9px] font-bold flex items-center justify-center">{i + 1}</span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
};

/** El marco de la ventana: encabezado con el semáforo, cuerpo y accesos. */
export const ComplianceFixModal: React.FC<{
  /** Referencia del requisito (ej. "ISM 10.2.2" o "4.1.1"). */
  eyebrow: string;
  title: string;
  /** Clases y rótulo del badge que se apretó. */
  statusPill: string;
  StatusIcon: React.FC<{ className?: string }>;
  statusLabel: string;
  chips: FixChip[];
  onClose: () => void;
  children: React.ReactNode;
}> = ({ eyebrow, title, statusPill, StatusIcon, statusLabel, chips, onClose, children }) => {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-surface dark:bg-[#0D1B2A] border border-fg/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-fg/10">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-wider text-text-industrial/40">{eyebrow}</p>
            <h2 className="text-sm font-bold text-fg leading-snug">{title}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusPill}`}>
              <StatusIcon className="w-3 h-3" />
              {statusLabel}
            </span>
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>

        {/* Los formularios donde se corrige, a un click. Son los mismos accesos
            de la tarjeta: si mañana cambia el módulo, cambia en un solo lugar. */}
        <div className="shrink-0 border-t border-fg/10 px-5 py-3 flex flex-wrap items-center gap-1.5">
          {chips.map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={chip.onClick}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-fg/5 border border-fg/10 hover:border-accent/40 hover:bg-fg/10 transition-all text-[11px] font-medium text-fg/70 cursor-pointer"
            >
              {chip.label}
              <ChevronRight className="w-2.5 h-2.5 opacity-50" />
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-1.5 rounded-lg bg-accent text-accent-fg text-[11px] font-bold hover:brightness-110 cursor-pointer"
          >
            {t("fix.understood")}
          </button>
        </div>
      </div>
    </div>
  );
};
